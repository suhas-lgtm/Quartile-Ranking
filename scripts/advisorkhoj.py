"""
advisorkhoj.py — monthly fund portfolios from the Advisorkhoj research API (paid).

    getAllSchemesCommonNamesbyCategory   fund names per category
    getMutualfundHistoricalPortfolio     one fund's holdings for one month
                                         (instrument, ISIN, asset class, sector,
                                         industry, value, % of net assets)

Every Equity and Hybrid fund is covered, Balanced Advantage (Dynamic Asset
Allocation) and Multi Asset Allocation included (left out until Oct 2026).
The API returns about 14 months; a new month appears around the 10th.

Fund names are matched to our catalogue (match_report): exact after tidying,
then common spellings auto-corrected (Flexicap / Flexi Cap, Midcap / Mid Cap,
typos the API carries), then a close match within the same fund house. Names
that still find no fund are logged and saved (Holdings/unmatched.json) for the
data health check; closed-ended "Series" funds and segregated portfolios, which
our catalogue does not carry, are expected there and not flagged.

Stored in Neon:
    portfolio_holdings      the LATEST month per fund (fund page, Active Share)
    files, bucket Holdings  YYYY-MM.json.gz — every fund's month, compressed,
                            kept for style drift / turnover (not public)

The key comes from ADVISORKHOJ_API_KEY (environment or .env), never from code.

Usage:
  python scripts/advisorkhoj.py                 # fetch the newest month if not stored yet
  python scripts/advisorkhoj.py --month 2026-08 # a given month
  python scripts/advisorkhoj.py --backfill 12   # the last 12 months (history files)
  python scripts/advisorkhoj.py --dry-run       # fetch and report, store nothing
  python scripts/advisorkhoj.py --month 2026-08 --categories "Hybrid: Dynamic Asset Allocation,Hybrid: Multi Asset Allocation"
                                                # only these categories, added to the stored month
  python scripts/advisorkhoj.py --names         # match report only: which names find no fund
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import json
import logging
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

log = logging.getLogger("advisorkhoj")

BASE = "https://mfapi.advisorkhoj.com"
CATALOGUE_PATH = os.path.join(ROOT_DIR, "data", "scheme_catalogue.json")
# Categories left out of the fetch. Balanced Advantage and Multi Asset were, until Oct 2026.
EXCLUDED_CATEGORIES: set[str] = set()
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
PROBE_FUND = "HDFC Flexi Cap Fund"        # used to see whether a month is out yet
HOLDINGS_BUCKET = "Holdings"


def api_key() -> str:
    k = os.environ.get("ADVISORKHOJ_API_KEY")
    if not k:
        env = os.path.join(ROOT_DIR, ".env")
        if os.path.exists(env):
            m = re.search(r"^ADVISORKHOJ_API_KEY=(.*)$", open(env, encoding="utf-8").read(), re.M)
            k = m.group(1).strip().strip('"') if m else None
    if not k:
        raise SystemExit("ADVISORKHOJ_API_KEY is not set (environment or .env).")
    return k


# The plan allows 2,001 calls an hour (X-RateLimit-Limit-Hour). A monthly refresh
# is ~800 calls; a backfill is several hours' worth, so calls wait for the reset
# when the hour's allowance runs out instead of failing.
MIN_REMAINING = 20


def _post(path: str, **params):
    import time
    for _ in range(3):
        r = requests.post(f"{BASE}/{path}", params={**params, "key": api_key()}, timeout=90)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After") or 600) + 5
            log.warning("Advisorkhoj hourly limit reached — waiting %d min for the reset", wait // 60)
            time.sleep(wait)
            continue
        r.raise_for_status()
        left = r.headers.get("X-RateLimit-Remaining-Hour")
        if left is not None and int(left) < MIN_REMAINING:
            wait = int(r.headers.get("RateLimit-Reset") or 600) + 5
            log.warning("Only %s calls left this hour — pausing %d min", left, wait // 60)
            time.sleep(wait)
        return r.json()
    r.raise_for_status()
    return r.json()


def fund_names(only: set[str] | None = None) -> dict[str, str]:
    """{common name: Advisorkhoj category} for every covered Equity/Hybrid fund (or just `only`'s categories)."""
    cats = _post("getAllSchemeCategories").get("list") or []
    out = {}
    for c in cats:
        if not c.startswith(("Equity", "Hybrid")) or c in EXCLUDED_CATEGORIES or (only and c not in only):
            continue
        for n in _post("getAllSchemesCommonNamesbyCategory", category=c).get("list") or []:
            out[n] = c
    log.info("Advisorkhoj: %d Equity/Hybrid funds%s", len(out), f" in {', '.join(sorted(only))}" if only else "")
    return out


# ── matching to our catalogue ─────────────────────────────────────────────────

# Spellings that differ between Advisorkhoj and AMFI for the same fund (applied to both sides).
AUTO_CORRECT = [
    (r"\bflexi\s*cap\b", "flexicap"), (r"\bmid\s*cap\b", "midcap"), (r"\blarge\s*cap\b", "largecap"),
    (r"\bsmall\s*cap\b", "smallcap"), (r"\bmulti\s*cap\b", "multicap"), (r"\bmicro\s*cap\b", "microcap"),
    (r"\baggresive\b", "aggressive"), (r"\bfinancials services\b", "financial services"),
    (r"\bmahindramanulife\b", "mahindra manulife"), (r"\bicici pru\b", "icici prudential"),
    (r"\bbal(anced)? adv(antage)?\b", "balanced advantage"), (r"\bmulti asset allocation\b", "multi asset"),
    (r"\bbank of india\b", "boi"), (r"\bowsal\b", "oswal"), (r"\baditya birla sun life\b", "absl"),
]
# Names our catalogue does not carry by design: closed-ended series and side-pockets.
EXPECTED_UNMATCHED = re.compile(r"\bseries\s+[ivx\d]+\b|segregated portfolio|\bfmp\b|fixed (maturity|term)", re.I)


def _norm(n: str) -> str:
    n = (n or "").lower().replace("&", " and ")
    for pat, rep in AUTO_CORRECT:
        n = re.sub(pat, rep, n)
    n = re.sub(r"\(.*?\)|\btax saver\b|\b(fund|scheme|the|plan|regular|growth|direct|option)\b", " ", n)
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def _catalogue() -> dict[str, str]:
    """{tidied name: scheme code} for our whole catalogue."""
    ours: dict[str, str] = {}
    for s in json.load(open(CATALOGUE_PATH, encoding="utf-8"))["schemes"]:
        ours.setdefault(_norm(s["scheme_name"]), str(s["scheme_code"]))
    return ours


def match_report(names: list[str], ours: dict[str, str] | None = None) -> tuple[dict[str, str], list[dict]]:
    """
    ({name: our scheme code}, [unmatched]). In order: the tidied, auto-corrected name exactly;
    a very close spelling (≥ 93% alike); the same words in another order within the same fund
    house (≥ 90%). Each unmatched entry says the closest fund we have and whether it is expected
    (a closed-ended series or a segregated portfolio, which the catalogue does not carry).
    """
    ours = ours if ours is not None else _catalogue()
    keys = list(ours)
    out: dict[str, str] = {}
    unmatched: list[dict] = []
    for n in names:
        k = _norm(n)
        if k in ours:
            out[n] = ours[k]
            continue
        close = difflib.get_close_matches(k, keys, n=1, cutoff=0.93)
        if close:
            out[n] = ours[close[0]]
            continue
        # Same words, another order, same fund house (the first word): "Kotak Midcap" vs "Midcap Kotak" never
        # crosses houses, so a near-namesake from another AMC cannot be picked.
        words = sorted(k.split())
        house = k.split()[:1]
        best, score = None, 0.0
        for cand in keys:
            if cand.split()[:1] != house:
                continue
            r = difflib.SequenceMatcher(None, " ".join(words), " ".join(sorted(cand.split()))).ratio()
            if r > score:
                best, score = cand, r
        if best and score >= 0.90:
            out[n] = ours[best]
            continue
        guess = difflib.get_close_matches(k, keys, n=1, cutoff=0.0)
        unmatched.append({"name": n, "closest": guess[0] if guess else None,
                          "similarity": round(difflib.SequenceMatcher(None, k, guess[0]).ratio(), 2) if guess else 0.0,
                          "expected": bool(EXPECTED_UNMATCHED.search(n))})
    return out, unmatched


def match_codes(names: list[str]) -> dict[str, str]:
    """{common name: our scheme code} (see match_report)."""
    return match_report(names)[0]


# ── fetching ─────────────────────────────────────────────────────────────────

FAILURES: list[str] = []


def fetch_fund(name: str, year: int, month: int) -> list[dict]:
    # The API throttles bursts: a failed or empty-looking reply is retried with a
    # growing pause before the fund is taken to have no portfolio that month.
    import time
    rows = None
    for attempt in range(4):
        try:
            d = _post("getMutualfundHistoricalPortfolio", scheme_amfi_common=name,
                      year=year, month=MONTHS[month - 1])
            if d.get("status") == 200 or "historicalSchemePortfolioList" in d:
                rows = d.get("historicalSchemePortfolioList") or []
                if rows:
                    break
        except Exception as exc:
            log.debug("%s %d-%02d attempt %d failed (%s)", name, year, month, attempt + 1, exc)
        time.sleep(1.5 * (attempt + 1))
    if not rows:
        FAILURES.append(name)
        return []
    out = []
    for r in rows:
        pct = r.get("holdings")
        if pct is None:
            continue
        isin = (r.get("isin") or "").strip().upper()
        inst = (r.get("instrument") or "").strip()
        if not re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", isin):
            # Cash, TREPS, net receivables...: no ISIN, so key them by name.
            isin = "X-" + hashlib.md5(inst.lower().encode()).hexdigest()[:10]
        out.append({"isin": isin, "name": inst[:200], "asset_class": (r.get("asset_class") or "")[:40],
                    "sector": (r.get("sector") or "")[:80], "industry": (r.get("industry") or "")[:120],
                    "pct": round(float(pct) / 100, 6), "value": r.get("value")})
    # A fund can list the same security twice (two lines of one bond); merge them.
    merged: dict[str, dict] = {}
    for h in out:
        if h["isin"] in merged:
            merged[h["isin"]]["pct"] = round(merged[h["isin"]]["pct"] + h["pct"], 6)
        else:
            merged[h["isin"]] = h
    return list(merged.values())


def month_available(year: int, month: int) -> bool:
    return bool(fetch_fund(PROBE_FUND, year, month))


def newest_available() -> tuple[int, int] | None:
    t = date.today()
    y, m = t.year, t.month
    for _ in range(3):                     # this month, then the two before
        if month_available(y, m):
            return y, m
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return None


UNMATCHED: list[dict] = []


def fetch_month(year: int, month: int, workers: int = 3, only: set[str] | None = None) -> dict[str, list[dict]]:
    """{our scheme code: holdings} for every matched fund with data that month."""
    names = fund_names(only)
    codes, unmatched = match_report(list(names))
    log.info("Matched %d of %d funds to our fund list", len(codes), len(names))
    UNMATCHED[:] = [{**u, "category": names[u["name"]]} for u in unmatched]
    for u in UNMATCHED:
        how = "expected (closed-ended / segregated)" if u["expected"] else "NOT MATCHED"
        log.warning("  %s: %s [%s] — closest we have: %s (%.0f%% alike)", how, u["name"], u["category"],
                    u["closest"], u["similarity"] * 100)
        if not u["expected"]:
            print(f"::warning title=Holdings name not matched::{u['name']} ({u['category']}) — closest: {u['closest']}")
    with ThreadPoolExecutor(workers) as ex:
        results = dict(zip(codes, ex.map(lambda n: fetch_fund(n, year, month), codes)))
    out = {codes[n]: rows for n, rows in results.items() if rows}
    log.info("%d-%02d: holdings for %d funds (%d rows); %d with none after retries",
             year, month, len(out), sum(len(v) for v in out.values()), len(codes) - len(out))
    return out


# ── storing ──────────────────────────────────────────────────────────────────

def store(year: int, month: int, holdings: dict[str, list[dict]], latest: bool = True) -> None:
    """History file always; the portfolio_holdings table only when `latest`."""
    from scripts import neon_store as db
    from scripts.portfolios import SCHEMA
    ym = f"{year}-{month:02d}"
    # Add to the month's file rather than replace it, so fetching some categories never drops the others.
    merged = {**(_read_blob(ym) or {}), **holdings}
    blob = gzip.compress(json.dumps({"month": ym, "funds": merged}, separators=(",", ":")).encode())
    _upload_blob(blob, ym)
    log.info("Stored the %s history file (%.1f MB compressed)", ym, len(blob) / 1e6)
    if not latest:
        return
    import psycopg
    first = date(year, month, 1)
    with psycopg.connect(db.DSN) as conn:
        conn.execute(SCHEMA)
        conn.execute("ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS asset_class text")
        conn.execute("ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS sector text")
        codes = [int(c) for c in holdings]
        # Only the latest month is kept in the table: older months live in the files.
        conn.execute("DELETE FROM portfolio_holdings WHERE scheme_code = ANY(%s)", (codes,))
        with conn.cursor() as cur:
            with cur.copy("COPY portfolio_holdings (scheme_code, month, isin, name, industry, pct, asset_class, sector) "
                          "FROM STDIN") as cp:
                for code, rows in holdings.items():
                    for h in rows:
                        cp.write_row((int(code), first, h["isin"], h["name"], h["industry"], h["pct"],
                                      h["asset_class"], h["sector"]))
    log.info("portfolio_holdings: %d funds now at %s", len(holdings), ym)


def _upload_blob(blob: bytes, ym: str) -> None:
    import psycopg
    from scripts import neon_store as db
    with psycopg.connect(db.DSN) as conn:
        conn.execute("""INSERT INTO files (bucket, path, body, content_type, cache_control, updated_at)
                        VALUES (%s, %s, %s, 'application/gzip', 'no-store', now())
                        ON CONFLICT (bucket, path) DO UPDATE SET body = EXCLUDED.body, updated_at = now()""",
                     (HOLDINGS_BUCKET, f"{ym}.json.gz", blob))


def _read_blob(ym: str) -> dict | None:
    """The funds already stored for a month, or None."""
    import psycopg
    from scripts import neon_store as db
    with psycopg.connect(db.DSN) as conn:
        r = conn.execute("SELECT body FROM files WHERE bucket=%s AND path=%s", (HOLDINGS_BUCKET, f"{ym}.json.gz")).fetchone()
    if not r:
        return None
    return json.loads(gzip.decompress(bytes(r[0]))).get("funds") or {}


def save_unmatched(ym: str) -> None:
    """The names no fund was found for, for the data health check (Holdings/unmatched.json)."""
    import psycopg
    from scripts import neon_store as db
    body = json.dumps({"month": ym, "checked": date.today().isoformat(), "unmatched": UNMATCHED}, ensure_ascii=False).encode()
    with psycopg.connect(db.DSN) as conn:
        conn.execute("""INSERT INTO files (bucket, path, body, content_type, cache_control, updated_at)
                        VALUES (%s, 'unmatched.json', %s, 'application/json', 'no-store', now())
                        ON CONFLICT (bucket, path) DO UPDATE SET body = EXCLUDED.body, updated_at = now()""",
                     (HOLDINGS_BUCKET, body))


def stored_month() -> str | None:
    """Newest month held in the history files, 'YYYY-MM'."""
    import psycopg
    from scripts import neon_store as db
    with psycopg.connect(db.DSN) as conn:
        r = conn.execute("SELECT max(path) FROM files WHERE bucket=%s AND path ~ '^[0-9]{4}-[0-9]{2}'", (HOLDINGS_BUCKET,)).fetchone()
    return r[0][:7] if r and r[0] else None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="YYYY-MM (default: the newest available)")
    ap.add_argument("--backfill", type=int, default=0, help="also store this many earlier months (history files only)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--categories", help="comma-separated Advisorkhoj categories to fetch (added to the stored month)")
    ap.add_argument("--names", action="store_true", help="match report only: which fund names find no fund")
    a = ap.parse_args()
    only = {c.strip() for c in a.categories.split(",")} if a.categories else None

    if a.names:
        names = fund_names(only)
        codes, unmatched = match_report(list(names))
        log.info("Matched %d of %d", len(codes), len(names))
        for u in unmatched:
            log.info("  %s %s [%s] — closest: %s (%.0f%%)", "expected" if u["expected"] else "NOT MATCHED",
                     u["name"], names[u["name"]], u["closest"], u["similarity"] * 100)
        return 0

    if a.month:
        y, m = (int(x) for x in a.month.split("-"))
    else:
        newest = newest_available()
        if not newest:
            log.warning("No recent month available from Advisorkhoj")
            return 0
        y, m = newest
        if not a.backfill and not a.dry_run and not only and stored_month() == f"{y}-{m:02d}":
            log.info("%d-%02d already stored — nothing to do", y, m)
            return 0
    data = fetch_month(y, m, only=only)
    if not a.dry_run and data:
        store(y, m, data, latest=True)
        save_unmatched(f"{y}-{m:02d}")
    yy, mm = y, m
    for _ in range(a.backfill):
        yy, mm = (yy, mm - 1) if mm > 1 else (yy - 1, 12)
        hist = fetch_month(yy, mm)
        if hist and not a.dry_run:
            store(yy, mm, hist, latest=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())

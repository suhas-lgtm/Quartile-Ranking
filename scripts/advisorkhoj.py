"""
advisorkhoj.py — monthly fund portfolios from the Advisorkhoj research API (paid).

    getAllSchemesCommonNamesbyCategory   fund names per category
    getMutualfundHistoricalPortfolio     one fund's holdings for one month
                                         (instrument, ISIN, asset class, sector,
                                         industry, value, % of net assets)

Every Equity and Hybrid fund is covered EXCEPT Balanced Advantage (Dynamic Asset
Allocation) and Multi Asset Allocation, whose data the team found unreliable.
The API returns about 14 months; a new month appears around the 10th.

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
EXCLUDED_CATEGORIES = {"Hybrid: Dynamic Asset Allocation", "Hybrid: Multi Asset Allocation"}
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


def fund_names() -> dict[str, str]:
    """{common name: Advisorkhoj category} for every covered Equity/Hybrid fund."""
    cats = _post("getAllSchemeCategories").get("list") or []
    out = {}
    for c in cats:
        if not c.startswith(("Equity", "Hybrid")) or c in EXCLUDED_CATEGORIES:
            continue
        for n in _post("getAllSchemesCommonNamesbyCategory", category=c).get("list") or []:
            out[n] = c
    log.info("Advisorkhoj: %d Equity/Hybrid funds (Balanced Advantage and Multi Asset excluded)", len(out))
    return out


# ── matching to our catalogue ─────────────────────────────────────────────────

def _norm(n: str) -> str:
    n = (n or "").lower().replace("&", " and ").replace("aditya birla sun life", "absl").replace("owsal", "oswal")
    n = re.sub(r"\(.*?\)|\btax saver\b|\b(fund|scheme|the|plan|regular|growth|direct|option)\b", " ", n)
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def match_codes(names: list[str]) -> dict[str, str]:
    """{common name: our scheme code}. Exact normalised name, else a very close one."""
    cat = json.load(open(CATALOGUE_PATH, encoding="utf-8"))["schemes"]
    ours = {}
    for s in cat:
        ours.setdefault(_norm(s["scheme_name"]), str(s["scheme_code"]))
    keys = list(ours)
    out = {}
    for n in names:
        k = _norm(n)
        if k in ours:
            out[n] = ours[k]
            continue
        close = difflib.get_close_matches(k, keys, n=1, cutoff=0.93)
        if close:
            out[n] = ours[close[0]]
    return out


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


def fetch_month(year: int, month: int, workers: int = 3) -> dict[str, list[dict]]:
    """{our scheme code: holdings} for every matched fund with data that month."""
    names = fund_names()
    codes = match_codes(list(names))
    log.info("Matched %d of %d funds to our fund list", len(codes), len(names))
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
    blob = gzip.compress(json.dumps({"month": ym, "funds": holdings}, separators=(",", ":")).encode())
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


def stored_month() -> str | None:
    """Newest month held in the history files, 'YYYY-MM'."""
    import psycopg
    from scripts import neon_store as db
    with psycopg.connect(db.DSN) as conn:
        r = conn.execute("SELECT max(path) FROM files WHERE bucket=%s", (HOLDINGS_BUCKET,)).fetchone()
    return r[0][:7] if r and r[0] else None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="YYYY-MM (default: the newest available)")
    ap.add_argument("--backfill", type=int, default=0, help="also store this many earlier months (history files only)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.month:
        y, m = (int(x) for x in a.month.split("-"))
    else:
        newest = newest_available()
        if not newest:
            log.warning("No recent month available from Advisorkhoj")
            return 0
        y, m = newest
        if not a.backfill and not a.dry_run and stored_month() == f"{y}-{m:02d}":
            log.info("%d-%02d already stored — nothing to do", y, m)
            return 0
    data = fetch_month(y, m)
    if not a.dry_run and data:
        store(y, m, data, latest=True)
    yy, mm = y, m
    for _ in range(a.backfill):
        yy, mm = (yy, mm - 1) if mm > 1 else (yy - 1, 12)
        hist = fetch_month(yy, mm)
        if hist and not a.dry_run:
            store(yy, mm, hist, latest=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())

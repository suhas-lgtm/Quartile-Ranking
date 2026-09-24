"""
portfolios.py — monthly scheme portfolios (AMC disclosures) -> Neon -> Active Share.

SEBI requires every AMC to publish each scheme's full holdings monthly, as an
Excel workbook with the same columns (Name of the Instrument, ISIN, Industry,
Quantity, Market Value, % to Net Assets). There is no consolidated source —
AMFI only links to each AMC's own page — so this module:

  1. parses ANY such workbook generically (finds the ISIN and "% to" columns,
     one sheet per scheme, fund name in the rows above the header);
  2. matches each sheet to a scheme in data/scheme_catalogue.json by name,
     within the AMC, with data/portfolio_scheme_map.json for manual overrides;
  3. stores the equity holdings in Neon (portfolio_holdings);
  4. computes Active Share the way the team sheet does: the number of stocks
     held that are NOT in the reference index (NIFTY 50), plus their weight.

Files come from automatic downloaders (FETCHERS, one per AMC as they are added)
or from a folder the team drops monthly files into.

Usage:
  python scripts/portfolios.py ingest FILE_OR_FOLDER --amc "PPFAS" --month 2026-08
  python scripts/portfolios.py fetch --month 2026-08            # all automated AMCs
  python scripts/portfolios.py status
"""

from __future__ import annotations

import argparse
import csv
import difflib
import io
import json
import logging
import os
import re
import sys
from datetime import date

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

log = logging.getLogger("portfolios")

CATALOGUE_PATH = os.path.join(ROOT_DIR, "data", "scheme_catalogue.json")
SCHEME_MAP_PATH = os.path.join(ROOT_DIR, "data", "portfolio_scheme_map.json")
NIFTY50_PATH = os.path.join(ROOT_DIR, "data", "nifty50_constituents.csv")
NIFTY50_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
# Section headings that end the equity block of a disclosure.
NON_EQUITY = re.compile(
    r"debt|money market|government|treasury|t-bill|reverse repo|treps|tri-party|"
    r"certificate of deposit|commercial paper|mutual fund units|units of|reit|invit|"
    r"derivative|future|option|net current|cash|margin|fixed deposit|others?\b",
    re.I)
EQUITY_HEAD = re.compile(r"equity", re.I)

SCHEMA = """
CREATE TABLE IF NOT EXISTS portfolio_holdings (
    scheme_code  integer NOT NULL,
    month        date    NOT NULL,     -- first day of the disclosure month
    isin         text    NOT NULL,
    name         text,
    industry     text,
    pct          double precision,     -- fraction of net assets, 0.0763 = 7.63%
    PRIMARY KEY (scheme_code, month, isin)
);
"""


# ── parsing ─────────────────────────────────────────────────────────────────

def _cell(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() == "nan" else s


def _pct(v) -> float | None:
    """'% to NAV' cell -> fraction. AMCs write 0.0763, 7.63 or '7.63%'."""
    s = _cell(v).replace("%", "").replace(",", "")
    try:
        x = float(s)
    except ValueError:
        return None
    return x


def parse_sheet(rows: list[list]) -> dict | None:
    """
    One disclosure sheet -> {title, holdings: [{isin, name, industry, pct}]}.

    None when the sheet has no ISIN / "% to" header (index sheets, notes).
    """
    header_i = isin_c = pct_c = None
    for i, row in enumerate(rows[:40]):
        cells = [_cell(v).lower() for v in row]
        if any(c == "isin" or c.startswith("isin") for c in cells):
            for j, c in enumerate(cells):
                if isin_c is None and c.startswith("isin"):
                    isin_c = j
                if pct_c is None and ("% to" in c or "% of" in c or "to nav" in c
                                      or "net assets" in c or "to net" in c):
                    pct_c = j
            header_i = i
            break
    if header_i is None or isin_c is None or pct_c is None:
        return None

    header = [_cell(v).lower() for v in rows[header_i]]
    name_c = next((j for j, c in enumerate(header) if "instrument" in c or "name" in c or "issuer" in c),
                  max(isin_c - 1, 0))
    ind_c = next((j for j, c in enumerate(header) if "industry" in c or "rating" in c), None)

    # Title: the longest text in the rows above the header that looks like a
    # fund name (skips "Monthly Portfolio Statement", dates and AMC boilerplate).
    title = ""
    for row in rows[:header_i]:
        for v in row:
            t = _cell(v)
            if (len(t) > len(title) and re.search(r"fund|plan|scheme|etf", t, re.I)
                    and not re.search(r"portfolio statement|as on|mutual fund$", t, re.I)):
                title = t
    title = re.sub(r"\s+", " ", title)

    holdings, in_equity, seen_section = [], False, False
    for row in rows[header_i + 1:]:
        isin = _cell(row[isin_c]).upper() if isin_c < len(row) else ""
        text = " ".join(_cell(v) for v in row if _cell(v))
        if not ISIN_RE.match(isin):
            # A heading row: decides whether the rows under it are equity.
            if text:
                if EQUITY_HEAD.search(text) and not NON_EQUITY.search(text):
                    in_equity, seen_section = True, True
                elif NON_EQUITY.search(text) or re.search(r"^total|grand total", text, re.I):
                    if NON_EQUITY.search(text):
                        in_equity, seen_section = False, True
            continue
        pct = _pct(row[pct_c]) if pct_c < len(row) else None
        # Without section headings at all, fall back to the ISIN: an Indian
        # equity share has security type 01 (INE040A01034); debt is 07/08.
        is_equity = in_equity if seen_section else (isin.startswith("INE") and isin[7:9] == "01")
        if not is_equity or pct is None:
            continue
        holdings.append({
            "isin": isin,
            "name": _cell(row[name_c]) if name_c < len(row) else "",
            "industry": _cell(row[ind_c]) if ind_c is not None and ind_c < len(row) else "",
            "pct": pct,
        })

    if not holdings:
        return {"title": title, "holdings": []}
    # One scale per sheet: if the weights sum to ~100 they are percentages.
    total = sum(h["pct"] for h in holdings)
    if total > 2.5:
        for h in holdings:
            h["pct"] = h["pct"] / 100
    # Same stock listed twice (e.g. locked-in shares) counts once.
    merged: dict[str, dict] = {}
    for h in holdings:
        if h["isin"] in merged:
            merged[h["isin"]]["pct"] += h["pct"]
        else:
            merged[h["isin"]] = dict(h)
    return {"title": title, "holdings": list(merged.values())}


def parse_workbook(path: str) -> list[dict]:
    """Every scheme sheet in an AMC workbook (.xlsx or .xls)."""
    import pandas as pd

    sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=object)
    out = []
    for sheet_name, df in sheets.items():
        parsed = parse_sheet(df.values.tolist())
        if parsed is None:
            continue
        parsed["sheet"] = str(sheet_name)
        parsed["title"] = parsed["title"] or str(sheet_name)
        out.append(parsed)
    return out


# ── matching sheets to schemes ──────────────────────────────────────────────

_NOISE = re.compile(
    r"\b(regular|direct|plan|growth|option|idcw|dividend|payout|reinvest(ment)?|fund|"
    r"scheme|an open[- ]ended.*|the|of|mutual)\b", re.I)


def _norm(name: str) -> str:
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = s.replace("&", " and ")
    s = _NOISE.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_catalogue() -> list[dict]:
    with open(CATALOGUE_PATH, encoding="utf-8") as fh:
        return json.load(fh)["schemes"]


def load_scheme_map() -> dict:
    try:
        with open(SCHEME_MAP_PATH, encoding="utf-8") as fh:
            return json.load(fh).get("map", {})
    except (OSError, ValueError):
        return {}


def match_scheme(title: str, amc: str, catalogue: list[dict], overrides: dict) -> tuple[str | None, float]:
    """
    (scheme_code, similarity) for a sheet title, searching only the AMC's
    schemes. Overrides are keyed "AMC|sheet title" -> scheme_code (or null to
    skip a sheet on purpose).
    """
    key = f"{amc}|{title}"
    if key in overrides:
        return (str(overrides[key]) if overrides[key] else None), 1.0
    amc_n = _norm(amc)
    pool = [s for s in catalogue
            if amc_n and amc_n.split()[0] in _norm(s.get("amc_name") or "")] or catalogue
    t = _norm(title)
    best, best_score = None, 0.0
    for s in pool:
        score = difflib.SequenceMatcher(None, t, _norm(s["scheme_name"])).ratio()
        if score > best_score:
            best, best_score = s, score
    if best is None or best_score < 0.82:
        return None, best_score
    return str(best["scheme_code"]), best_score


# ── reference index ─────────────────────────────────────────────────────────

def nifty50_isins(refresh: bool = True) -> set[str]:
    """
    NIFTY 50 constituent ISINs. Refreshed from niftyindices.com when reachable
    (the index is rebalanced twice a year); the committed copy is the fallback.
    """
    if refresh:
        try:
            r = requests.get(NIFTY50_URL, headers=UA, timeout=30)
            if r.status_code == 200 and "ISIN" in r.text[:200]:
                rows = list(csv.DictReader(io.StringIO(r.text)))
                if len(rows) >= 45:
                    with open(NIFTY50_PATH, "w", encoding="utf-8", newline="") as fh:
                        fh.write(r.text)
        except requests.RequestException as exc:
            log.warning("NIFTY 50 list refresh failed (%s); using the committed copy", exc)
    with open(NIFTY50_PATH, encoding="utf-8") as fh:
        return {row["ISIN Code"].strip() for row in csv.DictReader(fh)}


def active_share_stats(holdings: list[dict], reference: set[str]) -> dict:
    """The team sheet's "uncommon stocks": equity holdings outside the index."""
    uncommon = [h for h in holdings if h["isin"] not in reference]
    return {
        "uncommon_count": len(uncommon),
        "uncommon_weight": round(sum(h["pct"] or 0 for h in uncommon), 6),
        "stocks": len(holdings),
    }


# ── Neon ────────────────────────────────────────────────────────────────────

def _month_start(month: str) -> date:
    y, m = month.split("-")[:2]
    return date(int(y), int(m), 1)


def store(conn, scheme_code: str, month: str, holdings: list[dict]) -> int:
    """Replace one scheme's month. COPY keeps it to a round trip or two."""
    m = _month_start(month)
    conn.execute("DELETE FROM portfolio_holdings WHERE scheme_code=%s AND month=%s",
                 (int(scheme_code), m))
    with conn.cursor() as cur:
        with cur.copy("COPY portfolio_holdings (scheme_code, month, isin, name, industry, pct) "
                      "FROM STDIN") as cp:
            for h in holdings:
                cp.write_row((int(scheme_code), m, h["isin"], h["name"][:200],
                              h["industry"][:120], h["pct"]))
    return len(holdings)


def latest_holdings(codes: list[str]) -> dict[str, dict]:
    """{scheme_code: {month, holdings}} — each fund's most recent month in Neon."""
    from scripts import neon_store as db

    if not db.enabled() or not codes:
        return {}
    with db.connect() as conn:
        conn.execute(SCHEMA)
        rows = conn.execute("""
            SELECT h.scheme_code, h.month, h.isin, h.pct
            FROM portfolio_holdings h
            JOIN (SELECT scheme_code, MAX(month) AS month FROM portfolio_holdings
                  WHERE scheme_code = ANY(%s) GROUP BY scheme_code) l
              ON l.scheme_code = h.scheme_code AND l.month = h.month
        """, ([int(c) for c in codes],)).fetchall()
    out: dict[str, dict] = {}
    for code, month, isin, pct in rows:
        e = out.setdefault(str(code), {"month": month.strftime("%Y-%m"), "holdings": []})
        e["holdings"].append({"isin": isin, "pct": pct})
    return out


# ── ingest ──────────────────────────────────────────────────────────────────

def ingest_file(path: str, amc: str, month: str, catalogue: list[dict],
                overrides: dict, dry_run: bool = False) -> dict:
    from contextlib import nullcontext
    from scripts import neon_store as db

    stats = {"sheets": 0, "matched": 0, "stored": 0, "unmatched": []}
    sheets = parse_workbook(path)
    with (nullcontext() if dry_run else db.connect()) as conn:
        if conn is not None:
            conn.execute(SCHEMA)
        _ingest_sheets(conn, sheets, amc, month, catalogue, overrides, dry_run, stats)
    return stats


def _ingest_sheets(conn, sheets, amc, month, catalogue, overrides, dry_run, stats):
    for sheet in sheets:
        if not sheet["holdings"]:
            continue    # debt/liquid schemes: no equity to count
        stats["sheets"] += 1
        code, score = match_scheme(sheet["title"], amc, catalogue, overrides)
        if code is None:
            stats["unmatched"].append(f"{sheet['title']} (best {score:.2f})")
            continue
        stats["matched"] += 1
        if not dry_run:
            stats["stored"] += store(conn, code, month, sheet["holdings"])
        log.info("  %-55s -> %s (%.2f, %d stocks)", sheet["title"][:55], code, score,
                 len(sheet["holdings"]))


def ingest_path(target: str, amc: str, month: str, dry_run: bool = False) -> int:
    catalogue, overrides = load_catalogue(), load_scheme_map()
    files = ([os.path.join(target, f) for f in sorted(os.listdir(target))
              if f.lower().endswith((".xls", ".xlsx"))] if os.path.isdir(target) else [target])
    total = {"sheets": 0, "matched": 0, "stored": 0, "unmatched": []}
    for f in files:
        log.info("%s", os.path.basename(f))
        s = ingest_file(f, amc, month, catalogue, overrides, dry_run)
        for k in ("sheets", "matched", "stored"):
            total[k] += s[k]
        total["unmatched"] += s["unmatched"]
    log.info("%s %s: %d equity sheets, %d matched, %d holdings stored",
             amc, month, total["sheets"], total["matched"], total["stored"])
    for u in total["unmatched"]:
        log.warning("  unmatched: %s  (add it to data/portfolio_scheme_map.json)", u)
    return 0


# ── automatic downloaders ───────────────────────────────────────────────────

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def fetch_ppfas(month: str, dest: str) -> list[str]:
    """PPFAS: one workbook per scheme, linked from a static page."""
    y, m = (int(x) for x in month.split("-"))
    page = requests.get("https://amc.ppfas.com/downloads/portfolio-disclosure/",
                        headers=UA, timeout=60).text
    pat = re.compile(rf'href="([^"]*/{y}/[^"]*_{MONTH_NAMES[m - 1]}_\d+_{y}\.xlsx?[^"]*)"', re.I)
    files = []
    for href in sorted(set(pat.findall(page))):
        url = href if href.startswith("http") else "https://amc.ppfas.com" + href
        name = os.path.join(dest, os.path.basename(url.split("?")[0]))
        r = requests.get(url, headers=UA, timeout=120)
        if r.status_code == 200:
            with open(name, "wb") as fh:
                fh.write(r.content)
            files.append(name)
    return files


def _save(url: str, dest: str) -> str | None:
    r = requests.get(url, headers=UA, timeout=180)
    if r.status_code != 200 or len(r.content) < 1000:
        return None
    path = os.path.join(dest, os.path.basename(url.split("?")[0]))
    with open(path, "wb") as fh:
        fh.write(r.content)
    return path


def _unzip_excels(path: str, dest: str) -> list[str]:
    import zipfile

    out = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.lower().endswith((".xls", ".xlsx")) and not n.startswith("__MACOSX"):
                target = os.path.join(dest, os.path.basename(n))
                with z.open(n) as src, open(target, "wb") as fh:
                    fh.write(src.read())
                out.append(target)
    return out


def _links(page_url: str, pattern: str) -> list[str]:
    html = requests.get(page_url, headers=UA, timeout=60).text
    base = re.match(r"https?://[^/]+", page_url).group(0)
    found = []
    for href in re.findall(r'href="([^"]+)"', html):
        if re.search(pattern, href, re.I):
            found.append(href if href.startswith("http") else base + href)
    return sorted(set(found))


def fetch_nippon(month: str, dest: str) -> list[str]:
    """Nippon India: one workbook, e.g. NIMF-MONTHLY-PORTFOLIO-31-Aug-26.xls."""
    y, m = (int(x) for x in month.split("-"))
    mon = MONTH_NAMES[m - 1]
    pat = rf"NIMF-MONTHLY-PORTFOLIO-\d+-({mon[:3]}|{mon})[a-z]*-{y % 100:02d}\.xlsx?"
    urls = _links("https://mf.nipponindiaim.com/investor-service/downloads/"
                  "factsheet-portfolio-and-other-disclosures", pat)
    return [p for p in (_save(u, dest) for u in urls) if p]


def fetch_dsp(month: str, dest: str) -> list[str]:
    """DSP: a zip of workbooks, dsp-monthend-portfolio-as-on-31-aug-2026.zip."""
    y, m = (int(x) for x in month.split("-"))
    pat = rf"dsp-monthend-portfolio-as-on-\d+-{MONTH_NAMES[m - 1][:3]}-{y}\.(zip|xlsx?)"
    files = []
    for u in _links("https://www.dspim.com/mandatory-disclosures/portfolio-disclosures", pat):
        p = _save(u, dest)
        if p and p.lower().endswith(".zip"):
            files += _unzip_excels(p, dest)
            os.remove(p)
        elif p:
            files.append(p)
    return files


# AMC name as it appears in the catalogue -> downloader. Grows one AMC at a time.
FETCHERS = {
    "PPFAS": fetch_ppfas,
    "Nippon India": fetch_nippon,
    "DSP": fetch_dsp,
}


def fetch_all(month: str, only: list[str] | None = None) -> int:
    import tempfile

    for amc, fn in FETCHERS.items():
        if only and amc not in only:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                files = fn(month, tmp)
            except Exception as exc:
                log.error("%s: download failed (%s)", amc, exc)
                continue
            if not files:
                log.warning("%s: no %s files found (not published yet?)", amc, month)
                continue
            ingest_path(tmp, amc, month)
    return 0


def status() -> int:
    from scripts import neon_store as db

    with db.connect() as conn:
        conn.execute(SCHEMA)
        rows = conn.execute("""
            SELECT to_char(month,'YYYY-MM'), COUNT(DISTINCT scheme_code), COUNT(*)
            FROM portfolio_holdings GROUP BY month ORDER BY month DESC LIMIT 12""").fetchall()
    for m, schemes, n in rows:
        log.info("%s  %4d schemes  %6d holdings", m, schemes, n)
    if not rows:
        log.info("no portfolio holdings stored yet")
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser(description="Scheme portfolios -> Neon")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ingest", help="parse AMC workbook(s) and store them")
    a.add_argument("path")
    a.add_argument("--amc", required=True, help='AMC as in the catalogue, e.g. "PPFAS"')
    a.add_argument("--month", required=True, help="disclosure month, YYYY-MM")
    a.add_argument("--dry-run", action="store_true")
    f = sub.add_parser("fetch", help="download and store for the automated AMCs")
    f.add_argument("--month", required=True)
    f.add_argument("--amc", action="append")
    sub.add_parser("status")
    args = ap.parse_args()
    if args.cmd == "ingest":
        return ingest_path(args.path, args.amc, args.month, args.dry_run)
    if args.cmd == "fetch":
        return fetch_all(args.month, args.amc)
    return status()


if __name__ == "__main__":
    sys.exit(main())

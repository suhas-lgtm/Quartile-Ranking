"""
amfi_facts.py — expense ratio (TER) and AUM for every fund, from AMFI.

    TER  AMFI's monthly "TER of MF schemes" workbook (one Excel for all schemes,
         a row per scheme per day the TER changed). The latest row per scheme
         gives the Regular and Direct plan total TER. Rows carry no AMFI scheme
         code, so they are matched to the catalogue by scheme name.
    AUM  AMFI's quarterly average AUM, scheme-wise. Each plan and option has its
         own AMFI code; a fund's AUM is the sum over all its plans (Regular +
         Direct, Growth + IDCW), found by stripping the plan/option suffix.
         AMFI reports lakhs; stored in crores.

Both calls are best-effort: any failure returns {} and the build carries on
without these columns.

Usage:
  python scripts/amfi_facts.py          # fetch and print a summary
"""

from __future__ import annotations

import difflib
import io
import json
import logging
import os
import re
import sys

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

log = logging.getLogger("amfi_facts")

BASE = "https://www.amfiindia.com/api"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
CATALOGUE_PATH = os.path.join(ROOT_DIR, "data", "scheme_catalogue.json")


def _norm(name: str) -> str:
    s = re.sub(r"\(.*?\)", " ", name.lower()).replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(fund|scheme|the|plan)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _financial_year_strings() -> list[str]:
    """This and last financial year as AMFI writes them, e.g. '2026-2027'."""
    from datetime import date
    t = date.today()
    y = t.year if t.month >= 4 else t.year - 1
    return [f"{y}-{y + 1}", f"{y - 1}-{y}"]


def fetch_ter() -> dict[str, dict]:
    """{normalized scheme name: {regular, direct, date, name}} from the latest month."""
    month = None
    for fy in _financial_year_strings():
        r = requests.get(f"{BASE}/populate-ter-month", params={"year": fy}, headers=UA, timeout=60)
        months = r.json() if r.ok else []
        if months:
            month = months[0]["MonthNumber"]          # newest first, e.g. "09-2026"
            break
    if not month:
        log.warning("TER: no month list from AMFI")
        return {}
    import pandas as pd
    for m in _candidate_months(month):
        r = requests.get(f"{BASE}/populate-te-rdata-revised", headers=UA, timeout=300,
                         params={"MF_ID": "All", "Month": m, "strCat": "-1", "strType": "-1", "excel": "true"})
        if not r.ok or len(r.content) < 10_000:
            continue
        df = pd.read_excel(io.BytesIO(r.content))
        if df.empty:
            continue
        # AMFI also lists changes announced for later dates; keep what is in force today.
        df["TER Date"] = pd.to_datetime(df["TER Date"], errors="coerce")
        df = df[df["TER Date"] <= pd.Timestamp.today().normalize()]
        df = df.sort_values("TER Date").groupby("Scheme Name", as_index=False).last()
        out = {}
        for _, row in df.iterrows():
            out[_norm(str(row["Scheme Name"]))] = {
                "name": str(row["Scheme Name"]),
                "regular": _num(row.get("Regular Plan - Total TER (%)")),
                "direct": _num(row.get("Direct Plan - Total TER (%)")),
                # Base Expense Ratio: the fee alone, before brokerage, trading
                # costs and statutory levies (what factsheets used to quote).
                "regular_base": _num(row.get("Regular Plan - Base Expense Ratio (BER) (%)")),
                "date": str(row["TER Date"])[:10],
            }
        log.info("TER: %d schemes, month %s", len(out), m)
        return out
    log.warning("TER: no usable workbook")
    return {}


def _candidate_months(latest: str) -> list[str]:
    """The newest month, then the one before (early in a month it can be empty)."""
    mm, yy = (int(x) for x in latest.split("-"))
    prev = f"{12 if mm == 1 else mm - 1:02d}-{yy - 1 if mm == 1 else yy}"
    return [latest, prev]


def _num(v) -> float | None:
    try:
        x = float(v)
        return x if x == x else None       # NaN -> None
    except (TypeError, ValueError):
        return None


_PLAN_SUFFIX = re.compile(r"\s*-\s*(direct|regular|retail|institutional)\b.*$", re.I)


def fetch_aum() -> tuple[dict[str, float], str | None]:
    """({AMFI scheme code: fund AUM in crores, all plans}, period label)."""
    r = requests.get(f"{BASE}/average-aum-schemewise", headers=UA, timeout=60,
                     params={"strType": "Categorywise", "MF_ID": 0})
    years = (r.json().get("data") or []) if r.ok else []
    for fy in years[:2]:                         # latest financial year, then the previous
        r = requests.get(f"{BASE}/average-aum-schemewise", headers=UA, timeout=60,
                         params={"fyId": fy["id"], "strType": "Categorywise", "MF_ID": 0})
        periods = ((r.json().get("data") or {}).get("periods") or []) if r.ok else []
        if not periods:
            continue
        period = max(periods, key=lambda p: p["id"])
        r = requests.get(f"{BASE}/average-aum-schemewise", headers=UA, timeout=180,
                         params={"strType": "Categorywise", "fyId": fy["id"], "periodId": period["id"], "MF_ID": 0})
        groups = (r.json().get("data") or []) if r.ok else []
        if not groups:
            continue
        totals: dict[tuple, float] = {}
        code_key: dict[str, tuple] = {}
        for g in groups:
            for s in g.get("schemes") or []:
                a = s.get("AverageAumForTheMonth") or {}
                lakhs = sum(v for v in a.values() if isinstance(v, (int, float)))
                key = (g.get("Mfname"), _PLAN_SUFFIX.sub("", s.get("SchemeNAVName") or "").strip().lower())
                totals[key] = totals.get(key, 0.0) + lakhs
                code_key[str(s.get("AMFI_Code"))] = key
        out = {code: round(totals[key] / 100, 2) for code, key in code_key.items()}
        label = f"{period['period']} ({fy['financial_year']})"
        log.info("AUM: %d plan codes, period %s", len(out), label)
        return out, label
    log.warning("AUM: no usable data from AMFI")
    return {}, None


def facts_for_catalogue() -> dict[str, dict]:
    """
    {scheme_code: {ter_regular, ter_direct, ter_date, aum_cr, aum_period}} for
    every catalogue fund found. Best-effort: {} on any failure.
    """
    try:
        with open(CATALOGUE_PATH, encoding="utf-8") as fh:
            schemes = json.load(fh)["schemes"]
    except (OSError, ValueError):
        return {}
    try:
        ter = fetch_ter()
    except Exception as exc:
        log.warning("TER unavailable (%s)", exc)
        ter = {}
    try:
        aum, aum_period = fetch_aum()
    except Exception as exc:
        log.warning("AUM unavailable (%s)", exc)
        aum, aum_period = {}, None

    ter_keys = list(ter)
    out: dict[str, dict] = {}
    matched = 0
    for s in schemes:
        code = str(s["scheme_code"])
        rec: dict = {}
        key = _norm(s["scheme_name"])
        hit = ter.get(key)
        if hit is None and ter_keys:
            close = difflib.get_close_matches(key, ter_keys, n=1, cutoff=0.92)
            hit = ter.get(close[0]) if close else None
        if hit:
            matched += 1
            rec.update(ter_regular=hit["regular"], ter_direct=hit["direct"],
                       ter_base=hit["regular_base"], ter_date=hit["date"])
        if code in aum:
            rec.update(aum_cr=aum[code], aum_period=aum_period)
        if rec:
            out[code] = rec
    log.info("Facts: TER matched for %d of %d funds, AUM for %d", matched, len(schemes),
             sum(1 for v in out.values() if "aum_cr" in v))
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    f = facts_for_catalogue()
    for code in ["122640", "108466", "103174"]:
        print(code, f.get(code))

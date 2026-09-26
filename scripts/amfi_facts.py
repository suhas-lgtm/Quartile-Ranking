"""
amfi_facts.py — fund AUM, now and over the last quarters, from AMFI.

AMFI's quarterly average AUM, scheme-wise. Each plan and option has its own
AMFI code; a fund's AUM is the sum over all its plans (Regular + Direct,
Growth + IDCW), found by stripping the plan/option suffix. AMFI reports lakhs;
stored in crores.

AMFI lists financial years newest first and, inside a year, quarters newest
first too (periodId 1 = the latest quarter of that year).

Best-effort: any failure returns {} and the build carries on without AUM.

Usage:
  python scripts/amfi_facts.py          # fetch and print a summary
"""

from __future__ import annotations

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

log = logging.getLogger("amfi_facts")

BASE = "https://www.amfiindia.com/api"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
CATALOGUE_PATH = os.path.join(ROOT_DIR, "data", "scheme_catalogue.json")
QUARTERS = 12

_PLAN_SUFFIX = re.compile(r"\s*-\s*(direct|regular|retail|institutional)\b.*$", re.I)
_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}


def quarter_mid(label: str) -> str | None:
    """'April - June 2026' -> '2026-05-15': the 15th of the quarter's middle month."""
    m = re.match(r"\s*([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})", label)
    first = _MONTHS.get(m[1].lower()) if m else None
    if not first:
        return None
    # April -> May, October -> November. AMFI quarters never span a year end,
    # so the label's year is the middle month's year.
    return date(int(m[3]), first + 1, 15).isoformat()


def _get(params: dict, timeout: int = 60):
    r = requests.get(f"{BASE}/average-aum-schemewise", headers=UA, timeout=timeout, params=params)
    r.raise_for_status()
    return r.json().get("data")


def _quarter_aum(fy_id, period_id) -> dict[str, float]:
    """{AMFI plan code: fund AUM in crores (all plans of the fund)} for one quarter."""
    groups = _get({"strType": "Categorywise", "fyId": fy_id, "periodId": period_id, "MF_ID": 0}, 180) or []
    totals: dict[tuple, float] = {}
    code_key: dict[str, tuple] = {}
    for g in groups:
        for s in g.get("schemes") or []:
            a = s.get("AverageAumForTheMonth") or {}
            lakhs = sum(v for v in a.values() if isinstance(v, (int, float)))
            key = (g.get("Mfname"), _PLAN_SUFFIX.sub("", s.get("SchemeNAVName") or "").strip().lower())
            totals[key] = totals.get(key, 0.0) + lakhs
            code_key[str(s.get("AMFI_Code"))] = key
    return {code: round(totals[key] / 100, 2) for code, key in code_key.items()}


def fetch_aum_history(quarters: int = QUARTERS) -> tuple[list[dict], dict[str, list]]:
    """
    ([{label, mid}], {plan code: [AUM crores or None, one per quarter]}), newest
    quarter first.
    """
    periods: list[dict] = []
    per_q: list[dict[str, float]] = []
    for fy in _get({"strType": "Categorywise", "MF_ID": 0}) or []:
        ps = (_get({"fyId": fy["id"], "strType": "Categorywise", "MF_ID": 0}) or {}).get("periods") or []
        for p in ps:                                  # newest first within the year
            data = _quarter_aum(fy["id"], p["id"])
            if not data:
                continue
            periods.append({"label": p["period"], "mid": quarter_mid(p["period"])})
            per_q.append(data)
            if len(periods) >= quarters:
                break
        if len(periods) >= quarters:
            break
    codes = set().union(*per_q) if per_q else set()
    history = {c: [q.get(c) for q in per_q] for c in codes}
    log.info("AUM history: %d quarters (%s to %s), %d plan codes", len(periods),
             periods[-1]["label"] if periods else "-", periods[0]["label"] if periods else "-", len(codes))
    return periods, history


# Filled by facts_for_catalogue: the quarters behind aum_history, newest first.
PERIODS: list[dict] = []


def facts_for_catalogue() -> dict[str, dict]:
    """
    {scheme_code: {aum_cr, aum_period, aum_history}} for every catalogue fund
    found; aum_history is one value per quarter in PERIODS. {} on failure.
    """
    try:
        with open(CATALOGUE_PATH, encoding="utf-8") as fh:
            schemes = json.load(fh)["schemes"]
        periods, history = fetch_aum_history()
    except Exception as exc:
        log.warning("AUM unavailable (%s)", exc)
        return {}
    PERIODS[:] = periods
    latest = periods[0]["label"] if periods else None
    out = {}
    for s in schemes:
        h = history.get(str(s["scheme_code"]))
        if h and any(v is not None for v in h):
            out[str(s["scheme_code"])] = {"aum_cr": h[0], "aum_period": latest, "aum_history": h}
    log.info("AUM for %d of %d funds", sum(1 for v in out.values() if v["aum_cr"] is not None), len(schemes))
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    f = facts_for_catalogue()
    print(PERIODS)
    for code in ["122640", "108466", "103174"]:
        print(code, f.get(code))

"""
amfi_facts.py — fund AUM for every fund, from AMFI.

AMFI's quarterly average AUM, scheme-wise. Each plan and option has its own
AMFI code; a fund's AUM is the sum over all its plans (Regular + Direct,
Growth + IDCW), found by stripping the plan/option suffix. AMFI reports lakhs;
stored in crores.

Best-effort: any failure returns {} and the build carries on without the column.

Usage:
  python scripts/amfi_facts.py          # fetch and print a summary
"""

from __future__ import annotations

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
    """{scheme_code: {aum_cr, aum_period}} for every catalogue fund found; {} on failure."""
    try:
        with open(CATALOGUE_PATH, encoding="utf-8") as fh:
            schemes = json.load(fh)["schemes"]
        aum, aum_period = fetch_aum()
    except Exception as exc:
        log.warning("AUM unavailable (%s)", exc)
        return {}
    out = {str(s["scheme_code"]): {"aum_cr": aum[str(s["scheme_code"])], "aum_period": aum_period}
           for s in schemes if str(s["scheme_code"]) in aum}
    log.info("AUM for %d of %d funds", len(out), len(schemes))
    return out

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    f = facts_for_catalogue()
    for code in ["122640", "108466", "103174"]:
        print(code, f.get(code))

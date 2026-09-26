"""
amfi_industry.py — industry flows and New Fund Offers, from AMFI.

  industry  AMFI's Monthly Report (portal.amfiindia.com/spages/am{mon}{year}repo.xls):
            per category — schemes, folios, money in, redemptions, net
            inflow/outflow, AUM, average AUM, SIP inflow and SIP accounts — for
            the last MONTHS months.
  nfo       AMFI's New Fund Offer list, with each offer's dates, category,
            objective and minimum amount.

Both best-effort: a failure returns None and the build carries on.

Usage:
  python scripts/amfi_industry.py        # fetch both and print a summary
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date

import requests

log = logging.getLogger("amfi_industry")

UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
REPORT_URL = "https://portal.amfiindia.com/spages/am{mon}{year}repo.xls"
NFO_URL = "https://www.amfiindia.com/api/new-fund-offer"
MONTHS = 13            # a year of change plus the month before it

_MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
# Report columns (0-based), by the heading AMFI prints.
_COLS = {
    "schemes": 2, "folios": 3, "mobilised": 4, "redeemed": 5, "net_flow": 6,
    "aum": 7, "avg_aum": 8, "sip_inflow": 11, "sip_accounts_start": 12,
    "sip_registered": 13, "sip_matured": 14, "sip_stopped": 15, "sip_accounts": 16,
}
_ROMAN = re.compile(r"^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii)$", re.I)


def _num(v):
    try:
        x = float(str(v).replace(",", ""))
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _parse_report(content: bytes) -> dict | None:
    """One monthly report -> {groups: [{group, categories: [...], total}], total, fof_domestic}."""
    import pandas as pd
    df = pd.read_excel(io.BytesIO(content), header=None)
    groups, current, grand, fof = [], None, None, None
    section = ""
    for _, row in df.iterrows():
        a, b = str(row[0]).strip(), str(row[1]).strip()
        label = a if b in ("", "nan") else b
        vals = {k: _num(row[c]) if c < len(row) else None for k, c in _COLS.items()}
        if a in ("A", "B", "C") and b not in ("", "nan"):
            section = {"A": "Open ended", "B": "Close ended", "C": "Interval"}[a]
            if a == "C":                       # interval schemes: one line, no sub-groups
                current = {"group": "Interval Schemes", "section": section, "categories": [], "total": None}
                groups.append(current)
            continue
        if re.match(r"^[IVX]+$", a) and b not in ("", "nan") and vals["schemes"] is None:
            current = {"group": b.replace("**", "").strip(), "section": section, "categories": [], "total": None}
            groups.append(current)
            continue
        if _ROMAN.match(a) and current is not None and vals["schemes"] is not None:
            current["categories"].append({"name": b, **vals})
            continue
        low = label.lower()
        if low.startswith("sub total") and current is not None:
            current["total"] = vals
        elif low.startswith("grand total"):
            grand = vals
        elif low.startswith("fund of funds scheme"):
            fof = vals
    if not grand:
        return None
    return {"groups": [g for g in groups if g["categories"]], "total": grand, "fof_domestic": fof}


def fetch_industry(months: int = MONTHS) -> dict | None:
    """{months: [{month: 'YYYY-MM', label, groups, total, fof_domestic}], newest first}."""
    out = []
    today = date.today()
    y, m = today.year, today.month
    tries = 0
    while len(out) < months and tries < months + 4:
        tries += 1
        url = REPORT_URL.format(mon=_MON[m - 1], year=y)
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.ok and r.headers.get("content-type", "").startswith("application/vnd.ms-excel"):
                rep = _parse_report(r.content)
                if rep:
                    out.append({"month": f"{y}-{m:02d}", "label": date(y, m, 1).strftime("%B %Y"), **rep})
        except Exception as exc:
            log.warning("industry: %s failed (%s)", url, exc)
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    if not out:
        log.warning("industry: no monthly report found")
        return None
    log.info("industry: %d months (%s to %s)", len(out), out[-1]["label"], out[0]["label"])
    return {"months": out}


def fetch_nfo() -> list[dict] | None:
    """The New Fund Offers AMFI lists now, with their details."""
    try:
        groups = requests.get(NFO_URL, headers=UA, timeout=60).json().get("NewFundOffer") or []
    except Exception as exc:
        log.warning("NFO list unavailable (%s)", exc)
        return None
    out = []
    for g in groups:
        for it in g.get("items") or []:
            sid = it.get("Scheme_Id")
            d = {}
            try:
                det = requests.get(NFO_URL, params={"Scheme_Id": sid}, headers=UA, timeout=60).json()
                d = ((det.get("NewFundOffer") or [{}])[0].get("items") or [{}])[0]
            except Exception as exc:
                log.warning("NFO %s details unavailable (%s)", sid, exc)
            day = lambda v: (v or "")[:10] or None
            out.append({
                "id": str(sid),
                "amc": it.get("MutualFund") or d.get("MutualFund"),
                "name": it.get("SchemeName") or d.get("SchemeName"),
                "type": d.get("SchemeType"),
                "category": d.get("SchemeCategory"),
                "objective": d.get("ObjectiveofScheme"),
                "opens": day(d.get("NewFundLaunchDate")),
                "closes": day(d.get("NewFundOfferClosureDate")),
                "earliest_close": day(d.get("NewFundEarliestClosureDate")),
                "price": d.get("OfferPriceRs"),
                "min_amount": d.get("MinimumSubscriptionAmount"),
                "load": d.get("IndicateLoadSeparately") or None,
                "website": d.get("ForFurtherDetailsPleaseVisitWebsite"),
                "document": d.get("infoDocumentUrl"),
            })
    out.sort(key=lambda x: (x["closes"] or "9999", x["name"] or ""))
    log.info("NFO: %d open offers", len(out))
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ind = fetch_industry()
    if ind:
        latest = ind["months"][0]
        print(latest["label"], "total", latest["total"])
        for g in latest["groups"]:
            print(" ", g["group"], len(g["categories"]), [c["name"] for c in g["categories"]][:4])
    for n in fetch_nfo() or []:
        print(n["opens"], n["closes"], n["name"], "|", n["category"])

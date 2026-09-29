"""
sif_data.py — Specialised Investment Funds (SIF), from AMFI.

    latest   /api/sif-latest-nav: every SIF plan's latest NAV, its strategy
             (SEBI's SIF categories) and SIF house. AMFI publishes no SIF NAV
             history, so each run STORES the day's NAVs in Neon (table sif_nav,
             ~120 rows a day) and the history grows from the first run.
    nfo      /api/sif-nfo: SIFs open for subscription, with their details.

build_json.build_sif() turns this into sif.json (the SIF desk) and sif_nfo.json.
Everything here is best-effort: a failure leaves the previous files in place.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime

import requests

log = logging.getLogger("sif_data")

BASE = "https://www.amfiindia.com/api"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
# SIFs launch at a ₹10 NFO price; returns "since launch" are measured from it.
NFO_PRICE = 10.0


def _day(s: str | None) -> str | None:
    """'28-Sep-2026' or '2026-09-28T00:00:00.000Z' -> '2026-09-28'."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:11] if fmt == "%d-%b-%Y" else s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fetch_latest() -> list[dict]:
    """One dict per SIF plan/option with its latest NAV."""
    d = requests.get(f"{BASE}/sif-latest-nav", params={"type": ""}, headers=UA, timeout=60).json()
    out = []
    for t in d.get("data") or []:
        for c in t.get("categories") or []:
            for g in c.get("groups") or []:
                for s in g.get("schemes") or []:
                    nav = s.get("NetAssetValue")
                    if not s.get("Sd_Id") or not isinstance(nav, (int, float)) or nav <= 0:
                        continue
                    cat = s.get("category") or c.get("category") or ""
                    out.append({
                        "id": s["Sd_Id"],
                        "house": s.get("SIFName") or g.get("SIFName"),
                        "name": re.sub(r"\s+", " ", s.get("NavName") or "").strip(),
                        "strategy": cat.split(" - ", 1)[-1].strip(),
                        "strategy_group": cat.split(" - ", 1)[0].strip(),
                        "type": s.get("type"),
                        "plan": s.get("Plan"),
                        "option": s.get("Option"),
                        "isin": s.get("ISINPO") or None,
                        "nav": float(nav),
                        "date": _day(s.get("Date")),
                    })
    log.info("SIF: %d plans with a NAV from %d houses", len(out), len({r['house'] for r in out}))
    return out


def fetch_nfo() -> list[dict] | None:
    """SIF NFOs AMFI lists now (list call, then one detail call each)."""
    try:
        d = requests.get(f"{BASE}/sif-nfo", params={"Scheme_Id": ""}, headers=UA, timeout=60).json()
    except Exception as exc:
        log.warning("SIF NFO list unavailable (%s)", exc)
        return None
    groups = d.get("NewFundOffer") or d.get("data") or d.get("SifNfo") or []
    out = []
    for g in groups if isinstance(groups, list) else []:
        for it in g.get("items") or [g]:
            sid = it.get("Scheme_Id") or it.get("SchemeId")
            if not sid:
                continue
            det = {}
            try:
                dd = requests.get(f"{BASE}/sif-nfo", params={"Scheme_Id": sid}, headers=UA, timeout=60).json()
                lst = dd.get("NewFundOffer") or dd.get("data") or []
                det = ((lst[0].get("items") or [lst[0]])[0]) if lst else {}
            except Exception:
                pass
            m = {**it, **det}
            out.append({
                "id": str(sid),
                "house": m.get("MutualFund") or m.get("SIFName"),
                "name": m.get("SchemeName") or m.get("NavName"),
                "category": m.get("SchemeCategory") or m.get("category"),
                "type": m.get("SchemeType"),
                "objective": m.get("ObjectiveofScheme"),
                "opens": _day(m.get("NewFundLaunchDate")),
                "closes": _day(m.get("NewFundOfferClosureDate")),
                "min_amount": m.get("MinimumSubscriptionAmount"),
                "price": m.get("OfferPriceRs"),
                "website": m.get("ForFurtherDetailsPleaseVisitWebsite"),
                "document": m.get("infoDocumentUrl"),
            })
    log.info("SIF NFO: %d offers", len(out))
    return out


# ── the stored history (Neon table sif_nav) ──────────────────────────────────

DDL = """CREATE TABLE IF NOT EXISTS sif_nav (
    sd_id    text  NOT NULL,
    nav_date date  NOT NULL,
    nav      double precision NOT NULL CHECK (nav > 0),
    PRIMARY KEY (sd_id, nav_date))"""


def store_and_read(rows: list[dict]) -> dict[str, dict[str, float]]:
    """Append today's NAVs (never overwriting a stored day) and return the whole
    SIF history {sd_id: {date: nav}} — a few thousand rows, a few hundred KB."""
    from scripts import neon_store as db
    if not db.enabled():
        log.warning("Neon not configured — SIF history not stored")
        return {r["id"]: {r["date"]: r["nav"]} for r in rows if r["date"]}
    import psycopg
    with psycopg.connect(db.DSN) as conn:
        conn.execute(DDL)
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO sif_nav (sd_id, nav_date, nav) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                [(r["id"], r["date"], r["nav"]) for r in rows if r["date"]])
        hist: dict[str, dict[str, float]] = {}
        for sd, d, v in conn.execute("SELECT sd_id, nav_date, nav FROM sif_nav ORDER BY nav_date"):
            hist.setdefault(sd, {})[d.isoformat()] = v
    log.info("SIF history: %d plans, %d stored days in all", len(hist), sum(len(h) for h in hist.values()))
    return hist


def since_launch(nav: float) -> float:
    return nav / NFO_PRICE - 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    rows = fetch_latest()
    for r in rows[:5]:
        print(r)
    print(fetch_nfo())

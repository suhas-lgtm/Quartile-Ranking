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
                        "sif_id": str(s.get("sifId") or ""),
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


def _key(name: str) -> str:
    """Strategy name without plan/option, for matching NAV rows to details."""
    # Plan and option are written every which way ("Fund-Regular Growth",
    # "Fund - Growth Option - Regular Plan"); every strategy name ends in "Fund".
    n = (name or "").lower()
    m = re.search(r"^(.*?\bfund)\b", n)
    n = m.group(1) if m else re.split(r"\s+-\s+(regular|direct)\b", n)[0]
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def fetch_details(sif_ids: set[str]) -> dict[str, dict]:
    """{strategy key: launch date, objective, exit load, minimum, website} per SIF house."""
    out = {}
    for sid in sorted(sif_ids):
        try:
            rows = requests.get(f"{BASE}/investment-strategy-detail", params={"sif_id": sid},
                                headers=UA, timeout=60).json().get("data") or []
        except Exception as exc:
            log.warning("SIF %s details unavailable (%s)", sid, exc)
            continue
        for d in rows:
            out[_key(d.get("Scheme_Name"))] = {
                "launch_date": _day(d.get("Launch_Date")),
                "objective": re.sub(r"\s+", " ", d.get("Scheme_Objective") or "").strip() or None,
                "exit_load": re.sub(r"\s+", " ", d.get("scheme_load") or "").strip() or None,
                "min_amount": re.sub(r"\s+", " ", d.get("Scheme_min_amt") or "").strip() or None,
                "website": d.get("AMC_Website") or None,
            }
    log.info("SIF details: %d strategies", len(out))
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
        # Any day a run missed (failure, Sunday skip, holiday catch-up) in the last
        # two weeks is taken from AMFI's history, so returns never have holes.
        from datetime import timedelta
        fill_history(conn, date.today() - timedelta(days=14), date.today() - timedelta(days=1))
        hist: dict[str, dict[str, float]] = {}
        for sd, d, v in conn.execute("SELECT sd_id, nav_date, nav FROM sif_nav ORDER BY nav_date"):
            hist.setdefault(sd, {})[d.isoformat()] = v
    log.info("SIF history: %d plans, %d stored days in all", len(hist), sum(len(h) for h in hist.values()))
    return hist


def since_launch(nav: float) -> float:
    return nav / NFO_PRICE - 1


# ── back-filling the history from AMFI's SIF NAV history ─────────────────────
# /api/sif-nav-history?query_type=all_for_date&from_date=YYYY-MM-DD returns every
# SIF plan's NAV on that day (the endpoint behind AMFI's SIF NAV-history page).

FIRST_SIF_DAY = date(2025, 9, 16)     # the first SIF NAVs


def fetch_for_date(day: str) -> list[tuple[str, str, float]]:
    """(sd_id, date, nav) for every SIF plan with a NAV on `day`; empty on holidays."""
    d = requests.get(f"{BASE}/sif-nav-history", params={"query_type": "all_for_date", "from_date": day},
                     headers=UA, timeout=60).json()
    out = []
    for house in d.get("data") or []:
        for s in house.get("schemes") or []:
            for n in s.get("navs") or []:
                try:
                    v = float(n.get("hNAV_Amt"))
                except (TypeError, ValueError):
                    continue
                dt = (n.get("hNAV_Date") or "")[:10]
                if n.get("SD_ID") and v > 0 and dt:
                    out.append((n["SD_ID"], dt, v))
    return out


def fill_history(conn, start: date, end: date) -> int:
    """Store AMFI's NAVs for every weekday from start to end not already stored."""
    from datetime import timedelta
    have = {d for (d,) in conn.execute("SELECT DISTINCT nav_date FROM sif_nav")}
    added, day = 0, start
    while day <= end:
        if day.weekday() < 5 and day not in have:
            try:
                rows = fetch_for_date(day.isoformat())
            except Exception as exc:          # one bad day must not stop the rest
                log.warning("SIF history %s: %s", day, exc)
                rows = []
            if rows:
                with conn.cursor() as cur:
                    cur.executemany("INSERT INTO sif_nav (sd_id, nav_date, nav) VALUES (%s, %s, %s) "
                                    "ON CONFLICT DO NOTHING", rows)
                added += len(rows)
        day += timedelta(days=1)
    if added:
        log.info("SIF history: back-filled %d NAVs from %s to %s", added, start, end)
    return added


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser(description="SIF data from AMFI")
    ap.add_argument("--backfill", nargs="?", const=FIRST_SIF_DAY.isoformat(), metavar="FROM",
                    help=f"store AMFI's SIF NAV history from this date (default {FIRST_SIF_DAY}) to yesterday")
    args = ap.parse_args()
    if args.backfill:
        from datetime import timedelta
        import psycopg
        from scripts import neon_store as db
        with psycopg.connect(db.DSN) as conn:
            conn.execute(DDL)
            fill_history(conn, date.fromisoformat(args.backfill), date.today() - timedelta(days=1))
    else:
        rows = fetch_latest()
        for r in rows[:5]:
            print(r)
        print(fetch_nfo())

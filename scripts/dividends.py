"""
dividends.py — IDCW (dividend) payouts per fund, worked out from NAVs.

AMFI's dividend API returns nothing, so payouts are DERIVED. A fund's IDCW and
Growth options hold the same portfolio, so day to day their NAVs move by the
same percentage — except on a record date, when the IDCW NAV also drops by the
payout. For each day:

    expected IDCW NAV = yesterday's IDCW NAV x (today's Growth NAV / yesterday's)
    payout per unit   = expected - today's IDCW NAV

and a payout is recorded when that gap is more than MIN_GAP of the NAV (normal
days differ by a hair's breadth). Accurate to about a paisa per unit.

Sources: AMFI's daily NAV file (to pair each Regular-Growth fund with its
Regular IDCW option) and api.mfapi.in (the IDCW option's NAV history). Growth
NAVs come from the pipeline's own database. Nothing is read from Neon.

    python scripts/dividends.py            # build dividends.json from the local DB
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import requests

log = logging.getLogger("dividends")

NAVALL = "https://portal.amfiindia.com/spages/NAVAll.txt"
MFAPI = "https://api.mfapi.in/mf/{code}"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}
MIN_GAP = 0.0025          # 0.25% of NAV: a real payout, not rounding noise
MAX_GAP = 0.35            # bigger drops are unit splits / bad data, never payouts
YEARS = 5                 # payout history kept per fund
_IDCW = re.compile(r"idcw|dividend|payout|reinvest", re.I)


def _norm(name: str) -> str:
    n = re.sub(r"\(.*?\)", " ", (name or "").lower())
    n = re.sub(r"\b(fund|scheme|plan|the)\b", " ", n)
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


def idcw_codes(growth: dict[str, str]) -> dict[str, str]:
    """{growth code: Regular-plan IDCW code} matched by fund name in AMFI's NAV file."""
    text = requests.get(NAVALL, headers=UA, timeout=120).text
    by_name: dict[str, list[tuple[str, str]]] = {}
    for line in text.splitlines():
        p = line.split(";")
        if len(p) < 8 or not p[0].strip().isdigit():
            continue
        code, name, plan, option = p[0].strip(), p[3], p[4], p[5]
        if "direct" in plan.lower():
            continue
        if _IDCW.search(option) or _IDCW.search(name):
            key = _norm(re.split(r"\s-\s", name)[0])
            by_name.setdefault(key, []).append((code, option.lower()))
    out = {}
    for g_code, g_name in growth.items():
        cands = by_name.get(_norm(g_name))
        if not cands:
            continue
        # Prefer the plain payout option over reinvestment / frequency variants.
        cands.sort(key=lambda c: (("reinvest" in c[1]), ("daily" in c[1] or "weekly" in c[1]), c[0]))
        out[g_code] = cands[0][0]
    return out


def _mfapi_series(code: str) -> dict[str, float]:
    try:
        d = requests.get(MFAPI.format(code=code), headers=UA, timeout=60).json()
        return {datetime.strptime(r["date"], "%d-%m-%Y").date().isoformat(): float(r["nav"])
                for r in d.get("data") or [] if float(r.get("nav") or 0) > 0}
    except Exception:
        return {}


def payouts(growth: dict[str, float], idcw: dict[str, float]) -> list[dict]:
    """Derived payouts, oldest first: {date, amount (₹/unit), pct (of the pre-payout NAV)}."""
    days = sorted(set(growth) & set(idcw))
    out = []
    for a, b in zip(days, days[1:]):
        g0, g1, i0, i1 = growth[a], growth[b], idcw[a], idcw[b]
        if g0 <= 0 or i0 <= 0:
            continue
        expected = i0 * g1 / g0
        gap = expected - i1
        # Above MAX_GAP it is a unit split or a data error, not a payout.
        if MIN_GAP <= gap / expected <= MAX_GAP:
            out.append({"date": b, "amount": round(gap, 3), "pct": round(gap / expected, 5)})
    return out


def build(conn, categories: set[str], workers: int = 8) -> dict:
    """dividends.json content for every active Regular-Growth fund in `categories` (slugs)."""
    rows = conn.execute("""
        SELECT s.scheme_code, s.scheme_name, c.category_name, c.slug, c.asset_class
        FROM schemes s JOIN categories c ON c.category_id = s.category_id
        WHERE s.is_active = 1""").fetchall()
    funds = {str(r[0]): r for r in rows if r[3] in categories}
    pair = idcw_codes({c: r[1] for c, r in funds.items()})
    log.info("Dividends: %d of %d funds have a Regular IDCW option", len(pair), len(funds))
    since = (date.today() - timedelta(days=365 * YEARS + 10)).isoformat()
    with ThreadPoolExecutor(workers) as ex:
        idcw_hist = dict(zip(pair.values(), ex.map(_mfapi_series, pair.values())))
    one_year = (date.today() - timedelta(days=365)).isoformat()
    out = []
    for g_code, i_code in pair.items():
        ih = {d: v for d, v in idcw_hist.get(i_code, {}).items() if d >= since}
        if len(ih) < 30:
            continue
        gh = dict(conn.execute("SELECT nav_date, nav FROM nav_history WHERE scheme_code=? AND nav_date>=?",
                               (int(g_code), since)).fetchall())
        pays = payouts(gh, ih)
        last_nav_date = max(ih)
        recent = [p for p in pays if p["date"] >= one_year]
        total = round(sum(p["amount"] for p in recent), 3)
        _, name, cat, slug, ac = funds[g_code]
        out.append({
            "scheme_code": g_code, "idcw_code": i_code, "scheme_name": name,
            "category_name": cat, "category_slug": slug, "asset_class": ac,
            "idcw_nav": ih[last_nav_date], "idcw_nav_date": last_nav_date,
            "payouts": pays,
            "count_12m": len(recent),
            "total_12m": total,
            "yield_12m": round(total / ih[last_nav_date], 5) if ih[last_nav_date] else None,
            "last_payout": pays[-1] if pays else None,
        })
    out.sort(key=lambda f: -(f["yield_12m"] or 0))
    log.info("Dividends: %d funds, %d with a payout in the last year", len(out), sum(1 for f in out if f["count_12m"]))
    return {"built": datetime.now().isoformat(timespec="seconds"), "years": YEARS, "min_gap": MIN_GAP, "funds": out}

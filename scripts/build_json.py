"""
scripts/build_json.py — Pre-compute ALL engine outputs and write JSON files.

Implements Appendix PB contract. ALL returns stored as decimals; null = —.
Every file carries 'as_of'. This runs AFTER run_engine.py has updated the DB.

Output files (in site/public/data/):
  meta.json, indices.json,
  quartiles_{slug}_{mode}.json, risk_{slug}.json, watchlist_{mode}.json,
  screener_{slug}.json, whitelist.json,
  index/{index_id}.json

This build serves four screens — Market Pulse, Quartile Ranking, Risk & Returns
and Fund Signals — so it computes only what they read.
"""

from __future__ import annotations

import json
import os
import sys
import logging
from datetime import date, datetime, timezone
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, ROOT_DIR)

# Both are overridable so a run can be pointed at a throwaway database and a
# scratch output directory (used to diff a candidate build against the live one).
DB_PATH    = os.environ.get("MF_DB_PATH") or os.path.join(ROOT_DIR, "data", "mf_research.db")
OUTPUT_DIR = os.environ.get("MF_OUTPUT_DIR") or os.path.join(ROOT_DIR, "site", "public", "data")

from scripts.init_db import get_conn as _get_conn
from engine.calculation_engine import (
    trailing_return, trailing_return_index,
    annual_return,   annual_return_index,
    quarter_return,  quarter_return_index,
    month_return,    month_return_index,
    category_average, rank_and_quartile,
    quartile_journeys,
    risk_metrics, composite_risk_score,
    short_return, SHORT_PERIODS,
    index_std_annual, bear_period_stats, screener_parameter_scores,
    tracking_error,
    rolling_statistics,
)
from scripts.sectors import SECTORAL_THEMATIC_SLUG, sector_of, SECTOR_ORDER
from scripts.portfolios import latest_holdings, nifty50_isins, active_share_stats

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("build_json")


# ── Sectoral/Thematic: each sector is its own peer group ─────────────────────
#
# AMFI puts ~250 funds in one "Sectoral/Thematic" category. Ranking them
# together answers the wrong question: an IT fund in a bad year for IT would
# show Q4 while beating every other IT fund. So each sector is ranked within
# itself, exactly as Large Cap and Mid Cap are.
#
# Applies only to sectoral-thematic. Every other category keeps a single pool.


def sector_map(funds_names: list[tuple[str, str]], cat_slug: str) -> dict[str, str] | None:
    """{scheme_code: sector} for sectoral-thematic, else None."""
    if cat_slug != SECTORAL_THEMATIC_SLUG:
        return None
    return {sc: sector_of(name) for sc, name in funds_names}


def rank_within_sectors(period_returns: dict[str, Optional[float]],
                        sectors: dict[str, str] | None):
    """
    rank_and_quartile, applied per sector when `sectors` is given.

    A fund alone in its sector gets quartile 1 from rank_and_quartile, which is
    true but not informative — it is simply the only one. Callers get the same
    (rank, quartile) shape either way so the two ranking sites stay identical.
    """
    if sectors is None:
        return rank_and_quartile(period_returns)

    grouped: dict[str, dict[str, Optional[float]]] = {}
    for code, value in period_returns.items():
        grouped.setdefault(sectors[code], {})[code] = value

    out: dict[str, tuple[Optional[int], Optional[int]]] = {}
    for pool in grouped.values():
        out.update(rank_and_quartile(pool))
    return out


def sector_breakdown(sectors: dict[str, str]) -> list[dict]:
    """Sectors present, in canonical order, with fund counts — for the UI."""
    counts: dict[str, int] = {}
    for s in sectors.values():
        counts[s] = counts.get(s, 0) + 1
    return [{"sector": s, "fund_count": counts[s]}
            for s in sorted(counts, key=lambda x: SECTOR_ORDER.get(x, 999))]

TODAY = date.today()

# Month labels for the quartile grid, e.g. "Jun-2026". Written out rather than
# taken from strftime so the output does not shift with the machine's locale.
_MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar",  4: "Apr",  5: "May",  6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

# ── helpers ──────────────────────────────────────────────────────────────────

def write_json(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))


def out(filename: str) -> str:
    return os.path.join(OUTPUT_DIR, filename)


def get_as_of(conn) -> str:
    row = conn.execute(
        "SELECT MAX(nav_date) FROM nav_history WHERE nav_date<=?", (TODAY.isoformat(),)
    ).fetchone()
    return row[0] if row and row[0] else TODAY.isoformat()


def fmt(val: Optional[float]) -> Optional[float]:
    """Round to 6dp for JSON output; None stays None."""
    return round(val, 6) if val is not None else None


# ── meta.json ────────────────────────────────────────────────────────────────

def build_meta(conn):
    as_of = get_as_of(conn)
    rf    = float(conn.execute("SELECT value FROM config WHERE key='risk_free_rate'").fetchone()[0])

    categories = conn.execute("""
        SELECT c.category_id, c.asset_class, c.category_name, c.slug, c.display_order,
               b.index_id, b.index_name
        FROM categories c
        LEFT JOIN benchmarks b ON c.benchmark_id = b.index_id
        ORDER BY c.display_order
    """).fetchall()

    cat_list = []
    for row in categories:
        cat_list.append({
            "category_id":   row[0],
            "asset_class":   row[1],
            "category_name": row[2],
            "slug":          row[3],
            "display_order": row[4],
            "benchmark_id":  row[5],
            "benchmark_name":row[6],
        })

    benchmarks = conn.execute("""
        SELECT index_id, index_name, yahoo_ticker, is_synthetic
        FROM benchmarks WHERE is_active=1
    """).fetchall()

    bm_list = []
    for row in benchmarks:
        comps = conn.execute(
            "SELECT component_index_id, weight FROM benchmark_components WHERE index_id=?", (row[0],)
        ).fetchall()
        bm_list.append({
            "index_id":    row[0],
            "index_name":  row[1],
            "ticker":      row[2],
            "is_synthetic":bool(row[3]),
            "components":  [{"index_id": c[0], "weight": c[1]} for c in comps],
        })

    write_json(out("meta.json"), {
        "as_of":      as_of,
        "risk_free_rate": rf,
        "categories": cat_list,
        "benchmarks": bm_list,
        "generated":  datetime.now(timezone.utc).isoformat(),
    })
    log.info("✓ meta.json")


# ── indices.json (Market Pulse strip + sparklines) ────────────────────────────

STRIP_INDICES = [
    "NIFTY 50", "SENSEX", "NIFTY 100", "NIFTY MIDCAP 150",
    "NIFTY SMALLCAP 250", "NIFTY BANK", "NIFTY 500", "GOLD (GOLDBEES)",
]


def build_indices(conn):
    result = []
    for idx_name in STRIP_INDICES:
        row = conn.execute(
            "SELECT index_id FROM benchmarks WHERE index_name=?", (idx_name,)
        ).fetchone()
        if not row:
            continue
        index_id = row[0]

        # Latest close
        latest = conn.execute(
            "SELECT date, close FROM index_history WHERE index_id=? ORDER BY date DESC LIMIT 1",
            (index_id,)
        ).fetchone()
        if not latest:
            continue

        # Previous close (1 trading day back)
        prev = conn.execute(
            "SELECT close FROM index_history WHERE index_id=? AND date<? ORDER BY date DESC LIMIT 1",
            (index_id, latest[0])
        ).fetchone()

        # 30-day sparkline
        sparkline_rows = conn.execute("""
            SELECT date, close FROM index_history
            WHERE index_id=? ORDER BY date DESC LIMIT 30
        """, (index_id,)).fetchall()
        sparkline = list(reversed([(r[0], r[1]) for r in sparkline_rows]))

        change_1d     = ((latest[1] / prev[0]) - 1) if prev else None
        change_1d_abs = (latest[1] - prev[0]) if prev else None

        result.append({
            "index_id":     index_id,
            "index_name":   idx_name,
            "latest_close": latest[1],
            "date":         latest[0],
            "change_1d":    fmt(change_1d),
            "change_1d_abs":fmt(change_1d_abs),
            "sparkline":    sparkline,
        })

    # as_of is the newest close in the strip, not the run date. Stamping TODAY
    # made the header read "As of 20 Aug" above 18 Aug closes whenever the market
    # had not settled a bar yet -- the one date a reader actually checks.
    newest = max((r["date"] for r in result), default=get_as_of(conn))
    write_json(out("indices.json"), {"as_of": newest, "indices": result})
    log.info("✓ indices.json")


# ── Quartile grid (quartiles_{slug}_{mode}.json) ──────────────────────────────

def _quartile_periods(mode: str):
    """(periods, labels) for a mode — the single definition used everywhere."""
    if mode == "monthly":
        periods, y, m = [], TODAY.year, TODAY.month
        for _ in range(12):
            m -= 1
            if m == 0:
                m = 12; y -= 1
            periods.append((y, m))
        periods.reverse()
        return periods, [f"{_MONTH_ABBR[m]}-{y}" for y, m in periods]

    if mode == "quarterly":
        periods, y, q = [], TODAY.year, (TODAY.month - 1) // 3 + 1
        for _ in range(12):
            q -= 1
            if q == 0:
                q = 4; y -= 1
            periods.append((y, q))
        periods.reverse()
        return periods, [f"Q{q}-{y}" for y, q in periods]

    years = list(range(max(2018, TODAY.year - 7), TODAY.year))
    return years, [str(y) for y in years]


def _period_return(conn, scheme_code: str, mode: str, period):
    if mode == "monthly":
        return month_return(conn, scheme_code, period[0], period[1])
    if mode == "quarterly":
        return quarter_return(conn, scheme_code, period[0], period[1])
    return annual_return(conn, scheme_code, period)


def _trailing_streak(quartiles: list, good: bool) -> int:
    """
    Consecutive periods, counting back from the latest, spent in the top half
    (good=True -> Q1/Q2) or the bottom half (good=False -> Q3/Q4).

    Unranked periods break the streak rather than being skipped: a gap means we
    genuinely do not know how the fund did, and treating that as continuity
    would overstate the run.
    """
    streak = 0
    for q in reversed(quartiles):
        if q is None:
            break
        in_half = (q <= 2) if good else (q >= 3)
        if not in_half:
            break
        streak += 1
    return streak


# ── Watchlist (watchlist_{mode}.json) ─────────────────────────────────────────

def build_watchlist(conn, mode: str = "monthly"):
    """
    Cross-category exit/entry signals.

    Every other quartile file is per category; this one spans all of them so the
    dashboard can answer "which funds anywhere have been sliding?" without the
    browser fetching and stitching 17 separate files.

    Per fund it carries the streak in each direction, the full quartile history,
    and 1Y return against the fund's own category average — a Q3 fund in a
    strong peer group is a different proposition from one that is simply losing
    money, and the streak alone cannot tell them apart.
    """
    periods, labels = _quartile_periods(mode)

    # Minimum ranked history before a fund may appear in the exit/entry lists.
    # A fund three months old that ranks Q4 twice is not "consistently in the
    # bottom half" — there is simply not enough of a record to say. Gating here
    # keeps new launches out until they have one.
    MIN_HISTORY = {"monthly": 6, "quarterly": 3, "annual": 2}[mode]

    cats = conn.execute(
        """SELECT category_id, category_name, slug, asset_class
           FROM categories WHERE asset_class IN ('Equity','Hybrid')
           ORDER BY display_order"""
    ).fetchall()

    out_funds = []
    cat_meta = []

    for cat_id, cat_name, slug, asset_class in cats:
        funds = conn.execute(
            """SELECT s.scheme_code, s.scheme_name, a.amc_name
               FROM schemes s JOIN amcs a ON a.amc_id = s.amc_id
               WHERE s.category_id=? AND s.is_active=1
               ORDER BY s.scheme_name""",
            (cat_id,),
        ).fetchall()
        if not funds:
            continue

        returns_grid = {
            sc: [_period_return(conn, sc, mode, p) for p in periods]
            for sc, _, _ in funds
        }

        # Rank within the category, one period at a time — identical to
        # build_quartiles, so the two views can never disagree. For
        # sectoral-thematic that means within each sector.
        sectors = sector_map([(sc, name) for sc, name, _ in funds], slug)
        grid = {sc: [None] * len(periods) for sc, _, _ in funds}
        for i in range(len(periods)):
            rq = rank_within_sectors(
                {sc: returns_grid[sc][i] for sc, _, _ in funds}, sectors)
            for sc, _, _ in funds:
                grid[sc][i] = rq[sc][1]

        # 1Y trailing, plus the equal-weighted average of the same.
        r1y = {sc: trailing_return(conn, sc, "12M") for sc, _, _ in funds}
        cat_avg_1y = category_average(list(r1y.values()))

        # The verdict cards ask "is this fund beating its peers?". Once each
        # sector is its own peer group, the honest comparison is the sector's
        # average, not the whole themed category's — a pharma fund measured
        # against an average dominated by defence and quant funds is noise.
        peer_avg = {}
        if sectors:
            by_sector: dict[str, list] = {}
            for sc, _, _ in funds:
                by_sector.setdefault(sectors[sc], []).append(r1y[sc])
            sector_avg = {s: category_average(v) for s, v in by_sector.items()}
            peer_avg = {sc: sector_avg[sectors[sc]] for sc, _, _ in funds}

        cat_meta.append({
            "category_name": cat_name,
            "slug": slug,
            "asset_class": asset_class,
            "fund_count": len(funds),
            "avg_1y": fmt(cat_avg_1y),
            **({"ranked_within": "sector",
                "sectors": [{**s, "avg_1y": fmt(sector_avg[s["sector"]])}
                            for s in sector_breakdown(sectors)]} if sectors else {}),
        })

        for sc, name, amc in funds:
            qs = grid[sc]
            ranked = [q for q in qs if q is not None]
            out_funds.append({
                "scheme_code":   sc,
                "scheme_name":   name,
                "amc_name":      amc,
                "category_name": cat_name,
                "category_slug": slug,
                "asset_class":   asset_class,
                "quartiles":     qs,
                # Strictly the LAST period, not the last one that happened to be
                # ranked. Reading back to the most recent non-null let a fund
                # that stopped being ranked months ago keep contributing a stale
                # quartile to its AMC's current standing.
                "latest_q":      qs[-1] if qs else None,
                "last_ranked_q": next((q for q in reversed(qs) if q is not None), None),
                "exit_streak":   _trailing_streak(qs, good=False),
                "entry_streak":  _trailing_streak(qs, good=True),
                "top_half_pct":  round(sum(1 for q in ranked if q <= 2) / len(ranked), 4) if ranked else None,
                "ranked_periods": len(ranked),
                # False for a fund too new to judge — the dashboard keeps these
                # out of the exit/entry lists but still counts them elsewhere.
                "eligible":      len(ranked) >= MIN_HISTORY,
                "ret_1y":        fmt(r1y[sc]),
                # The fund's own peer group average: its sector for
                # sectoral-thematic, its category everywhere else. The dashboard
                # reads this to decide "beating its peers or not", so it has to
                # match whatever pool the quartile was computed in.
                "cat_avg_1y":    fmt(peer_avg.get(sc, cat_avg_1y) if sectors else cat_avg_1y),
                **({"sector": sectors[sc],
                    # Kept alongside so the whole-category figure is still
                    # available without recomputing it in the browser.
                    "category_avg_1y": fmt(cat_avg_1y)} if sectors else {}),
            })

    # ── AMC leaderboard ──────────────────────────────────────────────────────
    # Counted on the LATEST period only. An AMC's standing should reflect where
    # its funds sit now, not an average that a long tail of history can mask.
    amc: dict[str, dict] = {}
    for f in out_funds:
        a = amc.setdefault(f["amc_name"], {
            "amc_name": f["amc_name"], "funds": 0,
            "q1": 0, "q2": 0, "q3": 0, "q4": 0, "ranked": 0, "_q_sum": 0,
        })
        a["funds"] += 1
        q = f["latest_q"]
        if q:
            a[f"q{q}"] += 1
            a["ranked"] += 1
            a["_q_sum"] += q

    leaderboard = []
    for a in amc.values():
        if a["ranked"] == 0:
            continue
        leaderboard.append({
            "amc_name":     a["amc_name"],
            "funds":        a["funds"],
            "ranked":       a["ranked"],
            "q1":           a["q1"],
            "q2":           a["q2"],
            "q3":           a["q3"],
            "q4":           a["q4"],
            "top_half":     a["q1"] + a["q2"],
            "top_half_pct": round((a["q1"] + a["q2"]) / a["ranked"], 4),
            "avg_quartile": round(a["_q_sum"] / a["ranked"], 2),
        })
    # Best average quartile first; ties broken by the larger fund count, so a
    # house with 12 funds outranks one with a single lucky performer.
    leaderboard.sort(key=lambda x: (x["avg_quartile"], -x["ranked"]))

    write_json(out(f"watchlist_{mode}.json"), {
        "as_of":         get_as_of(conn),
        "mode":          mode,
        "min_history":   MIN_HISTORY,
        "period_labels": labels,
        "categories":    cat_meta,
        "funds":         out_funds,
        "amc_leaderboard": leaderboard,
    })
    log.info("✓ watchlist_%s.json (%d funds, %d AMCs)", mode, len(out_funds), len(leaderboard))


def build_quartiles(conn, cat_slug: str, mode: str = "quarterly"):
    row = conn.execute(
        "SELECT category_id, category_name, asset_class FROM categories WHERE slug=?", (cat_slug,)
    ).fetchone()
    if not row:
        return
    cat_id, cat_name, asset_class = row

    if asset_class not in ("Equity", "Hybrid"):
        return

    funds = conn.execute(
        "SELECT scheme_code, scheme_name FROM schemes WHERE category_id=? AND is_active=1 ORDER BY scheme_name",
        (cat_id,)
    ).fetchall()

    if mode == "monthly":
        # Last 12 completed months. Same construction as the quarterly branch:
        # step back from the current period so the current, incomplete one is
        # excluded — a partial month would rank against full ones.
        periods = []
        y, m = TODAY.year, TODAY.month
        for _ in range(12):
            m -= 1
            if m == 0:
                m = 12; y -= 1
            periods.append((y, m))
        periods.reverse()
        period_labels = [f"{_MONTH_ABBR[m]}-{y}" for y, m in periods]

        returns_grid = {}
        for sc, _ in funds:
            # month_return: start = first NAV on/after the 1st,
            #               end   = last NAV on/before the month's final day.
            returns_grid[sc] = [month_return(conn, sc, y, m) for y, m in periods]

    elif mode == "quarterly":
        # Last 12 completed quarters
        periods = []
        y, q = TODAY.year, (TODAY.month - 1) // 3 + 1
        for _ in range(12):
            q -= 1
            if q == 0:
                q = 4; y -= 1
            periods.append((y, q))
        periods.reverse()
        period_labels = [f"Q{q}-{y}" for y, q in periods]

        returns_grid = {}
        for sc, _ in funds:
            returns_grid[sc] = [quarter_return(conn, sc, y, q) for y, q in periods]

    else:  # annual
        years = list(range(max(2018, TODAY.year - 7), TODAY.year))  # last ~7 completed years
        period_labels = [str(y) for y in years]
        returns_grid = {}
        for sc, _ in funds:
            returns_grid[sc] = [annual_return(conn, sc, y) for y in years]

    # Per-period rank + quartile.
    #
    # For sectoral-thematic each sector is ranked on its own, so a Q1 here means
    # top quartile among IT funds rather than among all ~250 themed funds.
    sectors = sector_map(funds, cat_slug)
    n_periods = len(period_labels)
    all_quartiles = {sc: [None] * n_periods for sc, _ in funds}

    for p_idx in range(n_periods):
        period_returns = {sc: returns_grid[sc][p_idx] for sc, _ in funds}
        rq = rank_within_sectors(period_returns, sectors)
        for sc, _ in funds:
            all_quartiles[sc][p_idx] = rq[sc][1]   # quartile value 1–4 or None

    # Consistency + Volatility boxes (E10). Roughly half the periods shown, so a
    # fund needs a real track record before it can top either list.
    #
    # Both lists are read off the SAME quartile history, which is what stops a
    # fund appearing in both. The old pair ranked consistency on mean quartile and
    # volatility on the standard deviation of returns -- different quantities off
    # different inputs, so a fund that never left Q1 while swinging hard in
    # absolute terms legitimately topped both. See engine.quartile_journeys.
    min_p = 6 if mode in ("quarterly", "monthly") else 4
    journeys = quartile_journeys(all_quartiles, min_periods=min_p)

    fund_rows = [
        {
            "scheme_code": sc,
            "scheme_name": name,
            "quartiles":   all_quartiles[sc],
            # The return each quartile was computed from, same index as
            # `quartiles`. Emitted so the table can show it: a Q box beside an
            # unrelated 1Y figure reads as a bug — a fund can be top for the year
            # and bottom for the quarter, and without the period return on screen
            # there is no way to see that is what happened.
            "returns":     [fmt(v) for v in returns_grid[sc]],
            # Stamped here so the browser never has to classify a fund itself.
            # The rules live in scripts/sectors.py alone.
            **({"sector": sectors[sc]} if sectors else {}),
        }
        for sc, name in funds
    ]

    payload = {
        # The NAV date the quartiles were computed from, not the run date.
        "as_of":          get_as_of(conn),
        "category_name":  cat_name,
        "mode":           mode,
        "period_labels":  period_labels,
        "funds":          fund_rows,
        "most_consistent":journeys["consistent"],
        "most_volatile":  journeys["volatile"],
        # Level rather than stability, so these are share-based ("most of the
        # time in Q1/Q2") and may overlap the two lists above by design.
        "best_performers":  journeys["best"],
        "worst_performers": journeys["worst"],
    }
    if sectors:
        # Tells the UI that quartiles here are sector-relative, and which
        # sectors exist, so the filter is built from the data rather than a
        # hardcoded list that could drift.
        payload["ranked_within"] = "sector"
        payload["sectors"] = sector_breakdown(sectors)

    write_json(out(f"quartiles_{cat_slug}_{mode}.json"), payload)
    log.info("✓ quartiles_%s_%s.json (%d funds%s)", cat_slug, mode, len(funds),
             f", {len(payload['sectors'])} sectors ranked separately" if sectors else "")


# ── Risk & Returns (risk_{slug}.json) ────────────────────────────────────────

RISK_RETURN_PERIODS = ["1D", "1W", "1M", "3M", "6M", "12M", "2Y", "3Y", "5Y", "10Y"]


def _risk_period_return(conn, code, period, as_of_d, is_index=False):
    """Any RISK_RETURN_PERIODS entry, for a fund or an index."""
    if period in SHORT_PERIODS:
        return short_return(conn, code, period, as_of_d, is_index=is_index)
    if is_index:
        return trailing_return_index(conn, code, period, as_of_d)
    return trailing_return(conn, code, period, as_of_d)
# Ratios that compare the fund with its benchmark, blanked when that is stale.
BENCHMARK_RELATIVE_KEYS = ["alpha", "beta", "upside_capture", "downside_capture"]
BENCHMARK_MAX_LAG_DAYS = 10
RISK_RATIO_KEYS = [
    "std_annual", "sharpe", "sortino", "alpha", "beta",
    "max_drawdown", "upside_capture", "downside_capture", "composite_score",
]


def build_risk(conn, cat_slug: str):
    """
    Trailing returns and the full ratio set for every fund in one category.

    Everything is computed by the engine (trailing_return, risk_metrics,
    composite_risk_score); this only gathers it. Ratios use 3 years of monthly
    returns against the category benchmark, so a fund with under ~30 months of
    history shows returns but blank ratios.
    """
    row = conn.execute(
        "SELECT category_id, category_name, asset_class, benchmark_id "
        "FROM categories WHERE slug=?", (cat_slug,)
    ).fetchone()
    if not row:
        return
    cat_id, cat_name, asset_class, bench_id = row
    if asset_class not in ("Equity", "Hybrid"):
        return

    funds = conn.execute(
        "SELECT scheme_code, scheme_name FROM schemes "
        "WHERE category_id=? AND is_active=1 ORDER BY scheme_name", (cat_id,)
    ).fetchall()
    if not funds:
        return

    as_of = get_as_of(conn)
    as_of_d = date.fromisoformat(as_of)
    rf = float(conn.execute(
        "SELECT value FROM config WHERE key='risk_free_rate'").fetchone()[0])
    bench_name = None
    bench_last = None
    if bench_id is not None:
        r = conn.execute("SELECT index_name FROM benchmarks WHERE index_id=?",
                         (bench_id,)).fetchone()
        bench_name = r[0] if r else None
        bench_last = conn.execute("SELECT MAX(date) FROM index_history WHERE index_id=?",
                                  (bench_id,)).fetchone()[0]
    # A benchmark whose data stopped updating (a Yahoo ticker that went dead)
    # would measure funds up to today against an index frozen weeks ago. Keep the
    # fund-only ratios, blank the benchmark-relative ones, and say so on screen.
    bench_stale = bool(bench_last) and (
        as_of_d - date.fromisoformat(bench_last)).days > BENCHMARK_MAX_LAG_DAYS
    if bench_stale:
        log.warning("  %s: benchmark %s last updated %s — Alpha/Beta/Capture left blank",
                    cat_slug, bench_name, bench_last)

    rows = []
    for sc, name in funds:
        rets = {p: _risk_period_return(conn, sc, p, as_of_d) for p in RISK_RETURN_PERIODS}
        if all(v is None for v in rets.values()):
            continue   # no NAV at all -- nothing to show
        # With no benchmark the index query simply finds nothing, so the
        # fund-only ratios still come back and the relative ones are None.
        m = risk_metrics(conn, sc, bench_id, rf, as_of_d)
        if bench_stale:
            for k in BENCHMARK_RELATIVE_KEYS:
                m[k] = None
        m["scheme_code"] = sc
        m["scheme_name"] = name
        m["returns"] = rets
        rows.append(m)

    composite_risk_score(rows)

    def avg(values):
        vals = [v for v in values if v is not None]
        return fmt(sum(vals) / len(vals)) if vals else None

    fund_rows = [{
        "scheme_code": r["scheme_code"],
        "scheme_name": r["scheme_name"],
        "returns":     {p: fmt(r["returns"][p]) for p in RISK_RETURN_PERIODS},
        **{k: r.get(k) for k in RISK_RATIO_KEYS},
        "recovery_days": r.get("recovery_days"),
    } for r in rows]

    benchmark = None
    if bench_id is not None:
        benchmark = {
            "index_id": bench_id,
            "name":     bench_name,
            "returns":  {p: fmt(_risk_period_return(conn, bench_id, p, as_of_d, is_index=True))
                         for p in RISK_RETURN_PERIODS},
            "last_date": bench_last,
            "stale":    bench_stale,
        }

    write_json(out(f"risk_{cat_slug}.json"), {
        "as_of":          as_of,
        "category_name":  cat_name,
        "risk_free_rate": rf,
        "window":         "3Y monthly returns vs category benchmark",
        "periods":        RISK_RETURN_PERIODS,
        "benchmark":      benchmark,
        "category_average": {
            "returns": {p: avg([f["returns"][p] for f in fund_rows])
                        for p in RISK_RETURN_PERIODS},
            **{k: avg([f[k] for f in fund_rows]) for k in RISK_RATIO_KEYS},
        },
        "funds": fund_rows,
    })
    rated = sum(1 for f in fund_rows if f["sharpe"] is not None)
    log.info("✓ risk_%s.json (%d funds, %d with ratios)", cat_slug, len(fund_rows), rated)


# ── Whitelist Screener (screener_{slug}.json) ───────────────────────────────

SCREENER_CONFIG_PATH = os.path.join(ROOT_DIR, "data", "screener_config.json")


def load_screener_config() -> dict:
    with open(SCREENER_CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


_REFERENCE_CACHE: dict[str, set[str]] = {}


def _active_share_reference(cfg: dict) -> set[str]:
    """ISINs of the index whose stocks count as "common" (NIFTY 50)."""
    name = cfg.get("active_share_index") or "NIFTY 50"
    if name not in _REFERENCE_CACHE:
        if name != "NIFTY 50":
            log.warning("active_share_index %r not supported yet; using NIFTY 50", name)
        try:
            _REFERENCE_CACHE[name] = nifty50_isins(refresh=True)
        except OSError as exc:
            log.warning("NIFTY 50 constituents unavailable (%s); Active Share left blank", exc)
            _REFERENCE_CACHE[name] = set()
    return _REFERENCE_CACHE[name]


def _screener_holdings(codes: list[str]) -> dict:
    """Latest stored portfolio per fund; {} when Neon is unreachable."""
    try:
        return latest_holdings([str(c) for c in codes])
    except Exception as exc:     # holdings are optional — never fail the build
        log.warning("portfolio holdings unavailable (%s); Active Share left blank", exc)
        return {}


HORIZON_YEARS = {"1Y": 1, "3Y": 3, "5Y": 5}
HORIZON_PERIOD = {"1Y": "12M", "3Y": "3Y", "5Y": "5Y"}
# Ratio parameters measured at every horizon, and the risk_metrics key for each.
SCREENER_RATIOS = {
    "beta": "beta", "std_dev": "std_annual", "alpha": "alpha", "sharpe": "sharpe",
    "sortino": "sortino",
    "up_capture": "upside_capture", "down_capture": "downside_capture",
}
BENCH_RELATIVE = ("beta", "alpha", "up_capture", "down_capture",
                  "relative_risk", "relative_return")


def build_screener(conn, cat_slug: str, cfg: dict):
    """
    The house scorecard for one category, as the team's Excel builds it.

    Every ratio is measured over each horizon in cfg["ratio_horizons"] (1Y, 3Y,
    5Y), returns over cfg["return_periods"], and drawdown/recovery over each of
    cfg["bear_periods"]. The engine normalises each of those parts min-max within
    the category (screener_parameter_scores) and averages a parameter's parts.
    Funds without cfg["min_history"] of NAVs are listed as newly launched and not
    ranked. The page applies the editable weights; nothing else is computed there.
    """
    row = conn.execute(
        "SELECT category_id, category_name, asset_class, benchmark_id "
        "FROM categories WHERE slug=?", (cat_slug,)).fetchone()
    if not row:
        return
    cat_id, cat_name, asset_class, bench_id = row
    if asset_class not in ("Equity", "Hybrid"):
        return
    schemes = conn.execute(
        "SELECT scheme_code, scheme_name FROM schemes "
        "WHERE category_id=? AND is_active=1 ORDER BY scheme_name", (cat_id,)).fetchall()
    if not schemes:
        return

    as_of = get_as_of(conn)
    as_of_d = date.fromisoformat(as_of)
    rf = float(conn.execute("SELECT value FROM config WHERE key='risk_free_rate'").fetchone()[0])
    horizons = [h for h in cfg.get("ratio_horizons", ["1Y", "3Y", "5Y"]) if h in HORIZON_YEARS]
    periods = [p for p in cfg.get("return_periods", []) if p in RISK_RETURN_PERIODS]
    bears = cfg.get("bear_periods") or []
    min_hist = cfg.get("min_history") or "5Y"
    method = cfg.get("scoring") or "minmax"

    bench_name, bench_last = None, None
    if bench_id is not None:
        r = conn.execute("SELECT index_name FROM benchmarks WHERE index_id=?", (bench_id,)).fetchone()
        bench_name = r[0] if r else None
        bench_last = conn.execute("SELECT MAX(date) FROM index_history WHERE index_id=?",
                                  (bench_id,)).fetchone()[0]
    bench_ok = bool(bench_last) and (
        as_of_d - date.fromisoformat(bench_last)).days <= BENCHMARK_MAX_LAG_DAYS
    bench_std = {h: index_std_annual(conn, bench_id, as_of_d, HORIZON_YEARS[h]) if bench_ok else None
                 for h in horizons}
    bench_ret = {h: trailing_return_index(conn, bench_id, HORIZON_PERIOD[h], as_of_d) if bench_ok else None
                 for h in horizons}

    holdings = _screener_holdings([sc for sc, _ in schemes])
    reference = _active_share_reference(cfg)

    funds = []
    for sc, name in schemes:
        rets = {p: _risk_period_return(conn, sc, p, as_of_d) for p in periods}
        hist_ret = trailing_return(conn, sc, HORIZON_PERIOD.get(min_hist, min_hist), as_of_d)
        if all(v is None for v in rets.values()) and hist_ret is None:
            continue   # no usable NAV at all

        ratios: dict[str, dict[str, float | None]] = {k: {} for k in
                                                      list(SCREENER_RATIOS) + ["relative_risk", "relative_return"]}
        for h in horizons:
            m = risk_metrics(conn, sc, bench_id if bench_ok else None, rf, as_of_d,
                             years=HORIZON_YEARS[h], with_drawdown=False)
            for key, src in SCREENER_RATIOS.items():
                ratios[key][h] = m.get(src)
            std = m.get("std_annual")
            ratios["relative_risk"][h] = fmt(std / bench_std[h]) if std and bench_std[h] else None
            f_ret = m.get("fund_3y_cagr")   # the window's own return (1Y/3Y/5Y)
            ratios["relative_return"][h] = (fmt(f_ret - bench_ret[h])
                                            if f_ret is not None and bench_ret[h] is not None else None)
        if not bench_ok:
            for key in BENCH_RELATIVE:
                ratios[key] = {h: None for h in horizons}

        bear = []
        for b in bears:
            st = bear_period_stats(conn, sc, date.fromisoformat(b["start"]),
                                   date.fromisoformat(b["end"]), as_of_d)
            bear.append({**st, "fall": fmt(st["fall"])} if st else None)

        funds.append({
            "scheme_code": sc,
            "scheme_name": name,
            "eligible":    hist_ret is not None,
            "returns":     {p: fmt(v) for p, v in rets.items()},
            "ratios":      ratios,
            "bear":        bear,
            "active_share": (
                {**active_share_stats(holdings[str(sc)]["holdings"], reference),
                 "month": holdings[str(sc)]["month"]}
                if str(sc) in holdings and reference else None),
        })

    eligible = [f for f in funds if f["eligible"]]
    parts = [{
        **{k: [f["ratios"][k].get(h) for h in horizons] for k in f["ratios"]},
        "returns":       [f["returns"].get(p) for p in periods],
        "max_drawdown":  [b["fall"] if b else None for b in f["bear"]],
        "recovery_time": [b["recovery_days"] if b else None for b in f["bear"]],
        "active_share":  [(f["active_share"] or {}).get("uncommon_count")],

    } for f in eligible]
    for f, sc in zip(eligible, screener_parameter_scores(parts, method) if parts else []):
        f["scores"] = {k: (round(v, 2) if v is not None else None) for k, v in sc.items()}
    for f in funds:
        f.setdefault("scores", None)

    write_json(out(f"screener_{cat_slug}.json"), {
        "as_of":         as_of,
        "category_name": cat_name,
        "benchmark": {
            "name":    bench_name,
            "stale":   not bench_ok,
            "last_date": bench_last,
            "std_dev": {h: fmt(v) for h, v in bench_std.items()},
            "returns": {h: fmt(v) for h, v in bench_ret.items()},
        } if bench_id is not None else None,
        "horizons":        horizons,
        "periods":         periods,
        "bear_periods":    bears,
        "min_history":     min_hist,
        "scoring":         method,
        "default_weights": cfg.get("weights") or {},
        "funds":           funds,
    })
    log.info("✓ screener_%s.json (%d funds, %d ranked)", cat_slug, len(funds), len(eligible))


# ── Whitelist (whitelist.json) ──────────────────────────────────────────────

WHITELIST_PATH = os.path.join(ROOT_DIR, "data", "whitelist.json")
WHITELIST_QUARTILE_PERIODS = 4   # latest N periods shown per mode


def _read_out(filename: str):
    """A file this build already wrote, or None."""
    try:
        with open(out(filename), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _load_list(path: str, label: str) -> dict:
    """A hand-kept fund list (data/whitelist.json, data/blacklist.json)."""
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        log.warning("%s: cannot read %s (%s) — treating it as empty", label, path, exc)
        return {}


def fund_details(conn, entries: list[dict], note_key: str = "note") -> tuple[list[dict], list[str]]:
    """
    Latest NAV, recent quartiles, returns and ratios for each listed fund.

    Nothing is recalculated: quartiles come from quartiles_{slug}_{mode}.json and
    returns/ratios from risk_{slug}.json, both written earlier in this build, so
    a list can never disagree with the other tabs. Returns (funds, missing codes).
    """
    cache: dict[str, dict | None] = {}

    def cached(name: str):
        if name not in cache:
            cache[name] = _read_out(name)
        return cache[name]

    funds, missing = [], []
    for e in entries:
        code = str(e.get("scheme_code") or "").strip()
        if not code:
            continue
        row = conn.execute("""
            SELECT s.scheme_name, c.category_name, c.slug, c.asset_class
            FROM schemes s LEFT JOIN categories c ON c.category_id = s.category_id
            WHERE s.scheme_code = ?""", (code,)).fetchone()
        if not row:
            missing.append(code)
            continue
        name, cat_name, slug, asset_class = row

        navs = conn.execute(
            "SELECT nav_date, nav FROM nav_history WHERE scheme_code=? "
            "ORDER BY nav_date DESC LIMIT 2", (code,)).fetchall()

        quartiles = {}
        for mode in ("monthly", "quarterly", "annual"):
            q = cached(f"quartiles_{slug}_{mode}.json") if slug else None
            f = next((x for x in (q or {}).get("funds", []) if str(x["scheme_code"]) == code), None)
            if not f:
                continue
            n = WHITELIST_QUARTILE_PERIODS
            quartiles[mode] = {
                "labels":    q["period_labels"][-n:],
                "quartiles": f["quartiles"][-n:],
                "returns":   (f.get("returns") or [None] * len(f["quartiles"]))[-n:],
            }

        risk = cached(f"risk_{slug}.json") if slug else None
        rf = next((x for x in (risk or {}).get("funds", []) if str(x["scheme_code"]) == code), None)

        funds.append({
            "scheme_code":   code,
            "scheme_name":   name,
            "note":          e.get(note_key) or "",
            "category_name": cat_name,
            "category_slug": slug,
            "asset_class":   asset_class,
            "nav":           navs[0][1] if navs else None,
            "nav_date":      navs[0][0] if navs else None,
            "change_1d":     fmt(navs[0][1] / navs[1][1] - 1) if len(navs) == 2 and navs[1][1] else None,
            "quartiles":     quartiles,
            "returns":       rf["returns"] if rf else None,
            "ratios":        {k: rf.get(k) for k in RISK_RATIO_KEYS} if rf else None,
        })
    return funds, missing


def build_whitelist(conn):
    """One row per fund on data/whitelist.json, for the email alerts."""
    entries = _load_list(WHITELIST_PATH, "whitelist").get("funds") or []
    as_of = get_as_of(conn)
    funds, missing = fund_details(conn, entries)

    if missing:
        log.warning("whitelist: %d code(s) not in the catalogue: %s",
                    len(missing), ", ".join(missing))
    write_json(out("whitelist.json"), {
        "as_of":   as_of,
        "funds":   funds,
        "missing": missing,
    })
    log.info("✓ whitelist.json (%d funds%s)", len(funds),
             f", {len(missing)} not found" if missing else "")


# ── Blacklist (blacklist.json) ──────────────────────────────────────────────

BLACKLIST_PATH = os.path.join(ROOT_DIR, "data", "blacklist.json")

# Defaults for the automatic rules; data/blacklist.json "rules" overrides any.
BLACKLIST_RULE_DEFAULTS = {
    "bottom_quartile_periods": ["3M", "12M", "3Y"],
    "negative_alpha_horizons": ["3Y", "5Y"],
    "rolling_window": "1Y",
    "rolling_min_beat": 0.40,
    "downside_capture_max": 100,
    "downside_capture_strict_categories": ["small-cap", "mid-cap"],
    "tracking_error_categories": ["large-cap"],
    "tracking_error_top_share": 0.25,
    "min_track_record_years": 3,
    "track_record_exempt_categories": ["multi-cap"],
    "bottom_3m_categories": ["multi-cap"],
    "high_beta_categories": ["value-contra", "dividend-yield"],
    "high_beta_max": 1.0,
}
PERIOD_NAME = {"12M": "1Y"}

# Default % weight of each rule in the Blacklist Score (editable on the page).
BLACKLIST_WEIGHT_DEFAULTS = {
    "bottom_quartile": 20, "negative_alpha": 20, "rolling_consistency": 15,
    "downside_capture": 15, "high_beta": 10, "tracking_error": 10,
    "short_track_record": 5, "bottom_3m": 5,
}


def _pct(v: float) -> str:
    return f"{v * 100:+.1f}%"


def build_blacklist(conn, categories, screener_cfg: dict):
    """
    blacklist.json, public. Two sections:

      manual  the team's list in data/blacklist.json, with reasons
              (fund_details, same details as any list);
      funds   every Equity/Hybrid fund with the result of each automatic rule:
              {"fail": true/false, or null when the rule does not apply to the
              fund's category or the data is missing, "value": what was measured,
              "text": the failure spelled out}. The page weights the failed rules
              (editable, defaults in data/blacklist.json "weights") into a
              Blacklist Score and lists funds above a cut-off.

    The rules are the NAV-based part of the team's blacklist criteria; the
    holdings-based ones wait for holdings coverage. Thresholds come from
    BLACKLIST_RULE_DEFAULTS, overridden by data/blacklist.json "rules".
    """
    cfg = _load_list(BLACKLIST_PATH, "blacklist")
    rules = {**BLACKLIST_RULE_DEFAULTS, **(cfg.get("rules") or {})}
    manual, missing = fund_details(conn, cfg.get("funds") or [], note_key="reason")
    as_of = get_as_of(conn)
    as_of_d = date.fromisoformat(as_of)

    def res(fail, value, text=""):
        return {"fail": fail, "value": value, "text": text if fail else ""}

    NA = {"fail": None, "value": None, "text": ""}
    out_funds = []
    for _, slug, asset_class in categories:
        if asset_class not in ("Equity", "Hybrid"):
            continue
        risk = _read_out(f"risk_{slug}.json")
        scr = _read_out(f"screener_{slug}.json")
        if not risk or not risk.get("funds"):
            continue
        cat_name = risk["category_name"]
        bench = risk.get("benchmark") or {}
        bench_id = bench.get("index_id")
        bench_ok = bool(bench_id) and not bench.get("stale")
        ratios = {f["scheme_code"]: f["ratios"] for f in (scr or {}).get("funds", [])}
        funds = risk["funds"]
        sectors = sector_map([(f["scheme_code"], f["scheme_name"]) for f in funds], slug)

        quart = {}
        for p in set(rules["bottom_quartile_periods"]) | {"3M"}:
            rq = rank_within_sectors({f["scheme_code"]: f["returns"].get(p) for f in funds}, sectors)
            quart[p] = {c: q for c, (_r, q) in rq.items()}

        te, te_cut = {}, None
        if slug in rules["tracking_error_categories"] and bench_ok:
            for f in funds:
                te[f["scheme_code"]] = tracking_error(conn, f["scheme_code"], bench_id, as_of_d)
            vals = sorted(v for v in te.values() if v is not None)
            if len(vals) >= 4:
                te_cut = vals[int(len(vals) * (1 - rules["tracking_error_top_share"]))]

        for f in funds:
            code = f["scheme_code"]
            r = ratios.get(code) or {}
            out = {}

            # Persistent laggard
            qs = [quart[p].get(code) for p in rules["bottom_quartile_periods"]]
            if all(q is not None for q in qs):
                out["bottom_quartile"] = res(
                    all(q == 4 for q in qs), " · ".join(f"Q{q}" for q in qs),
                    "Bottom quartile on " + ", ".join(PERIOD_NAME.get(p, p) for p in rules["bottom_quartile_periods"]))
            else:
                out["bottom_quartile"] = NA

            # Negative alpha
            alphas = [(r.get("alpha") or {}).get(h) for h in rules["negative_alpha_horizons"]]
            if bench_ok and all(a is not None for a in alphas):
                out["negative_alpha"] = res(
                    all(a < 0 for a in alphas), " / ".join(f"{a * 100:.2f}" for a in alphas),
                    "Negative alpha " + ", ".join(f"{h} {a * 100:.2f}"
                                                  for h, a in zip(rules["negative_alpha_horizons"], alphas)))
            else:
                out["negative_alpha"] = NA

            # Rolling consistency
            beat = (rolling_statistics(conn, code, bench_id, rules["rolling_window"], as_of_d)
                    .get("pct_beats_benchmark") if bench_ok else None)
            out["rolling_consistency"] = NA if beat is None else res(
                beat < rules["rolling_min_beat"], f"{beat * 100:.0f}%",
                f"Beat benchmark in only {beat * 100:.0f}% of rolling {rules['rolling_window']} periods")

            # Downside capture
            dc = r.get("down_capture") or {}
            horizons = ["1Y", "3Y"] if slug in rules["downside_capture_strict_categories"] else ["3Y"]
            got = [(h, dc.get(h)) for h in horizons if dc.get(h) is not None]
            if bench_ok and got:
                over = [(h, v) for h, v in got if v > rules["downside_capture_max"]]
                out["downside_capture"] = res(
                    bool(over), " · ".join(f"{h} {v:.0f}" for h, v in got),
                    "Downside capture " + ", ".join(f"{h} {v:.0f}" for h, v in over)
                    + f" (above {rules['downside_capture_max']})")
            else:
                out["downside_capture"] = NA

            # Tracking error with negative alpha (large cap)
            a3 = (r.get("alpha") or {}).get("3Y")
            if te_cut is not None and te.get(code) is not None and a3 is not None:
                out["tracking_error"] = res(
                    te[code] >= te_cut and a3 < 0, f"{te[code] * 100:.1f}%",
                    f"High tracking error {te[code] * 100:.1f}% with negative 3Y alpha")
            else:
                out["tracking_error"] = NA

            # Short track record
            if slug in rules["track_record_exempt_categories"]:
                out["short_track_record"] = NA
            else:
                first = conn.execute("SELECT MIN(nav_date) FROM nav_history WHERE scheme_code=?",
                                     (code,)).fetchone()[0]
                if first:
                    yrs = (as_of_d - date.fromisoformat(first)).days / 365.25
                    out["short_track_record"] = res(
                        yrs < rules["min_track_record_years"], f"{yrs:.1f}y",
                        f"Short track record ({yrs:.1f} years)")
                else:
                    out["short_track_record"] = NA

            # Multi cap: bottom of pack on 3M
            q3 = quart["3M"].get(code)
            out["bottom_3m"] = (res(q3 == 4, f"Q{q3}", "Bottom quartile on 3-month return")
                                if slug in rules["bottom_3m_categories"] and q3 is not None else NA)

            # Value / dividend yield: high beta
            b3 = (r.get("beta") or {}).get("3Y")
            out["high_beta"] = (res(b3 > rules["high_beta_max"], f"{b3:.2f}", f"High beta {b3:.2f} for a value mandate")
                                if slug in rules["high_beta_categories"] and bench_ok and b3 is not None else NA)

            out_funds.append({
                "scheme_code":   code,
                "scheme_name":   f["scheme_name"],
                "category_name": cat_name,
                "category_slug": slug,
                "asset_class":   asset_class,
                "rules":         out,
                "return_1y":     f["returns"].get("12M"),
                "return_3y":     f["returns"].get("3Y"),
            })

    write_json(out("blacklist.json"), {
        "as_of":           as_of,
        "rules":           rules,
        "default_weights": {**BLACKLIST_WEIGHT_DEFAULTS, **(cfg.get("weights") or {})},
        "default_min_score": cfg.get("min_score", 20),
        "manual":          manual,
        "missing":         missing,
        "funds":           out_funds,
    })
    failing = sum(1 for f in out_funds if any(v["fail"] for v in f["rules"].values()))
    log.info("✓ blacklist.json (%d listed, %d funds checked, %d fail a rule)",
             len(manual), len(out_funds), failing)


# ── Index series (index/{index_id}.json) ─────────────────────────────────────

def build_index_series(conn):
    indices = conn.execute("SELECT index_id, index_name FROM benchmarks WHERE is_active=1").fetchall()
    for index_id, name in indices:
        rows = conn.execute(
            "SELECT date, close FROM index_history WHERE index_id=? ORDER BY date", (index_id,)
        ).fetchall()
        write_json(out(f"index/{index_id}.json"), {"index_id": index_id, "index_name": name, "series": rows})
    log.info("✓ %d index series written", len(indices))


# ── Main orchestrator ─────────────────────────────────────────────────────────

def main():
    conn = _get_conn()
    as_of = get_as_of(conn)
    log.info("Building JSON outputs. Data as of: %s", as_of)

    # Only what the tabs read. Market Pulse takes meta.json, indices.json
    # and index/{id}.json; Quartile Ranking takes quartiles_{slug}_{mode}.json;
    # Risk & Returns takes risk_{slug}.json; Fund Signals takes
    # watchlist_{mode}.json. Nothing else is computed.
    build_meta(conn)
    build_indices(conn)

    categories = conn.execute(
        "SELECT category_id, slug, asset_class FROM categories ORDER BY display_order"
    ).fetchall()

    # Quartiles are Equity and Hybrid only — ranking a gilt fund against its
    # peers on total return is not a comparison anyone should act on, and the
    # front end offers no debt category either.
    for _, slug, asset_class in categories:
        if asset_class not in ("Equity", "Hybrid"):
            continue
        log.info("Processing category: %s", slug)
        for mode in ["monthly", "quarterly", "annual"]:
            build_quartiles(conn, slug, mode)
        build_risk(conn, slug)

    # Cross-category streak signals — one file per mode.
    for mode in ["monthly", "quarterly", "annual"]:
        build_watchlist(conn, mode)

    # Both read the quartile and risk files written above, so they come after.
    screener_cfg = load_screener_config()
    for _, slug, asset_class in categories:
        if asset_class in ("Equity", "Hybrid"):
            build_screener(conn, slug, screener_cfg)
    build_whitelist(conn)
    build_blacklist(conn, categories, screener_cfg)

    build_index_series(conn)

    log.info("✅  All JSON outputs written to %s", OUTPUT_DIR)
    conn.close()


if __name__ == "__main__":
    main()

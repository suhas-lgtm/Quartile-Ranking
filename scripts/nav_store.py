"""
nav_store.py — NAV history kept in Neon, extended from AMFI.

    Neon nav_history  ──read──►  add today from AMFI  ──gate──►  DB  ──►  Neon
                                 (mfapi bootstraps any fund Neon lacks)

WHY
The daily run used to re-download every fund's ENTIRE history from api.mfapi.in
on every single run: ~3.5 million rows, ~2,050 HTTP requests, for data that had
not changed below its last day. Now the history lives in the nav_history table
and each run only adds what is new.

WHAT SUPPLIES WHAT
    Neon       every NAV up to and including the last accepted day. Authority
               for history.
    AMFI       the newest day only. NAVAll.txt is a snapshot -- one row per fund,
               today -- and there is no history endpoint, so it can never do more
               than extend the series by its own date.
    mfapi      BOOTSTRAP ONLY, and only for a fund Neon holds no rows for (a
               newly launched scheme, or the first run against an empty
               database). Its rows are written to Neon so it is asked once.

WHY A GATE
Overwriting a good history with a short one is the failure that matters, and it
is silent -- returns simply start reading None. So a fund's series is only
accepted if it still has at least MIN_POINTS_FLOOR points, has not shrunk past
MAX_SHRINK of what is stored, and its newest date has not gone backwards.
A fund that fails is kept at its STORED series rather than the new one. Writes
to Neon are append-only (ON CONFLICT DO NOTHING), so no run can rewrite a day.
"""
from __future__ import annotations

import logging
from datetime import datetime

log = logging.getLogger("nav_store")

# A series is a plain {iso_date: nav}; dicts merge by date, which is the whole
# point -- the same day arriving twice cannot duplicate a row.
Series = dict[str, float]

# Gates, mirroring index_store.validate_one.
#
# The floor is 1, not some comfortable minimum: a fund launched this week
# legitimately has a single NAV. Setting it to 2 rejected the three JioBlackRock
# funds on their first days, which was pure noise -- there was nothing to protect,
# because the stored series was that same single point. Only an EMPTY series is
# invalid. The shrink and date-regression checks below do the real work.
MIN_POINTS_FLOOR = 1
MAX_SHRINK = 0.90         # may not fall below 90% of what is already stored

# Bad-data tripwire on the day AMFI adds, imported rather than restated so the
# two AMFI paths cannot disagree about what counts as impossible. Measured across
# 400 funds the widest real one-day move was 1.386%; this catches NAV
# re-denominations, not market moves.
from scripts.amfi_topup import MAX_ONE_DAY_MOVE  # noqa: E402


# ── unit splits ─────────────────────────────────────────────────────────────
#
# ETFs (and the odd liquid fund) split their units — 1:10 is common, gold ETFs
# have done 1:100 — so the NAV per unit falls by that factor overnight while an
# investor's holding is unchanged. Unadjusted, every return spanning the split
# reads as a -90% crash. 37 such splits were in the data by September 2026.
#
# A day-on-day ratio within SPLIT_TOLERANCE of 1/k (or k, a consolidation) for a
# k in SPLIT_FACTORS is treated as a split. No real fund moves 50%+ in a day
# (the widest genuine move measured was ~13%), so these cannot be mistaken for
# market moves. The raw NAVs stay as published; only the series the engine
# computes from is adjusted.
SPLIT_FACTORS = (2, 3, 4, 5, 10, 20, 25, 50, 100, 1000)
SPLIT_TOLERANCE = 0.06


def split_factor(ratio: float) -> float | None:
    """k when new/old NAV looks like a 1:k split (1/k for a k:1 consolidation)."""
    if ratio <= 0:
        return None
    for k in SPLIT_FACTORS:
        if abs(ratio * k - 1) <= SPLIT_TOLERANCE:
            return float(k)
        if abs(ratio / k - 1) <= SPLIT_TOLERANCE:
            return 1.0 / k
    return None


def adjust_for_splits(series: Series) -> tuple[Series, list[tuple[str, float]]]:
    """
    (series restated in today's units, [(split date, factor), ...]).

    Every NAV before a split is divided by the split's factor, so returns across
    it are continuous. With no split the series comes back unchanged.
    """
    dates = sorted(series)
    splits = []
    for prev_d, d in zip(dates, dates[1:]):
        prev = series[prev_d]
        if prev > 0:
            k = split_factor(series[d] / prev)
            if k is not None:
                splits.append((d, k))
    if not splits:
        return series, []
    out: Series = {}
    for d in dates:
        f = 1.0
        for sd, k in splits:
            if sd > d:
                f *= k
        out[d] = series[d] / f
    return out, splits


def pull_stored(codes: list[str], from_date: str | None = None) -> dict[str, Series]:
    """
    Stored series for many funds. A fund with no rows is simply missing from
    the result, which is what marks it as needing a bootstrap.
    """
    from scripts import neon_store as db

    if not db.enabled():
        log.warning("Neon not configured (%s) — no stored history to read",
                    db.why_disabled())
        return {}
    out = db.read_nav_history(codes, from_date)
    log.info("Neon: read history for %s of %s fund(s)",
             f"{len(out):,}", f"{len(codes):,}")
    return out


def new_rows(series_by_code: dict[str, Series], stored: dict[str, Series]):
    """(code, date, nav) for every day a series holds that Neon does not."""
    for code, s in series_by_code.items():
        have = stored.get(code, {})
        for d, v in s.items():
            if d not in have:
                yield code, d, v


def validate(new: Series, published: Series) -> list[str]:
    """Reasons not to trust `new`. Empty list means it is safe to use."""
    problems = []
    if len(new) < MIN_POINTS_FLOOR:
        problems.append(f"only {len(new)} point(s)")
    if published:
        if len(new) < len(published) * MAX_SHRINK:
            problems.append(f"shrank to {len(new)} from {len(published)} "
                            f"({len(new) / len(published):.0%})")
        if new and max(new) < max(published):
            problems.append(f"newest date went backwards: "
                            f"{max(published)} -> {max(new)}")
    return problems


def merge_amfi(series_by_code: dict[str, Series],
               amfi: dict[str, tuple[str, float]],
               cap: str | None = None) -> dict:
    """
    Extend each fund's series with AMFI's latest row.

    AMFI is only ever allowed to ADD a date. A row for a day the fund already has
    is ignored rather than overwritten: the published value came from the same
    source a day earlier and rewriting history is exactly what this design is
    meant to avoid. `cap` (an ISO date) drops anything newer, so the previous-day
    rule stays in one place.

    A NAV moving more than MAX_ONE_DAY_MOVE from the fund's last known value is
    REFUSED. This guard matters far more here than it did on the old path.
    Previously a bad AMFI value landed in a throwaway database and the next run
    rebuilt the whole history from api.mfapi.in, washing it out. Now the history
    IS what we published, and AMFI cannot rewrite a day it has already given us —
    so one bad value would be baked in permanently and every future run would
    faithfully carry it forward.
    """
    stats = {"extended": 0, "already_current": 0, "absent_from_amfi": 0,
             "capped": 0, "rejected_move": 0}
    rejected: list[tuple[str, float, str, float, float]] = []
    for code, series in series_by_code.items():
        row = amfi.get(str(code))
        if row is None:
            stats["absent_from_amfi"] += 1
            continue
        d, nav = row
        if cap and d > cap:
            stats["capped"] += 1
            continue
        if d in series:
            stats["already_current"] += 1
            continue
        if series and d < max(series):
            # Older than what we hold: a wound-up fund AMFI still lists at the
            # price it died at. Nothing to add.
            stats["already_current"] += 1
            continue
        if series:
            prev_date = max(series)
            prev = series[prev_date]
            # A unit split is not a bad value: accept it (adjust_for_splits
            # restates the history later). Refusing it would freeze the fund,
            # since every later NAV would be refused against the old level too.
            if (prev > 0 and abs(nav / prev - 1) > MAX_ONE_DAY_MOVE
                    and split_factor(nav / prev) is None):
                stats["rejected_move"] += 1
                rejected.append((code, prev, d, nav, abs(nav / prev - 1)))
                continue
        series[d] = nav
        stats["extended"] += 1

    if rejected:
        log.warning("AMFI: refused %d NAV(s) moving more than %.0f%% in a day — "
                    "the series keeps its last published value:",
                    len(rejected), MAX_ONE_DAY_MOVE * 100)
        for code, prev, d, nav, move in sorted(rejected, key=lambda r: -r[4])[:10]:
            log.warning("   %s  %.4f -> %s %.4f  (%.1f%%)",
                        code, prev, d, nav, move * 100)
    return stats


def previous_day_cap(now: datetime | None = None) -> str:
    """
    Same rule as build_db_from_api.previous_business_close, imported from there
    so there is one definition.
    """
    from scripts.build_db_from_api import previous_business_close
    return previous_business_close(now)


def summarise(series_by_code: dict[str, Series]) -> dict:
    total = sum(len(s) for s in series_by_code.values())
    newest = max((max(s) for s in series_by_code.values() if s), default=None)
    oldest = min((min(s) for s in series_by_code.values() if s), default=None)
    return {"funds": len(series_by_code), "rows": total,
            "newest": newest, "oldest": oldest}

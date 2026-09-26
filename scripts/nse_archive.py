"""
nse_archive.py — official daily closes of NSE indices, from NSE's public archive.

NSE publishes one CSV per trading day with the close of every index it runs:

    https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv

Yahoo Finance stopped carrying history for most NSE sector indices in June 2026
(^CNXAUTO, ^CNXMEDIA, ... return only the latest close), which left a three-month
hole in the Market Pulse sector files and blanked their SIP returns. fill_gaps()
repairs such holes from this archive: for an NSE index, every weekday missing
between two stored closes (or after the last one) is looked up here. Holidays
have no file (404) and are simply skipped.

Best-effort: a failed download leaves that day missing, never breaks a refresh.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, timedelta

import requests

log = logging.getLogger("nse_archive")

URL = "https://nsearchives.nseindia.com/content/indices/ind_close_all_{d:%d%m%Y}.csv"
UA = {"User-Agent": "Mozilla/5.0 (MF-Research internal tool)"}

# Our index_id -> NSE's name in the archive. SENSEX is BSE's, gold is an ETF: neither is here.
NSE_NAMES: dict[int, str] = {
    1: "Nifty 50", 3: "Nifty 100", 4: "Nifty Bank", 5: "Nifty 500",
    6: "Nifty Midcap 150", 7: "Nifty Smallcap 250",
    10: "Nifty IT", 26: "Nifty Pharma", 24: "Nifty Healthcare Index",
    21: "Nifty Financial Services", 27: "Nifty Private Bank", 28: "Nifty PSU Bank",
    20: "Nifty Auto", 23: "Nifty FMCG", 30: "Nifty Consumer Durables", 25: "Nifty Metal",
    35: "Nifty Energy", 31: "Nifty Oil & Gas", 45: "Nifty Infrastructure", 29: "Nifty Realty",
    54: "Nifty Media", 48: "Nifty PSE", 34: "Nifty CPSE",
}

# Consecutive stored closes further apart than this are checked for missing days
# (a weekend plus a holiday on each side is 4).
MAX_NORMAL_GAP_DAYS = 4
# How far back holes are repaired; older history was complete when it was written.
LOOKBACK_DAYS = 400

_cache: dict[date, dict[str, float] | None] = {}


def closes_on(day: date, session: requests.Session | None = None) -> dict[str, float] | None:
    """{NSE index name: close} for one trading day; None on a holiday or failure."""
    if day in _cache:
        return _cache[day]
    out = None
    try:
        r = (session or requests).get(URL.format(d=day), headers=UA, timeout=30)
        if r.ok and r.text.startswith("Index Name"):
            out = {}
            for row in csv.DictReader(io.StringIO(r.text)):
                try:
                    out[row["Index Name"].strip()] = float(row["Closing Index Value"])
                except (KeyError, TypeError, ValueError):
                    continue
    except requests.RequestException as exc:
        log.warning("NSE archive %s unavailable (%s)", day, exc)
    _cache[day] = out
    return out


def _weekdays(after: date, before: date):
    d = after + timedelta(days=1)
    while d < before:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def fill_gaps(index_id: int, points: dict[str, float], cap: str,
              session: requests.Session | None = None) -> tuple[dict[str, float], int]:
    """
    Fill missing trading days of an NSE index from the archive: holes between
    stored closes in the last LOOKBACK_DAYS, and the days after the last close
    up to `cap`. Returns (points, number of days added).
    """
    name = NSE_NAMES.get(index_id)
    if not name or not points:
        return points, 0
    floor = date.fromisoformat(cap) - timedelta(days=LOOKBACK_DAYS)
    days = sorted(date.fromisoformat(d) for d in points)
    wanted: list[date] = []
    for a, b in zip(days, days[1:]):
        if b >= floor and (b - a).days > MAX_NORMAL_GAP_DAYS:
            wanted += [d for d in _weekdays(max(a, floor - timedelta(days=1)), b)]
    cap_d = date.fromisoformat(cap)
    if days[-1] < cap_d:
        wanted += list(_weekdays(days[-1], cap_d + timedelta(days=1)))
    added = 0
    s = session or requests.Session()
    for d in wanted:
        row = closes_on(d, s)
        if row and name in row and d.isoformat() not in points:
            points[d.isoformat()] = row[name]
            added += 1
    return points, added

"""
data_health.py — is the dashboard's data up to date? Raise the alarm when not.

Run after the daily pipeline (and on its own: `python scripts/data_health.py`).
It looks at what is actually PUBLISHED, i.e. what the team sees:

  Mutual fund NAVs   meta.json's as_of   must be the last working day
  SIF NAVs           sif.json's as_of    must be the last working day
  Monthly holdings   portfolio_holdings  last month's portfolios must be in by
                                         the 12th (AMCs publish by about the 10th)
                                         for most funds
  Market Pulse       index files         refreshed within the last few days

Each check is ok, warn (worth a look: one working day late may be a market
holiday) or fail (data is stale). The result is written to health.json in the
published data, so the dashboard shows a banner to everyone, and a fail ends
the script with exit code 1, so the GitHub run is marked failed and GitHub
emails the repository owner. No Brevo mail is sent from here.

  python scripts/data_health.py              check, publish health.json, exit 1 on a fail
  python scripts/data_health.py --no-publish check and print only
  python scripts/data_health.py --no-fail    never exit 1 (report only)
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

log = logging.getLogger("data_health")
IST = timezone(timedelta(hours=5, minutes=30))

# Thresholds, in one place.
HOLDINGS_DUE_DAY = 12          # last month's holdings expected from this day of the month
HOLDINGS_FAIL_DAY = 16         # still missing from this day: fail, not just warn
HOLDINGS_MIN_COVERAGE = 0.70   # share of funds that must have the expected month
INDEX_WARN_DAYS = 4            # Market Pulse files older than this: warn


# ── date helpers (pure, tested in tests/test_data_health.py) ─────────────────

def is_working_day(d: date) -> bool:
    return d.weekday() < 5


def previous_working_day(d: date) -> date:
    """The last Monday–Friday strictly before `d`."""
    d -= timedelta(days=1)
    while not is_working_day(d):
        d -= timedelta(days=1)
    return d


def working_days_behind(as_of: date, expected: date) -> int:
    """How many working days `as_of` is short of `expected` (0 when on time or ahead)."""
    n, d = 0, as_of
    while d < expected:
        d += timedelta(days=1)
        if is_working_day(d):
            n += 1
    return n


def expected_holdings_month(today: date) -> str:
    """'YYYY-MM' that should be loaded by now: last month from the due day, else the month before."""
    back = 1 if today.day >= HOLDINGS_DUE_DAY else 2
    y, m = today.year, today.month - back
    while m < 1:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


# ── the checks (pure) ────────────────────────────────────────────────────────

def check_nav(name: str, as_of: str | None, today: date) -> dict:
    """NAVs must reach the last working day; one day short may be a holiday (warn), more is stale (fail)."""
    expected = previous_working_day(today)
    if not as_of:
        return {"name": name, "status": "fail", "message": f"{name}: no NAV date found in the published data."}
    try:
        got = date.fromisoformat(as_of[:10])
    except ValueError:
        return {"name": name, "status": "fail", "message": f"{name}: unreadable NAV date {as_of!r}."}
    behind = working_days_behind(got, expected)
    nice = got.strftime("%d %b %Y")
    if behind == 0:
        return {"name": name, "status": "ok", "message": f"{name} up to date (NAVs of {nice})."}
    if behind == 1:
        return {"name": name, "status": "warn",
                "message": f"{name}: latest NAVs are of {nice}, one working day behind — fine if that day was a market holiday."}
    return {"name": name, "status": "fail",
            "message": f"{name} NOT updated: latest NAVs are of {nice}, {behind} working days behind."}


def check_holdings(latest_month: str | None, coverage: float | None, funds: int, today: date) -> dict:
    """Last month's portfolios should be in for most funds by the due day."""
    name = "Monthly holdings"
    want = expected_holdings_month(today)
    late = "fail" if today.day >= HOLDINGS_FAIL_DAY or today.day < HOLDINGS_DUE_DAY else "warn"
    if not latest_month:
        return {"name": name, "status": "fail", "message": "Monthly holdings: none stored at all."}
    month_name = datetime.strptime(want, "%Y-%m").strftime("%B %Y")
    if latest_month < want:
        have = datetime.strptime(latest_month, "%Y-%m").strftime("%B %Y")
        return {"name": name, "status": late,
                "message": f"Monthly holdings for {month_name} have NOT appeared yet — latest loaded is {have}. "
                           f"Overlap, sectors and Active Share still use {have}."}
    if coverage is not None and coverage < HOLDINGS_MIN_COVERAGE:
        return {"name": name, "status": late,
                "message": f"Monthly holdings for {month_name} loaded for only {coverage:.0%} of {funds} funds "
                           f"(at least {HOLDINGS_MIN_COVERAGE:.0%} expected)."}
    return {"name": name, "status": "ok",
            "message": f"Monthly holdings up to date ({month_name}, {coverage:.0%} of {funds} funds)."
                       if coverage is not None else f"Monthly holdings up to date ({month_name})."}


def check_indices(updated: datetime | None, now: datetime) -> dict:
    name = "Market Pulse indices"
    if not updated:
        return {"name": name, "status": "warn", "message": "Market Pulse indices: no files found."}
    age = (now - updated).days
    if age > INDEX_WARN_DAYS:
        return {"name": name, "status": "warn", "message": f"Market Pulse indices last refreshed {age} days ago."}
    return {"name": name, "status": "ok", "message": "Market Pulse indices up to date."}


def overall(checks: list[dict]) -> str:
    st = {c["status"] for c in checks}
    return "fail" if "fail" in st else "warn" if "warn" in st else "ok"


# ── reading what is published ────────────────────────────────────────────────

def _body(conn, bucket: str, path: str) -> dict | None:
    row = conn.execute("SELECT body FROM files WHERE bucket=%s AND path=%s", (bucket, path)).fetchone()
    if not row:
        return None
    b = bytes(row[0]) if not isinstance(row[0], str) else row[0].encode("utf-8")
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    return json.loads(b)


def gather(conn, data_bucket: str) -> dict:
    meta = _body(conn, data_bucket, "meta.json") or {}
    sif = _body(conn, data_bucket, "sif.json") or {}
    h = conn.execute("""
        WITH latest AS (SELECT scheme_code, MAX(month) AS month FROM portfolio_holdings GROUP BY scheme_code)
        SELECT to_char(MAX(month), 'YYYY-MM'), COUNT(*),
               COUNT(*) FILTER (WHERE month = (SELECT MAX(month) FROM latest)) FROM latest""").fetchone()
    idx = conn.execute("SELECT MAX(updated_at) FROM files WHERE bucket = 'Indicies Data'").fetchone()
    return {
        "mf_as_of": meta.get("as_of"), "sif_as_of": sif.get("as_of"),
        "holdings_month": h[0] if h else None, "holdings_funds": int(h[1] or 0) if h else 0,
        "holdings_latest_funds": int(h[2] or 0) if h else 0,
        "indices_updated": idx[0] if idx else None,
    }


def evaluate(facts: dict, now: datetime) -> dict:
    today = now.astimezone(IST).date()
    funds = facts.get("holdings_funds") or 0
    coverage = (facts.get("holdings_latest_funds") or 0) / funds if funds else None
    upd = facts.get("indices_updated")
    checks = [
        check_nav("Mutual fund NAVs", facts.get("mf_as_of"), today),
        check_nav("SIF NAVs", facts.get("sif_as_of"), today),
        check_holdings(facts.get("holdings_month"), coverage, funds, today),
        check_indices(upd if isinstance(upd, datetime) else None, now),
    ]
    return {"checked_at": now.astimezone(IST).isoformat(timespec="minutes"), "status": overall(checks), "checks": checks}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-publish", action="store_true", help="print only; do not write health.json")
    ap.add_argument("--no-fail", action="store_true", help="always exit 0")
    a = ap.parse_args()

    from scripts import neon_store as db
    if not db.enabled():
        log.error("Neon not configured (%s)", db.why_disabled())
        return 0 if a.no_fail else 1
    with db.connect() as conn:
        facts = gather(conn, db.DATA_BUCKET)
    report = evaluate(facts, datetime.now(timezone.utc))

    for c in report["checks"]:
        mark = {"ok": "✔", "warn": "⚠", "fail": "✘"}[c["status"]]
        log.info("%s %s", mark, c["message"])
        # GitHub shows these on the run's summary page.
        if c["status"] == "fail":
            print(f"::error title={c['name']}::{c['message']}")
        elif c["status"] == "warn":
            print(f"::warning title={c['name']}::{c['message']}")
    log.info("overall: %s", report["status"].upper())

    if not a.no_publish:
        body = json.dumps(report, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if db.upload_bytes(body, "health.json", bucket=db.DATA_BUCKET, content_type="application/json",
                           cache_control="max-age=300"):
            log.info("health.json published (the dashboard shows a banner unless all is ok)")
        else:
            log.warning("health.json could not be published")
    return 1 if report["status"] == "fail" and not a.no_fail else 0


if __name__ == "__main__":
    sys.exit(main())

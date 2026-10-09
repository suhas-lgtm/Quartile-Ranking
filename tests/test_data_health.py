"""
The data health check (scripts/data_health.py): when the dashboard must warn
that NAVs or monthly holdings are behind. Pure date logic — no network, no Neon.

Run:  python tests/test_data_health.py        (or python -m pytest tests -q)
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from scripts.data_health import (  # noqa: E402
    check_holdings, check_indices, check_nav, evaluate, expected_holdings_month,
    overall, previous_working_day, working_days_behind,
)

# October 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8, Fri 9, Sat 10, Mon 12 ...
MON, TUE, FRI, SAT = date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 9), date(2026, 10, 10)


def test_previous_working_day_skips_the_weekend():
    assert previous_working_day(MON) == date(2026, 10, 2)          # Monday looks back to Friday
    assert previous_working_day(TUE) == MON
    assert previous_working_day(SAT) == FRI                        # Saturday's run expects Friday's NAV
    assert previous_working_day(date(2026, 10, 11)) == FRI         # Sunday too


def test_working_days_behind_counts_only_weekdays():
    assert working_days_behind(FRI, FRI) == 0
    assert working_days_behind(date(2026, 10, 12), FRI) == 0      # ahead counts as on time
    assert working_days_behind(date(2026, 10, 2), MON) == 1       # Fri → Mon is one working day
    assert working_days_behind(date(2026, 10, 1), MON) == 2


def test_expected_holdings_month_turns_over_on_the_12th():
    assert expected_holdings_month(date(2026, 10, 9)) == '2026-08'    # before the 12th: two months back
    assert expected_holdings_month(date(2026, 10, 12)) == '2026-09'   # from the 12th: last month
    assert expected_holdings_month(date(2026, 1, 5)) == '2025-11'     # across the year end
    assert expected_holdings_month(date(2026, 1, 20)) == '2025-12'
    assert expected_holdings_month(date(2026, 2, 3)) == '2025-12'


def test_nav_on_time_is_ok():
    assert check_nav('Mutual fund NAVs', '2026-10-08', FRI)['status'] == 'ok'
    assert check_nav('Mutual fund NAVs', '2026-10-09', SAT)['status'] == 'ok'


def test_nav_one_working_day_late_is_a_warning_holiday_possible():
    c = check_nav('Mutual fund NAVs', '2026-10-07', FRI)
    assert c['status'] == 'warn' and 'holiday' in c['message']


def test_nav_two_or_more_working_days_late_fails():
    c = check_nav('SIF NAVs', '2026-10-06', FRI)
    assert c['status'] == 'fail' and 'NOT updated' in c['message'] and '2 working days' in c['message']


def test_nav_missing_or_unreadable_fails():
    assert check_nav('Mutual fund NAVs', None, FRI)['status'] == 'fail'
    assert check_nav('Mutual fund NAVs', 'yesterday', FRI)['status'] == 'fail'


def test_holdings_on_time_is_ok():
    assert check_holdings('2026-09', 0.95, 767, date(2026, 10, 13))['status'] == 'ok'
    assert check_holdings('2026-08', 1.0, 767, date(2026, 10, 9))['status'] == 'ok'   # September not due yet


def test_holdings_not_appeared_warns_then_fails():
    c = check_holdings('2026-08', 1.0, 767, date(2026, 10, 13))
    assert c['status'] == 'warn' and 'September 2026' in c['message'] and 'NOT appeared' in c['message']
    assert check_holdings('2026-08', 1.0, 767, date(2026, 10, 16))['status'] == 'fail'
    # Long overdue (two months back before the 12th) is a fail straight away.
    assert check_holdings('2026-07', 1.0, 767, date(2026, 10, 5))['status'] == 'fail'


def test_holdings_for_too_few_funds_is_flagged():
    c = check_holdings('2026-09', 0.40, 767, date(2026, 10, 13))
    assert c['status'] == 'warn' and '40%' in c['message']
    assert check_holdings('2026-09', 0.40, 767, date(2026, 10, 20))['status'] == 'fail'


def test_holdings_none_stored_fails():
    assert check_holdings(None, None, 0, date(2026, 10, 13))['status'] == 'fail'


def test_indices_age():
    now = datetime(2026, 10, 9, 3, 0, tzinfo=timezone.utc)
    assert check_indices(datetime(2026, 10, 9, 2, 0, tzinfo=timezone.utc), now)['status'] == 'ok'
    assert check_indices(datetime(2026, 10, 1, tzinfo=timezone.utc), now)['status'] == 'warn'
    assert check_indices(None, now)['status'] == 'warn'


def test_overall_takes_the_worst():
    assert overall([{'status': 'ok'}, {'status': 'ok'}]) == 'ok'
    assert overall([{'status': 'ok'}, {'status': 'warn'}]) == 'warn'
    assert overall([{'status': 'warn'}, {'status': 'fail'}]) == 'fail'


def test_evaluate_end_to_end():
    now = datetime(2026, 10, 13, 3, 30, tzinfo=timezone.utc)       # Tue 13 Oct, 09:00 IST
    good = {'mf_as_of': '2026-10-12', 'sif_as_of': '2026-10-12', 'holdings_month': '2026-09',
            'holdings_funds': 767, 'holdings_latest_funds': 740, 'indices_updated': now}
    r = evaluate(good, now)
    assert r['status'] == 'ok', r
    stale = dict(good, mf_as_of='2026-10-07', holdings_month='2026-08')
    r = evaluate(stale, now)
    assert r['status'] == 'fail'
    msgs = ' '.join(c['message'] for c in r['checks'])
    assert 'Mutual fund NAVs NOT updated' in msgs and 'September 2026' in msgs


if __name__ == '__main__':
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f'  PASS  {name}')
            except AssertionError as exc:
                fails += 1
                print(f'  FAIL  {name}: {exc}')
    print()
    print('data health checks hold' if not fails else f'{fails} test(s) FAILED')
    sys.exit(1 if fails else 0)

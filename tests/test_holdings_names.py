"""
Matching the holdings feed's fund names (Advisorkhoj) to our fund list
(scripts/advisorkhoj.py match_report), against our real catalogue — no network.

A wrong match is worse than none: that fund would show another fund's stocks.
So these pin both sides: spellings that must be auto-corrected onto the right
fund, and names that must stay unmatched (reported, never guessed).

Run:  python tests/test_holdings_names.py        (or python -m pytest tests -q)
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, ROOT)

from scripts.advisorkhoj import EXPECTED_UNMATCHED, _catalogue, _norm, match_report  # noqa: E402

OURS = _catalogue()
NAMES = {str(s['scheme_code']): s['scheme_name'] for s in json.load(open(os.path.join(ROOT, 'data', 'scheme_catalogue.json'), encoding='utf-8'))['schemes']}


def matched_name(feed_name: str) -> str | None:
    m, _ = match_report([feed_name], OURS)
    return NAMES.get(m[feed_name]) if feed_name in m else None


def same(a: str | None, b: str) -> bool:
    return a is not None and _norm(a) == _norm(b)


def test_exact_names_match():
    assert same(matched_name('HDFC Flexi Cap Fund'), 'HDFC Flexi Cap Fund')
    assert same(matched_name('Parag Parikh Flexi Cap Fund'), 'Parag Parikh Flexi Cap Fund')


def test_spacing_variants_are_auto_corrected():
    # The feed writes Flexicap / Midcap / Largecap / Smallcap / Multicap where AMFI has two words (or the reverse).
    assert same(matched_name('Kotak Flexicap Fund'), 'Kotak Flexi Cap Fund')
    assert same(matched_name('Invesco India Midcap Fund'), 'Invesco India Mid Cap Fund')
    assert same(matched_name('Groww Largecap Fund'), 'Groww Large Cap Fund')
    assert same(matched_name('SBI Smallcap Fund'), 'SBI Small Cap Fund')
    assert same(matched_name('DSP Multicap Fund'), 'DSP Multi Cap Fund')
    assert same(matched_name('Sundaram Flexi Cap Fund'), 'Sundaram Flexicap Fund')        # the other way round


def test_case_ampersand_and_typos_are_auto_corrected():
    assert same(matched_name('CANARA ROBECO FLEXICAP FUND'), 'Canara Robeco Flexi Cap Fund')
    assert same(matched_name('ITI LARGE & MIDCAP FUND'), 'ITI Large & Mid Cap Fund')
    assert same(matched_name('Sundaram Large and Mid Cap Fund'), 'Sundaram Large and Midcap Fund')
    assert same(matched_name('SBI Aggresive Hybrid Fund'), 'SBI Aggressive Hybrid Fund')              # feed typo
    assert same(matched_name('Canara Robeco Banking and Financials Services Fund'), 'Canara Robeco Banking and Financial Services Fund')
    assert same(matched_name('Mahindra Manulife Banking & Financial Services Fund'), 'MahindraManulife Banking & Financial Services Fund')


def test_balanced_advantage_and_multi_asset_funds_match():
    # Fetched from October 2026 on: these must land on the right category's fund.
    for n in ['HDFC Balanced Advantage Fund', 'ICICI Prudential Balanced Advantage Fund', 'Kotak Balanced Advantage Fund']:
        got = matched_name(n)
        assert got and 'balanced advantage' in _norm(got), f'{n} -> {got}'
    for n in ['ICICI Prudential Multi Asset Fund', 'SBI Multi Asset Allocation Fund']:
        got = matched_name(n)
        assert got and 'multi asset' in _norm(got), f'{n} -> {got}'


def test_renamed_fund_still_matches():
    got = matched_name('Baroda BNP Paribas Best-in-Class Strategy Fund')
    assert got and 'best in class' in _norm(got), got


def test_fund_we_do_not_track_is_reported_not_guessed():
    # Zerodha Arbitrage looks like Bandhan Arbitrage (76% alike): it must NOT take Bandhan's holdings.
    m, un = match_report(['Zerodha Arbitrage Fund', 'UTI Balanced Hybrid Fund'], OURS)
    assert m == {}, f'guessed a wrong fund: {m}'
    assert {u['name'] for u in un} == {'Zerodha Arbitrage Fund', 'UTI Balanced Hybrid Fund'}
    for u in un:
        assert u['closest'] and 0 < u['similarity'] < 0.93 and not u['expected'], u


def test_closed_ended_series_and_segregated_portfolios_are_expected():
    names = ['SBI Long Term Advantage Fund - Series IV', 'Sundaram Long Term Tax Advantage Fund Series III',
             'Bank of India Mid Cap Tax Fund Series 1', 'Nippon India Equity Hybrid Fund - Segregated Portfolio 2']
    m, un = match_report(names, OURS)
    assert m == {}
    assert all(u['expected'] for u in un), [u for u in un if not u['expected']]
    assert EXPECTED_UNMATCHED.search('HDFC FMP 1234D March 2024')


def test_series_numbers_are_never_mixed_up():
    # "Series IV" and "Series V" are different funds: a near-identical name must not be matched across them.
    m, _ = match_report(['SBI Long Term Advantage Fund - Series IV', 'SBI Long Term Advantage Fund - Series V'], OURS)
    assert len(set(m.values())) == len(m), f'two series matched to one fund: {m}'


def test_word_order_pass_stays_within_the_fund_house():
    assert same(matched_name('Kotak Fund Midcap'), 'Kotak Mid Cap Fund')          # same words, other order, same house
    got = matched_name('Midcap Kotak Fund')                                      # different first word: no cross-house guess
    assert got is None or 'kotak' in _norm(got)


def test_a_normal_fund_list_matches_almost_entirely():
    # Every Equity/Hybrid fund name in our own catalogue must find itself.
    sample = [n for n in NAMES.values()][:400]
    m, un = match_report(sample, OURS)
    assert len(m) >= 0.99 * len(sample), f'{len(un)} of {len(sample)} catalogue names did not match themselves'


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
    print('holdings name matching holds' if not fails else f'{fails} test(s) FAILED')
    sys.exit(1 if fails else 0)

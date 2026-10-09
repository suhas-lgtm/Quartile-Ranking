"""
The SIF reader (scripts/sif_data.py) against the ways AMFI's data has broken
before: blank Plan / Option (iSIF), renamed NFO fields, broken dashes, and the
exit-load corrections file. No network.

Run:  python tests/test_sif_data.py        (or python -m pytest tests -q)
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from scripts import sif_data  # noqa: E402


def test_plan_and_option_kept_when_amfi_sends_them():
    assert sif_data.plan_option('Anything', 'Regular Plan', 'IDCW') == ('Regular Plan', 'IDCW')


def test_blank_plan_and_option_read_off_the_name_isif():
    assert sif_data.plan_option('iSIF Hybrid Long-Short Fund - Growth', None, None) == ('Regular Plan', 'Growth')
    assert sif_data.plan_option('iSIF Equity Long-Short Fund - Direct Plan - Growth', None, None) == ('Direct Plan', 'Growth')
    assert sif_data.plan_option('X Fund - Regular - IDCW Payout', '', '') == ('Regular Plan', 'IDCW')
    assert sif_data.plan_option('X Fund - Dividend Option', None, None)[1] == 'IDCW'
    # "directional" is not "direct"; a name with no option word stays unknown.
    assert sif_data.plan_option('Directional Fund', None, None) == ('Regular Plan', None)


def test_strategy_key_ignores_plan_and_option():
    k = sif_data._key('Altiva Hybrid Long-Short Fund - Regular Plan - Growth')
    assert k == 'altiva hybrid long short fund'
    assert sif_data._key('Altiva Hybrid Long-Short Fund - Direct Plan - IDCW') == k
    assert sif_data._key('qsif Equity Long-Short Fund - Growth Option - Regular Plan') == 'qsif equity long short fund'


def test_clean_text_fixes_broken_dashes_and_spaces():
    assert sif_data._clean('0.50% � if  redeemed\n within 30 days') == '0.50% – if redeemed within 30 days'
    assert sif_data._clean('   ') is None
    assert sif_data._clean(None) is None


def test_nfo_record_reads_the_new_amfi_field_names():
    m = {'Scheme_Id': 'S-36', 'Specialized_Investment_Fund': 'Mahindra Manulife Mutual Fund',
         'Investment_Strategy': 'MSIF Equity Long-Short Fund', 'Type': 'Open Ended',
         'Category': 'Equity Oriented Investment Strategies - Equity Long-Short Fund',
         'New_Fund_Launch_Date': '2026-09-30T00:00:00.000Z', 'New_Fund_Offer_Closure_Date': '2026-10-14T00:00:00.000Z',
         'Indicate_Load_Separately': 'Exit Load :- 0.5% up to 3 months', 'Offer_Price_Rs': '10',
         'Minimum_Subscription_Amount': 'Rs. 10,00,000', 'infoDocumentUrl': 'https://x/S-36.pdf'}
    r = sif_data.nfo_record('S-36', m)
    assert r['name'] == 'MSIF Equity Long-Short Fund' and r['house'] == 'Mahindra Manulife Mutual Fund'
    assert r['opens'] == '2026-09-30' and r['closes'] == '2026-10-14'
    assert r['exit_load'].startswith('Exit Load') and r['price'] == '10' and r['type'] == 'Open Ended'


def test_nfo_record_still_reads_the_old_field_names():
    m = {'SchemeName': 'Old Style Fund', 'MutualFund': 'Old House', 'SchemeCategory': 'Cat',
         'NewFundLaunchDate': '2025-09-01T00:00:00.000Z', 'NewFundOfferClosureDate': '2025-09-15T00:00:00.000Z'}
    r = sif_data.nfo_record('S-1', m)
    assert r['name'] == 'Old Style Fund' and r['house'] == 'Old House' and r['category'] == 'Cat'
    assert r['opens'] == '2025-09-01' and r['closes'] == '2025-09-15'


def test_nfo_record_never_comes_back_without_a_name_when_one_exists():
    # The October 2026 regression: every offer had name None.
    r = sif_data.nfo_record('S-35', {'Investment_Strategy': 'Titanium Active Asset Allocator Long-Short Fund'},
                            {'MutualFund': 'Titanium SIF'})
    assert r['name'] and r['house'] == 'Titanium SIF'


def test_overrides_file_is_valid_and_keys_match_strategies():
    raw = json.load(open(sif_data.OVERRIDES_PATH, encoding='utf-8'))
    o = sif_data.load_overrides()
    assert all(not k.startswith('_') for k in o)
    assert len(o) == len([k for k in raw if not k.startswith('_')])
    for key, fix in o.items():
        assert key == sif_data._key(key), f'{key!r} is not written as a strategy key'
        assert fix, f'{key!r} has no fields'
        if 'exit_load' in fix:
            assert fix.get('exit_load_note'), f'{key!r}: say where the corrected exit load came from'


def test_altiva_hybrid_exit_load_correction_applies():
    details = {'altiva hybrid long short fund': {'exit_load': '0.50% up to 180 days', 'objective': 'Keep me'}}
    out = sif_data.apply_overrides(details, sif_data.load_overrides())
    d = out['altiva hybrid long short fund']
    assert '30 days' in d['exit_load'] and '180' not in d['exit_load']
    assert d['objective'] == 'Keep me'                      # other fields untouched
    assert details['altiva hybrid long short fund']['exit_load'] == '0.50% up to 180 days'   # input not mutated


def test_missing_overrides_file_is_harmless():
    assert sif_data.load_overrides(os.path.join(os.path.dirname(__file__), 'no-such-file.json')) == {}


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
    print('SIF reader holds' if not fails else f'{fails} test(s) FAILED')
    sys.exit(1 if fails else 0)

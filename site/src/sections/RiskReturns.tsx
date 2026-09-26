// src/sections/RiskReturns.tsx — trailing returns and the full risk-ratio set,
// one category at a time.
//
// Everything on screen is precomputed by build_json.build_risk from the engine
// (trailing_return, risk_metrics, composite_risk_score). This file only sorts,
// filters and colours it; it never recalculates a figure.

import { useMemo, useState } from 'react'
import { useMeta, useRisk } from '../hooks/useData'
import ComingFunds from '../components/ComingFunds'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtPct, retColor } from '../utils/format'
import type { SheetSpec } from '../utils/xlsx'
import type { RiskFundRow, RiskPeriod, RiskRatios, SipPeriod } from '../types'
import FundLink from '../components/FundLink'

const EQUITY_HYBRID_CLASSES = ['Equity', 'Hybrid']
// Index funds, ETFs and FoFs have returns and risk too, but no category benchmark.
const PASSIVE_SLUGS = ['index-fund', 'etf', 'gold-etf', 'fof-domestic', 'fof-overseas']
const MAIN_TAB_NAMES = [
  'Large Cap', 'Large & Mid Cap', 'Mid Cap', 'Small Cap',
  'Flexi Cap', 'Balanced Advantage', 'Multi Asset Allocation',
]

type View = 'returns' | 'ratios' | 'sip' | 'all'
type Better = 'high' | 'low' | null

interface Col {
  key: string
  label: string
  group: 'returns' | 'ratios' | 'sip'
  /** Value from a fund row, the category average or the benchmark. */
  get: (r: { returns?: Partial<Record<RiskPeriod, number | null>> } & Partial<RiskRatios>) => number | null | undefined
  show: (v: number | null | undefined) => string
  /** Which end of the column is good; null leaves it uncoloured (Beta). */
  better: Better
  exportType: 'percent' | 'number'
  help: string
}

const pct  = (v: number | null | undefined) => fmtPct(v ?? null)
const pctU = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const num  = (d: number) => (v: number | null | undefined) => (v == null ? '—' : v.toFixed(d))

const RETURN_COLS: Col[] = ([
  ['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['12M', '1Y'],
  ['2Y', '2Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['10Y', '10Y'],
] as [RiskPeriod, string][]).map(([p, label]) => ({
  key: `r_${p}`,
  label,
  group: 'returns' as const,
  get: r => r.returns?.[p],
  show: pct,
  better: 'high' as const,
  exportType: 'percent' as const,
  help: p === '1D'
    ? 'Change from the previous NAV (last trading day).'
    : ['1W', '1M', '3M', '6M', '12M'].includes(p)
    ? `${label} absolute return, point to point.`
    : `${label} annualised return (CAGR).`,
}))

// Order follows how a factsheet reads: benchmark-relative first (Alpha, Beta),
// then risk-adjusted return, then raw risk, then the composite.
const RATIO_COLS: Col[] = [
  { key: 'alpha', label: 'Alpha (3Y)', group: 'ratios',
    // Shown as a plain number, as factsheets do: 5.04 means 5.04 percentage
    // points a year above what Beta predicts. Stored as a decimal.
    get: r => (r.alpha == null ? r.alpha : r.alpha * 100),
    show: num(2), better: 'high', exportType: 'number',
    help: 'Extra return per year the fund earned over what its Beta says it should have earned from the benchmark (Jensen’s alpha, last 3 years). 5.0 means 5 percentage points a year better than expected; negative means it lagged. Higher is better.' },
  { key: 'beta', label: 'Beta (3Y)', group: 'ratios', get: r => r.beta,
    show: num(2), better: null, exportType: 'number',
    help: 'How strongly the fund moves with its benchmark, from the last 3 years of monthly returns. 1.00 = moves in line; 0.90 = moves about 10% less (a 10% market fall ≈ 9% fund fall); 1.10 = about 10% more. Neither end is "good", so it is not coloured.' },
  { key: 'sharpe', label: 'Sharpe (3Y)', group: 'ratios', get: r => r.sharpe,
    show: num(2), better: 'high', exportType: 'number',
    help: 'Return earned above the risk-free rate for each unit of total volatility (3Y CAGR minus risk-free, divided by 3Y Std Dev). Higher = better reward for the ups and downs taken.' },
  { key: 'sortino', label: 'Sortino (3Y)', group: 'ratios', get: r => r.sortino,
    show: num(2), better: 'high', exportType: 'number',
    help: 'Like Sharpe, but only counts downside volatility (months below the risk-free rate), so upside swings are not penalised. Higher = better.' },
  { key: 'std_annual', label: 'Std Dev (3Y)', group: 'ratios', get: r => r.std_annual,
    show: pctU, better: 'low', exportType: 'percent',
    help: 'Annualised standard deviation of the last 3 years of monthly returns: how widely returns swing around their average. Lower = steadier.' },
  { key: 'upside_capture', label: 'Up Capture (3Y)', group: 'ratios', get: r => r.upside_capture,
    show: num(1), better: 'high', exportType: 'number',
    help: 'In the months the benchmark rose (last 3 years), how much of that rise the fund captured. 110 = 10% more than the benchmark; 90 = 10% less. Higher is better.' },
  { key: 'downside_capture', label: 'Down Capture (3Y)', group: 'ratios', get: r => r.downside_capture,
    show: num(1), better: 'low', exportType: 'number',
    help: 'In the months the benchmark fell (last 3 years), how much of that fall the fund suffered. 80 = fell only 80% as much; above 100 = fell more. Lower is better.' },
  { key: 'max_drawdown', label: 'Max DD (since 2010)', group: 'ratios', get: r => r.max_drawdown,
    show: pct, better: 'high', exportType: 'percent',
    help: 'The largest fall from a previous peak to a later low, over all history held (from 2010, or launch if later). -35% means an investor at the worst peak was down 35% at the bottom. Closer to 0 is better.' },
  { key: 'composite_score', label: 'Score', group: 'ratios', get: r => r.composite_score,
    show: num(1), better: 'high', exportType: 'number',
    help: 'One 0–100 number ranking the fund against its own category: Sharpe 30%, Sortino 20%, Alpha 20%, Max Drawdown 15% and capture spread (Up minus Down Capture) 15%. Each ratio is turned into a percentile within the category first, so 90 means better than roughly 90% of peers on this blend. Ratios a fund lacks are left out and the rest re-weighted.' },
]

const crore = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)

// Fund size, from AMFI. Shown with the ratios, but left out of the Score.
const FACT_COLS: Col[] = [
  { key: 'aum_cr', label: 'AUM (₹ Cr)', group: 'ratios', get: r => r.aum_cr, better: null, exportType: 'number',
    show: crore,
    help: 'Average assets under management of the whole fund (all plans and options together), in ₹ crore, for the latest quarter AMFI has published. 12.3k = ₹12,300 crore. Not shaded: neither very small nor very large is "good" by itself.' },
]

const SIP_COLS: Col[] = (['1Y', '3Y', '5Y', '10Y'] as SipPeriod[]).map(p => ({
  key: `sip_${p}`,
  label: `${p} SIP`,
  group: 'sip' as const,
  get: r => r.sip?.[p],
  show: pct,
  better: 'high' as const,
  exportType: 'percent' as const,
  help: `XIRR of a fixed monthly SIP over the last ${p === '1Y' ? 'year' : p.replace('Y', ' years')}: one instalment a month, all valued at the latest NAV. Annualised, allowing for when each instalment went in.`,
}))

const ALL_COLS = [...RETURN_COLS, ...SIP_COLS, ...RATIO_COLS, ...FACT_COLS]

const GOOD_BG = 'rgba(52,211,153,0.14)'
const BAD_BG  = 'rgba(248,113,113,0.14)'

/** Top/bottom-quarter cut-offs for one column, over the funds shown. */
function cutoffs(values: number[]): { lo: number; hi: number } | null {
  if (values.length < 4) return null
  const s = [...values].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]
  return { lo: at(0.25), hi: at(0.75) }
}

function tint(v: number | null | undefined, better: Better,
              c: { lo: number; hi: number } | null | undefined): string | undefined {
  if (v == null || !better || !c) return undefined
  if (v >= c.hi) return better === 'high' ? GOOD_BG : BAD_BG
  if (v <= c.lo) return better === 'high' ? BAD_BG : GOOD_BG
  return undefined
}

export default function RiskReturns() {
  const { data: meta } = useMeta()
  const [slug, setSlug] = useState('')
  const [view, setView] = useState<View>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'r_3Y', dir: 'desc' })

  const eligibleCats = (meta?.categories ?? []).filter(
    c => EQUITY_HYBRID_CLASSES.includes(c.asset_class) || PASSIVE_SLUGS.includes(c.slug))
  const activeSlug = slug || (eligibleCats[0]?.slug ?? '')
  const mainTabs  = eligibleCats.filter(c => MAIN_TAB_NAMES.includes(c.category_name))
  const otherCats = eligibleCats.filter(c => !MAIN_TAB_NAMES.includes(c.category_name))

  const { data, loading, error } = useRisk(activeSlug)

  const cols = view === 'returns' ? RETURN_COLS : view === 'ratios' ? [...RATIO_COLS, ...FACT_COLS]
    : view === 'sip' ? SIP_COLS : ALL_COLS

  const funds = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (data?.funds ?? []).filter(f => !q || f.scheme_name.toLowerCase().includes(q))
    const col = ALL_COLS.find(c => c.key === sort.key)
    if (!col) return list
    // Blanks always sink to the bottom, whichever way the column is sorted.
    return [...list].sort((a, b) => {
      const va = col.get(a), vb = col.get(b)
      if (va == null && vb == null) return a.scheme_name.localeCompare(b.scheme_name)
      if (va == null) return 1
      if (vb == null) return -1
      return sort.dir === 'desc' ? vb - va : va - vb
    })
  }, [data, query, sort])

  // Colour against the whole category, not just the rows a search left visible,
  // so filtering never changes what "top quarter" means.
  const cuts = useMemo(() => {
    const out: Record<string, ReturnType<typeof cutoffs>> = {}
    for (const c of ALL_COLS) {
      out[c.key] = cutoffs((data?.funds ?? [])
        .map(f => c.get(f)).filter((v): v is number => v != null))
    }
    return out
  }, [data])

  const onSort = (key: string) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const columns: SheetSpec['columns'] = [
      { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
      ...cols.map(c => ({ key: c.key, label: c.label, type: c.exportType })),
    ]
    const row = (name: string, r: Parameters<Col['get']>[0]) => {
      const out: SheetSpec['rows'][number] = { fund: name }
      // Percent columns are decimals; captures and the score are already 0–100.
      for (const c of cols) out[c.key] = c.get(r) ?? null
      return out
    }
    const rows: SheetSpec['rows'] = []
    rows.push(row('Category average', data.category_average))
    for (const f of funds) rows.push(row(f.scheme_name, f))
    if (data.benchmark) rows.push(row(`Benchmark: ${data.benchmark.name ?? ''}`, { returns: data.benchmark.returns, sip: data.benchmark.sip }))
    return {
      sheet: 'Risk & Returns',
      title: `Risk & Returns - ${data.category_name}`,
      meta: [
        ['Desk', desk.name],
        ['Category', data.category_name],
        ['Data as of', data.as_of],
        ['Funds', String(funds.length)],
        ['Ratios', `${data.window}; risk-free rate ${(data.risk_free_rate * 100).toFixed(1)}% p.a.`],
        ['Returns', view === 'sip' ? 'Monthly SIP XIRR over 1Y, 3Y, 5Y, 10Y, valued at the latest NAV'
                                   : '1D to 1Y absolute, 2Y and longer annualised (CAGR)'],
      ],
      columns,
      rows,
      fileName: `${desk.code} Risk & Returns - ${data.category_name} - ${data.as_of}`,
    }
  }

  const colour = categoryColor(activeSlug)

  const cell = (c: Col, r: Parameters<Col['get']>[0], coloured: boolean) => {
    const v = c.get(r)
    const cls = c.group !== 'ratios' || c.key === 'alpha' ? retColor(v ?? null) : ''
    return (
      <td key={c.key} className={`ret-cell ${cls}`}
          style={{ background: coloured ? tint(v, c.better, cuts[c.key]) : undefined,
                   borderLeft: c.key === 'aum_cr' ? '1px solid var(--line)' : undefined }}>
        {c.show(v)}
      </td>
    )
  }

  return (
    <section id="risk-returns" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Risk &amp; Returns</span>
      </div>

      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center flex-1 min-w-0">
          <div className="tab-bar">
            {mainTabs.map(c => {
              const col = categoryColor(c.slug, c.asset_class)
              const on = activeSlug === c.slug
              return (
                <button key={c.slug} onClick={() => setSlug(c.slug)}
                  className={`tab-btn${on ? ' active' : ''}`}
                  style={on ? { color: col, background: `${col}1f` } : undefined}>
                  {c.category_name}
                </button>
              )
            })}
          </div>
          {otherCats.length > 0 && (
            <select
              value={mainTabs.some(c => c.slug === activeSlug) ? '' : activeSlug}
              onChange={e => { if (e.target.value) setSlug(e.target.value) }}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--bg-raised)',
                       border: `1px solid ${mainTabs.some(c => c.slug === activeSlug) ? 'var(--line)' : colour}`,
                       color: 'var(--text-hi)', outline: 'none' }}
            >
              <option value="" disabled>-- Other Categories --</option>
              {otherCats.map(c => <option key={c.slug} value={c.slug}>{c.category_name}</option>)}
            </select>
          )}
        </div>
        <div className="tab-bar shrink-0 flex items-center gap-2">
          <button onClick={() => setView('returns')} className={`tab-btn${view === 'returns' ? ' active accent' : ''}`}>Returns</button>
          <button onClick={() => setView('ratios')}  className={`tab-btn${view === 'ratios'  ? ' active accent' : ''}`}>Ratios</button>
          <button onClick={() => { setView('sip'); if (!sort.key.startsWith('sip_')) setSort({ key: 'sip_3Y', dir: 'desc' }) }}
                  className={`tab-btn${view === 'sip' ? ' active accent' : ''}`}>SIP Returns</button>
          <button onClick={() => setView('all')}     className={`tab-btn${view === 'all'     ? ' active accent' : ''}`}>All</button>
          <DownloadButton build={buildExport} disabledHint="No funds in this category yet" />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search fund…"
          className="px-3 py-1.5 rounded-lg text-sm w-full sm:w-72"
          style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }}
        />
        {data && (
          <span className="text-xs" style={{ color: 'var(--text-low)' }}>
            {funds.length} of {data.funds.length} funds · click a column to sort · as of {data.as_of}
          </span>
        )}
      </div>

      {data?.benchmark?.stale && (
        <div className="card p-3 mb-3 text-xs" style={{ borderColor: 'rgba(245,158,11,0.5)', color: 'var(--text-mid)' }}>
          ⚠️ The benchmark <b style={{ color: 'var(--text-hi)' }}>{data.benchmark.name}</b> has no data
          after {data.benchmark.last_date}, so Alpha, Beta and the Capture ratios are left blank for this
          category, and the benchmark row&apos;s returns end on that date. Std Dev, Sharpe, Sortino and Max DD
          do not use the benchmark and are unaffected.
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
        ) : data ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
                  {cols.map(c => {
                    const on = sort.key === c.key
                    return (
                      <th key={c.key} title={c.help} onClick={() => onSort(c.key)}
                          style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none',
                                   color: on ? 'var(--accent-a)' : undefined,
                                   borderLeft: (c.key === 'alpha' || c.key === 'sip_1Y') && view === 'all' ? '1px solid var(--line)' : undefined }}>
                        {c.label}{on ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody key={`${activeSlug}-${view}`} className="rows-enter">
                <tr className="benchmark-row">
                  <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--text-mid)' }}>
                    Category average
                  </td>
                  {cols.map(c => cell(c, data.category_average, false))}
                </tr>
                {funds.map((f: RiskFundRow) => (
                  <tr key={f.scheme_code}>
                    <td className="sticky-col text-xs font-medium truncate" style={{ maxWidth: 240 }}
                        title={f.benchmark_name ? `${f.scheme_name}
Benchmark: ${f.benchmark_name}` : f.scheme_name}>
                      <FundLink code={f.scheme_code} name={f.scheme_name} />
                      {f.benchmark_name && (
                        <div className="text-[10px] font-normal truncate" style={{ color: 'var(--text-low)' }}>
                          vs {f.benchmark_name}
                        </div>
                      )}
                    </td>
                    {cols.map(c => cell(c, f, true))}
                  </tr>
                ))}
                {data.benchmark && (
                  <tr className="benchmark-row">
                    <td className="sticky-col text-xs font-semibold truncate" style={{ maxWidth: 240, color: 'var(--accent-a)' }}
                        title={data.benchmark.name ?? ''}>
                      Benchmark · {data.benchmark.name}
                    </td>
                    {cols.map(c => cell(c, { returns: data.benchmark!.returns, sip: data.benchmark!.sip }, false))}
                  </tr>
                )}
              </tbody>
            </table>
            {funds.length === 0 && (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
                No fund matches “{query}”.
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center" style={{ color: 'var(--text-mid)' }}>
            {error
              ? <ComingFunds error={error} subject="rank" failedLabel="risk & returns" />
              : 'No data for this category yet.'}
          </div>
        )}
      </div>
      {/* ── What each ratio means ─────────────────────────────── */}
      <div className="card p-4 sm:p-5 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
        <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>
          What the ratios mean
        </div>
        <p className="mb-3">
          All ratios except Max DD use the <b style={{ color: 'var(--text-hi)' }}>last 3 years of monthly returns</b>
          {data?.benchmark ? <> compared with the category benchmark, <b style={{ color: 'var(--text-hi)' }}>{data.benchmark.name}</b></> : null},
          with a risk-free rate of {data ? `${(data.risk_free_rate * 100).toFixed(1)}%` : '6.5%'} a year.
          A fund needs about 30 months of history for ratios; younger funds show returns only.
          1D to 1Y returns are plain % changes; 2Y and longer are yearly averages (CAGR).
          <b style={{ color: 'var(--text-hi)' }}> SIP Returns</b> show the annualised return (XIRR) of a fixed monthly SIP
          over the last 1, 3, 5 and 10 years — one instalment a month, valued at the latest NAV; the benchmark row
          applies the same SIP to the index. Blank = the fund is younger than the period.
        </p>
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {[...RATIO_COLS, ...FACT_COLS].map(c => (
            <div key={c.key}>
              <b style={{ color: 'var(--text-hi)' }}>{c.label}</b>
              {c.better && (
                <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-low)' }}>
                  ({c.better === 'high' ? 'higher is better' : 'lower is better'})
                </span>
              )}
              <div>{c.help}</div>
            </div>
          ))}
        </div>
        <p className="mt-3">
          Shading: <span style={{ background: GOOD_BG, padding: '0 4px' }}>green</span> = best quarter of the
          category for that column, <span style={{ background: BAD_BG, padding: '0 4px' }}>red</span> = worst
          quarter, allowing for direction (a low Std Dev is green). Beta and AUM are not shaded.
        </p>
        {data?.facts && (
          <p className="mt-2">
            AUM is from AMFI: the quarterly average for {data.facts.aum_period ?? '—'}, all plans of the fund
            together. It is for information and does not enter the Score.
          </p>
        )}
      </div>
    </section>
  )
}

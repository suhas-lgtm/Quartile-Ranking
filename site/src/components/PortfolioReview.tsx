// src/components/PortfolioReview.tsx — everything we know about a mutual fund
// portfolio, for one side (a plan) or two (existing vs proposed).
//
// Each side is a list of funds with an amount. Allocations look through every
// fund to its latest monthly portfolio (market cap, asset class, sectors with
// their industries, top holdings); returns and ratios are each fund's own from
// the Risk & Returns files, weighted by amount, beside a chosen benchmark. With
// one side the tables show a single column; with two, the change as well.

import { useEffect, useMemo, useState } from 'react'
import { industryLine, sectorBreakdown } from './SectorBars'
import { useJson, useMeta } from '../hooks/useData'
import FundLink from './FundLink'
import OverlapMatrix from './OverlapMatrix'
import CorrelationMatrix, { type NavSeries } from './CorrelationMatrix'
import { capSplit, useStockCaps, CAP_COLOURS } from './CapSplit'
import { useLookThrough, type LookRow } from './LookThrough'
import { BenchmarkPicker, useBenchmarkChoice, useFundRisk } from '../sections/PortfolioBuilder'
import { closeAt, indexTrailing, useIndexSeries } from '../utils/benchmark'
import { isoMinus } from '../utils/navMath'
import { categoryColor } from '../config/categoryColors'
import { fmtPct, retColor } from '../utils/format'
import type { FundsIndex, RiskFundRow } from '../types'

export interface ReviewLine { code: string; amount: number | null }
export interface ReviewSide { label: string; colour: string; lines: ReviewLine[] }

export const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')
/** ₹ in lakh / crore, the way advisors talk about plan sizes. */
export const inrShort = (v: number) => v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : inr(v)
export const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

/** A change in percentage points, coloured only when told which way is good. */
export function Delta({ v, good }: { v: number; good?: 'up' | 'down' }) {
  if (Math.abs(v) < 0.0005) return <span style={{ color: 'var(--text-low)' }}>—</span>
  const up = v > 0
  const colour = !good ? 'var(--text-mid)' : (up === (good === 'up')) ? '#34D399' : '#F87171'
  return <span style={{ color: colour, fontWeight: 600 }}>{up ? '▲' : '▼'} {(Math.abs(v) * 100).toFixed(1)} pts</span>
}

export const FUND_RET = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '12M'], ['3Y', '3Y'], ['5Y', '5Y'], ['10Y', '10Y']] as const
export const FUND_SIP = [['SIP 1Y', '1Y'], ['SIP 3Y', '3Y'], ['SIP 5Y', '5Y']] as const
type Ratio = [string, (r: RiskFundRow) => number | null, (v: number) => string, 'up' | 'down' | undefined]
export const FUND_RATIO: Ratio[] = [
  ['Sharpe', r => r.sharpe, v => v.toFixed(2), 'up'],
  ['Sortino', r => r.sortino, v => v.toFixed(2), 'up'],
  ['Std Dev', r => r.std_annual, v => `${(v * 100).toFixed(1)}%`, 'down'],
  ['Alpha', r => (r.alpha == null ? null : r.alpha * 100), v => v.toFixed(2), 'up'],
  ['Beta', r => r.beta, v => v.toFixed(2), undefined],
  ['Up capture', r => r.upside_capture, v => v.toFixed(0), 'up'],
  ['Down capture', r => r.downside_capture, v => v.toFixed(0), 'down'],
  ['Max DD', r => r.max_drawdown, v => `${(v * 100).toFixed(1)}%`, 'up'],
]

export function assetSplit(rows: LookRow[]) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r.asset_class === 'Equity' ? 'Equity' : /debt|bond|g-?sec|t-?bill|commercial|certificate|ncd|sdl/i.test(r.asset_class) ? 'Debt'
      : /cash|treps|repo|receivable|money/i.test(r.asset_class) ? 'Cash & others' : (r.asset_class || 'Others')
    m.set(k, (m.get(k) ?? 0) + r.weight)
  }
  return m
}

function sectorSplit(rows: LookRow[]) {
  const m = new Map<string, number>()
  for (const r of rows) if (r.asset_class === 'Equity') m.set(r.sector || r.industry || 'Other', (m.get(r.sector || r.industry || 'Other') ?? 0) + r.weight)
  return m
}

/** Full NAV history per fund, for the correlation table (fetched once each). */
function useSeries(codes: string[]) {
  const [series, setSeries] = useState<Record<string, NavSeries | null>>({})
  useEffect(() => {
    for (const c of codes) {
      if (c in series) continue
      setSeries(s => ({ ...s, [c]: null }))
      fetch(`/api/series?code=${c}`).then(r => (r.ok ? r.json() : null))
        .then(d => d && setSeries(s => ({ ...s, [c]: d })))
        .catch(() => { /* shown as pending */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join(',')])
  return series
}

export default function PortfolioReview({ sides, title = 'Mutual fund analysis' }: {
  /** One side (a plan) or two (existing, then proposed). */
  sides: ReviewSide[]
  title?: string
}) {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const name = (c: string) => fundByCode.get(c)?.n ?? c

  // Always two slots so the hooks run the same way every render; an empty slot is simply not shown.
  const A = sides[0] ?? { label: '', colour: '', lines: [] }
  const B = sides[1] ?? { label: '', colour: '', lines: [] }
  const priced = (s: ReviewSide) => s.lines.filter(l => (l.amount ?? 0) > 0)
  const withValue = (s: ReviewSide) => priced(s).map(l => ({ code: l.code, name: name(l.code), value: l.amount! }))
  const ltA = useLookThrough(withValue(A))
  const ltB = useLookThrough(withValue(B))
  const risk = useFundRisk([...new Set([...A.lines, ...B.lines].map(l => l.code))], fundByCode)
  const caps = useStockCaps()
  const [benchId, setBenchId] = useBenchmarkChoice()
  const benchSeries = useIndexSeries(benchId)
  const bench: Record<string, number | null> = { ...indexTrailing(benchSeries) }
  if (benchSeries?.length) {
    const end = benchSeries[benchSeries.length - 1], start = closeAt(benchSeries, isoMinus(end[0], 120))
    bench['10Y'] = start ? Math.pow(end[1] / start, 1 / 10) - 1 : null
  }
  const benchName = meta?.benchmarks.find(b => b.index_id === benchId)?.index_name ?? 'Index'
  const [allHold, setAllHold] = useState<Record<number, boolean>>({})

  const total = (s: ReviewSide) => s.lines.reduce((t, l) => t + (l.amount ?? 0), 0)
  const shown = [A, B].map((s, i) => ({ s, i, lt: i === 0 ? ltA : ltB })).filter(x => sides[x.i] && total(x.s) > 0)
  const two = shown.length === 2
  // The side the fund-to-fund tables (overlap, correlation) are for: the proposal when there is one.
  const focus = shown[shown.length - 1]
  // Debt funds are left out: their correlation and stock overlap with equity funds say nothing useful.
  const isDebt = (code: string) => meta?.categories.find(c => c.slug === fundByCode.get(code)?.s)?.asset_class === 'Debt'
  const focusFunds = focus ? priced(focus.s).filter(l => !isDebt(l.code)).map(l => ({ code: l.code, name: name(l.code) })) : []
  const debtLeftOut = focus ? priced(focus.s).filter(l => isDebt(l.code)).length : 0
  const series = useSeries(focusFunds.map(f => f.code))

  if (!shown.length) {
    return (
      <div className="card p-8 text-center text-sm mb-4" style={{ color: 'var(--text-mid)' }}>
        Add funds with amounts to see the analysis.
      </div>
    )
  }

  const categorySplit = (s: ReviewSide) => {
    const m = new Map<string, number>(), t = total(s) || 1
    for (const l of s.lines) if (l.amount) m.set(fundByCode.get(l.code)?.k ?? 'Other', (m.get(fundByCode.get(l.code)?.k ?? 'Other') ?? 0) + l.amount / t)
    return m
  }
  const weighted = (s: ReviewSide, get: (r: RiskFundRow) => number | null) => {
    let sum = 0, w = 0
    for (const l of s.lines) {
      const row = risk[l.code], v = row ? get(row) : null
      if (v == null || !l.amount) continue
      sum += v * l.amount; w += l.amount
    }
    return w ? sum / w : null
  }
  const top10 = (lt: typeof ltA) => lt.rows.slice(0, 10).reduce((t, r) => t + r.weight, 0)
  const cols = shown.map(x => x.s)
  const rowsFor = (f: (x: typeof shown[number]) => Map<string, number>) => {
    const maps = shown.map(f)
    const keys = [...new Set(maps.flatMap(m => [...m.keys()]))]
    return keys.map(k => [k, ...maps.map(m => m.get(k) ?? 0)] as [string, ...number[]])
      .sort((a, b) => Math.max(...(b.slice(1) as number[])) - Math.max(...(a.slice(1) as number[])))
  }

  const weightedAum = (s: ReviewSide) => weighted(s, r => r.aum_cr ?? null)

  return (
    <div>
      <div className="section-header" style={{ marginTop: 8 }}>
        <span>{title}</span>
      </div>

      {/* ── summary ── */}
      <ValueTable title="Summary" cols={cols} two={two} rows={[
        { label: 'Amount', vals: shown.map(x => inr(total(x.s))) },
        { label: 'Number of funds', vals: shown.map(x => String(priced(x.s).length)) },
        { label: 'Number of stocks (through the funds)', vals: shown.map(x => String(x.lt.rows.filter(r => r.asset_class === 'Equity').length)) },
        { label: 'Top 10 stocks, share of portfolio', vals: shown.map(x => pct1(top10(x.lt))),
          change: two ? <Delta v={top10(shown[1].lt) - top10(shown[0].lt)} /> : null },
        ...(two ? [
          { label: 'Funds in both', vals: (() => { const k = String(priced(shown[0].s).filter(l => priced(shown[1].s).some(m => m.code === l.code)).length); return [k, k] })() },
          { label: 'Stock overlap between the two (common weight)', vals: [pct1(stockOverlap(shown[0].lt.rows, shown[1].lt.rows)), ''] },
          { label: 'Stocks only in ' + shown[0].s.label.toLowerCase(), vals: [String(onlyIn(shown[0].lt.rows, shown[1].lt.rows).length), ''] },
          { label: 'Stocks only in ' + shown[1].s.label.toLowerCase(), vals: ['', String(onlyIn(shown[1].lt.rows, shown[0].lt.rows).length)] },
        ] : []),
        { label: 'Average fund size (AUM, weighted)', vals: shown.map(x => { const v = weightedAum(x.s); return v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')} Cr` }) },
      ]} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SplitTable cols={cols} two={two} title="Market cap & asset class" note="% of the whole portfolio · SEBI Large/Mid/Small (AMFI list)"
          rows={(() => {
            const cs = shown.map(x => capSplit(x.lt.rows, caps))
            const as = shown.map(x => assetSplit(x.lt.rows))
            const out: [string, number[], string?][] = [
              ['Large Cap', cs.map(c => c.L), CAP_COLOURS.L], ['Mid Cap', cs.map(c => c.M), CAP_COLOURS.M],
              ['Small Cap', cs.map(c => c.S), CAP_COLOURS.S], ['Other equity (foreign / unlisted)', cs.map(c => c.O), CAP_COLOURS.O],
            ]
            for (const k of [...new Set(as.flatMap(a => [...a.keys()]))].filter(k => k !== 'Equity'))
              out.push([k, as.map(a => a.get(k) ?? 0)])
            return out
          })()} />
        <SplitTable cols={cols} two={two} title="Category allocation" note="% of the amount in each fund category"
          rows={rowsFor(x => categorySplit(x.s)).map(([k, ...v]) => {
            const slug = index?.funds.find(f => f.k === k)?.s
            return [k, v, slug ? categoryColor(slug) : undefined] as [string, number[], string?]
          })} />
      </div>

      <SplitTable cols={cols} two={two}
        sub={Object.fromEntries(sectorBreakdown(focus.lt.rows).map(g => [g.sector, industryLine(g)]))}
        title="Sector allocation" note="Equity holdings through the funds, % of the whole portfolio · industries in each sector underneath"
        rows={rowsFor(x => sectorSplit(x.lt.rows)).slice(0, 20).map(([k, ...v]) => [k, v] as [string, number[]])} />

      {/* ── returns & ratios ── */}
      <div className="card overflow-hidden mb-4">
        <div className="px-4 pt-3 flex items-center flex-wrap gap-2">
          <span className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Returns &amp; ratios (weighted by amount)</span>
          <span className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-mid)' }}>
            Compare with <BenchmarkPicker id={benchId} onChange={setBenchId} />
          </span>
        </div>
        <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
          Returns up to 1Y absolute, 3Y+ annualised. SIP = XIRR of a monthly SIP. Ratios over 3 years.
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col text-left" style={{ minWidth: 180 }}>Measure</th>
                {cols.map(s => <th key={s.label} style={{ textAlign: 'right', color: s.colour }}>{s.label}</th>)}
                {two && <th style={{ textAlign: 'right' }}>Change</th>}
                <th style={{ textAlign: 'right', color: 'var(--accent-a)' }}>{benchName}</th>
              </tr>
            </thead>
            <tbody>
              {FUND_RET.map(([l, k]) => {
                const v = cols.map(s => weighted(s, r => r.returns?.[k] ?? null))
                return (
                  <tr key={l}>
                    <td className="sticky-col text-xs">{l} return{['3Y', '5Y', '10Y'].includes(l) ? ' (p.a.)' : ''}</td>
                    {v.map((x, i) => <td key={i} className={`ret-cell text-xs ${retColor(x)}`}>{fmtPct(x)}</td>)}
                    {two && <td className="ret-cell text-xs">{v[0] != null && v[1] != null ? <Delta v={v[1] - v[0]} good="up" /> : '—'}</td>}
                    <td className={`ret-cell text-xs ${retColor(bench[l] ?? null)}`}>{fmtPct(bench[l] ?? null)}</td>
                  </tr>
                )
              })}
              {FUND_SIP.map(([l, k]) => {
                const v = cols.map(s => weighted(s, r => r.sip?.[k] ?? null))
                return (
                  <tr key={l}>
                    <td className="sticky-col text-xs">{l} (XIRR)</td>
                    {v.map((x, i) => <td key={i} className={`ret-cell text-xs ${retColor(x)}`}>{fmtPct(x)}</td>)}
                    {two && <td className="ret-cell text-xs">{v[0] != null && v[1] != null ? <Delta v={v[1] - v[0]} good="up" /> : '—'}</td>}
                    <td className="ret-cell text-xs">—</td>
                  </tr>
                )
              })}
              {FUND_RATIO.map(([l, get, f, good]) => {
                const v = cols.map(s => weighted(s, get))
                const d = two && v[0] != null && v[1] != null ? v[1] - v[0] : null
                return (
                  <tr key={l}>
                    <td className="sticky-col text-xs">{l}</td>
                    {v.map((x, i) => <td key={i} className="ret-cell text-xs">{x == null ? '—' : f(x)}</td>)}
                    {two && (
                      <td className="ret-cell text-xs">
                        {d == null || Math.abs(d) < 1e-9 ? '—' : (
                          <span style={{ color: !good ? 'var(--text-mid)' : (d > 0) === (good === 'up') ? '#34D399' : '#F87171' }}>
                            {d > 0 ? '▲' : '▼'} {l === 'Std Dev' || l === 'Max DD' ? `${(Math.abs(d) * 100).toFixed(1)} pts` : Math.abs(d).toFixed(2)}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="ret-cell text-xs">—</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── top holdings ── */}
      <div className={`grid gap-4 mb-4 ${two ? 'lg:grid-cols-2' : ''}`}>
        {shown.map(({ s, i, lt }) => (
          <div key={i} className="card p-4">
            <div className="font-display font-bold text-sm mb-2" style={{ color: s.colour }}>
              {s.label} — {allHold[i] ? `all ${lt.rows.length}` : 'top 10'} holdings
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th className="text-left">Holding</th><th className="text-left">Industry</th>
                  <th style={{ textAlign: 'right' }}>Weight</th><th className="text-left">Held through</th>
                </tr></thead>
                <tbody>
                  {(allHold[i] ? lt.rows : lt.rows.slice(0, 10)).map(r => (
                    <tr key={r.isin}>
                      <td className="text-xs truncate" style={{ maxWidth: 240 }} title={r.name}>{r.name}</td>
                      <td className="text-[10px] truncate" style={{ color: 'var(--text-low)', maxWidth: 130 }}>{r.industry}</td>
                      <td className="ret-cell text-xs font-semibold">{(r.weight * 100).toFixed(2)}%</td>
                      <td className="text-[10px] truncate" style={{ color: 'var(--text-mid)', maxWidth: 220 }}
                          title={r.via.map(v => `${v.name} ${(v.weight * 100).toFixed(2)}%`).join('\n')}>
                        {r.via.length} fund{r.via.length === 1 ? '' : 's'}: {r.via.map(v => v.name.split(' ').slice(0, 2).join(' ')).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lt.rows.length > 10 && (
              <button className="tab-btn mt-2 text-xs" onClick={() => setAllHold(h => ({ ...h, [i]: !h[i] }))}>
                {allHold[i] ? '▴ Show top 10 only' : `▾ Show all ${lt.rows.length} holdings`}
              </button>
            )}
          </div>
        ))}
      </div>

      {two && <StockChanges a={shown[0]} b={shown[1]} />}

      {/* ── fund level ── */}
      {shown.map(({ s, i }) => (
        <div key={i} className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: s.colour }}>{s.label} — funds</div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th className="sticky-col text-left">Fund</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Weight</th>
                {FUND_RET.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
                {FUND_SIP.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
                {FUND_RATIO.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
                <th style={{ textAlign: 'right' }}>AUM (₹ Cr)</th>
              </tr></thead>
              <tbody>
                {priced(s).map(l => {
                  const r = risk[l.code], t = total(s), f = fundByCode.get(l.code)
                  return (
                    <tr key={l.code}>
                      <td className="sticky-col text-xs" style={{ maxWidth: 260 }}>
                        <div className="truncate"><FundLink code={l.code} name={name(l.code)} /></div>
                        <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                      </td>
                      <td className="ret-cell text-xs">{inr(l.amount!)}</td>
                      <td className="ret-cell text-xs font-semibold">{t ? pct1(l.amount! / t) : '—'}</td>
                      {FUND_RET.map(([lb, k]) => <td key={lb} className={`ret-cell text-xs ${retColor(r?.returns?.[k] ?? null)}`}>{fmtPct(r?.returns?.[k] ?? null)}</td>)}
                      {FUND_SIP.map(([lb, k]) => <td key={lb} className={`ret-cell text-xs ${retColor(r?.sip?.[k] ?? null)}`}>{fmtPct(r?.sip?.[k] ?? null)}</td>)}
                      {FUND_RATIO.map(([lb, get, fm]) => { const v = r ? get(r) : null; return <td key={lb} className="ret-cell text-xs">{v == null ? '—' : fm(v)}</td> })}
                      <td className="ret-cell text-xs">{r?.aum_cr == null ? '—' : Math.round(r.aum_cr).toLocaleString('en-IN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {debtLeftOut > 0 && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-low)' }}>
          {debtLeftOut} debt fund{debtLeftOut === 1 ? '' : 's'} left out of the correlation and overlap tables.
        </p>
      )}
      {focusFunds.length > 1 && (
        <>
          <CorrelationMatrix funds={focusFunds.map(f => ({ ...f, series: series[f.code] }))} />
          <OverlapMatrix funds={focusFunds} />
        </>
      )}

      <p className="text-[11px] mb-4" style={{ color: 'var(--text-low)' }}>
        Allocations look through each fund to its latest monthly portfolio, weighted by the amount in that fund. Market cap uses
        SEBI&apos;s classification (AMFI{caps ? `, ${caps.period}` : ''}). Returns and ratios are each fund&apos;s own (Risk &amp; Returns
        tab), averaged by amount. Balanced Advantage and Multi Asset funds have no holdings loaded, so they count in returns but
        not in the market-cap and sector split.
        {ltA.missing.length + ltB.missing.length > 0 && <> No holdings for: {[...new Set([...ltA.missing, ...ltB.missing])].join(', ')}.</>}
      </p>
    </div>
  )
}

export function ValueTable({ title, cols, two, rows }: {
  title: string; cols: { label: string; colour: string }[]; two: boolean
  rows: { label: string; vals: string[]; change?: React.ReactNode | null }[]
}) {
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{title}</div>
      <table className="data-table">
        <thead><tr>
          <th className="text-left">Measure</th>
          {cols.map(c => <th key={c.label} style={{ textAlign: 'right', color: c.colour }}>{c.label}</th>)}
          {two && <th style={{ textAlign: 'right' }}>Change</th>}
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="text-xs">{r.label}</td>
              {r.vals.map((v, i) => <td key={i} className="ret-cell text-xs font-semibold">{v}</td>)}
              {two && <td className="ret-cell text-xs">{r.change ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Share per row for each side, with bars so the split (and the shift) is visible at a glance. */
export function SplitTable({ title, note, cols, two, rows, sub }: {
  title: string; note: string; cols: { label: string; colour: string }[]; two: boolean
  rows: [string, number[], string?][]; sub?: Record<string, string>
}) {
  const max = Math.max(0.0001, ...rows.flatMap(r => r[1]))
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{title}</div>
      <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>{note}</div>
      <table className="data-table">
        <thead><tr>
          <th className="text-left">&nbsp;</th>
          {cols.map(c => <th key={c.label} style={{ textAlign: 'right', color: c.colour }}>{c.label}</th>)}
          {two && <th style={{ textAlign: 'right' }}>Change</th>}
        </tr></thead>
        <tbody>
          {rows.filter(r => r[1].some(v => v > 0.0005)).map(([l, v, c]) => (
            <tr key={l}>
              <td className="text-xs" style={{ minWidth: 170 }}>
                {c && <span style={{ color: c }}>● </span>}{l}
                {sub?.[l] && <div className="text-[10px] leading-snug" style={{ color: 'var(--text-low)' }} title={sub[l]}>{sub[l]}</div>}
                <div className="flex flex-col gap-0.5 mt-1">
                  {v.map((x, i) => <div key={i} className="h-1.5 rounded" style={{ width: `${(x / max) * 100}%`, background: cols[i].colour }} />)}
                </div>
              </td>
              {v.map((x, i) => <td key={i} className={`ret-cell text-xs ${i === v.length - 1 ? 'font-semibold' : ''}`}>{pct1(x)}</td>)}
              {two && <td className="ret-cell text-xs"><Delta v={v[1] - v[0]} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Weight the two portfolios hold in common: the sum, stock by stock, of the smaller weight. */
function stockOverlap(a: LookRow[], b: LookRow[]) {
  const m = new Map(b.filter(r => r.asset_class === 'Equity').map(r => [r.isin, r.weight]))
  return a.filter(r => r.asset_class === 'Equity').reduce((s, r) => s + Math.min(r.weight, m.get(r.isin) ?? 0), 0)
}
function onlyIn(a: LookRow[], b: LookRow[]) {
  const have = new Set(b.map(r => r.isin))
  return a.filter(r => r.asset_class === 'Equity' && !have.has(r.isin))
}

/** Biggest stock-level moves from one portfolio to the other, new and exited stocks marked. */
function StockChanges({ a, b }: { a: { s: ReviewSide; lt: { rows: LookRow[] } }; b: { s: ReviewSide; lt: { rows: LookRow[] } } }) {
  const [n, setN] = useState(10)
  const ma = new Map(a.lt.rows.filter(r => r.asset_class === 'Equity').map(r => [r.isin, r]))
  const mb = new Map(b.lt.rows.filter(r => r.asset_class === 'Equity').map(r => [r.isin, r]))
  const all = [...new Set([...ma.keys(), ...mb.keys()])].map(isin => {
    const x = ma.get(isin), y = mb.get(isin)
    return { isin, name: (y ?? x)!.name, industry: (y ?? x)!.industry, a: x?.weight ?? 0, b: y?.weight ?? 0 }
  })
  const up = all.filter(r => r.b - r.a > 0.0001).sort((p, q) => (q.b - q.a) - (p.b - p.a))
  const down = all.filter(r => r.a - r.b > 0.0001).sort((p, q) => (q.a - q.b) - (p.a - p.b))
  const table = (rows: typeof all, head: string, colour: string) => (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: colour }}>{head}</div>
      <table className="data-table">
        <thead><tr>
          <th className="text-left">Stock</th>
          <th style={{ textAlign: 'right', color: a.s.colour }}>{a.s.label}</th>
          <th style={{ textAlign: 'right', color: b.s.colour }}>{b.s.label}</th>
          <th style={{ textAlign: 'right' }}>Change</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, n).map(r => (
            <tr key={r.isin}>
              <td className="text-xs" style={{ maxWidth: 240 }}>
                <div className="truncate" title={r.name}>{r.name}
                  {r.a === 0 && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: 'rgba(34,211,238,0.15)', color: '#22D3EE' }}>NEW</span>}
                  {r.b === 0 && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: 'rgba(248,113,113,0.15)', color: '#F87171' }}>EXITED</span>}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{r.industry}</div>
              </td>
              <td className="ret-cell text-xs">{r.a ? `${(r.a * 100).toFixed(2)}%` : '—'}</td>
              <td className="ret-cell text-xs">{r.b ? `${(r.b * 100).toFixed(2)}%` : '—'}</td>
              <td className="ret-cell text-xs"><Delta v={r.b - r.a} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  if (!up.length && !down.length) return null
  return (
    <div className="mb-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {table(up, `Stocks increased (${up.length})`, '#34D399')}
        {table(down, `Stocks reduced (${down.length})`, '#F87171')}
      </div>
      {Math.max(up.length, down.length) > 10 && (
        <button className="tab-btn mt-2 text-xs" onClick={() => setN(v => (v === 10 ? 1000 : 10))}>
          {n === 10 ? '▾ Show all stock changes' : '▴ Show top 10 only'}
        </button>
      )}
    </div>
  )
}

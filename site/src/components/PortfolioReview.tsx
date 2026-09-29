// src/components/PortfolioReview.tsx — everything we know about a mutual fund
// portfolio, for one side (a plan) or two (existing vs proposed).
//
// Each side is a list of funds with an amount. Allocations look through every
// fund to its latest monthly portfolio (market cap, asset class, sectors with
// their industries, top holdings); returns and ratios are each fund's own from
// the Risk & Returns files, weighted by amount, beside a chosen benchmark. With
// one side the tables show a single column; with two, the change as well.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { PdfSection } from './PdfSections'
import { industryLine, sectorBreakdown } from './SectorBars'
import { useJson, useMeta } from '../hooks/useData'
import FundLink from './FundLink'
import OverlapMatrix from './OverlapMatrix'
import CorrelationMatrix, { adjustSplits, type NavSeries } from './CorrelationMatrix'
import { capSplit, useStockCaps, CAP_COLOURS } from './CapSplit'
import { useLookThrough, type LookRow } from './LookThrough'
import { BenchmarkPicker, useBenchmarkChoice } from '../sections/PortfolioBuilder'
import { leftOutOfMatrices } from '../utils/equityOnly'
import { categoryPath } from '../config/dataPaths'
import { closeAt, indexTrailing, useIndexSeries } from '../utils/benchmark'
import { isoMinus } from '../utils/navMath'
import { seriesStats } from '../utils/seriesStats'
import { categoryColor } from '../config/categoryColors'
import { fmtPct, retColor } from '../utils/format'
import type { FundsIndex, RiskData, RiskFundRow } from '../types'

export interface ReviewLine { code: string; amount: number | null }
export interface ReviewSide { label: string; colour: string; lines: ReviewLine[] }

export const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')
/** ₹ in lakh / crore, the way advisors talk about plan sizes. */
export const inrShort = (v: number) => v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : inr(v)
export const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

/** The exact difference between two percentages ("+1.37%"), coloured only when told which way is good. */
export function Delta({ v, good }: { v: number; good?: 'up' | 'down' }) {
  if (Math.abs(v) < 0.00005) return <span style={{ color: 'var(--text-low)' }}>0.00%</span>
  const up = v > 0
  const colour = !good ? 'var(--text-mid)' : (up === (good === 'up')) ? '#34D399' : '#F87171'
  return <span style={{ color: colour, fontWeight: 600 }}>{up ? '+' : '−'}{(Math.abs(v) * 100).toFixed(2)}%</span>
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

/** Each category's Risk & Returns file: the funds' rows, the category average and the benchmark. */
export function useRiskFiles(slugs: string[]) {
  const [files, setFiles] = useState<Record<string, RiskData | null>>({})
  const key = [...new Set(slugs)].sort().join(',')
  useEffect(() => {
    for (const slug of new Set(slugs)) {
      if (slug in files) continue
      setFiles(f => ({ ...f, [slug]: null }))
      categoryPath(slug, 'risk.json').then(pth => fetch(`/data/${pth}`)).then(r => (r.ok ? r.json() : null))
        .then((d: RiskData | null) => setFiles(f => ({ ...f, [slug]: d })))
        .catch(() => { /* not published for this category */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return files
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
  const allCodes = [...new Set([...A.lines, ...B.lines].map(l => l.code))]
  const riskFiles = useRiskFiles(allCodes.map(c => fundByCode.get(c)?.s).filter((x): x is string => !!x))
  // NAV history of every fund: correlation, and the numbers for funds with no published row.
  const series = useSeries(allCodes)
  const rf = Object.values(riskFiles).find(f => f?.risk_free_rate != null)?.risk_free_rate ?? 0.065
  const pubAsOf = Object.values(riskFiles).map(f => f?.as_of).filter((x): x is string => !!x).sort().slice(-1)[0] ?? null
  const risk = useMemo(() => {
    const out: Record<string, RiskFundRow> = {}
    for (const f of Object.values(riskFiles)) for (const r of f?.funds ?? []) if (allCodes.includes(r.scheme_code)) out[r.scheme_code] = r
    // Debt funds have no Risk & Returns file: their returns and ratios come from their own NAVs.
    // Beta, Alpha and captures need a benchmark of their own, so they stay blank.
    for (const c of allCodes) {
      const sr = series[c]
      if (out[c] || !sr?.points?.length) continue
      const st = seriesStats(adjustSplits(sr), rf, pubAsOf)
      if (!st) continue
      out[c] = {
        scheme_code: c, scheme_name: fundByCode.get(c)?.n ?? c,
        returns: st.returns as RiskFundRow['returns'], sip: st.sip,
        std_annual: st.std_annual, sharpe: st.sharpe, sortino: st.sortino, max_drawdown: st.max_drawdown,
        alpha: null, beta: null, upside_capture: null, downside_capture: null, composite_score: null, recovery_days: null,
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskFiles, series, allCodes.join(','), rf, pubAsOf])
  const caps = useStockCaps()
  const [benchId, setBenchId] = useBenchmarkChoice()
  const benchSeries = useIndexSeries(benchId)
  // Measured to the same day as the funds' returns: an index a day ahead or behind skews 1M.
  const asOf = Object.values(riskFiles).map(f => f?.as_of).filter((x): x is string => !!x).sort().slice(-1)[0] ?? meta?.as_of
  const benchTo = benchSeries && asOf ? benchSeries.filter(p => p[0] <= asOf) : benchSeries
  const bench: Record<string, number | null> = { ...indexTrailing(benchTo) }
  if (benchTo?.length) {
    const end = benchTo[benchTo.length - 1], start = closeAt(benchTo, isoMinus(end[0], 120))
    bench['10Y'] = start ? Math.pow(end[1] / start, 1 / 10) - 1 : null
  }
  const benchName = meta?.benchmarks.find(b => b.index_id === benchId)?.index_name ?? 'Index'
  // The benchmark's own SIP returns and ratios. Beta, Alpha and the captures measure a fund against its
  // benchmark, so for the benchmark itself they are left blank (they would only ever read 1, 0, 100, 100).
  const benchStats = seriesStats(benchTo, rf)
  const benchRow = benchStats ? {
    ...benchStats, returns: benchStats.returns as RiskFundRow['returns'],
    alpha: null, beta: null, upside_capture: null, downside_capture: null, composite_score: null, recovery_days: null,
    scheme_code: 'bench', scheme_name: benchName,
  } as RiskFundRow : null
  const [allHold, setAllHold] = useState<Record<number, boolean>>({})

  const total = (s: ReviewSide) => s.lines.reduce((t, l) => t + (l.amount ?? 0), 0)
  const shown = [A, B].map((s, i) => ({ s, i, lt: i === 0 ? ltA : ltB })).filter(x => sides[x.i] && total(x.s) > 0)
  const two = shown.length === 2
  // The side the fund-to-fund tables (overlap, correlation) are for: the proposal when there is one.
  const focus = shown[shown.length - 1]
  // Correlation and overlap compare domestic active equity funds only (utils/equityOnly).
  const isDebt = (code: string) =>
    leftOutOfMatrices(meta?.categories.find(c => c.slug === fundByCode.get(code)?.s)?.asset_class, name(code))
  // Correlation and overlap: one side at a time, chosen with a switch (the proposal by default).
  const [fxPick, setFxPick] = useState<number | null>(null)
  const fx = shown.find(x => x.i === fxPick) ?? focus
  const fundsOf = (s: ReviewSide) => priced(s).filter(l => !isDebt(l.code)).map(l => ({ code: l.code, name: name(l.code) }))
  const focusFunds = fx ? fundsOf(fx.s) : []
  const debtLeftOut = fx ? priced(fx.s).filter(l => isDebt(l.code)).length : 0
  // Overlap has its own switch, so the two tables can show different sides.
  const [ovPick, setOvPick] = useState<number | null>(null)
  const ov = shown.find(x => x.i === ovPick) ?? focus
  const ovFunds = ov ? fundsOf(ov.s) : []
  const ovDebt = ov ? priced(ov.s).filter(l => isDebt(l.code)).length : 0

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
      <PdfSection id="summary" page label="Summary (incl. stocks going out / coming in)" kicker="At a glance" title="Portfolio Summary">
      <ValueTable title="Summary" cols={cols} two={two} rows={[
        { label: 'Amount', vals: shown.map(x => inr(total(x.s))) },
        { label: 'Number of funds', vals: shown.map(x => String(priced(x.s).length)) },
        { label: 'Number of stocks (through the funds)', vals: shown.map(x => String(x.lt.rows.filter(r => r.asset_class === 'Equity').length)) },
        { label: 'Top 10 stocks, share of portfolio', vals: shown.map(x => pct1(top10(x.lt))),
          change: two ? <Delta v={top10(shown[1].lt) - top10(shown[0].lt)} /> : null },
        ...(two ? [
          { label: 'Funds in both', vals: (() => { const k = String(priced(shown[0].s).filter(l => priced(shown[1].s).some(m => m.code === l.code)).length); return [k, k] })() },
          { label: 'Stock overlap between the two (common weight)', vals: [pct1(stockOverlap(shown[0].lt.rows, shown[1].lt.rows)), ''] },
          { label: `Stocks going out (only in ${shown[0].s.label.toLowerCase()})`, vals: [String(onlyIn(shown[0].lt.rows, shown[1].lt.rows).length), ''] },
          { label: `New stocks coming in (only in ${shown[1].s.label.toLowerCase()})`, vals: ['', String(onlyIn(shown[1].lt.rows, shown[0].lt.rows).length)] },
        ] : []),
        { label: 'Average fund size (AUM, weighted)', vals: shown.map(x => { const v = weightedAum(x.s); return v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')} Cr` }) },
      ]} note={two ? <StocksExplained a={shown[0].s.label} b={shown[1].s.label}
                                       out={onlyIn(shown[0].lt.rows, shown[1].lt.rows).length}
                                       inn={onlyIn(shown[1].lt.rows, shown[0].lt.rows).length}
                                       overlap={stockOverlap(shown[0].lt.rows, shown[1].lt.rows)} /> : null} />
      </PdfSection>

      <PdfSection id="alloc" label="Market cap, asset class & category allocation" kicker="How the money is spread" title="Market Cap, Asset Class &amp; Category">
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
      </PdfSection>

      <PdfSection id="sector" page label="Sector allocation (with industries)" kicker="How the money is spread" title="Sector Allocation">
      <SplitTable cols={cols} two={two}
        sub={Object.fromEntries(sectorBreakdown(focus.lt.rows).map(g => [g.sector, industryLine(g)]))}
        title="Sector allocation" note="Equity holdings through the funds, % of the whole portfolio · industries in each sector underneath"
        rows={rowsFor(x => sectorSplit(x.lt.rows)).slice(0, 20).map(([k, ...v]) => [k, v] as [string, number[]])} />
      </PdfSection>

      {/* ── returns & ratios ── */}
      <PdfSection id="returns" page label="Returns, SIP returns & ratios (weighted, vs benchmark)" kicker="Performance" title="Returns &amp; Ratios">
      <div className="card overflow-hidden mb-4">
        <div className="px-4 pt-3 flex items-center flex-wrap gap-2">
          <span className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Returns &amp; ratios (weighted by amount)</span>
          <span className="ml-auto flex items-center gap-2 text-xs print:hidden" style={{ color: 'var(--text-mid)' }}>
            Compare with <BenchmarkPicker id={benchId} onChange={setBenchId} />
          </span>
        </div>
        <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
          Returns up to 1Y absolute, 3Y+ annualised. SIP = XIRR of a monthly SIP. Sharpe, Sortino, Std Dev, Alpha, Beta and captures over the last 3 years (monthly
          returns); Max DD = the worst fall from a peak in the fund&apos;s whole daily NAV history (since 2010 or launch).
        </div>
        <details className="px-4 pt-1 text-[11px]" style={{ color: 'var(--text-mid)' }}>
          <summary className="cursor-pointer font-semibold" style={{ color: 'var(--accent-a)' }}>How these are calculated</summary>
          <div className="py-2 leading-relaxed">
            <p className="mb-2">
              <b>Max drawdown (Max DD)</b> — the biggest fall from a high point to a later low point. Going through the fund&apos;s
              NAV day by day since 2010 (or launch), we keep the highest NAV so far (the peak) and each day work out
              <b> NAV today ÷ peak − 1</b>. The worst (most negative) value is the max drawdown.
            </p>
            <table className="mb-2" style={{ fontSize: 11 }}>
              <thead><tr>{['Month', 'NAV', 'Peak so far', 'Fall from peak'].map(h => <th key={h} className="text-left pr-4">{h}</th>)}</tr></thead>
              <tbody>
                {[['Jan', '100', '100', '0%'], ['Mar', '120', '120', '0% (new peak)'], ['May', '84', '120', '84 ÷ 120 − 1 = −30%  ← max drawdown'],
                  ['Aug', '110', '120', '−8.3%'], ['Dec', '125', '125', '0% (new peak)']].map(r => (
                  <tr key={r[0]}>{r.map((c, i) => <td key={i} className="pr-4" style={{ color: i === 3 && c.includes('max') ? '#F87171' : undefined }}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <p className="mb-2">
              So someone who invested at the top (120) was down 30% at the worst point (84). <b>Recovery</b> = days from that low until
              the NAV got back above the old peak. For the portfolio, each fund&apos;s max drawdown is weighted by its amount (an
              approximation — funds do not all hit their low on the same day).
            </p>
            <p className="mb-1"><b>Std Dev</b> — how much the monthly returns swing, annualised (× √12), last 3 years.</p>
            <p className="mb-1"><b>Sharpe</b> = (3Y return − risk-free rate) ÷ Std Dev. <b>Sortino</b> — the same, dividing by the downside swings only.</p>
            <p className="mb-1"><b>Beta</b> — how much the fund moves when its benchmark moves 1% (1.10 = 10% more). <b>Alpha</b> = 3Y return above what its Beta predicts.</p>
            <p className="mb-1"><b>Up / Down capture</b> — in the benchmark&apos;s up months, how much of the rise the fund caught (above 100 = more); in down months, how much of the fall (below 100 = fell less).</p>
            <p><b>SIP return</b> — XIRR of ₹ monthly instalments over the period, valued at the latest NAV.</p>
          </div>
        </details>
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
                  <tr key={l} className="col-ret">
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
                  <tr key={l} className="col-sip">
                    <td className="sticky-col text-xs">{l} (XIRR)</td>
                    {v.map((x, i) => <td key={i} className={`ret-cell text-xs ${retColor(x)}`}>{fmtPct(x)}</td>)}
                    {two && <td className="ret-cell text-xs">{v[0] != null && v[1] != null ? <Delta v={v[1] - v[0]} good="up" /> : '—'}</td>}
                    <td className={`ret-cell text-xs ${retColor(benchRow?.sip?.[k] ?? null)}`}>{fmtPct(benchRow?.sip?.[k] ?? null)}</td>
                  </tr>
                )
              })}
              {FUND_RATIO.map(([l, get, f, good]) => {
                const v = cols.map(s => weighted(s, get))
                const d = two && v[0] != null && v[1] != null ? v[1] - v[0] : null
                return (
                  <tr key={l} className="col-ratio">
                    <td className="sticky-col text-xs">{l}</td>
                    {v.map((x, i) => <td key={i} className="ret-cell text-xs">{x == null ? '—' : f(x)}</td>)}
                    {two && (
                      <td className="ret-cell text-xs">
                        {d == null || Math.abs(d) < 1e-9 ? '—' : (
                          <span style={{ color: !good ? 'var(--text-mid)' : (d > 0) === (good === 'up') ? '#34D399' : '#F87171' }}>
                            {d > 0 ? '+' : '−'}{l === 'Std Dev' || l === 'Max DD' ? `${(Math.abs(d) * 100).toFixed(2)}%` : Math.abs(d).toFixed(2)}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="ret-cell text-xs">{(() => { const b = benchRow ? get(benchRow) : null; return b == null ? '—' : f(b) })()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      </PdfSection>

      {/* ── top holdings ── */}
      <PdfSection id="holdings" page label="Top holdings" kicker="Look-through" title="Top Holdings">
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
      </PdfSection>

      {two && <PdfSection id="stocks" label="Stocks increased / reduced" kicker="Look-through" title="Stocks Increased &amp; Reduced"><StockChanges a={shown[0]} b={shown[1]} /></PdfSection>}

      <PdfSection id="comparative" label="Comparative analysis (fund vs category vs benchmark)" kicker="Performance" title="Fund vs Category Average vs Benchmark">
        <ComparativeAnalysis sides={shown.map(x => x.s)} risk={risk} riskFiles={riskFiles} fundByCode={fundByCode} asOf={asOf ?? null} />
      </PdfSection>

      {/* ── fund level ── */}
      <PdfSection id="funds" page label="Fund tables (each fund's returns & ratios)" kicker="Fund by fund" title="Fund Returns &amp; Ratios">
      {shown.map(({ s, i }) => ({ s, i, lines: two && i === 0
          ? priced(s).filter(l => !priced(shown[1].s).some(m => m.code === l.code))
          : priced(s) })).filter(x => x.lines.length > 0).map(({ s, i, lines }) => (
        <div key={i} className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: s.colour }}>{two && i === 0 ? 'Exited funds (sold in full)' : `${s.label} — funds`}</div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th className="sticky-col text-left">Fund</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Weight</th>
                {FUND_RET.map(([l]) => <th key={l} className="col-ret" style={{ textAlign: 'right' }}>{l}</th>)}
                {FUND_SIP.map(([l]) => <th key={l} className="col-sip" style={{ textAlign: 'right' }}>{l}</th>)}
                {FUND_RATIO.map(([l]) => <th key={l} className="col-ratio" style={{ textAlign: 'right' }}>{l}</th>)}
                <th className="col-aum" style={{ textAlign: 'right' }}>AUM (₹ Cr)</th>
              </tr></thead>
              <tbody>
                {lines.map(l => {
                  const r = risk[l.code], t = total(s), f = fundByCode.get(l.code)
                  return (
                    <tr key={l.code}>
                      <td className="sticky-col text-xs" style={{ maxWidth: 260 }}>
                        <div className="truncate"><FundLink code={l.code} name={name(l.code)} /></div>
                        <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                      </td>
                      <td className="ret-cell text-xs">{inr(l.amount!)}</td>
                      <td className="ret-cell text-xs font-semibold">{t ? pct1(l.amount! / t) : '—'}</td>
                      {FUND_RET.map(([lb, k]) => <td key={lb} className={`col-ret ret-cell text-xs ${retColor(r?.returns?.[k] ?? null)}`}>{fmtPct(r?.returns?.[k] ?? null)}</td>)}
                      {FUND_SIP.map(([lb, k]) => <td key={lb} className={`col-sip ret-cell text-xs ${retColor(r?.sip?.[k] ?? null)}`}>{fmtPct(r?.sip?.[k] ?? null)}</td>)}
                      {FUND_RATIO.map(([lb, get, fm]) => { const v = r ? get(r) : null; return <td key={lb} className="col-ratio ret-cell text-xs">{v == null ? '—' : fm(v)}</td> })}
                      <td className="col-aum ret-cell text-xs">{r?.aum_cr == null ? '—' : Math.round(r.aum_cr).toLocaleString('en-IN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      </PdfSection>

      <SideSwitch title="Correlation between funds" sides={shown} pick={fx?.i} onPick={setFxPick} count={x => fundsOf(x.s).length} two={two} />
      {debtLeftOut > 0 && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-low)' }}>
          {debtLeftOut} fund{debtLeftOut === 1 ? '' : 's'} left out of the correlation table (debt, hybrid, index and international funds).
        </p>
      )}
      {focusFunds.length > 1 ? (
        <div key={`c${fx?.i}`}>
          <PdfSection id="correlation" page label="Correlation between funds" kicker="Diversification"
                      title={`Correlation Between Funds${two ? ` — ${fx?.s.label} Portfolio` : ''}`}><CorrelationMatrix funds={focusFunds.map(f => ({ ...f, series: series[f.code] }))} /></PdfSection>
        </div>
      ) : (
        <p className="text-xs mb-4" style={{ color: 'var(--text-mid)' }}>
          The {fx?.s.label.toLowerCase()} portfolio has fewer than two equity funds (debt, hybrid, index and international funds are left out), so there is nothing to correlate.
        </p>
      )}

      <SideSwitch title="Portfolio overlap between funds" sides={shown} pick={ov?.i} onPick={setOvPick} count={x => fundsOf(x.s).length} two={two} />
      {ovDebt > 0 && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-low)' }}>
          {ovDebt} fund{ovDebt === 1 ? '' : 's'} left out of the overlap table (debt, hybrid, index and international funds).
        </p>
      )}
      {ovFunds.length > 1 ? (
        <div key={`o${ov?.i}`}>
          <PdfSection id="overlap" label="Portfolio overlap between funds" kicker="Diversification"
                      title={`Portfolio Overlap Between Funds${two ? ` — ${ov?.s.label} Portfolio` : ''}`}><OverlapMatrix funds={ovFunds} /></PdfSection>
        </div>
      ) : (
        <p className="text-xs mb-4" style={{ color: 'var(--text-mid)' }}>
          The {ov?.s.label.toLowerCase()} portfolio has fewer than two equity funds (debt, hybrid, index and international funds are left out), so there is no overlap to show.
        </p>
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

/** Plain-language note under the Summary: what "stocks going out / coming in" and overlap mean. */
function StocksExplained({ a, b, out, inn, overlap }: { a: string; b: string; out: number; inn: number; overlap: number }) {
  const A = a.toLowerCase(), B = b.toLowerCase()
  return (
    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}>
      <div className="font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>What the stock rows mean</div>
      <p className="mb-1">
        A mutual fund invests the money in shares of companies (HDFC Bank, Reliance, Infosys…). So a client holding a few funds
        actually owns small pieces of 100+ companies through them. These rows compare <b>which companies</b> the client owns
        through the {A} funds and through the {b.toLowerCase()} funds.
      </p>
      <p className="mb-1">
        <b>Example:</b> the {A} funds own HDFC Bank, Reliance, Infosys, <b>Tata Motors</b> and <b>ITC</b>; the {B} funds own
        HDFC Bank, Reliance, Infosys, <b>Zomato</b> and <b>Trent</b>. Then <b>stocks going out = 2</b> (Tata Motors and ITC — owned
        today, gone after the switch) and <b>new stocks coming in = 2</b> (Zomato and Trent — not owned today, added by the switch).
        HDFC Bank, Reliance and Infosys are in both, so they are in neither count.
      </p>
      <p className="mb-1">
        <b>Here:</b> {out} compan{out === 1 ? 'y' : 'ies'} the client owns today would go out, and {inn} new compan{inn === 1 ? 'y' : 'ies'} would
        come in. <b>Stock overlap {pct1(overlap)}</b> means {pct1(overlap)} of the portfolio stays in the same companies after the
        switch — the higher it is, the less the switch really changes what the client owns.
      </p>
      <p>
        The names are in <b>Stocks increased / Stocks reduced</b> further down: <b>NEW</b> = coming in, <b>EXITED</b> = going out.
      </p>
    </div>
  )
}

export function ValueTable({ title, cols, two, rows, note }: {
  title: string; cols: { label: string; colour: string }[]; two: boolean
  rows: { label: string; vals: string[]; change?: React.ReactNode | null }[]
  /** Shown under the table. */
  note?: React.ReactNode
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
      {note && <div className="px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>{note}</div>}
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

const CMP_PERIODS = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '12M'], ['2Y', '2Y'], ['3Y', '3Y'], ['5Y', '5Y']] as const
const ASSET_ORDER = ['Equity', 'Hybrid', 'Debt', 'Other']

/**
 * Every fund beside its category average and its category's benchmark, over
 * 1M–5Y. Funds are grouped by asset class and category, so funds of the same
 * category sit together with that category's average and benchmark under them.
 */
function ComparativeAnalysis({ sides, risk, riskFiles, fundByCode, asOf }: {
  sides: ReviewSide[]; risk: Record<string, RiskFundRow>; riskFiles: Record<string, RiskData | null>
  fundByCode: Map<string, FundsIndex['funds'][number]>; asOf: string | null
}) {
  const { data: meta } = useMeta()
  const cats = meta?.categories ?? []
  const inSide = (code: string) => sides.filter(s => s.lines.some(l => l.code === code && (l.amount ?? 0) > 0))
  const codes = [...new Set(sides.flatMap(s => s.lines.filter(l => (l.amount ?? 0) > 0).map(l => l.code)))]
  if (!codes.length) return null
  const bySlug = new Map<string, string[]>()
  for (const c of codes) { const s = fundByCode.get(c)?.s ?? 'other'; bySlug.set(s, [...(bySlug.get(s) ?? []), c]) }
  const order = (slug: string) => {
    const c = cats.find(x => x.slug === slug)
    return c ? ASSET_ORDER.indexOf(c.asset_class) * 1000 + c.display_order : 99999
  }
  const slugs = [...bySlug.keys()].sort((a, b) => order(a) - order(b))
  const cols = CMP_PERIODS.length + 1
  const cell = (v: number | null | undefined, ref?: (number | null | undefined)[]) => {
    const beat = v == null || !ref ? null : ref.filter((r): r is number => r != null).map(r => v > r)
    return (
      <td className={`ret-cell text-xs ${retColor(v ?? null)}`}>
        {fmtPct(v ?? null)}
        {beat && beat.length > 0 && (
          <span className="ml-1 text-[9px]"
                title={beat.every(Boolean) ? 'Ahead of category average and benchmark' : beat.some(Boolean) ? 'Ahead of one of them' : 'Behind both'}
                style={{ color: beat.every(Boolean) ? '#34D399' : beat.some(Boolean) ? '#F59E0B' : '#F87171' }}>●</span>
        )}
      </td>
    )
  }
  let lastAc = ''
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
        Comparative analysis — fund vs category average vs benchmark
      </div>
      <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
        Returns to {asOf ?? 'the latest NAV'}; up to 1Y absolute, 2Y and longer annualised. Benchmark = the category&apos;s benchmark.
        Dot: <span style={{ color: '#34D399' }}>●</span> ahead of both · <span style={{ color: '#F59E0B' }}>●</span> ahead of one ·{' '}
        <span style={{ color: '#F87171' }}>●</span> behind both.
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr>
            <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
            {CMP_PERIODS.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
          </tr></thead>
          <tbody>
            {slugs.map(slug => {
              const cat = cats.find(c => c.slug === slug)
              const file = riskFiles[slug]
              const avg = file?.category_average?.returns
              const bm = file?.benchmark
              const acRow = !!cat && cat.asset_class !== lastAc
              if (cat) lastAc = cat.asset_class
              const funds = [...(bySlug.get(slug) ?? [])].sort((a, b) => (fundByCode.get(a)?.n ?? '').localeCompare(fundByCode.get(b)?.n ?? ''))
              return (
                <Fragment key={slug}>
                  {acRow && (
                    <tr><td colSpan={cols} className="text-[11px] font-bold uppercase tracking-wide pt-3"
                            style={{ color: 'var(--text-mid)', background: 'var(--bg-raised)' }}>{cat!.asset_class}</td></tr>
                  )}
                  <tr><td colSpan={cols} className="text-xs font-semibold" style={{ color: categoryColor(slug) }}>
                    {cat?.category_name ?? fundByCode.get(funds[0])?.k ?? 'Other'}
                  </td></tr>
                  {funds.map(code => {
                    const r = risk[code]
                    return (
                      <tr key={code}>
                        <td className="sticky-col text-xs" style={{ maxWidth: 280, paddingLeft: 18 }}>
                          <div className="truncate">
                            <FundLink code={code} name={fundByCode.get(code)?.n ?? code} />
                            {sides.length > 1 && (() => {
                              // First side = existing, second = the proposal: a fund only in the proposal is new, only in the existing one is going.
                              const ins = inSide(code).map(s => s.label)
                              if (ins.length !== 1) return null
                              const isNew = ins[0] === sides[1].label
                              return (
                                <span className="ml-1.5 text-[9px] font-bold px-1 rounded"
                                      style={{ background: isNew ? 'rgba(34,211,238,0.15)' : 'rgba(248,113,113,0.15)', color: isNew ? '#22D3EE' : '#F87171' }}>
                                  {isNew ? 'NEW' : 'REMOVED'}
                                </span>
                              )
                            })()}
                          </div>
                        </td>
                        {CMP_PERIODS.map(([l, k]) => <Fragment key={l}>{cell(r?.returns?.[k], [avg?.[k], bm?.returns?.[k]])}</Fragment>)}
                      </tr>
                    )
                  })}
                  <tr className="benchmark-row">
                    <td className="sticky-col text-[11px]" style={{ paddingLeft: 18, color: 'var(--text-mid)' }}>Category average</td>
                    {CMP_PERIODS.map(([l, k]) => <Fragment key={l}>{cell(avg?.[k])}</Fragment>)}
                  </tr>
                  <tr className="benchmark-row">
                    <td className="sticky-col text-[11px]" style={{ paddingLeft: 18, color: 'var(--accent-a)' }}>
                      Benchmark{bm?.name ? ` — ${bm.name}` : ''}{bm?.stale ? ' (stale)' : ''}
                    </td>
                    {CMP_PERIODS.map(([l, k]) => <Fragment key={l}>{cell(bm?.returns?.[k])}</Fragment>)}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Old / new portfolio buttons above a fund-to-fund table. */
function SideSwitch({ title, sides, pick, onPick, count, two }: {
  title: string; sides: { s: ReviewSide; i: number }[]; pick: number | undefined
  onPick: (i: number) => void; count: (x: { s: ReviewSide; i: number }) => number; two: boolean
}) {
  return (
    <div className="card px-4 py-3 mb-2 mt-2 flex items-center gap-2 flex-wrap text-xs print:hidden" style={{ borderLeft: '3px solid var(--accent-a)' }}>
      <span className="font-display font-bold text-sm mr-2" style={{ color: 'var(--text-hi)' }}>{title}</span>
      {sides.map(x => (
        <button key={x.i} className={`tab-btn ${pick === x.i ? 'active' : ''}`} onClick={() => onPick(x.i)}
                style={pick === x.i ? { borderColor: x.s.colour, color: x.s.colour } : undefined}>
          {x.s.label} portfolio · {count(x)} funds
        </button>
      ))}
      <span style={{ color: 'var(--text-low)' }}>
        {two ? 'switch between the old and the new portfolio · updates as you change the funds' : 'updates as you change the funds'}
      </span>
    </div>
  )
}

// src/sections/CompareFunds.tsx — two to five funds side by side.
//
// Growth of ₹10,000 from a common start (the latest launch among them, or the
// range start), drawdowns, and a table of period return, the published trailing
// returns and ratios. NAVs from /api/series, split-adjusted here; returns and
// ratios from each fund's risk_{slug}.json.

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useJson, useMeta } from '../hooks/useData'
import { categoryPath } from '../config/dataPaths'
import { fmtDate, fmtPct, retColor } from '../utils/format'
import { cagr, isoMinus } from '../utils/navMath'
import FundLink from '../components/FundLink'
import type { FundsIndex, RiskData, RiskFundRow } from '../types'

const MAX = 5
const PALETTE = ['#22D3EE', '#F472B6', '#34D399', '#F59E0B', '#A78BFA']
type Range = '1M' | '6M' | '1Y' | '3Y' | '5Y' | '10Y' | 'Max'
const RANGE_MONTHS: Record<Range, number | null> = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120, Max: null }
const STORE_KEY = 'cmp_funds_v1'

interface Series { points: [string, number][]; splits: { date: string; factor: number }[] }

function adjust(s: Series): [string, number][] {
  if (!s.splits.length) return s.points
  return s.points.map(([d, v]) => [d, v / s.splits.filter(x => x.date > d).reduce((p, x) => p * x.factor, 1)])
}

/** Value on or before `date` from an ascending [date, value] list. */
function valueAt(pts: [string, number][], date: string): [string, number] | null {
  let lo = 0, hi = pts.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid][0] <= date) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans >= 0 ? pts[ans] : null
}

export default function CompareFunds() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const [codes, setCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') } catch { return [] }
  })
  const [pick, setPick] = useState('')
  const [range, setRange] = useState<Range>('3Y')
  const [series, setSeries] = useState<Record<string, Series>>({})
  const [risk, setRisk] = useState<Record<string, RiskFundRow | null>>({})

  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(codes)) } catch { /* optional */ } }, [codes])

  const byCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const labelOf = (f: FundsIndex['funds'][number]) => `${f.n} — ${f.k}`
  const codeByLabel = useMemo(() => new Map((index?.funds ?? []).map(f => [labelOf(f), f.c])), [index])

  // Fetch each fund's NAVs and its category's risk file once.
  useEffect(() => {
    for (const c of codes) {
      if (!series[c]) {
        fetch(`/api/series?code=${c}`).then(r => (r.ok ? r.json() : null))
          .then(d => d && setSeries(s => ({ ...s, [c]: d })))
      }
      const f = byCode.get(c)
      if (f && !(c in risk)) {
        setRisk(r => ({ ...r, [c]: null }))
        categoryPath(f.s, 'risk.json')
          .then(p => fetch(`/data/${p}`)).then(r => (r.ok ? r.json() : null))
          .then((d: RiskData | null) => setRisk(r => ({ ...r, [c]: d?.funds.find(x => x.scheme_code === c) ?? null })))
          .catch(() => { /* not published for this category */ })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, byCode])

  const add = () => {
    const c = codeByLabel.get(pick)
    if (c && !codes.includes(c) && codes.length < MAX) setCodes([...codes, c])
    setPick('')
  }

  const view = useMemo(() => {
    const adj = codes.filter(c => series[c]?.points.length).map(c => ({ c, pts: adjust(series[c]) }))
    if (!adj.length) return null
    const end = adj.map(a => a.pts[a.pts.length - 1][0]).sort()[0]          // earliest common last date
    const months = RANGE_MONTHS[range]
    const rangeStart = months ? isoMinus(end, months) : '0000-01-01'
    const start = [rangeStart, ...adj.map(a => a.pts[0][0])].sort().reverse()[0]   // latest launch wins
    const lines = adj.map(({ c, pts }) => {
      const base = valueAt(pts, start)
      const win = pts.filter(p => p[0] >= start && p[0] <= end)
      if (!base || win.length < 2) return { c, growth: [], dd: [], ret: null as number | null, maxDd: null as number | null }
      let peak = 0, maxDd = 0
      const growth = win.map(([d, v]) => [d, (v / base[1]) * 10000])
      const dd = win.map(([d, v]) => { peak = Math.max(peak, v); const x = v / peak - 1; maxDd = Math.min(maxDd, x); return [d, x * 100] })
      const last = valueAt(pts, end)!
      return { c, growth, dd, ret: last[1] / base[1] - 1, maxDd }
    })
    return { start, end, lines, clipped: start > rangeStart }
  }, [codes, series, range])

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const axis = isLight ? '#4B5563' : '#5E6F8F'
  const grid = isLight ? '#E5E7EB' : '#24314F'
  const nameOf = (c: string) => byCode.get(c)?.n ?? c
  const short = (c: string) => nameOf(c).replace(/\s*(Fund|Plan|Growth|Regular|Direct)\b/gi, '').slice(0, 34)

  const chartBase = {
    backgroundColor: 'transparent',
    xAxis: { type: 'time', axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } } },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, type: 'scroll', textStyle: { color: axis, fontSize: 11 } },
  }
  const growthOption = view && {
    ...chartBase,
    grid: { top: 34, right: 16, bottom: 30, left: 64 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => '₹' + Math.round(v).toLocaleString('en-IN') },
    yAxis: { type: 'value', scale: true, axisLabel: { color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: grid } } },
    series: view.lines.map((l, i) => ({ name: short(l.c), type: 'line', showSymbol: false, data: l.growth,
                                         lineStyle: { width: 2, color: PALETTE[i] }, itemStyle: { color: PALETTE[i] } })),
  }
  const ddOption = view && {
    ...chartBase,
    legend: { show: false },
    grid: { top: 10, right: 16, bottom: 30, left: 64 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v.toFixed(2) + '%' },
    yAxis: { type: 'value', max: 0, axisLabel: { color: axis, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: grid } } },
    series: view.lines.map((l, i) => ({ name: short(l.c), type: 'line', showSymbol: false, data: l.dd,
                                         lineStyle: { width: 1.2, color: PALETTE[i] }, itemStyle: { color: PALETTE[i] } })),
  }

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }
  const metric = (label: string, get: (r: RiskFundRow) => number | null | undefined, fmt: (v: number) => string, signed = false) => (
    <tr key={label}>
      <td className="text-xs sticky-col">{label}</td>
      {codes.map(c => {
        const v = risk[c] ? get(risk[c]!) : null
        return <td key={c} className={`ret-cell ${signed ? retColor(v ?? null) : ''}`}>{v == null ? '—' : fmt(v)}</td>
      })}
    </tr>
  )
  const pct = (v: number) => fmtPct(v)
  const n2 = (v: number) => v.toFixed(2)

  return (
    <section id="compare-funds" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header"><span>Compare Funds</span></div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3 text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1 min-w-[320px] flex-1">Add a fund ({codes.length}/{MAX})
          <div className="flex gap-2">
            <input list="cmp-fund-list" value={pick} onChange={e => setPick(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') add() }}
                   placeholder={index ? 'Start typing a fund name…' : 'Loading…'}
                   className="px-3 py-1.5 rounded-lg text-sm flex-1" style={inputStyle} />
            <button onClick={add} disabled={!pick || codes.length >= MAX} className="tab-btn active accent">Add</button>
          </div>
          <datalist id="cmp-fund-list">{(index?.funds ?? []).map(f => <option key={f.c} value={labelOf(f)} />)}</datalist>
        </label>
        <div className="tab-bar flex gap-1">
          {(Object.keys(RANGE_MONTHS) as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)} className={`tab-btn${range === r ? ' active accent' : ''}`}>{r}</button>
          ))}
        </div>
        <div className="w-full flex flex-wrap gap-2">
          {codes.map((c, i) => (
            <span key={c} className="text-xs px-2 py-1 rounded-full flex items-center gap-2"
                  style={{ border: `1px solid ${PALETTE[i]}`, color: PALETTE[i] }}>
              {short(c)}
              <button onClick={() => setCodes(codes.filter(x => x !== c))} title="Remove"
                      style={{ color: 'inherit', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </span>
          ))}
        </div>
      </div>

      {codes.length < 2 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Add two to five funds to compare them.
        </div>
      ) : (
        <>
          <div className="card p-4 mb-4">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>
              Growth of ₹10,000
              {view && <span className="font-normal text-xs ml-2" style={{ color: 'var(--text-low)' }}>
                {fmtDate(view.start)} → {fmtDate(view.end)}{view.clipped ? ' · starts when the youngest fund launched' : ''}
              </span>}
            </div>
            {growthOption ? <ReactECharts option={growthOption} style={{ height: 300 }} notMerge /> : <div className="skeleton h-72 w-full" />}
            <div className="text-xs font-semibold mt-2" style={{ color: 'var(--text-mid)' }}>Drawdown (below previous peak)</div>
            {ddOption ? <ReactECharts option={ddOption} style={{ height: 150 }} notMerge /> : null}
          </div>

          <div className="card overflow-hidden mb-4">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col text-left" style={{ minWidth: 170 }}>Measure</th>
                    {codes.map((c, i) => (
                      <th key={c} style={{ textAlign: 'right', color: PALETTE[i], minWidth: 150, whiteSpace: 'normal' }}>
                        <FundLink code={c} name={short(c)} />
                        <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.8 }}>{byCode.get(c)?.k}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view && (
                    <>
                      <tr>
                        <td className="text-xs sticky-col font-semibold">Return over chart period</td>
                        {codes.map(c => { const l = view.lines.find(x => x.c === c)
                          return <td key={c} className={`ret-cell font-semibold ${retColor(l?.ret ?? null)}`}>{fmtPct(l?.ret ?? null)}</td> })}
                      </tr>
                      <tr>
                        <td className="text-xs sticky-col">CAGR over chart period</td>
                        {codes.map(c => { const l = view.lines.find(x => x.c === c); const v = cagr(l?.ret ?? null, view.start, view.end)
                          return <td key={c} className={`ret-cell ${retColor(v)}`}>{v == null ? '—' : fmtPct(v)}</td> })}
                      </tr>
                      <tr>
                        <td className="text-xs sticky-col">Max drawdown over chart period</td>
                        {codes.map(c => { const l = view.lines.find(x => x.c === c)
                          return <td key={c} className="ret-cell ret-neg">{l?.maxDd == null ? '—' : fmtPct(l.maxDd)}</td> })}
                      </tr>
                    </>
                  )}
                  {metric('1M return', r => r.returns['1M'], pct, true)}
                  {metric('6M return', r => r.returns['6M'], pct, true)}
                  {metric('1Y return', r => r.returns['12M'], pct, true)}
                  {metric('3Y CAGR', r => r.returns['3Y'], pct, true)}
                  {metric('5Y CAGR', r => r.returns['5Y'], pct, true)}
                  {metric('Alpha (3Y)', r => (r.alpha == null ? null : r.alpha * 100), n2, true)}
                  {metric('Beta (3Y)', r => r.beta, n2)}
                  {metric('Sharpe (3Y)', r => r.sharpe, n2)}
                  {metric('Sortino (3Y)', r => r.sortino, n2)}
                  {metric('Std Dev (3Y)', r => (r.std_annual == null ? null : r.std_annual * 100), v => v.toFixed(2) + '%')}
                  {metric('Up Capture (3Y)', r => r.upside_capture, v => v.toFixed(1))}
                  {metric('Down Capture (3Y)', r => r.downside_capture, v => v.toFixed(1))}
                  {metric('Max Drawdown (all history)', r => r.max_drawdown, pct)}
                  {metric('TER (Regular, total)', r => r.ter ?? null, v => v.toFixed(2) + '%')}
                  {metric('AUM (₹ Cr, all plans)', r => r.aum_cr ?? null, v => Math.round(v).toLocaleString('en-IN'))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
            Chart and “chart period” rows start on the same day for every fund (the later of the range start and the
            youngest fund’s launch), so they compare like with like. The other rows are the published figures from Risk &amp;
            Returns ({meta ? `as of ${fmtDate(meta.as_of)}` : ''}). Click a fund name for its full page.
          </p>
        </>
      )}
    </section>
  )
}

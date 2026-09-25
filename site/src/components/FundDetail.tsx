// src/components/FundDetail.tsx — one fund on one screen. Opens over any tab when
// a fund name (<FundLink>) is clicked.
//
//   growth of ₹10,000 vs the category benchmark · drawdown · returns vs the
//   category average · ratios · quartile history · blacklist rules failed ·
//   top holdings (where the AMC's portfolio is loaded)
//
// NAVs from /api/series (split-adjusted here), holdings from /api/holdings;
// returns, ratios, quartiles and rules from the files the build published.

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useIndices, useJson, useMeta } from '../hooks/useData'
import { categoryPath } from '../config/dataPaths'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import { isoMinus } from '../utils/navMath'
import { onOpenFund } from './FundLink'
import type { BlacklistData, FundsIndex, QuartilesData, RiskData } from '../types'

type Range = '1Y' | '3Y' | '5Y' | 'Max'
const RANGE_MONTHS: Record<Range, number | null> = { '1Y': 12, '3Y': 36, '5Y': 60, Max: null }
const PERIODS: [string, string][] = [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'],
  ['12M', '1Y'], ['2Y', '2Y'], ['3Y', '3Y'], ['5Y', '5Y'], ['10Y', '10Y']]
const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

interface Series { points: [string, number][]; splits: { date: string; factor: number }[] }

/** Restate raw NAVs in today's units across unit splits. */
function adjust(s: Series): [string, number][] {
  if (!s.splits.length) return s.points
  return s.points.map(([d, v]) => {
    const f = s.splits.filter(x => x.date > d).reduce((p, x) => p * x.factor, 1)
    return [d, v / f]
  })
}

export default function FundDetail() {
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => onOpenFund(setCode), [])
  useEffect(() => {
    if (!code) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCode(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [code])
  if (!code) return null
  return <FundPanel key={code} code={code} onClose={() => setCode(null)} />
}

function FundPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const { data: indices } = useIndices()
  const info = index?.funds.find(f => f.c === code)
  const slug = info?.s ?? ''
  const cat = meta?.categories.find(c => c.slug === slug)
  const { data: risk } = useJson<RiskData>(() => categoryPath(slug, 'risk.json'), slug ? `fd-risk:${slug}` : '')
  const [qMode, setQMode] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly')
  const { data: quart } = useJson<QuartilesData>(
    () => categoryPath(slug, `quartiles_${qMode}.json`), slug ? `fd-q:${slug}:${qMode}` : '')
  const { data: black } = useJson<BlacklistData>('blacklist.json')
  const [series, setSeries] = useState<Series | null>(null)
  const [holdings, setHoldings] = useState<{ month: string | null; holdings: { name: string; industry: string; pct: number }[] } | null>(null)
  const [range, setRange] = useState<Range>('3Y')

  useEffect(() => {
    fetch(`/api/series?code=${code}`).then(r => (r.ok ? r.json() : null)).then(setSeries).catch(() => setSeries(null))
    fetch(`/api/holdings?code=${code}`).then(r => (r.ok ? r.json() : null)).then(setHoldings).catch(() => setHoldings(null))
  }, [code])

  const fundRisk = risk?.funds.find(f => f.scheme_code === code)
  const quartRow = quart?.funds.find(f => f.scheme_code === code)
  const flags = black?.funds.find(f => f.scheme_code === code)
  const failed = flags ? Object.entries(flags.rules).filter(([, v]) => v.fail) : []
  const bench = indices?.indices.find(i => i.index_id === cat?.benchmark_id)

  // Growth of ₹10,000 and drawdown over the chosen range.
  const chart = useMemo(() => {
    if (!series?.points.length) return null
    const pts = adjust(series)
    const last = pts[pts.length - 1][0]
    const months = RANGE_MONTHS[range]
    const start = months ? isoMinus(last, months) : pts[0][0]
    const view = pts.filter(p => p[0] >= start)
    if (view.length < 2) return null
    const base = view[0][1]
    const growth = view.map(([d, v]) => [d, (v / base) * 10000])
    let peak = 0
    const dd = view.map(([d, v]) => { peak = Math.max(peak, v); return [d, (v / peak - 1) * 100] })
    let benchLine: [string, number][] = []
    if (bench?.history?.length && !fundRisk?.benchmark_name) {
      const h = bench.history.filter(p => p[0] >= view[0][0] && p[0] <= last)
      if (h.length > 1 && h[0][0] <= isoMinus(view[0][0], -1)) {
        benchLine = h.map(([d, v]) => [d, (v / h[0][1]) * 10000])
      }
    }
    return { growth, dd, benchLine, from: view[0][0], to: last,
             end: growth[growth.length - 1][1] as number, benchEnd: benchLine.length ? benchLine[benchLine.length - 1][1] : null }
  }, [series, range, bench, fundRisk])

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const axis = isLight ? '#4B5563' : '#5E6F8F'
  const grid = isLight ? '#E5E7EB' : '#24314F'
  const colour = slug ? categoryColor(slug, cat?.asset_class) : '#22D3EE'

  const growthOption = chart && {
    backgroundColor: 'transparent',
    grid: { top: 30, right: 16, bottom: 30, left: 60 },
    legend: { top: 0, textStyle: { color: axis, fontSize: 11 } },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => '₹' + Math.round(v).toLocaleString('en-IN') },
    xAxis: { type: 'time', axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: grid } } },
    series: [
      { name: 'This fund', type: 'line', showSymbol: false, data: chart.growth, lineStyle: { width: 2, color: colour }, itemStyle: { color: colour } },
      ...(chart.benchLine.length ? [{ name: bench!.index_name, type: 'line', showSymbol: false, data: chart.benchLine,
                                     lineStyle: { width: 1.5, color: '#94A3B8', type: 'dashed' }, itemStyle: { color: '#94A3B8' } }] : []),
    ],
  }
  const ddOption = chart && {
    backgroundColor: 'transparent',
    grid: { top: 10, right: 16, bottom: 30, left: 60 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v.toFixed(2) + '%' },
    xAxis: { type: 'time', axisLabel: { color: axis, fontSize: 10 }, axisLine: { lineStyle: { color: grid } } },
    yAxis: { type: 'value', max: 0, axisLabel: { color: axis, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: grid } } },
    series: [{ type: 'line', showSymbol: false, data: chart.dd, areaStyle: { color: 'rgba(248,113,113,0.25)' },
               lineStyle: { width: 1, color: '#F87171' }, itemStyle: { color: '#F87171' } }],
  }

  const box = 'rounded-xl p-4'
  const boxStyle = { border: '1px solid var(--line)', background: 'var(--bg-base)' }
  const latest = series?.points.length ? series.points[series.points.length - 1] : null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
         style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-6xl rounded-2xl overflow-hidden flex flex-col"
           style={{ background: 'var(--bg-card)', border: '1px solid var(--line)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', maxHeight: '92vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b" style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)' }}>
          <div className="min-w-0">
            <div className="font-display font-bold text-lg truncate" style={{ color: 'var(--text-hi)' }}>{info?.n ?? code}</div>
            <div className="text-xs mt-0.5" style={{ color: colour }}>
              {info?.k ?? ''}{cat?.benchmark_name ? ` · Benchmark: ${cat.benchmark_name}` : ''}
              {fundRisk?.benchmark_name ? ` · Benchmark: ${fundRisk.benchmark_name}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {latest && (
              <div className="text-right">
                <div className="font-display font-bold text-lg" style={{ color: 'var(--text-hi)' }}>₹{latest[1].toFixed(4)}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>NAV · {fmtDate(latest[0])}</div>
              </div>
            )}
            <button onClick={onClose} className="rounded-lg px-2.5 py-1" title="Close (Esc)"
                    style={{ color: 'var(--text-mid)', border: '1px solid var(--line)', background: 'none', cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Growth + drawdown */}
          <div className={box} style={boxStyle}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
                Growth of ₹10,000
                {chart && <span className="font-normal text-xs ml-2" style={{ color: 'var(--text-low)' }}>
                  {fmtDate(chart.from)} → {fmtDate(chart.to)}: ₹{Math.round(chart.end).toLocaleString('en-IN')}
                  {chart.benchEnd != null && ` (benchmark ₹${Math.round(chart.benchEnd).toLocaleString('en-IN')})`}
                </span>}
              </div>
              <div className="tab-bar flex gap-1">
                {(Object.keys(RANGE_MONTHS) as Range[]).map(r => (
                  <button key={r} onClick={() => setRange(r)} className={`tab-btn${range === r ? ' active accent' : ''}`}>{r}</button>
                ))}
              </div>
            </div>
            {growthOption ? <ReactECharts option={growthOption} style={{ height: 260 }} notMerge /> :
              <div className="skeleton h-60 w-full" />}
            <div className="text-xs font-semibold mt-2" style={{ color: 'var(--text-mid)' }}>Drawdown (below previous peak)</div>
            {ddOption ? <ReactECharts option={ddOption} style={{ height: 140 }} notMerge /> : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Returns */}
            <div className={box} style={boxStyle}>
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>Returns vs category</div>
              <table className="data-table">
                <thead><tr><th className="text-left">Period</th><th style={{ textAlign: 'right' }}>Fund</th>
                  <th style={{ textAlign: 'right' }}>Category avg</th><th style={{ textAlign: 'right' }}>Difference</th></tr></thead>
                <tbody>
                  {PERIODS.map(([k, label]) => {
                    const f = fundRisk?.returns[k as keyof typeof fundRisk.returns] ?? null
                    const a = risk?.category_average.returns[k as keyof typeof risk.category_average.returns] ?? null
                    const d = f != null && a != null ? f - a : null
                    return (
                      <tr key={k}>
                        <td className="text-xs">{label}{['2Y', '3Y', '5Y', '10Y'].includes(k) ? ' (CAGR)' : ''}</td>
                        <td className={`ret-cell font-semibold ${retColor(f)}`}>{fmtPct(f)}</td>
                        <td className={`ret-cell ${retColor(a)}`}>{fmtPct(a)}</td>
                        <td className={`ret-cell ${retColor(d)}`}>{d == null ? '—' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)} pts`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!fundRisk && <div className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>Returns are published for Equity, Hybrid, index funds, ETFs and FoFs.</div>}
            </div>

            {/* Ratios */}
            <div className={box} style={boxStyle}>
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>Risk ratios (3Y)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  ['Alpha', fundRisk?.alpha == null ? '—' : (fundRisk.alpha * 100).toFixed(2), fundRisk?.alpha],
                  ['Beta', num(fundRisk?.beta), null],
                  ['Sharpe', num(fundRisk?.sharpe), fundRisk?.sharpe],
                  ['Sortino', num(fundRisk?.sortino), fundRisk?.sortino],
                  ['Std Dev', fundRisk?.std_annual == null ? '—' : (fundRisk.std_annual * 100).toFixed(2) + '%', null],
                  ['Max Drawdown', fmtPct(fundRisk?.max_drawdown ?? null), fundRisk?.max_drawdown],
                  ['Up Capture', num(fundRisk?.upside_capture, 1), null],
                  ['Down Capture', num(fundRisk?.downside_capture, 1), null],
                  ['Score (0–100)', num(fundRisk?.composite_score, 1), null],
                ].map(([l, v, sign]) => (
                  <div key={l as string} className="rounded-lg p-2" style={{ background: 'var(--bg-raised)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{l}</div>
                    <div className={`text-sm font-semibold ${sign == null ? '' : retColor(sign as number)}`}>{v}</div>
                  </div>
                ))}
              </div>
              {failed.length > 0 && (
                <div className="mt-3 text-xs">
                  <div className="font-semibold mb-1" style={{ color: 'var(--loss)' }}>🚩 Fails {failed.length} blacklist rule{failed.length === 1 ? '' : 's'}</div>
                  {failed.map(([k, v]) => <div key={k} style={{ color: 'var(--text-mid)' }}>• {v.text}</div>)}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Quartiles */}
            <div className={box} style={boxStyle}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>Quartile history</div>
                <div className="tab-bar flex gap-1">
                  {(['monthly', 'quarterly', 'annual'] as const).map(m => (
                    <button key={m} onClick={() => setQMode(m)} className={`tab-btn${qMode === m ? ' active accent' : ''}`}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {quartRow && quart ? (
                <div className="flex flex-wrap gap-1.5">
                  {quart.period_labels.map((l, i) => {
                    const { main, sub } = periodLabelParts(l)
                    const q = quartRow.quartiles[i]
                    return (
                      <div key={l} className="text-center" title={quartRow.returns?.[i] != null ? fmtPct(quartRow.returns[i]!) : ''}>
                        <div className={quartilePillClass(q)}>{q ? `Q${q}` : '−'}</div>
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-low)' }}>{main}{sub ? ` ${sub}` : ''}</div>
                      </div>
                    )
                  })}
                </div>
              ) : <div className="text-xs" style={{ color: 'var(--text-low)' }}>Quartiles are ranked for Equity and Hybrid funds.</div>}
            </div>

            {/* Holdings */}
            <div className={box} style={boxStyle}>
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>
                Top holdings {holdings?.month && <span className="font-normal text-xs" style={{ color: 'var(--text-low)' }}>· {holdings.month}</span>}
              </div>
              {holdings?.holdings.length ? (
                <>
                  <table className="data-table">
                    <tbody>
                      {holdings.holdings.slice(0, 10).map(h => (
                        <tr key={h.name}>
                          <td className="text-xs truncate" style={{ maxWidth: 220 }}>{h.name}</td>
                          <td className="text-[10px] truncate" style={{ color: 'var(--text-low)', maxWidth: 140 }}>{h.industry}</td>
                          <td className="ret-cell text-xs">{(h.pct * 100).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>
                    {holdings.holdings.length} stocks · top 10 = {(holdings.holdings.slice(0, 10).reduce((s, h) => s + h.pct, 0) * 100).toFixed(1)}% of the fund
                  </div>
                </>
              ) : <div className="text-xs" style={{ color: 'var(--text-low)' }}>Holdings are not loaded for this fund’s AMC yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

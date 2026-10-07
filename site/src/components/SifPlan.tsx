// src/components/SifPlan.tsx — SIF strategies inside a client plan: pick them,
// give each a lump sum and/or SIP, and see returns, risk and the strategy split.
//
// AMFI publishes only each SIF's latest NAV (sif.json, collected daily), so
// period returns, volatility and drawdown cover the days collected so far and
// "since launch" is measured from the launch price (₹10 or ₹1,000). SIF portfolios are not
// published, so there is no holdings look-through here.

import { useMemo, useRef, useState } from 'react'
import { PdfSection } from './PdfSections'
import ReactECharts from 'echarts-for-react'
import { useJson } from '../hooks/useData'
import { fuzzyFilter } from '../utils/fuzzy'
import { fmtDate, fmtPct, retColor } from '../utils/format'
import type { SifData, SifPeriod, SifPlan } from '../sections/sif/types'
import { inr, pct1 } from './PortfolioReview'
import { BenchmarkPicker, useBenchmarkChoice } from '../sections/PortfolioBuilder'
import { closeAt, useIndexSeries, type Series } from '../utils/benchmark'
import { isoMinus } from '../utils/navMath'
import { useMeta } from '../hooks/useData'

/** An index's return over the SIF periods, to the index's latest close. */
function indexSifReturns(series: Series | null): Partial<Record<SifPeriod, number | null>> {
  if (!series || series.length < 2) return {}
  const end = series[series.length - 1]
  const days = (d: number) => new Date(Date.parse(end[0]) - d * 86400000).toISOString().slice(0, 10)
  const at = (iso: string) => { const c = closeAt(series, iso); return c ? end[1] / c - 1 : null }
  return { '1D': end[1] / series[series.length - 2][1] - 1, '1W': at(days(7)), '1M': at(isoMinus(end[0], 1)),
           '3M': at(isoMinus(end[0], 3)), '6M': at(isoMinus(end[0], 6)), '1Y': at(isoMinus(end[0], 12)) }
}

export interface SifLine { id: string; lump: number | null; sip: number | null }

const PERIODS: SifPeriod[] = ['1D', '1W', '1M', '3M', '6M', '1Y']
const PALETTE = ['#22D3EE', '#F59E0B', '#A78BFA', '#34D399', '#F472B6', '#60A5FA', '#FB7185', '#FACC15']

export function useSifPlans() {
  const { data } = useJson<SifData>('sif.json')
  // Regular plans, growth option: what a client plan invests in.
  const plans = useMemo(() => (data?.plans ?? []).filter(p => !/direct/i.test(p.plan ?? '') && /growth/i.test(p.option ?? p.name)), [data])
  const byId = useMemo(() => new Map(plans.map(p => [p.id, p])), [plans])
  return { data, plans, byId }
}

/** Annualised volatility and worst fall from the collected daily NAVs. */
export function sifRisk(p: SifPlan) {
  const h = p.history
  if (h.length < 20) return { vol: null as number | null, dd: null as number | null }
  const r: number[] = []
  for (let i = 1; i < h.length; i++) r.push(h[i][1] / h[i - 1][1] - 1)
  const m = r.reduce((s, x) => s + x, 0) / r.length
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1))
  let peak = -Infinity, dd = 0
  for (const [, v] of h) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return { vol: sd * Math.sqrt(250), dd }
}

function SifPicker({ plans, exclude, onPick, style }: { plans: SifPlan[]; exclude: string[]; onPick: (p: SifPlan) => void; style: React.CSSProperties }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pool = plans.filter(p => !exclude.includes(p.id))
  const hits = fuzzyFilter(pool, q, p => `${p.name} ${p.house ?? ''} ${p.strategy}`, 10)
  return (
    <div ref={box} className="relative" onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
             placeholder="Add a SIF — type the house, name or strategy…" className="px-2 py-1.5 rounded text-xs w-full" style={style} />
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded shadow-lg max-h-72 overflow-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--line)' }}>
          {hits.map(p => (
            <button key={p.id} className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80" tabIndex={0}
                    style={{ background: 'none', border: 'none', color: 'var(--text-hi)', cursor: 'pointer' }}
                    onClick={() => { onPick(p); setQ(''); setOpen(false) }}>
              {p.name}
              <span className="ml-2 text-[10px]" style={{ color: 'var(--text-low)' }}>{p.strategy}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The SIF lines of a plan: strategy, lump sum, SIP. */
export function SifEditor({ lines, onChange, inputStyle, weightOf, showSip = true }: {
  lines: SifLine[]; onChange: (l: SifLine[]) => void; inputStyle: React.CSSProperties; showSip?: boolean
  /** Amount used for the weight column (same basis as the rest of the plan). */
  weightOf: (l: SifLine) => number
}) {
  const { data, plans, byId } = useSifPlans()
  const tot = lines.reduce((s, l) => s + weightOf(l), 0)
  const set = (i: number, patch: Partial<SifLine>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const num = (v: string) => (v === '' ? null : Math.max(0, +v))
  return (
    <div>
      {lines.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="text-left">SIF strategy</th>
              <th style={{ textAlign: 'right' }}>{showSip ? 'Lump sum ₹' : 'Amount ₹'}</th>
              {showSip && <th style={{ textAlign: 'right' }}>SIP ₹ / month</th>}
              <th style={{ textAlign: 'right' }}>Weight</th><th />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = byId.get(l.id)
                return (
                  <tr key={l.id}>
                    <td style={{ maxWidth: 320 }}>
                      <div className="text-xs font-medium truncate" title={p?.name}>{p?.name ?? l.id}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>
                        {p?.strategy}{p?.min_amount ? ` · min ${p.min_amount}` : ''}
                      </div>
                      {p && (
                        <div className="text-[10px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-mid)' }}>
                          <span>NAV {p.nav.toFixed(4)}</span>
                          {(['1M', '3M', '6M', '1Y'] as const).map(k => p.returns[k] != null && (
                            <span key={k} className={retColor(p.returns[k])}>{k} {fmtPct(p.returns[k])}</span>
                          ))}
                          {p.since_launch != null && <span className={retColor(p.since_launch)}>since launch {fmtPct(p.since_launch)}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ width: 140, textAlign: 'right' }}>
                      <span className="hidden print:inline text-xs font-semibold">{l.lump ? inr(l.lump) : '—'}</span>
                      <input type="number" min={0} step={100000} value={l.lump ?? ''} placeholder="Lump sum"
                             onChange={e => set(i, { lump: num(e.target.value) })} className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    {showSip && (
                      <td style={{ width: 130, textAlign: 'right' }}>
                        <span className="hidden print:inline text-xs font-semibold">{l.sip ? inr(l.sip) : '—'}</span>
                        <input type="number" min={0} step={5000} value={l.sip ?? ''} placeholder="SIP"
                               onChange={e => set(i, { sip: num(e.target.value) })} className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                      </td>
                    )}
                    <td className="ret-cell text-[11px]" style={{ width: 56, color: 'var(--text-low)' }}>{tot ? pct1(weightOf(l) / tot) : ''}</td>
                    <td style={{ width: 24 }}>
                      <button onClick={() => onChange(lines.filter((_, j) => j !== i))} title="Remove"
                              style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2">
        {data ? <SifPicker plans={plans} exclude={lines.map(l => l.id)} style={inputStyle}
                           onPick={p => onChange([...lines, { id: p.id, lump: null, sip: null }])} />
              : <span className="text-xs" style={{ color: 'var(--text-low)' }}>Loading SIFs…</span>}
      </div>
      <p className="text-[10px] mt-2" style={{ color: 'var(--text-low)' }}>
        SEBI minimum for SIFs is ₹10 lakh per investor across a SIF house&apos;s strategies. Regular plans, growth option.
      </p>
    </div>
  )
}

/** Returns, risk and splits for the SIF part of a plan. */
export function SifAnalysis({ lines, colour = '#A78BFA' }: { lines: { id: string; amount: number }[]; colour?: string }) {
  const { data, byId } = useSifPlans()
  const { data: meta } = useMeta()
  const [benchId, setBenchId] = useBenchmarkChoice()
  // To the SIF NAV date, so both cover the same days.
  const benchSeries = useIndexSeries(benchId)
  const benchRet = indexSifReturns(benchSeries && data?.as_of ? benchSeries.filter(p => p[0] <= data.as_of!) : benchSeries)
  const benchName = meta?.benchmarks.find(b => b.index_id === benchId)?.index_name ?? 'Index'
  const rows = lines.filter(l => l.amount > 0 && byId.has(l.id)).map(l => ({ ...l, p: byId.get(l.id)!, risk: sifRisk(byId.get(l.id)!) }))
  const tot = rows.reduce((s, r) => s + r.amount, 0)
  if (!rows.length) {
    return <div className="card p-6 text-center text-xs mb-4" style={{ color: 'var(--text-mid)' }}>Add SIF strategies with an amount to see the SIF analysis.</div>
  }
  const w = (get: (r: typeof rows[number]) => number | null) => {
    let s = 0, t = 0
    for (const r of rows) { const v = get(r); if (v == null) continue; s += v * r.amount; t += r.amount }
    return t ? s / t : null
  }
  const split = (key: (p: SifPlan) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(key(r.p), (m.get(key(r.p)) ?? 0) + r.amount / tot)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }

  // NAV rebased to 100 from the first day every chosen SIF has a price.
  const start = rows.map(r => r.p.history[0]?.[0]).filter(Boolean).sort().slice(-1)[0]
  const chart = start ? {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => v?.toFixed(2) },
    legend: { top: 0, textStyle: { color: '#94A3B8', fontSize: 10 }, type: 'scroll' },
    grid: { left: 40, right: 16, top: 36, bottom: 28 },
    xAxis: { type: 'time', axisLabel: { color: '#94A3B8', fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#94A3B8', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } } },
    series: rows.map((r, i) => {
      const pts = r.p.history.filter(h => h[0] >= start)
      const base = pts[0]?.[1] ?? 1
      return { name: r.p.name.replace(/\s*-\s*Regular.*$/i, ''), type: 'line', showSymbol: false, lineStyle: { width: 1.6 },
               color: PALETTE[i % PALETTE.length], data: pts.map(h => [h[0], (h[1] / base) * 100]) }
    }),
  } : null

  return (
    <div>
      <PdfSection id="sif-split" page label="SIF — strategy & house allocation" kicker="SIF" title="SIF Strategy &amp; House Allocation">
      <div className="grid gap-4 lg:grid-cols-2">
        {([['Strategy allocation', split(p => p.strategy)], ['SIF house allocation', split(p => p.house ?? 'Other')]] as const).map(([t, s]) => (
          <div key={t} className="card p-4 mb-4">
            <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>{t}</div>
            {s.map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2 text-[11px] py-1">
                <span className="truncate" style={{ width: 200, color: 'var(--text-hi)' }} title={k}>{k}</span>
                <div className="flex-1 h-2 rounded" style={{ background: 'var(--bg-raised)' }}>
                  <div className="h-2 rounded" style={{ width: `${v * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                </div>
                <span className="ret-cell" style={{ width: 48 }}>{pct1(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      </PdfSection>

      <PdfSection id="sif-returns" label="SIF — returns & risk (vs benchmark)" kicker="SIF" title="SIF Returns &amp; Risk">
      <div className="card overflow-hidden mb-4">
        <div className="px-4 pt-3 flex items-center flex-wrap gap-2">
          <span className="font-display font-bold text-sm" style={{ color: colour }}>SIF strategies — returns &amp; risk</span>
          <span className="ml-auto flex items-center gap-2 text-xs print:hidden" style={{ color: 'var(--text-mid)' }}>
            Compare with <BenchmarkPicker id={benchId} onChange={setBenchId} />
          </span>
        </div>
        <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
          Returns from the NAVs collected since {fmtDate(data?.plans.map(p => p.history_from).filter(Boolean).sort()[0] ?? null)};
          since launch from the launch price (₹10 or ₹1,000; blank for IDCW options or when the history does not reach the launch). Volatility = daily return swings × √250. Max DD = the worst fall from a peak since launch
          (each day: NAV ÷ highest NAV so far − 1; the lowest value).
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="sticky-col text-left">SIF</th>
              <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Weight</th>
              <th style={{ textAlign: 'right' }}>NAV</th>
              {PERIODS.map(p => <th key={p} style={{ textAlign: 'right' }}>{p}</th>)}
              <th style={{ textAlign: 'right' }}>Since launch</th><th style={{ textAlign: 'right' }}>Since launch p.a.</th>
              <th style={{ textAlign: 'right' }}>Volatility</th><th style={{ textAlign: 'right' }}>Max DD</th>
              <th style={{ textAlign: 'right' }}>Days live</th><th className="text-left">Exit load</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="sticky-col text-xs" style={{ maxWidth: 260 }}>
                    <div className="truncate font-medium" title={r.p.name}>{r.p.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{r.p.house} · {r.p.strategy}</div>
                  </td>
                  <td className="ret-cell text-xs">{inr(r.amount)}</td>
                  <td className="ret-cell text-xs font-semibold">{pct1(r.amount / tot)}</td>
                  <td className="ret-cell text-xs" title={fmtDate(r.p.date)}>{r.p.nav.toFixed(4)}</td>
                  {PERIODS.map(p => <td key={p} className={`ret-cell text-xs ${retColor(r.p.returns[p])}`}>{fmtPct(r.p.returns[p])}</td>)}
                  <td className={`ret-cell text-xs ${retColor(r.p.since_launch)}`}>{fmtPct(r.p.since_launch)}</td>
                  <td className={`ret-cell text-xs ${retColor(r.p.since_launch_ann ?? null)}`}>{fmtPct(r.p.since_launch_ann ?? null)}</td>
                  <td className="ret-cell text-xs">{r.risk.vol == null ? '—' : pct1(r.risk.vol)}</td>
                  <td className="ret-cell text-xs">{r.risk.dd == null ? '—' : pct1(r.risk.dd)}</td>
                  <td className="ret-cell text-xs">{r.p.days_live ?? '—'}</td>
                  <td className="text-[10px]" style={{ color: 'var(--text-mid)', maxWidth: 220 }} title={[r.p.exit_load, r.p.exit_load_note].filter(Boolean).join(' — ')}>
                    <div className="truncate">{r.p.exit_load ?? '—'}</div>
                  </td>
                </tr>
              ))}
              <tr className="benchmark-row">
                <td className="sticky-col text-xs font-semibold">SIF part (weighted)</td>
                <td className="ret-cell text-xs font-semibold">{inr(tot)}</td><td className="ret-cell text-xs">100%</td><td />
                {PERIODS.map(p => { const v = w(r => r.p.returns[p]); return <td key={p} className={`ret-cell text-xs ${retColor(v)}`}>{fmtPct(v)}</td> })}
                {[w(r => r.p.since_launch), w(r => r.p.since_launch_ann ?? null)].map((v, i) => <td key={i} className={`ret-cell text-xs ${retColor(v)}`}>{fmtPct(v)}</td>)}
                {[w(r => r.risk.vol), w(r => r.risk.dd)].map((v, i) => <td key={i} className="ret-cell text-xs">{v == null ? '—' : pct1(v)}</td>)}
                <td /><td />
              </tr>
              <tr>
                <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--accent-a)' }}>{benchName}</td>
                <td /><td /><td />
                {PERIODS.map(p => <td key={p} className={`ret-cell text-xs ${retColor(benchRet[p] ?? null)}`}>{fmtPct(benchRet[p] ?? null)}</td>)}
                <td colSpan={6} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      </PdfSection>

      {chart && rows.some(r => r.p.history.length > 1) && (
        <PdfSection id="sif-chart" label="SIF — NAV chart" kicker="SIF" title="SIF NAV Growth">
        <div className="card p-4 mb-4">
          <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-hi)' }}>SIF NAV, rebased to 100</div>
          <ReactECharts option={chart} style={{ height: 220 }} notMerge />
        </div>
        </PdfSection>
      )}

      <PdfSection id="sif-details" label="SIF — strategy details" kicker="SIF" title="SIF Strategy Details">
      <div className="card p-4 mb-4">
        <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>Strategy details</div>
        {rows.map(r => (
          <div key={r.id} className="text-xs py-2" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>{r.p.name}</div>
            <div style={{ color: 'var(--text-mid)' }}>{r.p.objective ?? 'Objective not published.'}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-low)' }}>
              Launched {fmtDate(r.p.launch_date ?? null)} · Min {r.p.min_amount ?? '—'}
              {/* On screen only: a PDF carries no links. */}
              {r.p.website && <span className="print:hidden"> · <a href={r.p.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>website</a></span>}
            </div>
          </div>
        ))}
      </div>
      </PdfSection>
    </div>
  )
}

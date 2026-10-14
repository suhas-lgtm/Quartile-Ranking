// src/sections/sif/CrossCompare.tsx — SIFs, indices and mutual funds side by side.
//
// One search box over every SIF plan (sif.json), every mutual fund
// (funds_index.json) and every index the pipeline holds (meta.json benchmarks);
// up to 20 picks. All are measured from the same start — the first day every
// pick has a value (SIFs are young, so usually a SIF's first NAV) — or a shorter
// window chosen above the chart: growth of ₹10,000, returns over 1W to 1Y and
// over the whole window, and the risk taken in that same window (annualised
// volatility of daily moves, the worst fall from a peak). Picks are remembered
// in this browser.

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useJson, useMeta } from '../../hooks/useData'
import { dataBase } from '../../config/dataPaths'
import FundPicker, { type IndexFund } from '../../components/FundPicker'
import DownloadButton from '../../components/DownloadButton'
import { adjustSplits, type NavSeries } from '../../components/CorrelationMatrix'
import { fmtDate, fmtPct, retColor } from '../../utils/format'
import type { SheetSpec } from '../../utils/xlsx'
import type { FundsIndex } from '../../types'
import type { SifData } from './types'

type Kind = 'sif' | 'mf' | 'idx'
type Pts = [string, number][]
const MAX = 20
const STORE = 'sifx_v1'
/** 20 distinct colours, one per pick. */
const PALETTE = ['#22D3EE', '#F59E0B', '#A78BFA', '#34D399', '#F472B6', '#60A5FA', '#FB7185', '#FACC15', '#2DD4BF', '#E879F9',
                 '#F97316', '#84CC16', '#38BDF8', '#C084FC', '#4ADE80', '#FCA5A5', '#FDE047', '#818CF8', '#5EEAD4', '#FDBA74']
const KIND_LABEL: Record<Kind, string> = { sif: 'SIF', mf: 'Mutual fund', idx: 'Index' }
const WINDOWS = [['all', 'Since the common start'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '1Y']] as const
type Win = typeof WINDOWS[number][0]
const PERIODS: [string, number][] = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365]]

const minusDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10) }
/** Value on or before a date (within 10 days), from an ascending series. */
function at(p: Pts, d: string): number | null {
  let lo = 0, hi = p.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p[m][0] <= d) { ans = m; lo = m + 1 } else hi = m - 1 }
  if (ans < 0) return null
  return (Date.parse(d) - Date.parse(p[ans][0])) / 86400000 <= 10 ? p[ans][1] : null
}

function load(): string[] { try { const v = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

export default function CrossCompare() {
  const { data: meta } = useMeta()
  const { data: sif } = useJson<SifData>('sif.json')
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const [keys, setKeys] = useState<string[]>(load)
  const [pick, setPick] = useState('')
  const [win, setWin] = useState<Win>('all')
  const [series, setSeries] = useState<Record<string, Pts | null>>({})
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(keys)) } catch { /* optional */ } }, [keys])

  // One pool for the search box: SIFs (Regular plans), mutual funds, indices.
  const pool: IndexFund[] = useMemo(() => [
    ...(sif?.plans ?? []).filter(p => !/direct/i.test(p.plan ?? '')).map(p => ({ c: `sif:${p.id}`, n: p.name, k: `SIF · ${p.strategy}`, s: '' })),
    ...(meta?.benchmarks ?? []).map(b => ({ c: `idx:${b.index_id}`, n: b.index_name, k: 'Index', s: '' })),
    ...(index?.funds ?? []).map(f => ({ c: `mf:${f.c}`, n: f.n, k: f.k, s: f.s })),
  ], [sif, meta, index])
  const nameOf = (k: string) => pool.find(x => x.c === k)?.n ?? k
  const kindOf = (k: string) => k.split(':')[0] as Kind
  const tagOf = (k: string) => pool.find(x => x.c === k)?.k ?? ''

  // Each pick's daily history: SIF from sif.json, index from /data/index, mutual fund from /api/series.
  useEffect(() => {
    for (const k of keys) {
      if (k in series) continue
      const [kind, id] = k.split(':')
      if (kind === 'sif') {
        const p = sif?.plans.find(x => x.id === id)
        if (p) setSeries(s => ({ ...s, [k]: p.history as Pts }))
        continue
      }
      setSeries(s => ({ ...s, [k]: null }))
      const url = kind === 'idx' ? `${dataBase()}/index/${id}.json` : `/api/series?code=${id}`
      fetch(url).then(r => (r.ok ? r.json() : null)).then(d => {
        if (!d) return
        const pts: Pts = kind === 'idx' ? d.series : adjustSplits(d as NavSeries)
        setSeries(s => ({ ...s, [k]: pts }))
      }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(','), sif])

  const ready = keys.filter(k => series[k]?.length)
  const common = ready.length ? ready.map(k => series[k]![0][0]).sort().slice(-1)[0] : ''
  const end = ready.length ? ready.map(k => series[k]![series[k]!.length - 1][0]).sort()[0] : ''
  const winStart = win === 'all' ? common : (() => {
    const d = minusDays(end, PERIODS.find(([l]) => l === win)![1])
    return d < common ? common : d
  })()
  const short = win !== 'all' && winStart === common && common > minusDays(end, PERIODS.find(([l]) => l === win)![1])

  const stats = ready.map(k => {
    const pts = series[k]!
    const inWin = pts.filter(p => p[0] >= winStart && p[0] <= end)
    const base = at(pts, winStart) ?? inWin[0]?.[1]
    const last = at(pts, end) ?? pts[pts.length - 1][1]
    // risk over the window: daily moves, annualised; worst fall from a peak
    const moves: number[] = []
    for (let i = 1; i < inWin.length; i++) moves.push(inWin[i][1] / inWin[i - 1][1] - 1)
    const mean = moves.reduce((a, b) => a + b, 0) / (moves.length || 1)
    const vol = moves.length > 5 ? Math.sqrt(moves.reduce((a, b) => a + (b - mean) ** 2, 0) / (moves.length - 1)) * Math.sqrt(250) : null
    let peak = -Infinity, dd = 0
    for (const [, v] of inWin) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
    const rets = Object.fromEntries(PERIODS.map(([l, n]) => {
      const from = minusDays(end, n)
      const v0 = from >= pts[0][0] ? at(pts, from) : null
      return [l, v0 ? last / v0 - 1 : null]
    }))
    return { k, base, last, window: base ? last / base - 1 : null, vol, dd: inWin.length > 1 ? dd : null, rets, first: pts[0][0] }
  })

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const axis = isLight ? '#4B5563' : '#5E6F8F'
  const option = stats.length && common ? {
    backgroundColor: 'transparent', grid: { top: 40, right: 18, bottom: 30, left: 64 },
    legend: { top: 0, type: 'scroll', textStyle: { color: axis, fontSize: 11 } },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}` },
    xAxis: { type: 'time', axisLabel: { color: axis, fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: axis, fontSize: 10, formatter: (v: number) => `₹${(v / 1000).toFixed(1)}k` } },
    series: stats.map(s => {
      const i = keys.indexOf(s.k)
      const pts = series[s.k]!.filter(p => p[0] >= winStart && p[0] <= end)
      return { name: nameOf(s.k).slice(0, 42), type: 'line', showSymbol: false, smooth: false,
               lineStyle: { width: kindOf(s.k) === 'idx' ? 2.5 : 2, color: PALETTE[i % PALETTE.length], type: kindOf(s.k) === 'idx' ? 'dashed' : 'solid' },
               itemStyle: { color: PALETTE[i % PALETTE.length] },
               data: pts.map(([d, v]) => [d, s.base ? (v / s.base) * 10000 : null]) }
    }),
  } : null

  const buildExport = (): SheetSpec | null => stats.length ? {
    sheet: 'SIF vs Index vs MF', title: 'SIF vs Index vs Mutual Fund',
    meta: [['Window', `${fmtDate(winStart)} to ${fmtDate(end)}`]],
    columns: [{ key: 'name', label: 'Name', type: 'text', width: 46 }, { key: 'kind', label: 'Type', type: 'text', width: 12 },
              { key: 'cat', label: 'Category', type: 'text', width: 24 },
              ...PERIODS.map(([l]) => ({ key: l, label: l, type: 'percent' as const })),
              { key: 'win', label: 'Window return', type: 'percent' }, { key: 'vol', label: 'Volatility (ann.)', type: 'percent' },
              { key: 'dd', label: 'Worst fall', type: 'percent' }],
    rows: stats.map(s => ({ name: nameOf(s.k), kind: KIND_LABEL[kindOf(s.k)], cat: tagOf(s.k), ...s.rets, win: s.window, vol: s.vol, dd: s.dd })),
    fileName: `SIF vs Index vs MF - ${end}`,
  } : null

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }
  return (
    <>
      <p className="text-xs mb-3" style={{ color: 'var(--text-mid)' }}>
        Pick any SIFs, indices and mutual funds (up to {MAX}) and compare them over the same dates. Everything is measured from the
        first day <b>all</b> picks have a value — SIFs are new, so usually a SIF&apos;s first NAV — or a shorter window chosen below.
      </p>
      <div className="card p-3 mb-3 flex items-end gap-2 flex-wrap text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1 flex-1 min-w-[320px]">Add a SIF, an index or a mutual fund ({keys.length}/{MAX})
          <FundPicker funds={pool} value={pick} onChange={setPick} exclude={keys}
                      onPick={x => { if (keys.length < MAX) setKeys([...keys, x.c]); setPick('') }}
                      placeholder="Type a SIF, an index (e.g. Nifty 50) or a fund name…" style={inputStyle} />
        </label>
        {keys.length > 0 && <button className="tab-btn" onClick={() => setKeys([])}>Clear all</button>}
      </div>
      {keys.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {keys.map((k, i) => (
            <span key={k} className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ border: `1px solid ${PALETTE[i % PALETTE.length]}`, color: PALETTE[i % PALETTE.length] }}>
              <b className="text-[9px] uppercase">{KIND_LABEL[kindOf(k)]}</b> {nameOf(k).slice(0, 44)}
              {!series[k]?.length && <span style={{ color: 'var(--text-low)' }}> · loading…</span>}
              <button onClick={() => setKeys(keys.filter(x => x !== k))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {keys.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Add a SIF, an index and a mutual fund to compare them — e.g. a hybrid long-short SIF, the NIFTY 50 and a balanced advantage fund.
        </div>
      ) : stats.length > 0 && (
        <>
          <div className="card p-4 mb-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>Growth of ₹10,000 · {fmtDate(winStart)} to {fmtDate(end)}</span>
              <span className="ml-auto tab-bar flex gap-1">
                {WINDOWS.map(([w, l]) => <button key={w} className={`tab-btn${win === w ? ' active accent' : ''}`} onClick={() => setWin(w)}>{l}</button>)}
              </span>
            </div>
            {short && <div className="text-[11px] mb-1" style={{ color: '#F59E0B' }}>Not every pick has that much history — shown from {fmtDate(common)}, the first day all have a value.</div>}
            {option && <ReactECharts option={option} style={{ height: 320 }} notMerge />}
            <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>Indices are drawn dashed. Fund and SIF NAVs are after expenses; an index has none.</div>
          </div>

          <div className="card overflow-hidden mb-4">
            <div className="flex items-center px-4 pt-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>Returns &amp; risk</span>
              <span className="ml-auto"><DownloadButton build={buildExport} /></span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th className="sticky-col text-left" style={{ minWidth: 260 }}>Name</th>
                  <th className="text-left">Type</th>
                  {PERIODS.map(([l]) => <th key={l} style={{ textAlign: 'right' }} title={`${l} return, to ${fmtDate(end)}`}>{l}</th>)}
                  <th style={{ textAlign: 'right' }} title="Return over the chosen window">Window</th>
                  <th style={{ textAlign: 'right' }} title="Annualised volatility of daily moves in the window (lower = steadier)">Volatility</th>
                  <th style={{ textAlign: 'right' }} title="Worst fall from a high point in the window">Worst fall</th>
                  <th style={{ textAlign: 'right' }}>History from</th>
                </tr></thead>
                <tbody>
                  {stats.map(s => {
                    const i = keys.indexOf(s.k)
                    return (
                      <tr key={s.k}>
                        <td className="sticky-col text-xs" style={{ maxWidth: 320 }}>
                          <div className="truncate font-medium" style={{ color: PALETTE[i % PALETTE.length] }}>{nameOf(s.k)}</div>
                          <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{tagOf(s.k)}</div>
                        </td>
                        <td className="text-xs">{KIND_LABEL[kindOf(s.k)]}</td>
                        {PERIODS.map(([l]) => <td key={l} className={`ret-cell text-xs ${retColor(s.rets[l] ?? null)}`}>{fmtPct(s.rets[l] ?? null)}</td>)}
                        <td className={`ret-cell text-xs font-semibold ${retColor(s.window)}`}>{fmtPct(s.window)}</td>
                        <td className="ret-cell text-xs">{s.vol == null ? '—' : `${(s.vol * 100).toFixed(1)}%`}</td>
                        <td className="ret-cell text-xs">{s.dd == null ? '—' : `${(s.dd * 100).toFixed(1)}%`}</td>
                        <td className="ret-cell text-xs" style={{ color: 'var(--text-low)' }}>{fmtDate(s.first)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[11px]" style={{ color: 'var(--text-mid)' }}>
              1W–1Y: point-to-point to {fmtDate(end)} (blank when the history is shorter). <b>Window</b>, <b>Volatility</b> and <b>Worst fall</b>
              use the dates on the chart, the same for every pick. Volatility = standard deviation of daily moves × √250.
            </p>
          </div>
        </>
      )}
    </>
  )
}

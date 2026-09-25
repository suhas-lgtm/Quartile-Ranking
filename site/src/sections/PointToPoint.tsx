// src/sections/PointToPoint.tsx — any two dates: every fund's NAV and return in
// a category between them, with the category average and benchmark.
//
// Fund NAVs come from /api/nav (server/navLookup.ts, the full history in Neon);
// the benchmark row from the Market Pulse files' history (6 years). Returns follow
// the engine's rules: NEAREST-PREVIOUS NAV on each date, simple return up to a
// year and CAGR beyond it, unit splits compensated (utils/navMath).

import { useMemo, useState } from 'react'
import { useIndices, useJson, useMeta } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtNum, fmtPct, retColor } from '../utils/format'
import { cagr, closeOnOrBefore, isoMinus, pointReturn, useNavLookup } from '../utils/navMath'
import type { SheetSpec } from '../utils/xlsx'
import type { FundsIndex } from '../types'
import FundLink from '../components/FundLink'

const QUICK: [string, number][] = [['1M', 1], ['3M', 3], ['6M', 6], ['1Y', 12], ['3Y', 36], ['5Y', 60]]

/**
 * Green (best) -> amber -> red (worst) by position in the table, 0 = best.
 * Returns a translucent background and a matching text colour.
 */
function heat(pos: number | null): { bg?: string; fg?: string } {
  if (pos == null) return {}
  const stops = [[52, 211, 153], [245, 158, 11], [248, 113, 113]]   // green, amber, red
  const t = Math.min(Math.max(pos, 0), 1) * 2
  const [a, b] = t <= 1 ? [stops[0], stops[1]] : [stops[1], stops[2]]
  const k = t <= 1 ? t : t - 1
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k))
  return { bg: `rgba(${c[0]},${c[1]},${c[2]},0.20)`, fg: `rgb(${c[0]},${c[1]},${c[2]})` }
}

export default function PointToPoint() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const { data: indices } = useIndices()
  const latest = meta?.as_of ?? ''
  const [slug, setSlug] = useState('large-cap')
  const [to, setTo] = useState('')
  const [from, setFrom] = useState('')
  const toDate = to || latest
  const fromDate = from || (latest ? isoMinus(latest, 12) : '')
  const valid = !!fromDate && !!toDate && fromDate < toDate

  const cats = meta?.categories ?? []
  const cat = cats.find(c => c.slug === slug)
  const funds = useMemo(() => (index?.funds ?? []).filter(f => f.s === slug), [index, slug])
  const codes = useMemo(() => funds.map(f => f.c), [funds])
  const dates = useMemo(() => (valid ? [fromDate, toDate] : []), [valid, fromDate, toDate])
  const { data: navs, loading, error } = useNavLookup(valid ? codes : [], dates)

  const rows = useMemo(() => {
    if (!navs || !valid) return []
    return funds.map(f => {
      const n = navs[f.c]
      const a = n?.at[fromDate] ?? null
      const b = n?.at[toDate] ?? null
      const ret = n ? pointReturn(n, a, b) : null
      return { code: f.c, name: f.n, a, b, ret, ann: cagr(ret, fromDate, toDate),
               launched: n?.first_date ?? null }
    }).sort((x, y) => (y.ret ?? -Infinity) - (x.ret ?? -Infinity))
  }, [navs, funds, fromDate, toDate, valid])
  const ranked = rows.filter(r => r.ret != null)
  // Position of row i among the ranked funds, 0 (best) .. 1 (worst), for heat().
  const pos = (i: number, ret: number | null) =>
    ret == null ? null : ranked.length > 1 ? i / (ranked.length - 1) : 0
  const avg = ranked.length ? ranked.reduce((s, r) => s + r.ret!, 0) / ranked.length : null

  // Category benchmark, when it is one of the Market Pulse indices.
  const benchIdx = indices?.indices.find(i => i.index_id === cat?.benchmark_id)
  const bA = closeOnOrBefore(benchIdx?.history, fromDate)
  const bB = closeOnOrBefore(benchIdx?.history, toDate)
  const benchRet = bA && bB ? bB.nav / bA.nav - 1 : null

  const quick = (months: number) => { setTo(''); setFrom(latest ? isoMinus(latest, months) : '') }

  const buildExport = (): SheetSpec | null => {
    if (!rows.length) return null
    const desk = currentDesk()
    return {
      sheet: 'Point to Point', title: `Point to Point - ${cat?.category_name ?? slug}`,
      meta: [['Desk', desk.name], ['From', fromDate], ['To', toDate],
             ['Returns', 'Up to 1 year: simple; longer: also annualised (CAGR). NAV on or before each date.']],
      columns: [
        { key: 'rank', label: 'Rank', type: 'int', width: 6 },
        { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
        { key: 'navA', label: `NAV ${fromDate}`, type: 'number' },
        { key: 'navB', label: `NAV ${toDate}`, type: 'number' },
        { key: 'ret', label: 'Return', type: 'percent' },
        { key: 'ann', label: 'CAGR', type: 'percent' },
      ],
      rows: rows.map((r, i) => ({ rank: r.ret != null ? i + 1 : null, fund: r.name, navA: r.a?.nav ?? null,
                                  navB: r.b?.nav ?? null, ret: r.ret, ann: r.ann })),
      fileName: `${desk.code} Point to Point - ${cat?.category_name ?? slug} - ${fromDate} to ${toDate}`,
    }
  }

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }
  const byClass = ['Equity', 'Hybrid', 'Debt', 'Other'].map(ac => ({ ac, list: cats.filter(c => c.asset_class === ac) }))

  return (
    <section id="point-to-point" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Point to Point</span>
        <span className="ml-auto"><DownloadButton build={buildExport} disabledHint="Pick a category and dates" /></span>
      </div>

      {/* ── Dates ───────────────────────────────────────────────── */}
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3 text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1">From
          <input type="date" value={fromDate} max={toDate || latest} onChange={e => setFrom(e.target.value)}
                 className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">To
          <input type="date" value={toDate} max={latest} onChange={e => setTo(e.target.value)}
                 className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </label>
        <div className="tab-bar flex gap-1">
          {QUICK.map(([l, m]) => (
            <button key={l} onClick={() => quick(m)}
                    className={`tab-btn${!to && from === (latest ? isoMinus(latest, m) : '') ? ' active accent' : ''}`}>{l}</button>
          ))}
        </div>
        <span className="ml-auto" style={{ color: 'var(--text-low)' }}>
          Uses the NAV / close on or before each date · latest data {fmtDate(latest)}
        </span>
        {!valid && fromDate && toDate && <span style={{ color: 'var(--loss)' }}>“From” must be before “To”.</span>}
      </div>

      {/* ── Funds ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Funds</div>
        <select value={slug} onChange={e => setSlug(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm"
                style={{ ...inputStyle, borderColor: categoryColor(slug, cat?.asset_class) }}>
          {byClass.map(({ ac, list }) => list.length > 0 && (
            <optgroup key={ac} label={ac}>
              {list.map(c => <option key={c.slug} value={c.slug}>{c.category_name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-low)' }}>
          {ranked.length} of {funds.length} funds have NAVs on both dates
        </span>
      </div>
      <div className="card overflow-hidden mb-4">
        {loading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
        ) : error ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-mid)' }}>Could not load NAVs ({error}).</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 50, textAlign: 'center' }}>Rank</th>
                  <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                  <th style={{ textAlign: 'right' }}>NAV · {fmtDate(fromDate)}</th>
                  <th style={{ textAlign: 'right' }}>NAV · {fmtDate(toDate)}</th>
                  <th style={{ textAlign: 'right' }}>Return</th>
                  <th style={{ textAlign: 'right' }} title="Annualised, shown when the period is over a year">CAGR</th>
                </tr>
              </thead>
              <tbody className="rows-enter">
                {rows.map((r, i) => (
                  <tr key={r.code}>
                    <td className="text-center text-xs font-bold" style={{ color: heat(pos(i, r.ret)).fg ?? 'var(--text-low)' }}>{r.ret != null ? i + 1 : '—'}</td>
                    <td className="sticky-col text-xs font-medium truncate" style={{ maxWidth: 300 }} ><FundLink code={r.code} name={r.name} /></td>
                    <td className="ret-cell">
                      {r.a ? <>{r.a.nav.toFixed(4)}<div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fmtDate(r.a.date)}</div></>
                           : <span className="text-[11px]" style={{ color: 'var(--text-low)' }}>
                               {r.launched && r.launched > fromDate ? `launched ${fmtDate(r.launched)}` : 'n/a'}</span>}
                    </td>
                    <td className="ret-cell">
                      {r.b ? <>{r.b.nav.toFixed(4)}<div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fmtDate(r.b.date)}</div></> : '—'}
                    </td>
                    <td className="ret-cell font-bold"
                        style={{ background: heat(pos(i, r.ret)).bg, color: heat(pos(i, r.ret)).fg }}>{fmtPct(r.ret)}</td>
                    <td className="ret-cell font-semibold"
                        style={{ background: r.ann == null ? undefined : heat(pos(i, r.ret)).bg,
                                 color: r.ann == null ? 'var(--text-low)' : heat(pos(i, r.ret)).fg }}>
                      {r.ann == null ? '—' : fmtPct(r.ann)}
                    </td>
                  </tr>
                ))}
                {avg != null && (
                  <tr className="benchmark-row">
                    <td />
                    <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--text-mid)' }}>Category average</td>
                    <td /><td />
                    <td className={`ret-cell font-semibold ${retColor(avg)}`}>{fmtPct(avg)}</td>
                    <td className={`ret-cell ${retColor(cagr(avg, fromDate, toDate))}`}>{fmtPct(cagr(avg, fromDate, toDate))}</td>
                  </tr>
                )}
                {benchIdx && (
                  <tr className="benchmark-row">
                    <td />
                    <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--accent-a)' }}>Benchmark · {benchIdx.index_name}</td>
                    <td className="ret-cell">{bA ? fmtNum(bA.nav, 2) : '—'}</td>
                    <td className="ret-cell">{bB ? fmtNum(bB.nav, 2) : '—'}</td>
                    <td className={`ret-cell font-semibold ${retColor(benchRet)}`}>{fmtPct(benchRet)}</td>
                    <td className={`ret-cell ${retColor(cagr(benchRet, fromDate, toDate))}`}>{fmtPct(cagr(benchRet, fromDate, toDate))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
        Return = NAV on the “To” date ÷ NAV on the “From” date − 1, using the last NAV on or before each date and
        adjusted for unit splits. CAGR is shown when the period is longer than a year. The benchmark row appears when
        the category’s benchmark is a Market Pulse index (six years of history).
      </p>
    </section>
  )
}

// src/sections/PortfolioComparison.tsx — a client review: the client's EXISTING
// mutual funds against the PROPOSED portfolio after our changes.
//
// No dates: each side is a list of funds with today's amount. The page shows how
// the changes move the allocation — market cap (SEBI Large/Mid/Small), asset
// class, category, sectors and top holdings (through each fund's latest
// portfolio) — and the funds' trailing returns and ratios, weighted by amount,
// beside a chosen benchmark. Saved in this browser.

import { useEffect, useMemo, useState } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import FundPicker from '../components/FundPicker'
import FundLink from '../components/FundLink'
import { capSplit, useStockCaps, CAP_COLOURS } from '../components/CapSplit'
import { useLookThrough, type LookRow } from '../components/LookThrough'
import { BenchmarkPicker, useBenchmarkChoice, useFundRisk } from './PortfolioBuilder'
import { indexTrailing, useIndexSeries } from '../utils/benchmark'
import { categoryColor } from '../config/categoryColors'
import { fmtPct, retColor } from '../utils/format'
import type { FundsIndex, RiskFundRow } from '../types'

interface Line { code: string; amount: number | null }
interface Review { existing: Line[]; proposed: Line[] }
const STORE = 'pc_review_v1'
const SIDES = [
  { key: 'existing' as const, label: 'Existing portfolio', colour: '#94A3B8' },
  { key: 'proposed' as const, label: 'Proposed portfolio', colour: '#22D3EE' },
]
const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

function load(): Review {
  try { const r = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (r?.existing) return r } catch { /* none */ }
  return { existing: [], proposed: [] }
}

/** A change in percentage points, coloured only when told which way is good. */
function Delta({ v, good }: { v: number; good?: 'up' | 'down' }) {
  if (Math.abs(v) < 0.0005) return <span style={{ color: 'var(--text-low)' }}>—</span>
  const up = v > 0
  const colour = !good ? 'var(--text-mid)' : (up === (good === 'up')) ? '#34D399' : '#F87171'
  return <span style={{ color: colour, fontWeight: 600 }}>{up ? '▲' : '▼'} {(Math.abs(v) * 100).toFixed(1)} pts</span>
}

export default function PortfolioComparison() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [rv, setRv] = useState<Review>(load)
  const [pick, setPick] = useState({ existing: '', proposed: '' })
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(rv)) } catch { /* optional */ } }, [rv])

  const name = (c: string) => fundByCode.get(c)?.n ?? c
  const withValue = (side: keyof Review) => rv[side].filter(l => (l.amount ?? 0) > 0).map(l => ({ code: l.code, name: name(l.code), value: l.amount! }))
  const ltE = useLookThrough(withValue('existing'))
  const ltP = useLookThrough(withValue('proposed'))
  const risk = useFundRisk([...new Set([...rv.existing, ...rv.proposed].map(l => l.code))], fundByCode)
  const caps = useStockCaps()
  const [benchId, setBenchId] = useBenchmarkChoice()
  const bench = indexTrailing(useIndexSeries(benchId))
  const benchName = meta?.benchmarks.find(b => b.index_id === benchId)?.index_name ?? 'Index'

  const setLines = (side: keyof Review, lines: Line[]) => setRv(r => ({ ...r, [side]: lines }))
  const total = (side: keyof Review) => rv[side].reduce((s, l) => s + (l.amount ?? 0), 0)
  // Either side on its own is enough: the other shows "—" and there is no change column value.
  const hasE = total('existing') > 0, hasP = total('proposed') > 0
  const ready = hasE || hasP
  const both = hasE && hasP
  const show = (has: boolean, v: string) => (has ? v : '—')

  // ── allocations ──
  const assetSplit = (rows: LookRow[]) => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = r.asset_class === 'Equity' ? 'Equity' : /debt|bond|g-?sec|t-?bill|commercial|certificate|ncd|sdl/i.test(r.asset_class) ? 'Debt'
        : /cash|treps|repo|receivable|money/i.test(r.asset_class) ? 'Cash & others' : (r.asset_class || 'Others')
      m.set(k, (m.get(k) ?? 0) + r.weight)
    }
    return m
  }
  const sectorSplit = (rows: LookRow[]) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.asset_class === 'Equity') m.set(r.sector || r.industry || 'Other', (m.get(r.sector || r.industry || 'Other') ?? 0) + r.weight)
    return m
  }
  const categorySplit = (side: keyof Review) => {
    const m = new Map<string, number>(), t = total(side) || 1
    for (const l of rv[side]) if (l.amount) m.set(fundByCode.get(l.code)?.k ?? 'Other', (m.get(fundByCode.get(l.code)?.k ?? 'Other') ?? 0) + l.amount / t)
    return m
  }
  const weighted = (side: keyof Review, get: (r: RiskFundRow) => number | null) => {
    let s = 0, w = 0
    for (const l of rv[side]) {
      const row = risk[l.code], v = row ? get(row) : null
      if (v == null || !l.amount) continue
      s += v * l.amount; w += l.amount
    }
    return w ? s / w : null
  }

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

  return (
    <section id="portfolio-comparison" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Portfolio Comparison</span>
        <span className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-mid)' }}>
          Benchmark <BenchmarkPicker id={benchId} onChange={setBenchId} />
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-mid)' }}>
        Enter the client&apos;s existing funds with today&apos;s value, then the proposed portfolio (start from
        <b> Copy existing → proposed</b> and change it). Everything below shows what the changes do to the allocation.
      </p>

      {/* ── inputs ── */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {SIDES.map(sd => (
          <div key={sd.key} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-display font-bold text-sm" style={{ color: sd.colour }}>{sd.label}</div>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(total(sd.key))}</b></span>
                {sd.key === 'proposed' && (
                  <button className="tab-btn" onClick={() => setLines('proposed', rv.existing.map(l => ({ ...l })))}
                          title="Start the proposal from the client's existing funds">Copy existing → proposed</button>
                )}
                {rv[sd.key].length > 0 && (
                  <button className="tab-btn" onClick={() => { if (window.confirm(`Clear the ${sd.label.toLowerCase()}?`)) setLines(sd.key, []) }}>Clear</button>
                )}
              </div>
            </div>
            <table className="data-table">
              <tbody>
                {rv[sd.key].map((l, i) => {
                  const f = fundByCode.get(l.code)
                  const t = total(sd.key)
                  return (
                    <tr key={l.code}>
                      <td style={{ maxWidth: 280 }}>
                        <div className="text-xs font-medium truncate"><FundLink code={l.code} name={name(l.code)} /></div>
                        <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                      </td>
                      <td style={{ width: 130 }}>
                        <input type="number" min={0} step={10000} value={l.amount ?? ''} placeholder="₹ amount"
                               onChange={e => setLines(sd.key, rv[sd.key].map((x, j) => j === i ? { ...x, amount: e.target.value === '' ? null : Math.max(0, +e.target.value) } : x))}
                               className="px-2 py-1 rounded text-xs w-full text-right" style={inputStyle} />
                      </td>
                      <td className="ret-cell text-[11px]" style={{ width: 50, color: 'var(--text-low)' }}>{t && l.amount ? pct1(l.amount / t) : ''}</td>
                      <td style={{ width: 24 }}>
                        <button onClick={() => setLines(sd.key, rv[sd.key].filter((_, j) => j !== i))} title="Remove"
                                style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="mt-2">
              <FundPicker funds={index?.funds ?? []} value={pick[sd.key]} onChange={v => setPick(p => ({ ...p, [sd.key]: v }))}
                          exclude={rv[sd.key].map(l => l.code)}
                          onPick={f => { setLines(sd.key, [...rv[sd.key], { code: f.c, amount: null }]); setPick(p => ({ ...p, [sd.key]: '' })) }}
                          placeholder="Add a fund — type any part of its name…" style={inputStyle} />
            </div>
          </div>
        ))}
      </div>

      {!ready ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Add funds with amounts on either side (or both) to see the analysis.
        </div>
      ) : (
        <>
          {/* ── summary ── */}
          <CompareTable title="Summary" rows={[
            ['Amount', show(hasE, inr(total('existing'))), show(hasP, inr(total('proposed'))), null],
            ['Number of funds', show(hasE, String(rv.existing.length)), show(hasP, String(rv.proposed.length)), null],
            ['Number of stocks (through the funds)', show(hasE, String(ltE.rows.filter(r => r.asset_class === 'Equity').length)),
             show(hasP, String(ltP.rows.filter(r => r.asset_class === 'Equity').length)), null],
            ['Top 10 stocks, share of portfolio', show(hasE, pct1(ltE.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0))),
             show(hasP, pct1(ltP.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0))),
             both ? <Delta v={ltP.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0) - ltE.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0)} /> : null],
          ]} />

          <div className="grid gap-4 lg:grid-cols-2">
            {/* market cap + asset class */}
            <ChangeTable has={[hasE, hasP]} title="Market cap & asset class" note="% of the whole portfolio · SEBI Large/Mid/Small (AMFI list)"
              rows={(() => {
                const ce = capSplit(ltE.rows, caps), cp = capSplit(ltP.rows, caps)
                const ae = assetSplit(ltE.rows), ap = assetSplit(ltP.rows)
                const out: [string, number, number, string?][] = [
                  ['Large Cap', ce.L, cp.L, CAP_COLOURS.L], ['Mid Cap', ce.M, cp.M, CAP_COLOURS.M], ['Small Cap', ce.S, cp.S, CAP_COLOURS.S],
                  ['Other equity (foreign / unlisted)', ce.O, cp.O, CAP_COLOURS.O],
                ]
                for (const k of [...new Set([...ae.keys(), ...ap.keys()])].filter(k => k !== 'Equity'))
                  out.push([k, ae.get(k) ?? 0, ap.get(k) ?? 0])
                return out
              })()} />
            {/* category */}
            <ChangeTable has={[hasE, hasP]} title="Category allocation" note="% of the amount in each fund category"
              rows={(() => {
                const e = categorySplit('existing'), p = categorySplit('proposed')
                return [...new Set([...e.keys(), ...p.keys()])].map(k => [k, e.get(k) ?? 0, p.get(k) ?? 0] as [string, number, number])
                  .sort((a, b) => Math.max(b[1], b[2]) - Math.max(a[1], a[2]))
              })()} />
          </div>

          <ChangeTable has={[hasE, hasP]} title="Sector allocation" note="Equity holdings through the funds, % of the whole portfolio"
            rows={(() => {
              const e = sectorSplit(ltE.rows), p = sectorSplit(ltP.rows)
              return [...new Set([...e.keys(), ...p.keys()])].map(k => [k, e.get(k) ?? 0, p.get(k) ?? 0] as [string, number, number])
                .sort((a, b) => Math.max(b[1], b[2]) - Math.max(a[1], a[2])).slice(0, 15)
            })()} />

          {/* returns & ratios */}
          <div className="card overflow-hidden mb-4">
            <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Returns &amp; ratios (weighted by amount)</div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col text-left" style={{ minWidth: 180 }}>Measure</th>
                    <th style={{ textAlign: 'right', color: SIDES[0].colour }}>Existing</th>
                    <th style={{ textAlign: 'right', color: SIDES[1].colour }}>Proposed</th>
                    <th style={{ textAlign: 'right' }}>Change</th>
                    <th style={{ textAlign: 'right', color: 'var(--accent-a)' }}>{benchName}</th>
                  </tr>
                </thead>
                <tbody>
                  {([['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '12M'], ['3Y', '3Y'], ['5Y', '5Y']] as const).map(([l, k]) => {
                    const e = weighted('existing', r => r.returns?.[k] ?? null), p = weighted('proposed', r => r.returns?.[k] ?? null)
                    return (
                      <tr key={l}>
                        <td className="sticky-col text-xs">{l} return{['3Y', '5Y'].includes(l) ? ' (p.a.)' : ''}</td>
                        <td className={`ret-cell text-xs ${retColor(e)}`}>{fmtPct(e)}</td>
                        <td className={`ret-cell text-xs ${retColor(p)}`}>{fmtPct(p)}</td>
                        <td className="ret-cell text-xs">{e != null && p != null ? <Delta v={p - e} good="up" /> : '—'}</td>
                        <td className={`ret-cell text-xs ${retColor(bench[l] ?? null)}`}>{fmtPct(bench[l] ?? null)}</td>
                      </tr>
                    )
                  })}
                  {([['Sharpe (3Y)', (r: RiskFundRow) => r.sharpe, (v: number) => v.toFixed(2), 'up'],
                     ['Std Dev (3Y)', (r: RiskFundRow) => r.std_annual, pct1, 'down'],
                     ['Alpha (3Y)', (r: RiskFundRow) => (r.alpha == null ? null : r.alpha * 100), (v: number) => v.toFixed(2), 'up'],
                     ['Beta (3Y)', (r: RiskFundRow) => r.beta, (v: number) => v.toFixed(2), undefined],
                     ['Max drawdown', (r: RiskFundRow) => r.max_drawdown, pct1, 'up']] as const).map(([l, get, f, good]) => {
                    const e = weighted('existing', get), p = weighted('proposed', get)
                    return (
                      <tr key={l}>
                        <td className="sticky-col text-xs">{l}</td>
                        <td className="ret-cell text-xs">{e == null ? '—' : f(e)}</td>
                        <td className="ret-cell text-xs">{p == null ? '—' : f(p)}</td>
                        <td className="ret-cell text-xs" style={{ color: 'var(--text-mid)' }}>
                          {e != null && p != null ? (good ? ((p - e) >= 0) === (good === 'up') ? <span style={{ color: '#34D399' }}>{p > e ? '▲' : '▼'} {Math.abs(p - e).toFixed(2)}</span>
                            : <span style={{ color: '#F87171' }}>{p > e ? '▲' : '▼'} {Math.abs(p - e).toFixed(2)}</span> : `${p > e ? '▲' : '▼'} ${Math.abs(p - e).toFixed(2)}`) : '—'}
                        </td>
                        <td className="ret-cell text-xs">—</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* top holdings */}
          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            {([['existing', ltE], ['proposed', ltP]] as const).filter(([k]) => (k === 'existing' ? hasE : hasP)).map(([k, lt]) => {
              const sd = SIDES.find(x => x.key === k)!
              return (
                <div key={k} className="card p-4">
                  <div className="font-display font-bold text-sm mb-2" style={{ color: sd.colour }}>{sd.label} — top 10 holdings</div>
                  <table className="data-table">
                    <tbody>
                      {lt.rows.slice(0, 10).map(r => (
                        <tr key={r.isin}>
                          <td className="text-xs truncate" style={{ maxWidth: 260 }} title={r.name}>{r.name}</td>
                          <td className="text-[10px] truncate" style={{ color: 'var(--text-low)', maxWidth: 130 }}>{r.industry}</td>
                          <td className="ret-cell text-xs font-semibold">{(r.weight * 100).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>

          {/* fund level */}
          <div className="grid gap-4 lg:grid-cols-2 mb-4">
            {SIDES.filter(sd => (sd.key === 'existing' ? hasE : hasP)).map(sd => (
              <div key={sd.key} className="card overflow-hidden">
                <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: sd.colour }}>{sd.label} — funds</div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr>
                      <th className="text-left">Fund</th><th style={{ textAlign: 'right' }}>Weight</th>
                      <th style={{ textAlign: 'right' }}>1Y</th><th style={{ textAlign: 'right' }}>3Y</th><th style={{ textAlign: 'right' }}>5Y</th>
                      <th style={{ textAlign: 'right' }}>Sharpe</th>
                    </tr></thead>
                    <tbody>
                      {rv[sd.key].map(l => {
                        const r = risk[l.code], t = total(sd.key)
                        return (
                          <tr key={l.code}>
                            <td className="text-xs truncate" style={{ maxWidth: 240 }}><FundLink code={l.code} name={name(l.code)} /></td>
                            <td className="ret-cell text-xs">{t && l.amount ? pct1(l.amount / t) : '—'}</td>
                            {(['12M', '3Y', '5Y'] as const).map(k => <td key={k} className={`ret-cell text-xs ${retColor(r?.returns?.[k] ?? null)}`}>{fmtPct(r?.returns?.[k] ?? null)}</td>)}
                            <td className="ret-cell text-xs">{r?.sharpe == null ? '—' : r.sharpe.toFixed(2)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
            Allocations look through each fund to its latest monthly portfolio, weighted by the amount in that fund. Market cap uses
            SEBI&apos;s classification (AMFI{caps ? `, ${caps.period}` : ''}). Returns and ratios are each fund&apos;s own (Risk &amp; Returns
            tab), averaged by amount; 3Y and 5Y are annualised. Balanced Advantage and Multi Asset funds have no holdings loaded, so they
            count in returns but not in the market-cap and sector split.
            {ltE.missing.length + ltP.missing.length > 0 && <> No holdings for: {[...new Set([...ltE.missing, ...ltP.missing])].join(', ')}.</>}
          </p>
        </>
      )}
    </section>
  )
}

function CompareTable({ title, rows }: { title: string; rows: [string, string, string, React.ReactNode | null][] }) {
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{title}</div>
      <table className="data-table">
        <thead><tr>
          <th className="text-left">Measure</th>
          <th style={{ textAlign: 'right', color: SIDES[0].colour }}>Existing</th>
          <th style={{ textAlign: 'right', color: SIDES[1].colour }}>Proposed</th>
          <th style={{ textAlign: 'right' }}>Change</th>
        </tr></thead>
        <tbody>
          {rows.map(([l, a, b, d]) => (
            <tr key={l}><td className="text-xs">{l}</td><td className="ret-cell text-xs font-semibold">{a}</td>
              <td className="ret-cell text-xs font-semibold">{b}</td><td className="ret-cell text-xs">{d ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Before / after / change for each row, with bars so the shift is visible at a glance. */
function ChangeTable({ title, note, rows, has }: { title: string; note: string; rows: [string, number, number, string?][]; has: [boolean, boolean] }) {
  const max = Math.max(0.0001, ...rows.flatMap(r => [r[1], r[2]]))
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{title}</div>
      <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>{note}</div>
      <table className="data-table">
        <thead><tr>
          <th className="text-left">&nbsp;</th>
          <th style={{ textAlign: 'right', color: SIDES[0].colour }}>Existing</th>
          <th style={{ textAlign: 'right', color: SIDES[1].colour }}>Proposed</th>
          <th style={{ textAlign: 'right' }}>Change</th>
        </tr></thead>
        <tbody>
          {rows.filter(r => r[1] > 0.0005 || r[2] > 0.0005).map(([l, a, b, c]) => (
            <tr key={l}>
              <td className="text-xs" style={{ minWidth: 170 }}>
                {c && <span style={{ color: c }}>● </span>}{l}
                <div className="flex flex-col gap-0.5 mt-1">
                  <div className="h-1.5 rounded" style={{ width: `${(a / max) * 100}%`, background: SIDES[0].colour }} />
                  <div className="h-1.5 rounded" style={{ width: `${(b / max) * 100}%`, background: SIDES[1].colour }} />
                </div>
              </td>
              <td className="ret-cell text-xs">{has[0] ? pct1(a) : '—'}</td>
              <td className="ret-cell text-xs font-semibold">{has[1] ? pct1(b) : '—'}</td>
              <td className="ret-cell text-xs">{has[0] && has[1] ? <Delta v={b - a} /> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

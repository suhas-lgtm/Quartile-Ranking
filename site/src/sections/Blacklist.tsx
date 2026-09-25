// src/sections/Blacklist.tsx — funds to avoid.
//
// Two sections from blacklist.json (build_json.build_blacklist):
//   Flagged by the team   the manual list in data/blacklist.json, with reasons
//   Automatic flags       every fund failing one or more of the team's NAV-based
//                         blacklist rules, each failure spelled out
// Open to everyone. Nothing is calculated here.

import { useState } from 'react'
import { useJson } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import type { SheetSpec } from '../utils/xlsx'
import type { BlacklistData, BlacklistReason, ListedFund } from '../types'

const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

/** The automatic rules, in the order the team listed them, with what each means. */
const RULES: { id: BlacklistReason['rule']; label: string; help: string }[] = [
  { id: 'bottom_quartile', label: 'Persistent laggard',
    help: 'Bottom quartile of its category on 3-month AND 1-year AND 3-year returns at the same time — not a temporary dip.' },
  { id: 'negative_alpha', label: 'Negative alpha',
    help: 'Negative alpha over both 3 and 5 years against the category benchmark — failing the core job.' },
  { id: 'rolling_consistency', label: 'Inconsistent',
    help: 'Beat its benchmark in under 40% of rolling 1-year periods over its history. Point-to-point can flatter a fund; rolling exposes it.' },
  { id: 'downside_capture', label: 'Falls more than index',
    help: 'Downside capture above 100 (3Y) — falls more than the benchmark in down months. For Small and Mid Cap, 1Y is checked too.' },
  { id: 'tracking_error', label: 'Active risk, no reward',
    help: 'Large Cap: tracking error in the top quarter of the category together with negative 3Y alpha — taking active risk and losing.' },
  { id: 'short_track_record', label: 'Short track record',
    help: 'Under 3 years of history in a category with established alternatives (not applied to Multi Cap).' },
  { id: 'bottom_3m', label: 'Bottom of pack (3M)',
    help: 'Multi Cap: bottom quartile on 3-month return.' },
  { id: 'high_beta', label: 'High beta (value)',
    help: 'Value / Contra and Dividend Yield: 3Y beta above 1.0 — a value fund that behaves like a momentum fund.' },
]
const ruleLabel = (id: string) => RULES.find(r => r.id === id)?.label ?? id

export default function Blacklist() {
  const { data, loading, error } = useJson<BlacklistData>('blacklist.json')
  const [mode, setMode] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly')
  const manual = data?.manual ?? []
  const flagged = data?.flagged ?? []
  const [catFilter, setCatFilter] = useState('')
  const [ruleFilter, setRuleFilter] = useState('')
  const cats = [...new Map(flagged.map(f => [f.category_slug, f.category_name])).entries()]
  const shown = flagged.filter(f =>
    (!catFilter || f.category_slug === catFilter) &&
    (!ruleFilter || f.reasons.some(r => r.rule === ruleFilter)))
  const ruleCount = (id: string) => flagged.filter(f => f.reasons.some(r => r.rule === id)).length

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const f of manual) {
      rows.push({ section: 'Flagged by the team', category: f.category_name ?? '', fund: f.scheme_name,
                  reason: f.note, rank: null, score: null, r3y: f.returns?.['3Y'] ?? null })
    }
    for (const f of shown) {
      rows.push({ section: 'Automatic flags', category: f.category_name, fund: f.scheme_name,
                  reason: f.reasons.map(r => r.text).join('; '), rank: f.reasons.length,
                  score: null, r3y: f.return_3y })
    }
    return {
      sheet: 'Blacklist', title: 'Blacklist',
      meta: [['Desk', desk.name], ['Data as of', data.as_of],
             ['Automatic flags', 'NAV-based blacklist rules; the count column is how many rules a fund failed']],
      columns: [
        { key: 'section', label: 'Section', type: 'text', width: 24 },
        { key: 'category', label: 'Category', type: 'text', width: 24 },
        { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
        { key: 'reason', label: 'Reason', type: 'text', width: 34 },
        { key: 'rank', label: 'Flags', type: 'int', width: 8 },
        { key: 'r3y', label: '3Y CAGR', type: 'percent' },
      ],
      rows,
      fileName: `${desk.code} Blacklist - ${data.as_of}`,
    }
  }

  return (
    <section id="blacklist" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Blacklist</span>
        <span className="ml-auto"><DownloadButton build={buildExport} /></span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-mid)' }}>
        Funds to avoid: those the team has flagged by hand, and every fund that fails one or more of the team’s
        blacklist rules. {data &&<>Data as of <b style={{ color: 'var(--text-hi)' }}>{fmtDate(data.as_of)}</b>.</>}
      </p>

      {loading ? (
        <div className="card p-6 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
      ) : error || !data ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          The blacklist has not been published yet. It appears after the next data refresh.
        </div>
      ) : (
        <>
          {/* ── Manual ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
              ⛔ Flagged by the team <span style={{ color: 'var(--text-low)', fontWeight: 400 }}>({manual.length})</span>
            </div>
            <div className="tab-bar flex items-center gap-2">
              <button onClick={() => setMode('monthly')}   className={`tab-btn${mode === 'monthly'   ? ' active accent' : ''}`}>Monthly</button>
              <button onClick={() => setMode('quarterly')} className={`tab-btn${mode === 'quarterly' ? ' active accent' : ''}`}>Quarterly</button>
              <button onClick={() => setMode('annual')}    className={`tab-btn${mode === 'annual'    ? ' active accent' : ''}`}>Annual</button>
            </div>
          </div>
          {data.missing.length > 0 && (
            <div className="card p-3 mb-2 text-xs" style={{ borderColor: 'rgba(245,158,11,0.5)', color: 'var(--text-mid)' }}>
              ⚠️ Not in the fund catalogue, so not shown: {data.missing.join(', ')}
            </div>
          )}
          <div className="card overflow-hidden mb-6">
            {manual.length === 0 ? (
              <div className="p-6 text-center text-xs" style={{ color: 'var(--text-mid)' }}>
                No funds flagged yet. Once the team’s list is added, each fund appears here with its reason,
                recent quartiles, returns and ratios.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                      <th className="text-left" style={{ minWidth: 200 }}>Reason</th>
                      <th style={{ textAlign: 'right' }}>NAV</th>
                      <th style={{ textAlign: 'center', minWidth: 180 }}>Quartile · oldest → latest</th>
                      <th style={{ textAlign: 'right' }}>1Y</th>
                      <th style={{ textAlign: 'right' }}>3Y</th>
                      <th style={{ textAlign: 'right' }}>5Y</th>
                      <th style={{ textAlign: 'right' }}>Alpha (3Y)</th>
                      <th style={{ textAlign: 'right' }}>Beta (3Y)</th>
                      <th style={{ textAlign: 'right' }}>Sharpe (3Y)</th>
                    </tr>
                  </thead>
                  <tbody className="rows-enter">
                    {manual.map((f: ListedFund) => {
                      const q = f.quartiles[mode]
                      const colour = f.category_slug ? categoryColor(f.category_slug, f.asset_class ?? undefined) : 'var(--text-low)'
                      return (
                        <tr key={f.scheme_code}>
                          <td className="sticky-col" style={{ maxWidth: 300 }}>
                            <div className="text-xs font-medium truncate" title={f.scheme_name}>{f.scheme_name}</div>
                            <div className="text-[10px] truncate" style={{ color: colour }}>{f.category_name ?? 'Uncategorised'}</div>
                          </td>
                          <td className="text-xs" style={{ whiteSpace: 'normal', color: 'var(--text-mid)' }}>{f.note || '—'}</td>
                          <td className="ret-cell">
                            <div>{f.nav == null ? '—' : f.nav.toFixed(2)}</div>
                            <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fmtDate(f.nav_date)}</div>
                          </td>
                          <td>
                            {q ? (
                              <div className="flex items-center justify-center gap-1">
                                {q.quartiles.map((qq, i) => {
                                  const { main, sub } = periodLabelParts(q.labels[i])
                                  return (
                                    <div key={i} className={quartilePillClass(qq)} title={`${main}${sub ? ' ' + sub : ''}: ${qq ? 'Q' + qq : 'not ranked'}`}>
                                      {qq ? `Q${qq}` : '−'}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : <div className="text-center text-[11px]" style={{ color: 'var(--text-low)' }}>not ranked</div>}
                          </td>
                          {(['12M', '3Y', '5Y'] as const).map(p => {
                            const v = f.returns?.[p] ?? null
                            return <td key={p} className={`ret-cell ${retColor(v)}`}>{fmtPct(v)}</td>
                          })}
                          <td className={`ret-cell ${retColor(f.ratios?.alpha ?? null)}`}>
                            {f.ratios?.alpha == null ? '—' : (f.ratios.alpha * 100).toFixed(2)}
                          </td>
                          <td className="ret-cell">{num(f.ratios?.beta)}</td>
                          <td className="ret-cell">{num(f.ratios?.sharpe)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Automatic flags ────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
              🚩 Automatic flags <span style={{ color: 'var(--text-low)', fontWeight: 400 }}>({shown.length}{shown.length !== flagged.length ? ` of ${flagged.length}` : ''})</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
                <option value="">All categories</option>
                {cats.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
              </select>
              <select value={ruleFilter} onChange={e => setRuleFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
                <option value="">All rules</option>
                {RULES.map(r => <option key={r.id} value={r.id}>{r.label} ({ruleCount(r.id)})</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-low)' }}>
            Funds failing one or more of the team’s blacklist rules, most flags first. Recomputed with every data
            refresh. Rules that need portfolio holdings (concentration, overlap, style drift, AUM) are not applied yet.
          </p>
          <div className="card overflow-hidden mb-4">
            {shown.length === 0 ? (
              <div className="p-6 text-center text-xs" style={{ color: 'var(--text-mid)' }}>No funds match these filters.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                      <th className="text-left">Flags</th>
                      <th style={{ textAlign: 'right' }}>1Y</th>
                      <th style={{ textAlign: 'right' }}>3Y</th>
                    </tr>
                  </thead>
                  <tbody className="rows-enter">
                    {shown.map(f => {
                      const colour = categoryColor(f.category_slug, f.asset_class)
                      return (
                        <tr key={f.scheme_code}>
                          <td className="sticky-col" style={{ maxWidth: 300 }}>
                            <div className="text-xs font-medium truncate" title={f.scheme_name}>{f.scheme_name}</div>
                            <div className="text-[10px] truncate" style={{ color: colour }}>{f.category_name}</div>
                          </td>
                          <td style={{ whiteSpace: 'normal' }}>
                            <div className="flex flex-wrap gap-1">
                              {f.reasons.map(r => (
                                <span key={r.rule} title={r.text}
                                      className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--loss)',
                                               border: '1px solid rgba(248,113,113,0.3)' }}>
                                  {ruleLabel(r.rule)}
                                </span>
                              ))}
                            </div>
                            <div className="text-[10px] mt-1" style={{ color: 'var(--text-low)' }}>
                              {f.reasons.map(r => r.text).join(' · ')}
                            </div>
                          </td>
                          <td className={`ret-cell ${retColor(f.return_1y)}`}>{fmtPct(f.return_1y)}</td>
                          <td className={`ret-cell ${retColor(f.return_3y)}`}>{fmtPct(f.return_3y)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
            <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>The rules</div>
            <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
              {RULES.map(r => (
                <div key={r.id}><b style={{ color: 'var(--text-hi)' }}>{r.label}:</b> {r.help}</div>
              ))}
            </div>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-low)' }}>
              Thresholds are kept in <code>data/blacklist.json</code>. Not yet applied (need portfolio holdings or other
              data): concentration, stock count, overlap, style drift, AUM, flows, expense ratio, turnover, manager
              changes and compliance events — the last few are for the team to record as manual entries above.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

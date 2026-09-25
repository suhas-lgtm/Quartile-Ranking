// src/sections/Blacklist.tsx — funds to avoid.
//
// Two sections from blacklist.json (build_json.build_blacklist):
//   Flagged by the team   the manual list in data/blacklist.json, with reasons
//   Weakest on screener   the bottom N ranked funds of every category on the
//                         Whitelist Screener, ranked with its default weights
// Open to everyone. Nothing is calculated here.

import { useState } from 'react'
import { useJson } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import type { SheetSpec } from '../utils/xlsx'
import type { BlacklistData, ListedFund } from '../types'

const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

export default function Blacklist() {
  const { data, loading, error } = useJson<BlacklistData>('blacklist.json')
  const [mode, setMode] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly')
  const manual = data?.manual ?? []
  const auto = data?.auto ?? []

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const f of manual) {
      rows.push({ section: 'Flagged by the team', category: f.category_name ?? '', fund: f.scheme_name,
                  reason: f.note, rank: null, score: null, r3y: f.returns?.['3Y'] ?? null })
    }
    for (const c of auto) {
      for (const f of c.funds) {
        rows.push({ section: 'Weakest on the screener', category: c.category_name, fund: f.scheme_name,
                    reason: `Rank ${f.rank} of ${c.ranked}`, rank: f.rank, score: f.score, r3y: f.return_3y })
      }
    }
    return {
      sheet: 'Blacklist', title: 'Blacklist',
      meta: [['Desk', desk.name], ['Data as of', data.as_of],
             ['Automatic', `Bottom ${data.auto_bottom_n} ranked funds per category, Whitelist Screener default weights`]],
      columns: [
        { key: 'section', label: 'Section', type: 'text', width: 24 },
        { key: 'category', label: 'Category', type: 'text', width: 24 },
        { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
        { key: 'reason', label: 'Reason', type: 'text', width: 34 },
        { key: 'rank', label: 'Rank', type: 'int', width: 8 },
        { key: 'score', label: 'Score', type: 'number' },
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
        Funds to avoid: those the team has flagged, and the weakest-ranked funds in each category on the
        Whitelist Screener. {data && <>Data as of <b style={{ color: 'var(--text-hi)' }}>{fmtDate(data.as_of)}</b>.</>}
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

          {/* ── Automatic ──────────────────────────────────────────── */}
          <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-hi)' }}>
            📉 Weakest on the Whitelist Screener
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-low)' }}>
            The bottom {data.auto_bottom_n} ranked funds in each category, worst first, using the screener’s default
            weights. Updated automatically with every data refresh. Score is 0–100 within the category (higher is better).
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {auto.map(c => {
              const colour = categoryColor(c.category_slug)
              return (
                <div key={c.category_slug} className="card overflow-hidden">
                  <div className="px-4 py-2.5 border-b flex items-center justify-between"
                       style={{ borderColor: 'var(--line)', background: `${colour}10` }}>
                    <span className="text-xs font-semibold" style={{ color: colour }}>{c.category_name}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-low)' }}>{c.ranked} ranked</span>
                  </div>
                  <table className="data-table">
                    <tbody>
                      {c.funds.map(f => (
                        <tr key={f.scheme_code}>
                          <td className="text-xs" style={{ width: 70, color: 'var(--loss)', fontWeight: 600 }}>
                            #{f.rank}<span style={{ color: 'var(--text-low)', fontWeight: 400 }}>/{c.ranked}</span>
                          </td>
                          <td className="text-xs truncate" style={{ maxWidth: 190 }} title={f.scheme_name}>{f.scheme_name}</td>
                          <td className="ret-cell text-xs" title={`Risk ${num(f.risk, 1)} · Performance ${num(f.performance, 1)} · Drawdown ${num(f.drawdown, 1)}`}>
                            {num(f.score, 1)}
                          </td>
                          <td className={`ret-cell text-xs ${retColor(f.return_3y)}`} title="3Y CAGR">{fmtPct(f.return_3y)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

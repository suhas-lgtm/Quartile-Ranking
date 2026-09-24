// src/sections/Whitelist.tsx — the funds on data/whitelist.json, at a glance.
//
// These are the funds the email alerts watch. Each row brings together what the
// other tabs already show for that fund — its recent quartiles, returns and
// ratios — from whitelist.json, which build_json assembles out of the same
// quartile and risk files. Nothing here is recalculated.

import { useState } from 'react'
import { useWhitelist } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import type { SheetSpec } from '../utils/xlsx'
import type { WhitelistFund } from '../types'

type Mode = 'monthly' | 'quarterly' | 'annual'

const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

/** Latest quartile vs the one before it: ▲ improved, ▼ slipped. */
function movement(qs: (number | null)[]): { arrow: string; color: string; title: string } | null {
  const known = qs.filter((q): q is number => q != null)
  if (known.length < 2) return null
  const [prev, last] = known.slice(-2)
  if (last < prev) return { arrow: '▲', color: 'var(--gain)', title: `Improved from Q${prev} to Q${last}` }
  if (last > prev) return { arrow: '▼', color: 'var(--loss)', title: `Slipped from Q${prev} to Q${last}` }
  return { arrow: '●', color: 'var(--text-low)', title: `Held Q${last}` }
}

export default function Whitelist() {
  const { data, loading, error } = useWhitelist()
  const [mode, setMode] = useState<Mode>('quarterly')
  const funds = data?.funds ?? []

  const buildExport = (): SheetSpec | null => {
    if (!data || funds.length === 0) return null
    const desk = currentDesk()
    const labels = funds.find(f => f.quartiles[mode])?.quartiles[mode]?.labels ?? []
    const columns: SheetSpec['columns'] = [
      { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
      { key: 'category', label: 'Category', type: 'text', width: 24 },
      { key: 'nav', label: 'NAV', type: 'number' },
      { key: 'nav_date', label: 'NAV Date', type: 'text', width: 12 },
      ...labels.map((l, i) => ({ key: `q${i}`, label: `${l} Quartile`, type: 'int' as const, width: 12 })),
      { key: 'r1y', label: '1Y Return', type: 'percent' },
      { key: 'r3y', label: '3Y CAGR', type: 'percent' },
      { key: 'r5y', label: '5Y CAGR', type: 'percent' },
      { key: 'alpha', label: 'Alpha (3Y)', type: 'number' },
      { key: 'beta', label: 'Beta (3Y)', type: 'number' },
      { key: 'sharpe', label: 'Sharpe (3Y)', type: 'number' },
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'note', label: 'Note', type: 'text', width: 30 },
    ]
    const rows: SheetSpec['rows'] = funds.map(f => {
      const q = f.quartiles[mode]
      const row: SheetSpec['rows'][number] = {
        fund: f.scheme_name, category: f.category_name ?? '', nav: f.nav, nav_date: f.nav_date ?? '',
        r1y: f.returns?.['12M'] ?? null, r3y: f.returns?.['3Y'] ?? null, r5y: f.returns?.['5Y'] ?? null,
        alpha: f.ratios?.alpha == null ? null : f.ratios.alpha * 100,
        beta: f.ratios?.beta ?? null, sharpe: f.ratios?.sharpe ?? null,
        score: f.ratios?.composite_score ?? null, note: f.note,
      }
      labels.forEach((_l, i) => { row[`q${i}`] = q?.quartiles[i] ?? null })
      return row
    })
    return {
      sheet: 'Whitelist',
      title: 'Whitelist',
      meta: [['Desk', desk.name], ['Data as of', data.as_of], ['Funds', String(funds.length)],
             ['Quartiles', `${mode}, oldest to latest`]],
      columns, rows,
      fileName: `${desk.code} Whitelist - ${data.as_of}`,
    }
  }

  return (
    <section id="whitelist" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Whitelist</span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-mid)' }}>
        The funds tracked for email alerts: latest NAV, recent quartile ranking within their
        category, returns and key ratios. Quartiles and ratios are the same figures shown on
        Quartile Ranking and Risk &amp; Returns.
      </p>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-xs" style={{ color: 'var(--text-low)' }}>
          {data ? `${funds.length} fund${funds.length === 1 ? '' : 's'} · as of ${fmtDate(data.as_of)}` : ''}
        </div>
        <div className="tab-bar flex items-center gap-2">
          <button onClick={() => setMode('monthly')}   className={`tab-btn${mode === 'monthly'   ? ' active accent' : ''}`}>Monthly</button>
          <button onClick={() => setMode('quarterly')} className={`tab-btn${mode === 'quarterly' ? ' active accent' : ''}`}>Quarterly</button>
          <button onClick={() => setMode('annual')}    className={`tab-btn${mode === 'annual'    ? ' active accent' : ''}`}>Annual</button>
          <DownloadButton build={buildExport} disabledHint="No funds on the whitelist yet" />
        </div>
      </div>

      {data && data.missing.length > 0 && (
        <div className="card p-3 mb-3 text-xs" style={{ borderColor: 'rgba(245,158,11,0.5)', color: 'var(--text-mid)' }}>
          ⚠️ {data.missing.length} code{data.missing.length === 1 ? '' : 's'} on the list {data.missing.length === 1 ? 'is' : 'are'} not
          in the fund catalogue and {data.missing.length === 1 ? 'is' : 'are'} not shown: {data.missing.join(', ')}
        </div>
      )}

      <div className="card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
        ) : error ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
            The whitelist has not been published yet. It appears after the next data run.
          </div>
        ) : funds.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-mid)' }}>
            <div className="text-sm mb-1" style={{ color: 'var(--text-hi)' }}>No funds on the whitelist yet.</div>
            <div className="text-xs">Once the fund list is added, each fund appears here with its quartiles, returns and ratios.</div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                  <th style={{ textAlign: 'right' }}>NAV</th>
                  <th style={{ textAlign: 'center', minWidth: 190 }}>
                    {mode === 'monthly' ? 'Monthly' : mode === 'quarterly' ? 'Quarterly' : 'Annual'} quartile · oldest → latest
                  </th>
                  <th style={{ textAlign: 'right' }}>1Y</th>
                  <th style={{ textAlign: 'right' }}>3Y</th>
                  <th style={{ textAlign: 'right' }}>5Y</th>
                  <th style={{ textAlign: 'right' }}>Alpha (3Y)</th>
                  <th style={{ textAlign: 'right' }}>Beta (3Y)</th>
                  <th style={{ textAlign: 'right' }}>Sharpe (3Y)</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                </tr>
              </thead>
              <tbody className="rows-enter">
                {funds.map((f: WhitelistFund) => {
                  const q = f.quartiles[mode]
                  const mv = q ? movement(q.quartiles) : null
                  const colour = f.category_slug ? categoryColor(f.category_slug, f.asset_class ?? undefined) : 'var(--text-low)'
                  return (
                    <tr key={f.scheme_code}>
                      <td className="sticky-col" style={{ maxWidth: 300 }}>
                        <div className="text-xs font-medium truncate" title={f.scheme_name}>{f.scheme_name}</div>
                        <div className="text-[10px] truncate" style={{ color: colour }}>
                          {f.category_name ?? 'Uncategorised'}
                          {f.note && <span style={{ color: 'var(--text-low)' }}> · {f.note}</span>}
                        </div>
                      </td>
                      <td className="ret-cell">
                        <div>{f.nav == null ? '—' : f.nav.toFixed(2)}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>
                          {fmtDate(f.nav_date)}{' '}
                          <span className={retColor(f.change_1d)}>{f.change_1d == null ? '' : fmtPct(f.change_1d)}</span>
                        </div>
                      </td>
                      <td>
                        {q ? (
                          <div className="flex items-center justify-center gap-1">
                            {q.quartiles.map((qq, i) => {
                              const { main, sub } = periodLabelParts(q.labels[i])
                              const ret = q.returns[i]
                              return (
                                <div key={i} className={quartilePillClass(qq)}
                                     title={`${main}${sub ? ' ' + sub : ''}: ${qq ? 'Q' + qq : 'not ranked'}${ret != null ? ` (${fmtPct(ret)})` : ''}`}>
                                  {qq ? `Q${qq}` : '−'}
                                </div>
                              )
                            })}
                            {mv && <span className="text-xs ml-1" style={{ color: mv.color }} title={mv.title}>{mv.arrow}</span>}
                          </div>
                        ) : (
                          <div className="text-center text-[11px]" style={{ color: 'var(--text-low)' }}>not ranked</div>
                        )}
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
                      <td className="ret-cell">{num(f.ratios?.composite_score, 1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
        <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-hi)' }}>✉️ Email alerts</div>
        Alert conditions for these funds are not set up yet. Once they are, each nightly data run
        will check every fund on this list and send an email through Brevo when a condition is met.
      </div>
    </section>
  )
}

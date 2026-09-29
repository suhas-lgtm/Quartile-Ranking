// src/sections/PortfolioComparison.tsx — a client review: the client's EXISTING
// mutual funds against the SUGGESTED portfolio after our changes.
//
// No dates: each side is a list of funds with today's amount. The suggestion
// starts as a duplicate of the existing funds and every change stays visible
// (removed, added, increased, reduced). The analysis below (PortfolioReview)
// shows what the changes do: market cap, asset class, category, sectors with
// their industries, holdings and stock-level changes, returns, SIP returns and
// ratios against a chosen benchmark, correlation and overlap. Saved in this
// browser.

import { useEffect, useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import FundPicker from '../components/FundPicker'
import FundLink from '../components/FundLink'
import PortfolioReview, { inr, pct1 } from '../components/PortfolioReview'
import SuggestedEditor from '../components/SuggestedEditor'
import { categoryColor } from '../config/categoryColors'
import type { FundsIndex } from '../types'

interface Line { code: string; amount: number | null }
interface Review { existing: Line[]; proposed: Line[] }
const STORE = 'pc_review_v1'
const EX_COLOUR = '#94A3B8', SG_COLOUR = '#22D3EE'

function load(): Review {
  try { const r = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (r?.existing) return r } catch { /* none */ }
  return { existing: [], proposed: [] }
}

export default function PortfolioComparison() {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [rv, setRv] = useState<Review>(load)
  const [pick, setPick] = useState('')
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(rv)) } catch { /* optional */ } }, [rv])

  const name = (c: string) => fundByCode.get(c)?.n ?? c
  const exTotal = rv.existing.reduce((s, l) => s + (l.amount ?? 0), 0)
  const setExisting = (existing: Line[]) => setRv(r => ({ ...r, existing }))
  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

  return (
    <section id="portfolio-comparison" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header"><span>Portfolio Comparison</span></div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-mid)' }}>
        Enter the client&apos;s existing funds with today&apos;s value, then <b>⧉ Duplicate existing</b> into the suggested portfolio
        and remove, add or change funds. Every change stays listed, and the analysis below shows what it does to the portfolio.
      </p>

      <div className="grid gap-4 xl:grid-cols-2 mb-4">
        {/* ── existing ── */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: EX_COLOUR }}>Existing portfolio</div>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(exTotal)}</b></span>
              {rv.existing.length > 0 && (
                <button className="tab-btn" onClick={() => { if (window.confirm('Clear the existing portfolio?')) setExisting([]) }}>Clear</button>
              )}
            </div>
          </div>
          <table className="data-table">
            <tbody>
              {rv.existing.map((l, i) => {
                const f = fundByCode.get(l.code)
                return (
                  <tr key={l.code}>
                    <td style={{ maxWidth: 280 }}>
                      <div className="text-xs font-medium truncate"><FundLink code={l.code} name={name(l.code)} /></div>
                      <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                    </td>
                    <td style={{ width: 130 }}>
                      <input type="number" min={0} step={10000} value={l.amount ?? ''} placeholder="₹ amount"
                             onChange={e => setExisting(rv.existing.map((x, j) => j === i ? { ...x, amount: e.target.value === '' ? null : Math.max(0, +e.target.value) } : x))}
                             className="px-2 py-1 rounded text-xs w-full text-right" style={inputStyle} />
                    </td>
                    <td className="ret-cell text-[11px]" style={{ width: 50, color: 'var(--text-low)' }}>{exTotal && l.amount ? pct1(l.amount / exTotal) : ''}</td>
                    <td style={{ width: 24 }}>
                      <button onClick={() => setExisting(rv.existing.filter((_, j) => j !== i))} title="Remove"
                              style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-2">
            <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick} exclude={rv.existing.map(l => l.code)}
                        onPick={f => { setExisting([...rv.existing, { code: f.c, amount: null }]); setPick('') }}
                        placeholder="Add a fund — type any part of its name…" style={inputStyle} />
          </div>
        </div>

        {/* ── suggested ── */}
        <div className="card p-4">
          <SuggestedEditor existing={rv.existing} lines={rv.proposed} onChange={proposed => setRv(r => ({ ...r, proposed }))}
                           inputStyle={inputStyle} colour={SG_COLOUR} />
        </div>
      </div>

      <PortfolioReview title="Existing vs suggested" sides={[
        { label: 'Existing', colour: EX_COLOUR, lines: rv.existing },
        { label: 'Suggested', colour: SG_COLOUR, lines: rv.proposed },
      ].filter(s => s.lines.some(l => (l.amount ?? 0) > 0))} />
    </section>
  )
}

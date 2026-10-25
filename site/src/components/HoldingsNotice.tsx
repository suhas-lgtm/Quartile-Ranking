// src/components/HoldingsNotice.tsx — the strip at the top of every page saying
// which month's portfolios the stock and sector figures use.
//
// Fund houses publish each month-end portfolio around the 10th of the next
// month, not all on the same day. scripts/data_health.py counts, after every
// daily run, how many funds have the newest month (health.json → holdings).
// Until every fund has it, the strip is amber and says how many are updated and
// that the rest still show the month before. It can be hidden for the session.

import { useState } from 'react'
import { useJson } from '../hooks/useData'

interface Health {
  checked_at: string
  holdings?: { month: string | null; expected: string; funds: number; updated: number; by_month: Record<string, number> }
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export default function HoldingsNotice() {
  const { data } = useJson<Health>('health.json')
  const h = data?.holdings
  const key = h ? `holdings_note_hidden:${h.month}:${h.updated}` : ''
  const [, redraw] = useState(0)
  let hidden = false
  try { hidden = !!key && sessionStorage.getItem(key) === '1' } catch { /* storage blocked: always shown */ }
  if (!h?.month || !h.funds || hidden) return null

  const latest = monthName(h.month)
  const notOut = h.month < h.expected                    // the month due has not appeared for any fund
  const newest = h.month
  const older = Object.entries(h.by_month).filter(([m]) => m < newest).sort(([a], [b]) => b.localeCompare(a))
  const rest = h.funds - h.updated
  const complete = !notOut && rest <= 0
  const colour = complete ? 'var(--accent-a)' : '#F59E0B'
  const n = (v: number) => v.toLocaleString('en-IN')

  return (
    <div className="px-4 sm:px-6 max-w-screen-2xl mx-auto print:hidden" role="status">
      <div className="card px-4 py-2 mb-3 flex items-start gap-3 text-xs"
           style={{ borderColor: colour, background: `color-mix(in srgb, ${complete ? '#22D3EE' : '#F59E0B'} 8%, var(--bg-card))` }}>
        <span className="font-bold whitespace-nowrap" style={{ color: colour }}>{complete ? 'ⓘ Holdings' : '⚠ Holdings'}</span>
        <div className="flex-1" style={{ color: 'var(--text-hi)' }}>
          {notOut ? (
            <>
              <b>{monthName(h.expected)}</b> portfolios are not published yet, so stocks, sectors, market cap and overlap
              for all funds are from <b>{latest}</b>.
            </>
          ) : complete ? (
            <>Stocks, sectors, market cap and overlap use the <b>{latest}</b> month-end portfolios of all {n(h.funds)} funds.</>
          ) : (
            <>
              <b>{latest}</b> portfolios are updated for <b>{n(h.updated)} of {n(h.funds)} funds</b> so far.
              {' '}The other <b>{n(rest)}</b> still show{' '}
              {older.length === 1
                ? <b>{monthName(older[0][0])}</b>
                : <>an earlier month ({older.map(([m, c]) => `${monthName(m)}: ${n(c)}`).join(', ')})</>}
              {' '}(their {latest} portfolio has not been received yet), so for those funds the stocks, sectors and overlap are
              {' '}{older.length === 1 ? monthName(older[0][0]) : 'older'} figures.
            </>
          )}
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-low)' }}>
            Fund houses publish month-end portfolios around the 10th of the next month; we load them as they appear.
            {' '}NAVs and returns are daily, as of the close shown at the top.
          </div>
        </div>
        <button onClick={() => { try { sessionStorage.setItem(key, '1') } catch { /* optional */ } redraw(v => v + 1) }}
                title="Hide for now" style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  )
}

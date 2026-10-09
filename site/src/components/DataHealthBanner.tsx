// src/components/DataHealthBanner.tsx — tells everyone when the data is behind.
//
// scripts/data_health.py checks the published data after every daily run
// (mutual fund and SIF NAVs, monthly holdings, Market Pulse indices) and writes
// health.json. Nothing shows while all is well; a stale NAV date or missing
// monthly holdings put an amber (worth a look) or red (stale) strip under the
// header, saying exactly what is behind. It can be hidden for the session.

import { useState } from 'react'
import { useJson } from '../hooks/useData'

interface Health {
  checked_at: string
  status: 'ok' | 'warn' | 'fail'
  checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[]
}

export default function DataHealthBanner() {
  const { data } = useJson<Health>('health.json')
  const key = data ? `health_hidden:${data.checked_at}` : ''
  const [, redraw] = useState(0)
  let hidden = false
  try { hidden = !!key && sessionStorage.getItem(key) === '1' } catch { /* storage blocked: always shown */ }
  if (!data || data.status === 'ok' || hidden) return null
  const bad = data.checks.filter(c => c.status !== 'ok')
  const red = data.status === 'fail'
  const colour = red ? '#EF4444' : '#F59E0B'
  return (
    <div className="px-4 sm:px-6 max-w-screen-2xl mx-auto print:hidden" role="status">
      <div className="card px-4 py-2.5 mb-3 flex items-start gap-3 text-xs"
           style={{ borderColor: colour, background: `color-mix(in srgb, ${colour} 10%, var(--bg-card))` }}>
        <span className="font-bold whitespace-nowrap" style={{ color: colour }}>{red ? '⚠ Data not updated' : '⚠ Data check'}</span>
        <div className="flex-1" style={{ color: 'var(--text-hi)' }}>
          {bad.map(c => <div key={c.name}>{c.message}</div>)}
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-low)' }}>
            Checked {new Date(data.checked_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' '}· numbers on the dashboard are from the dates shown
          </div>
        </div>
        <button onClick={() => { try { sessionStorage.setItem(key, '1') } catch { /* optional */ } redraw(n => n + 1) }}
                title="Hide for now" style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  )
}

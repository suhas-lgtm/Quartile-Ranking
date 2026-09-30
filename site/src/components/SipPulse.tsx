// src/components/SipPulse.tsx — the client's SIPs as a heartbeat monitor.
//
// One heartbeat per SIP, largest first: the spike's height follows the SIP's
// amount a month, the amount is written over it and the fund's short name under
// it. A bright pulse runs along the trace, and the line under the monitor names
// each SIP in turn as the pulse passes its beat ("SIP 3/8 · HDFC Flexi Cap ·
// ₹10,000 a month · INCREASED"). On the right, the vital signs: SIP flow a
// month and a year, the number of SIPs, the largest — and, after suggested SIP
// changes, how the flow moves. Plain SVG and CSS animation (no script), so the
// shared web link keeps it; the PDF prints the trace still, every amount on it.

import { useId, useMemo } from 'react'
import { useJson } from '../hooks/useData'
import type { FundsIndex } from '../types'
import { inr, pct1 } from './PortfolioReview'
import { shortName } from './PortfolioOrbit'

export interface SipBeat {
  code?: string
  name?: string
  /** ₹ a month. */
  amount: number
  /** Today's SIP in the fund, for "₹5,000 → ₹7,500". */
  was?: number
  status?: 'new' | 'up' | 'down'
}

const H = 300, BASE = 178, TOP = 44, PAD = 24
/** ₹ short, exact to the rupee where it fits: ₹17.5K, ₹1.25L. */
const k = (v: number) => v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)}L` : v >= 1e3 ? `₹${+(v / 1e3).toFixed(2)}K` : `₹${Math.round(v)}`

export default function SipPulse({ label, items, before, years }: {
  label: string
  items: SipBeat[]
  /** SIPs a month today, when the beats are the SIPs after suggested changes. */
  before?: number
  /** For a plan: how many years the SIPs run. */
  years?: number
}) {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const byCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f.n])), [index])
  const uid = useId().replace(/[^A-Za-z0-9]/g, '')
  const live = items.filter(i => i.amount > 0).sort((a, b) => b.amount - a.amount)
  const stopped = items.filter(i => !(i.amount > 0) && (i.was ?? 0) > 0)
  if (!live.length) return null
  const nameOf = (i: SipBeat) => i.name ?? (i.code ? byCode.get(i.code) : undefined) ?? i.code ?? 'Fund'
  const total = live.reduce((t, i) => t + i.amount, 0)
  const max = live[0].amount
  const n = live.length
  // At least a laptop screen wide; more SIPs, a longer strip (it scrolls sideways on a phone).
  const W = Math.max(1000, PAD * 2 + 84 * n)
  const beat = (W - PAD * 2) / n

  // The trace: for each beat a small P wave, the QRS spike (its height by amount), a T wave.
  const pts: [number, number][] = [[0, BASE]]
  const peaks: { x: number; y: number; at: number }[] = []
  const wave = (x0: number, x1: number, h: number) => {
    for (let s = 1; s <= 6; s++) pts.push([x0 + ((x1 - x0) * s) / 6, BASE - h * Math.sin((Math.PI * s) / 6)])
  }
  live.forEach((it, i) => {
    const x = PAD + i * beat, w = beat
    const h = 26 + (BASE - TOP - 26) * Math.sqrt(it.amount / max)
    pts.push([x + w * 0.16, BASE]); wave(x + w * 0.16, x + w * 0.28, 6)
    pts.push([x + w * 0.36, BASE], [x + w * 0.40, BASE + 9])
    pts.push([x + w * 0.45, BASE - h]); peaks.push({ x: x + w * 0.45, y: BASE - h, at: pts.length - 1 })
    pts.push([x + w * 0.50, BASE + 24], [x + w * 0.55, BASE])
    wave(x + w * 0.62, x + w * 0.82, 13)
    pts.push([x + w, BASE])
  })
  pts.push([W, BASE])
  // Length along the trace, to time the pulse against each beat.
  const along: number[] = [0]
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const L = along[along.length - 1]
  const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')
  const SEG = 140
  const T = Math.max(8, n * 1.4)                                         // seconds for one sweep
  const when = peaks.map(p => (along[p.at] / (L + SEG)) * 100)            // % of the sweep at each spike
  const win = (i: number) => [when[i], i + 1 < n ? when[i + 1] : 100] as const
  const tone = (it: SipBeat) => it.status === 'new' ? '#7FE3FF' : it.status === 'down' ? '#F5C451' : '#5CF29A'
  const word = (it: SipBeat) => it.status === 'new' ? ' · NEW SIP' : it.status === 'up' ? ' · INCREASED' : it.status === 'down' ? ' · REDUCED' : ''

  const css = [
    `@keyframes ecgrun${uid}{from{stroke-dashoffset:${SEG}}to{stroke-dashoffset:${-L}}}`,
    `.ecg-run-${uid}{stroke-dasharray:${SEG} ${L + SEG};animation:ecgrun${uid} ${T}s linear infinite}`,
    ...live.map((_, i) => {
      const [a, b] = win(i)
      return `@keyframes ecgt${uid}_${i}{0%,${Math.max(0, a - 0.01).toFixed(2)}%{opacity:0}${a.toFixed(2)}%,${Math.max(a, b - 0.01).toFixed(2)}%{opacity:1}${b.toFixed(2)}%,100%{opacity:0}}`
        + `.ecg-on-${uid}-${i}{animation:ecgt${uid}_${i} ${T}s linear infinite}`
    }),
  ].join('')

  const top = live[0]
  const change = before != null ? total - before : 0
  return (
    <div className="ecg-card mb-4">
      <style>{css}</style>
      <div className="ecg-screen">
        <div className="ecg-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: Math.round(W * 0.72) }} className="ecg-svg" role="img" aria-label={`${label} as a heartbeat`}>
            <defs>
              <pattern id={`grid${uid}`} width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="#1D4A33" strokeWidth="0.8" />
              </pattern>
              <pattern id={`gridb${uid}`} width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M100 0H0V100" fill="none" stroke="#24603F" strokeWidth="1.2" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill={`url(#grid${uid})`} />
            <rect width={W} height={H} fill={`url(#gridb${uid})`} />
            <path d={d} fill="none" stroke="#3FD483" strokeOpacity={0.55} strokeWidth={2.2} strokeLinejoin="round" className="ecg-line" />
            <path d={d} fill="none" stroke="#B9FFD6" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className={`ecg-run ecg-run-${uid}`} />
            {live.map((it, i) => {
              const p = peaks[i]
              const edge = p.x < 90 ? 'start' : p.x > W - 90 ? 'end' : 'middle'
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={5} fill="#D6FFE6" className={`ecg-dot ecg-on-${uid}-${i}`} />
                  <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="13" fontWeight="700" fill={tone(it)} className="ecg-amt">{k(it.amount)}</text>
                  <text x={edge === 'start' ? p.x - 16 : edge === 'end' ? p.x + 16 : p.x} y={BASE + 52 + (i % 2) * 17}
                        textAnchor={edge} fontSize="11.5" fill="#8FD9AE" className="ecg-name">{shortName(nameOf(it))}</text>
                </g>
              )
            })}
          </svg>
        </div>
        <div className="ecg-ticker">
          {live.map((it, i) => (
            <div key={i} className={`ecg-tick ecg-on-${uid}-${i}`}>
              ▶ SIP {i + 1}/{n} · {nameOf(it)} · {inr(it.amount)} a month
              {it.was != null && it.status && it.status !== 'new' ? ` (was ${inr(it.was)})` : ''}{word(it)}
            </div>
          ))}
          <div className="ecg-tick-still">{label} · {n} SIP{n === 1 ? '' : 's'} · {inr(total)} a month
            {stopped.length ? ` · ${stopped.length} stopped` : ''}</div>
        </div>
      </div>
      <div className="ecg-vitals">
        <div><div className="k">♥ SIP flow</div><div className="v" style={{ color: '#5CF29A' }}>{k(total)}</div>
          <div className="s">per month · {k(total * 12)} a year</div></div>
        {before != null && change !== 0 ? (
          <div><div className="k">Change</div><div className="v" style={{ color: change > 0 ? '#7FE3FF' : '#F5C451' }}>{change > 0 ? '+' : '−'}{k(Math.abs(change))}</div>
            <div className="s">a month · was {k(before)}</div></div>
        ) : null}
        <div><div className="k">SIPs</div><div className="v" style={{ color: '#7FE3FF' }}>{n}</div>
          <div className="s">{stopped.length ? `${stopped.length} stopped · ` : ''}largest {pct1(top.amount / total)}</div></div>
        {years && years > 1 ? (
          <div><div className="k">Over {years} years</div><div className="v" style={{ color: '#F58BD0' }}>{k(total * 12 * years)}</div>
            <div className="s">put in through SIPs</div></div>
        ) : (
          <div><div className="k">Largest SIP</div><div className="v" style={{ color: '#F58BD0' }}>{k(top.amount)}</div>
            <div className="s">{shortName(nameOf(top))}</div></div>
        )}
      </div>
    </div>
  )
}

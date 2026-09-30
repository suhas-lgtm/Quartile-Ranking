// src/components/PortfolioOrbit.tsx — the portfolio as a solar system.
//
// Deep space, a glowing sun for the whole portfolio, and one tilted orbit per
// fund: each fund is a glossy planet, sized by the amount in it, with one colour
// for each kind of fund (blue large cap, green mid cap, red small cap, amber
// flexi cap…, the same in every report), its short name beside it. Inner orbits turn
// faster, as real planets do. Touch or hover a planet for the fund's card.
// All plain SVG and CSS (no script), so the shared web link keeps the motion
// and the cards; the PDF prints it still, with a list of the funds.
// One system is drawn: the suggested portfolio, with new / increased / reduced
// funds marked — or the current one while nothing is suggested.

import { useId, useMemo } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import type { FundsIndex } from '../types'
import { inrShort, pct1 } from './PortfolioReview'

export interface OrbitItem {
  /** Mutual fund scheme code; leave out for a SIF (then give its name). */
  code?: string
  name?: string
  amount: number
  sif?: boolean
  /** Compared with the current portfolio: coming in, or changed in size. */
  status?: 'new' | 'up' | 'down'
  /** The amount held today, for "₹5.00 L → ₹4.00 L". */
  was?: number
}

/** One colour per kind of fund, the same in every report, in soft tones: the mutual fund categories, then SIF. */
const TYPE_COLOUR: Record<string, string> = {
  'large-cap': '#6F97CF', 'mid-cap': '#72B38C', 'small-cap': '#C97B7B', 'flexi-cap': '#D2A45E', 'large-mid-cap': '#9C86C9',
  'multi-cap': '#67AFBF', 'elss': '#C98AA9', 'focused': '#D08F66', 'value-contra': '#63A69C', 'dividend-yield': '#9DB86D',
  'sectoral-thematic': '#CDB46A', 'aggressive-hybrid': '#8089C9', 'balanced-advantage': '#7AA8C9', 'multi-asset': '#C98D96',
  'conservative-hybrid': '#8E95C4', 'equity-savings': '#A5BD7A', 'arbitrage': '#9AA3B2', 'balanced-hybrid': '#A88FC4',
  'index-fund': '#B3BCC8', 'etf': '#C2C8D1', 'gold-etf': '#CFB56B', 'fof-overseas': '#8F7FC0', 'fof-domestic': '#B587B8',
  'retirement': '#CFA27A', 'childrens': '#CFA0B5', 'sif': '#B98AB8',
}
/** Colours for kinds of fund without one of their own (the debt categories and anything new), in turn. */
const MORE = ['#6FAF96', '#6AAFAA', '#6F9FC0', '#8DB07A', '#C08BA6', '#C9B27A', '#7F9CC9', '#7FB29C']
const W = 1000, H = 540, CX = W / 2, CY = H / 2 + 10
const TILT = 0.36                     // how flat the orbits look (1 = seen from above)
const SUN = 64

/** A short name for a label: the AMC shortened, the plan words dropped. */
export function shortName(n: string) {
  let s = n.replace(/\s*[-–(].*$/, '')
    .replace(/Aditya Birla Sun Life/i, 'ABSL').replace(/ICICI Prudential/i, 'ICICI Pru').replace(/Nippon India/i, 'Nippon')
    .replace(/Mirae Asset/i, 'Mirae').replace(/Franklin India/i, 'Franklin').replace(/Kotak Mahindra/i, 'Kotak')
    .replace(/Mahindra Manulife/i, 'Mahindra').replace(/Baroda BNP Paribas/i, 'Baroda BNP').replace(/Motilal Oswal/i, 'Motilal')
    .replace(/Large\s*(&|and)\s*Mid\s*Cap/i, 'L&M').replace(/Balanced Advantage/i, 'BAF')
    .replace(/\b(Fund|Scheme|Plan|Growth|Regular|Direct|Option)\b/gi, '').replace(/\s+/g, ' ').trim()
  if (s.length > 24) s = s.slice(0, 23) + '…'
  return s
}

/** The same stars every time (a seeded scatter). */
function stars(n: number) {
  let seed = 7
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  return Array.from({ length: n }, () => ({ x: r() * W, y: r() * H, s: 0.4 + r() * 1.3, o: 0.25 + r() * 0.6 }))
}
const STARS = stars(140)

function twoLines(name: string, max = 30): [string, string] {
  if (name.length <= max) return [name, '']
  const cut = name.lastIndexOf(' ', max)
  const a = name.slice(0, cut > 10 ? cut : max), b = name.slice(a.length).trim()
  return [a, b.length > max ? b.slice(0, max - 1) + '…' : b]
}

interface Placed { r: number; a: number; dur: number }
/**
 * What keeps a planet round and upright on a flattened, turning orbit: the group it
 * sits in is flattened; this turns it round the sun, moves it out to its orbit,
 * turns it back and un-flattens it.
 */
function onOrbit(p: Placed, key: string | number, child: React.ReactNode) {
  const rad = (p.a * Math.PI) / 180
  return (
    <g key={key} className="orb-spin" style={{ ['--dur' as string]: `${p.dur}s` }}>
      <g transform={`translate(${(p.r * Math.cos(rad)).toFixed(1)} ${(p.r * Math.sin(rad)).toFixed(1)})`}>
        <g className="orb-spin orb-back" style={{ ['--dur' as string]: `${p.dur}s` }}>
          <g transform={`scale(1 ${(1 / TILT).toFixed(4)})`}>{child}</g>
        </g>
      </g>
    </g>
  )
}

export default function PortfolioOrbit({ label, colour, items, note }: {
  label: string; colour: string; items: OrbitItem[]
  /** A line under the picture, e.g. how many funds are sold in full. */
  note?: string
}) {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundBy = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const uid = useId().replace(/[^A-Za-z0-9]/g, '')
  const live = items.filter(i => i.amount > 0)
  if (!live.length) return null
  // The kind of fund: its category (SIFs together).
  const typeOf = (it: OrbitItem) => (it.sif ? 'sif' : (it.code ? fundBy.get(it.code)?.s : undefined) ?? 'other')
  const typeName = (t: string) => t === 'sif' ? 'SIF' : meta?.categories.find(c => c.slug === t)?.category_name
    ?? index?.funds.find(f => f.s === t)?.k ?? 'Other'
  const nameOf = (it: OrbitItem) => it.name ?? (it.code ? fundBy.get(it.code)?.n : undefined) ?? it.code ?? 'Fund'
  const catOf = (it: OrbitItem) => (it.sif ? 'SIF' : it.code ? fundBy.get(it.code)?.k : undefined) ?? ''

  const total = live.reduce((t, i) => t + i.amount, 0)
  const kinds = [...new Set(live.map(typeOf))]
    .map(t => ({ key: t, label: typeName(t), items: live.filter(i => typeOf(i) === t).sort((a, b) => b.amount - a.amount) }))
    .map(c => ({ ...c, amount: c.items.reduce((t, i) => t + i.amount, 0) }))
    .sort((a, b) => b.amount - a.amount)
  let more = 0
  const colourOf = new Map(kinds.map(k => [k.key, TYPE_COLOUR[k.key] ?? MORE[more++ % MORE.length]]))
  // One orbit per fund, the biggest kind of fund nearest the sun.
  const order = kinds.flatMap(c => c.items.map(it => ({ it, tone: colourOf.get(c.key)! })))
  const n = order.length
  const r0 = SUN + 40, r1 = W / 2 - 40
  const maxAmt = Math.max(...live.map(i => i.amount))
  const planets = order.map((o, i) => {
    const r = n === 1 ? (r0 + r1) / 2 : r0 + (i * (r1 - r0)) / (n - 1)
    return {
      ...o, i: i + 1, r,
      a: (i * 137.5) % 360,                                   // spread round the sun (golden angle)
      pr: 6 + 16 * Math.sqrt(o.it.amount / maxAmt),
      dur: Math.round(36 * Math.pow(r / r0, 1.5)),            // inner orbits faster
    }
  })
  const tones = [...new Set(planets.map(p => p.tone))]
  const gid = (t: string) => `pl${uid}${t.slice(1)}`
  const centre = `translate(${CX} ${CY}) scale(1 ${TILT})`

  return (
    <div className="card mb-4 orbit-space">
      <div className="orbit-space-head">
        <span className="t" style={{ color: colour }}>{label}</span>
        <span className="s">{inrShort(total)} · {live.length} fund{live.length === 1 ? '' : 's'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="orbit-svg" role="img" aria-label={`${label} as a solar system`}>
        <defs>
          <radialGradient id={`sun${uid}`} cx="45%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#FFE9A8" /><stop offset="55%" stopColor="#F7B733" /><stop offset="100%" stopColor="#E08A12" />
          </radialGradient>
          <radialGradient id={`halo${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F7B733" stopOpacity="0.45" /><stop offset="55%" stopColor="#F7B733" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#F7B733" stopOpacity="0" />
          </radialGradient>
          {tones.map(t => (
            <radialGradient key={t} id={gid(t)} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="28%" stopColor={t} />
              <stop offset="100%" stopColor={t} stopOpacity="0.55" />
            </radialGradient>
          ))}
        </defs>
        {STARS.map((s, i) => <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.s.toFixed(2)} fill="#fff" opacity={s.o.toFixed(2)} />)}
        <g transform={centre}>
          {planets.map(p => (
            <circle key={p.i} r={p.r} fill="none" stroke="#9FB0E0" strokeOpacity={0.16} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <circle cx={CX} cy={CY} r={SUN * 2.6} fill={`url(#halo${uid})`} />
        <circle cx={CX} cy={CY} r={SUN} fill={`url(#sun${uid})`} />
        <text x={CX} y={CY - 10} textAnchor="middle" fontSize="11" fontWeight="600" letterSpacing="1.5" fill="#7A4A00">PORTFOLIO</text>
        <text x={CX} y={CY + 16} textAnchor="middle" fontSize="22" fontWeight="700" fill="#4A2A00">{inrShort(total)}</text>

        {/* planets */}
        <g transform={centre}>
          {planets.map(p => onOrbit(p, p.i, (
            <g className="orbit-planet" data-tap="" data-p={p.i} tabIndex={0}>
              <circle r={p.pr * 2.2} fill={p.tone} opacity={0.1} />
              {p.it.status === 'new' && (
                <ellipse rx={p.pr * 1.9} ry={p.pr * 0.55} fill="none" stroke="#F4E3B5" strokeOpacity={0.85} strokeWidth={1.4} transform="rotate(-18)" />
              )}
              <circle r={p.pr} fill={`url(#${gid(p.tone)})`} />
              <text className="orbit-label" x={p.pr + 7} y={4} fontSize="13" fill="#D7DDF3">
                {shortName(nameOf(p.it))}{p.it.status === 'up' ? ' ▲' : p.it.status === 'down' ? ' ▼' : ''}
              </text>
            </g>
          )))}
        </g>

        {/* the cards, above everything; CSS shows the one touched */}
        <style>{planets.map(p => `.orbit-svg:has([data-p="${p.i}"]:is(:hover,:focus)) [data-t="${p.i}"]`).join(',') + '{display:inline !important}'}</style>
        <g transform={centre} pointerEvents="none">
          {planets.map(p => {
            const it = p.it
            const [l1, l2] = twoLines(nameOf(it))
            const head = l2 ? 2 : 1
            const lines = [l1, l2, `${catOf(it)}${catOf(it) ? ' · ' : ''}${pct1(it.amount / total)} of the portfolio`,
                           it.was != null && it.status ? `${inrShort(it.was)} → ${inrShort(it.amount)}` : inrShort(it.amount),
                           it.status === 'new' ? 'New in the portfolio' : it.status === 'up' ? 'Increased' : it.status === 'down' ? 'Reduced' : ''].filter(Boolean)
            const tw = 250, th = 17 * lines.length + 12
            return onOrbit(p, p.i, (
              <g className="orbit-tip" data-t={p.i} transform={`translate(${-tw / 2} ${-p.pr - th - 10})`}>
                <rect width={tw} height={th} rx={9} fill="#141A38" stroke="#3A4680" />
                {lines.map((t, i) => (
                  <text key={i} x={13} y={21 + i * 17} fontSize={i < head ? 13 : 12} fontWeight={i < head ? 700 : 400}
                        fill={i < head ? '#F1F3FB' : '#AEB6D6'}>{t}</text>
                ))}
              </g>
            ))
          })}
        </g>
      </svg>
      <div className="orbit-keys">
        {kinds.map(c => (
          <span key={c.key}><i style={{ background: colourOf.get(c.key) }} />{c.label} · {pct1(c.amount / total)}</span>
        ))}
        {live.some(i => i.status === 'new') && <span><i className="ring" />new fund</span>}
      </div>
      {/* The PDF cannot be touched: it lists the funds instead. */}
      <div className="orbit-legend">
        {planets.map(p => (
          <div key={p.i}>
            <span className="dot" style={{ background: p.tone }} />
            <span className="nm">{nameOf(p.it)}</span>
            <span className="am">{inrShort(p.it.amount)}{p.it.status === 'new' ? ' · new' : p.it.status === 'up' ? ' · ▲' : p.it.status === 'down' ? ' · ▼' : ''}</span>
          </div>
        ))}
      </div>
      <p className="orbit-note">
        The sun is the whole portfolio; each planet a fund, bigger for more money, one colour for each kind of fund; inner orbits turn faster.
        <span className="print:hidden"> Touch or hover a planet for the fund.</span>
        {note ? ` ${note}` : ''}
      </p>
    </div>
  )
}

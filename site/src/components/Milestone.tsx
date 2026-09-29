// src/components/Milestone.tsx — a client's goal ("₹1 Cr in 10 years") and
// what the portfolio needs to reach it.
//
// Each side (the plan; or existing and suggested) is a lump sum invested today
// plus a monthly SIP, growing at an expected return: the mutual funds' own 5Y
// or 3Y return weighted by amount, or a rate typed in. The card shows the value
// at the target year, how far above or short of the milestone that is, when the
// milestone is reached at that pace, and — when short — the extra SIP or lump
// sum that closes the gap, with a year-by-year path.

import { useEffect, useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { useRiskFiles, inr, inrShort } from './PortfolioReview'
import type { FundsIndex } from '../types'

export interface MilestoneSide {
  label: string
  colour: string
  /** Invested today (lump sums, or the current value). */
  lump: number
  /** Monthly SIP from now on. */
  sip: number
  /** Mutual funds with amounts, for the expected return. */
  lines: { code: string; amount: number }[]
}
type RateMode = '5Y' | '3Y' | 'custom'
interface Goal { target: number | null; years: number; mode: RateMode; custom: number; stepUp: number; sip?: number }

const MAX_YEARS = 50
/** Round milestones advisors talk in: ₹10 L … ₹100 Cr. */
const LADDER = [1e6, 2.5e6, 5e6, 7.5e6, 1e7, 1.5e7, 2e7, 2.5e7, 3e7, 5e7, 7.5e7, 1e8, 1.5e8, 2e8, 2.5e8, 5e8, 7.5e8, 1e9]

/** The next round milestone above a value, and how much more it needs. */
export function nextMilestone(value: number): { at: number; more: number } | null {
  const at = LADDER.find(m => m > value)
  return at == null ? null : { at, more: at - value }
}
const pctIn = (v: number) => `${(v * 100).toFixed(2)}%`

/** Value after `months` of growth at annual rate r: lump compounding plus a SIP paid at the start of each month, stepped up yearly. */
export function projectValue(lump: number, sip: number, r: number, months: number, stepUp = 0) {
  const rm = Math.pow(1 + r, 1 / 12) - 1
  let v = lump, invested = lump, s = sip
  for (let m = 0; m < months; m++) {
    if (m > 0 && m % 12 === 0) s *= 1 + stepUp
    v = (v + s) * (1 + rm)
    invested += s
  }
  return { value: v, invested }
}

function monthsToReach(lump: number, sip: number, r: number, target: number, stepUp: number) {
  const rm = Math.pow(1 + r, 1 / 12) - 1
  let v = lump, s = sip
  for (let m = 0; m < MAX_YEARS * 12; m++) {
    if (v >= target) return m
    if (m > 0 && m % 12 === 0) s *= 1 + stepUp
    v = (v + s) * (1 + rm)
  }
  return v >= target ? MAX_YEARS * 12 : null
}

export default function Milestone({ sides: given, storeKey, askSip }: {
  sides: MilestoneSide[]; storeKey: string
  /** Show a 'monthly SIP from now' field, added to every side (for portfolios that have no SIP of their own). */
  askSip?: boolean
}) {
  const [goal, setGoal] = useState<Goal>(() => {
    try { const g = JSON.parse(localStorage.getItem(storeKey) ?? 'null'); if (g?.years) return g } catch { /* none */ }
    return { target: 10000000, years: 10, mode: '5Y', custom: 0.12, stepUp: 0 }
  })
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(goal)) } catch { /* optional */ } }, [goal, storeKey])
  const sides = askSip ? given.map(s => ({ ...s, sip: s.sip + (goal.sip ?? 0) })) : given

  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const codes = [...new Set(sides.flatMap(s => s.lines.map(l => l.code)))]
  const files = useRiskFiles(codes.map(c => fundByCode.get(c)?.s).filter((x): x is string => !!x))
  const risk = useMemo(() => {
    const m = new Map<string, Record<string, number | null>>()
    for (const f of Object.values(files)) for (const r of f?.funds ?? []) m.set(r.scheme_code, r.returns as Record<string, number | null>)
    return m
  }, [files])
  const rateOf = (s: MilestoneSide): number | null => {
    if (goal.mode === 'custom') return goal.custom
    let sum = 0, w = 0
    for (const l of s.lines) {
      const r = risk.get(l.code)
      // A fund too young for 5Y falls back to its 3Y return rather than dropping out.
      const v = r?.[goal.mode] ?? (goal.mode === '5Y' ? r?.['3Y'] : null) ?? null
      if (v == null || !(l.amount > 0)) continue
      sum += v * l.amount; w += l.amount
    }
    return w ? sum / w : null
  }

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }
  const months = goal.years * 12
  const T = goal.target ?? 0
  const rows = sides.filter(s => s.lump > 0 || s.sip > 0).map(s => {
    const r = rateOf(s)
    if (r == null) return { s, r }
    const at = projectValue(s.lump, s.sip, r, months, goal.stepUp)
    const reach = T ? monthsToReach(s.lump, s.sip, r, T, goal.stepUp) : null
    // Extra needed when short: a flat monthly SIP, or a lump sum today, each on its own.
    const gap = T - at.value
    const perRupeeSip = projectValue(0, 1, r, months, goal.stepUp).value
    const extraSip = gap > 0 && perRupeeSip > 0 ? gap / perRupeeSip : 0
    const extraLump = gap > 0 ? gap / Math.pow(1 + r, goal.years) : 0
    // The round milestones just above today's value (and the client's own goal), with what is still to go.
    const now = s.lump
    const marks = [...new Set([...LADDER.filter(m => m > now).slice(0, 4), ...(T > now ? [T] : [])])].sort((a, b) => a - b).slice(0, 5)
    const ladder = marks.map(m => ({ m, need: m - now, months: monthsToReach(s.lump, s.sip, r, m, goal.stepUp), goal: m === T }))
    return { s, r, at, reach, gap, extraSip, extraLump, ladder }
  })
  const pathYears = Array.from({ length: Math.min(goal.years, 30) }, (_, i) => i + 1)

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center flex-wrap gap-2 mb-3">
        <span className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>🎯 Milestone</span>
        <span className="text-[11px]" style={{ color: 'var(--text-low)' }}>the client&apos;s goal and what it takes to reach it</span>
      </div>
      <div className="flex flex-wrap items-end gap-4 mb-3 text-xs" style={{ color: 'var(--text-mid)' }}>
        <label>Milestone ₹
          <input type="number" min={0} step={1000000} value={goal.target ?? ''} onChange={e => setGoal(g => ({ ...g, target: e.target.value === '' ? null : Math.max(0, +e.target.value) }))}
                 className="block mt-1 px-2 py-1.5 rounded text-sm text-right" style={{ ...inputStyle, width: 150 }} />
        </label>
        <span className="pb-2 font-semibold" style={{ color: 'var(--text-hi)' }}>{T ? inrShort(T) : ''}</span>
        <label>In (years)
          <input type="number" min={1} max={MAX_YEARS} value={goal.years} onChange={e => setGoal(g => ({ ...g, years: Math.max(1, Math.min(MAX_YEARS, +e.target.value || 1)) }))}
                 className="block mt-1 px-2 py-1.5 rounded text-sm text-right" style={{ ...inputStyle, width: 70 }} />
        </label>
        {askSip && (
          <label>Monthly SIP from now ₹
            <input type="number" min={0} step={5000} value={goal.sip || ''} placeholder="0" onChange={e => setGoal(g => ({ ...g, sip: Math.max(0, +e.target.value || 0) }))}
                   className="block mt-1 px-2 py-1.5 rounded text-sm text-right" style={{ ...inputStyle, width: 120 }} />
          </label>
        )}
        <label>SIP step-up / year %
          <input type="number" min={0} max={50} step={1} value={Math.round(goal.stepUp * 100)} onChange={e => setGoal(g => ({ ...g, stepUp: Math.max(0, +e.target.value || 0) / 100 }))}
                 className="block mt-1 px-2 py-1.5 rounded text-sm text-right" style={{ ...inputStyle, width: 70 }} />
        </label>
        <div>
          <div className="mb-1">Expected return</div>
          <div className="flex items-center gap-1">
            {([['5Y', "Funds' 5Y return"], ['3Y', "Funds' 3Y return"], ['custom', 'Custom']] as const).map(([k, l]) => (
              <button key={k} className={`tab-btn ${goal.mode === k ? 'active' : ''}`} onClick={() => setGoal(g => ({ ...g, mode: k }))}>{l}</button>
            ))}
            {goal.mode === 'custom' && (
              <input type="number" min={0} max={40} step={0.5} value={+(goal.custom * 100).toFixed(2)} onChange={e => setGoal(g => ({ ...g, custom: Math.max(0, +e.target.value || 0) / 100 }))}
                     className="px-2 py-1 rounded text-xs text-right" style={{ ...inputStyle, width: 64 }} />
            )}
            {goal.mode === 'custom' && <span>% p.a.</span>}
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="text-xs" style={{ color: 'var(--text-mid)' }}>
          {askSip
            ? 'Upload the existing holdings (or build the suggested portfolio) and the projection, the next milestones and what it takes to reach the goal appear here.'
            : 'Add funds with amounts (lump sum or SIP) to project the milestone.'}
        </div>
      ) : (
        <>
          <div className={`grid gap-3 mb-3 ${rows.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {rows.map(x => (
              <div key={x.s.label} className="rounded p-3" style={{ border: `1px solid ${x.s.colour}`, background: 'var(--bg-raised)' }}>
                <div className="text-xs font-bold mb-1" style={{ color: x.s.colour }}>{x.s.label}</div>
                <div className="text-[11px] mb-2" style={{ color: 'var(--text-mid)' }}>
                  {inr(x.s.lump)} today{x.s.sip ? ` + ${inr(x.s.sip)} / month SIP${goal.stepUp ? ` (+${Math.round(goal.stepUp * 100)}% a year)` : ''}` : ''}
                  {x.r != null && <> · growing at <b>{pctIn(x.r)}</b> a year</>}
                </div>
                {x.r == null || !x.at ? (
                  <div className="text-xs" style={{ color: 'var(--text-low)' }}>No {goal.mode} return for these funds — pick another expected return.</div>
                ) : (
                  <>
                    <div className="text-sm" style={{ color: 'var(--text-hi)' }}>
                      In {goal.years} years: <b>{inrShort(x.at.value)}</b>
                      <span className="text-[11px]" style={{ color: 'var(--text-low)' }}> (invested {inrShort(x.at.invested)})</span>
                    </div>
                    {T > 0 && (x.gap! <= 0 ? (
                      <div className="text-xs mt-1" style={{ color: '#34D399' }}>
                        ✓ Milestone of {inrShort(T)} reached{x.reach != null ? ` in ${(x.reach / 12).toFixed(1)} years` : ''} — {inrShort(-x.gap!)} above it by year {goal.years}.
                      </div>
                    ) : (
                      <div className="text-xs mt-1" style={{ color: '#F59E0B' }}>
                        Short of {inrShort(T)} by <b>{inrShort(x.gap!)}</b>.
                        {x.reach != null ? ` At this pace it is reached in ${(x.reach / 12).toFixed(1)} years.` : ` Not reached within ${MAX_YEARS} years at this pace.`}
                        <div className="mt-1" style={{ color: 'var(--text-hi)' }}>
                          To reach it in {goal.years} years: add <b>{inr(Math.ceil(x.extraSip! / 100) * 100)} / month SIP</b>
                          {goal.stepUp ? ' (stepped up the same way)' : ''}, <i>or</i> invest <b>{inrShort(x.extraLump!)}</b> more today.
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {x.r != null && x.ladder && x.ladder.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>
                      Next milestones from today&apos;s {inrShort(x.s.lump)}
                    </div>
                    <table className="w-full text-[11px]">
                      <thead><tr style={{ color: 'var(--text-low)' }}>
                        <th className="text-left font-normal">Milestone</th>
                        <th className="text-right font-normal">Still to go</th>
                        <th className="text-right font-normal">Reached in</th>
                      </tr></thead>
                      <tbody>
                        {x.ladder.map(l => (
                          <tr key={l.m}>
                            <td className="py-0.5" style={{ color: l.goal ? '#F59E0B' : 'var(--text-hi)' }}>
                              {inrShort(l.m)}{l.goal ? ' 🎯 goal' : ''}
                            </td>
                            <td className="text-right font-semibold" style={{ color: 'var(--text-hi)' }}>{inrShort(l.need)} more</td>
                            <td className="text-right" style={{ color: 'var(--text-mid)' }}>
                              {l.months == null ? `over ${MAX_YEARS} yrs` : l.months < 12 ? `${l.months} month${l.months === 1 ? '' : 's'}` : `${(l.months / 12).toFixed(1)} yrs`}
                              {l.months != null && <span style={{ color: 'var(--text-low)' }}> ({new Date(Date.now() + l.months * 30.44 * 86400000).getFullYear()})</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {rows.some(x => x.r != null) && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th className="text-left">Year</th>
                  {rows.filter(x => x.r != null).flatMap(x => [
                    <th key={x.s.label + 'i'} style={{ textAlign: 'right', color: x.s.colour }}>{x.s.label} invested</th>,
                    <th key={x.s.label + 'v'} style={{ textAlign: 'right', color: x.s.colour }}>{x.s.label} value</th>,
                  ])}
                </tr></thead>
                <tbody>
                  {pathYears.map(y => (
                    <tr key={y}>
                      <td className="text-xs">Year {y}</td>
                      {rows.filter(x => x.r != null).flatMap(x => {
                        const p = projectValue(x.s.lump, x.s.sip, x.r!, y * 12, goal.stepUp)
                        const hit = T > 0 && p.value >= T
                        return [
                          <td key={x.s.label + 'i'} className="ret-cell text-xs" style={{ color: 'var(--text-mid)' }}>{inrShort(p.invested)}</td>,
                          <td key={x.s.label + 'v'} className="ret-cell text-xs font-semibold" style={{ color: hit ? '#34D399' : undefined }}>
                            {inrShort(p.value)}{hit ? ' ✓' : ''}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] mt-2" style={{ color: 'var(--text-low)' }}>
            Projection only: the lump sum compounds at the expected return; each SIP instalment is invested at the start of the month
            and compounds monthly. The funds&apos; past {goal.mode === 'custom' ? '' : `${goal.mode} `}returns are no guarantee of future returns.
            SIFs, if any, are assumed to earn the same rate. ✓ = milestone reached that year.
          </p>
        </>
      )}
    </div>
  )
}

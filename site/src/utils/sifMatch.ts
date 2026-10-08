// src/utils/sifMatch.ts — recognise SIF holdings in an uploaded statement.
//
// A client statement lists SIFs among the mutual funds ("Altiva Hybrid
// Long-Short Fund - Regular Plan - Growth", "qsif Equity Long-Short - Direct
// IDCW"…). They are not in the mutual fund list, so the holdings reader either
// leaves them unmatched or, worse, matches them to a similarly named mutual
// fund. A row counts as a SIF when its name carries a SIF house's name and
// says Long-Short or SIF; it is then matched to the SIF strategy whose name
// shares the most words with it (Regular Growth plan, the one a plan uses).

import type { SifPlan } from '../sections/sif/types'

const PLAN_WORDS = /\b(regular|direct|plan|growth|idcw|dividend|payout|reinvest(ment)?|option|fund|reg|dir|gr|g|sif|the)\b/g

const words = (s: string) => new Set(
  s.toLowerCase().replace(/long\s*[-–]?\s*short/g, 'longshort').replace(/ex\s*[-–]?\s*top\s*100/g, 'extop100')
    .replace(/[^a-z0-9]+/g, ' ').replace(PLAN_WORDS, ' ').split(/\s+/).filter(Boolean))

/** The first word of each SIF house ("altiva", "qsif", "magnum"…), from the SIF list itself. */
function houseWords(plans: SifPlan[]) {
  const out = new Set<string>()
  for (const p of plans) {
    for (const src of [p.house ?? '', p.name]) {
      const w = src.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0]
      if (w && w.length > 2) out.add(w)
    }
  }
  return out
}

/** The SIF a statement row is, or null when it reads as an ordinary mutual fund. */
export function matchSif(raw: string, plans: SifPlan[]): SifPlan | null {
  const n = raw.toLowerCase()
  if (!/long\s*[-–]?\s*short|\bsif\b/.test(n)) return null
  const houses = houseWords(plans)
  const first = n.replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)
  if (!first.some(w => houses.has(w))) return null
  const mine = words(raw)
  let best: SifPlan | null = null, score = 0
  for (const p of plans) {
    const theirs = words(p.name)
    let common = 0
    for (const w of mine) if (theirs.has(w)) common++
    const s = common / Math.max(mine.size, theirs.size, 1)
    if (s > score) { score = s; best = p }
  }
  return score >= 0.5 ? best : null
}

// src/utils/fuzzy.ts — forgiving fund-name search, shared by every search box.
//
// People type "mirae asest", "parag parik", "midcap" for "Mid Cap", or "ppfas"
// for Parag Parikh. A plain substring test finds none of those. Each query word
// is matched against the name's words, best first:
//
//   exact word 1.0 · word starts with it 0.9 · inside the name with spaces
//   removed ("midcap") 0.8 · within a small edit distance of a word or of a
//   word's start (typos, swapped letters) 0.75 down to 0.45
//
// A name matches when every query word found something; the score is the
// average, so the closest names sort first.

const STOP = new Set(['fund', 'plan', 'growth', 'option', 'direct', 'regular', 'the', 'scheme', 'of'])

/** Short forms people use for AMC names. */
const ALIASES: Record<string, string> = {
  ppfas: 'parag parikh', absl: 'aditya birla sun life', abslf: 'aditya birla sun life',
  mosl: 'motilal oswal', mo: 'motilal oswal', sbimf: 'sbi', icicipru: 'icici prudential',
  pru: 'prudential', hdfcmf: 'hdfc', lic: 'lic mf', boi: 'bank of india', bnp: 'baroda bnp paribas',
  elss: 'elss tax saver', flexicap: 'flexi cap', midcap: 'mid cap', smallcap: 'small cap',
  largecap: 'large cap', multicap: 'multi cap', bal: 'balanced', adv: 'advantage',
  // Former names of renamed funds (SEBI recategorisation and later renames).
  bluechip: 'large cap', frontline: 'large cap', emerging: 'mid cap', taxsaver: 'elss tax saver',
}
/** Phrases typed as two words that names write as one. */
const JOINS: [RegExp, string][] = [
  [/\bblue chip\b/g, 'bluechip'],
  [/\btax saver\b/g, 'taxsaver'],
  [/\bmid cap\b/g, 'midcap'],
  [/\bsmall cap\b/g, 'smallcap'],
  [/\bflexi cap\b/g, 'flexicap'],
  [/\blarge cap\b/g, 'largecap'],
  [/\bmulti cap\b/g, 'multicap'],
]

function words(s: string): string[] {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), capped. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2 = new Array(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]
    prev = cur
  }
  return prev[b.length]
}

export interface Prepared { words: string[]; squashed: string; size: number }

/** Pre-process a name once; reuse it for every keystroke. */
export function prepare(text: string): Prepared {
  const w = words(text)
  const kept = w.filter(x => !STOP.has(x))
  return { words: kept, squashed: w.join(''), size: kept.length }
}

function wordScore(q: string, p: Prepared): number {
  let best = 0
  const allowed = q.length <= 3 ? 0 : q.length <= 5 ? 1 : q.length <= 8 ? 2 : 3
  // Two words of the name that together spell the query word ("mid" + "cap" for "midcap").
  for (let i = 0; i + 1 < p.words.length; i++) if (p.words[i] + p.words[i + 1] === q) return 1
  for (const w of p.words) {
    if (w === q) return 1
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 0.9)
    // Typos rarely touch both of the first two letters: skip the costly check otherwise.
    if (allowed && (w[0] === q[0] || w[1] === q[1])) {
      const d = Math.min(editDistance(q, w, allowed), editDistance(q, w.slice(0, q.length), allowed))
      if (d <= allowed) best = Math.max(best, 0.75 - 0.15 * (d - 1))
    }
  }
  if (best < 0.8 && q.length >= 3 && p.squashed.includes(q)) best = 0.8
  return best
}

function wordsScore(qs: string[], target: Prepared): number {
  if (!qs.length) return 1
  let total = 0
  for (const q of qs) {
    const s = wordScore(q, target)
    if (!s) return 0
    total += s
  }
  return total / qs.length
}

/** The readings of a query, each with how far it is trusted: as typed; with
 *  two-word phrases joined ("blue chip" -> "bluechip"); with short forms and
 *  former names expanded. A rewritten reading is trusted a little less, so
 *  "icici pru bluechip" prefers the fund literally called Bluechip. Worked out
 *  once per search, not once per fund. */
function readings(query: string): [string[], number][] {
  const typed = words(query).filter(w => !STOP.has(w))
  let joined = ' ' + typed.join(' ') + ' '
  for (const [re, to] of JOINS) joined = joined.replace(re, to)
  const joinedWords = words(joined)
  const expanded = joinedWords.flatMap(w => words(ALIASES[w] ?? w)).filter(w => !STOP.has(w))
  return [[typed, 1], [joinedWords, 0.98], [expanded, 0.95]]
}

function bestScore(rs: [string[], number][], target: Prepared): number {
  let best = 0
  for (const [r, trust] of rs) best = Math.max(best, trust * wordsScore(r, target))
  return best
}

/** 0 = no match; otherwise higher is closer. */
export function fuzzyScore(query: string, target: Prepared): number {
  return bestScore(readings(query), target)
}

/** Keep the items matching `query`, closest first; everything, in order, when empty. */
export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit?: number): T[] {
  if (!query.trim()) return limit ? items.slice(0, limit) : items
  const rs = readings(query)
  const scored: { item: T; s: number; i: number }[] = []
  items.forEach((item, i) => {
    const p = prepareCached(text(item))
    const s = bestScore(rs, p)
    // Among equal scores the shorter name is the closer one ("HDFC Mid Cap"
    // before "HDFC Large & Mid Cap" for "hdfc midcap").
    if (s > 0) scored.push({ item, s: s - p.size * 0.001, i })
  })
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  const out = scored.map(x => x.item)
  return limit ? out.slice(0, limit) : out
}

/** A test for filters that keep their own sort order: prepare once, call per row. */
export function fuzzyMatcher(query: string): (text: string) => boolean {
  if (!query.trim()) return () => true
  const rs = readings(query)
  return text => bestScore(rs, prepareCached(text)) > 0
}

const cache = new Map<string, Prepared>()
function prepareCached(text: string): Prepared {
  let p = cache.get(text)
  if (!p) {
    p = prepare(text)
    if (cache.size > 20000) cache.clear()
    cache.set(text, p)
  }
  return p
}

// src/config/indices.ts — the 8 Market Pulse indices, served live from Neon.
//
// Each index is one row in Neon's `files` table, holding its identity, latest
// close, 1-day move, a 30-point sparkline and its full 6-year daily history.
// scripts/update_indices.py refreshes them every weekday evening, so Market
// Pulse shows the day's closes without a rebuild or a deploy.
//
// The path below is served from Neon (netlify.toml -> netlify/functions/data). It is
// deliberately NOT under /data/index/, which holds the committed series of all
// 36 benchmarks — proxying that path would break them.
//
// TO ADD A NINTH INDEX, three lists must agree:
//   1. this file
//   2. scripts/index_store.py           STRIP
//   3. scripts/build_json.py            STRIP_INDICES
// update_indices.py refuses to run if 2 and 3 disagree.

export const LIVE_INDEX_BASE = '/live/indices'

/**
 * Which band of the market an index describes.
 *
 * Market Pulse shows these as two labelled groups. The split is editorial, not
 * technical: a broad index answers "how did the market do", a sectoral one
 * answers "which part of it did", and reading them off one undifferentiated
 * grid of eighteen cards makes neither question easy to ask.
 */
export type IndexGroup = 'broad' | 'sectoral' | 'global'

export interface MarketPulseIndex {
  id: number
  slug: string
  group: IndexGroup
}

/**
 * In render order, within each group — this is the order the Market Pulse cards
 * appear in.
 *
 * NIFTY BANK is deliberately left in `broad`. It is a sector by construction,
 * but it has been read as a market barometer here since the first version, and
 * moving it would change what a reader thinks the top row means. It can be
 * reclassified in one line if that turns out to be the wrong call.
 */
export const MARKET_PULSE_INDICES: readonly MarketPulseIndex[] = [
  { id: 1, slug: 'nifty-50',           group: 'broad' },
  { id: 2, slug: 'sensex',             group: 'broad' },
  { id: 3, slug: 'nifty-100',          group: 'broad' },
  { id: 6, slug: 'nifty-midcap-150',   group: 'broad' },
  { id: 7, slug: 'nifty-smallcap-250', group: 'broad' },
  { id: 4, slug: 'nifty-bank',         group: 'broad' },
  { id: 5, slug: 'nifty-500',          group: 'broad' },
  { id: 9, slug: 'gold-goldbees',      group: 'broad' },

  // ── Sectoral ─────────────────────────────────────────────────────────────
  // Must match scripts/index_store.SECTORS (ids and slugs). Most of these now
  // get only a latest bar from Yahoo, so a card can lag while its history
  // catches up; the card then shows the date its value is from.
  { id: 10, slug: 'nifty-it',                 group: 'sectoral' },
  { id: 26, slug: 'nifty-pharma',             group: 'sectoral' },
  { id: 24, slug: 'nifty-healthcare',         group: 'sectoral' },
  { id: 21, slug: 'nifty-financial-services', group: 'sectoral' },
  { id: 27, slug: 'nifty-private-bank',       group: 'sectoral' },
  { id: 28, slug: 'nifty-psu-bank',           group: 'sectoral' },
  { id: 20, slug: 'nifty-auto',               group: 'sectoral' },
  { id: 23, slug: 'nifty-fmcg',               group: 'sectoral' },
  { id: 30, slug: 'nifty-consumer-durables',  group: 'sectoral' },
  { id: 25, slug: 'nifty-metal',              group: 'sectoral' },
  { id: 35, slug: 'nifty-energy',             group: 'sectoral' },
  { id: 31, slug: 'nifty-oil-gas',            group: 'sectoral' },
  { id: 45, slug: 'nifty-infrastructure',     group: 'sectoral' },
  { id: 29, slug: 'nifty-realty',             group: 'sectoral' },
  { id: 54, slug: 'nifty-media',              group: 'sectoral' },
  { id: 48, slug: 'nifty-pse',                group: 'sectoral' },
  { id: 34, slug: 'nifty-cpse',               group: 'sectoral' },

  // ── Global ───────────────────────────────────────────────────────────────
  // Must match scripts/index_store.GLOBAL. Values are in each market's currency.
  { id: 80, slug: 'sp-500', group: 'global' },
  { id: 81, slug: 'dow-jones', group: 'global' },
  { id: 82, slug: 'nasdaq-composite', group: 'global' },
  { id: 70, slug: 'nasdaq-100', group: 'global' },
  { id: 83, slug: 'ftse-100', group: 'global' },
  { id: 84, slug: 'dax', group: 'global' },
  { id: 85, slug: 'cac-40', group: 'global' },
  { id: 86, slug: 'euro-stoxx-50', group: 'global' },
  { id: 87, slug: 'nikkei-225', group: 'global' },
  { id: 88, slug: 'hang-seng', group: 'global' },
  { id: 89, slug: 'shanghai-composite', group: 'global' },
  { id: 90, slug: 'kospi', group: 'global' },
]

/** Group headings and the accent each group's rule is drawn in. */
export const MARKET_PULSE_GROUPS: readonly {
  key: IndexGroup
  label: string
  gradient: [string, string]
}[] = [
  { key: 'broad',    label: 'Broader Market', gradient: ['#22D3EE', '#1d4ed8'] },
  { key: 'sectoral', label: 'Sectoral',       gradient: ['#F59E0B', '#F472B6'] },
  { key: 'global',   label: 'Global Markets', gradient: ['#A78BFA', '#60A5FA'] },
]

/**
 * The group an index belongs to, by id.
 *
 * Anything unclassified falls to `broad` rather than disappearing. The strip has
 * two sources — the live bucket, ordered by the list above, and the committed
 * indices.json fallback, which is ordered by the build — so a card must never
 * depend on its position in the array to be shown.
 */
export function indexGroup(id: number): IndexGroup {
  return MARKET_PULSE_INDICES.find(i => i.id === id)?.group ?? 'broad'
}

/** Shape of one published index file. */
export interface LiveIndexFile {
  index_id: number
  index_name: string
  slug: string
  as_of: string
  date: string
  latest_close: number
  change_1d: number | null
  change_1d_abs: number | null
  sparkline: [string, number][]
  history: [string, number][]
  /** When this file was written by the refresh (ISO timestamp). */
  generated?: string
}

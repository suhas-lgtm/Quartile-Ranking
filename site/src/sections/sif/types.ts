// src/sections/sif/types.ts — the SIF desk's data (sif.json, sif_nfo.json),
// written by build_json.build_sif from AMFI's SIF feeds.

export type SifPeriod = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y'

export interface SifPlan {
  /** AMFI's SIF scheme id, e.g. "SIF-120". */
  id: string
  /** The SIF house, e.g. "Altiva SIF". */
  house: string | null
  name: string
  /** SEBI SIF strategy, e.g. "Equity Long-Short Fund". */
  strategy: string
  /** e.g. "Equity Oriented Investment Strategies". */
  strategy_group: string
  type: string | null
  plan: string | null
  option: string | null
  isin: string | null
  nav: number
  date: string | null
  /** NAV against the ₹10 NFO price. */
  since_launch: number | null
  /** Null until enough daily NAVs have been collected for the period. */
  returns: Record<SifPeriod, number | null>
  history_from: string | null
  /** [date, NAV], oldest first — only the days collected so far. */
  history: [string, number][]
}

export interface SifData {
  fetched: string
  as_of: string | null
  nfo_price: number
  plans: SifPlan[]
}

export interface SifNfoData {
  fetched: string
  offers: {
    id: string
    house: string | null
    name: string | null
    category: string | null
    type: string | null
    objective: string | null
    opens: string | null
    closes: string | null
    min_amount: string | null
    price: string | null
    website: string | null
    document: string | null
  }[]
}

// src/types.ts — Shared TypeScript types matching the JSON contract (Appendix PB)

export interface Category {
  category_id: number
  asset_class: 'Equity' | 'Hybrid' | 'Debt' | 'Other'
  category_name: string
  slug: string
  display_order: number
  benchmark_id: number | null
  benchmark_name: string | null
}

export interface BenchmarkComponent {
  index_id: number
  weight: number
}

export interface Benchmark {
  index_id: number
  index_name: string
  ticker: string | null
  is_synthetic: boolean
  components: BenchmarkComponent[]
}

export interface Meta {
  as_of: string
  risk_free_rate: number
  categories: Category[]
  benchmarks: Benchmark[]
  generated: string
}

export interface IndexCard {
  index_id: number
  index_name: string
  latest_close: number
  date: string
  change_1d: number | null
  change_1d_abs: number | null
  sparkline: [string, number][]
  /**
   * Full daily history, present when the card came from the live Neon files
   * (which carry it) and absent when it came from the committed indices.json
   * fallback. IndexChartModal uses it to skip a second fetch.
   */
  history?: [string, number][]
}

export interface IndicesData {
  /** Newest closing date held (the cards show closes, not live prices). */
  as_of: string
  indices: IndexCard[]
  /** When the index data was last refreshed (ISO timestamp), if known. */
  generated?: string
}

export interface GlanceRow {
  period_type: 'trailing' | 'monthly' | 'quarterly' | 'annual'
  periods: (string | number)[]
  category_id: number
  asset_class: string
  category_name: string
  slug: string
  benchmark_id: number | null
  fund_count: number
  averages: Record<string, number | null>
  benchmark: Record<string, number | null>
  /**
   * Per-theme averages, present only on Sectoral/Thematic.
   *
   * AMFI files every theme under that one category, so its single row of
   * averages blends banking with pharma and technology and describes no fund
   * anyone can buy. Category Snapshot expands this into one line per theme.
   */
  sectors?: {
    sector: string
    fund_count: number
    averages: Record<string, number | null>
  }[]
}

export interface GlanceData {
  as_of: string
  view: string
  rows: GlanceRow[]
}

export interface FundRow {
  scheme_code: string
  scheme_name: string
  amc_name: string
  returns: Record<string, number | null>
}

export interface CategoryTableData {
  as_of: string
  view: string
  category_id: number
  category_name: string
  asset_class: string
  benchmark_id: number | null
  period_keys: string[]
  funds: FundRow[]
  category_avg: Record<string, number | null>
  benchmark: Record<string, number | null>
}

// MoverEntry / MoversData removed — movers_{slug}.json is no longer generated.
// Leaders & Laggards is computed in the browser from the category table that
// the category table has already loaded.

export interface QuartileFundRow {
  scheme_code: string
  scheme_name: string
  quartiles: (number | null)[]
  /**
   * The return each quartile was computed from — same index as `quartiles`.
   * Shown in the cell tooltip: a Q box on its own invites comparison against
   * whatever return is visible elsewhere (usually 1Y), and a fund can be top
   * for the year while bottom for the quarter.
   */
  returns?: (number | null)[]
  /** Stamped by build_json for sectoral/thematic funds only. */
  sector?: string
}

/**
 * One fund's quartile journey. Every list in QuartilesData uses this same shape,
 * because consistency and volatility are now read off the same history — that is
 * what stops a fund appearing in both. See engine.quartile_journeys.
 */
export interface JourneyEntry {
  scheme_code: string
  history: (number | null)[]
  periods: number
  avg_quartile: number
  pct_q1: number
  /** Share of periods spent in Q1/Q2 and in Q3/Q4. */
  top_share: number
  bottom_share: number
  /** Moves between the top half and the bottom half, in either direction. */
  crossings: number
  /** How evenly the time splits between halves: 0 never left one, 0.5 a dead heat. */
  balance: number
}

export interface QuartilesData {
  as_of: string
  category_name: string
  mode: 'quarterly' | 'annual'
  period_labels: string[]
  funds: QuartileFundRow[]
  /** Never crossed out of Q1/Q2. Disjoint from most_volatile. */
  most_consistent: JourneyEntry[]
  /** Crossed between the halves at least once. Disjoint from most_consistent. */
  most_volatile: JourneyEntry[]
  /** Level rather than stability, so these MAY overlap the two lists above. */
  best_performers?: JourneyEntry[]
  worst_performers?: JourneyEntry[]
}

/** Trailing-return periods carried by risk_{slug}.json, oldest window last. */
export type RiskPeriod = '1D' | '1W' | '1M' | '3M' | '6M' | '12M' | '2Y' | '3Y' | '5Y' | '10Y'

/** The ratio fields, shared by a fund row and the category average. */
export interface RiskRatios {
  std_annual: number | null
  sharpe: number | null
  sortino: number | null
  alpha: number | null
  beta: number | null
  max_drawdown: number | null
  upside_capture: number | null
  downside_capture: number | null
  composite_score: number | null
}

export interface RiskFundRow extends RiskRatios {
  scheme_code: string
  scheme_name: string
  /** Decimal; up to 12M absolute, beyond that CAGR. null = not enough history. */
  returns: Record<RiskPeriod, number | null>
  recovery_days: number | null
}

/** risk_{slug}.json — Risk & Returns tab. */
export interface RiskData {
  as_of: string
  category_name: string
  risk_free_rate: number
  window: string
  periods: RiskPeriod[]
  benchmark: {
    index_id: number
    name: string | null
    returns: Record<RiskPeriod, number | null>
    /** Newest close held for the benchmark. */
    last_date?: string | null
    /** True when that close is too old to compare against; Alpha/Beta/Captures are then blank. */
    stale?: boolean
  } | null
  category_average: RiskRatios & { returns: Record<RiskPeriod, number | null> }
  funds: RiskFundRow[]
}

export type ScreenerParam =
  | 'beta' | 'relative_risk' | 'down_capture' | 'std_dev'
  | 'returns' | 'relative_return' | 'alpha' | 'up_capture' | 'sharpe' | 'sortino'
  | 'max_drawdown' | 'recovery_time' | 'active_share'

/** Parameters measured once per ratio horizon (1Y / 3Y / 5Y). */
export type ScreenerRatio =
  | 'beta' | 'std_dev' | 'alpha' | 'sharpe' | 'sortino' | 'up_capture' | 'down_capture'
  | 'relative_risk' | 'relative_return'

export interface BearStat {
  /** Point-to-point return over the bear period (decimal). */
  fall: number
  /** Days after the period's end to regain the start level (so far, if not yet). */
  recovery_days: number
  recovered: boolean
}

export interface ScreenerFund {
  scheme_code: string
  scheme_name: string
  /** Has min_history of NAVs; younger funds are "newly launched" and unranked. */
  eligible: boolean
  returns: Record<string, number | null>
  /** {ratio: {horizon: value}}; alpha and relative_return are decimals. */
  ratios: Record<ScreenerRatio, Record<string, number | null>>
  /** One entry per bear period, null where the fund had not launched. */
  bear: (BearStat | null)[]
  active_share: { uncommon_count: number; uncommon_weight: number; month: string } | null
  /** 0–100 per parameter within the category; null when not ranked. */
  scores: Record<ScreenerParam, number | null> | null
}

/** screener_{slug}.json — Whitelist Screener tab. */
export interface ScreenerData {
  as_of: string
  category_name: string
  benchmark: {
    name: string | null
    stale: boolean
    last_date: string | null
    std_dev: Record<string, number | null>
    returns: Record<string, number | null>
  } | null
  horizons: string[]
  periods: string[]
  bear_periods: { label: string; start: string; end: string }[]
  min_history: string
  scoring: 'minmax' | 'percentile'
  default_weights: Record<ScreenerParam, number>
  funds: ScreenerFund[]
}

/** One mode's recent quartile history for a listed fund, oldest first. */
export interface ListedQuartiles {
  labels: string[]
  quartiles: (number | null)[]
  returns: (number | null)[]
}

/** A fund on a hand-kept list (build_json.fund_details). */
export interface ListedFund {
  scheme_code: string
  scheme_name: string
  /** The note or reason given for it on the list. */
  note: string
  category_name: string | null
  category_slug: string | null
  asset_class: string | null
  nav: number | null
  nav_date: string | null
  change_1d: number | null
  quartiles: Partial<Record<'monthly' | 'quarterly' | 'annual', ListedQuartiles>>
  returns: Record<RiskPeriod, number | null> | null
  ratios: RiskRatios | null
}

export type BlacklistRule =
  | 'bottom_quartile' | 'negative_alpha' | 'rolling_consistency' | 'downside_capture'
  | 'tracking_error' | 'short_track_record' | 'bottom_3m' | 'high_beta'

/** One rule's result for one fund. fail is null when the rule does not apply. */
export interface BlacklistRuleResult {
  fail: boolean | null
  /** What was measured, ready to display (e.g. "Q4 · Q4 · Q3", "37%"). */
  value: string | null
  /** The failure spelled out; empty when it passed. */
  text: string
}

/** blacklist.json — Blacklist tab. */
export interface BlacklistData {
  as_of: string
  /** The thresholds the rules were evaluated with. */
  rules: Record<string, unknown>
  default_weights: Record<BlacklistRule, number>
  default_min_score: number
  manual: ListedFund[]
  missing: string[]
  funds: {
    scheme_code: string
    scheme_name: string
    category_name: string
    category_slug: string
    asset_class: string
    rules: Record<BlacklistRule, BlacklistRuleResult>
    return_1y: number | null
    return_3y: number | null
  }[]
}

/** alerts.json — Auto Mailing tab. */
export interface AlertsData {
  as_of: string
  /** Percentage points below the category average that trigger a flag, per period. */
  thresholds: Record<string, number>
  periods: string[]
  funds: {
    scheme_code: string
    scheme_name: string
    category_name: string
    category_slug: string
    asset_class: string
    /** What the fund was compared with: its category, or its sector for Sectoral/Thematic. */
    peer_group: string
    periods: Record<string, { fund: number; average: number; gap: number; breach: boolean } | null>
    breaches: string[]
  }[]
}

export interface DrawdownPoint {
  date: string
  drawdown_pct: number
  is_trough: boolean
  is_recovery: boolean
}

export interface DrawdownData {
  scheme_code: string
  drawdown: DrawdownPoint[]
}

export interface NavSeries {
  scheme_code: string
  series: [string, number][]
}

export type ViewType = 'trailing' | 'monthly' | 'quarterly' | 'annual'
export type AssetClass = 'Equity' | 'Hybrid' | 'Debt' | 'Other'

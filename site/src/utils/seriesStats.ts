// src/utils/seriesStats.ts — returns and risk ratios worked out in the browser
// from a daily price history (a fund's NAVs or an index's closes).
//
// For what the pipeline does not publish: debt funds (no Risk & Returns files)
// and the benchmark column of a portfolio's returns table. Same definitions as
// engine/calculation_engine.py: returns up to 1Y absolute, beyond that CAGR;
// Std Dev from the last 36 monthly returns, annualised (× √12); Sharpe and
// Sortino on the 3Y CAGR over the risk-free rate; max drawdown over the whole
// history given; SIP = XIRR of a monthly SIP ending on the last close.

import { closeOnOrBefore, indexSip, isoMinus } from './navMath'

export type PricePoint = [string, number]

/** Below this yearly swing (0.0001%) Std Dev is rounding noise: Sharpe and Sortino are left blank. */
const MIN_SWING = 1e-6

export interface SeriesStats {
  returns: Record<string, number | null>
  sip: Record<string, number | null>
  std_annual: number | null
  sharpe: number | null
  sortino: number | null
  max_drawdown: number | null
}

const PERIODS: [string, number][] = [['1M', 1], ['3M', 3], ['6M', 6], ['12M', 12], ['2Y', 24], ['3Y', 36], ['5Y', 60], ['10Y', 120]]

/** Last close of each calendar month, oldest first. */
function monthCloses(pts: PricePoint[]): number[] {
  const out: number[] = []
  let month = ''
  for (const [d, v] of pts) {
    const m = d.slice(0, 7)
    if (m !== month) { out.push(v); month = m } else out[out.length - 1] = v
  }
  return out
}

export function seriesStats(points: PricePoint[] | null | undefined, rf: number, asOf?: string | null): SeriesStats | null {
  const pts = (points ?? []).filter(p => p[1] > 0 && (!asOf || p[0] <= asOf))
  if (pts.length < 20) return null
  const [endDate, endVal] = pts[pts.length - 1]

  const returns: Record<string, number | null> = {}
  for (const [k, m] of PERIODS) {
    const start = closeOnOrBefore(pts, isoMinus(endDate, m), 10)
    const r = start ? endVal / start.nav - 1 : null
    returns[k] = r == null ? null : m > 12 ? Math.pow(1 + r, 12 / m) - 1 : r
  }

  // 1D: against the previous NAV; 1W: against the NAV a week earlier (or the last one before).
  returns['1D'] = pts.length > 1 ? endVal / pts[pts.length - 2][1] - 1 : null
  const wk = new Date(endDate + 'T00:00:00Z'); wk.setUTCDate(wk.getUTCDate() - 7)
  const w0 = closeOnOrBefore(pts, wk.toISOString().slice(0, 10), 7)
  returns['1W'] = w0 ? endVal / w0.nav - 1 : null

  const sip: Record<string, number | null> = {}
  for (const [k, m] of [['1Y', 12], ['3Y', 36], ['5Y', 60]] as const) sip[k] = indexSip(pts, m)?.xirr ?? null

  // Monthly returns over the last three years.
  const closes = monthCloses(pts).slice(-37)
  const monthly: number[] = []
  for (let i = 1; i < closes.length; i++) monthly.push(closes[i] / closes[i - 1] - 1)
  let std: number | null = null, sharpe: number | null = null, sortino: number | null = null
  if (monthly.length >= 12) {
    const mean = monthly.reduce((s, x) => s + x, 0) / monthly.length
    std = Math.sqrt(monthly.reduce((s, x) => s + (x - mean) ** 2, 0) / (monthly.length - 1)) * Math.sqrt(12)
    const cagr = returns['3Y']
    const rfm = Math.pow(1 + rf, 1 / 12) - 1
    const down = Math.sqrt(monthly.reduce((s, x) => s + Math.min(x - rfm, 0) ** 2, 0) / monthly.length) * Math.sqrt(12)
    // A swing this small is rounding, not risk: no ratio rather than an absurd one.
    if (cagr != null && std > MIN_SWING) sharpe = (cagr - rf) / std
    if (cagr != null && down > MIN_SWING) sortino = (cagr - rf) / down
  }

  // Worst fall from a running peak.
  let peak = -Infinity, dd = 0
  for (const [, v] of pts) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }

  return { returns, sip, std_annual: std, sharpe, sortino, max_drawdown: dd }
}

export interface PortfolioRisk {
  std_annual: number | null
  sharpe: number | null
  sortino: number | null
  /** The portfolio's own 3Y return, p.a. (the funds held at these weights, rebalanced monthly). */
  ret_3y: number | null
  /** Months measured, and how much of the money had a history to measure. */
  months: number
  coverage: number
}

/**
 * Std Dev, Sharpe and Sortino of a whole portfolio. A portfolio's Sharpe is
 * not the weighted average of its funds' Sharpes: funds that do not move
 * together cancel part of each other's swings, so the portfolio's Std Dev is
 * lower than the average of theirs. Each month's portfolio return is the
 * funds' returns that month weighted by amount (a fund launched later counts
 * from its first month, the others re-weighted meanwhile); the ratios then
 * use the same definitions as a single fund: 36 monthly returns, Std Dev ×
 * √12, Sharpe and Sortino on the 3Y return over the risk-free rate.
 */
export function portfolioRisk(holdings: { points: PricePoint[] | null | undefined; amount: number }[],
                              rf: number, asOf?: string | null): PortfolioRisk | null {
  const total = holdings.reduce((s, h) => s + (h.amount > 0 ? h.amount : 0), 0)
  if (!total) return null
  // Month-end close per fund, keyed by 'YYYY-MM'.
  const funds = holdings.filter(h => h.amount > 0).map(h => {
    const m = new Map<string, number>()
    for (const [d, v] of h.points ?? []) if (v > 0 && (!asOf || d <= asOf)) m.set(d.slice(0, 7), v)
    return { m, w: h.amount / total }
  })
  const withData = funds.filter(f => f.m.size > 1)
  const coverage = withData.reduce((s, f) => s + f.w, 0)
  if (!withData.length) return null
  // The 37 month-ends ending at the latest month any fund has.
  const last = [...new Set(withData.flatMap(f => [...f.m.keys()]))].sort().slice(-1)[0]
  const keys: string[] = []
  let [y, mo] = last.split('-').map(Number)
  for (let i = 0; i < 37; i++) { keys.unshift(`${y}-${String(mo).padStart(2, '0')}`); mo -= 1; if (!mo) { mo = 12; y -= 1 } }
  const monthly: number[] = []
  for (let i = 1; i < keys.length; i++) {
    let s = 0, w = 0
    for (const f of withData) {
      const a = f.m.get(keys[i - 1]), b = f.m.get(keys[i])
      if (a == null || b == null) continue
      s += f.w * (b / a - 1); w += f.w
    }
    // A month counts when most of the money was invested in funds already running.
    if (w >= coverage * 0.5) monthly.push(s / w)
  }
  const out: PortfolioRisk = { std_annual: null, sharpe: null, sortino: null, ret_3y: null, months: monthly.length, coverage }
  if (monthly.length < 30) return out          // as for a fund: at least 30 of the 36 months
  const mean = monthly.reduce((s, x) => s + x, 0) / monthly.length
  const std = Math.sqrt(monthly.reduce((s, x) => s + (x - mean) ** 2, 0) / (monthly.length - 1)) * Math.sqrt(12)
  const growth = monthly.reduce((g, x) => g * (1 + x), 1)
  const ret = Math.pow(growth, 12 / monthly.length) - 1
  const rfm = Math.pow(1 + rf, 1 / 12) - 1
  const down = Math.sqrt(monthly.reduce((s, x) => s + Math.min(x - rfm, 0) ** 2, 0) / monthly.length) * Math.sqrt(12)
  out.std_annual = std
  out.ret_3y = ret
  out.sharpe = std > MIN_SWING ? (ret - rf) / std : null
  out.sortino = down > MIN_SWING ? (ret - rf) / down : null
  return out
}

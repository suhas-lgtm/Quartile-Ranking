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
    if (cagr != null && std) sharpe = (cagr - rf) / std
    if (cagr != null && down) sortino = (cagr - rf) / down
  }

  // Worst fall from a running peak.
  let peak = -Infinity, dd = 0
  for (const [, v] of pts) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }

  return { returns, sip, std_annual: std, sharpe, sortino, max_drawdown: dd }
}

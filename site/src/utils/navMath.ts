// src/utils/navMath.ts — returns between arbitrary dates, for Point to Point and
// Portfolio Builder, from NAVs fetched through /api/nav (server/navLookup.ts).
//
// The published tabs read figures the engine precomputed; these two cannot,
// because the dates are the viewer's. The rules are the engine's: NEAREST-
// PREVIOUS NAV for each date, simple return up to a year and CAGR beyond it
// (engine.trailing_return), and unit splits compensated (nav_store.adjust_for_splits).

import { useEffect, useMemo, useState } from 'react'

export interface NavPoint { date: string; nav: number }
export interface FundNavs {
  first_date: string | null
  latest: NavPoint | null
  at: Record<string, NavPoint | null>
  splits: { date: string; factor: number }[]
}

const DAY = 86_400_000
export const daysBetweenIso = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY

/**
 * Units multiply by the split factor at a split, so a raw NAV after a 1:10
 * split is a tenth of the price before it. Multiplying by the factors of every
 * split in (from, to] puts both NAVs in the same units.
 */
export function splitFactorBetween(splits: FundNavs['splits'], from: string, to: string): number {
  return splits.filter(s => s.date > from && s.date <= to).reduce((f, s) => f * s.factor, 1)
}

/** Point-to-point return between two NAV points of one fund, split-adjusted. */
export function pointReturn(f: FundNavs, a: NavPoint | null, b: NavPoint | null): number | null {
  if (!a || !b || a.nav <= 0) return null
  return (b.nav / a.nav) * splitFactorBetween(f.splits, a.date, b.date) - 1
}

/** Annualised when the span is over a year (the engine's rule), else null. */
export function cagr(ret: number | null, fromDate: string, toDate: string): number | null {
  if (ret == null) return null
  const days = daysBetweenIso(fromDate, toDate)
  if (days < 365) return null
  return Math.pow(1 + ret, 365 / days) - 1
}

/**
 * XIRR: the annual rate r with sum(cf_i / (1+r)^(t_i/365)) = 0. Investments are
 * negative, the final value positive. Bisection between -99.99% and +1000% —
 * slower than Newton but it cannot diverge. Null when there is no sign change.
 */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null
  const t0 = Math.min(...flows.map(f => Date.parse(f.date)))
  const years = flows.map(f => (Date.parse(f.date) - t0) / DAY / 365)
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0)
  let lo = -0.9999, hi = 10
  let flo = npv(lo), fhi = npv(hi)
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (Math.abs(fm) < 1e-7) return mid
    if (flo * fm < 0) { hi = mid; fhi = fm } else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

/**
 * NAVs for these funds on these dates. Batched (the server takes 300 funds per
 * call) and keyed on the sorted inputs so a re-render does not refetch.
 */
export function useNavLookup(codes: string[], dates: string[]) {
  const key = useMemo(() => [...codes].sort().join(',') + '|' + [...dates].sort().join(','), [codes, dates])
  const [data, setData] = useState<Record<string, FundNavs> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!codes.length) { setData({}); return }
    let cancelled = false
    setLoading(true); setError(null)
    const batches: string[][] = []
    for (let i = 0; i < codes.length; i += 250) batches.push(codes.slice(i, i + 250))
    Promise.all(batches.map(b =>
      fetch(`/api/nav?codes=${b.join(',')}&dates=${dates.join(',')}`)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))))
      .then(parts => {
        if (cancelled) return
        setData(Object.assign({}, ...parts.map(p => p.funds)))
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(String(e.message ?? e)); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading, error }
}

/** Close on or before `date` from an index file's [date, close] history. */
export function closeOnOrBefore(history: [string, number][] | undefined, date: string): NavPoint | null {
  if (!history?.length) return null
  let found: [string, number] | null = null
  for (const h of history) {
    if (h[0] <= date) found = h
    else break
  }
  if (!found || daysBetweenIso(found[0], date) > 10) return null
  return { date: found[0], nav: found[1] }
}

/** YYYY-MM-DD, n months/years before an ISO date (calendar arithmetic, clamped). */
export function isoMinus(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

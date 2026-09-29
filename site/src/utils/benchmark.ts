// src/utils/benchmark.ts — comparing a portfolio with an index.
//
// Index closes come from /data/index/{id}.json (every benchmark the pipeline
// holds, daily since 2010). Two comparisons:
//   indexTrailing  point-to-point index returns (1M-1Y absolute, 3Y/5Y CAGR),
//                  to set beside a portfolio's weighted fund returns;
//   flowsIntoIndex the SAME cash flows (each purchase / SIP instalment on its
//                  date) put into the index instead — what the money would be
//                  worth, and its XIRR, had it bought the index.

import { useEffect, useState } from 'react'
import { dataBase } from '../config/dataPaths'
import { isoMinus, xirr } from './navMath'

export type Series = [string, number][]

export function useIndexSeries(id: number | null) {
  const [s, setS] = useState<{ id: number; series: Series } | null>(null)
  useEffect(() => {
    if (id == null) return
    let dead = false
    fetch(`${dataBase()}/index/${id}.json`).then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead && d?.series) setS({ id, series: d.series }) }).catch(() => { /* none */ })
    return () => { dead = true }
  }, [id])
  return s && s.id === id ? s.series : null
}

/** Close on or before `date` (within 10 days), from an ascending series. */
export function closeAt(series: Series, date: string): number | null {
  let lo = 0, hi = series.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid][0] <= date) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  if (ans < 0) return null
  const gap = (Date.parse(date) - Date.parse(series[ans][0])) / 86400000
  return gap <= 10 ? series[ans][1] : null
}

export const TRAILING: [string, number][] = [['1M', 1], ['3M', 3], ['6M', 6], ['1Y', 12], ['3Y', 36], ['5Y', 60]]

export function indexTrailing(series: Series | null): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  if (!series?.length) return out
  const end = series[series.length - 1]
  for (const [k, m] of TRAILING) {
    const start = closeAt(series, isoMinus(end[0], m))
    out[k] = start ? (m > 12 ? Math.pow(end[1] / start, 12 / m) - 1 : end[1] / start - 1) : null
  }
  return out
}

export function flowsIntoIndex(flows: { date: string; amount: number }[], series: Series | null, end: string) {
  if (!series?.length || !end) return null
  const endClose = closeAt(series, end)
  if (!endClose) return null
  let units = 0, invested = 0, skipped = 0
  const cf: { date: string; amount: number }[] = []
  for (const f of flows) {
    if (f.amount >= 0) continue                     // outflows are purchases
    const c = closeAt(series, f.date)
    if (!c) { skipped++; continue }
    units += -f.amount / c
    invested += -f.amount
    cf.push(f)
  }
  if (!invested) return null
  const value = units * endClose
  cf.push({ date: end, amount: value })
  return { invested, value, gain: value - invested, ret: value / invested - 1, irr: xirr(cf), skipped }
}

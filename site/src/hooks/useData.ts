// src/hooks/useData.ts — Data fetching hooks for all JSON endpoints

import { useState, useEffect, useMemo } from 'react'
import { MARKET_PULSE_INDICES, LIVE_INDEX_BASE } from '../config/indices'
import type { LiveIndexFile } from '../config/indices'
import { dataBase, MARKET_BASE, categoryPath, navPath } from '../config/dataPaths'

/**
 * Fetch one JSON file from the published data (Neon, via /data/*).
 *
 * `path` is either a bucket-relative path, or a function returning a promise of
 * one. The function form exists because a category-scoped path has to wait for
 * manifest.json before it is even known; keeping that inside this hook means the
 * twenty-odd callers never deal with it.
 *
 * `key` identifies the request for the effect's dependency list, since a
 * function identity changes on every render and cannot be compared.
 */
export function useJson<T>(path: string | (() => Promise<string>), key?: string,
                          base?: string) {
  const [data, setData]   = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dep = typeof path === 'string' ? path : (key ?? '')

  useEffect(() => {
    if (!dep) return
    let cancelled = false
    setLoading(true)
    setError(null)
    // DROP THE PREVIOUS FILE'S CONTENT. It belongs to the file we just stopped
    // asking for, and every caller renders `loading ? skeleton : data ? table`,
    // so anything left here is shown under the NEW heading.
    //
    // That is how clicking a SIF debt strategy listed another strategy's funds:
    // its category file does not exist, the fetch 400s, `error` is set — and the
    // stale `data` was still truthy, so the table branch won. The reader saw a
    // full table of equity funds titled "Debt Long-Short Fund", and the
    // "Coming Funds" state below it was unreachable.
    //
    // Clearing costs a skeleton flash on every category change, where before the
    // old numbers stayed on screen a moment longer. That trade is not close: one
    // is a redraw, the other is the wrong fund list under the right name.
    setData(null)

    const resolve = typeof path === 'string' ? Promise.resolve(path) : path()
    resolve
      // `base` overrides the desk root for files that are shared between desks.
      // Only the index series needs it; everything else is desk-scoped.
      .then(p => fetch(`${base ?? dataBase()}/${p}`))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])

  return { data, loading, error }
}

export function useMeta()              { return useJson<import('../types').Meta>('meta.json') }

/**
 * Market Pulse indices — WHICHEVER SOURCE IS FRESHER.
 *
 * Two sources publish the same 8 indices on different schedules:
 *
 *   live      /live/indices/{slug}.json  — served from Neon, refreshed by
 *             update_indices.py in the nightly run. No rebuild needed, and each
 *             file carries its full history so opening the chart costs nothing.
 *   committed data/indices.json          — written by the nightly NAV run and
 *             deployed with the site.
 *
 * BOTH are fetched and the newer `date` wins. An earlier version preferred live
 * unconditionally, which broke exactly as you would expect: the indices job was
 * not running (its Supabase secrets were unset), so Supabase sat at 2026-07-29
 * while the repo had 2026-07-31 — and because the stale fetch still returned
 * 200, nothing fell back. Market Pulse showed two-day-old closes next to
 * fund data from today.
 *
 * Comparing dates makes it self-healing in both directions: if the indices job
 * stops, the nightly build carries the strip; if the nightly build is delayed,
 * the live files carry it. The extra request is ~7 KB gzipped.
 */
export function useIndices() {
  type IndicesData = import('../types').IndicesData
  const [data, setData] = useState<IndicesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const live = async (): Promise<IndicesData> => {
      const files = await Promise.all(
        MARKET_PULSE_INDICES.map(async ({ slug }) => {
          const r = await fetch(`${LIVE_INDEX_BASE}/${slug}.json`)
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${slug}`)
          return (await r.json()) as LiveIndexFile
        }),
      )
      return {
        // The strip labels itself with the freshest close it holds.
        as_of: files.reduce((a, f) => (f.date > a ? f.date : a), files[0].date),
        indices: files.map(f => ({
          index_id: f.index_id,
          index_name: f.index_name,
          latest_close: f.latest_close,
          date: f.date,
          change_1d: f.change_1d,
          change_1d_abs: f.change_1d_abs,
          sparkline: f.sparkline,
          history: f.history,
        })),
      }
    }

    const committed = async (): Promise<IndicesData> => {
      const r = await fetch(`${MARKET_BASE}/indices.json`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as IndicesData
    }

    // Settled, not all: one source failing must not sink the other. Local
    // `npm run dev` has no Netlify proxy, so `live` always rejects there.
    Promise.allSettled([live(), committed()])
      .then(([liveRes, commRes]) => {
        if (cancelled) return
        const ok = [liveRes, commRes]
          .filter((r): r is PromiseFulfilledResult<IndicesData> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter(d => d?.indices?.length)

        if (!ok.length) {
          const why = [liveRes, commRes]
            .map(r => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : ''))
            .filter(Boolean)
            .join('; ')
          setError(why || 'no index data available')
          setLoading(false)
          return
        }

        // Freshest wins. Compare the newest close each source actually holds
        // rather than its as_of label, which the committed file stamps with the
        // build date and would therefore always look newer.
        const newest = (d: IndicesData) =>
          d.indices.reduce((a, i) => (i.date > a ? i.date : a), '')
        ok.sort((a, b) => (newest(b) < newest(a) ? -1 : 1))
        setData(ok[0])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

export function useQuartiles(slug: string, mode: 'monthly' | 'quarterly' | 'annual') {
  return useJson<import('../types').QuartilesData>(
    () => categoryPath(slug, `quartiles_${mode}.json`), `q:${slug}:${mode}`)
}

/** Trailing returns and risk ratios for one category (Risk & Returns tab). */
export function useRisk(slug: string) {
  return useJson<import('../types').RiskData>(
    () => categoryPath(slug, 'risk.json'), slug ? `risk:${slug}` : '')
}

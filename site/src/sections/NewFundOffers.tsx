// src/sections/NewFundOffers.tsx — funds open for subscription now, from AMFI's
// New Fund Offer list (nfo.json, scripts/amfi_industry.fetch_nfo).

import { useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { fmtDate } from '../utils/format'
import { fuzzyMatcher } from '../utils/fuzzy'
import TableSearch from '../components/TableSearch'
import type { NfoData } from '../types'

type Offer = NfoData['offers'][number]

function status(o: Offer, today: string): { label: string; color: string; order: number } {
  if (o.opens && o.opens > today) return { label: 'Opens soon', color: '#F59E0B', order: 1 }
  if (o.closes && o.closes < today) return { label: 'Closed', color: 'var(--text-low)', order: 2 }
  return { label: 'Open now', color: '#34D399', order: 0 }
}

const daysLeft = (to: string | null, today: string) =>
  to ? Math.round((Date.parse(to) - Date.parse(today)) / 86400000) : null

export default function NewFundOffers() {
  const { data, loading, error } = useJson<NfoData>('nfo.json')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const kinds = useMemo(() => [...new Set((data?.offers ?? []).map(o => (o.category ?? '').split(' - ')[0]).filter(Boolean))].sort(), [data])
  const offers = useMemo(() => {
    const hit = fuzzyMatcher(query)
    return (data?.offers ?? [])
      .filter(o => (!kind || (o.category ?? '').startsWith(kind)) && (hit(o.name ?? '') || hit(o.amc ?? '')))
      .sort((a, b) => status(a, today).order - status(b, today).order || (a.closes ?? '').localeCompare(b.closes ?? ''))
  }, [data, query, kind, today])

  return (
    <section id="nfo" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>New Fund Offers</span>
        {data && <span className="ml-auto text-xs" style={{ color: 'var(--text-low)' }}>
          {data.offers.length} offer{data.offers.length === 1 ? '' : 's'} listed by AMFI · checked {fmtDate(data.fetched.slice(0, 10))}
        </span>}
      </div>

      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]"><TableSearch value={query} onChange={setQuery} /></div>
        {kinds.length > 1 && (
          <select value={kind} onChange={e => setKind(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm mb-3"
                  style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
            <option value="">All types</option>
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="card p-6 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 w-full" />)}</div>
      ) : !data ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          {error ? 'The NFO list is not available yet. It appears after the next data refresh.' : 'No data.'}
        </div>
      ) : offers.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          {data.offers.length ? `No offer looks like “${query}”.` : 'AMFI lists no open New Fund Offers right now.'}
        </div>
      ) : (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
          {offers.map(o => {
            const st = status(o, today)
            const left = daysLeft(o.closes, today)
            const [type, sub] = (o.category ?? '').split(' - ')
            return (
              <div key={o.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{o.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{o.amc}</div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{ color: st.color, border: `1px solid ${st.color}` }}>
                    {st.label}{st.order === 0 && left != null ? ` · ${left <= 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`}` : ''}
                  </span>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--accent-a)' }}>{sub && sub !== type ? `${type} · ${sub}` : type}{o.type ? ` · ${o.type}` : ''}</div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {[['Opens', fmtDate(o.opens)], ['Closes', fmtDate(o.closes)], ['Minimum', o.min_amount ?? '—']].map(([l, v]) => (
                    <div key={l} className="rounded-lg p-2" style={{ background: 'var(--bg-raised)' }}>
                      <div style={{ color: 'var(--text-low)' }}>{l}</div>
                      <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {o.objective && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}>{o.objective}</p>}
                <div className="flex gap-3 text-[11px] mt-auto">
                  {o.document && <a href={o.document} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>📄 Offer document</a>}
                  {o.website && <a href={o.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>AMC website ↗</a>}
                  {o.price && <span style={{ color: 'var(--text-low)' }}>Offer price ₹{o.price}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
        <b style={{ color: 'var(--text-hi)' }}>About NFOs.</b> A New Fund Offer is a fund&apos;s launch period, when units are sold
        at the offer price (usually ₹10). The list is AMFI&apos;s, refreshed with every data update. A new fund has no track record, so it does not appear in the rankings, ratios or the
        Whitelist Screener until it has enough history. Read the offer document before investing.
      </div>
    </section>
  )
}

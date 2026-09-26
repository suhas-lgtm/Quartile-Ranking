// src/sections/AutoMailing.tsx — funds trailing their category average.
//
// Shows alerts.json (build_json.build_alerts): every Equity/Hybrid, index, ETF and FoF fund whose
// return for a period is below its category average (its sector average for
// Sectoral/Thematic) by more than the threshold. The same list is emailed
// through Brevo after the 08:00 IST refresh (scripts/send_alerts.py).
// Nothing is calculated here.

import { useState } from 'react'
import TableSearch from '../components/TableSearch'
import { fuzzyMatcher } from '../utils/fuzzy'
import { useJson } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct } from '../utils/format'
import type { SheetSpec } from '../utils/xlsx'
import type { AlertsData } from '../types'
import FundLink from '../components/FundLink'

const PERIOD_NAMES: Record<string, string> = {
  '1D': '1 Day', '1W': '1 Week', '1M': '1 Month', '3M': '3 Months', '6M': '6 Months', '12M': '1 Year',
}

export default function AutoMailing() {
  const { data, loading, error } = useJson<AlertsData>('alerts.json')
  const [period, setPeriod] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const periods = data?.periods ?? []
  const funds = data?.funds ?? []
  const cats = [...new Map(funds.map(f => [f.category_slug, f.category_name])).entries()]
  const [query, setQuery] = useState('')
  const hit = fuzzyMatcher(query)
  const shown = funds.filter(f =>
    (!period || f.breaches.includes(period)) && (!catFilter || f.category_slug === catFilter) && hit(f.scheme_name))
  const countFor = (p: string) => funds.filter(f => f.breaches.includes(p)).length

  const buildExport = (): SheetSpec | null => {
    if (!data || !shown.length) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = shown.map(f => {
      const row: SheetSpec['rows'][number] = { fund: f.scheme_name, category: f.category_name, peers: f.peer_group }
      for (const p of periods) {
        row[`f_${p}`] = f.periods[p]?.fund ?? null
        row[`g_${p}`] = f.periods[p]?.gap ?? null
      }
      return row
    })
    return {
      sheet: 'Auto Mailing', title: 'Funds below category average',
      meta: [['Desk', desk.name], ['Data as of', data.as_of],
             ['Thresholds (pts below average)', periods.map(p => `${PERIOD_NAMES[p] ?? p} ${data.thresholds[p]}`).join(', ')]],
      columns: [
        { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
        { key: 'category', label: 'Category', type: 'text', width: 24 },
        { key: 'peers', label: 'Compared with', type: 'text', width: 24 },
        ...periods.flatMap(p => [
          { key: `f_${p}`, label: `${PERIOD_NAMES[p] ?? p} return`, type: 'percent' as const },
          { key: `g_${p}`, label: `${PERIOD_NAMES[p] ?? p} gap (pts)`, type: 'number' as const },
        ]),
      ],
      rows,
      fileName: `${desk.code} Auto Mailing - ${data.as_of}`,
    }
  }

  return (
    <section id="auto-mailing" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Auto Mailing</span>
        <span className="ml-auto"><DownloadButton build={buildExport} disabledHint="No fund breaches a threshold" /></span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-mid)' }}>
        Funds whose return is below their category average by more than the limit for a period. The same list is
        emailed every morning after the 8:00 AM IST refresh (no email when nothing breaches).
        {data && <> Based on NAVs as of <b style={{ color: 'var(--text-hi)' }}>{fmtDate(data.as_of)}</b>.</>}
      </p>

      {data && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setPeriod('')} className={`tab-btn${!period ? ' active accent' : ''}`}>
            All ({funds.length})
          </button>
          {periods.map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`tab-btn${period === p ? ' active accent' : ''}`}
                    title={`More than ${data.thresholds[p]}% below the category average over ${PERIOD_NAMES[p] ?? p}`}>
              {PERIOD_NAMES[p] ?? p} &gt; {data.thresholds[p]}% ({countFor(p)})
            </button>
          ))}
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs ml-auto"
                  style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
            <option value="">All categories</option>
            {cats.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </select>
        </div>
      )}

      <TableSearch value={query} onChange={setQuery} />

      <div className="card overflow-hidden mb-4">
        {loading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
        ) : error || !data ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
            The alert list has not been published yet. It appears after the next data refresh.
          </div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
            No fund is below its category average by more than the limit{period ? ` for ${PERIOD_NAMES[period] ?? period}` : ''}.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                  {periods.map(p => (
                    <th key={p} style={{ textAlign: 'center' }}
                        title={`Fund return vs category average; flagged when more than ${data.thresholds[p]} points below`}>
                      <div>{PERIOD_NAMES[p] ?? p}</div>
                      <div style={{ fontWeight: 400, opacity: 0.7, fontSize: 10 }}>limit −{data.thresholds[p]}%</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="rows-enter">
                {shown.map(f => {
                  const colour = categoryColor(f.category_slug, f.asset_class)
                  return (
                    <tr key={f.scheme_code}>
                      <td className="sticky-col" style={{ maxWidth: 300 }}>
                        <div className="text-xs font-medium truncate"><FundLink code={f.scheme_code} name={f.scheme_name} /></div>
                        <div className="text-[10px] truncate" style={{ color: colour }}>
                          {f.category_name}{f.peer_group !== f.category_name ? ` · vs ${f.peer_group}` : ''}
                        </div>
                      </td>
                      {periods.map(p => {
                        const r = f.periods[p]
                        if (!r) return <td key={p} className="text-center text-[11px]" style={{ color: 'var(--text-low)' }}>n/a</td>
                        return (
                          <td key={p} className="text-center"
                              style={{ background: r.breach ? 'rgba(248,113,113,0.14)' : undefined }}
                              title={`Fund ${fmtPct(r.fund)} vs average ${fmtPct(r.average)}`}>
                            <div className="text-xs font-semibold"
                                 style={{ color: r.breach ? 'var(--loss)' : r.gap < 0 ? 'var(--text-mid)' : 'var(--gain)' }}>
                              {r.gap > 0 ? '+' : ''}{r.gap.toFixed(2)} pts
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>
                              {fmtPct(r.fund)} vs {fmtPct(r.average)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
        <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-hi)' }}>How it works</div>
        Each cell is the fund’s return minus its category average for that period, in percentage points (e.g.
        −1.80 pts = the fund did 1.8% worse than the average fund in its category). Red cells cross the limit.
        Sectoral/Thematic funds are compared with their own sector. Index funds, ETFs, gold ETFs and domestic
        FoFs are compared with funds tracking the same index (e.g. a Nifty 50 ETF with other Nifty 50 ETFs);
        one with no same-index peer is not checked. Overseas FoFs are compared with their category average.
        Returns are simple returns over the period. Limits are kept in <code>data/alerts.json</code>; the email goes to the team list kept privately with
        the email settings.
      </div>
    </section>
  )
}

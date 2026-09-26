// src/sections/CalendarReturns.tsx — each fund's return in each calendar year,
// one category at a time, with the category average and benchmark.
//
// Figures from build_json.build_calendar (engine.annual_return): 31 Dec of the
// year before to 31 Dec of the year; the current year runs to the latest NAV.

import { useMemo, useState } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import { categoryPath } from '../config/dataPaths'
import { categoryColor } from '../config/categoryColors'
import { currentDesk } from '../config/products'
import { fmtDate, fmtPct, retColor } from '../utils/format'
import { fuzzyMatcher } from '../utils/fuzzy'
import DownloadButton from '../components/DownloadButton'
import FundLink from '../components/FundLink'
import TableSearch from '../components/TableSearch'
import ComingFunds from '../components/ComingFunds'
import type { SheetSpec } from '../utils/xlsx'
import type { CalendarData } from '../types'

const EQUITY_HYBRID = ['Equity', 'Hybrid']
const PASSIVE_SLUGS = ['index-fund', 'etf', 'gold-etf', 'fof-domestic', 'fof-overseas']
const MAIN_TAB_NAMES = ['Large Cap', 'Large & Mid Cap', 'Mid Cap', 'Small Cap', 'Flexi Cap',
  'Balanced Advantage', 'Multi Asset Allocation']
const GOOD_BG = 'rgba(52,211,153,0.14)'
const BAD_BG = 'rgba(248,113,113,0.14)'

export default function CalendarReturns() {
  const { data: meta } = useMeta()
  const [slug, setSlug] = useState('')
  const [query, setQuery] = useState('')
  const [sortYear, setSortYear] = useState<string | null>(null)

  const cats = (meta?.categories ?? []).filter(c => EQUITY_HYBRID.includes(c.asset_class) || PASSIVE_SLUGS.includes(c.slug))
  const active = slug || (cats[0]?.slug ?? '')
  const mainTabs = cats.filter(c => MAIN_TAB_NAMES.includes(c.category_name))
  const otherCats = cats.filter(c => !MAIN_TAB_NAMES.includes(c.category_name))
  const { data, loading, error } = useJson<CalendarData>(() => categoryPath(active, 'calendar.json'),
                                                         active ? `cal:${active}` : '')
  const years = useMemo(() => (data ? [...data.years].reverse() : []), [data])   // newest first
  const sortBy = sortYear && years.includes(sortYear) ? sortYear : years[1] ?? years[0]

  const funds = useMemo(() => {
    const hit = fuzzyMatcher(query)
    return (data?.funds ?? []).filter(f => hit(f.scheme_name)).sort((a, b) => {
      const va = a.returns[sortBy], vb = b.returns[sortBy]
      if (va == null) return vb == null ? a.scheme_name.localeCompare(b.scheme_name) : 1
      if (vb == null) return -1
      return vb - va
    })
  }, [data, query, sortBy])

  // Top / bottom quarter of the category in each year, over all its funds.
  const cuts = useMemo(() => {
    const out: Record<string, { lo: number; hi: number } | null> = {}
    for (const y of years) {
      const v = (data?.funds ?? []).map(f => f.returns[y]).filter((x): x is number => x != null).sort((a, b) => a - b)
      out[y] = v.length >= 4 ? { lo: v[Math.floor(0.25 * (v.length - 1))], hi: v[Math.floor(0.75 * (v.length - 1))] } : null
    }
    return out
  }, [data, years])

  const label = (y: string) => (data && y === data.ytd_year ? `${y} YTD` : y)

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const row = (name: string, r: Record<string, number | null>) => ({ fund: name, ...Object.fromEntries(years.map(y => [y, r[y] ?? null])) })
    return {
      sheet: 'Calendar Returns', title: `Calendar Year Returns - ${data.category_name}`,
      meta: [['Desk', desk.name], ['Category', data.category_name], ['Data as of', data.as_of],
             ['Returns', `31 Dec to 31 Dec; ${data.ytd_year} is year to date`]],
      columns: [{ key: 'fund', label: 'Fund', type: 'text', width: 46 },
                ...years.map(y => ({ key: y, label: label(y), type: 'percent' as const }))],
      rows: [row('Category average', data.category_average), ...funds.map(f => row(f.scheme_name, f.returns)),
             ...(data.benchmark ? [row(`Benchmark: ${data.benchmark.name ?? ''}`, data.benchmark.returns)] : [])],
      fileName: `${desk.code} Calendar Returns - ${data.category_name} - ${data.as_of}`,
    }
  }

  const cell = (y: string, v: number | null | undefined, shade: boolean) => {
    const c = cuts[y]
    const bg = shade && v != null && c ? (v >= c.hi ? GOOD_BG : v <= c.lo ? BAD_BG : undefined) : undefined
    return <td key={y} className={`ret-cell ${retColor(v ?? null)}`} style={{ background: bg }}>{fmtPct(v ?? null)}</td>
  }

  return (
    <section id="calendar-returns" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header"><span>Calendar Year Returns</span></div>

      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center flex-1 min-w-0">
          <div className="tab-bar">
            {mainTabs.map(c => {
              const col = categoryColor(c.slug, c.asset_class)
              const on = active === c.slug
              return (
                <button key={c.slug} onClick={() => setSlug(c.slug)} className={`tab-btn${on ? ' active' : ''}`}
                        style={on ? { color: col, background: `${col}1f` } : undefined}>{c.category_name}</button>
              )
            })}
          </div>
          {otherCats.length > 0 && (
            <select value={mainTabs.some(c => c.slug === active) ? '' : active}
                    onChange={e => { if (e.target.value) setSlug(e.target.value) }}
                    className="px-3 py-1.5 rounded-lg text-sm"
                    style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }}>
              <option value="" disabled>-- Other Categories --</option>
              {otherCats.map(c => <option key={c.slug} value={c.slug}>{c.category_name}</option>)}
            </select>
          )}
        </div>
        <DownloadButton build={buildExport} disabledHint="No funds in this category yet" />
      </div>

      <TableSearch value={query} onChange={setQuery} count={funds.length} total={data?.funds.length} />

      <div className="card overflow-hidden mb-4">
        {loading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
        ) : data ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
                  {years.map(y => (
                    <th key={y} onClick={() => setSortYear(y)} style={{ textAlign: 'right', cursor: 'pointer',
                        color: y === sortBy ? 'var(--accent-a)' : undefined }}
                        title={y === data.ytd_year ? `1 Jan ${y} to ${fmtDate(data.as_of)} — click to sort` : `31 Dec ${+y - 1} to 31 Dec ${y} — click to sort`}>
                      {label(y)}{y === sortBy ? ' ▼' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody key={active} className="rows-enter">
                <tr className="benchmark-row">
                  <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--text-mid)' }}>Category average</td>
                  {years.map(y => cell(y, data.category_average[y], false))}
                </tr>
                {funds.map(f => (
                  <tr key={f.scheme_code}>
                    <td className="sticky-col text-xs font-medium truncate" style={{ maxWidth: 260 }}>
                      <FundLink code={f.scheme_code} name={f.scheme_name} />
                    </td>
                    {years.map(y => cell(y, f.returns[y], true))}
                  </tr>
                ))}
                {data.benchmark && (
                  <tr className="benchmark-row">
                    <td className="sticky-col text-xs font-semibold truncate" style={{ color: 'var(--accent-a)' }}>
                      Benchmark · {data.benchmark.name}
                    </td>
                    {years.map(y => cell(y, data.benchmark!.returns[y], false))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center" style={{ color: 'var(--text-mid)' }}>
            {error ? <ComingFunds error={error} subject="rank" failedLabel="calendar returns" /> : 'No data for this category yet.'}
          </div>
        )}
      </div>

      <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
        <b style={{ color: 'var(--text-hi)' }}>How to read this.</b> Each column is one calendar year: the NAV on the last
        day of the previous year to the NAV on 31 December (the current year runs to the latest NAV and is marked YTD).
        Returns are absolute for that year, Regular plan, Growth option. <span style={{ background: GOOD_BG, padding: '0 4px' }}>Green</span> = top
        quarter of the category that year, <span style={{ background: BAD_BG, padding: '0 4px' }}>red</span> = bottom quarter. A fund that is
        green most years has been consistently good; one that swings between green and red depends on market phases.
        Blank = the fund did not exist for the whole year. Click a year to sort by it.
      </div>
    </section>
  )
}

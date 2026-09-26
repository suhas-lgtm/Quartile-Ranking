// src/sections/AumFlows.tsx — fund size over the last quarters, how it changed,
// and how much of that was money coming in or going out.
//
// From aum.json (build_json.build_aum): AMFI's quarterly average AUM, all plans
// of a fund together, and flow_1y = AUM change over a year minus the NAV change,
// i.e. the part the market does not explain.

import { useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { categoryColor } from '../config/categoryColors'
import { currentDesk } from '../config/products'
import { fmtPct, retColor } from '../utils/format'
import { fuzzyMatcher } from '../utils/fuzzy'
import DownloadButton from '../components/DownloadButton'
import FundLink from '../components/FundLink'
import TableSearch from '../components/TableSearch'
import type { SheetSpec } from '../utils/xlsx'
import type { AumData } from '../types'

const PAGE = 300
const crore = (v: number | null | undefined) => (v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'))

type SortKey = 'aum' | 'chg_1q' | 'chg_1y' | 'chg_3y' | 'flow_1y'

/** A small line of the AUM history, oldest on the left. */
function Spark({ values }: { values: (number | null)[] }) {
  const pts = [...values].reverse()
  const nums = pts.filter((v): v is number => v != null)
  if (nums.length < 2) return null
  const lo = Math.min(...nums), hi = Math.max(...nums), w = 90, h = 22
  const path = pts.map((v, i) => (v == null ? null : [i / (pts.length - 1) * w, h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)]))
    .filter((p): p is number[] => !!p).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const up = nums[nums.length - 1] >= nums[0]
  return <svg width={w} height={h}><path d={path} fill="none" stroke={up ? '#34D399' : '#F87171'} strokeWidth={1.5} /></svg>
}

export default function AumFlows() {
  const { data, loading, error } = useJson<AumData>('aum.json')
  const [view, setView] = useState<'funds' | 'categories'>('funds')
  const [cat, setCat] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'aum', dir: 'desc' })
  const [limit, setLimit] = useState(PAGE)

  const cats = useMemo(() => (data?.categories ?? []).slice().sort((a, b) => a.category_name.localeCompare(b.category_name)), [data])
  const funds = useMemo(() => {
    const hit = fuzzyMatcher(query)
    return (data?.funds ?? []).filter(f => (!cat || f.category_slug === cat) && hit(f.scheme_name)).sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      if (va == null) return vb == null ? 0 : 1
      if (vb == null) return -1
      return sort.dir === 'desc' ? vb - va : va - vb
    })
  }, [data, cat, query, sort])

  const q = data?.periods ?? []
  const latest = q[0]?.label ?? ''
  const yearAgo = q[4]?.label ?? ''
  const onSort = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  const th = (key: SortKey, text: string, title: string) => (
    <th onClick={() => onSort(key)} title={title}
        style={{ textAlign: 'right', cursor: 'pointer', color: sort.key === key ? 'var(--accent-a)' : undefined }}>
      {text}{sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  )

  const totalAum = (data?.categories ?? []).reduce((t, c) => t + (c.aum || 0), 0)
  const inflow = (data?.funds ?? []).filter(f => (f.flow_1y ?? 0) > 0.15).length
  const outflow = (data?.funds ?? []).filter(f => (f.flow_1y ?? 0) < -0.15).length

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    return {
      sheet: 'AUM & Flows', title: 'Fund AUM and estimated flows',
      meta: [['Desk', desk.name], ['Latest quarter', latest], ['Source', 'AMFI quarterly average AUM, all plans of each fund']],
      columns: [
        { key: 'fund', label: 'Fund', type: 'text', width: 46 }, { key: 'cat', label: 'Category', type: 'text', width: 24 },
        { key: 'aum', label: 'AUM (₹ Cr)', type: 'number' }, { key: 'q', label: 'Change 1Q', type: 'percent' },
        { key: 'y', label: 'Change 1Y', type: 'percent' }, { key: 'y3', label: 'Change 3Y', type: 'percent' },
        { key: 'f', label: 'Est. net flow 1Y', type: 'percent' },
        ...q.map((p, i) => ({ key: `h${i}`, label: p.label, type: 'number' as const })),
      ],
      rows: funds.map(f => ({ fund: f.scheme_name, cat: f.category_name, aum: f.aum, q: f.chg_1q, y: f.chg_1y, y3: f.chg_3y,
                              f: f.flow_1y, ...Object.fromEntries(f.history.map((v, i) => [`h${i}`, v])) })),
      fileName: `${desk.code} AUM and Flows - ${data.as_of}`,
    }
  }

  const sel = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

  return (
    <section id="aum-flows" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>AUM &amp; Flows</span>
        <span className="ml-auto"><DownloadButton build={buildExport} disabledHint="No data yet" /></span>
      </div>

      {loading ? (
        <div className="card p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
      ) : !data ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          {error ? 'AUM data is not available yet. It appears after the next data refresh.' : 'No data.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {[
              ['Funds tracked', String(data.funds.length), `AUM for ${latest}`],
              ['Their total AUM', crore(totalAum) + ' Cr', 'Quarterly average, all plans'],
              ['Strong inflows', String(inflow), 'Est. net inflow above 15% of AUM in a year'],
              ['Strong outflows', String(outflow), 'Est. net outflow above 15% of AUM in a year'],
            ].map(([l, v, s]) => (
              <div key={l} className="card p-3">
                <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{l}</div>
                <div className="font-display font-bold text-lg" style={{ color: 'var(--text-hi)' }}>{v}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{s}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="tab-bar">
              <button onClick={() => setView('funds')} className={`tab-btn${view === 'funds' ? ' active accent' : ''}`}>Funds</button>
              <button onClick={() => setView('categories')} className={`tab-btn${view === 'categories' ? ' active accent' : ''}`}>By category</button>
            </div>
            {view === 'funds' && (
              <select value={cat} onChange={e => { setCat(e.target.value); setLimit(PAGE) }} className="px-3 py-1.5 rounded-lg text-sm" style={sel}>
                <option value="">All categories</option>
                {cats.map(c => <option key={c.category_slug} value={c.category_slug}>{c.category_name}</option>)}
              </select>
            )}
          </div>

          {view === 'funds' ? (
            <>
              <TableSearch value={query} onChange={v => { setQuery(v); setLimit(PAGE) }} count={funds.length}
                           total={(data.funds ?? []).filter(f => !cat || f.category_slug === cat).length} />
              <div className="card overflow-hidden mb-4">
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                        {th('aum', 'AUM (₹ Cr)', `Average AUM for ${latest}, all plans of the fund`)}
                        {th('chg_1q', 'Change 1Q', 'AUM change from the previous quarter')}
                        {th('chg_1y', 'Change 1Y', `AUM change from ${yearAgo}`)}
                        {th('chg_3y', 'Change 3Y', `AUM change from ${q[q.length - 1]?.label ?? ''}`)}
                        {th('flow_1y', 'Est. net flow 1Y', 'Money in (+) or out (−) over the last year, as a share of AUM a year ago, after taking out the NAV change')}
                        <th style={{ textAlign: 'center' }} title={`${q[q.length - 1]?.label ?? ''} to ${latest}`}>Trend ({q.length}Q)</th>
                      </tr>
                    </thead>
                    <tbody className="rows-enter">
                      {funds.slice(0, limit).map(f => (
                        <tr key={f.scheme_code}>
                          <td className="sticky-col" style={{ maxWidth: 300 }}>
                            <div className="text-xs font-medium truncate"><FundLink code={f.scheme_code} name={f.scheme_name} /></div>
                            <div className="text-[10px] truncate" style={{ color: categoryColor(f.category_slug, f.asset_class) }}>{f.category_name}</div>
                          </td>
                          <td className="ret-cell font-semibold">{Math.round(f.aum).toLocaleString('en-IN')}</td>
                          <td className={`ret-cell ${retColor(f.chg_1q)}`}>{fmtPct(f.chg_1q)}</td>
                          <td className={`ret-cell ${retColor(f.chg_1y)}`}>{fmtPct(f.chg_1y)}</td>
                          <td className={`ret-cell ${retColor(f.chg_3y)}`}>{fmtPct(f.chg_3y)}</td>
                          <td className={`ret-cell font-semibold ${retColor(f.flow_1y)}`}
                              style={{ background: f.flow_1y != null && f.flow_1y < -0.15 ? 'rgba(248,113,113,0.14)'
                                                 : f.flow_1y != null && f.flow_1y > 0.15 ? 'rgba(52,211,153,0.14)' : undefined }}>
                            {fmtPct(f.flow_1y)}
                          </td>
                          <td style={{ textAlign: 'center' }}
                              title={f.history.map((v, i) => `${q[i]?.label}: ${crore(v)} Cr`).join('\n')}>
                            <Spark values={f.history} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {funds.length > limit && (
                  <div className="p-3 text-center">
                    <button onClick={() => setLimit(l => l + PAGE)} className="tab-btn active accent">
                      Show {Math.min(PAGE, funds.length - limit)} more ({funds.length - limit} not shown)
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="card overflow-hidden mb-4">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky-col text-left" style={{ minWidth: 220 }}>Category</th>
                      <th style={{ textAlign: 'right' }}>Funds</th>
                      <th style={{ textAlign: 'right' }}>AUM (₹ Cr)</th>
                      <th style={{ textAlign: 'right' }}>Change 1Y</th>
                      <th style={{ textAlign: 'right' }}>Share</th>
                      <th style={{ textAlign: 'center' }}>Trend ({q.length}Q)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.map(c => (
                      <tr key={c.category_slug} style={{ cursor: 'pointer' }} onClick={() => { setCat(c.category_slug); setView('funds') }}
                          title="Click to see this category's funds">
                        <td className="sticky-col text-xs font-medium" style={{ color: categoryColor(c.category_slug, c.asset_class) }}>{c.category_name}</td>
                        <td className="ret-cell">{c.funds}</td>
                        <td className="ret-cell font-semibold">{Math.round(c.aum).toLocaleString('en-IN')}</td>
                        <td className={`ret-cell ${retColor(c.chg_1y)}`}>{fmtPct(c.chg_1y)}</td>
                        <td className="ret-cell">{totalAum ? ((c.aum / totalAum) * 100).toFixed(1) + '%' : '—'}</td>
                        <td style={{ textAlign: 'center' }}><Spark values={c.history} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
            <b style={{ color: 'var(--text-hi)' }}>What the columns mean.</b>
            <ul className="mt-1 space-y-1 list-disc pl-4">
              <li><b>AUM</b> — the fund&apos;s average assets for {latest} (AMFI quarterly average), all plans and options together, in ₹ crore.</li>
              <li><b>Change 1Q / 1Y / 3Y</b> — how much the AUM changed from one quarter, four quarters and {q.length - 1} quarters ago. This mixes two things: the market moving the NAV, and money coming in or going out.</li>
              <li><b>Est. net flow 1Y</b> — only the money part: AUM change over the year minus the fund&apos;s NAV change over the same year.
                +20% = investors added about a fifth of the fund&apos;s size beyond what the market did; −20% = they took a fifth out.
                <span style={{ background: 'rgba(52,211,153,0.14)', padding: '0 4px' }}>Green</span> above +15%, <span style={{ background: 'rgba(248,113,113,0.14)', padding: '0 4px' }}>red</span> below −15%. It is an estimate: AMFI publishes quarterly averages, so a fund that grew or shrank sharply inside a quarter is approximate.</li>
              <li><b>Trend</b> — AUM over the last {q.length} quarters, oldest on the left; green if it ended higher. Hover for the numbers.</li>
              <li>A fund steadily losing money while its category gains is a warning sign — the Blacklist has an <b>Outflows</b> rule for it.</li>
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

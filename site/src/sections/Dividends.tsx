// src/sections/Dividends.tsx — IDCW (dividend) payouts per fund.
//
// From dividends.json (scripts/dividends.py): payouts are DERIVED by comparing
// each fund's IDCW NAV with its Growth NAV — on a record date the IDCW NAV
// falls by the payout while the Growth NAV does not. AMFI's own dividend feed
// is empty, so this is the only automatic source; accurate to about a paisa.

import { Fragment, useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { categoryColor } from '../config/categoryColors'
import { currentDesk } from '../config/products'
import { fmtDate, fmtPct } from '../utils/format'
import { fuzzyMatcher } from '../utils/fuzzy'
import DownloadButton from '../components/DownloadButton'
import FundLink from '../components/FundLink'
import TableSearch from '../components/TableSearch'
import type { SheetSpec } from '../utils/xlsx'

interface Payout { date: string; amount: number; pct: number }
interface DivFund {
  scheme_code: string; idcw_code: string; scheme_name: string
  category_name: string; category_slug: string; asset_class: string
  idcw_nav: number; idcw_nav_date: string
  payouts: Payout[]; count_12m: number; total_12m: number; yield_12m: number | null
  last_payout: Payout | null
}
interface DivData { built: string; years: number; min_gap: number; funds: DivFund[] }

type SortKey = 'yield_12m' | 'total_12m' | 'count_12m' | 'last'

function frequency(f: DivFund): string {
  const n = f.count_12m
  if (!n) return f.payouts.length ? 'None in 12M' : 'Never'
  if (n >= 11) return 'Monthly'
  if (n >= 3) return 'Quarterly'
  if (n === 2) return 'Half-yearly'
  return 'Yearly'
}

export default function Dividends() {
  const { data, loading, error } = useJson<DivData>('dividends.json')
  const [cat, setCat] = useState('dividend-yield')
  const [query, setQuery] = useState('')
  const [onlyPaying, setOnlyPaying] = useState(true)
  const [sort, setSort] = useState<SortKey>('yield_12m')
  const [open, setOpen] = useState<string | null>(null)

  const cats = useMemo(() => [...new Map((data?.funds ?? []).map(f => [f.category_slug, f.category_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [data])
  const activeCat = cats.some(([s]) => s === cat) ? cat : ''
  const funds = useMemo(() => {
    const hit = fuzzyMatcher(query)
    const key = (f: DivFund) => sort === 'last' ? (f.last_payout?.date ?? '') : (f[sort] ?? -1)
    return (data?.funds ?? [])
      .filter(f => (!activeCat || f.category_slug === activeCat) && (!onlyPaying || f.count_12m > 0) && hit(f.scheme_name))
      .sort((a, b) => { const ka = key(a), kb = key(b); return ka < kb ? 1 : ka > kb ? -1 : 0 })
  }, [data, activeCat, query, onlyPaying, sort])

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const f of funds) for (const p of [...f.payouts].reverse())
      rows.push({ fund: f.scheme_name, cat: f.category_name, date: p.date, amount: p.amount, pct: p.pct })
    return {
      sheet: 'Dividends', title: 'IDCW payouts (derived from NAVs)',
      meta: [['Desk', desk.name], ['Method', 'IDCW NAV drop beyond the Growth NAV move on the same day'],
             ['History', `${data.years} years`]],
      columns: [{ key: 'fund', label: 'Fund', type: 'text', width: 46 }, { key: 'cat', label: 'Category', type: 'text', width: 22 },
                { key: 'date', label: 'Record date', type: 'text', width: 12 }, { key: 'amount', label: '₹ per unit', type: 'number' },
                { key: 'pct', label: '% of NAV', type: 'percent' }],
      rows, fileName: `${desk.code} Dividends`,
    }
  }

  const th = (k: SortKey, label: string, title: string) => (
    <th onClick={() => setSort(k)} title={`${title}. Click to sort.`}
        style={{ textAlign: 'right', cursor: 'pointer', color: sort === k ? 'var(--accent-a)' : undefined }}>
      {label}{sort === k ? ' ▼' : ''}
    </th>
  )
  const sel = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }

  return (
    <section id="dividends" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Dividends (IDCW)</span>
        <span className="ml-auto"><DownloadButton build={buildExport} disabledHint="No data yet" /></span>
      </div>

      {loading ? (
        <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
      ) : !data ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          {error ? 'Dividend data is not available yet. It appears after the next data refresh.' : 'No data.'}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
            <select value={activeCat} onChange={e => setCat(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm" style={sel}>
              <option value="">All categories</option>
              {cats.map(([s, n]) => <option key={s} value={s}>{n}</option>)}
            </select>
            <label className="flex items-center gap-1.5" style={{ color: 'var(--text-mid)' }}>
              <input type="checkbox" checked={onlyPaying} onChange={e => setOnlyPaying(e.target.checked)} />
              Only funds that paid in the last 12 months
            </label>
          </div>
          <TableSearch value={query} onChange={setQuery} count={funds.length} total={data.funds.length} />
          <div className="card overflow-hidden mb-4">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col text-left" style={{ minWidth: 280 }}>Fund</th>
                    <th style={{ textAlign: 'right' }} title="The IDCW option's latest NAV">IDCW NAV</th>
                    {th('last', 'Last payout', 'Most recent record date and amount per unit')}
                    {th('count_12m', 'Payouts 12M', 'How many payouts in the last 12 months')}
                    <th style={{ textAlign: 'left' }}>Frequency</th>
                    {th('total_12m', '₹/unit 12M', 'Total paid per unit in the last 12 months')}
                    {th('yield_12m', 'Yield 12M', 'Last 12 months’ payouts ÷ the current IDCW NAV')}
                    <th style={{ textAlign: 'right' }}>History</th>
                  </tr>
                </thead>
                <tbody>
                  {funds.map(f => (
                    <Fragment key={f.scheme_code}>
                      <tr>
                        <td className="sticky-col" style={{ maxWidth: 320 }}>
                          <div className="text-xs font-medium truncate"><FundLink code={f.scheme_code} name={f.scheme_name} /></div>
                          <div className="text-[10px] truncate" style={{ color: categoryColor(f.category_slug, f.asset_class) }}>{f.category_name}</div>
                        </td>
                        <td className="ret-cell">{f.idcw_nav.toFixed(4)}</td>
                        <td className="ret-cell text-xs">
                          {f.last_payout ? <>≈₹{f.last_payout.amount.toFixed(2)}<div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fmtDate(f.last_payout.date)}</div></> : '—'}
                        </td>
                        <td className="ret-cell">{f.count_12m}</td>
                        <td className="text-xs" style={{ color: 'var(--text-mid)' }}>{frequency(f)}</td>
                        <td className="ret-cell font-semibold">{f.total_12m ? `≈₹${f.total_12m.toFixed(2)}` : '—'}</td>
                        <td className="ret-cell font-semibold" style={{ color: 'var(--accent-a)' }}>{f.yield_12m ? fmtPct(f.yield_12m) : '—'}</td>
                        <td className="ret-cell">
                          {f.payouts.length > 0 && (
                            <button onClick={() => setOpen(open === f.scheme_code ? null : f.scheme_code)} className="text-[11px]"
                                    style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              {open === f.scheme_code ? 'Hide' : `${f.payouts.length} payouts ▾`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === f.scheme_code && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--bg-raised)' }}>
                            <div className="flex flex-wrap gap-2 p-2">
                              {[...f.payouts].reverse().map(p => (
                                <span key={p.date} className="text-[11px] px-2 py-1 rounded" style={{ border: '1px solid var(--line)' }}>
                                  {fmtDate(p.date)} · <b>≈₹{p.amount.toFixed(2)}</b> <span style={{ color: 'var(--text-low)' }}>({fmtPct(p.pct)})</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
            <b style={{ color: 'var(--text-hi)' }}>How payouts are found.</b> AMFI&apos;s dividend feed is empty, so payouts are
            worked out from NAVs: a fund&apos;s IDCW and Growth options hold the same portfolio, so on a normal day both NAVs move
            by the same percentage; on a record date the IDCW NAV also drops by the payout. The drop beyond the Growth move is the
            payout per unit — shown with ≈ because it is worked out, not the AMC's declared figure (usually within about a paisa). Regular plan, last {data.years} years. <b>Yield 12M</b> = payouts in the
            last 12 months ÷ today&apos;s IDCW NAV. A payout comes out of the fund&apos;s own NAV — it is not extra return.
          </div>
        </>
      )}
    </section>
  )
}

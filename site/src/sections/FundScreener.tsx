// src/sections/FundScreener.tsx — every return and ratio for the funds you pick.
//
// Not a portfolio: no amounts, no weights. Pick any funds from any category
// (one by one, or a whole category at once) and each gets its own row with the
// same columns as Risk & Returns — trailing returns, SIP returns, rolling
// returns, Alpha, Beta, Sharpe, Sortino, Std Dev, captures, Max DD, AUM.
// Green / red shading compares each fund with its own category, as there.
// Optionally each category's average and benchmark sit under its funds.
//
// Numbers come from each fund's category file (risk.json); funds whose category
// has none (debt) are worked out here from their own NAVs (utils/seriesStats),
// without the benchmark-relative ratios. Lists of funds are saved by name on
// the server, so the team can reopen them on any computer (utils/savedClients).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import FundPicker from '../components/FundPicker'
import FundLink from '../components/FundLink'
import DownloadButton from '../components/DownloadButton'
import { PdfButton, PdfProvider, PdfSection } from '../components/PdfSections'
import { useRiskFiles } from '../components/PortfolioReview'
import { adjustSplits, type NavSeries } from '../components/CorrelationMatrix'
import { RETURN_COLS, RATIO_COLS, FACT_COLS, SIP_COLS, ROLL_COLS, cutoffs, tint, type Col } from './RiskReturns'
import { seriesStats } from '../utils/seriesStats'
import { useSavedClients } from '../utils/savedClients'
import { categoryColor } from '../config/categoryColors'
import { currentDesk } from '../config/products'
import { retColor } from '../utils/format'
import type { SheetSpec } from '../utils/xlsx'
import type { FundsIndex, RiskData, RiskFundRow } from '../types'

type View = 'all' | 'returns' | 'sip' | 'rolling' | 'ratios'
interface List { codes: string[] }
interface Store { current: string; lists: Record<string, List> }
const STORE = 'fs_lists_v1'
const EMPTY: List = { codes: [] }
const PASSIVE = ['index-fund', 'etf', 'gold-etf', 'fof-domestic', 'fof-overseas']
const ALL_COLS = [...RETURN_COLS, ...SIP_COLS, ...ROLL_COLS, ...RATIO_COLS, ...FACT_COLS]
const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

function load(): Store {
  try { const s = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (s?.lists) return s } catch { /* none */ }
  return { current: '', lists: { '': EMPTY } }
}

/** The PDF's column groups (components/PdfSections) for a column. */
const pdfClass = (c: Col) => c.key === 'aum_cr' ? 'col-aum' : c.group === 'returns' ? 'col-ret' : c.group === 'sip' ? 'col-sip' : 'col-ratio'

export default function FundScreener() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundBy = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [store, setStore] = useState<Store>(load)
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(store)) } catch { /* optional */ } }, [store])
  const cur = store.lists[store.current] ?? EMPTY
  const codes = cur.codes
  const setCodes = (next: string[]) => setStore(s => ({ ...s, lists: { ...s.lists, [s.current]: { codes: next } } }))
  const [pick, setPick] = useState('')
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [refs, setRefs] = useState(false)
  const [name, setName] = useState('')

  // Saved lists, shared by the team.
  const putLocal = useCallback((n: string, data: List) => setStore(s => ({ current: n, lists: { ...s.lists, [n]: data } })), [])
  const dropLocal = useCallback((n: string) => setStore(s => {
    const lists = { ...s.lists }; delete lists[n]
    return { current: s.current === n ? '' : s.current, lists: { '': EMPTY, ...lists } }
  }), [])
  const cloud = useSavedClients({ kind: 'fund-screener', current: store.current, local: store.lists, putLocal, dropLocal })
  const saveAs = () => {
    const n = (name || store.current).trim()
    if (!n) { window.alert('Give the list a name first.'); return }
    setStore(s => ({ current: n, lists: { ...s.lists, [n]: { codes }, ...(s.current === '' ? { '': EMPTY } : {}) } }))
    cloud.save(n, { codes })
    setName('')
  }

  // Each fund's row: from its category's file, else worked out from its NAVs.
  const slugs = codes.map(c => fundBy.get(c)?.s).filter((x): x is string => !!x)
  const files = useRiskFiles(slugs)
  const rf = Object.values(files).find(f => f?.risk_free_rate != null)?.risk_free_rate ?? meta?.risk_free_rate ?? 0.065
  const asOf = Object.values(files).map(f => f?.as_of).filter((x): x is string => !!x).sort().slice(-1)[0] ?? meta?.as_of ?? null
  const published = (c: string): RiskFundRow | undefined => {
    const slug = fundBy.get(c)?.s
    return slug ? files[slug]?.funds.find(f => f.scheme_code === c) : undefined
  }
  // Categories with a published file: equity, hybrid and the passive ones (as in Risk & Returns).
  const hasFile = (slug: string | undefined) => {
    const cat = meta?.categories.find(c => c.slug === slug)
    return !!cat && (cat.asset_class === 'Equity' || cat.asset_class === 'Hybrid' || PASSIVE.includes(cat.slug))
  }
  const needSeries = meta ? codes.filter(c => { const slug = fundBy.get(c)?.s; return !hasFile(slug) || (files[slug!] && !published(c)) }) : []
  const [series, setSeries] = useState<Record<string, NavSeries | null>>({})
  useEffect(() => {
    for (const c of needSeries) {
      if (c in series) continue
      setSeries(s => ({ ...s, [c]: null }))
      fetch(`/api/series?code=${c}`).then(r => (r.ok ? r.json() : null)).then(d => d && setSeries(s => ({ ...s, [c]: d }))).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needSeries.join(',')])
  const rowOf = (c: string): RiskFundRow | null => {
    const p = published(c)
    if (p) return p
    const sr = series[c]
    if (!sr?.points?.length) return null
    const st = seriesStats(adjustSplits(sr), rf, asOf)
    if (!st) return null
    return {
      scheme_code: c, scheme_name: fundBy.get(c)?.n ?? c,
      returns: st.returns as RiskFundRow['returns'], sip: st.sip as RiskFundRow['sip'],
      std_annual: st.std_annual, sharpe: st.sharpe, sortino: st.sortino, max_drawdown: st.max_drawdown,
      alpha: null, beta: null, upside_capture: null, downside_capture: null, composite_score: null, recovery_days: null,
    }
  }

  // Shading: each fund against its own category (as in Risk & Returns).
  const cuts = useMemo(() => {
    const out: Record<string, Record<string, ReturnType<typeof cutoffs>>> = {}
    for (const [slug, f] of Object.entries(files)) {
      if (!f) continue
      out[slug] = {}
      for (const c of ALL_COLS) out[slug][c.key] = cutoffs(f.funds.map(r => c.get(r)).filter((v): v is number => v != null))
    }
    return out
  }, [files])

  const cols = view === 'returns' ? RETURN_COLS : view === 'ratios' ? [...RATIO_COLS, ...FACT_COLS]
    : view === 'sip' ? SIP_COLS : view === 'rolling' ? ROLL_COLS : ALL_COLS
  const rows = codes.map(c => ({ c, f: fundBy.get(c), r: rowOf(c), own: !!published(c) }))
  const sortCol = sort ? ALL_COLS.find(c => c.key === sort.key) : undefined
  const sorted = sortCol ? [...rows].sort((a, b) => {
    const va = a.r ? sortCol.get(a.r) : null, vb = b.r ? sortCol.get(b.r) : null
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return sort!.dir === 'desc' ? vb - va : va - vb
  }) : rows
  // With the category rows on, funds sit together by category, its average and benchmark under them.
  const groups = refs
    ? [...new Set(sorted.map(x => x.f?.s ?? ''))].map(slug => ({ slug, items: sorted.filter(x => (x.f?.s ?? '') === slug) }))
    : [{ slug: '', items: sorted }]
  const onSort = (key: string) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  const addCategory = (slug: string) => {
    const add = (index?.funds ?? []).filter(f => f.s === slug).map(f => f.c).filter(c => !codes.includes(c))
    if (add.length > 60 && !window.confirm(`Add all ${add.length} funds of this category?`)) return
    setCodes([...codes, ...add])
  }

  const cell = (c: Col, r: Parameters<Col['get']>[0] | null, slug: string, coloured = true) => {
    const v = r ? c.get(r) : null
    const cls = c.group === 'returns' || c.group === 'sip' || c.key === 'alpha' || /^roll_.*_(avg|min)$/.test(c.key) ? retColor(v ?? null) : ''
    return (
      <td key={c.key} className={`ret-cell ${cls} ${pdfClass(c)}`}
          style={{ background: coloured ? tint(v, c.better, cuts[slug]?.[c.key]) : undefined }}>
        {r ? c.show(v) : '…'}
      </td>
    )
  }

  const buildExport = (): SheetSpec | null => {
    if (!rows.length) return null
    const out: SheetSpec['rows'] = []
    const line = (fund: string, category: string, r: Parameters<Col['get']>[0] | null) => {
      const o: SheetSpec['rows'][number] = { fund, category }
      for (const c of cols) o[c.key] = r ? c.get(r) ?? null : null
      return o
    }
    for (const g of groups) {
      const file: RiskData | null | undefined = g.slug ? files[g.slug] : null
      for (const x of g.items) out.push(line(x.f?.n ?? x.c, x.f?.k ?? '', x.r))
      if (refs && file) {
        out.push(line(`Category average — ${file.category_name}`, file.category_name, file.category_average))
        if (file.benchmark && view !== 'ratios' && view !== 'rolling') out.push(line(`Benchmark — ${file.benchmark.name ?? ''}`, file.category_name, { returns: file.benchmark.returns, sip: file.benchmark.sip }))
      }
    }
    return {
      sheet: 'Fund Screener', title: `Fund Screener${store.current ? ` - ${store.current}` : ''}`,
      meta: [['Desk', currentDesk().name], ['Funds', String(rows.length)], ['Data as of', asOf ?? '']],
      columns: [{ key: 'fund', label: 'Fund Name', type: 'text', width: 46 }, { key: 'category', label: 'Category', type: 'text', width: 24 },
                ...cols.map(c => ({ key: c.key, label: c.label, type: c.exportType }))],
      rows: out,
      fileName: `Fund Screener${store.current ? ` - ${store.current}` : ''} - ${asOf ?? ''}`,
    }
  }

  const cats = (meta?.categories ?? []).filter(c => (index?.funds ?? []).some(f => f.s === c.slug))

  return (
    <PdfProvider pageKey="fund-screener" doc={{
      kicker: 'Fund research', title: 'Fund Screener', client: store.current || undefined,
      stats: [{ label: 'Funds', value: String(rows.length) }, { label: 'Categories', value: String(new Set(rows.map(x => x.f?.s)).size) },
              { label: 'Data as of', value: asOf ?? '—' }],
    }}>
    <section id="fund-screener" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Fund Screener</span>
        <span className="ml-auto flex items-center gap-2 text-xs print:hidden">
          <select value={store.current} onChange={e => { const v = e.target.value; setStore(s => ({ ...s, current: v })); cloud.open(v) }}
                  className="px-2 py-1 rounded text-xs" style={inputStyle}>
            <option value="">New list</option>
            {cloud.names.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={store.current || 'List name'}
                 className="px-2 py-1 rounded text-xs" style={{ ...inputStyle, width: 140 }} />
          <button className="tab-btn" onClick={saveAs}>Save list</button>
          {store.current ? (
            <button className="tab-btn" onClick={() => { if (window.confirm(`Delete the list "${store.current}"? It is removed for the whole team.`)) cloud.remove(store.current) }}>Delete</button>
          ) : codes.length > 0 && (
            <button className="tab-btn" onClick={() => { if (window.confirm('Clear all funds from this list?')) setCodes([]) }}>Clear</button>
          )}
          <PdfButton title={store.current || 'Fund Screener'} />
        </span>
      </div>
      <p className="text-xs -mt-2 mb-3 print:hidden" style={{ color: 'var(--text-mid)' }}>
        Pick any funds from any category — each gets its own row with every return and ratio. Not a portfolio: no amounts, no weights.
        {' '}{cloud.status === 'offline' ? 'Lists server not reachable — saving in this browser only.' : cloud.note ?? 'Saved lists are shared by the team and open on any computer.'}
      </p>

      {/* ── choose funds ── */}
      <div className="card p-4 mb-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[280px]">
            <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick} exclude={codes}
                        onPick={f => { setCodes([...codes, f.c]); setPick('') }}
                        placeholder="Add a fund — type any part of its name…" style={inputStyle} />
          </div>
          <select value="" onChange={e => { if (e.target.value) addCategory(e.target.value) }} className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle}>
            <option value="">+ Add a whole category…</option>
            {cats.map(c => <option key={c.slug} value={c.slug}>{c.category_name}</option>)}
          </select>
        </div>
        {codes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {codes.map(c => (
              <span key={c} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                    style={{ border: `1px solid ${categoryColor(fundBy.get(c)?.s ?? '')}66`, color: 'var(--text-hi)' }}>
                {fundBy.get(c)?.n ?? c}
                <button onClick={() => setCodes(codes.filter(x => x !== c))} title="Remove"
                        style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {codes.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Add funds above to see their returns and ratios.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap print:hidden">
            <div className="tab-bar flex items-center gap-2">
              {([['all', 'All'], ['returns', 'Returns'], ['sip', 'SIP Returns'], ['rolling', 'Rolling'], ['ratios', 'Ratios']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)} className={`tab-btn${view === v ? ' active accent' : ''}`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-mid)' }}>
                <input type="checkbox" checked={refs} onChange={() => setRefs(!refs)} /> Show category average &amp; benchmark
              </label>
              <DownloadButton build={buildExport} disabledHint="Add funds first" />
            </div>
          </div>
          <PdfSection id="table" page label="Returns & ratios, fund by fund" kicker="Fund by fund" title="Returns &amp; Ratios">
          <div className="card overflow-hidden mb-3">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
                    {cols.map(c => {
                      const on = sort?.key === c.key
                      return (
                        <th key={c.key} title={c.help} onClick={() => onSort(c.key)} className={pdfClass(c)}
                            style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', color: on ? 'var(--accent-a)' : undefined }}>
                          {c.label}{on ? (sort!.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                        </th>
                      )
                    })}
                    <th className="print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => {
                    const file = g.slug ? files[g.slug] : null
                    return [
                      ...(refs ? [
                        <tr key={`h-${g.slug}`}>
                          <td className="sticky-col text-xs font-bold" colSpan={1} style={{ color: categoryColor(g.slug) }}>
                            {file?.category_name ?? fundBy.get(g.items[0]?.c ?? '')?.k ?? 'Other'}
                          </td>
                          <td colSpan={cols.length + 1} />
                        </tr>,
                      ] : []),
                      ...g.items.map(x => (
                        <tr key={x.c}>
                          <td className="sticky-col text-xs font-medium" style={{ maxWidth: 280 }}>
                            <div className="truncate"><FundLink code={x.c} name={x.f?.n ?? x.c} /></div>
                            <div className="text-[10px] font-normal truncate" style={{ color: categoryColor(x.f?.s ?? '') }}>
                              {x.f?.k}{x.r && !x.own ? ' · from its NAVs (no benchmark ratios)' : ''}
                            </div>
                          </td>
                          {cols.map(c => cell(c, x.r, x.f?.s ?? ''))}
                          <td className="print:hidden" style={{ width: 28 }}>
                            <button onClick={() => setCodes(codes.filter(y => y !== x.c))} title="Remove"
                                    style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                          </td>
                        </tr>
                      )),
                      ...(refs && file ? [
                        <tr key={`a-${g.slug}`} className="benchmark-row">
                          <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--text-mid)' }}>Category average</td>
                          {cols.map(c => cell(c, file.category_average, g.slug, false))}<td className="print:hidden" />
                        </tr>,
                        // The benchmark has returns only: no row in the Ratios and Rolling views.
                        ...(file.benchmark && view !== 'ratios' && view !== 'rolling' ? [
                          <tr key={`b-${g.slug}`} className="benchmark-row">
                            <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--accent-a)' }}>Benchmark · {file.benchmark.name}</td>
                            {cols.map(c => cell(c, { returns: file.benchmark!.returns, sip: file.benchmark!.sip }, g.slug, false))}<td className="print:hidden" />
                          </tr>,
                        ] : []),
                      ] : []),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] mb-6" style={{ color: 'var(--text-low)' }}>
            Returns up to 1Y absolute, beyond that annualised. Ratios over the last 3 years. Green / red = top / bottom quarter of the fund&apos;s
            own category. Click a column to sort; hover a heading for what it means.{asOf ? ` Data as of ${asOf}.` : ''}
          </p>
          </PdfSection>
        </>
      )}
    </section>
    </PdfProvider>
  )
}

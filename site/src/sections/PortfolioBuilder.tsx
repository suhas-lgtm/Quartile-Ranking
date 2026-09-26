// src/sections/PortfolioBuilder.tsx — what a portfolio of up to 15 funds,
// bought on chosen dates, would be worth on another date.
//
// Each fund starts with one purchase on the portfolio's start date for the
// default amount; either can be overridden and up to three purchases added.
// Units bought = amount / NAV on or before the purchase date; value = units x
// NAV on or before the end date, adjusted for unit splits in between. XIRR uses
// every purchase as an outflow and the end value as the inflow. NAVs come from
// /api/nav (server/navLookup.ts). Saved in this browser.

import { useEffect, useMemo, useState } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, retColor } from '../utils/format'
import { monthlyDates, splitFactorBetween, useNavLookup, xirr } from '../utils/navMath'
import { openPortfolioReport } from '../utils/portfolioReport'
import type { SheetSpec } from '../utils/xlsx'
import type { FundsIndex } from '../types'
import FundLink from '../components/FundLink'

const MAX_FUNDS = 15
const MAX_BUYS = 3
const STORE_KEY = 'pb_portfolio_v1'

/** A purchase; null amount/date means "use the portfolio default". */
interface Buy { amount: number | null; date: string | null }
/** A monthly SIP: one instalment a month from start to end (defaults: portfolio dates). */
interface Sip { amount: number | null; start: string | null; end: string | null }
interface Holding { code: string; buys: Buy[]; sip?: Sip | null }
interface Portfolio { start: string; end: string; amount: number | null; sipAmount?: number | null; holdings: Holding[]
                    /** Loaded with "Load demo": the report is watermarked DEMO. */
                    demo?: boolean }

/** Five well-known funds across categories, with a mix of lump sums and a SIP. */
const DEMO: Portfolio = {
  demo: true, start: '2024-01-01', end: '', amount: 100000, sipAmount: 10000,
  holdings: [
    { code: '108466', buys: [{ amount: 100000, date: '2024-01-01' }, { amount: 50000, date: '2025-03-03' }] },
    { code: '122640', buys: [{ amount: 100000, date: '2024-01-01' }], sip: { amount: 10000, start: '2024-01-05', end: null } },
    { code: '105758', buys: [{ amount: 100000, date: '2024-01-01' }] },
    { code: '113177', buys: [{ amount: 75000, date: '2024-01-01' }] },
    { code: '100119', buys: [{ amount: 100000, date: '2024-01-01' }, { amount: 25000, date: '2025-06-02' }] },
  ],
}

/** Nothing preset: the user enters every amount and date. */
/** An emptied box means "not entered", not ₹0. */
const toAmount = (v: string) => (v.trim() === '' ? null : Math.max(0, parseFloat(v) || 0))

const BLANK: Portfolio = { start: '', end: '', amount: null, sipAmount: null, holdings: [] }

const inr = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })

function loadPortfolio(): Portfolio | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const saved: Portfolio | null = raw ? JSON.parse(raw) : null
    // An empty saved portfolio only carries the old preset defaults: start blank.
    return saved && saved.holdings?.length ? saved : null
  } catch {
    return null
  }
}

export default function PortfolioBuilder() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const latest = meta?.as_of ?? ''
  const [pf, setPf] = useState<Portfolio>(() => loadPortfolio() ?? BLANK)
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const end = pf.end || latest

  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(pf)) } catch { /* optional */ } }, [pf])

  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const labelOf = (f: FundsIndex['funds'][number]) => `${f.n} — ${f.k}`
  const codeByLabel = useMemo(() => new Map((index?.funds ?? []).map(f => [labelOf(f), f.c])), [index])

  const buyDate = (b: Buy) => b.date || pf.start
  const buyAmount = (b: Buy) => (b.amount ?? pf.amount ?? 0)
  const sipAmount = (h: Holding) => h.sip?.amount ?? pf.sipAmount ?? 0
  const sipDates = (h: Holding) => {
    if (!h.sip || !end || !(h.sip.start || pf.start)) return []
    const to = h.sip.end && h.sip.end < end ? h.sip.end : end
    return monthlyDates(h.sip.start || pf.start, to, 120)
  }
  const codes = useMemo(() => pf.holdings.map(h => h.code), [pf.holdings])
  const dates = useMemo(() => {
    const s = new Set<string>()
    for (const h of pf.holdings) {
      for (const b of h.buys) if (buyDate(b)) s.add(buyDate(b))
      for (const d of sipDates(h)) s.add(d)
    }
    if (end) s.add(end)
    return [...s]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf, end])
  const { data: navs, loading, error } = useNavLookup(end ? codes : [], dates)

  const results = useMemo(() => pf.holdings.map(h => {
    const n = navs?.[h.code]
    const endNav = n?.at[end] ?? null
    let invested = 0, value = 0
    const flows: { date: string; amount: number }[] = []
    const buys = h.buys.map(b => {
      const d = buyDate(b), amt = buyAmount(b)
      const nav = n?.at[d] ?? null
      if (!d || !(amt > 0) || !n || !nav || !endNav || d > end) {
        const why = !d ? 'enter a date' : !(amt > 0) ? 'enter an amount' : !n ? 'loading' : d > end ? 'after end date'
          : !nav ? (n.first_date && d < n.first_date ? `launched ${fmtDate(n.first_date)}` : 'no NAV') : 'no end NAV'
        return { d, amt, nav, units: null as number | null, val: null as number | null, why }
      }
      const units = amt / nav.nav
      const val = units * endNav.nav * splitFactorBetween(n.splits, nav.date, endNav.date)
      invested += amt; value += val
      flows.push({ date: d, amount: -amt })
      return { d, amt, nav, units, val, why: null as string | null }
    })
    // SIP instalments: each buys units at that day's NAV; instalments before the
    // fund launched (or with no NAV) are skipped and counted.
    const sip = { count: 0, skipped: 0, invested: 0, units: 0, value: 0 }
    const sipAmt = sipAmount(h)
    if (h.sip && n && endNav && sipAmt > 0) {
      for (const d of sipDates(h)) {
        const nav = n.at[d]
        if (!nav) { sip.skipped++; continue }
        const units = sipAmt / nav.nav
        const val = units * endNav.nav * splitFactorBetween(n.splits, nav.date, endNav.date)
        sip.count++; sip.invested += sipAmt; sip.value += val
        sip.units += units * splitFactorBetween(n.splits, nav.date, endNav.date)
        invested += sipAmt; value += val
        flows.push({ date: d, amount: -sipAmt })
      }
    }
    if (value > 0) flows.push({ date: end, amount: value })
    return { h, name: fundByCode.get(h.code)?.n ?? h.code, cat: fundByCode.get(h.code), endNav, buys, sip,
             invested, value, gain: value - invested,
             ret: invested ? value / invested - 1 : null, irr: flows.length > 1 ? xirr(flows) : null, flows }
  }), [pf, navs, end, fundByCode])

  const tot = useMemo(() => {
    const invested = results.reduce((s, r) => s + r.invested, 0)
    const value = results.reduce((s, r) => s + r.value, 0)
    const flows = results.flatMap(r => r.flows.filter(f => f.amount < 0))
    if (value > 0) flows.push({ date: end, amount: value })
    return { invested, value, gain: value - invested, ret: invested ? value / invested - 1 : null,
             irr: flows.length > 1 ? xirr(flows) : null }
  }, [results, end])

  const addFund = () => {
    const code = codeByLabel.get(pick)
    if (!code) { setMsg('Pick a fund from the list.'); return }
    if (pf.holdings.some(h => h.code === code)) { setMsg('That fund is already in the portfolio.'); return }
    if (pf.holdings.length >= MAX_FUNDS) { setMsg(`Up to ${MAX_FUNDS} funds.`); return }
    setPf({ ...pf, holdings: [...pf.holdings, { code, buys: [{ amount: null, date: null }] }] })
    setPick(''); setMsg(null)
  }
  const updateBuy = (hi: number, bi: number, patch: Partial<Buy>) => setPf({
    ...pf, holdings: pf.holdings.map((h, i) => i !== hi ? h
      : { ...h, buys: h.buys.map((b, j) => (j === bi ? { ...b, ...patch } : b)) }),
  })
  const addBuy = (hi: number) => setPf({
    ...pf, holdings: pf.holdings.map((h, i) => i !== hi || h.buys.length >= MAX_BUYS ? h
      : { ...h, buys: [...h.buys, { amount: null, date: null }] }),
  })
  const removeBuy = (hi: number, bi: number) => setPf({
    ...pf, holdings: pf.holdings.map((h, i) => i !== hi ? h : { ...h, buys: h.buys.filter((_, j) => j !== bi) }),
  })
  const removeFund = (hi: number) => setPf({ ...pf, holdings: pf.holdings.filter((_, i) => i !== hi) })
  const setSip = (hi: number, sip: Sip | null) => setPf({
    ...pf, holdings: pf.holdings.map((h, i) => (i !== hi ? h
      : { ...h, sip, buys: !sip && h.buys.length === 0 ? [{ amount: null, date: null }] : h.buys })),
  })

  const openReport = () => {
    if (!results.length) return
    openPortfolioReport({
      demo: !!pf.demo, asOf: end, preparedOn: new Date().toISOString().slice(0, 10),
      total: tot,
      funds: results.map(r => ({
        name: r.name, category: r.cat?.k ?? '', invested: r.invested, value: r.value, gain: r.gain,
        ret: r.ret, irr: r.irr,
        lines: [
          ...r.buys.map(b => ({ label: 'Lump sum', date: fmtDate(b.d), amount: b.amt, units: b.units, value: b.val })),
          ...(r.h.sip && r.sip.count ? [{
            label: `SIP ₹${sipAmount(r.h).toLocaleString('en-IN')}/month × ${r.sip.count}`,
            date: `${fmtDate(r.h.sip.start || pf.start)} →`, amount: r.sip.invested, units: r.sip.units, value: r.sip.value,
          }] : []),
        ],
      })),
    })
  }

  const buildExport = (): SheetSpec | null => {
    if (!results.length) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const r of results) {
      r.buys.forEach((b, i) => rows.push({
        fund: i === 0 ? r.name : '', date: b.d, amount: b.amt, nav: b.nav?.nav ?? null, units: b.units,
        value: b.val, note: b.why ?? '',
      }))
      if (r.h.sip && r.sip.count) rows.push({ fund: '', date: `SIP x${r.sip.count}`, amount: r.sip.invested,
                                                units: r.sip.units, value: r.sip.value,
                                                note: `₹${sipAmount(r.h)}/month` })
      rows.push({ fund: `  ${r.name} — total`, amount: r.invested, value: r.value, ret: r.ret, irr: r.irr })
    }
    rows.push({ fund: 'PORTFOLIO', amount: tot.invested, value: tot.value, ret: tot.ret, irr: tot.irr })
    return {
      sheet: 'Portfolio', title: 'Portfolio Builder',
      meta: [['Desk', desk.name], ['Value as of', end], ['Units', 'amount / NAV on or before the purchase date, split-adjusted']],
      columns: [
        { key: 'fund', label: 'Fund', type: 'text', width: 46 },
        { key: 'date', label: 'Purchase date', type: 'text', width: 13 },
        { key: 'amount', label: 'Amount', type: 'number' },
        { key: 'nav', label: 'NAV', type: 'number' },
        { key: 'units', label: 'Units', type: 'number' },
        { key: 'value', label: 'Value', type: 'number' },
        { key: 'ret', label: 'Return', type: 'percent' },
        { key: 'irr', label: 'XIRR', type: 'percent' },
        { key: 'note', label: 'Note', type: 'text', width: 20 },
      ],
      rows,
      fileName: `${desk.code} Portfolio - ${end}`,
    }
  }

  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }
  const small = 'px-2 py-1 rounded text-xs'

  return (
    <section id="portfolio-builder" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Portfolio Builder</span>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => setPf({ ...DEMO, end: '' })} className="tab-btn"
                  title="Replace the current portfolio with a 5-fund demo">Load demo (5 funds)</button>
          {pf.holdings.length > 0 && (
            <button onClick={() => { if (window.confirm('Clear the portfolio?')) setPf({ ...pf, holdings: [], demo: false }) }}
                    className="tab-btn">Clear</button>
          )}
          <button onClick={openReport} disabled={!results.length} className="tab-btn font-semibold"
                  style={{ border: '1px solid var(--accent-a)', background: 'rgba(34,211,238,0.08)', color: 'var(--accent-a)' }}
                  title="Opens a printable report; choose “Save as PDF” in the print dialog">
            📄 Report (PDF)
          </button>
          <DownloadButton build={buildExport} disabledHint="Add a fund first" />
        </span>
      </div>

      {pf.demo && pf.holdings.length > 0 && (
        <div className="card p-2.5 mb-3 text-xs" style={{ borderColor: 'rgba(245,158,11,0.5)', color: '#F59E0B' }}>
          DEMO portfolio — for illustration only. Its report is watermarked “DEMO”.
        </div>
      )}

      {/* ── Portfolio defaults ─────────────────────────────────── */}
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3 text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1">Invest from (optional default)
          <input type="date" value={pf.start} max={end} onChange={e => setPf({ ...pf, start: e.target.value })}
                 className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">Value as of
          <input type="date" value={end} max={latest} onChange={e => setPf({ ...pf, end: e.target.value })}
                 className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">Amount per fund (optional default)
          <input type="number" min={0} step={1000} value={pf.amount ?? ''} placeholder="₹ amount"
                 onChange={e => setPf({ ...pf, amount: toAmount(e.target.value) })}
                 className="px-3 py-1.5 rounded-lg text-sm w-36" style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">SIP per month (optional default)
          <input type="number" min={100} step={500} value={pf.sipAmount ?? ''} placeholder="₹ per month"
                 onChange={e => setPf({ ...pf, sipAmount: toAmount(e.target.value) })}
                 className="px-3 py-1.5 rounded-lg text-sm w-32" style={inputStyle} />
        </label>
        <div className="flex-1" />
        <label className="flex flex-col gap-1 min-w-[280px]">Add a fund ({pf.holdings.length}/{MAX_FUNDS})
          <div className="flex gap-2">
            <input list="pb-fund-list" value={pick} onChange={e => setPick(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') addFund() }}
                   placeholder={index ? 'Start typing a fund name…' : 'Loading…'}
                   className="px-3 py-1.5 rounded-lg text-sm flex-1" style={inputStyle} />
            <button onClick={addFund} disabled={!pick || pf.holdings.length >= MAX_FUNDS} className="tab-btn active accent">Add</button>
          </div>
          <datalist id="pb-fund-list">
            {(index?.funds ?? []).map(f => <option key={f.c} value={labelOf(f)} />)}
          </datalist>
        </label>
        {msg && <div className="w-full" style={{ color: 'var(--loss)' }}>{msg}</div>}
      </div>

      {/* ── Summary ─────────────────────────────────────────────── */}
      {pf.holdings.length > 0 && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {[
            ['Invested', inr(tot.invested), undefined],
            [`Value on ${fmtDate(end)}`, inr(tot.value), undefined],
            ['Gain', inr(tot.gain), tot.gain],
            ['Absolute return', fmtPct(tot.ret), tot.ret],
            ['XIRR (annualised)', tot.irr == null ? '—' : fmtPct(tot.irr), tot.irr],
          ].map(([label, val, sign]) => (
            <div key={label as string} className="card p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{label}</div>
              <div className={`font-display font-bold text-lg ${sign === undefined ? '' : retColor(sign as number | null)}`}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Holdings ───────────────────────────────────────────── */}
      <div className="card overflow-hidden mb-4">
        {pf.holdings.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
            Add up to {MAX_FUNDS} funds above, then enter each purchase&apos;s amount and date (up to {MAX_BUYS} per
            fund) or add a monthly SIP. The optional defaults above fill any purchase you leave blank.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
                  <th className="text-left">Purchases (amount · date)</th>
                  <th style={{ textAlign: 'right' }}>Invested</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th style={{ textAlign: 'right' }}>Gain</th>
                  <th style={{ textAlign: 'right' }}>Return</th>
                  <th style={{ textAlign: 'right' }}>XIRR</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r, hi) => (
                  <tr key={r.h.code}>
                    <td className="sticky-col" style={{ maxWidth: 280 }}>
                      <div className="text-xs font-medium truncate"><FundLink code={r.h.code} name={r.name} /></div>
                      <div className="text-[10px] truncate" style={{ color: r.cat ? categoryColor(r.cat.s) : 'var(--text-low)' }}>
                        {r.cat?.k ?? ''}{r.endNav ? ` · NAV ${r.endNav.nav.toFixed(2)} (${fmtDate(r.endNav.date)})` : ''}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>
                      <div className="flex flex-col gap-1">
                        {r.h.buys.map((b, bi) => (
                          <div key={bi} className="flex items-center gap-1 flex-wrap">
                            <input type="number" min={0} step={1000} value={b.amount ?? pf.amount ?? ''} placeholder="₹ amount"
                                   onChange={e => updateBuy(hi, bi, { amount: toAmount(e.target.value) })}
                                   className={`${small} w-28`} style={inputStyle} title="Amount (₹)" />
                            <input type="date" value={b.date ?? pf.start ?? ''} max={end}
                                   onChange={e => updateBuy(hi, bi, { date: e.target.value })}
                                   className={small} style={inputStyle} title="Purchase date" />
                            {r.buys[bi]?.why && r.buys[bi].why !== 'loading' && (
                              <span className="text-[10px]" style={{ color: 'var(--loss)' }}>{r.buys[bi].why}</span>
                            )}
                            {r.buys[bi]?.units != null && (
                              <span className="text-[10px]" style={{ color: 'var(--text-low)' }}
                                    title={`NAV ${r.buys[bi].nav?.nav.toFixed(4)} on ${fmtDate(r.buys[bi].nav?.date)}`}>
                                {r.buys[bi].units!.toFixed(2)} units
                              </span>
                            )}
                            {(r.h.buys.length > 1 || r.h.sip) && (
                              <button onClick={() => removeBuy(hi, bi)} title="Remove this purchase"
                                      style={{ color: 'var(--text-low)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                            )}
                          </div>
                        ))}
                        {r.h.sip && (
                          <div className="flex items-center gap-1 flex-wrap mt-1 pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--accent-a)' }}>SIP ₹</span>
                            <input type="number" min={100} step={500} value={r.h.sip.amount ?? pf.sipAmount ?? ''} placeholder="₹"
                                   onChange={e => setSip(hi, { ...r.h.sip!, amount: toAmount(e.target.value) })}
                                   className={`${small} w-24`} style={inputStyle} title="Monthly SIP amount (₹)" />
                            <span className="text-[11px]">/month from</span>
                            <input type="date" value={r.h.sip.start ?? pf.start ?? ''} max={end}
                                   onChange={e => setSip(hi, { ...r.h.sip!, start: e.target.value })}
                                   className={small} style={inputStyle} title="First instalment" />
                            <span className="text-[11px]">to</span>
                            <input type="date" value={r.h.sip.end ?? end} max={end}
                                   onChange={e => setSip(hi, { ...r.h.sip!, end: e.target.value })}
                                   className={small} style={inputStyle} title="Last instalment on or before" />
                            <button onClick={() => setSip(hi, null)} title="Remove SIP"
                                    style={{ color: 'var(--text-low)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                            <div className="w-full text-[10px]" style={{ color: 'var(--text-low)' }}>
                              {r.sip.count} instalment{r.sip.count === 1 ? '' : 's'} · {inr(r.sip.invested)} invested ·{' '}
                              {r.sip.units.toFixed(2)} units → {inr(r.sip.value)}
                              {r.sip.skipped > 0 && <span style={{ color: 'var(--loss)' }}> · {r.sip.skipped} before launch / no NAV skipped</span>}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-3">
                          {r.h.buys.length < MAX_BUYS && (
                            <button onClick={() => addBuy(hi)} className="text-[11px] self-start"
                                    style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                              + add purchase
                            </button>
                          )}
                          {!r.h.sip && (
                            <button onClick={() => setSip(hi, { amount: null, start: null, end: null })}
                                    className="text-[11px] self-start"
                                    style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                              + add SIP
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="ret-cell">{inr(r.invested)}</td>
                    <td className="ret-cell font-semibold">{loading && !r.value ? '…' : inr(r.value)}</td>
                    <td className={`ret-cell ${retColor(r.gain)}`}>{inr(r.gain)}</td>
                    <td className={`ret-cell ${retColor(r.ret)}`}>{fmtPct(r.ret)}</td>
                    <td className={`ret-cell ${retColor(r.irr)}`}>{r.irr == null ? '—' : fmtPct(r.irr)}</td>
                    <td>
                      <button onClick={() => removeFund(hi)} title="Remove fund"
                              style={{ color: 'var(--text-low)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <div className="p-3 text-xs" style={{ color: 'var(--loss)' }}>Could not load NAVs ({error}).</div>}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
        A SIP buys once a month on the same day, from its start date up to the “Value as of” date (at most 10 years).
        Units bought = amount ÷ NAV on or before the purchase date. Value = units × NAV on or before the “Value as of”
        date, adjusted for unit splits. Return = value ÷ invested − 1. XIRR is the annualised return allowing for when
        each amount went in. No exit load, stamp duty or tax is deducted. The portfolio is saved in this browser.
      </p>
    </section>
  )
}

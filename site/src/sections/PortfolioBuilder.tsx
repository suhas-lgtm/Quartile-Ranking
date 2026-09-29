// src/sections/PortfolioBuilder.tsx — what a portfolio of up to 15 funds,
// bought on chosen dates, would be worth on another date.
//
// Each fund starts with one purchase on the portfolio's start date for the
// default amount; either can be overridden and up to three purchases added.
// Units bought = amount / NAV on or before the purchase date; value = units x
// NAV on or before the end date, adjusted for unit splits in between. XIRR uses
// every purchase as an outflow and the end value as the inflow. NAVs come from
// /api/nav (server/navLookup.ts). Saved in this browser.

import { Fragment, useEffect, useMemo, useState } from 'react'
import OverlapMatrix from '../components/OverlapMatrix'
import LookThrough, { useLookThrough } from '../components/LookThrough'
import CapSplit, { capSplit, useStockCaps } from '../components/CapSplit'
import { flowsIntoIndex, indexTrailing, TRAILING, useIndexSeries } from '../utils/benchmark'
import { categoryPath } from '../config/dataPaths'
import type { RiskData, RiskFundRow } from '../types'
import CorrelationMatrix, { type NavSeries } from '../components/CorrelationMatrix'
import FundPicker, { bestFund } from '../components/FundPicker'
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

function loadPortfolio(key: string = STORE_KEY): Portfolio | null {
  try {
    const raw = localStorage.getItem(key)
    const saved: Portfolio | null = raw ? JSON.parse(raw) : null
    // An empty saved portfolio only carries the old preset defaults: start blank.
    return saved && saved.holdings?.length ? saved : null
  } catch {
    return null
  }
}


/**
 * Everything the page shows for one portfolio: per-fund results and the total.
 * A hook so the Compare view can work out two portfolios side by side.
 */
function usePortfolioCalc(pf: Portfolio, latest: string, fundByCode: Map<string, FundsIndex['funds'][number]>) {
  const end = pf.end || latest
  const buyDate = (b: Buy) => b.date || pf.start
  const buyAmount = (b: Buy) => (b.amount ?? pf.amount ?? 0)
  const sipAmount = (h: Holding) => h.sip?.amount ?? pf.sipAmount ?? 0
  // A SIP without its own start date starts with the portfolio's default date,
  // else with the fund's first purchase; with neither it cannot run (flagged in the row).
  const sipStart = (h: Holding) => h.sip?.start || pf.start ||
    h.buys.map(b => b.date).filter((d): d is string => !!d).sort()[0] || ''
  const sipDates = (h: Holding) => {
    if (!h.sip || !end || !sipStart(h)) return []
    const to = h.sip.end && h.sip.end < end ? h.sip.end : end
    return monthlyDates(sipStart(h), to, 120)
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

  return { end, results, tot, loading, error, sipAmount, sipStart }
}

type Calc = ReturnType<typeof usePortfolioCalc>

function PortfolioEditor({ storeKey, label }: { storeKey: string; label: string }) {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const latest = meta?.as_of ?? ''
  const [pf, setPf] = useState<Portfolio>(() => loadPortfolio(storeKey) ?? BLANK)
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(pf)) } catch { /* optional */ } }, [pf, storeKey])

  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const labelOf = (f: FundsIndex['funds'][number]) => `${f.n} — ${f.k}`
  const codeByLabel = useMemo(() => new Map((index?.funds ?? []).map(f => [labelOf(f), f.c])), [index])
  const { end, results, tot, loading, error, sipAmount, sipStart } = usePortfolioCalc(pf, latest, fundByCode)

  // Full NAV history per holding, for the correlation table (fetched once each).
  const codes = useMemo(() => pf.holdings.map(h => h.code), [pf.holdings])
  const [series, setSeries] = useState<Record<string, NavSeries | null>>({})
  useEffect(() => {
    for (const c of codes) {
      if (c in series) continue
      setSeries(s => ({ ...s, [c]: null }))
      fetch(`/api/series?code=${c}`).then(r => (r.ok ? r.json() : null))
        .then(d => d && setSeries(s => ({ ...s, [c]: d })))
        .catch(() => { /* table shows it as pending */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes])

  const addFund = (picked?: string) => {
    const code = picked ?? codeByLabel.get(pick) ?? bestFund(index?.funds ?? [], pick)?.c
    if (!code) { setMsg('No fund looks like that name. Try fewer letters.'); return }
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
      : { ...h, sip,
          // Adding a SIP to a fund whose only purchase is still blank: drop that
          // blank row so it does not ask for a date nobody meant to give.
          buys: !sip && h.buys.length === 0 ? [{ amount: null, date: null }]
            : sip && h.buys.length === 1 && h.buys[0].amount == null && h.buys[0].date == null ? [] : h.buys })),
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
            date: `${fmtDate(sipStart(r.h))} →`, amount: r.sip.invested, units: r.sip.units, value: r.sip.value,
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
        <span>Portfolio Builder <span style={{ color: 'var(--accent-a)' }}>· {label}</span></span>
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
            <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick}
                        exclude={pf.holdings.map(h => h.code)} onPick={f => addFund(f.c)}
                        placeholder={index ? 'Type any part of a fund name, spelling need not be exact…' : 'Loading…'}
                        style={inputStyle} />
            <button onClick={() => addFund()} disabled={!pick || pf.holdings.length >= MAX_FUNDS} className="tab-btn active accent">Add</button>
          </div>
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
                            <input type="date" value={r.h.sip.start || sipStart(r.h)} max={end}
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
                              {!(sipAmount(r.h) > 0) && <span style={{ color: 'var(--loss)' }}> · enter the SIP amount</span>}
                              {!sipStart(r.h) && <span style={{ color: 'var(--loss)' }}> · enter the SIP start date</span>}
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

      <CorrelationMatrix funds={pf.holdings.map(h => ({ code: h.code, name: fundByCode.get(h.code)?.n ?? h.code, series: series[h.code] }))} />
      <OverlapMatrix funds={pf.holdings.map(h => ({ code: h.code, name: fundByCode.get(h.code)?.n ?? h.code }))} />
      <LookThrough funds={results.filter(r => r.value > 0).map(r => ({ code: r.h.code, name: r.name, value: r.value }))} />
      <PortfolioVsBenchmark flows={results.flatMap(r => r.flows.filter(f => f.amount < 0))} tot={tot} end={end} />
      <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
        A SIP buys once a month on the same day, from its start date up to the “Value as of” date (at most 10 years).
        Units bought = amount ÷ NAV on or before the purchase date. Value = units × NAV on or before the “Value as of”
        date, adjusted for unit splits. Return = value ÷ invested − 1. XIRR is the annualised return allowing for when
        each amount went in. No exit load, stamp duty or tax is deducted. The portfolio is saved in this browser.
      </p>
    </section>
  )
}


// ── Portfolio A / B and the comparison ───────────────────────────────────────

const SLOTS = [
  { id: 'A', label: 'Portfolio A', key: STORE_KEY },
  { id: 'B', label: 'Portfolio B', key: `${STORE_KEY}_B` },
] as const
const VIEW_KEY = 'pb_view_v1'

export default function PortfolioBuilder() {
  const [view, setView] = useState<'A' | 'B' | 'compare'>(() => {
    try { const v = localStorage.getItem(VIEW_KEY); return v === 'B' || v === 'compare' ? v : 'A' } catch { return 'A' }
  })
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* optional */ } }, [view])
  return (
    <>
      <div className="px-4 sm:px-6 pt-4 max-w-screen-2xl mx-auto">
        <div className="flex items-end gap-1 border-b flex-wrap" style={{ borderColor: 'var(--line)' }}>
          {([...SLOTS.map(sl => [sl.id, `📁 ${sl.label}`]), ['compare', '⇄ Portfolio Comparison (A vs B)']] as [typeof view, string][]).map(([id, text]) => {
            const on = view === id
            return (
              <button key={id} onClick={() => setView(id)}
                      className="px-4 py-2 text-sm font-semibold rounded-t-lg -mb-px"
                      style={{ border: '1px solid', borderColor: on ? 'var(--line)' : 'transparent', borderBottomColor: on ? 'var(--bg-base)' : 'transparent',
                               background: on ? 'var(--bg-base)' : 'transparent', color: on ? 'var(--accent-a)' : 'var(--text-mid)', cursor: 'pointer' }}>
                {text}
              </button>
            )
          })}
          <span className="text-[11px] ml-auto pb-2" style={{ color: 'var(--text-low)' }}>
            Build two portfolios (e.g. a client&apos;s current one and a proposal), then compare them.
          </span>
        </div>
      </div>
      {view === 'compare' ? <PortfolioCompare />
        : SLOTS.filter(sl => sl.id === view).map(sl => <PortfolioEditor key={sl.id} storeKey={sl.key} label={sl.label} />)}
    </>
  )
}

function PortfolioCompare() {
  const { data: meta } = useMeta()
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const latest = meta?.as_of ?? ''
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [a] = useState<Portfolio>(() => loadPortfolio(SLOTS[0].key) ?? BLANK)
  const [b] = useState<Portfolio>(() => loadPortfolio(SLOTS[1].key) ?? BLANK)
  const A = usePortfolioCalc(a, latest, fundByCode)
  const B = usePortfolioCalc(b, latest, fundByCode)
  const ltA = useLookThrough(A.results.filter(r => r.value > 0).map(r => ({ code: r.h.code, name: r.name, value: r.value })))
  const ltB = useLookThrough(B.results.filter(r => r.value > 0).map(r => ({ code: r.h.code, name: r.name, value: r.value })))
  const risk = useFundRisk([...new Set([...a.holdings, ...b.holdings].map(h => h.code))], fundByCode)
  const caps = useStockCaps()
  const [benchId, setBenchId] = useBenchmarkChoice()
  const benchSeries = useIndexSeries(benchId)
  const bench = useMemo(() => indexTrailing(benchSeries), [benchSeries])
  const benchName = meta?.benchmarks.find(x => x.index_id === benchId)?.index_name ?? 'Index'

  if (!a.holdings.length || !b.holdings.length) {
    return (
      <section className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Build both portfolios first: add funds under <b>Portfolio A</b> and <b>Portfolio B</b>, then come back here.
          {!a.holdings.length && <div className="mt-1">Portfolio A is empty.</div>}
          {!b.holdings.length && <div>Portfolio B is empty.</div>}
        </div>
      </section>
    )
  }

  const alloc = (c: Calc) => {
    const m = new Map<string, number>()
    for (const r of c.results) m.set(r.cat?.k ?? 'Other', (m.get(r.cat?.k ?? 'Other') ?? 0) + r.value)
    return m
  }
  const allocA = alloc(A), allocB = alloc(B)
  const cats = [...new Set([...allocA.keys(), ...allocB.keys()])].sort((x, y) =>
    ((allocB.get(y) ?? 0) / (B.tot.value || 1) + (allocA.get(y) ?? 0) / (A.tot.value || 1))
    - ((allocB.get(x) ?? 0) / (B.tot.value || 1) + (allocA.get(x) ?? 0) / (A.tot.value || 1)))

  // Stocks both portfolios hold, through their funds: overlap = sum of the smaller weight.
  const bByIsin = new Map(ltB.rows.map(r => [r.isin, r]))
  const common = ltA.rows.filter(r => r.asset_class === 'Equity' && bByIsin.has(r.isin))
    .map(r => ({ name: r.name, a: r.weight, b: bByIsin.get(r.isin)!.weight }))
    .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b))
  const overlap = common.reduce((s, c) => s + Math.min(c.a, c.b), 0)
  const commonFunds = a.holdings.filter(h => b.holdings.some(x => x.code === h.code)).map(h => fundByCode.get(h.code)?.n ?? h.code)

  const metric = (label: string, fa: string, fb: string, better?: 'a' | 'b' | null) => (
    <tr key={label}>
      <td className="sticky-col text-xs">{label}</td>
      <td className="ret-cell text-xs font-semibold" style={{ color: better === 'a' ? '#34D399' : undefined }}>{fa}</td>
      <td className="ret-cell text-xs font-semibold" style={{ color: better === 'b' ? '#34D399' : undefined }}>{fb}</td>
    </tr>
  )
  const cmp = (x: number | null, y: number | null) => (x == null || y == null || x === y ? null : x > y ? 'a' : 'b')
  const col = (t: string, c: string) => <th style={{ textAlign: 'right', minWidth: 150, color: c }}>{t}</th>

  return (
    <section className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Portfolio A vs Portfolio B</span>
        <span className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-mid)' }}>
          Benchmark <BenchmarkPicker id={benchId} onChange={setBenchId} />
        </span>
      </div>

      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-mid)' }}>
        The funds, as they stand today — trailing returns and 3Y ratios, no purchase dates involved
      </div>
      <FundsSideBySide title="Portfolio A" colour="#22D3EE" calc={A} risk={risk} bench={bench} benchName={benchName} />
      <FundsSideBySide title="Portfolio B" colour="#F59E0B" calc={B} risk={risk} bench={bench} benchName={benchName} />

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {([['Portfolio A', ltA, '#22D3EE'], ['Portfolio B', ltB, '#F59E0B']] as const).map(([t, lt, c]) => {
          const sec = new Map<string, number>()
          for (const r of lt.rows) sec.set(r.sector || r.industry || 'Other', (sec.get(r.sector || r.industry || 'Other') ?? 0) + r.weight)
          const top = [...sec.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
          return (
            <div key={t} className="card p-4">
              <div className="font-display font-bold text-sm mb-2" style={{ color: c }}>{t} — market cap &amp; sectors</div>
              <CapSplit split={capSplit(lt.rows, caps)} period={caps?.period} compact />
              <div className="mt-3">
                {top.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="truncate" style={{ width: 150, color: 'var(--text-mid)' }}>{k}</span>
                    <div className="flex-1 h-2 rounded" style={{ background: 'var(--bg-raised)' }}>
                      <div className="h-2 rounded" style={{ width: `${Math.min(100, (v / (top[0]?.[1] || 1)) * 100)}%`, background: c }} />
                    </div>
                    <span className="ret-cell" style={{ width: 44 }}>{(v * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-mid)' }}>
        The portfolios as built — with their purchase dates and amounts
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th className="sticky-col text-left">Measure</th>{col('Portfolio A', '#22D3EE')}{col('Portfolio B', '#F59E0B')}</tr></thead>
            <tbody>
              {metric('Funds', String(a.holdings.length), String(b.holdings.length))}
              {metric('Invested', inr(A.tot.invested), inr(B.tot.invested))}
              {metric(`Value (${fmtDate(A.end)} / ${fmtDate(B.end)})`, inr(A.tot.value), inr(B.tot.value))}
              {metric('Gain', inr(A.tot.gain), inr(B.tot.gain), cmp(A.tot.gain, B.tot.gain))}
              {metric('Absolute return', fmtPct(A.tot.ret), fmtPct(B.tot.ret), cmp(A.tot.ret, B.tot.ret))}
              {metric('XIRR (annualised)', A.tot.irr == null ? '—' : fmtPct(A.tot.irr), B.tot.irr == null ? '—' : fmtPct(B.tot.irr), cmp(A.tot.irr, B.tot.irr))}
              {metric('Top 10 stocks, share of portfolio',
                fmtPct(ltA.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0)), fmtPct(ltB.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0)))}
              {metric('Number of stocks', String(ltA.rows.filter(r => r.asset_class === 'Equity').length),
                String(ltB.rows.filter(r => r.asset_class === 'Equity').length))}
            </tbody>
          </table>
          {(A.loading || B.loading) && <div className="p-2 text-[11px]" style={{ color: 'var(--text-low)' }}>Loading NAVs…</div>}
        </div>
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th className="sticky-col text-left">Category allocation</th>{col('A', '#22D3EE')}{col('B', '#F59E0B')}</tr></thead>
            <tbody>
              {cats.map(c => {
                const wa = A.tot.value ? (allocA.get(c) ?? 0) / A.tot.value : 0
                const wb = B.tot.value ? (allocB.get(c) ?? 0) / B.tot.value : 0
                return (
                  <tr key={c}>
                    <td className="sticky-col text-xs">{c}</td>
                    <td className="ret-cell text-xs">{wa ? `${(wa * 100).toFixed(1)}%` : '—'}</td>
                    <td className="ret-cell text-xs">{wb ? `${(wb * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--text-hi)' }}>
          Stock overlap between the two portfolios: <span style={{ color: overlap >= 0.6 ? '#F87171' : overlap >= 0.3 ? '#F59E0B' : '#34D399' }}>{(overlap * 100).toFixed(0)}%</span>
          <span className="font-normal text-xs ml-2" style={{ color: 'var(--text-low)' }}>{common.length} stocks in common{commonFunds.length ? ` · ${commonFunds.length} fund(s) in both` : ''}</span>
        </div>
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-low)' }}>
          Seen through the funds: for every stock both portfolios hold, the smaller of its two weights, added up. 60%+ means the
          two portfolios are largely the same underlying stocks.{commonFunds.length ? ` Funds in both: ${commonFunds.join(', ')}.` : ''}
        </p>
        {common.length > 0 && (
          <table className="data-table">
            <thead><tr><th className="text-left">Biggest common stocks</th>{col('In A', '#22D3EE')}{col('In B', '#F59E0B')}</tr></thead>
            <tbody>
              {common.slice(0, 10).map(c => (
                <tr key={c.name}>
                  <td className="text-xs truncate" style={{ maxWidth: 320 }}>{c.name}</td>
                  <td className="ret-cell text-xs">{(c.a * 100).toFixed(2)}%</td>
                  <td className="ret-cell text-xs">{(c.b * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LookThrough funds={A.results.filter(r => r.value > 0).map(r => ({ code: r.h.code, name: r.name, value: r.value }))} title="Portfolio A — holdings" />
        <LookThrough funds={B.results.filter(r => r.value > 0).map(r => ({ code: r.h.code, name: r.name, value: r.value }))} title="Portfolio B — holdings" />
      </div>
    </section>
  )
}


// ── Benchmark ────────────────────────────────────────────────────────────────

const BENCH_KEY = 'pb_bench_v1'

function useBenchmarkChoice() {
  const [id, setId] = useState<number>(() => { try { return Number(localStorage.getItem(BENCH_KEY)) || 5 } catch { return 5 } })
  useEffect(() => { try { localStorage.setItem(BENCH_KEY, String(id)) } catch { /* optional */ } }, [id])
  return [id, setId] as const
}

function BenchmarkPicker({ id, onChange }: { id: number; onChange: (id: number) => void }) {
  const { data: meta } = useMeta()
  const list = [...(meta?.benchmarks ?? [])].sort((a, b) => a.index_name.localeCompare(b.index_name))
  return (
    <select value={id} onChange={e => onChange(Number(e.target.value))} className="px-2 py-1 rounded text-xs"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}
            title="Any index the dashboard holds">
      {list.map(b => <option key={b.index_id} value={b.index_id}>{b.index_name}</option>)}
    </select>
  )
}

/** The same purchases and SIP instalments, on the same dates, put into an index instead. */
function PortfolioVsBenchmark({ flows, tot, end }: {
  flows: { date: string; amount: number }[]
  tot: { invested: number; value: number; gain: number; ret: number | null; irr: number | null }
  end: string
}) {
  const { data: meta } = useMeta()
  const [id, setId] = useBenchmarkChoice()
  const series = useIndexSeries(id)
  const idx = useMemo(() => flowsIntoIndex(flows, series, end), [flows, series, end])
  if (!flows.length || !tot.invested) return null
  const name = meta?.benchmarks.find(b => b.index_id === id)?.index_name ?? 'Index'
  const diff = tot.irr != null && idx?.irr != null ? tot.irr - idx.irr : null
  const row = (label: string, a: string, b: string, good?: boolean | null) => (
    <tr key={label}>
      <td className="sticky-col text-xs">{label}</td>
      <td className="ret-cell text-xs font-semibold" style={{ color: good === true ? '#34D399' : undefined }}>{a}</td>
      <td className="ret-cell text-xs font-semibold" style={{ color: good === false ? '#34D399' : undefined }}>{b}</td>
    </tr>
  )
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Portfolio vs Benchmark</div>
        <BenchmarkPicker id={id} onChange={setId} />
        {diff != null && (
          <span className="text-xs ml-auto font-semibold" style={{ color: diff >= 0 ? '#34D399' : '#F87171' }}>
            {diff >= 0 ? 'Beat' : 'Trailed'} {name} by {(Math.abs(diff) * 100).toFixed(2)}% a year
          </span>
        )}
      </div>
      {!series ? <div className="skeleton h-20 w-full" /> : !idx ? (
        <div className="text-xs" style={{ color: 'var(--text-low)' }}>{name} has no data for these dates.</div>
      ) : (
        <table className="data-table">
          <thead><tr><th className="sticky-col text-left">Same money, same dates</th>
            <th style={{ textAlign: 'right' }}>This portfolio</th><th style={{ textAlign: 'right' }}>{name}</th></tr></thead>
          <tbody>
            {row('Invested', inr(tot.invested), inr(idx.invested))}
            {row(`Value on ${fmtDate(end)}`, inr(tot.value), inr(idx.value), tot.value === idx.value ? null : tot.value > idx.value)}
            {row('Gain', inr(tot.gain), inr(idx.gain), tot.gain === idx.gain ? null : tot.gain > idx.gain)}
            {row('Absolute return', fmtPct(tot.ret), fmtPct(idx.ret), tot.ret == null ? null : tot.ret > idx.ret)}
            {row('XIRR (annualised)', tot.irr == null ? '—' : fmtPct(tot.irr), idx.irr == null ? '—' : fmtPct(idx.irr),
                 tot.irr == null || idx.irr == null ? null : tot.irr > idx.irr)}
          </tbody>
        </table>
      )}
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>
        Every purchase and SIP instalment of this portfolio, on its own date, is put into {name} instead (at the index close on
        or before that date), and valued on the same “Value as of” date. Index levels are price returns — no dividends — so a
        total-return index would be slightly higher.{idx?.skipped ? ` ${idx.skipped} instalment(s) fell before the index history and were left out.` : ''}
      </p>
    </div>
  )
}

// ── Fund returns & ratios side by side (no dates) ────────────────────────────

/** Each fund's row in its category's risk file (trailing returns and ratios). */
function useFundRisk(codes: string[], fundByCode: Map<string, FundsIndex['funds'][number]>) {
  const [rows, setRows] = useState<Record<string, RiskFundRow | null>>({})
  const slugs = [...new Set(codes.map(c => fundByCode.get(c)?.s).filter((x): x is string => !!x))]
  useEffect(() => {
    for (const slug of slugs) {
      categoryPath(slug, 'risk.json').then(pth => fetch(`/data/${pth}`)).then(r => (r.ok ? r.json() : null))
        .then((d: RiskData | null) => {
          if (!d) return
          setRows(prev => {
            const next = { ...prev }
            for (const f of d.funds) if (codes.includes(f.scheme_code)) next[f.scheme_code] = f
            return next
          })
        }).catch(() => { /* not published for this category */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs.join(','), codes.join(',')])
  return rows
}

const RET_KEYS: [string, string][] = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '12M'], ['3Y', '3Y'], ['5Y', '5Y']]
const RATIO_KEYS: [string, (r: RiskFundRow) => number | null, (v: number) => string][] = [
  ['Sharpe', r => r.sharpe, v => v.toFixed(2)],
  ['Std Dev', r => r.std_annual, v => `${(v * 100).toFixed(1)}%`],
  ['Alpha', r => (r.alpha == null ? null : r.alpha * 100), v => v.toFixed(2)],
  ['Beta', r => r.beta, v => v.toFixed(2)],
  ['Max DD', r => r.max_drawdown, v => `${(v * 100).toFixed(1)}%`],
]

function FundsSideBySide({ title, colour, calc, risk, bench, benchName }: {
  title: string; colour: string; calc: Calc; risk: Record<string, RiskFundRow | null>
  bench: Record<string, number | null>; benchName: string
}) {
  const total = calc.results.reduce((s, r) => s + (r.value > 0 ? r.value : 0), 0)
  const weight = (v: number) => (total ? v / total : 0)
  const weighted = (get: (r: RiskFundRow) => number | null) => {
    let s = 0, w = 0
    for (const r of calc.results) {
      const row = risk[r.h.code], v = row ? get(row) : null
      if (v == null || !(r.value > 0)) continue
      s += v * r.value; w += r.value
    }
    return w ? s / w : null
  }
  const cell = (v: number | null, f: (v: number) => string, colourIt = false) =>
    <td className={`ret-cell text-xs ${colourIt ? retColor(v) : ''}`}>{v == null ? '—' : f(v)}</td>
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: colour }}>{title}</div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sticky-col text-left" style={{ minWidth: 220 }}>Fund</th>
              <th style={{ textAlign: 'right' }} title="Share of the portfolio's value">Weight</th>
              {RET_KEYS.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
              {RATIO_KEYS.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {calc.results.map(r => {
              const row = risk[r.h.code]
              return (
                <tr key={r.h.code}>
                  <td className="sticky-col text-xs truncate" style={{ maxWidth: 260 }}><FundLink code={r.h.code} name={r.name} /></td>
                  <td className="ret-cell text-xs">{(weight(r.value) * 100).toFixed(1)}%</td>
                  {RET_KEYS.map(([l, k]) => cell(row?.returns?.[k as keyof RiskFundRow['returns']] ?? null, fmtPct, true))}
                  {RATIO_KEYS.map(([l, get, f]) => <td key={l} className="ret-cell text-xs">{row && get(row) != null ? f(get(row)!) : '—'}</td>)}
                </tr>
              )
            })}
            <tr className="benchmark-row">
              <td className="sticky-col text-xs font-bold" style={{ color: colour }}>Portfolio (weighted)</td>
              <td className="ret-cell text-xs font-bold">100%</td>
              {RET_KEYS.map(([l, k]) => <Fragment key={l}>{cell(weighted(r => r.returns?.[k as keyof RiskFundRow['returns']] ?? null), fmtPct, true)}</Fragment>)}
              {RATIO_KEYS.map(([l, get, f]) => <Fragment key={l}>{cell(weighted(get), f)}</Fragment>)}
            </tr>
            <tr className="benchmark-row">
              <td className="sticky-col text-xs font-semibold" style={{ color: 'var(--accent-a)' }}>Benchmark · {benchName}</td>
              <td className="ret-cell text-xs">—</td>
              {RET_KEYS.map(([l]) => <Fragment key={l}>{cell(bench[l] ?? null, fmtPct, true)}</Fragment>)}
              {RATIO_KEYS.map(([l]) => <td key={l} className="ret-cell text-xs">—</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

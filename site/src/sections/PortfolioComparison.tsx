// src/sections/PortfolioComparison.tsx — a client review: the client's EXISTING
// mutual funds against the SUGGESTED portfolio after our changes.
//
// No dates: each side is a list of funds with today's amount. The suggestion
// starts as a duplicate of the existing funds and every change stays visible
// (removed, added, increased, reduced). The analysis below (PortfolioReview)
// shows what the changes do: market cap, asset class, category, sectors with
// their industries, holdings and stock-level changes, returns, SIP returns and
// ratios against a chosen benchmark, correlation and overlap. Saved in this
// browser. Each fund can carry a SIP (₹ a month) as well as its amount, and
// SIFs are entered apart from the mutual funds — existing and suggested — with
// their own analysis.

import { useEffect, useMemo, useState } from 'react'
import { PdfButton, PdfProvider, PdfSection } from '../components/PdfSections'
import { useJson } from '../hooks/useData'
import FundPicker from '../components/FundPicker'
import FundLink from '../components/FundLink'
import PortfolioReview, { inr, pct1 } from '../components/PortfolioReview'
import SuggestedEditor from '../components/SuggestedEditor'
import PortfolioOrbit, { type OrbitItem } from '../components/PortfolioOrbit'
import SipPulse from '../components/SipPulse'
import { SifAnalysis, SifEditor, useSifPlans, type SifLine } from '../components/SifPlan'
import { categoryColor } from '../config/categoryColors'
import { inrShort } from '../components/PortfolioReview'
import type { FundsIndex } from '../types'

interface Line { code: string; amount: number | null; sip?: number | null }
interface Review { existing: Line[]; proposed: Line[]; client?: string; sifExisting?: SifLine[]; sifProposed?: SifLine[] }
const STORE = 'pc_review_v1'
const EX_COLOUR = '#94A3B8', SG_COLOUR = '#22D3EE', SIF_COLOUR = '#A78BFA'

function load(): Review {
  try { const r = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (r?.existing) return r } catch { /* none */ }
  return { existing: [], proposed: [] }
}

export default function PortfolioComparison() {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [rv, setRv] = useState<Review>(load)
  const [pick, setPick] = useState('')
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(rv)) } catch { /* optional */ } }, [rv])

  const name = (c: string) => fundByCode.get(c)?.n ?? c
  const exTotal = rv.existing.reduce((s, l) => s + (l.amount ?? 0), 0)
  const setExisting = (existing: Line[]) => setRv(r => ({ ...r, existing }))
  const sifEx = rv.sifExisting ?? [], sifPr = rv.sifProposed ?? []
  const { byId: sifById } = useSifPlans()
  const sifName = (id: string) => sifById.get(id)?.name.replace(/\s*-\s*Regular.*$/i, '') ?? id
  // SIPs: per fund on each side (₹ a month); the suggested side starts as a copy of the existing one.
  const sipNowOf = (c: string) => rv.existing.filter(l => l.code === c).reduce((t, l) => t + (l.sip ?? 0), 0)
  const sipNextOf = (c: string) => rv.proposed.find(l => l.code === c)?.sip ?? 0
  const setSip = (c: string, v: number | null) => setRv(r => ({
    ...r, proposed: r.proposed.some(l => l.code === c) ? r.proposed.map(l => (l.code === c ? { ...l, sip: v } : l)) : [...r.proposed, { code: c, amount: null, sip: v }],
  }))
  const hasSip = [...rv.existing, ...rv.proposed].some(l => (l.sip ?? 0) > 0) || [...sifEx, ...sifPr].some(l => (l.sip ?? 0) > 0)
  const sipBefore = rv.existing.reduce((t, l) => t + (l.sip ?? 0), 0) + sifEx.reduce((t, l) => t + (l.sip ?? 0), 0)
  const sipCodes = [...new Set([...rv.existing, ...rv.proposed].map(l => l.code))]
  const sipBeats = [
    ...sipCodes.map(c => {
      const was = sipNowOf(c), now = rv.proposed.length ? sipNextOf(c) : was
      return { code: c, amount: now, was, status: now === was ? undefined : !was ? 'new' as const : now > was ? 'up' as const : 'down' as const }
    }),
    ...[...new Set([...sifEx, ...sifPr].map(l => l.id))].map(id => {
      const was = sifEx.filter(l => l.id === id).reduce((t, l) => t + (l.sip ?? 0), 0)
      const now = sifPr.length ? sifPr.filter(l => l.id === id).reduce((t, l) => t + (l.sip ?? 0), 0) : was
      return { name: sifName(id), amount: now, was, status: now === was ? undefined : !was ? 'new' as const : now > was ? 'up' as const : 'down' as const }
    }),
  ]
  const sipAfterTotal = sipBeats.reduce((t, b) => t + b.amount, 0)
  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

  // The portfolio the pictures show: the suggested one, or today's while nothing is suggested.
  const view: { label: string; colour: string; items: OrbitItem[]; note?: string } = (() => {
    const ex = new Map(rv.existing.filter(l => (l.amount ?? 0) > 0).map(l => [l.code, l.amount!]))
    const pr = new Map(rv.proposed.filter(l => (l.amount ?? 0) > 0).map(l => [l.code, l.amount!]))
    if (!pr.size && !(rv.sifProposed ?? []).some(l => (l.lump ?? 0) > 0)) return { label: 'Current portfolio', colour: EX_COLOUR, items: [
      ...[...ex].map(([code, amount]) => ({ code, amount })),
      ...(rv.sifExisting ?? []).filter(l => (l.lump ?? 0) > 0).map(l => ({ name: sifName(l.id), amount: l.lump ?? 0, sif: true })),
    ] }
    const sold = [...ex.keys()].filter(c => !pr.has(c)).length
    return {
      label: 'Suggested portfolio', colour: SG_COLOUR,
      note: sold ? `${sold} fund${sold === 1 ? '' : 's'} sold in full ${sold === 1 ? 'is' : 'are'} not shown.` : undefined,
      items: [
        ...[...pr].map(([code, amount]) => {
          const e = ex.get(code) ?? 0
          return { code, amount, was: e || undefined, status: !e ? 'new' as const : amount > e * 1.01 ? 'up' as const : amount < e * 0.99 ? 'down' as const : undefined }
        }),
        ...(rv.sifProposed ?? []).filter(l => (l.lump ?? 0) > 0).map(l => ({ name: sifName(l.id), amount: l.lump ?? 0, sif: true })),
      ],
    }
  })()

  return (
    <PdfProvider pageKey="pcompare" doc={{
      kicker: 'Portfolio review', title: 'Portfolio Comparison', client: rv.client || undefined,
      stats: [
        { label: 'Existing portfolio', value: inrShort(exTotal) },
        { label: 'Suggested portfolio', value: inrShort(rv.proposed.reduce((s, l) => s + (l.amount ?? 0), 0)) },
        { label: 'Funds', value: `${rv.existing.filter(l => (l.amount ?? 0) > 0).length} → ${rv.proposed.filter(l => (l.amount ?? 0) > 0).length}` },
        { label: 'Change', value: inrShort(Math.abs(rv.proposed.reduce((s, l) => s + (l.amount ?? 0), 0) - exTotal)) },
      ],
    }}>
    <section id="portfolio-comparison" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Portfolio Comparison</span>
        <span className="ml-auto flex items-center gap-2 print:hidden">
          <input value={rv.client ?? ''} onChange={e => setRv(r => ({ ...r, client: e.target.value }))} placeholder="Client name (for the PDF)"
                 className="px-2 py-1 rounded text-xs" style={{ ...inputStyle, width: 200 }} />
          <PdfButton title="Portfolio Comparison" />
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-mid)' }}>
        Enter the client&apos;s existing funds with today&apos;s value, then <b>⧉ Duplicate existing</b> into the suggested portfolio
        and remove, add or change funds. Every change stays listed, and the analysis below shows what it does to the portfolio.
      </p>

      <PdfSection id="inputs" page label="Existing & suggested fund lists" kicker="Where you stand and what we recommend"
                  title={rv.proposed.length ? 'Existing & Suggested Portfolio' : 'Existing Portfolio'}>
      <div className={`grid gap-4 xl:grid-cols-2 mb-4 ${rv.proposed.length ? '' : 'pdf-one-col'}`}>
        {/* ── existing ── */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: EX_COLOUR }}>Existing portfolio</div>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(exTotal)}</b></span>
              {rv.existing.length > 0 && (
                <button className="tab-btn" onClick={() => { if (window.confirm('Clear the existing portfolio?')) setExisting([]) }}>Clear</button>
              )}
            </div>
          </div>
          <table className="data-table">
            {rv.existing.length > 0 && (
              <thead><tr>
                <th className="text-left">Fund</th><th style={{ textAlign: 'right' }}>Amount ₹</th>
                <th style={{ textAlign: 'right' }}>SIP ₹/mo</th><th style={{ textAlign: 'right' }}>Weight</th><th />
              </tr></thead>
            )}
            <tbody>
              {rv.existing.map((l, i) => {
                const f = fundByCode.get(l.code)
                return (
                  <tr key={l.code}>
                    <td style={{ maxWidth: 280 }}>
                      <div className="text-xs font-medium truncate"><FundLink code={l.code} name={name(l.code)} /></div>
                      <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                    </td>
                    <td style={{ width: 130 }}>
                      <span className="hidden print:inline text-xs font-semibold">{l.amount ? inr(l.amount) : '—'}</span>
                      <input type="number" min={0} step={10000} value={l.amount ?? ''} placeholder="₹ amount"
                             onChange={e => setExisting(rv.existing.map((x, j) => j === i ? { ...x, amount: e.target.value === '' ? null : Math.max(0, +e.target.value) } : x))}
                             className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    <td style={{ width: 110 }}>
                      <span className="hidden print:inline text-xs font-semibold">{l.sip ? inr(l.sip) : '—'}</span>
                      <input type="number" min={0} step={1000} value={l.sip ?? ''} placeholder="SIP"
                             onChange={e => setExisting(rv.existing.map((x, j) => j === i ? { ...x, sip: e.target.value === '' ? null : Math.max(0, +e.target.value) } : x))}
                             className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    <td className="ret-cell text-[11px]" style={{ width: 50, color: 'var(--text-low)' }}>{exTotal && l.amount ? pct1(l.amount / exTotal) : ''}</td>
                    <td style={{ width: 24 }}>
                      <button onClick={() => setExisting(rv.existing.filter((_, j) => j !== i))} title="Remove"
                              style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-2">
            <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick} exclude={rv.existing.map(l => l.code)}
                        onPick={f => { setExisting([...rv.existing, { code: f.c, amount: null }]); setPick('') }}
                        placeholder="Add a fund — type any part of its name…" style={inputStyle} />
          </div>
        </div>

        {/* ── suggested (left out of the PDF until there is one) ── */}
        <div className={`card p-4 ${rv.proposed.length ? '' : 'pdf-print-skip'}`}>
          <SuggestedEditor existing={rv.existing} lines={rv.proposed} onChange={proposed => setRv(r => ({ ...r, proposed }))}
                           inputStyle={inputStyle} colour={SG_COLOUR} sip={{ now: sipNowOf, next: sipNextOf, set: setSip }} />
        </div>
      </div>
      </PdfSection>

      {/* ── SIF: existing and suggested, apart from the mutual funds ── */}
      <PdfSection id="sif-inputs" label="SIF — existing & suggested" kicker="Specialised Investment Funds"
                  title={sifPr.length ? 'SIF — Existing & Suggested' : 'SIF — Existing'} empty={!sifEx.length && !sifPr.length}>
      <div className={`grid gap-4 xl:grid-cols-2 mb-4 ${sifPr.length ? '' : 'pdf-one-col'}`}>
        <div className={`card p-4 ${sifEx.length ? '' : 'pdf-print-skip'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: SIF_COLOUR }}>Existing SIF</div>
            <span className="text-xs" style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(sifEx.reduce((t, l) => t + (l.lump ?? 0), 0))}</b></span>
          </div>
          <SifEditor lines={sifEx} onChange={l => setRv(r => ({ ...r, sifExisting: l }))} inputStyle={inputStyle} weightOf={l => l.lump ?? 0} />
        </div>
        <div className={`card p-4 ${sifPr.length ? '' : 'pdf-print-skip'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: SIF_COLOUR }}>Suggested SIF</div>
            <span className="flex items-center gap-2 text-xs">
              {sifEx.length > 0 && (
                <button className="tab-btn" onClick={() => { if (!sifPr.length || window.confirm('Replace the suggested SIF with a copy of the existing?')) setRv(r => ({ ...r, sifProposed: sifEx.map(l => ({ ...l })) })) }}>
                  {sifPr.length ? '↺ Duplicate existing again' : '⧉ Duplicate existing'}
                </button>
              )}
              <span style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(sifPr.reduce((t, l) => t + (l.lump ?? 0), 0))}</b></span>
            </span>
          </div>
          <SifEditor lines={sifPr} onChange={l => setRv(r => ({ ...r, sifProposed: l }))} inputStyle={inputStyle} weightOf={l => l.lump ?? 0} />
        </div>
      </div>
      </PdfSection>

      {hasSip && (
        <PdfSection id="pulse" label="SIP heartbeat (each SIP a beat)" kicker="Every month" title="The SIP Heartbeat">
          <SipPulse label={rv.proposed.length || sifPr.length ? 'Suggested SIPs' : 'SIPs'} items={sipBeats}
                    before={sipAfterTotal !== sipBefore ? sipBefore : undefined} />
        </PdfSection>
      )}

      {[...rv.existing, ...rv.proposed].some(l => (l.amount ?? 0) > 0) && (
        <PdfSection id="orbit" page label="Portfolio picture (as a solar system)" kicker="At a glance" title="The Portfolio at a Glance">
          <PortfolioOrbit label={view.label} colour={view.colour} items={view.items} note={view.note} />
        </PdfSection>
      )}

      <PortfolioReview title="Existing vs suggested" sides={[
        { label: 'Existing', colour: EX_COLOUR, lines: rv.existing },
        { label: 'Suggested', colour: SG_COLOUR, lines: rv.proposed },
      ].filter(s => s.lines.some(l => (l.amount ?? 0) > 0))} />

      {/* ── SIF analysis: existing and suggested, each on its own ── */}
      {sifEx.some(l => (l.lump ?? 0) > 0) && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}><span>Existing SIF — analysis</span></div>
          <SifAnalysis lines={sifEx.map(l => ({ id: l.id, amount: l.lump ?? 0 }))} colour={EX_COLOUR} />
        </>
      )}
      {sifPr.some(l => (l.lump ?? 0) > 0) && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}><span>Suggested SIF — analysis</span></div>
          <SifAnalysis lines={sifPr.map(l => ({ id: l.id, amount: l.lump ?? 0 }))} colour={SIF_COLOUR} />
        </>
      )}
    </section>
    </PdfProvider>
  )
}

// src/sections/rahul/ClientPlan.tsx — Rahul's client plan: a plan size (say
// ₹50 L) spread over mutual funds and, below them, SIF strategies. Every fund
// and every SIF can have its own lump sum and its own monthly SIP.
//
// The analysis weighs each line by what goes into it — lump sum only, SIP only,
// or lump sum plus the SIP over the chosen years — and shows everything the
// dashboard has: allocation by market cap, asset class, category and sector
// (with industries), top holdings, returns, SIP returns and ratios per fund and
// weighted, overlap and correlation, then the same for the SIFs. Plans are kept
// in this browser, one per client.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSavedClients } from '../../utils/savedClients'
import Milestone, { nextMilestone } from '../../components/Milestone'
import { PdfButton, PdfProvider, PdfSection } from '../../components/PdfSections'
import { useJson } from '../../hooks/useData'
import FundPicker from '../../components/FundPicker'
import FundLink from '../../components/FundLink'
import PortfolioReview, { inr, inrShort, pct1 } from '../../components/PortfolioReview'
import { SifAnalysis, SifEditor, useSifPlans, type SifLine } from '../../components/SifPlan'
import PortfolioOrbit from '../../components/PortfolioOrbit'
import SipPulse from '../../components/SipPulse'
import { categoryColor } from '../../config/categoryColors'
import type { FundsIndex } from '../../types'

export interface MfLine { code: string; lump: number | null; sip: number | null }
export type Basis = 'both' | 'lump' | 'sip'
interface Plan {
  client: string
  /** The advisor on the report's cover and footer (default Rahul). */
  advisorName?: string
  advisorPhone?: string
  /** Plan size in ₹, e.g. 5000000 for ₹50 L. */
  target: number | null
  /** SIP horizon in years, for "lump sum + SIP" weights and the planned total. */
  years: number
  basis: Basis
  mf: MfLine[]
  sif: SifLine[]
}

const STORE = 'rahul_plans_v1'
/** The advisor printed on the reports unless another is typed in (both of Rahul's pages). */
export const ADVISOR = { name: 'Rahul', mobile: '+91 98091 10073' }
const EMPTY: Plan = { client: '', target: 5000000, years: 1, basis: 'both', mf: [], sif: [] }
const MF_COLOUR = '#22D3EE'
const SIF_COLOUR = '#A78BFA'

export const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }
const num = (v: string) => (v === '' ? null : Math.max(0, +v))

/** What a line counts for in the allocation. */
export function weightFor(basis: Basis, years: number) {
  return (l: { lump: number | null; sip: number | null }) =>
    basis === 'lump' ? (l.lump ?? 0) : basis === 'sip' ? (l.sip ?? 0) : (l.lump ?? 0) + (l.sip ?? 0) * 12 * years
}

function loadAll(): { current: string; plans: Record<string, Plan> } {
  try {
    const r = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    if (r?.plans) return r
  } catch { /* none saved */ }
  return { current: '', plans: { '': EMPTY } }
}

export function BasisPicker({ basis, years, onBasis, onYears }: { basis: Basis; years: number; onBasis: (b: Basis) => void; onYears: (y: number) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-mid)' }}>
      Weigh allocation by
      {([['both', 'Lump sum + SIP'], ['lump', 'Lump sum only'], ['sip', 'SIP only']] as const).map(([k, l]) => (
        <button key={k} className={`tab-btn ${basis === k ? 'active' : ''}`} onClick={() => onBasis(k)}>{l}</button>
      ))}
      <span className="ml-2">SIP period</span>
      <input type="number" min={1} max={30} value={years} onChange={e => onYears(Math.max(1, Math.min(30, +e.target.value || 1)))}
             className="px-2 py-1 rounded text-xs text-right" style={{ ...inputStyle, width: 56 }} />
      <span>years</span>
    </div>
  )
}

export function MfEditor({ lines, onChange, weightOf, showSip = true }: {
  lines: MfLine[]; onChange: (l: MfLine[]) => void; weightOf: (l: MfLine) => number; showSip?: boolean
}) {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [pick, setPick] = useState('')
  const tot = lines.reduce((s, l) => s + weightOf(l), 0)
  const set = (i: number, patch: Partial<MfLine>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div>
      {lines.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="text-left">Fund</th>
              <th style={{ textAlign: 'right' }}>{showSip ? 'Lump sum ₹' : 'Amount ₹'}</th>
              {showSip && <th style={{ textAlign: 'right' }}>SIP ₹ / month</th>}
              <th style={{ textAlign: 'right' }}>Weight</th><th />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const f = fundByCode.get(l.code)
                return (
                  <tr key={l.code}>
                    <td style={{ maxWidth: 320 }}>
                      <div className="text-xs font-medium truncate"><FundLink code={l.code} name={f?.n ?? l.code} /></div>
                      <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                    </td>
                    <td style={{ width: 140, textAlign: 'right' }}>
                      <span className="hidden print:inline text-xs font-semibold">{l.lump ? inr(l.lump) : '—'}</span>
                      <input type="number" min={0} step={50000} value={l.lump ?? ''} placeholder={showSip ? 'Lump sum' : '₹ amount'}
                             onChange={e => set(i, { lump: num(e.target.value) })} className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    {showSip && (
                      <td style={{ width: 130, textAlign: 'right' }}>
                        <span className="hidden print:inline text-xs font-semibold">{l.sip ? inr(l.sip) : '—'}</span>
                        <input type="number" min={0} step={1000} value={l.sip ?? ''} placeholder="SIP"
                               onChange={e => set(i, { sip: num(e.target.value) })} className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                      </td>
                    )}
                    <td className="ret-cell text-[11px]" style={{ width: 56, color: 'var(--text-low)' }}>{tot ? pct1(weightOf(l) / tot) : ''}</td>
                    <td style={{ width: 24 }}>
                      <button onClick={() => onChange(lines.filter((_, j) => j !== i))} title="Remove"
                              style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2">
        <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick} exclude={lines.map(l => l.code)}
                    onPick={f => { onChange([...lines, { code: f.c, lump: null, sip: null }]); setPick('') }}
                    placeholder="Add a mutual fund — type any part of its name…" style={inputStyle} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub, colour }: { label: string; value: string; sub?: string; colour?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{label}</div>
      <div className="font-display font-bold text-lg" style={{ color: colour ?? 'var(--text-hi)' }}>{value}</div>
      {sub && <div className="text-[10px]" style={{ color: 'var(--text-mid)' }}>{sub}</div>}
    </div>
  )
}

export default function ClientPlan() {
  const [store, setStore] = useState(loadAll)
  const plan = store.plans[store.current] ?? EMPTY
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(store)) } catch { /* optional */ } }, [store])
  const update = (patch: Partial<Plan>) => setStore(s => ({ ...s, plans: { ...s.plans, [s.current]: { ...plan, ...patch } } }))

  const w = weightFor(plan.basis, plan.years)
  const { byId: sifById } = useSifPlans()
  const sifName = (id: string) => sifById.get(id)?.name.replace(/\s*-\s*Regular.*$/i, '') ?? id
  const mfLump = plan.mf.reduce((s, l) => s + (l.lump ?? 0), 0)
  const mfSip = plan.mf.reduce((s, l) => s + (l.sip ?? 0), 0)
  const sifLump = plan.sif.reduce((s, l) => s + (l.lump ?? 0), 0)
  const sifSip = plan.sif.reduce((s, l) => s + (l.sip ?? 0), 0)
  // The plan's funds for the pictures (solar system, heartbeat).
  const planItems = [
    ...plan.mf.map(l => ({ code: l.code, amount: w(l) })),
    ...plan.sif.map(l => ({ name: sifName(l.id), amount: w(l), sif: true })),
  ]
  const planned = mfLump + sifLump + (mfSip + sifSip) * 12 * plan.years
  const mfW = plan.mf.reduce((s, l) => s + w(l), 0), sifW = plan.sif.reduce((s, l) => s + w(l), 0)
  const left = plan.target ? plan.target - planned : null

  // Saved clients live on the server too, so they open on any computer (utils/savedClients).
  const putLocal = useCallback((name: string, data: typeof plan) =>
    setStore(s => ({ current: name, plans: { ...s.plans, [name]: data } })), [])
  const dropLocal = useCallback((name: string) => setStore(s => {
    const plans = { ...s.plans }; delete plans[name]
    return { current: s.current === name ? '' : s.current, plans: { '': EMPTY, ...plans } }
  }), [])
  const cloud = useSavedClients({ kind: 'rahul-plan', current: store.current, local: store.plans, putLocal, dropLocal })
  const saved = cloud.names
  const saveAs = () => {
    const nm = plan.client.trim()
    if (!nm) { window.alert('Enter the client name first.'); return }
    setStore(s => {
      const plans = { ...s.plans, [nm]: { ...plan, client: nm } }
      if (s.current === '') plans[''] = EMPTY
      return { current: nm, plans }
    })
    cloud.save(nm, { ...plan, client: nm })
  }

  return (
    <PdfProvider pageKey="rahul-plan" doc={{
      kicker: 'Investment plan', title: 'Client Investment Plan', client: plan.client || undefined,
      advisor: { name: plan.advisorName?.trim() || ADVISOR.name, mobile: plan.advisorPhone?.trim() || ADVISOR.mobile },
      stats: [
        { label: 'Plan size', value: plan.target ? inrShort(plan.target) : '—' },
        { label: 'Lump sum', value: inrShort(mfLump + sifLump) },
        { label: 'SIP / month', value: inr(mfSip + sifSip) },
        { label: `Planned over ${plan.years} yr${plan.years === 1 ? '' : 's'}`, value: inrShort(planned) },
      ],
    }}>
    <section id="client-plan" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Client Plan</span>
        <span className="ml-auto flex items-center gap-2 text-xs print:hidden">
          <select value={store.current} onChange={e => { const v = e.target.value; setStore(s => ({ ...s, current: v })); cloud.open(v) }}
                  className="px-2 py-1 rounded text-xs" style={inputStyle}>
            <option value="">New plan</option>
            {saved.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="tab-btn" onClick={saveAs}>Save for this client</button>
          {store.current ? (
            <button className="tab-btn" onClick={() => {
              if (!window.confirm(`Delete the plan for ${store.current}? It is removed for the whole team.`)) return
              cloud.remove(store.current)
            }}>Delete</button>
          ) : (
            // A new client not saved yet: start again from a blank page.
            <button className="tab-btn" title="Clear this unsaved page and start again" onClick={() => {
              if (!window.confirm('Clear this unsaved page and start again? Everything entered here is removed.')) return
              setStore(s => ({ ...s, plans: { ...s.plans, '': EMPTY } }))
            }}>Clear</button>
          )}
          <PdfButton title={plan.client || 'Client Plan'} />
        </span>
      </div>
      <div className="text-[11px] -mt-2 mb-3 print:hidden" style={{ color: cloud.status === 'offline' ? '#F59E0B' : 'var(--text-low)' }}>
        {cloud.status === 'offline'
          ? 'Saved clients server not reachable — saving in this browser only for now.'
          : cloud.note ?? `Saved clients are shared by the team and open on any computer${saved.length ? ` · ${saved.length} saved` : ''}.`}
        {store.current && cloud.status === 'online' && ' · changes save automatically'}
      </div>

      {/* ── the plan ── */}
      <PdfSection id="plan" page label="Plan summary (client, lump sums, SIPs, MF vs SIF)" kicker="The plan" title="Plan Summary">
      <div className="card p-4 mb-4 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs" style={{ color: 'var(--text-mid)' }}>Client
            <input value={plan.client} onChange={e => update({ client: e.target.value })} placeholder="Client name"
                   className="block mt-1 px-2 py-1.5 rounded text-sm" style={{ ...inputStyle, width: 220 }} />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-mid)' }} title="Printed on the PDF and the web link">Advisor
            <input value={plan.advisorName ?? ''} onChange={e => update({ advisorName: e.target.value })} placeholder={ADVISOR.name}
                   className="block mt-1 px-2 py-1.5 rounded text-sm" style={{ ...inputStyle, width: 150 }} />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-mid)' }} title="Printed on the PDF and the web link">Advisor phone
            <input value={plan.advisorPhone ?? ''} onChange={e => update({ advisorPhone: e.target.value })} placeholder={ADVISOR.mobile}
                   className="block mt-1 px-2 py-1.5 rounded text-sm" style={{ ...inputStyle, width: 160 }} />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-mid)' }}>Plan size ₹
            <input type="number" min={0} step={500000} value={plan.target ?? ''} onChange={e => update({ target: num(e.target.value) })}
                   className="block mt-1 px-2 py-1.5 rounded text-sm text-right" style={{ ...inputStyle, width: 160 }} />
          </label>
          <span className="text-xs pb-2" style={{ color: 'var(--text-hi)' }}>{plan.target ? inrShort(plan.target) : ''}</span>
          <div className="pb-1"><BasisPicker basis={plan.basis} years={plan.years} onBasis={b => update({ basis: b })} onYears={y => update({ years: y })} /></div>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-7 mb-4">
        <Stat label="MF lump sum" value={inrShort(mfLump)} colour={MF_COLOUR} />
        <Stat label="MF SIP / month" value={inr(mfSip)} colour={MF_COLOUR} sub={`${plan.mf.filter(l => l.sip).length} SIP${plan.mf.filter(l => l.sip).length === 1 ? '' : 's'}`} />
        <Stat label="SIF lump sum" value={inrShort(sifLump)} colour={SIF_COLOUR} />
        <Stat label="SIF SIP / month" value={inr(sifSip)} colour={SIF_COLOUR} />
        <Stat label={`Planned over ${plan.years} yr${plan.years === 1 ? '' : 's'}`} value={inrShort(planned)} sub="lump sums + SIP instalments" />
        <Stat label={left == null ? 'Plan size' : left >= 0 ? 'Still to allocate' : 'Over the plan size'}
              value={left == null ? '—' : inrShort(Math.abs(left))} colour={left != null && left < 0 ? '#F87171' : undefined}
              sub={plan.target ? `of ${inrShort(plan.target)}` : undefined} />
        {(() => {
          // Next round milestone above what the plan puts in over its SIP period.
          const m = planned > 0 ? nextMilestone(planned) : null
          return m && <Stat label="Next milestone" value={`${inrShort(m.more)} more`} sub={`to reach ${inrShort(m.at)} (planned ${inrShort(planned)})`} />
        })()}
      </div>

      {mfW + sifW > 0 && (
        <div className="card p-4 mb-4">
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-mid)' }}>Mutual funds vs SIF</div>
          <div className="flex h-4 rounded overflow-hidden">
            <div style={{ width: `${(mfW / (mfW + sifW)) * 100}%`, background: MF_COLOUR }} />
            <div style={{ width: `${(sifW / (mfW + sifW)) * 100}%`, background: SIF_COLOUR }} />
          </div>
          <div className="flex justify-between text-[11px] mt-1">
            <span style={{ color: MF_COLOUR }}>Mutual funds {pct1(mfW / (mfW + sifW))} · {inrShort(mfW)}</span>
            <span style={{ color: SIF_COLOUR }}>SIF {pct1(sifW / (mfW + sifW))} · {inrShort(sifW)}</span>
          </div>
        </div>
      )}

      </PdfSection>

      <PdfSection id="orbit" page label="Portfolio picture (funds as a solar system)" kicker="The plan at a glance" title="Your Portfolio at a Glance">
        <PortfolioOrbit label="This plan" colour={MF_COLOUR} items={planItems} />
      </PdfSection>
      <PdfSection id="pulse" label="SIP heartbeat (each SIP a beat)" kicker="Every month" title="The SIP Heartbeat">
        <SipPulse label="This plan" items={[
          ...plan.mf.map(l => ({ code: l.code, amount: l.sip ?? 0 })),
          ...plan.sif.map(l => ({ name: sifName(l.id), amount: l.sip ?? 0 })),
        ]} years={plan.years} />
      </PdfSection>

      <PdfSection id="milestone" label="Milestone (goal, projection, SIP needed)" kicker="The goal" title="Milestone">
        <Milestone storeKey={`rahul_plan_goal:${store.current}`} sides={[{
          label: 'This plan', colour: MF_COLOUR, lump: mfLump + sifLump, sip: mfSip + sifSip,
          lines: plan.mf.map(l => ({ code: l.code, amount: w(l) })),
        }]} />
      </PdfSection>

      {/* ── mutual funds ── */}
      <PdfSection id="mf-list" page label="Mutual fund list (lump sum & SIP per fund)" kicker="What we recommend" title="Mutual Funds — Lump Sum &amp; SIP">
      <div className="card p-4 mb-4">
        <div className="font-display font-bold text-sm mb-2" style={{ color: MF_COLOUR }}>Mutual funds</div>
        <MfEditor lines={plan.mf} onChange={mf => update({ mf })} weightOf={w} />
      </div>
      </PdfSection>
      <PortfolioReview title="Mutual funds — analysis"
                       sides={[{ label: 'Mutual funds', colour: MF_COLOUR, lines: plan.mf.map(l => ({ code: l.code, amount: w(l) || null })) }]} />

      {/* ── SIF ── */}
      <PdfSection id="sif-list" label="SIF list (lump sum & SIP per strategy)" kicker="What we recommend" title="SIF — Lump Sum &amp; SIP">
      <div className="card p-4 mb-4 mt-6">
        <div className="font-display font-bold text-sm mb-2" style={{ color: SIF_COLOUR }}>SIF (Specialised Investment Funds)</div>
        <SifEditor lines={plan.sif} onChange={sif => update({ sif })} inputStyle={inputStyle} weightOf={w} />
      </div>
      </PdfSection>
      {plan.sif.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}><span>SIF — analysis</span></div>
          <SifAnalysis lines={plan.sif.map(l => ({ id: l.id, amount: w(l) }))} colour={SIF_COLOUR} />
        </>
      )}
    </section>
    </PdfProvider>
  )
}

// src/components/ActionPlan.tsx — the instructions that carry out a reallocation:
// SIP changes (start / increase / reduce / stop) and switches or STPs from one
// fund to another (equity → debt, debt → equity, fund → fund).
//
// SIPs: each fund's existing SIP (from the upload) beside the suggested SIP.
// Switches: a one-time amount moved from a fund to another. STPs: an amount
// moved every month for a number of months. "Auto-fill" pairs the suggested
// portfolio's sells with its buys, largest first, so the switches add up to the
// changes; every row can then be edited, turned into an STP, or removed.

import { useMemo, useState } from 'react'
import { useJson, useMeta } from '../hooks/useData'
import FundPicker from './FundPicker'
import FundLink from './FundLink'
import { inr, inrShort } from './PortfolioReview'
import type { FundsIndex } from '../types'

export interface SwitchRow { id: string; type: 'switch' | 'stp'; from: string; to: string; amount: number | null; months?: number | null }

const newId = () => Math.random().toString(36).slice(2, 9)
const SIP_COLOUR: Record<string, string> = { Start: '#22D3EE', Increase: '#34D399', Reduce: '#F59E0B', Stop: '#F87171', Same: 'var(--text-low)' }
const sipStatus = (ex: number, sg: number) => ex <= 0 && sg > 0 ? 'Start' : ex > 0 && sg <= 0 ? 'Stop' : sg > ex ? 'Increase' : sg < ex ? 'Reduce' : 'Same'

function useFunds() {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const { data: meta } = useMeta()
  const byCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const assetOf = (code: string) => meta?.categories.find(c => c.slug === byCode.get(code)?.s)?.asset_class ?? '—'
  return { funds: index?.funds ?? [], byCode, assetOf }
}

/** Existing SIP per fund against the suggested SIP. `suggested` holds only the funds whose SIP was set. */
export function SipChanges({ existing, suggested, onChange, inputStyle }: {
  existing: Map<string, number>
  suggested: Record<string, number | null>
  onChange: (s: Record<string, number | null>) => void
  inputStyle: React.CSSProperties
}) {
  const { funds, byCode } = useFunds()
  const [pick, setPick] = useState('')
  const codes = [...new Set([...existing.keys(), ...Object.keys(suggested)])]
  const sg = (c: string) => (c in suggested ? suggested[c] ?? 0 : existing.get(c) ?? 0)
  const exTot = [...existing.values()].reduce((s, v) => s + v, 0)
  const sgTot = codes.reduce((s, c) => s + sg(c), 0)
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="font-display font-bold text-sm" style={{ color: '#22D3EE' }}>SIP changes</div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-mid)' }}>
          SIPs a month: <b style={{ color: 'var(--text-hi)' }}>{inr(exTot)}</b> → <b style={{ color: 'var(--text-hi)' }}>{inr(sgTot)}</b>
          {sgTot !== exTot && <b style={{ color: sgTot > exTot ? '#34D399' : '#F59E0B' }}>({sgTot > exTot ? '+' : '−'}{inr(Math.abs(sgTot - exTot))})</b>}
          {Object.keys(suggested).length > 0 && <button className="tab-btn" onClick={() => onChange({})}>Reset to existing</button>}
        </div>
      </div>
      {codes.length === 0 ? (
        <div className="text-xs py-2" style={{ color: 'var(--text-mid)' }}>
          No SIPs in the upload. Add a fund below to start a SIP (or type the existing SIPs in the holdings table above).
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="text-left">Fund</th>
              <th style={{ textAlign: 'right' }}>Existing SIP ₹/month</th>
              <th style={{ textAlign: 'right' }}>Suggested SIP ₹/month</th>
              <th style={{ textAlign: 'right' }}>Change</th><th className="text-left">Action</th><th />
            </tr></thead>
            <tbody>
              {codes.map(c => {
                const ex = existing.get(c) ?? 0, s = sg(c), st = sipStatus(ex, s)
                return (
                  <tr key={c}>
                    <td className="text-xs" style={{ maxWidth: 320 }}>
                      <div className="truncate"><FundLink code={c} name={byCode.get(c)?.n ?? c} /></div>
                      <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{byCode.get(c)?.k}</div>
                    </td>
                    <td className="ret-cell text-xs">{ex ? inr(ex) : '—'}</td>
                    <td style={{ width: 150, textAlign: 'right' }}>
                      <span className="hidden print:inline text-xs font-semibold">{s ? inr(s) : '—'}</span>
                      <input type="number" min={0} step={500} value={s || ''} placeholder="0"
                             onChange={e => onChange({ ...suggested, [c]: e.target.value === '' ? 0 : Math.max(0, +e.target.value) })}
                             className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    <td className="ret-cell text-xs font-semibold" style={{ color: SIP_COLOUR[st] }}>{s === ex ? '—' : `${s > ex ? '+' : '−'}${inr(Math.abs(s - ex))}`}</td>
                    <td className="text-xs font-semibold" style={{ color: SIP_COLOUR[st] }}>{st}{st === 'Stop' ? ' SIP' : st === 'Start' ? ' SIP' : ''}</td>
                    <td style={{ width: 28 }}>
                      {!existing.has(c) && (
                        <button title="Remove" onClick={() => { const n = { ...suggested }; delete n[c]; onChange(n) }}
                                style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 print:hidden">
        <FundPicker funds={funds} value={pick} onChange={setPick} exclude={codes}
                    onPick={f => { onChange({ ...suggested, [f.c]: null }); setPick('') }}
                    placeholder="Start a SIP in another fund — type any part of its name…" style={inputStyle} />
      </div>
    </div>
  )
}

/**
 * One of the two move tables: Switches (one-time amounts) or STPs (a monthly
 * amount for a number of months). Both edit the same list of moves; a row can
 * be sent to the other table with the same total (a ₹6 L switch = ₹1 L × 6).
 */
export function SwitchPlan({ kind, rows, onChange, fromFunds, changes, inputStyle }: {
  kind: 'switch' | 'stp'
  /** All moves, switches and STPs. */
  rows: SwitchRow[]
  onChange: (r: SwitchRow[]) => void
  /** Funds that can be moved out of (existing and suggested). */
  fromFunds: string[]
  /** Amount each fund goes down (negative) or up (positive) in the suggested portfolio. */
  changes: Map<string, number>
  inputStyle: React.CSSProperties
}) {
  const { funds, byCode, assetOf } = useFunds()
  const [toPick, setToPick] = useState<Record<string, string>>({})
  const mine = rows.filter(r => r.type === kind)
  const stp = kind === 'stp'
  const set = (id: string, patch: Partial<SwitchRow>) => onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const total = (r: SwitchRow) => (r.amount ?? 0) * (r.type === 'stp' ? (r.months ?? 0) : 1)
  const moveTo = (r: SwitchRow) => {
    const months = r.months ?? 6
    set(r.id, r.type === 'switch'
      ? { type: 'stp', months, amount: r.amount == null ? null : Math.round(r.amount / months) }
      : { type: 'switch', months: null, amount: r.amount == null ? null : r.amount * months })
  }

  // Switches built from the suggested portfolio: each sell goes into the buys, largest first,
  // after whatever the STPs already move. STP rows are kept as they are.
  const autoFill = () => {
    const left = new Map(changes)
    for (const r of rows) if (r.type === 'stp') {
      left.set(r.from, (left.get(r.from) ?? 0) + total(r))
      left.set(r.to, (left.get(r.to) ?? 0) - total(r))
    }
    const sells = [...left].filter(([, d]) => d < -0.5).map(([c, d]) => ({ c, left: -d })).sort((a, b) => b.left - a.left)
    const buys = [...left].filter(([, d]) => d > 0.5).map(([c, d]) => ({ c, left: d })).sort((a, b) => b.left - a.left)
    const made: SwitchRow[] = []
    for (const s of sells) for (const b of buys) {
      if (s.left < 1 || b.left < 1) continue
      const amt = Math.round(Math.min(s.left, b.left))
      made.push({ id: newId(), type: 'switch', from: s.c, to: b.c, amount: amt })
      s.left -= amt; b.left -= amt
    }
    onChange([...rows.filter(r => r.type === 'stp'), ...made])
  }
  const moveLabel = (a: string, b: string) => (a === '—' || b === '—' ? '' : a === b ? a : `${a} → ${b}`)
  const colour = stp ? '#F59E0B' : '#A78BFA'

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="font-display font-bold text-sm" style={{ color: colour }}>
          {stp ? 'STPs — Systematic Transfer Plans' : 'Switches'}
          <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--text-low)' }}>
            {stp ? 'a fixed amount moved every month, e.g. from a liquid / debt fund into equity' : 'a one-time move from one fund to another'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs print:hidden">
          {!stp && (
            <button className="tab-btn" title="Pair the suggested portfolio's sells with its buys" onClick={() => {
              if (!mine.length || window.confirm('Replace the switches with ones built from the suggested portfolio?')) autoFill()
            }}>⚡ Auto-fill from suggested changes</button>
          )}
          <button className="tab-btn" onClick={() => onChange([...rows, stp
            ? { id: newId(), type: 'stp', from: fromFunds[0] ?? '', to: '', amount: null, months: 6 }
            : { id: newId(), type: 'switch', from: fromFunds[0] ?? '', to: '', amount: null }])}>
            + {stp ? 'STP' : 'Switch'}
          </button>
        </div>
      </div>
      {!mine.length ? (
        <div className="text-xs py-2" style={{ color: 'var(--text-mid)' }}>
          {stp
            ? <>No STPs. Add one with <b>+ STP</b>, or move a switch here with its <b>→ STP</b> button.</>
            : <>No switches yet. <b>Auto-fill</b> builds them from the suggested portfolio (what is sold goes into what is bought), or add one with <b>+ Switch</b>.</>}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="text-left">From</th><th className="text-left">To</th><th className="text-left">Asset class</th>
              <th style={{ textAlign: 'right' }}>{stp ? '₹ / month' : 'Amount ₹'}</th>
              {stp && <th style={{ textAlign: 'right' }}>Months</th>}
              {stp && <th style={{ textAlign: 'right' }}>Total moved</th>}
              <th className="print:hidden" /><th className="print:hidden" />
            </tr></thead>
            <tbody>
              {mine.map(r => {
                const move = r.to ? moveLabel(assetOf(r.from), assetOf(r.to)) : ''
                return (
                  <tr key={r.id}>
                    <td style={{ minWidth: 230 }}>
                      <span className="hidden print:inline text-xs">{byCode.get(r.from)?.n ?? '—'}</span>
                      <select value={r.from} onChange={e => set(r.id, { from: e.target.value })} className="px-2 py-1 rounded text-xs w-full print:hidden" style={inputStyle}>
                        {!fromFunds.includes(r.from) && <option value={r.from}>{byCode.get(r.from)?.n ?? '— pick —'}</option>}
                        {fromFunds.map(c => <option key={c} value={c}>{byCode.get(c)?.n ?? c}</option>)}
                      </select>
                    </td>
                    <td style={{ minWidth: 240 }}>
                      {r.to && toPick[r.id] == null ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="truncate" style={{ maxWidth: 260 }}><FundLink code={r.to} name={byCode.get(r.to)?.n ?? r.to} /></span>
                          <button className="text-[10px] print:hidden" onClick={() => setToPick(x => ({ ...x, [r.id]: '' }))}
                                  style={{ background: 'none', border: 'none', color: 'var(--accent-a)', cursor: 'pointer' }}>change</button>
                        </div>
                      ) : (
                        <div className="print:hidden">
                          <FundPicker funds={funds} value={toPick[r.id] ?? ''} onChange={v => setToPick(x => ({ ...x, [r.id]: v }))} autoFocus={toPick[r.id] != null}
                                      onPick={f => { set(r.id, { to: f.c }); setToPick(x => { const y = { ...x }; delete y[r.id]; return y }) }}
                                      placeholder={stp ? 'Transfer into… type a fund' : 'Switch into… type a fund'} style={inputStyle} />
                        </div>
                      )}
                    </td>
                    <td className="text-xs font-semibold" style={{ color: move.includes('→') ? colour : 'var(--text-mid)' }}>{move || '—'}</td>
                    <td style={{ width: 150, textAlign: 'right' }}>
                      <span className="hidden print:inline text-xs font-semibold">{r.amount ? inr(r.amount) : '—'}</span>
                      <input type="number" min={0} step={stp ? 5000 : 10000} value={r.amount ?? ''} placeholder={stp ? '₹ / month' : '₹'}
                             onChange={e => set(r.id, { amount: e.target.value === '' ? null : Math.max(0, +e.target.value) })}
                             className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                    </td>
                    {stp && (
                      <td style={{ width: 80, textAlign: 'right' }}>
                        <span className="hidden print:inline text-xs">{r.months ?? '—'}</span>
                        <input type="number" min={1} max={60} value={r.months ?? ''} onChange={e => set(r.id, { months: e.target.value === '' ? null : Math.max(1, Math.min(60, +e.target.value)) })}
                               className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                      </td>
                    )}
                    {stp && <td className="ret-cell text-xs font-semibold">{total(r) ? inr(total(r)) : '—'}</td>}
                    <td className="print:hidden" style={{ width: 70 }}>
                      <button className="text-[10px]" onClick={() => moveTo(r)} title={stp ? 'Make it a one-time switch (same total)' : 'Make it a monthly STP (same total)'}
                              style={{ background: 'none', border: 'none', color: 'var(--accent-a)', cursor: 'pointer' }}>{stp ? '→ Switch' : '→ STP'}</button>
                    </td>
                    <td className="print:hidden" style={{ width: 28 }}>
                      <button title="Remove" onClick={() => onChange(rows.filter(x => x.id !== r.id))}
                              style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
              <tr className="benchmark-row">
                <td colSpan={3} className="text-xs font-semibold">Total · {mine.length} {stp ? `STP${mine.length === 1 ? '' : 's'}` : `switch${mine.length === 1 ? '' : 'es'}`}</td>
                {stp ? (
                  <>
                    <td className="ret-cell text-xs font-semibold">{inr(mine.reduce((s, r) => s + (r.amount ?? 0), 0))} / month</td><td />
                    <td className="ret-cell text-xs font-semibold">{inr(mine.reduce((s, r) => s + total(r), 0))}</td>
                  </>
                ) : <td className="ret-cell text-xs font-semibold">{inr(mine.reduce((s, r) => s + total(r), 0))}</td>}
                <td className="print:hidden" /><td className="print:hidden" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!stp && rows.length > 0 && (() => {
        // Do the switches and STPs together move each fund as much as the suggested portfolio says?
        const out = new Map<string, number>(), into = new Map<string, number>()
        for (const r of rows) { out.set(r.from, (out.get(r.from) ?? 0) + total(r)); into.set(r.to, (into.get(r.to) ?? 0) + total(r)) }
        const off = [...changes].map(([c, d]) => ({ c, d, moved: (into.get(c) ?? 0) - (out.get(c) ?? 0) }))
          // Rounding (an STP split into equal months) is not a mismatch: allow ₹100 or 1%.
          .filter(x => Math.abs(x.moved - x.d) > Math.max(100, Math.abs(x.d) * 0.01) && (x.d !== 0 || x.moved !== 0))
        return off.length > 0 && (
          <p className="text-[11px] mt-2 print:hidden" style={{ color: '#F59E0B' }}>
            Switches + STPs not matching the suggested portfolio yet: {off.slice(0, 6).map(x => `${byCode.get(x.c)?.n ?? x.c} (needs ${x.d >= 0 ? '+' : '−'}${inrShort(Math.abs(x.d))}, moves give ${x.moved >= 0 ? '+' : '−'}${inrShort(Math.abs(x.moved))})`).join(' · ')}
            {off.length > 6 ? ` · +${off.length - 6} more` : ''}. The rest can come from fresh money or be left in cash.
          </p>
        )
      })()}
    </div>
  )
}

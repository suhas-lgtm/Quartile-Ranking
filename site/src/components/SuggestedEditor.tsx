// src/components/SuggestedEditor.tsx — the suggested portfolio, built as a copy
// of the client's existing funds and then changed.
//
// Every fund from either side stays on screen with its existing and suggested
// amount, so the edit reads as a list of changes: Removed (struck through, can
// be restored), Added, Increased, Reduced or Same. Removing a fund here only sets
// its suggested amount to nothing — the existing side is never touched.

import { useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import FundPicker from './FundPicker'
import FundLink from './FundLink'
import { categoryColor } from '../config/categoryColors'
import { inr } from './PortfolioReview'
import type { FundsIndex } from '../types'

export interface AmountLine { code: string; amount: number | null }

export const STATUS_COLOUR: Record<string, string> = {
  Removed: '#F87171', Reduced: '#F59E0B', Same: 'var(--text-low)', Increased: '#34D399', Added: '#22D3EE',
}

export function statusOf(ex: number, sg: number) {
  return ex > 0 && sg <= 0 ? 'Removed' : ex <= 0 && sg > 0 ? 'Added' : sg > ex + 0.5 ? 'Increased' : sg < ex - 0.5 ? 'Reduced' : 'Same'
}

export default function SuggestedEditor({ existing, lines, onChange, inputStyle, colour = '#22D3EE', title = 'Suggested portfolio' }: {
  existing: AmountLine[]
  lines: AmountLine[]
  onChange: (l: AmountLine[]) => void
  inputStyle: React.CSSProperties
  colour?: string
  title?: string
}) {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const [pick, setPick] = useState('')
  const exMap = new Map<string, number>()
  for (const l of existing) exMap.set(l.code, (exMap.get(l.code) ?? 0) + (l.amount ?? 0))
  const sgMap = new Map(lines.map(l => [l.code, l.amount ?? 0]))
  // Existing funds first, in their order, then the added ones.
  // Nothing suggested yet: show nothing rather than every existing fund as "Removed".
  const codes = lines.length ? [...new Set([...existing.map(l => l.code), ...lines.map(l => l.code)])] : []
  const exTotal = [...exMap.values()].reduce((s, v) => s + v, 0)
  const sgTotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0)

  const setAmount = (code: string, amount: number | null) => {
    if (lines.some(l => l.code === code)) onChange(lines.map(l => (l.code === code ? { ...l, amount } : l)))
    else onChange([...lines, { code, amount }])
  }
  const remove = (code: string) => {
    // A fund the client holds stays listed as Removed; one only added here simply goes.
    if (exMap.has(code)) setAmount(code, 0)
    else onChange(lines.filter(l => l.code !== code))
  }
  const counts = codes.reduce<Record<string, number>>((c, code) => {
    const s = statusOf(exMap.get(code) ?? 0, sgMap.get(code) ?? 0); c[s] = (c[s] ?? 0) + 1; return c
  }, {})

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="font-display font-bold text-sm" style={{ color: colour }}>{title}</div>
        <div className="flex items-center gap-2 text-xs">
          {existing.length > 0 && (
            <button className="tab-btn" title="Copy the existing funds and amounts, then change them"
                    onClick={() => { if (!lines.length || window.confirm('Replace the suggested portfolio with a fresh copy of the existing one?'))
                      onChange(existing.filter(l => (l.amount ?? 0) > 0).map(l => ({ code: l.code, amount: l.amount }))) }}>
              {lines.length ? '↺ Duplicate existing again' : '⧉ Duplicate existing'}
            </button>
          )}
          {lines.length > 0 && <button className="tab-btn" onClick={() => { if (window.confirm('Clear the suggested portfolio?')) onChange([]) }}>Clear</button>}
        </div>
      </div>
      {codes.length > 0 && (
        <div className="flex flex-wrap gap-3 text-[11px] mb-2">
          {Object.entries(STATUS_COLOUR).filter(([k]) => counts[k]).map(([k, c]) => (
            <span key={k} style={{ color: c }}>● {counts[k]} {k.toLowerCase()}</span>
          ))}
        </div>
      )}
      {codes.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>
              <th className="text-left">Fund</th>
              <th style={{ textAlign: 'right' }}>Existing ₹</th>
              <th style={{ textAlign: 'right' }}>Suggested ₹</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th className="text-left">Status</th><th />
            </tr></thead>
            <tbody>
              {codes.map(code => {
                const f = fundByCode.get(code)
                const ex = exMap.get(code) ?? 0, sg = sgMap.get(code) ?? 0
                const st = statusOf(ex, sg), c = STATUS_COLOUR[st]
                const removed = st === 'Removed'
                return (
                  <tr key={code} style={{ background: st === 'Added' ? 'rgba(34,211,238,0.06)' : removed ? 'rgba(248,113,113,0.06)' : undefined }}>
                    <td style={{ maxWidth: 300 }}>
                      <div className="text-xs font-medium truncate" style={{ textDecoration: removed ? 'line-through' : undefined, opacity: removed ? 0.6 : 1 }}>
                        <FundLink code={code} name={f?.n ?? code} />
                      </div>
                      <div className="text-[10px]" style={{ color: f ? categoryColor(f.s) : 'var(--text-low)' }}>{f?.k}</div>
                    </td>
                    <td className="ret-cell text-xs" style={{ color: 'var(--text-mid)' }}>{ex ? inr(ex) : '—'}</td>
                    <td style={{ width: 140 }}>
                      <input type="number" min={0} step={10000} value={removed ? '' : (sgMap.has(code) ? (sgMap.get(code) || '') : '')}
                             placeholder={removed ? 'removed' : '₹ amount'}
                             onChange={e => setAmount(code, e.target.value === '' ? null : Math.max(0, +e.target.value))}
                             className="px-2 py-1 rounded text-xs w-full text-right" style={inputStyle} />
                    </td>
                    <td className="ret-cell text-xs font-semibold" style={{ color: c }}>
                      {sg - ex === 0 ? '—' : `${sg > ex ? '+' : '−'}${inr(Math.abs(sg - ex))}`}
                    </td>
                    <td className="text-[11px] font-semibold" style={{ color: c }}>{st}</td>
                    <td style={{ width: 28 }}>
                      {removed ? (
                        <button onClick={() => setAmount(code, ex)} title="Restore the existing amount"
                                style={{ background: 'none', border: 'none', color: 'var(--accent-a)', cursor: 'pointer' }}>↺</button>
                      ) : (
                        <button onClick={() => remove(code)} title="Remove from the suggested portfolio"
                                style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer' }}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="benchmark-row">
                <td className="text-xs font-semibold">Total</td>
                <td className="ret-cell text-xs font-semibold">{inr(exTotal)}</td>
                <td className="ret-cell text-xs font-semibold" style={{ paddingRight: 12 }}>{inr(sgTotal)}</td>
                <td className="ret-cell text-xs font-semibold">{sgTotal - exTotal === 0 ? '—' : `${sgTotal > exTotal ? '+' : '−'}${inr(Math.abs(sgTotal - exTotal))}`}</td>
                <td colSpan={2} className="text-[10px]" style={{ color: 'var(--text-low)' }}>
                  {sgTotal > exTotal + 0.5 ? 'fresh money' : sgTotal < exTotal - 0.5 ? 'not reinvested' : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!lines.length && existing.length > 0 && (
        <div className="text-xs py-3" style={{ color: 'var(--text-mid)' }}>
          Click <b>⧉ Duplicate existing</b> to start from the client&apos;s funds, then remove, add and change amounts.
        </div>
      )}
      <div className="mt-2">
        <FundPicker funds={index?.funds ?? []} value={pick} onChange={setPick} exclude={lines.filter(l => (l.amount ?? 0) > 0).map(l => l.code)}
                    onPick={f => { setAmount(f.c, sgMap.get(f.c) || null); setPick('') }}
                    placeholder="Add a fund to the suggested portfolio — type any part of its name…" style={inputStyle} />
      </div>
    </div>
  )
}

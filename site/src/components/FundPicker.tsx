// src/components/FundPicker.tsx — type part of a fund name, pick from the nearest
// matches. Replaces the browser's <datalist>, which only finds exact substrings:
// here "nipon small" or "axis bluechip" still lands on the right fund
// (utils/fuzzy). Arrow keys move, Enter picks, Escape closes.

import { useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '../utils/fuzzy'
import { categoryColor } from '../config/categoryColors'
import type { FundsIndex } from '../types'

export type IndexFund = FundsIndex['funds'][number]

const SHOWN = 8

/** The fund a typed text most likely means: exact label, else the closest name. */
export function bestFund(funds: IndexFund[], text: string): IndexFund | undefined {
  const t = text.trim()
  if (!t) return undefined
  return funds.find(f => f.n === t || `${f.n} — ${f.k}` === t) ?? fuzzyFilter(funds, t, f => f.n, 1)[0]
}

export default function FundPicker({ funds, value, onChange, onPick, placeholder, autoFocus, className, style, exclude }: {
  funds: IndexFund[]
  value: string
  onChange: (text: string) => void
  /** Called when a suggestion is chosen (click, or Enter on the highlighted one). */
  onPick: (fund: IndexFund) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  style?: React.CSSProperties
  /** Codes already chosen, left out of the suggestions. */
  exclude?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    if (!value.trim()) return []
    const pool = exclude?.length ? funds.filter(f => !exclude.includes(f.c)) : funds
    return fuzzyFilter(pool, value, f => f.n, SHOWN)
  }, [funds, value, exclude])

  const choose = (f: IndexFund) => { onPick(f); setOpen(false); setHi(0) }

  return (
    <div ref={box} className="relative flex-1" style={{ minWidth: 0 }}
         onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <input value={value} autoFocus={autoFocus} placeholder={placeholder}
             className={className ?? 'px-3 py-1.5 rounded-lg text-sm w-full'} style={{ width: '100%', ...style }}
             onChange={e => { onChange(e.target.value); setOpen(true); setHi(0) }}
             onFocus={() => setOpen(true)}
             onKeyDown={e => {
               if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, matches.length - 1)) }
               else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
               else if (e.key === 'Escape') setOpen(false)
               else if (e.key === 'Enter' && open && matches[hi]) { e.preventDefault(); choose(matches[hi]) }
             }}
             role="combobox" aria-expanded={open && matches.length > 0} aria-autocomplete="list" />
      {open && value.trim() !== '' && (
        <div className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-50"
             style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                      minWidth: 320 }}
             role="listbox">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-low)' }}>No fund looks like “{value}”.</div>
          ) : matches.map((f, i) => (
            <button key={f.c} type="button" tabIndex={-1} role="option" aria-selected={i === hi}
                    onMouseDown={e => e.preventDefault()} onClick={() => choose(f)} onMouseEnter={() => setHi(i)}
                    className="w-full text-left px-3 py-1.5 flex flex-col"
                    style={{ background: i === hi ? 'var(--bg-hover)' : 'transparent', border: 'none', cursor: 'pointer' }}>
              <span className="text-xs" style={{ color: 'var(--text-hi)' }}>{f.n}</span>
              <span className="text-[10px]" style={{ color: categoryColor(f.s) }}>{f.k}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

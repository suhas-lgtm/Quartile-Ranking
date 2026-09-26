// src/components/HeaderFundSearch.tsx — "Find a fund" in the header, on every tab.
// Picks with the same forgiving match as every other search box and opens the
// fund page.

import { useState } from 'react'
import { useJson } from '../hooks/useData'
import FundPicker from './FundPicker'
import { openFund } from './FundLink'
import type { FundsIndex } from '../types'

export default function HeaderFundSearch() {
  const { data } = useJson<FundsIndex>('funds_index.json')
  const [text, setText] = useState('')
  return (
    <div className="hidden md:block" style={{ width: 280 }}>
      <FundPicker funds={data?.funds ?? []} value={text} onChange={setText}
                  onPick={f => { setText(''); openFund(f.c) }}
                  placeholder="🔍 Find a fund…"
                  className="px-3 py-1 rounded-full text-xs w-full"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
                           color: '#fff', outline: 'none' }} />
    </div>
  )
}

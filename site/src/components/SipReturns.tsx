// src/components/SipReturns.tsx — what a monthly SIP in each Market Pulse index
// would have returned over 1, 3 and 5 years (XIRR), from the index files'
// own history. Shown under the index groups on Market Pulse.

import { useMemo, useState } from 'react'
import { MARKET_PULSE_GROUPS, indexGroup } from '../config/indices'
import type { IndexGroup } from '../config/indices'
import { fmtDate, fmtPct, retColor } from '../utils/format'
import { indexSip } from '../utils/navMath'
import type { IndexCard } from '../types'

const PERIODS: [string, number][] = [['1 Year', 12], ['3 Years', 36], ['5 Years', 60]]
const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')

export default function SipReturns({ indices }: { indices: IndexCard[] }) {
  const [group, setGroup] = useState<IndexGroup>('broad')
  const [amount, setAmount] = useState(10000)

  const rows = useMemo(() => indices
    .filter(i => indexGroup(i.index_id) === group && i.history?.length)
    .map(i => ({ i, sips: PERIODS.map(([, m]) => indexSip(i.history, m, amount)) })),
  [indices, group, amount])

  return (
    <div className="card p-4 mt-6">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>SIP Returns</div>
        <div className="tab-bar flex gap-1">
          {MARKET_PULSE_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)}
                    className={`tab-btn${group === g.key ? ' active accent' : ''}`}>{g.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs ml-auto" style={{ color: 'var(--text-mid)' }}>
          Monthly SIP ₹
          <input type="number" min={500} step={500} value={amount}
                 onChange={e => setAmount(Math.max(500, parseFloat(e.target.value) || 10000))}
                 className="px-2 py-1 rounded text-xs w-24"
                 style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
        </label>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-low)' }}>
        A fixed monthly investment into the index, one instalment a month, valued at the latest close. XIRR is the
        annualised return allowing for when each instalment went in. Hover a cell for the amount invested and its value.
        Index levels only (no dividends); in each market’s own currency.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="text-left" style={{ minWidth: 200 }}>Index</th>
              {PERIODS.map(([l]) => <th key={l} style={{ textAlign: 'right' }}>{l} SIP (XIRR)</th>)}
              <th style={{ textAlign: 'right' }}>As of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ i, sips }) => (
              <tr key={i.index_id}>
                <td className="text-xs font-medium">{i.index_name}</td>
                {sips.map((s, k) => (
                  <td key={k} className={`ret-cell font-semibold ${retColor(s?.xirr ?? null)}`}
                      title={s ? `Invested ${inr(s.invested)} → value ${inr(s.value)}` : 'Not enough history'}>
                    {s?.xirr == null ? '—' : fmtPct(s.xirr)}
                    {s && <div className="text-[10px] font-normal" style={{ color: 'var(--text-low)' }}>{inr(s.value)}</div>}
                  </td>
                ))}
                <td className="ret-cell text-[11px]" style={{ color: 'var(--text-low)' }}>{fmtDate(i.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

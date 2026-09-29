// src/components/CapSplit.tsx — Large / Mid / Small Cap split of some holdings,
// by SEBI's classification (AMFI's list, stock_caps.json). Weights are shares
// of the fund or portfolio; stocks not on the list (foreign, unlisted) show as
// "Other equity".

import { useJson } from '../hooks/useData'

export interface StockCaps { period: string; caps: Record<string, 'L' | 'M' | 'S'> }
export const CAP_COLOURS = { L: '#22D3EE', M: '#A78BFA', S: '#F59E0B', O: '#94A3B8' }
const LABEL = { L: 'Large Cap', M: 'Mid Cap', S: 'Small Cap', O: 'Other equity' }

export function useStockCaps() {
  return useJson<StockCaps>('stock_caps.json').data
}

/** {L, M, S, O} weights of the EQUITY holdings given (each {isin, weight, asset_class}). */
export function capSplit(rows: { isin: string; weight: number; asset_class?: string | null }[], caps: StockCaps | null) {
  const out = { L: 0, M: 0, S: 0, O: 0 }
  if (!caps) return out
  for (const r of rows) {
    if ((r.asset_class ?? 'Equity') !== 'Equity') continue
    const c = caps.caps[r.isin]
    out[c ?? 'O'] += r.weight
  }
  return out
}

export default function CapSplit({ split, period, compact }: {
  split: { L: number; M: number; S: number; O: number }; period?: string; compact?: boolean
}) {
  const total = split.L + split.M + split.S + split.O
  if (!total) return null
  const keys = (['L', 'M', 'S', 'O'] as const).filter(k => split[k] > 0.0005)
  return (
    <div className={compact ? '' : 'mt-3'}>
      {!compact && <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-mid)' }}>Market cap</div>}
      <div className="flex h-2.5 rounded overflow-hidden">
        {keys.map(k => <div key={k} style={{ width: `${(split[k] / total) * 100}%`, background: CAP_COLOURS[k] }} title={`${LABEL[k]}: ${(split[k] * 100).toFixed(1)}%`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[10px] mt-1" style={{ color: 'var(--text-mid)' }}>
        {keys.map(k => <span key={k}><span style={{ color: CAP_COLOURS[k] }}>●</span> {LABEL[k]} {(split[k] * 100).toFixed(1)}%</span>)}
      </div>
      {!compact && period && (
        <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>% of holdings, equity only · SEBI classification (AMFI, {period})</div>
      )}
    </div>
  )
}


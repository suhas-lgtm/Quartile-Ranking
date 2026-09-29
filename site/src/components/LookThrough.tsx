// src/components/LookThrough.tsx — a portfolio's holdings seen through its funds.
//
// Each fund's latest portfolio (/api/holdings) is weighted by that fund's share
// of the portfolio's value and added up by security, so a stock held by three
// funds shows once with its combined weight. Funds with no holdings loaded
// (Balanced Advantage, Multi Asset) are listed and left out of the weights.

import { Fragment, useEffect, useMemo, useState } from 'react'
import CapSplit, { capSplit, useStockCaps } from './CapSplit'

type Raw = { isin: string; name: string; industry: string; pct: number; asset_class?: string; sector?: string | null }
export interface LookRow {
  isin: string; name: string; industry: string; sector: string | null; asset_class: string
  /** Share of the whole portfolio. */
  weight: number
  /** Which funds hold it, and how much of the portfolio each contributes. */
  via: { name: string; weight: number }[]
}

export function useLookThrough(funds: { code: string; name: string; value: number }[]) {
  const [ports, setPorts] = useState<Record<string, { month: string | null; holdings: Raw[] } | null>>({})
  const key = funds.map(f => f.code).join(',')
  useEffect(() => {
    for (const f of funds) {
      if (f.code in ports) continue
      setPorts(p => ({ ...p, [f.code]: null }))
      fetch(`/api/holdings?code=${f.code}`).then(r => (r.ok ? r.json() : null))
        .then(d => setPorts(p => ({ ...p, [f.code]: d ?? { month: null, holdings: [] } })))
        .catch(() => setPorts(p => ({ ...p, [f.code]: { month: null, holdings: [] } })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(() => {
    const total = funds.reduce((s, f) => s + (f.value > 0 ? f.value : 0), 0)
    const rows = new Map<string, LookRow>()
    const missing: string[] = []
    let covered = 0
    const months = new Set<string>()
    for (const f of funds) {
      const p = ports[f.code]
      if (!p) continue
      if (!p.holdings.length) { missing.push(f.name); continue }
      if (p.month) months.add(p.month)
      const fw = total ? f.value / total : 0
      covered += fw
      for (const h of p.holdings) {
        const w = fw * (h.pct || 0)
        const r = rows.get(h.isin) ?? { isin: h.isin, name: h.name, industry: h.industry, sector: h.sector ?? null,
                                        asset_class: h.asset_class ?? 'Equity', weight: 0, via: [] }
        r.weight += w
        r.via.push({ name: f.name, weight: w })
        rows.set(h.isin, r)
      }
    }
    const list = [...rows.values()].sort((a, b) => b.weight - a.weight)
    const loading = funds.some(f => !ports[f.code])
    return { rows: list, covered, missing, loading, months: [...months].sort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports, key, funds.map(f => f.value).join(',')])
}

export default function LookThrough({ funds, title = 'Portfolio holdings (look-through)' }: {
  funds: { code: string; name: string; value: number }[]
  title?: string
}) {
  const lt = useLookThrough(funds)
  const caps = useStockCaps()
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  if (!funds.length) return null
  const shown = all ? lt.rows : lt.rows.slice(0, 10)
  const top10 = lt.rows.slice(0, 10).reduce((s, r) => s + r.weight, 0)
  const sectors = (() => {
    const m = new Map<string, number>()
    for (const r of lt.rows) m.set(r.sector || r.industry || 'Other', (m.get(r.sector || r.industry || 'Other') ?? 0) + r.weight)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  })()
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{title}</div>
        {lt.months.length > 0 && <span className="text-xs" style={{ color: 'var(--text-low)' }}>portfolios of {lt.months.join(', ')}</span>}
        {!lt.loading && lt.rows.length > 0 && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-mid)' }}>
            {lt.rows.filter(r => r.asset_class === 'Equity').length} stocks in all · top 10 = <b>{(top10 * 100).toFixed(1)}%</b> of the portfolio
          </span>
        )}
      </div>
      {lt.loading && !lt.rows.length ? <div className="skeleton h-24 w-full" /> : !lt.rows.length ? (
        <div className="text-xs" style={{ color: 'var(--text-low)' }}>No holdings are available for these funds yet.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Holding</th>
                  <th className="text-left">Industry</th>
                  <th style={{ textAlign: 'right' }}>Of portfolio</th>
                  <th style={{ textAlign: 'right' }}>Via</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <Fragment key={r.isin}>
                    <tr>
                      <td className="text-xs truncate" style={{ maxWidth: 260 }} title={r.name}>{r.name}</td>
                      <td className="text-[10px] truncate" style={{ color: 'var(--text-low)', maxWidth: 150 }}>{r.industry || r.asset_class}</td>
                      <td className="ret-cell text-xs font-semibold">{(r.weight * 100).toFixed(2)}%</td>
                      <td className="ret-cell text-[11px]">
                        <button onClick={() => setOpen(open === r.isin ? null : r.isin)}
                                style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          {r.via.length} fund{r.via.length === 1 ? '' : 's'} {open === r.isin ? '▴' : '▾'}
                        </button>
                      </td>
                    </tr>
                    {open === r.isin && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--bg-raised)' }}>
                          <div className="flex flex-wrap gap-2 p-1.5 text-[11px]">
                            {r.via.sort((a, b) => b.weight - a.weight).map(v => (
                              <span key={v.name} className="px-2 py-0.5 rounded" style={{ border: '1px solid var(--line)' }}>
                                {v.name} · <b>{(v.weight * 100).toFixed(2)}%</b>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {lt.rows.length > 10 && (
              <button onClick={() => setAll(a => !a)} className="tab-btn mt-2 text-xs">
                {all ? '▴ Show top 10 only' : `▾ Show all ${lt.rows.length} holdings`}
              </button>
            )}
          </div>
          <div>
            <CapSplit split={capSplit(lt.rows, caps)} period={caps?.period} compact={false} />
            <div className="text-xs font-semibold mb-1 mt-3" style={{ color: 'var(--text-mid)' }}>Sectors</div>
            {sectors.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[11px] py-0.5">
                <span className="truncate" style={{ width: 140, color: 'var(--text-mid)' }} title={k}>{k}</span>
                <div className="flex-1 h-2 rounded" style={{ background: 'var(--bg-raised)' }}>
                  <div className="h-2 rounded" style={{ width: `${Math.min(100, (v / (sectors[0][1] || 1)) * 100)}%`, background: 'var(--accent-a)' }} />
                </div>
                <span className="ret-cell" style={{ width: 44 }}>{(v * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>
        Each fund&apos;s latest monthly portfolio, weighted by its share of the portfolio&apos;s value today, added up per holding —
        a stock held by several funds shows once. Click “Via” to see which funds hold it.
        {lt.covered > 0 && lt.covered < 0.999 && <> Holdings cover {(lt.covered * 100).toFixed(0)}% of the portfolio.</>}
        {lt.missing.length > 0 && <> No holdings for: {lt.missing.join(', ')} (Balanced Advantage / Multi Asset funds are not loaded).</>}
      </p>
    </div>
  )
}

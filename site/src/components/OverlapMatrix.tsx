// src/components/OverlapMatrix.tsx — how much of two funds' portfolios is the
// same stocks. Overlap = sum over stocks both hold of the SMALLER of the two
// weights (the standard portfolio-overlap measure): 60% means 60% of each fund
// is invested identically. Equity holdings only, latest month from /api/holdings.

import { useEffect, useMemo, useState } from 'react'

type Holding = { isin: string; name: string; pct: number; asset_class?: string }
type Port = { month: string | null; holdings: Holding[] }

function colour(v: number | null): string {
  if (v == null) return 'transparent'
  if (v >= 0.6) return 'rgba(248,113,113,0.45)'
  if (v >= 0.4) return 'rgba(248,113,113,0.25)'
  if (v >= 0.2) return 'rgba(245,158,11,0.22)'
  return 'rgba(52,211,153,0.3)'
}

export default function OverlapMatrix({ funds }: { funds: { code: string; name: string }[] }) {
  const [ports, setPorts] = useState<Record<string, Port | null>>({})
  useEffect(() => {
    for (const f of funds) {
      if (f.code in ports) continue
      setPorts(p => ({ ...p, [f.code]: null }))
      fetch(`/api/holdings?code=${f.code}`).then(r => (r.ok ? r.json() : null))
        .then(d => setPorts(p => ({ ...p, [f.code]: d ?? { month: null, holdings: [] } })))
        .catch(() => setPorts(p => ({ ...p, [f.code]: { month: null, holdings: [] } })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds.map(f => f.code).join(',')])

  const eq = useMemo(() => Object.fromEntries(Object.entries(ports).map(([c, p]) => [c,
    new Map((p?.holdings ?? []).filter(h => (h.asset_class ?? 'Equity') === 'Equity').map(h => [h.isin, h]))])), [ports])

  const overlap = (a: string, b: string) => {
    const A = eq[a], B = eq[b]
    if (!A?.size || !B?.size) return null
    let w = 0
    const common: { name: string; a: number; b: number }[] = []
    for (const [isin, h] of A) {
      const o = B.get(isin)
      if (o) { w += Math.min(h.pct, o.pct); common.push({ name: h.name, a: h.pct, b: o.pct }) }
    }
    common.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b))
    return { w, n: common.length, common }
  }

  if (funds.length < 2) return null
  const missing = funds.filter(f => ports[f.code] && !eq[f.code]?.size)
  const short = (n: string) => (n.length > 26 ? n.slice(0, 25) + '…' : n)
  const months = [...new Set(funds.map(f => ports[f.code]?.month).filter(Boolean))]

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Portfolio overlap</div>
        {months.length > 0 && <span className="text-xs" style={{ color: 'var(--text-low)' }}>holdings as of {months.join(', ')}</span>}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sticky-col text-left" style={{ minWidth: 200 }}>Fund</th>
              {funds.map((f, i) => <th key={f.code} title={f.name} style={{ textAlign: 'center', minWidth: 70, fontSize: 11 }}>#{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {funds.map((fa, i) => (
              <tr key={fa.code}>
                <td className="sticky-col text-xs truncate" style={{ maxWidth: 240 }} title={fa.name}>
                  <span style={{ color: 'var(--text-low)' }}>#{i + 1}</span> {short(fa.name)}
                </td>
                {funds.map((fb, j) => {
                  if (i === j) return <td key={fb.code} className="text-center text-xs" style={{ color: 'var(--text-low)' }}>—</td>
                  if (!ports[fa.code] || !ports[fb.code]) return <td key={fb.code} className="text-center text-xs" style={{ color: 'var(--text-low)' }}>…</td>
                  const o = overlap(fa.code, fb.code)
                  return (
                    <td key={fb.code} className="text-center text-xs font-semibold" style={{ background: colour(o?.w ?? null), color: 'var(--text-hi)' }}
                        title={o ? `${fa.name}\n${fb.name}\n${(o.w * 100).toFixed(1)}% overlap · ${o.n} common stocks\n` +
                          o.common.slice(0, 8).map(c => `• ${c.name.slice(0, 40)} ${(c.a * 100).toFixed(1)}% / ${(c.b * 100).toFixed(1)}%`).join('\n')
                          : 'No equity holdings available for one of the two'}>
                      {o ? `${(o.w * 100).toFixed(0)}%` : 'n/a'}
                      {o && <div className="text-[10px] font-normal" style={{ color: 'var(--text-low)' }}>{o.n} stocks</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>
          No holdings for: {missing.map(f => f.name).join(', ')} (Balanced Advantage and Multi Asset funds are not loaded).
        </div>
      )}
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-low)' }}>
        Overlap = the part of the two portfolios invested in the same stocks (for each common stock, the smaller of its two
        weights, added up). <span style={{ background: 'rgba(248,113,113,0.35)', padding: '0 4px' }}>60%+</span> means the two funds
        are largely the same portfolio; <span style={{ background: 'rgba(52,211,153,0.3)', padding: '0 4px' }}>below 20%</span> they
        hold mostly different stocks. Equity holdings, latest monthly portfolio. Hover a cell for the biggest common stocks.
      </p>
    </div>
  )
}

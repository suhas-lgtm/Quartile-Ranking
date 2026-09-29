// src/components/SectorBars.tsx — sector split with the industries under each
// sector spelled out ("Financial Services" → Banks, Finance, Insurance…), taken
// from the holdings themselves, so it is clear what each sector is made of.

export interface SectorRow { sector?: string | null; industry?: string | null; weight: number; asset_class?: string | null }
export interface SectorGroup { sector: string; weight: number; industries: { name: string; weight: number }[] }

/** Equity holdings grouped by sector, each with its industries, largest first. */
export function sectorBreakdown(rows: SectorRow[]): SectorGroup[] {
  const m = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if ((r.asset_class ?? 'Equity') !== 'Equity' || !(r.weight > 0)) continue
    const sec = r.sector || r.industry || 'Other'
    const ind = r.industry || sec
    const inner = m.get(sec) ?? new Map<string, number>()
    inner.set(ind, (inner.get(ind) ?? 0) + r.weight)
    m.set(sec, inner)
  }
  return [...m.entries()].map(([sector, inner]) => {
    const industries = [...inner.entries()].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight)
    return { sector, weight: industries.reduce((s, i) => s + i.weight, 0), industries }
  }).sort((a, b) => b.weight - a.weight)
}

/** "Banks 18.2% · Finance 4.1% · Insurance 2.0%" — the industries inside one sector. */
export function industryLine(g: SectorGroup | undefined, max = 5): string {
  if (!g) return ''
  const shown = g.industries.slice(0, max).map(i => `${i.name} ${(i.weight * 100).toFixed(1)}%`)
  return shown.join(' · ') + (g.industries.length > max ? ` · +${g.industries.length - max} more` : '')
}

export default function SectorBars({ rows, max = 8, colour = 'var(--accent-a)', title = 'Sectors' }: {
  rows: SectorRow[]; max?: number; colour?: string; title?: string | null
}) {
  const groups = sectorBreakdown(rows).slice(0, max)
  if (!groups.length) return null
  const top = groups[0].weight || 1
  return (
    <div className="mt-3">
      {title && <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-mid)' }}>{title}</div>}
      {groups.map(g => (
        <div key={g.sector} className="py-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate font-medium" style={{ width: 150, color: 'var(--text-hi)' }} title={g.sector}>{g.sector}</span>
            <div className="flex-1 h-2 rounded" style={{ background: 'var(--bg-raised)' }}>
              <div className="h-2 rounded" style={{ width: `${Math.min(100, (g.weight / top) * 100)}%`, background: colour }} />
            </div>
            <span className="ret-cell" style={{ width: 44 }}>{(g.weight * 100).toFixed(1)}%</span>
          </div>
          <div className="text-[10px] leading-snug" style={{ color: 'var(--text-low)', paddingLeft: 2 }} title={industryLine(g, 99)}>
            {industryLine(g)}
          </div>
        </div>
      ))}
    </div>
  )
}

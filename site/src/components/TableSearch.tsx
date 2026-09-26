// src/components/TableSearch.tsx — the search box above a fund table. Matching is
// forgiving (utils/fuzzy): typos, "midcap" for "Mid Cap", PPFAS for Parag Parikh.

export default function TableSearch({ value, onChange, count, total }: {
  value: string
  onChange: (v: string) => void
  /** Rows left after the search, and before it, shown when searching. */
  count?: number
  total?: number
}) {
  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <input type="search" value={value} onChange={e => onChange(e.target.value)}
             placeholder="Search fund (spelling need not be exact)…"
             className="px-3 py-1.5 rounded-lg text-sm w-full sm:w-80"
             style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }} />
      {value.trim() && count != null && total != null && (
        <span className="text-xs" style={{ color: 'var(--text-low)' }}>{count} of {total} funds match</span>
      )}
    </div>
  )
}

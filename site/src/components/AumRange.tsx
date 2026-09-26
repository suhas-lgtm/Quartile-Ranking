// src/components/AumRange.tsx — a fund-size range: minimum, maximum, or both.
//
// Either box may be left empty: only a minimum means "above X", only a maximum
// "below Y", both "between X and Y", neither "no limit". AUM is AMFI's quarterly
// average (all plans of the fund), the only per-fund AUM AMFI publishes.

export interface AumRangeValue { min: number | null; max: number | null }

/** Is this AUM inside the range? An unknown AUM is never excluded. */
export function inAumRange(aum: number | null | undefined, r: AumRangeValue): boolean {
  if (aum == null) return true
  if (r.min != null && aum < r.min) return false
  if (r.max != null && aum > r.max) return false
  return true
}

const cr = (v: number) => `₹${v.toLocaleString('en-IN')} Cr`

export function describeAumRange(r: AumRangeValue): string {
  if (r.min != null && r.max != null) return `between ${cr(r.min)} and ${cr(r.max)}`
  if (r.min != null) return `above ${cr(r.min)}`
  if (r.max != null) return `below ${cr(r.max)}`
  return 'any size'
}

const toNum = (v: string) => (v.trim() === '' ? null : Math.max(0, parseFloat(v) || 0))

export default function AumRange({ value, onChange, period, title = 'Fund AUM range' }: {
  value: AumRangeValue
  onChange: (v: AumRangeValue) => void
  /** e.g. "April - June 2026", shown so nobody takes it for month-end AUM. */
  period?: string | null
  title?: string
}) {
  const box = 'w-24 px-1.5 py-0.5 rounded text-right text-xs'
  const style = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }
  return (
    <div className="pt-3 mt-2 border-t text-xs" style={{ borderColor: 'var(--line)', color: 'var(--text-hi)' }}>
      <div className="font-semibold mb-1">{title}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input type="number" min={0} step={100} placeholder="min" value={value.min ?? ''}
               onChange={e => onChange({ ...value, min: toNum(e.target.value) })} className={box} style={style}
               title="Minimum AUM in ₹ crore; leave empty for no minimum" />
        <span style={{ color: 'var(--text-low)' }}>to</span>
        <input type="number" min={0} step={100} placeholder="max" value={value.max ?? ''}
               onChange={e => onChange({ ...value, max: toNum(e.target.value) })} className={box} style={style}
               title="Maximum AUM in ₹ crore; leave empty for no maximum" />
        <span style={{ color: 'var(--text-low)' }}>₹ Cr</span>
      </div>
      <div className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--text-low)' }}>
        Now: <b style={{ color: 'var(--text-mid)' }}>{describeAumRange(value)}</b>. Fill one box or both.
        AUM is AMFI&apos;s <b>quarterly average</b>{period ? ` for ${period}` : ''} (all plans) — AMFI does not publish
        month-end AUM per fund.
      </div>
    </div>
  )
}

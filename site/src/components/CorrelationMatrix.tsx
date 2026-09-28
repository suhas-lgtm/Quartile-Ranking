// src/components/CorrelationMatrix.tsx — how closely a set of funds move together.
//
// Pearson correlation of daily, weekly or monthly returns (last NAV of each
// period to the next, split-adjusted) over the last `months` months both funds
// have. Monthly is the default: daily NAVs of funds holding the same market are
// dominated by that day's market move and read as ~0.9 for almost any pair,
// which hides the differences that matter for diversification.

import { useMemo, useState } from 'react'

export interface NavSeries { points: [string, number][]; splits?: { date: string; factor: number }[] }

/** Restate NAVs in today's units across unit splits. */
export function adjustSplits(s: NavSeries): [string, number][] {
  const splits = s.splits ?? []
  if (!splits.length) return s.points
  return s.points.map(([d, v]) => [d, v / splits.filter(x => x.date > d).reduce((p, x) => p * x.factor, 1)])
}

export type Freq = 'daily' | 'weekly' | 'monthly'

/** The bucket a date falls in: the day itself, its week (by Monday), or its month. */
function bucket(d: string, f: Freq): string {
  if (f === 'daily') return d
  if (f === 'monthly') return d.slice(0, 7)
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))      // back to Monday
  return t.toISOString().slice(0, 10)
}

/** {bucket: return} from the last NAV of each day / week / month to the next one's. */
function periodReturns(points: [string, number][], f: Freq): Map<string, number> {
  const last = new Map<string, number>()
  for (const [d, v] of points) last.set(bucket(d, f), v)         // points are ascending
  const keys = [...last.keys()].sort()
  const out = new Map<string, number>()
  for (let i = 1; i < keys.length; i++) {
    const a = last.get(keys[i - 1])!, b = last.get(keys[i])!
    if (a > 0) out.set(keys[i], b / a - 1)
  }
  return out
}

/** Returns per month at each frequency, and the fewest that make a correlation. */
const PER_MONTH: Record<Freq, number> = { daily: 21, weekly: 4.33, monthly: 1 }
const MIN_POINTS: Record<Freq, number> = { daily: 40, weekly: 12, monthly: 12 }

function pearson(xs: number[], ys: number[], min = 12): number | null {
  const n = xs.length
  if (n < min) return null
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

/** Correlation and the number of common returns, over the latest `months` of both. */
export function correlation(a: Map<string, number>, b: Map<string, number>, months: number, f: Freq = 'monthly') {
  const common = [...a.keys()].filter(k => b.has(k)).sort().slice(-Math.round(months * PER_MONTH[f]))
  return { r: pearson(common.map(k => a.get(k)!), common.map(k => b.get(k)!), MIN_POINTS[f]), n: common.length }
}

function colour(r: number | null): string {
  if (r == null) return 'transparent'
  // Low correlation = diversifies (green); near 1 = the same bet (red).
  if (r >= 0.95) return 'rgba(248,113,113,0.45)'
  if (r >= 0.85) return 'rgba(248,113,113,0.25)'
  if (r >= 0.7) return 'rgba(245,158,11,0.22)'
  if (r >= 0.5) return 'rgba(52,211,153,0.18)'
  return 'rgba(52,211,153,0.35)'
}

const WINDOWS: [string, number][] = [['3M', 3], ['6M', 6], ['1Y', 12], ['3Y', 36], ['5Y', 60]]
const FREQ_LABEL: Record<Freq, [string, string]> = {
  daily: ['Daily', 'daily'], weekly: ['Weekly', 'weekly'], monthly: ['Monthly', 'monthly'],
}
/** Windows too short for a frequency (fewer returns than MIN_POINTS). */
const tooShort = (months: number, f: Freq) => months * PER_MONTH[f] < MIN_POINTS[f]

export default function CorrelationMatrix({ funds }: {
  /** In display order; a fund whose series has not loaded yet is shown as pending. */
  funds: { code: string; name: string; series?: NavSeries | null }[]
}) {
  const [months, setMonths] = useState(36)
  const [freq, setFreq] = useState<Freq>('monthly')
  const rets = useMemo(() => new Map(funds.filter(f => f.series?.points?.length)
    .map(f => [f.code, periodReturns(adjustSplits(f.series!), freq)])), [funds, freq])

  const pairs = useMemo(() => {
    const out: { a: string; b: string; r: number }[] = []
    for (let i = 0; i < funds.length; i++) for (let j = i + 1; j < funds.length; j++) {
      const ra = rets.get(funds[i].code), rb = rets.get(funds[j].code)
      if (!ra || !rb) continue
      const { r } = correlation(ra, rb, months, freq)
      if (r != null) out.push({ a: funds[i].name, b: funds[j].name, r })
    }
    return out
  }, [funds, rets, months, freq])

  if (funds.length < 2) return null
  const avg = pairs.length ? pairs.reduce((s, p) => s + p.r, 0) / pairs.length : null
  const most = pairs.length ? pairs.reduce((m, p) => (p.r > m.r ? p : m)) : null
  const least = pairs.length ? pairs.reduce((m, p) => (p.r < m.r ? p : m)) : null
  const short = (n: string) => (n.length > 26 ? n.slice(0, 25) + '…' : n)

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Correlation between funds</div>
        <div className="tab-bar flex gap-1" title="Which returns are compared">
          {(Object.keys(FREQ_LABEL) as Freq[]).map(f => (
            <button key={f} onClick={() => { setFreq(f); if (tooShort(months, f)) setMonths(12) }}
                    className={`tab-btn${freq === f ? ' active accent' : ''}`}>{FREQ_LABEL[f][0]}</button>
          ))}
        </div>
        <div className="tab-bar flex gap-1" title="Over how long">
          {WINDOWS.map(([l, m]) => {
            const off = tooShort(m, freq)
            return (
              <button key={l} onClick={() => { if (!off) setMonths(m) }} disabled={off}
                      title={off ? `Too few ${FREQ_LABEL[freq][1]} returns in ${l} — pick Daily or Weekly` : undefined}
                      className={`tab-btn${months === m ? ' active accent' : ''}`} style={off ? { opacity: 0.35 } : undefined}>{l}</button>
            )
          })}
        </div>
        {avg != null && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-mid)' }}>
            Average: <b style={{ color: avg >= 0.85 ? '#F87171' : avg >= 0.7 ? '#F59E0B' : '#34D399' }}>{avg.toFixed(2)}</b>
            {avg >= 0.85 ? ' — these funds largely move together' : avg >= 0.7 ? ' — some diversification' : ' — well diversified'}
          </span>
        )}
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sticky-col text-left" style={{ minWidth: 200 }}>Fund</th>
              {funds.map((f, i) => (
                <th key={f.code} title={f.name} style={{ textAlign: 'center', minWidth: 64, fontSize: 11 }}>#{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {funds.map((fa, i) => (
              <tr key={fa.code}>
                <td className="sticky-col text-xs truncate" style={{ maxWidth: 240 }} title={fa.name}>
                  <span style={{ color: 'var(--text-low)' }}>#{i + 1}</span> {short(fa.name)}
                </td>
                {funds.map((fb, j) => {
                  if (i === j) return <td key={fb.code} className="text-center text-xs" style={{ color: 'var(--text-low)' }}>1.00</td>
                  const ra = rets.get(fa.code), rb = rets.get(fb.code)
                  if (!ra || !rb) return <td key={fb.code} className="text-center text-xs" style={{ color: 'var(--text-low)' }}>…</td>
                  const { r, n } = correlation(ra, rb, months, freq)
                  return (
                    <td key={fb.code} className="text-center text-xs font-semibold"
                        style={{ background: colour(r), color: 'var(--text-hi)' }}
                        title={r == null ? `Only ${n} common ${FREQ_LABEL[freq][1]} returns — not enough to measure`
                          : `${fa.name}
${fb.name}
${r.toFixed(2)} over ${n} ${FREQ_LABEL[freq][1]} returns`}>
                      {r == null ? '—' : r.toFixed(2)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {most && least && pairs.length > 1 && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--text-mid)' }}>
          Most alike: <b>{short(most.a)}</b> &amp; <b>{short(most.b)}</b> ({most.r.toFixed(2)}) ·
          {' '}Most different: <b>{short(least.a)}</b> &amp; <b>{short(least.b)}</b> ({least.r.toFixed(2)})
        </div>
      )}
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-low)' }}>
        How closely two funds&apos; <b>{FREQ_LABEL[freq][1]}</b> returns moved together over the last{' '}
        {months < 12 ? `${months} months` : `${months / 12} year${months > 12 ? 's' : ''}`} they both existed: <b>1.00</b> = in step every month, <b>0</b> = unrelated, below 0 = opposite. Above ~0.90 two funds are
        largely the same bet and holding both adds little diversification; below ~0.70 they behave differently.
        <span style={{ background: 'rgba(248,113,113,0.3)', padding: '0 4px', marginLeft: 4 }}>red</span> high,
        <span style={{ background: 'rgba(245,158,11,0.22)', padding: '0 4px', marginLeft: 4 }}>amber</span> moderate,
        <span style={{ background: 'rgba(52,211,153,0.3)', padding: '0 4px', marginLeft: 4 }}>green</span> low.
        Daily returns read higher for almost any pair (the whole market moves together day to day); monthly shows the
        real difference and is the default. Needs at least {MIN_POINTS[freq]} common {FREQ_LABEL[freq][1]} returns.
        Hover a cell for the fund names.
      </p>
    </div>
  )
}

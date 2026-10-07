// src/sections/sif/SifSection.tsx — the SIF desk: Specialised Investment Funds.
//
// Tabs: NAV & Returns, Point to Point, Compare SIFs, SIF NFOs. Data from
// sif.json / sif_nfo.json (build_json.build_sif). AMFI publishes only each SIF's
// latest NAV, so history — and with it period returns, point-to-point and the
// comparison chart — grows from the day collection started; "since launch" is
// measured from the launch price (₹10 or ₹1,000 a unit) — see build_json.sif_since_launch.

import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useJson } from '../../hooks/useData'
import { fmtDate, fmtPct, retColor } from '../../utils/format'
import { fuzzyMatcher } from '../../utils/fuzzy'
import TableSearch from '../../components/TableSearch'
import FundPicker, { type IndexFund } from '../../components/FundPicker'
import type { SifData, SifNfoData, SifPeriod, SifPlan } from './types'

const PERIODS: SifPeriod[] = ['1D', '1W', '1M', '3M', '6M', '1Y']
const PALETTE = ['#22D3EE', '#F59E0B', '#A78BFA', '#34D399', '#F472B6']

function useSif() {
  return useJson<SifData>('sif.json')
}

/** NAV on or before a date from a plan's collected history. */
function navOn(p: SifPlan, d: string): [string, number] | null {
  let hit: [string, number] | null = null
  for (const pt of p.history) { if (pt[0] <= d) hit = pt; else break }
  return hit
}

function Filters({ growthOnly, setGrowthOnly }: { growthOnly: boolean; setGrowthOnly: (b: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
      <span style={{ color: 'var(--text-low)' }}>Regular plans only.</span>
      <label className="flex items-center gap-1.5" style={{ color: 'var(--text-mid)' }}>
        <input type="checkbox" checked={growthOnly} onChange={e => setGrowthOnly(e.target.checked)} /> Growth option only
      </label>
    </div>
  )
}

function useFiltered(data: SifData | null) {
  const [growthOnly, setGrowthOnly] = useState(true)
  const [query, setQuery] = useState('')
  const plans = useMemo(() => {
    const hit = fuzzyMatcher(query)
    return (data?.plans ?? []).filter(p => (!growthOnly || /growth/i.test(p.option ?? ''))
      && (hit(p.name) || hit(p.house ?? '') || hit(p.strategy)))
  }, [data, growthOnly, query])
  return { plans, growthOnly, setGrowthOnly, query, setQuery }
}

function HistoryNote({ data }: { data: SifData }) {
  const from = data.plans.map(p => p.history_from).filter(Boolean).sort()[0]
  return (
    <div className="card p-3 mb-3 text-xs" style={{ color: 'var(--text-mid)' }}>
      Daily NAVs from AMFI{from ? <>, since <b>{fmtDate(from)}</b></> : null}. <b>Since launch</b> is measured from each SIF&apos;s
      launch price (₹10 or ₹1,000 a unit, read off its first NAV); it is left blank for IDCW options, whose payouts lower the NAV,
      and where the NAV history does not reach back to the launch.
      Risk ratios and quartiles will be added once about a year of history exists.
    </div>
  )
}

// ── NAV & Returns ────────────────────────────────────────────────────────────
function NavTab() {
  const { data, loading } = useSif()
  const f = useFiltered(data)
  const byStrategy = useMemo(() => {
    const m = new Map<string, SifPlan[]>()
    for (const p of f.plans) (m.get(p.strategy) ?? m.set(p.strategy, []).get(p.strategy)!).push(p)
    return [...m.entries()]
  }, [f.plans])
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  return (
    <>
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {[['SIF houses', String(new Set(data.plans.map(p => p.house)).size)],
          ['Strategies', String(new Set(data.plans.map(p => p.strategy)).size)],
          ['Plans listed', String(data.plans.length)],
          ['NAV date', fmtDate(data.as_of)]].map(([l, v]) => (
          <div key={l} className="card p-3">
            <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{l}</div>
            <div className="font-display font-bold text-lg" style={{ color: 'var(--text-hi)' }}>{v}</div>
          </div>
        ))}
      </div>
      <HistoryNote data={data} />
      <Filters {...f} />
      <TableSearch value={f.query} onChange={f.setQuery} count={f.plans.length} total={data.plans.length} />
      <div className="card overflow-hidden mb-4">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col text-left" style={{ minWidth: 280 }}>SIF · strategy</th>
                <th className="text-left">Plan</th>
                <th style={{ textAlign: 'right' }}>NAV</th>
                <th style={{ textAlign: 'right' }}>Date</th>
                <th style={{ textAlign: 'right' }}>Launched</th>
                <th style={{ textAlign: 'right' }} title="NAV against the launch price (₹10 or ₹1,000); blank for IDCW options or when the history does not reach the launch">Since launch</th>
                {PERIODS.map(p => <th key={p} style={{ textAlign: 'right' }}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {byStrategy.map(([strategy, rows]) => (
                <GroupRows key={strategy} title={strategy} span={6 + PERIODS.length}>
                  {rows.map(p => (
                    <tr key={p.id}>
                      <td className="sticky-col" style={{ maxWidth: 320 }}>
                        <div className="text-xs font-medium truncate" title={p.name}>{p.name}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{p.house}</div>
                      </td>
                      <td className="text-xs" style={{ color: 'var(--text-mid)' }}>{(p.plan ?? '').replace(' Plan', '')} · {p.option}</td>
                      <td className="ret-cell font-semibold">{p.nav.toFixed(4)}</td>
                      <td className="ret-cell text-[11px]" style={{ color: 'var(--text-low)' }}>{fmtDate(p.date)}</td>
                      <td className="ret-cell text-[11px]" style={{ color: 'var(--text-low)' }}
                          title={p.days_live != null ? `${p.days_live} days ago` : undefined}>{fmtDate(p.launch_date ?? null)}</td>
                      <td className={`ret-cell font-semibold ${retColor(p.since_launch)}`}>{fmtPct(p.since_launch)}</td>
                      {PERIODS.map(k => <td key={k} className={`ret-cell ${retColor(p.returns[k])}`}>{fmtPct(p.returns[k])}</td>)}
                    </tr>
                  ))}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function GroupRows({ title, span, children }: { title: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="sector-row">
        <td className="sticky-col text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent-a)' }}>{title}</td>
        <td colSpan={span - 1} />
      </tr>
      {children}
    </>
  )
}


// ── Leaderboard ──────────────────────────────────────────────────────────────
type LeadKey = 'since_launch' | 'since_launch_ann' | SifPeriod
const LEAD_LABEL: Record<LeadKey, string> = {
  since_launch: 'Since launch', since_launch_ann: 'Since launch p.a.',
  '1D': '1D', '1W': '1W', '1M': '1M', '3M': '3M', '6M': '6M', '1Y': '1Y',
}

function LeadersTab() {
  const { data, loading } = useSif()
  const [key, setKey] = useState<LeadKey>('since_launch')
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  const val = (p: SifPlan) => (key === 'since_launch' ? p.since_launch : key === 'since_launch_ann' ? p.since_launch_ann ?? null : p.returns[key])
  const growth = data.plans.filter(p => /growth/i.test(p.option ?? ''))
  const groups = [...new Set(growth.map(p => p.strategy))].sort()
  const available = (Object.keys(LEAD_LABEL) as LeadKey[]).filter(k => growth.some(p => (k === 'since_launch' ? p.since_launch
    : k === 'since_launch_ann' ? p.since_launch_ann : p.returns[k]) != null))
  return (
    <>
      <HistoryNote data={data} />
      <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
        <span style={{ color: 'var(--text-mid)' }}>Rank by:</span>
        <div className="tab-bar flex gap-1">
          {(Object.keys(LEAD_LABEL) as LeadKey[]).map(k => {
            const on = available.includes(k)
            return (
              <button key={k} onClick={() => on && setKey(k)} disabled={!on} className={`tab-btn${key === k ? ' active accent' : ''}`}
                      style={on ? undefined : { opacity: 0.35 }} title={on ? undefined : 'Not enough history collected yet'}>
                {LEAD_LABEL[k]}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {groups.map(g => {
          const rows = growth.filter(p => p.strategy === g).sort((a, b) => (val(b) ?? -9) - (val(a) ?? -9))
          const best = val(rows[0])
          return (
            <div key={g} className="card p-4">
              <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--accent-a)' }}>{g}</div>
              {rows.map((p, i) => {
                const v = val(p)
                return (
                  <div key={p.id} className="flex items-center gap-2 py-1 text-xs border-b" style={{ borderColor: 'var(--line)' }}>
                    <span className="w-6 text-center font-bold" style={{ color: i === 0 ? '#F59E0B' : 'var(--text-low)' }}>
                      {v == null ? '–' : i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span className="flex-1 truncate" title={p.name}>
                      {p.name.replace(/\s*-\s*Regular.*$/i, '')}
                      <span className="text-[10px] ml-1" style={{ color: 'var(--text-low)' }}>{p.house} · {p.days_live != null ? `${p.days_live}d old` : ''}</span>
                    </span>
                    <div className="w-24 h-2 rounded" style={{ background: 'var(--bg-raised)' }}>
                      {v != null && best != null && best > 0 && v > 0 && (
                        <div className="h-2 rounded" style={{ width: `${Math.min(100, (v / best) * 100)}%`, background: '#34D399' }} />
                      )}
                    </div>
                    <span className={`w-16 text-right font-semibold ${retColor(v)}`}>{fmtPct(v)}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-low)' }}>
        Growth option of each strategy, ranked within its SEBI strategy type. <b>Since launch</b> favours older strategies —
        they have had longer to grow; <b>Since launch p.a.</b> (for strategies over a year old) and the period returns compare
        like with like as history builds up.
      </p>
    </>
  )
}

// ── Strategy details ─────────────────────────────────────────────────────────
function DetailsTab() {
  const { data, loading } = useSif()
  const [query, setQuery] = useState('')
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  const hit = fuzzyMatcher(query)
  // One card per strategy: its Growth option (or the first plan listed).
  const byName = new Map<string, SifPlan>()
  for (const p of data.plans) {
    const k = p.name.replace(/\s*-\s*Regular.*$/i, '').toLowerCase()
    const cur = byName.get(k)
    if (!cur || (/growth/i.test(p.option ?? '') && !/growth/i.test(cur.option ?? ''))) byName.set(k, p)
  }
  const list = [...byName.values()].filter(p => hit(p.name) || hit(p.house ?? '') || hit(p.strategy))
    .sort((a, b) => (a.launch_date ?? '').localeCompare(b.launch_date ?? ''))
  return (
    <>
      <TableSearch value={query} onChange={setQuery} count={list.length} total={byName.size} />
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
        {list.map(p => (
          <div key={p.id} className="card p-4 flex flex-col gap-2">
            <div>
              <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{p.name.replace(/\s*-\s*Regular.*$/i, '')}</div>
              <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{p.house} · <span style={{ color: 'var(--accent-a)' }}>{p.strategy}</span></div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-[11px]">
              {[['Launched', fmtDate(p.launch_date ?? null)], ['Age', p.days_live != null ? `${p.days_live} days` : '—'],
                ['NAV', p.nav.toFixed(4)], ['Since launch', fmtPct(p.since_launch)]].map(([l, v]) => (
                <div key={l} className="rounded-lg p-2" style={{ background: 'var(--bg-raised)' }}>
                  <div style={{ color: 'var(--text-low)' }}>{l}</div>
                  <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>{v}</div>
                </div>
              ))}
            </div>
            {p.objective && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}><b>Objective.</b> {p.objective}</p>}
            {p.exit_load && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}><b>Exit load.</b> {p.exit_load}
              {p.exit_load_note && <span style={{ color: 'var(--text-low)' }}> ({p.exit_load_note})</span>}</p>}
            <div className="flex gap-3 text-[11px] mt-auto" style={{ color: 'var(--text-low)' }}>
              {p.min_amount && <span>{p.min_amount}</span>}
              {p.website && <a href={p.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>Website ↗</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Monthly returns ──────────────────────────────────────────────────────────
function MonthlyTab() {
  const { data, loading } = useSif()
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  const growth = data.plans.filter(p => /growth/i.test(p.option ?? ''))
  const months = [...new Set(growth.flatMap(p => Object.keys(p.monthly ?? {})))].sort().reverse()
  const label = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
  return (
    <>
      <HistoryNote data={data} />
      {!months.length ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          Monthly returns appear once NAVs have been collected across a month end — the first column fills in after
          {' '}{data.as_of ? new Date(new Date(data.as_of).getFullYear(), new Date(data.as_of).getMonth() + 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'the next month end'}.
        </div>
      ) : (
        <div className="card overflow-hidden mb-4">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 280 }}>Strategy</th>
                  {months.map(m => <th key={m} style={{ textAlign: 'right' }}>{label(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {growth.map(p => (
                  <tr key={p.id}>
                    <td className="sticky-col text-xs truncate" style={{ maxWidth: 320 }} title={p.name}>{p.name.replace(/\s*-\s*Regular.*$/i, '')}</td>
                    {months.map(m => { const v = p.monthly?.[m] ?? null; return <td key={m} className={`ret-cell text-xs ${retColor(v)}`}>{fmtPct(v)}</td> })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Point to Point ───────────────────────────────────────────────────────────
function P2PTab() {
  const { data, loading } = useSif()
  const f = useFiltered(data)
  const first = data?.plans.map(p => p.history_from).filter(Boolean).sort()[0] ?? ''
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const start = from || first
  const end = to || data?.as_of || ''
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  const box = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }
  return (
    <>
      <HistoryNote data={data} />
      <div className="card p-3 mb-3 flex items-end gap-3 flex-wrap text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1">From
          <input type="date" value={start} min={first} max={end} onChange={e => setFrom(e.target.value)} className="px-2 py-1 rounded" style={box} />
        </label>
        <label className="flex flex-col gap-1">To
          <input type="date" value={end} min={start} max={data.as_of ?? undefined} onChange={e => setTo(e.target.value)} className="px-2 py-1 rounded" style={box} />
        </label>
        <span>NAV on or before each date, from the days collected.</span>
      </div>
      <Filters {...f} />
      <TableSearch value={f.query} onChange={f.setQuery} count={f.plans.length} total={data.plans.length} />
      <div className="card overflow-hidden mb-4">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col text-left" style={{ minWidth: 280 }}>SIF</th>
                <th className="text-left">Strategy</th>
                <th style={{ textAlign: 'right' }}>NAV {fmtDate(start)}</th>
                <th style={{ textAlign: 'right' }}>NAV {fmtDate(end)}</th>
                <th style={{ textAlign: 'right' }}>Return</th>
              </tr>
            </thead>
            <tbody>
              {f.plans.map(p => {
                const a = navOn(p, start), b = navOn(p, end)
                const r = a && b && a[0] < b[0] ? b[1] / a[1] - 1 : null
                return (
                  <tr key={p.id}>
                    <td className="sticky-col text-xs font-medium truncate" style={{ maxWidth: 320 }} title={p.name}>{p.name}</td>
                    <td className="text-[11px]" style={{ color: 'var(--text-mid)' }}>{p.strategy}</td>
                    <td className="ret-cell">{a ? a[1].toFixed(4) : '—'}</td>
                    <td className="ret-cell">{b ? b[1].toFixed(4) : '—'}</td>
                    <td className={`ret-cell font-semibold ${retColor(r)}`}>{fmtPct(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Compare ──────────────────────────────────────────────────────────────────
function CompareTab() {
  const { data, loading } = useSif()
  const [ids, setIds] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const pool: IndexFund[] = useMemo(() => (data?.plans ?? []).map(p => ({ c: p.id, n: p.name, k: p.strategy, s: '' })), [data])
  const chosen = ids.map(id => data?.plans.find(p => p.id === id)).filter((p): p is SifPlan => !!p)
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  const start = chosen.length ? chosen.map(p => p.history[0]?.[0] ?? '9999').sort().reverse()[0] : ''
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const axis = isLight ? '#4B5563' : '#5E6F8F'
  const days = chosen.length ? Math.min(...chosen.map(p => p.history.filter(h => h[0] >= start).length)) : 0
  const option = chosen.length && days >= 2 ? {
    backgroundColor: 'transparent', grid: { top: 34, right: 16, bottom: 30, left: 56 },
    legend: { top: 0, type: 'scroll', textStyle: { color: axis, fontSize: 11 } },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
    xAxis: { type: 'time', axisLabel: { color: axis, fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: axis, fontSize: 10, formatter: '{value}%' } },
    series: chosen.map((p, i) => {
      const base = navOn(p, start)?.[1] ?? p.history[0][1]
      return { name: p.name.slice(0, 40), type: 'line', showSymbol: false, lineStyle: { width: 2, color: PALETTE[i] },
               itemStyle: { color: PALETTE[i] }, data: p.history.filter(h => h[0] >= start).map(([d, v]) => [d, (v / base - 1) * 100]) }
    }),
  } : null
  return (
    <>
      <HistoryNote data={data} />
      <div className="card p-3 mb-3 flex items-end gap-2 flex-wrap text-xs" style={{ color: 'var(--text-mid)' }}>
        <label className="flex flex-col gap-1 flex-1 min-w-[300px]">Add a SIF ({ids.length}/5)
          <FundPicker funds={pool} value={pick} onChange={setPick} exclude={ids}
                      onPick={x => { if (ids.length < 5) setIds([...ids, x.c]); setPick('') }}
                      placeholder="Type a SIF or strategy name…"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
        </label>
        {chosen.map((p, i) => (
          <span key={p.id} className="px-2 py-1 rounded-full" style={{ border: `1px solid ${PALETTE[i]}`, color: PALETTE[i] }}>
            {p.name.slice(0, 36)} <button onClick={() => setIds(ids.filter(x => x !== p.id))}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </span>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="card p-4 mb-3">
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>Return since {fmtDate(start)}</div>
          {option ? <ReactECharts option={option} style={{ height: 300 }} notMerge />
            : <div className="text-xs p-6 text-center" style={{ color: 'var(--text-low)' }}>
                The chart appears once at least two days of NAVs have been collected for all chosen SIFs.
              </div>}
        </div>
      )}
      {chosen.length > 0 && (
        <div className="card overflow-hidden mb-4">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 200 }}>Measure</th>
                  {chosen.map((p, i) => <th key={p.id} style={{ textAlign: 'right', color: PALETTE[i], minWidth: 150 }}>{p.name.slice(0, 30)}</th>)}
                </tr>
              </thead>
              <tbody>
                {([['Strategy', p => p.strategy], ['SIF house', p => p.house ?? '—'], ['Plan', p => `${p.plan ?? ''} · ${p.option ?? ''}`],
                   ['NAV', p => `${p.nav.toFixed(4)} (${fmtDate(p.date)})`], ['Since launch', p => fmtPct(p.since_launch)],
                   ...PERIODS.map(k => [k, (p: SifPlan) => fmtPct(p.returns[k])] as [string, (p: SifPlan) => string])] as [string, (p: SifPlan) => string][])
                  .map(([label, get]) => (
                    <tr key={label}>
                      <td className="sticky-col text-xs">{label}</td>
                      {chosen.map(p => <td key={p.id} className="ret-cell text-xs">{get(p)}</td>)}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── NFOs ─────────────────────────────────────────────────────────────────────
function NfoTab() {
  const { data, loading } = useJson<SifNfoData>('sif_nfo.json')
  const today = new Date().toISOString().slice(0, 10)
  if (loading) return <div className="card p-6"><div className="skeleton h-40 w-full" /></div>
  if (!data) return <Empty />
  if (!data.offers.length) return (
    <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>AMFI lists no open SIF NFOs right now.</div>
  )
  return (
    <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
      {data.offers.map(o => {
        const open = !(o.opens && o.opens > today) && !(o.closes && o.closes < today)
        return (
          <div key={o.id} className="card p-4 flex flex-col gap-2">
            <div className="flex justify-between gap-2">
              <div>
                <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>{o.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{o.house}</div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full h-fit"
                    style={{ color: open ? '#34D399' : '#F59E0B', border: `1px solid ${open ? '#34D399' : '#F59E0B'}` }}>
                {open ? 'Open now' : o.opens && o.opens > today ? 'Opens soon' : 'Closed'}
              </span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--accent-a)' }}>{o.category}</div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {[['Opens', fmtDate(o.opens)], ['Closes', fmtDate(o.closes)], ['Minimum', o.min_amount ?? '—']].map(([l, v]) => (
                <div key={l} className="rounded-lg p-2" style={{ background: 'var(--bg-raised)' }}>
                  <div style={{ color: 'var(--text-low)' }}>{l}</div>
                  <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>{v}</div>
                </div>
              ))}
            </div>
            {o.objective && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}>{o.objective}</p>}
            {o.exit_load && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-mid)' }}><b>Exit load.</b> {o.exit_load.replace(/^exit load\s*:?-?\s*/i, '')}</p>}
            <div className="flex gap-3 text-[11px]">
              {o.document && <a href={o.document} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>📄 Offer document</a>}
              {o.website && <a href={o.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-a)' }}>Website ↗</a>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Empty() {
  return (
    <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
      SIF data is not available yet. It appears after the next data refresh.
    </div>
  )
}

const TITLES: Record<string, string> = {
  'sif-nav': 'SIF — NAV & Returns', 'sif-p2p': 'SIF — Point to Point',
  'sif-leaders': 'SIF — Leaderboard', 'sif-details': 'SIF — Strategy Details', 'sif-monthly': 'SIF — Monthly Returns',
  'sif-compare': 'SIF — Compare', 'sif-nfo': 'SIF — New Fund Offers',
}

export default function SifSection({ tab }: { tab: string }) {
  return (
    <section className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header"><span>{TITLES[tab] ?? 'SIF'}</span></div>
      {tab === 'sif-nav' && <NavTab />}
      {tab === 'sif-leaders' && <LeadersTab />}
      {tab === 'sif-details' && <DetailsTab />}
      {tab === 'sif-monthly' && <MonthlyTab />}
      {tab === 'sif-p2p' && <P2PTab />}
      {tab === 'sif-compare' && <CompareTab />}
      {tab === 'sif-nfo' && <NfoTab />}
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-low)' }}>
        Specialised Investment Funds (SEBI, 2025): long-short and asset-allocation strategies run by AMCs under a separate
        SIF brand, with a ₹10 lakh minimum investment. Source: AMFI SIF NAV and NFO lists.
      </p>
    </section>
  )
}

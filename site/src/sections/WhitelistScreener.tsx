// src/sections/WhitelistScreener.tsx — rank every fund in a category on the
// house scorecard: Risk 40%, Performance 40%, Drawdown 20%.
//
// build_json.build_screener sends each fund's raw parameters and a 0–100 score
// per parameter (engine.screener_parameter_scores). The only arithmetic here is
// the weighted average of those scores, because the weights are editable on the
// page and a change has to re-rank instantly.

import { useEffect, useMemo, useState } from 'react'
import { useMeta, useScreener } from '../hooks/useData'
import ComingFunds from '../components/ComingFunds'
import DownloadButton from '../components/DownloadButton'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct } from '../utils/format'
import type { SheetSpec } from '../utils/xlsx'
import type { ScreenerData, ScreenerFund, ScreenerParam } from '../types'

const EQUITY_HYBRID_CLASSES = ['Equity', 'Hybrid']
const MAIN_TAB_NAMES = [
  'Large Cap', 'Large & Mid Cap', 'Mid Cap', 'Small Cap',
  'Flexi Cap', 'Balanced Advantage', 'Multi Asset Allocation',
]
const WEIGHTS_KEY = 'wl_screener_weights_v1'

type Group = 'risk' | 'performance' | 'drawdown'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'risk', label: 'Risk Ratios' },
  { id: 'performance', label: 'Performance Ratios' },
  { id: 'drawdown', label: 'Drawdown' },
]

interface Param {
  key: ScreenerParam
  label: string
  group: Group
  /** Raw value as shown in the table. */
  raw: (f: ScreenerFund, d: ScreenerData) => string
  /** Hover text for the raw cell: the parts behind a multi-part value. */
  detail?: (f: ScreenerFund, d: ScreenerData) => string
  help: string
}

const n2 = (v: number | null | undefined, dp = 2) => (v == null ? '—' : v.toFixed(dp))
const pctU = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const periodName = (p: string) => (p === '12M' ? '1Y' : p)
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

const PARAMS: Param[] = [
  { key: 'beta', label: 'Beta', group: 'risk', raw: f => n2(f.beta),
    help: 'Sensitivity to the category benchmark over 3 years. Lower = less market risk, scores higher.' },
  { key: 'relative_risk', label: 'Relative Risk', group: 'risk', raw: f => n2(f.relative_risk),
    help: 'Fund Std Dev ÷ benchmark Std Dev (both 3Y monthly). 0.90 = 10% less volatile than the benchmark. Lower scores higher.' },
  { key: 'down_capture', label: 'Down Capture', group: 'risk', raw: f => n2(f.down_capture, 1),
    help: 'Share of the benchmark’s falls the fund took in down months (3Y). Lower scores higher.' },
  { key: 'std_dev', label: 'Std Dev', group: 'risk', raw: f => pctU(f.std_dev),
    help: 'Annualised volatility of 3Y monthly returns. Lower scores higher.' },
  { key: 'returns', label: 'Returns', group: 'performance',
    raw: f => fmtPct(f.returns['3Y'] ?? null),
    detail: (f, d) => d.periods.map(p => `${periodName(p)}: ${fmtPct(f.returns[p] ?? null)}`).join('\n'),
    help: 'Trailing returns over 1M, 3M, 6M, 1Y, 2Y and 3Y. Each period is ranked in the category and the ranks averaged. Table shows 3Y; hover for all.' },
  { key: 'relative_return', label: 'Relative Return', group: 'performance',
    raw: f => fmtPct(f.relative_returns['3Y'] ?? null),
    detail: (f, d) => d.periods.map(p => `${periodName(p)}: ${fmtPct(f.relative_returns[p] ?? null)}`).join('\n'),
    help: 'Fund return minus benchmark return for each of the same periods, ranked and averaged. Table shows 3Y; hover for all.' },
  { key: 'alpha', label: 'Alpha', group: 'performance', raw: f => (f.alpha == null ? '—' : (f.alpha * 100).toFixed(2)),
    help: 'Yearly return above what Beta predicts (3Y), in percentage points. Higher scores higher.' },
  { key: 'up_capture', label: 'Up Capture', group: 'performance', raw: f => n2(f.up_capture, 1),
    help: 'Share of the benchmark’s gains the fund captured in up months (3Y). Higher scores higher.' },
  { key: 'max_drawdown', label: 'Max Drawdown', group: 'drawdown',
    raw: f => fmtPct(avg(f.bear.map(b => b?.fall))),
    detail: (f, d) => d.bear_periods.map((b, i) => `${b.label}: ${f.bear[i] ? fmtPct(f.bear[i]!.fall) : 'not launched'}`).join('\n'),
    help: 'The fund’s point-to-point return through each bear period (market peak to market low). Each period is ranked separately and the ranks averaged. Table shows the average fall; hover for each period.' },
  { key: 'recovery_time', label: 'Recovery Time', group: 'drawdown',
    raw: f => { const a = avg(f.bear.map(b => b?.recovery_days)); return a == null ? '—' : `${Math.round(a)}d` },
    detail: (f, d) => d.bear_periods.map((b, i) => {
      const s = f.bear[i]
      return `${b.label}: ${s ? `${s.recovery_days} days${s.recovered ? '' : ' (not yet recovered)'}` : 'not launched'}`
    }).join('\n'),
    help: 'Days after each bear period’s low until the fund got back to its value at the start. Fewer days scores higher; a fund still below scores as the days elapsed so far.' },
  { key: 'active_share', label: '% Active Share', group: 'drawdown', raw: () => 'pending',
    help: 'Share of the portfolio in stocks outside the NIFTY 50. Needs AMC portfolio holdings, which are not loaded yet, so its weight is spread over the other parameters for now.' },
]

/** Weighted average of the parameter scores that exist. */
function weighted(scores: ScreenerFund['scores'], weights: Record<string, number>,
                  keys: ScreenerParam[]): number | null {
  if (!scores) return null
  let num = 0, den = 0
  for (const k of keys) {
    const s = scores[k], w = weights[k] ?? 0
    if (s == null || w <= 0) continue
    num += s * w
    den += w
  }
  return den ? num / den : null
}

/** Rank bands from the sheet: 1–2 green, 3–5 yellow, 6–8 orange. */
function band(rank: number): { bg: string; fg: string } | null {
  if (rank <= 2) return { bg: 'rgba(52,211,153,0.16)', fg: '#34D399' }
  if (rank <= 5) return { bg: 'rgba(245,158,11,0.14)', fg: '#F59E0B' }
  if (rank <= 8) return { bg: 'rgba(249,115,22,0.14)', fg: '#FB923C' }
  return null
}

function loadWeights(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function WhitelistScreener() {
  const { data: meta } = useMeta()
  const [slug, setSlug] = useState('')
  const [showRaw, setShowRaw] = useState(true)
  const [showUnranked, setShowUnranked] = useState(false)
  const [weights, setWeights] = useState<Record<string, number> | null>(loadWeights)

  const eligibleCats = (meta?.categories ?? []).filter(c => EQUITY_HYBRID_CLASSES.includes(c.asset_class))
  const activeSlug = slug || (eligibleCats[0]?.slug ?? '')
  const mainTabs  = eligibleCats.filter(c => MAIN_TAB_NAMES.includes(c.category_name))
  const otherCats = eligibleCats.filter(c => !MAIN_TAB_NAMES.includes(c.category_name))

  const { data, loading, error } = useScreener(activeSlug)

  const defaults = data?.default_weights
  const w: Record<string, number> = weights ?? defaults ?? {}

  useEffect(() => {
    try {
      if (weights) localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights))
      else localStorage.removeItem(WEIGHTS_KEY)
    } catch { /* storage unavailable: weights just last for the visit */ }
  }, [weights])

  const setWeight = (k: ScreenerParam, v: number) =>
    setWeights({ ...w, [k]: Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)) })

  const groupTotal = (g: Group) => PARAMS.filter(p => p.group === g).reduce((a, p) => a + (w[p.key] ?? 0), 0)
  const grandTotal = GROUPS.reduce((a, g) => a + groupTotal(g.id), 0)

  const ranked = useMemo(() => {
    const all = PARAMS.map(p => p.key)
    const rows = (data?.funds ?? []).filter(f => f.eligible && f.scores).map(f => ({
      fund: f,
      score: weighted(f.scores, w, all),
      groups: Object.fromEntries(GROUPS.map(g => [g.id,
        weighted(f.scores, w, PARAMS.filter(p => p.group === g.id).map(p => p.key))])) as Record<Group, number | null>,
    }))
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    return rows
  }, [data, w])

  const unranked = (data?.funds ?? []).filter(f => !f.eligible)

  const buildExport = (): SheetSpec | null => {
    if (!data || !ranked.length) return null
    const desk = currentDesk()
    const columns: SheetSpec['columns'] = [
      { key: 'rank', label: 'Rank', type: 'int', width: 6 },
      { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
      { key: 'score', label: 'Score', type: 'number' },
      ...GROUPS.map(g => ({ key: g.id, label: g.label, type: 'number' as const })),
      ...PARAMS.map(p => ({ key: `s_${p.key}`, label: `${p.label} (score)`, type: 'number' as const })),
      ...PARAMS.map(p => ({ key: `r_${p.key}`, label: `${p.label} (value)`, type: 'text' as const, width: 14 })),
    ]
    const rows: SheetSpec['rows'] = ranked.map((r, i) => {
      const row: SheetSpec['rows'][number] = { rank: i + 1, fund: r.fund.scheme_name, score: r.score }
      for (const g of GROUPS) row[g.id] = r.groups[g.id]
      for (const p of PARAMS) {
        row[`s_${p.key}`] = r.fund.scores?.[p.key] ?? null
        row[`r_${p.key}`] = p.raw(r.fund, data)
      }
      return row
    })
    return {
      sheet: 'Whitelist Screener',
      title: `Whitelist Screener - ${data.category_name}`,
      meta: [
        ['Desk', desk.name], ['Category', data.category_name], ['Data as of', data.as_of],
        ['Weights', PARAMS.map(p => `${p.label} ${w[p.key] ?? 0}%`).join(', ')],
        ['Scores', '0-100 within the category per parameter; Score = weighted average of available parameters'],
      ],
      columns, rows,
      fileName: `${desk.code} Whitelist Screener - ${data.category_name} - ${data.as_of}`,
    }
  }

  const colour = categoryColor(activeSlug)
  const scoreCell = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1))

  return (
    <section id="whitelist-screener" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Whitelist Screener</span>
      </div>

      {/* ── Category + controls ─────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center flex-1 min-w-0">
          <div className="tab-bar">
            {mainTabs.map(c => {
              const col = categoryColor(c.slug, c.asset_class)
              const on = activeSlug === c.slug
              return (
                <button key={c.slug} onClick={() => setSlug(c.slug)}
                  className={`tab-btn${on ? ' active' : ''}`}
                  style={on ? { color: col, background: `${col}1f` } : undefined}>
                  {c.category_name}
                </button>
              )
            })}
          </div>
          {otherCats.length > 0 && (
            <select
              value={mainTabs.some(c => c.slug === activeSlug) ? '' : activeSlug}
              onChange={e => { if (e.target.value) setSlug(e.target.value) }}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--bg-raised)',
                       border: `1px solid ${mainTabs.some(c => c.slug === activeSlug) ? 'var(--line)' : colour}`,
                       color: 'var(--text-hi)', outline: 'none' }}
            >
              <option value="" disabled>-- Other Categories --</option>
              {otherCats.map(c => <option key={c.slug} value={c.slug}>{c.category_name}</option>)}
            </select>
          )}
        </div>
        <div className="tab-bar shrink-0 flex items-center gap-2">
          <button onClick={() => setShowRaw(true)}  className={`tab-btn${showRaw ? ' active accent' : ''}`}>Values</button>
          <button onClick={() => setShowRaw(false)} className={`tab-btn${!showRaw ? ' active accent' : ''}`}>Scores</button>
          <DownloadButton build={buildExport} disabledHint="No ranked funds in this category" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Weights ─────────────────────────────────────────── */}
        <aside className="card p-4 self-start">
          <div className="flex items-center justify-between mb-3">
            <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Weights</div>
            <button onClick={() => setWeights(null)} className="text-[11px]"
                    style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer' }}
                    title="Back to the defaults in data/screener_config.json">
              Reset
            </button>
          </div>
          {GROUPS.map(g => (
            <div key={g.id} className="mb-3">
              <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide mb-1"
                   style={{ color: 'var(--text-mid)' }}>
                <span>{g.label}</span><span>{groupTotal(g.id)}%</span>
              </div>
              {PARAMS.filter(p => p.group === g.id).map(p => (
                <label key={p.key} className="flex items-center justify-between gap-2 py-0.5 text-xs"
                       style={{ color: 'var(--text-hi)' }} title={p.help}>
                  <span className={p.key === 'active_share' ? 'opacity-60' : ''}>{p.label}</span>
                  <span className="flex items-center gap-1">
                    <input type="number" min={0} max={100} step={1} value={w[p.key] ?? 0}
                           onChange={e => setWeight(p.key, parseFloat(e.target.value))}
                           className="w-14 px-1.5 py-0.5 rounded text-right text-xs"
                           style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
                    <span style={{ color: 'var(--text-low)' }}>%</span>
                  </span>
                </label>
              ))}
            </div>
          ))}
          <div className="flex justify-between text-xs font-semibold pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
            <span>Total</span>
            <span style={{ color: grandTotal === 100 ? 'var(--text-hi)' : '#F59E0B' }}>{grandTotal}%</span>
          </div>
          <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-low)' }}>
            Changes re-rank every category instantly and are remembered in this browser.
            {grandTotal !== 100 && ' Weights need not add to 100 — they are used in proportion.'}
            {' '}% Active Share has no data yet, so its weight is shared across the rest.
          </p>
        </aside>

        {/* ── Ranking ─────────────────────────────────────────── */}
        <div className="min-w-0">
          {data?.benchmark?.stale && (
            <div className="card p-3 mb-3 text-xs" style={{ borderColor: 'rgba(245,158,11,0.5)', color: 'var(--text-mid)' }}>
              ⚠️ The benchmark {data.benchmark.name} has stopped updating, so Relative Risk, Relative Return,
              Alpha, Beta and the Capture ratios are blank for this category and funds are ranked on the rest.
            </div>
          )}
          <div className="card overflow-hidden mb-4">
            {loading ? (
              <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
            ) : error ? (
              <div className="p-8 text-center"><ComingFunds error={error} subject="rank" failedLabel="the screener" /></div>
            ) : data ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'center', width: 48 }}>Rank</th>
                      <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund Name</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      {GROUPS.map(g => <th key={g.id} style={{ textAlign: 'right' }}>{g.label.replace(' Ratios', '')}</th>)}
                      {PARAMS.map(p => (
                        <th key={p.key} title={p.help}
                            style={{ textAlign: 'right', borderLeft: p.key === 'beta' ? '1px solid var(--line)' : undefined }}>
                          {p.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody key={`${activeSlug}-${showRaw}`} className="rows-enter">
                    {ranked.map((r, i) => {
                      const b = band(i + 1)
                      return (
                        <tr key={r.fund.scheme_code}>
                          <td style={{ textAlign: 'center', background: b?.bg, color: b?.fg, fontWeight: 700 }}>{i + 1}</td>
                          <td className="sticky-col text-xs font-medium truncate" style={{ maxWidth: 280, background: b?.bg }}
                              title={r.fund.scheme_name}>
                            {r.fund.scheme_name}
                          </td>
                          <td className="ret-cell font-semibold" style={{ color: 'var(--accent-a)' }}>{scoreCell(r.score)}</td>
                          {GROUPS.map(g => <td key={g.id} className="ret-cell">{scoreCell(r.groups[g.id])}</td>)}
                          {PARAMS.map(p => (
                            <td key={p.key} className="ret-cell"
                                style={{ borderLeft: p.key === 'beta' ? '1px solid var(--line)' : undefined,
                                         color: p.key === 'active_share' ? 'var(--text-low)' : undefined }}
                                title={showRaw ? p.detail?.(r.fund, data) : `score ${scoreCell(r.fund.scores?.[p.key])} / 100`}>
                              {showRaw ? p.raw(r.fund, data) : scoreCell(r.fund.scores?.[p.key])}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {ranked.length === 0 && (
                  <div className="p-6 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
                    No fund in this category has the {data.min_history} history needed to be ranked yet.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {data && (
            <div className="flex items-center justify-between text-[11px] mb-4 flex-wrap gap-2" style={{ color: 'var(--text-low)' }}>
              <span>
                {ranked.length} ranked · as of {fmtDate(data.as_of)} ·
                {' '}<span style={{ color: '#34D399' }}>■</span> 1–2
                {' '}<span style={{ color: '#F59E0B' }}>■</span> 3–5
                {' '}<span style={{ color: '#FB923C' }}>■</span> 6–8
              </span>
              {unranked.length > 0 && (
                <button onClick={() => setShowUnranked(v => !v)}
                        style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {showUnranked ? 'Hide' : 'Show'} {unranked.length} fund{unranked.length === 1 ? '' : 's'} not ranked
                  (under {data.min_history} of history)
                </button>
              )}
            </div>
          )}
          {data && showUnranked && unranked.length > 0 && (
            <div className="card p-3 mb-4 text-xs" style={{ color: 'var(--text-mid)' }}>
              {unranked.map(f => f.scheme_name).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* ── Bear periods + definitions ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 mt-2">
        <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
          <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>Bear periods used</div>
          <p className="mb-2">
            Max Drawdown and Recovery Time are measured over these market falls. The list is kept by hand in
            {' '}<code>data/screener_config.json</code>; add, remove or change dates there and the next data run re-scores every fund.
          </p>
          <table className="w-full">
            <tbody>
              {(data?.bear_periods ?? []).map(b => (
                <tr key={b.start}>
                  <td className="py-0.5 pr-2" style={{ color: 'var(--text-hi)' }}>{b.label}</td>
                  <td className="py-0.5 text-right whitespace-nowrap">{fmtDate(b.start)} → {fmtDate(b.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
          <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>How the score works</div>
          <p className="mb-2">
            Each parameter is scored 0–100 <b style={{ color: 'var(--text-hi)' }}>within the category</b>: the best fund on it
            scores 100, the worst close to 0, allowing for direction (low Beta is good, high Alpha is good). Returns,
            Relative Return, Max Drawdown and Recovery Time have several parts (periods), each scored separately and averaged.
            The <b style={{ color: 'var(--text-hi)' }}>Score</b> is the weighted average using the weights on the left;
            Risk / Performance / Drawdown are the same average within each group. A fund needs {data?.min_history ?? '3Y'} of
            history to be ranked.
          </p>
          <div className="space-y-1">
            {PARAMS.map(p => (
              <div key={p.key}><b style={{ color: 'var(--text-hi)' }}>{p.label}:</b> {p.help}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

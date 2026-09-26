// src/sections/Blacklist.tsx — funds to avoid.
//
// Two sections from blacklist.json (build_json.build_blacklist):
//   Flagged by the team   the manual list in data/blacklist.json, with reasons
//   Automatic             every Equity/Hybrid fund's result on each of the
//                         team's NAV-based blacklist rules
// The only arithmetic here is the Blacklist Score: the share of the (editable)
// rule weights a fund fails, because a weight change has to re-list instantly.
// Open to everyone.

import { useEffect, useMemo, useState } from 'react'
import TableSearch from '../components/TableSearch'
import { fuzzyMatcher } from '../utils/fuzzy'
import { useJson } from '../hooks/useData'
import DownloadButton from '../components/DownloadButton'
import TeamBlacklist from '../components/TeamBlacklist'
import { currentDesk } from '../config/products'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import type { SheetSpec } from '../utils/xlsx'
import type { BlacklistData, BlacklistRule, ListedFund } from '../types'
import FundLink from '../components/FundLink'

const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

/** The automatic rules, in the order the team listed them, with what each means. */
const RULES: { id: BlacklistRule; label: string; short: string; help: string; shows: string }[] = [
  { id: 'bottom_quartile', short: 'Laggard (3M·1Y·3Y)', label: 'Persistent laggard',
    help: 'Bottom quartile of its category on 3-month AND 1-year AND 3-year returns at the same time — not a temporary dip.',
    shows: 'Its quartile on 3M · 1Y · 3Y (Q1 = top 25% of the category, Q4 = bottom 25%). Sectoral funds are ranked within their own sector.' },
  { id: 'negative_alpha', short: 'Alpha 3Y / 5Y', label: 'Negative alpha',
    help: 'Negative alpha over both 3 and 5 years against the category benchmark — failing the core job. A fund 3-5 years old is judged on 3Y alpha alone.',
    shows: '3Y / 5Y alpha in percentage points a year (e.g. -1.20 = 1.2% a year worse than its Beta predicts). “3Y only” = the fund is 3-5 years old and is judged on 3Y alone.' },
  { id: 'rolling_consistency', short: 'Rolling beat %', label: 'Inconsistent',
    help: 'Beat its benchmark in under 40% of rolling 1-year periods over its history. Point-to-point can flatter a fund; rolling exposes it.',
    shows: 'The share of all 1-year windows in its history in which it beat the benchmark (e.g. 34% = beat it in about one window in three).' },
  { id: 'downside_capture', short: 'Down capture', label: 'Falls more than index',
    help: 'Downside capture above 100 (3Y) — falls more than the benchmark in down months. For Small and Mid Cap, 1Y is checked too.',
    shows: 'Down capture by horizon (e.g. “3Y 119” = in the benchmark’s falling months it fell 19% more than the index; 80 = only 80% as much).' },
  { id: 'tracking_error', short: 'Tracking error', label: 'Active risk, no reward',
    help: 'Large Cap only. Tracking error = how far the fund’s returns wander from its benchmark (yearly standard deviation of the monthly gap between fund and index); ~1–3% hugs the index, 6%+ means big bets away from it. Flagged when it is in the top quarter of Large Cap funds AND 3Y alpha is negative — taking active risk and losing.',
    shows: 'In Category check as “TE 6.1%”: the fund’s tracking error.' },
  { id: 'short_track_record', short: 'Track record', label: 'Short track record',
    help: 'Under 3 years of history in a category with established alternatives (not applied to Multi Cap).',
    shows: 'Years of NAV history held (e.g. 4.5y).' },
  { id: 'bottom_3m', short: '3M quartile', label: 'Bottom of pack (3M)',
    help: 'Multi Cap: bottom quartile on 3-month return.',
    shows: 'In Category check as “3M Q4”: its quartile on 3-month return.' },
  { id: 'high_beta', short: 'Beta 3Y', label: 'High beta (value)',
    help: 'Value / Contra and Dividend Yield: 3Y beta above 1.0 — a value fund that behaves like a momentum fund.',
    shows: 'In Category check as “β 1.12”: its 3Y beta (1.00 = moves in line with the benchmark; above 1 = swings more).' },
  { id: 'aum_size', short: 'AUM', label: 'Size (AUM)',
    help: 'Fund AUM (all plans) below ₹300 Cr — too small to be sustainable; or, for Small and Mid Cap, above ₹30,000 Cr — too big to stay nimble (AMFI quarterly average AUM).',
    shows: 'Fund size in ₹ crore, all plans together (AMFI quarterly average).' },
]
/** Rules meant for one category each, and the tag shown in the shared column. */
const CATEGORY_RULE_TAG: Partial<Record<BlacklistRule, string>> = {
  tracking_error: 'TE ', bottom_3m: '3M ', high_beta: 'β ',
}
const WEIGHTS_KEY = 'bl_weights_v1'
const MIN_KEY = 'bl_min_score_v1'

function loadStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export default function Blacklist() {
  const { data, loading, error } = useJson<BlacklistData>('blacklist.json')
  const [mode, setMode] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly')
  const manual = data?.manual ?? []
  const all = data?.funds ?? []
  const [catFilter, setCatFilter] = useState('')
  const [weights, setWeights] = useState<Record<string, number> | null>(() => loadStored(WEIGHTS_KEY))
  const [minScore, setMinScore] = useState<number | null>(() => loadStored(MIN_KEY))
  const w: Record<string, number> = weights ?? data?.default_weights ?? {}
  const cutoff = minScore ?? data?.default_min_score ?? 20
  useEffect(() => {
    try {
      if (weights) localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights)); else localStorage.removeItem(WEIGHTS_KEY)
      if (minScore != null) localStorage.setItem(MIN_KEY, JSON.stringify(minScore)); else localStorage.removeItem(MIN_KEY)
    } catch { /* storage unavailable: settings last for the visit */ }
  }, [weights, minScore])
  const totalWeight = RULES.reduce((t, r) => t + (w[r.id] ?? 0), 0)

  // Blacklist Score: the share of all rule weight that the fund fails, 0-100.
  const scored = useMemo(() => all.map(f => {
    const failedW = RULES.reduce((t, r) => t + (f.rules[r.id]?.fail ? (w[r.id] ?? 0) : 0), 0)
    return { ...f, score: totalWeight ? (failedW / totalWeight) * 100 : 0 }
  }), [all, w, totalWeight])
  const cats = [...new Map(all.map(f => [f.category_slug, f.category_name])).entries()]
  const [query, setQuery] = useState('')
  const hit = fuzzyMatcher(query)
  const shown = scored
    .filter(f => f.score > 0 && f.score >= cutoff && (!catFilter || f.category_slug === catFilter) && hit(f.scheme_name))
    .sort((a, b) => b.score - a.score || a.scheme_name.localeCompare(b.scheme_name))

  // Columns for rules that apply to none of the listed funds (e.g. the Large
  // Cap tracking-error rule when no Large Cap fund is listed) are left out.
  const visibleRules = RULES.filter(r => shown.some(f => f.rules[r.id] && f.rules[r.id].na !== 'category'))
  // Rules written for one category each share a single "Category check"
  // column, so the table is not mostly dashes when all categories are listed.
  const tableRules = visibleRules.filter(r => !(r.id in CATEGORY_RULE_TAG))
  const catRules = visibleRules.filter(r => r.id in CATEGORY_RULE_TAG)

  const ruleCell = (f: (typeof shown)[number], r: (typeof RULES)[number], key: string, tag = '') => {
    const x = f.rules[r.id]
    const weighted = (w[r.id] ?? 0) > 0
    const fail = x?.fail === true
    const hot = fail && weighted            // only failures that move the score are red
    const off = !x || (x.fail == null && (!x.na || x.na === 'category'))
    const tip = fail ? `${r.label}: ${x.text}${weighted ? '' : ' (weight 0% — not counted in the score)'}`
      : off ? 'This rule is not applied to this category'
      : x.fail == null ? `${r.label} — not judged: ${x.na}` : `${r.label}: passed`
    return (
      <td key={key} className="text-center text-[11px]" title={tip}
          style={{ background: hot ? 'rgba(248,113,113,0.14)' : undefined,
                   color: hot ? 'var(--loss)' : fail ? '#F59E0B' : x?.fail == null ? 'var(--text-low)' : 'var(--text-mid)',
                   fontWeight: fail ? 600 : 400 }}>
        {off ? <span style={{ opacity: 0.4 }}>–</span>
          : x.fail == null ? <span className="italic text-[10px]">{tag}{x.na}</span>
          : <>{tag}{x.value}</>}
      </td>
    )
  }

  const buildExport = (): SheetSpec | null => {
    if (!data) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const f of manual) {
      rows.push({ section: 'Flagged by the team', category: f.category_name ?? '', fund: f.scheme_name,
                  reason: f.note, rank: null, score: null, r3y: f.returns?.['3Y'] ?? null })
    }
    for (const f of shown) {
      const row: SheetSpec['rows'][number] = {
        section: 'Automatic', category: f.category_name, fund: f.scheme_name,
        reason: RULES.filter(r => f.rules[r.id]?.fail).map(r => f.rules[r.id].text).join('; '),
        score: f.score, r3y: f.return_3y }
      for (const r of RULES) row[r.id] = f.rules[r.id]?.value ?? ''
      rows.push(row)
    }
    return {
      sheet: 'Blacklist', title: 'Blacklist',
      meta: [['Desk', desk.name], ['Data as of', data.as_of],
             ['Blacklist Score', `Share of rule weight failed; listed at ${cutoff}% or more`],
             ['Weights', RULES.map(r => `${r.label} ${w[r.id] ?? 0}%`).join(', ')]],
      columns: [
        { key: 'section', label: 'Section', type: 'text', width: 24 },
        { key: 'category', label: 'Category', type: 'text', width: 24 },
        { key: 'fund', label: 'Fund Name', type: 'text', width: 46 },
        { key: 'reason', label: 'Reason', type: 'text', width: 34 },
        { key: 'score', label: 'Blacklist Score', type: 'number' },
        ...RULES.map(r => ({ key: r.id, label: r.label, type: 'text' as const, width: 18 })),
        { key: 'r3y', label: '3Y CAGR', type: 'percent' },
      ],
      rows,
      fileName: `${desk.code} Blacklist - ${data.as_of}`,
    }
  }

  return (
    <section id="blacklist" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Blacklist</span>
        <span className="ml-auto"><DownloadButton build={buildExport} /></span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-mid)' }}>
        Funds to avoid: those the team has flagged by hand, and funds whose Blacklist Score (the weighted share
        of the team’s blacklist rules they fail) is at or above the minimum. {data &&<>Data as of <b style={{ color: 'var(--text-hi)' }}>{fmtDate(data.as_of)}</b>.</>}
      </p>

      {loading ? (
        <div className="card p-6 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
      ) : error || !data ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          The blacklist has not been published yet. It appears after the next data refresh.
        </div>
      ) : (
        <>
          {/* ── Manual: the team's list, editable here ─────────────── */}
          <TeamBlacklist built={manual} mode={mode} onModeChange={setMode} />

          {/* ── Automatic: weighted rules ───────────────────────────── */}
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
              🚩 Blacklisted by the rules <span style={{ color: 'var(--text-low)', fontWeight: 400 }}>({shown.length})</span>
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-xs"
                    style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
              <option value="">All categories</option>
              {cats.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
            </select>
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-low)' }}>
            Each fund’s <b>Blacklist Score</b> is the share of the rule weights (left) that it fails, 0–100. Funds at or
            above the minimum score are listed, highest first. Red cells are the rules it fails; amber = fails a rule whose weight is 0%, so it does not count
            in the score. <b>Category check</b> holds the three rules written for one category each — TE = tracking
            error (Large Cap), 3M = bottom quartile on 3 months (Multi Cap), β = high beta (Value / Dividend Yield).
            A faint “–” means no rule of that column applies to the fund’s category; a grey note such as “&lt; 5Y history”
            or “no benchmark” means the fund could not be judged on it yet. A fund between 3 and 5 years old is judged on
            3Y alpha alone (marked “3Y only”). Recomputed with every data refresh.
          </p>

          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] mb-4">
            <aside className="card p-4 self-start">
              <div className="flex items-center justify-between mb-3">
                <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Rule weights</div>
                <button onClick={() => { setWeights(null); setMinScore(null) }} className="text-[11px]"
                        style={{ color: 'var(--accent-a)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Reset
                </button>
              </div>
              {RULES.map(r => (
                <label key={r.id} className="flex items-center justify-between gap-2 py-0.5 text-xs"
                       style={{ color: 'var(--text-hi)' }} title={r.help}>
                  <span>{r.label}</span>
                  <span className="flex items-center gap-1">
                    <input type="number" min={0} max={100} step={1} value={w[r.id] ?? 0}
                           onChange={e => setWeights({ ...w, [r.id]: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                           className="w-14 px-1.5 py-0.5 rounded text-right text-xs"
                           style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
                    <span style={{ color: 'var(--text-low)' }}>%</span>
                  </span>
                </label>
              ))}
              <div className="flex justify-between text-xs font-semibold pt-2 mt-1 border-t" style={{ borderColor: 'var(--line)' }}>
                <span>Total</span>
                <span style={{ color: totalWeight === 100 ? 'var(--text-hi)' : '#F59E0B' }}>{totalWeight}%</span>
              </div>
              <label className="flex items-center justify-between gap-2 pt-3 text-xs font-semibold" style={{ color: 'var(--text-hi)' }}>
                <span>Minimum score to list</span>
                <span className="flex items-center gap-1">
                  <input type="number" min={0} max={100} step={5} value={cutoff}
                         onChange={e => setMinScore(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                         className="w-14 px-1.5 py-0.5 rounded text-right text-xs"
                         style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
                  <span style={{ color: 'var(--text-low)' }}>%</span>
                </span>
              </label>
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-low)' }}>
                The list changes as soon as a weight or the minimum changes. Settings are remembered in this browser.
                Set a rule to 0% to ignore it.
              </p>
            </aside>

            <div className="min-w-0">
            <TableSearch value={query} onChange={setQuery} />
            <div className="card overflow-hidden min-w-0">
              {shown.length === 0 ? (
                <div className="p-6 text-center text-xs" style={{ color: 'var(--text-mid)' }}>
                  {query.trim() ? `No listed fund looks like “${query}”.` : `No fund scores ${cutoff}% or more with these weights.`}
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="sticky-col text-left" style={{ minWidth: 240 }}>Fund</th>
                        <th style={{ textAlign: 'right' }} title="Share of the rule weights this fund fails">Score</th>
                        {tableRules.map(r => (
                          <th key={r.id} title={r.help} style={{ textAlign: 'center' }}>
                            <div>{r.short}</div>
                            <div style={{ fontWeight: 400, opacity: 0.7, fontSize: 10 }}>{w[r.id] ?? 0}%</div>
                          </th>
                        ))}
                        {catRules.length > 0 && (
                          <th style={{ textAlign: 'center' }}
                              title={catRules.map(r => `${CATEGORY_RULE_TAG[r.id]!.trim()} = ${r.label} (${w[r.id] ?? 0}%): ${r.help}`).join(' | ')}>
                            <div>Category check</div>
                            <div style={{ fontWeight: 400, opacity: 0.7, fontSize: 10 }}>
                              {catRules.map(r => `${CATEGORY_RULE_TAG[r.id]!.trim()} ${w[r.id] ?? 0}%`).join(' · ')}
                            </div>
                          </th>
                        )}
                        <th style={{ textAlign: 'right' }}>1Y</th>
                        <th style={{ textAlign: 'right' }}>3Y</th>
                      </tr>
                    </thead>
                    <tbody className="rows-enter">
                      {shown.map(f => {
                        const colour = categoryColor(f.category_slug, f.asset_class)
                        return (
                          <tr key={f.scheme_code}>
                            <td className="sticky-col" style={{ maxWidth: 280 }}>
                              <div className="text-xs font-medium truncate"><FundLink code={f.scheme_code} name={f.scheme_name} /></div>
                              <div className="text-[10px] truncate" style={{ color: colour }}>{f.category_name}</div>
                            </td>
                            <td className="ret-cell font-semibold" style={{ color: 'var(--loss)' }}>{f.score.toFixed(0)}</td>
                            {tableRules.map(r => ruleCell(f, r, r.id))}
                            {catRules.length > 0 && (() => {
                              const r = catRules.find(c => f.rules[c.id] && f.rules[c.id].na !== 'category')
                              return r ? ruleCell(f, r, 'cat', CATEGORY_RULE_TAG[r.id])
                                : <td key="cat" className="text-center text-[11px]" title="No category-specific rule for this category"
                                      style={{ color: 'var(--text-low)' }}><span style={{ opacity: 0.4 }}>–</span></td>
                            })()}
                            <td className={`ret-cell ${retColor(f.return_1y)}`}>{fmtPct(f.return_1y)}</td>
                            <td className={`ret-cell ${retColor(f.return_3y)}`}>{fmtPct(f.return_3y)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </div>
          </div>

          <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
            <div className="font-display font-bold text-sm mb-2" style={{ color: 'var(--text-hi)' }}>
              What every column and mark means
            </div>
            <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 mb-3">
              <div><b style={{ color: 'var(--text-hi)' }}>Fund</b> — the fund, with its category underneath. Click it to open the fund page.</div>
              <div><b style={{ color: 'var(--text-hi)' }}>Score</b> — Blacklist Score, 0–100: the share of all rule weights the fund
                fails. E.g. failing Rolling beat (15%) and Down capture (15%) = 30. Funds at or above the
                “Minimum score to list” appear; change the weights or the minimum on the left.</div>
              <div><b style={{ color: 'var(--text-hi)' }}>% under each heading</b> — that rule’s weight in the Score (editable on the left).</div>
              <div><b style={{ color: 'var(--text-hi)' }}>1Y / 3Y</b> — the fund’s 1-year return and 3-year return a year (CAGR), for context; not part of the Score.</div>
            </div>

            <div className="font-semibold mb-1.5" style={{ color: 'var(--text-hi)' }}>The rule columns</div>
            <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2 mb-3">
              {RULES.filter(r => !(r.id in CATEGORY_RULE_TAG)).map(r => (
                <div key={r.id}>
                  <b style={{ color: 'var(--text-hi)' }}>{r.short}</b> <span style={{ color: 'var(--text-low)' }}>({r.label}, weight {w[r.id] ?? 0}%)</span>
                  <div>Fails when: {r.help}</div>
                  <div style={{ color: 'var(--text-low)' }}>Cell shows: {r.shows}</div>
                </div>
              ))}
              <div>
                <b style={{ color: 'var(--text-hi)' }}>Category check</b>
                <div>Three rules the team wrote for one category each share this column, so each fund shows only the
                  one that applies to it; funds in other categories show “–”.</div>
                {RULES.filter(r => r.id in CATEGORY_RULE_TAG).map(r => (
                  <div key={r.id} className="mt-1.5 pl-3" style={{ borderLeft: '2px solid var(--line)' }}>
                    <b style={{ color: 'var(--text-hi)' }}>{CATEGORY_RULE_TAG[r.id]!.trim()}</b> = {r.label}{' '}
                    <span style={{ color: 'var(--text-low)' }}>(weight {w[r.id] ?? 0}%)</span>
                    <div>Fails when: {r.help}</div>
                    <div style={{ color: 'var(--text-low)' }}>Cell shows: {r.shows}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="font-semibold mb-1.5" style={{ color: 'var(--text-hi)' }}>Colours and notes in the cells</div>
            <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
              <div><span style={{ background: 'rgba(248,113,113,0.14)', color: 'var(--loss)', padding: '0 4px', fontWeight: 600 }}>Red</span> — fails the rule, and the rule counts in the Score.</div>
              <div><span style={{ color: '#F59E0B', fontWeight: 600 }}>Amber</span> — fails the rule, but its weight is 0%, so it does not count.</div>
              <div><span style={{ color: 'var(--text-mid)' }}>Grey value</span> — passes the rule.</div>
              <div><span style={{ opacity: 0.5 }}>–</span> — the rule is not meant for this fund’s category.</div>
              <div><i>&lt; 3Y history / &lt; 5Y history</i> — the fund is too young to be judged on this rule yet.</div>
              <div><i>no benchmark</i> — the category has no benchmark to compare with (e.g. Arbitrage).</div>
              <div><i>no AUM data</i> — AMFI has not published this fund’s AUM.</div>
              <div><i>no data</i> — the figure could not be calculated from the NAVs held.</div>
            </div>
            <p className="mt-2">Hover any cell for the exact reason it passed or failed.</p>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-low)' }}>
              Thresholds are kept in <code>data/blacklist.json</code>. Not yet applied (need portfolio holdings or other
              data): concentration, stock count, overlap, style drift, flows, expense ratio, turnover, manager
              changes and compliance events — the last few are for the team to record as manual entries above.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

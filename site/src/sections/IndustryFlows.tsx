// src/sections/IndustryFlows.tsx — where the industry's money moved, month by
// month, from AMFI's Monthly Report (industry.json, scripts/amfi_industry.py):
// net inflows, AUM, folios and SIPs by category.

import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useJson } from '../hooks/useData'
import { currentDesk } from '../config/products'
import DownloadButton from '../components/DownloadButton'
import type { SheetSpec } from '../utils/xlsx'
import type { IndustryData, IndustryRow } from '../types'

const cr = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'))
const lakhCr = (v: number | null | undefined) => (v == null ? '—' : `₹${(v / 100000).toFixed(2)} lakh Cr`)
const count = (v: number | null | undefined) => (v == null ? '—' : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)} L` : Math.round(v).toLocaleString('en-IN'))
const signCls = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'ret-pos' : 'ret-neg')

/** The groups drawn in the chart, as AMFI names them. */
const CHART_GROUPS: [string, string, string][] = [
  ['Equity Schemes', 'Equity', '#22D3EE'], ['Hybrid Schemes', 'Hybrid', '#A78BFA'], ['Debt Schemes', 'Debt', '#F59E0B'],
  ['Index Funds', 'Index funds', '#34D399'], ['Exchange Traded Funds (ETFs)', 'ETFs', '#F472B6'],
]

/** Tiny bars of a category's net flow over the months, oldest left. */
function FlowBars({ values }: { values: (number | null)[] }) {
  const nums = values.map(v => v ?? 0)
  const max = Math.max(1, ...nums.map(Math.abs)), w = 6, h = 24, mid = h / 2
  return (
    <svg width={values.length * (w + 1)} height={h}>
      <line x1={0} x2={values.length * (w + 1)} y1={mid} y2={mid} stroke="var(--line)" />
      {nums.map((v, i) => {
        const bh = Math.abs(v) / max * (mid - 1)
        return <rect key={i} x={i * (w + 1)} y={v >= 0 ? mid - bh : mid} width={w} height={Math.max(bh, 0.5)}
                     fill={v >= 0 ? '#34D399' : '#F87171'} />
      })}
    </svg>
  )
}

export default function IndustryFlows() {
  const { data, loading, error } = useJson<IndustryData>('industry.json')
  const [month, setMonth] = useState('')
  const months = data?.months ?? []
  const m = months.find(x => x.month === month) ?? months[0]
  const oldestFirst = useMemo(() => [...months].reverse(), [months])

  /** Net flow per category across the months, oldest first, keyed "group|name". */
  const series = useMemo(() => {
    const out: Record<string, (number | null)[]> = {}
    oldestFirst.forEach((mm, i) => {
      for (const g of mm.groups) for (const c of g.categories) {
        const k = `${g.section}|${g.group}|${c.name}`
        ;(out[k] ??= Array(oldestFirst.length).fill(null))[i] = c.net_flow
      }
    })
    return out
  }, [oldestFirst])

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const axis = isLight ? '#4B5563' : '#5E6F8F'
  const grid = isLight ? '#E5E7EB' : '#24314F'
  const groupTotal = (mm: IndustryData['months'][number], name: string) =>
    mm.groups.find(g => g.group === name && g.section === 'Open ended')?.total?.net_flow ?? null

  const chart = months.length ? {
    backgroundColor: 'transparent',
    grid: { top: 36, right: 60, bottom: 30, left: 70 },
    legend: { top: 0, textStyle: { color: axis, fontSize: 11 } },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => '₹' + Math.round(v).toLocaleString('en-IN') + ' Cr' },
    xAxis: { type: 'category', data: oldestFirst.map(x => x.label.replace(/ (\d{2})(\d{2})$/, " '$2")), axisLabel: { color: axis, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: 'Net flow ₹ Cr', nameTextStyle: { color: axis, fontSize: 10 }, axisLabel: { color: axis, fontSize: 10 }, splitLine: { lineStyle: { color: grid } } },
      { type: 'value', name: 'SIP ₹ Cr', nameTextStyle: { color: axis, fontSize: 10 }, axisLabel: { color: axis, fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      ...CHART_GROUPS.map(([g, label, color]) => ({
        name: label, type: 'bar', stack: 'flow', data: oldestFirst.map(mm => groupTotal(mm, g)), itemStyle: { color },
      })),
      { name: 'SIP inflow', type: 'line', yAxisIndex: 1, data: oldestFirst.map(mm => mm.total.sip_inflow),
        lineStyle: { width: 2, color: '#E5E7EB' }, itemStyle: { color: '#E5E7EB' }, symbolSize: 5 },
    ],
  } : null

  const buildExport = (): SheetSpec | null => {
    if (!m) return null
    const desk = currentDesk()
    const rows: SheetSpec['rows'] = []
    for (const g of m.groups) {
      for (const c of g.categories) rows.push({ group: `${g.section} · ${g.group}`, cat: c.name, ...c })
      if (g.total) rows.push({ group: `${g.section} · ${g.group}`, cat: 'Sub total', ...g.total })
    }
    rows.push({ group: '', cat: 'Grand total', ...m.total })
    return {
      sheet: 'Industry', title: `Mutual fund industry - ${m.label}`,
      meta: [['Desk', desk.name], ['Source', 'AMFI Monthly Report'], ['Month', m.label], ['Amounts', '₹ crore']],
      columns: [
        { key: 'group', label: 'Group', type: 'text', width: 30 }, { key: 'cat', label: 'Category', type: 'text', width: 36 },
        { key: 'schemes', label: 'Schemes', type: 'int' }, { key: 'folios', label: 'Folios', type: 'int' },
        { key: 'mobilised', label: 'Money in', type: 'number' }, { key: 'redeemed', label: 'Redeemed', type: 'number' },
        { key: 'net_flow', label: 'Net flow', type: 'number' }, { key: 'aum', label: 'AUM', type: 'number' },
        { key: 'avg_aum', label: 'Average AUM', type: 'number' }, { key: 'sip_inflow', label: 'SIP inflow', type: 'number' },
        { key: 'sip_accounts', label: 'SIP accounts', type: 'int' },
      ],
      rows,
      fileName: `${desk.code} Industry Flows - ${m.month}`,
    }
  }

  const row = (r: IndustryRow, name: string, k: string | null, bold = false) => (
    <tr key={k ?? name} className={bold ? 'benchmark-row' : undefined}>
      <td className="sticky-col text-xs" style={{ fontWeight: bold ? 700 : 500, color: bold ? 'var(--text-hi)' : undefined }}>{name}</td>
      <td className={`ret-cell font-semibold ${signCls(r.net_flow)}`}>{cr(r.net_flow)}</td>
      <td className="ret-cell">{cr(r.mobilised)}</td>
      <td className="ret-cell">{cr(r.redeemed)}</td>
      <td className="ret-cell">{cr(r.aum)}</td>
      <td className="ret-cell">{cr(r.sip_inflow)}</td>
      <td className="ret-cell">{count(r.folios)}</td>
      <td className="ret-cell">{r.schemes ?? '—'}</td>
      <td style={{ textAlign: 'center' }}>{k && series[k] ? <FlowBars values={series[k]} /> : null}</td>
    </tr>
  )

  return (
    <section id="industry-flows" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Industry Flows</span>
        <span className="ml-auto flex items-center gap-2">
          {months.length > 0 && (
            <select value={m?.month ?? ''} onChange={e => setMonth(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm"
                    style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)' }}>
              {months.map(x => <option key={x.month} value={x.month}>{x.label}</option>)}
            </select>
          )}
          <DownloadButton build={buildExport} disabledHint="No data yet" />
        </span>
      </div>

      {loading ? (
        <div className="card p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-full" />)}</div>
      ) : !m ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-mid)' }}>
          {error ? 'Industry data is not available yet. It appears after the next data refresh.' : 'No data.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {[
              ['Industry AUM', lakhCr(m.total.aum), `End of ${m.label}`, null],
              ['Net inflow', '₹' + cr(m.total.net_flow) + ' Cr', 'All schemes, the month', m.total.net_flow],
              ['Equity net inflow', '₹' + cr(groupTotal(m, 'Equity Schemes')) + ' Cr', 'Active equity schemes', groupTotal(m, 'Equity Schemes')],
              ['SIP inflow', '₹' + cr(m.total.sip_inflow) + ' Cr', 'Money through SIPs this month', null],
              ['SIP accounts', count(m.total.sip_accounts), `${count(m.total.sip_registered)} new · ${count(m.total.sip_stopped)} stopped`, null],
              ['Folios', count(m.total.folios), 'Investor accounts', null],
            ].map(([l, v, s, sign]) => (
              <div key={l as string} className="card p-3">
                <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{l}</div>
                <div className={`font-display font-bold text-lg ${sign == null ? '' : signCls(sign as number)}`}
                     style={sign == null ? { color: 'var(--text-hi)' } : undefined}>{v}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{s}</div>
              </div>
            ))}
          </div>

          {chart && (
            <div className="card p-3 mb-4">
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>Net flows by type and SIP inflow, last {months.length} months</div>
              <ReactECharts option={chart} style={{ height: 300 }} notMerge />
            </div>
          )}

          <div className="card overflow-hidden mb-4">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col text-left" style={{ minWidth: 260 }}>Category ({m.label}, ₹ crore)</th>
                    <th style={{ textAlign: 'right' }} title="Money in minus redemptions">Net flow</th>
                    <th style={{ textAlign: 'right' }} title="Funds mobilised: purchases, SIPs, switches in">Money in</th>
                    <th style={{ textAlign: 'right' }} title="Repurchases / redemptions">Redeemed</th>
                    <th style={{ textAlign: 'right' }} title="Net assets at month end">AUM</th>
                    <th style={{ textAlign: 'right' }}>SIP inflow</th>
                    <th style={{ textAlign: 'right' }} title="Investor accounts">Folios</th>
                    <th style={{ textAlign: 'right' }}>Schemes</th>
                    <th style={{ textAlign: 'center' }} title={`${oldestFirst[0]?.label} to ${months[0]?.label}`}>Net flow, {months.length} months</th>
                  </tr>
                </thead>
                <tbody>
                  {m.groups.map(g => (
                    <FragmentGroup key={`${g.section}|${g.group}`} title={`${g.group}${g.section !== 'Open ended' ? ` (${g.section.toLowerCase()})` : ''}`}>
                      {g.categories.map(c => row(c, c.name, `${g.section}|${g.group}|${c.name}`))}
                      {g.total && g.categories.length > 1 && row(g.total, `Total ${g.group}`, null, true)}
                    </FragmentGroup>
                  ))}
                  {row(m.total, 'Grand total (all schemes)', null, true)}
                  {m.fof_domestic && row(m.fof_domestic, 'Fund of Funds (domestic) — shown separately by AMFI', null)}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-mid)' }}>
            <b style={{ color: 'var(--text-hi)' }}>Where this comes from.</b> AMFI&apos;s Monthly Report, published around the 10th of
            the next month; the latest month here is {months[0].label}. Amounts in ₹ crore.
            <ul className="mt-1 space-y-1 list-disc pl-4">
              <li><b>Net flow</b> = money in − redemptions: positive means investors added money to the category that month.</li>
              <li><b>Money in</b> = purchases, SIP instalments and switches in. <b>Redeemed</b> = sales and switches out.</li>
              <li><b>AUM</b> = the category&apos;s assets at month end; it moves with both flows and markets.</li>
              <li><b>SIP inflow</b> = money that came in through SIPs; <b>SIP accounts</b> = live SIPs at month end.</li>
              <li><b>Folios</b> = investor accounts (one investor can hold several). Debt flows swing with quarter-end
                corporate cash, so a large debt outflow in March/June/September/December is normal.</li>
              <li>The small bars show each category&apos;s net flow for every month shown, oldest on the left: green in, red out.</li>
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

function FragmentGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="sector-row">
        <td className="sticky-col text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent-a)' }}>{title}</td>
        <td colSpan={8} />
      </tr>
      {children}
    </>
  )
}

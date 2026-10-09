// src/components/QuartileTable.tsx — how each fund has ranked in its category,
// recently: the last 6 quarters and the last 6 months, Q1 (top 25%) to Q4.
//
// Read from each category's quartile files (quartiles_quarterly.json and
// quartiles_monthly.json — the same numbers as the Quartile Ranking tab). Every
// pill's tooltip gives the return that period. "Top half" counts how many of the
// 6 quarters and 6 months the fund spent in Q1 or Q2. A fund whose category has
// no quartile file (e.g. some debt categories) shows dashes.

import { useEffect, useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { categoryPath } from '../config/dataPaths'
import { categoryColor } from '../config/categoryColors'
import FundLink from './FundLink'
import type { FundsIndex, QuartilesData } from '../types'

type Mode = 'quarterly' | 'monthly'
const LAST = 6

/** Both quartile files for each category asked for (fetched once each). */
function useQuartileFiles(slugs: string[]) {
  const [files, setFiles] = useState<Record<string, QuartilesData | null>>({})
  const key = [...new Set(slugs)].sort().join(',')
  useEffect(() => {
    for (const slug of new Set(slugs)) {
      for (const mode of ['quarterly', 'monthly'] as Mode[]) {
        const k = `${slug}|${mode}`
        if (k in files) continue
        setFiles(f => ({ ...f, [k]: null }))
        categoryPath(slug, `quartiles_${mode}.json`).then(p => fetch(`/data/${p}`)).then(r => (r.ok ? r.json() : null))
          .then((d: QuartilesData | null) => d && setFiles(f => ({ ...f, [k]: d }))).catch(() => { /* no file for this category */ })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return files
}

const pct = (v: number | null | undefined) => (v == null ? '' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`)

export default function QuartileTable({ codes, tags, note }: {
  codes: string[]
  /** A short tag after a fund's name, e.g. "EXIT". */
  tags?: Record<string, string>
  note?: string
}) {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const fundBy = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const list = [...new Set(codes)].filter(c => fundBy.has(c))
  const files = useQuartileFiles(list.map(c => fundBy.get(c)!.s))

  // Columns: the last 6 periods of the newest file of each kind.
  const labels = (mode: Mode) => {
    const all = Object.entries(files).filter(([k, v]) => k.endsWith(`|${mode}`) && v).map(([, v]) => v!)
    const newest = all.sort((a, b) => (a.as_of < b.as_of ? 1 : -1))[0]
    return newest ? newest.period_labels.slice(-LAST) : []
  }
  const qLabels = labels('quarterly'), mLabels = labels('monthly')
  const cell = (code: string, mode: Mode, label: string) => {
    const f = files[`${fundBy.get(code)!.s}|${mode}`]
    const row = f?.funds.find(r => r.scheme_code === code)
    const i = f ? f.period_labels.indexOf(label) : -1
    return { q: row && i >= 0 ? row.quartiles[i] ?? null : null, r: row && i >= 0 ? row.returns?.[i] ?? null : null, has: !!row }
  }
  if (!list.length) return null

  const head = (l: string) => <th key={l} style={{ textAlign: 'center', minWidth: 46 }}>{l.replace('-20', " '")}</th>
  return (
    <div className="card overflow-hidden mb-3">
      <div className="table-scroll">
        <table className="data-table" data-nosort="">
          <thead>
            <tr>
              <th className="sticky-col text-left" style={{ minWidth: 230 }} rowSpan={2}>Fund</th>
              <th colSpan={qLabels.length || 1} style={{ textAlign: 'center', borderLeft: '1px solid var(--line)' }}>Quarterly — last {LAST}</th>
              <th colSpan={mLabels.length || 1} style={{ textAlign: 'center', borderLeft: '1px solid var(--line)' }}>Monthly — last {LAST}</th>
              <th rowSpan={2} style={{ textAlign: 'right', borderLeft: '1px solid var(--line)' }} title="Quarters and months (of the last 6 each) in Q1 or Q2">Top half</th>
            </tr>
            <tr>
              {qLabels.length ? qLabels.map(head) : <th>—</th>}
              {mLabels.length ? mLabels.map(head) : <th>—</th>}
            </tr>
          </thead>
          <tbody>
            {list.map(code => {
              const f = fundBy.get(code)!
              const qs = qLabels.map(l => cell(code, 'quarterly', l)), ms = mLabels.map(l => cell(code, 'monthly', l))
              const top = (xs: { q: number | null }[]) => xs.filter(x => x.q === 1 || x.q === 2).length
              const ranked = (xs: { q: number | null }[]) => xs.filter(x => x.q != null).length
              const pill = (x: { q: number | null; r: number | null }, l: string, i: number, first: boolean) => (
                <td key={l} style={{ textAlign: 'center', borderLeft: first && i === 0 ? '1px solid var(--line)' : undefined }}
                    title={x.q ? `${l}: Q${x.q}${x.r != null ? ` · return ${pct(x.r)}` : ''}` : `${l}: not ranked`}>
                  <span className={`q-pill ${x.q ? `q-pill-${x.q}` : 'q-pill-nil'}`}>{x.q ? `Q${x.q}` : '—'}</span>
                </td>
              )
              return (
                <tr key={code}>
                  <td className="sticky-col text-xs" style={{ maxWidth: 300 }}>
                    <div className="truncate font-medium"><FundLink code={code} name={f.n} />
                      {tags?.[code] && <span className="ml-1.5 text-[9px] font-bold px-1 rounded" style={{ border: '1px solid currentColor', color: tags[code] === 'NEW' ? '#16A34A' : '#DC2626' }}>{tags[code]}</span>}
                    </div>
                    <div className="text-[10px]" style={{ color: categoryColor(f.s) }}>{f.k}</div>
                  </td>
                  {qs.length ? qs.map((x, i) => pill(x, qLabels[i], i, true)) : <td style={{ textAlign: 'center' }}>—</td>}
                  {ms.length ? ms.map((x, i) => pill(x, mLabels[i], i, true)) : <td style={{ textAlign: 'center' }}>—</td>}
                  <td className="ret-cell text-xs" style={{ borderLeft: '1px solid var(--line)' }}>
                    {ranked(qs) + ranked(ms) ? `${top(qs) + top(ms)}/${ranked(qs) + ranked(ms)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px]" style={{ color: 'var(--text-mid)' }}>
        Q1 = top 25% of the fund&apos;s category for that period&apos;s return, Q4 = bottom 25% (same numbers as the Quartile Ranking tab).
        Hover a pill for the return. <b>Top half</b> = periods in Q1 or Q2, out of those ranked.{note ? ` ${note}` : ''}
      </p>
    </div>
  )
}

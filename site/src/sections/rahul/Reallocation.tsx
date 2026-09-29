// src/sections/rahul/Reallocation.tsx — a client's existing mutual funds
// (uploaded from an MFBOX export) against the proposed portfolio after
// reallocation, mutual funds and SIFs.
//
// Upload → each line is matched to our fund list (weak matches flagged, every
// match can be changed) → the proposal starts as a copy of the existing funds
// and is edited → the page lists the switches to make (exit / reduce / add /
// new), the gain being realised on what is sold, and the full analysis of
// existing vs proposed: allocation, holdings, returns, SIP returns and ratios,
// then the SIF part. Kept in this browser, one per client.

import { useEffect, useMemo, useState } from 'react'
import { useJson } from '../../hooks/useData'
import FundPicker from '../../components/FundPicker'
import FundLink from '../../components/FundLink'
import PortfolioReview, { inr, inrShort, pct1 } from '../../components/PortfolioReview'
import { SifAnalysis, SifEditor, type SifLine } from '../../components/SifPlan'
import { readHoldingsFile, type UploadedRow } from '../../utils/holdingsUpload'
import { fmtPct, retColor } from '../../utils/format'
import { MfEditor, inputStyle, type MfLine } from './ClientPlan'
import type { FundsIndex } from '../../types'

interface Realloc {
  client: string
  file: string | null
  rows: UploadedRow[]
  proposed: MfLine[]
  sif: SifLine[]
}
const STORE = 'rahul_realloc_v1'
const EMPTY: Realloc = { client: '', file: null, rows: [], proposed: [], sif: [] }
const EX_COLOUR = '#94A3B8', PR_COLOUR = '#22D3EE', SIF_COLOUR = '#A78BFA'

function loadAll(): { current: string; items: Record<string, Realloc> } {
  try {
    const r = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    if (r?.items) return r
  } catch { /* none saved */ }
  return { current: '', items: { '': EMPTY } }
}

export default function Reallocation() {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const funds = index?.funds ?? []
  const fundByCode = useMemo(() => new Map(funds.map(f => [f.c, f])), [funds])
  const [store, setStore] = useState(loadAll)
  const cur = store.items[store.current] ?? EMPTY
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(store)) } catch { /* optional */ } }, [store])
  const update = (patch: Partial<Realloc>) => setStore(s => ({ ...s, items: { ...s.items, [s.current]: { ...cur, ...patch } } }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fix, setFix] = useState<Record<number, string>>({})

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!funds.length) { setErr('Fund list still loading — try again in a moment.'); return }
    setBusy(true); setErr(null)
    try {
      const { rows } = await readHoldingsFile(file, funds)
      update({ file: file.name, rows })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  // Existing portfolio: matched, kept lines added up by fund.
  const existing = useMemo(() => {
    const m = new Map<string, { value: number; invested: number | null }>()
    for (const r of cur.rows) {
      if (r.skip || !r.code) continue
      const x = m.get(r.code) ?? { value: 0, invested: 0 }
      x.value += r.value
      x.invested = x.invested == null || r.invested == null ? null : x.invested + r.invested
      m.set(r.code, x)
    }
    return m
  }, [cur.rows])
  const exTotal = [...existing.values()].reduce((s, x) => s + x.value, 0)
  const exInvested = [...existing.values()].every(x => x.invested != null) ? [...existing.values()].reduce((s, x) => s + (x.invested ?? 0), 0) : null
  const prMf = cur.proposed.reduce((s, l) => s + (l.lump ?? 0), 0)
  const prSif = cur.sif.reduce((s, l) => s + (l.lump ?? 0), 0)
  const unmatched = cur.rows.filter(r => !r.skip && !r.code).length
  const unsure = cur.rows.filter(r => !r.skip && r.code && !r.sure).length

  // Switches: every fund on either side, with what changes.
  const switches = useMemo(() => {
    const codes = [...new Set([...existing.keys(), ...cur.proposed.map(l => l.code)])]
    return codes.map(code => {
      const ex = existing.get(code)?.value ?? 0
      const pr = cur.proposed.find(l => l.code === code)?.lump ?? 0
      const inv = existing.get(code)?.invested ?? null
      const action = ex === 0 ? 'New' : pr === 0 ? 'Exit' : pr < ex - 1 ? 'Reduce' : pr > ex + 1 ? 'Add' : 'Keep'
      // Gain realised on the part sold, in proportion to the fund's gain.
      const sold = Math.max(0, ex - pr)
      const gain = inv != null && ex > 0 ? sold * (1 - inv / ex) : null
      return { code, ex, pr, action, sold, gain, inv }
    }).sort((a, b) => ['Exit', 'Reduce', 'Keep', 'Add', 'New'].indexOf(a.action) - ['Exit', 'Reduce', 'Keep', 'Add', 'New'].indexOf(b.action) || b.ex - a.ex)
  }, [existing, cur.proposed])
  const soldTotal = switches.reduce((s, x) => s + x.sold, 0)
  const gainTotal = switches.every(x => x.gain != null || x.sold === 0) ? switches.reduce((s, x) => s + (x.gain ?? 0), 0) : null

  const saved = Object.keys(store.items).filter(k => k)
  const saveAs = () => {
    const nm = cur.client.trim()
    if (!nm) { window.alert('Enter the client name first.'); return }
    setStore(s => {
      const items = { ...s.items, [nm]: { ...cur, client: nm } }
      if (s.current === '') items[''] = EMPTY
      return { current: nm, items }
    })
  }
  const setRow = (i: number, patch: Partial<UploadedRow>) => update({ rows: cur.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  return (
    <section id="reallocation" className="px-4 sm:px-6 py-6 max-w-screen-2xl mx-auto">
      <div className="section-header">
        <span>Portfolio Reallocation</span>
        <span className="ml-auto flex items-center gap-2 text-xs print:hidden">
          <select value={store.current} onChange={e => setStore(s => ({ ...s, current: e.target.value }))}
                  className="px-2 py-1 rounded text-xs" style={inputStyle}>
            <option value="">New client</option>
            {saved.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="tab-btn" onClick={saveAs}>Save for this client</button>
          {store.current && (
            <button className="tab-btn" onClick={() => {
              if (!window.confirm(`Delete ${store.current}?`)) return
              setStore(s => { const items = { ...s.items }; delete items[s.current]; return { current: '', items: { '': EMPTY, ...items } } })
            }}>Delete</button>
          )}
          <button className="tab-btn" onClick={() => window.print()}>Print / PDF</button>
        </span>
      </div>

      {/* ── upload ── */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs" style={{ color: 'var(--text-mid)' }}>Client
            <input value={cur.client} onChange={e => update({ client: e.target.value })} placeholder="Client name"
                   className="block mt-1 px-2 py-1.5 rounded text-sm" style={{ ...inputStyle, width: 220 }} />
          </label>
          <label className="tab-btn active cursor-pointer text-xs" style={{ padding: '8px 14px' }}>
            {busy ? 'Reading…' : '⬆ Upload existing holdings (MFBOX Excel / CSV)'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {cur.file && <span className="text-xs pb-2" style={{ color: 'var(--text-mid)' }}>{cur.file} · {cur.rows.length} lines</span>}
        </div>
        {err && <div className="text-xs mt-2" style={{ color: '#F87171' }}>{err}</div>}
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-low)' }}>
          The file is read in this browser only, nothing is uploaded to a server. It needs a header row with the scheme name and
          the current / market value; invested amount, units and folio are used when present. Direct and IDCW plans are matched to
          the same fund&apos;s regular growth plan (the one the dashboard tracks).
        </p>
      </div>

      {cur.rows.length > 0 && (
        <div className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 flex items-center gap-3">
            <span className="font-display font-bold text-sm" style={{ color: EX_COLOUR }}>Existing holdings</span>
            <span className="text-[11px]" style={{ color: 'var(--text-mid)' }}>
              {inrShort(exTotal)} in {existing.size} funds
              {exInvested != null && <> · invested {inrShort(exInvested)} · gain <b className={retColor(exTotal - exInvested)}>{inrShort(exTotal - exInvested)} ({fmtPct(exTotal / exInvested - 1)})</b></>}
            </span>
            {(unmatched > 0 || unsure > 0) && (
              <span className="text-[11px]" style={{ color: '#F59E0B' }}>
                {unmatched > 0 && `${unmatched} not matched`}{unmatched > 0 && unsure > 0 && ' · '}{unsure > 0 && `${unsure} to check`} — fix in the Matched fund column
              </span>
            )}
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th className="text-left">In the file</th><th className="text-left">Matched fund</th>
                <th className="text-left">Folio</th><th style={{ textAlign: 'right' }}>Units</th>
                <th style={{ textAlign: 'right' }}>Invested</th><th style={{ textAlign: 'right' }}>Current value</th>
                <th style={{ textAlign: 'right' }}>Gain</th><th style={{ textAlign: 'right' }}>Weight</th><th>Use</th>
              </tr></thead>
              <tbody>
                {cur.rows.map((r, i) => {
                  const f = r.code ? fundByCode.get(r.code) : null
                  return (
                    <tr key={i} style={{ opacity: r.skip ? 0.45 : 1 }}>
                      <td className="text-[11px]" style={{ maxWidth: 260, color: 'var(--text-mid)' }} title={r.raw}><div className="truncate">{r.raw}</div></td>
                      <td style={{ minWidth: 260 }}>
                        {f && fix[i] == null ? (
                          <div className="flex items-center gap-1.5">
                            {!r.sure && <span title="Check this match" style={{ color: '#F59E0B' }}>⚠</span>}
                            <span className="text-xs truncate" style={{ maxWidth: 220 }}><FundLink code={f.c} name={f.n} /></span>
                            <button className="text-[10px]" onClick={() => setFix(x => ({ ...x, [i]: '' }))}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-a)', cursor: 'pointer' }}>change</button>
                          </div>
                        ) : (
                          <FundPicker funds={funds} value={fix[i] ?? ''} onChange={v => setFix(x => ({ ...x, [i]: v }))} autoFocus={fix[i] != null}
                                      onPick={p => { setRow(i, { code: p.c, sure: true }); setFix(x => { const y = { ...x }; delete y[i]; return y }) }}
                                      placeholder={r.code ? 'Pick the right fund…' : 'Not matched — pick the fund…'} style={inputStyle} />
                        )}
                      </td>
                      <td className="text-[11px]" style={{ color: 'var(--text-low)' }}>{r.folio ?? ''}</td>
                      <td className="ret-cell text-xs">{r.units == null ? '—' : r.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                      <td className="ret-cell text-xs">{r.invested == null ? '—' : inr(r.invested)}</td>
                      <td className="ret-cell text-xs font-semibold">{inr(r.value)}</td>
                      <td className={`ret-cell text-xs ${retColor(r.invested ? r.value - r.invested : null)}`}>
                        {r.invested ? fmtPct(r.value / r.invested - 1) : '—'}
                      </td>
                      <td className="ret-cell text-[11px]" style={{ color: 'var(--text-low)' }}>{!r.skip && exTotal ? pct1(r.value / exTotal) : ''}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!r.skip} onChange={e => setRow(i, { skip: !e.target.checked })} title="Include in the existing portfolio" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── proposal ── */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: PR_COLOUR }}>Proposed mutual funds</div>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(prMf)}</b></span>
              {existing.size > 0 && (
                <button className="tab-btn" title="Start the proposal from the existing funds and amounts"
                        onClick={() => update({ proposed: [...existing.entries()].map(([code, x]) => ({ code, lump: Math.round(x.value), sip: null })) })}>
                  Copy existing → proposed
                </button>
              )}
              {cur.proposed.length > 0 && <button className="tab-btn" onClick={() => { if (window.confirm('Clear the proposed funds?')) update({ proposed: [] }) }}>Clear</button>}
            </div>
          </div>
          <MfEditor lines={cur.proposed} onChange={proposed => update({ proposed })} weightOf={l => l.lump ?? 0} showSip={false} />
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-bold text-sm" style={{ color: SIF_COLOUR }}>Proposed SIF</div>
            <span className="text-xs" style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(prSif)}</b></span>
          </div>
          <SifEditor lines={cur.sif} onChange={sif => update({ sif })} inputStyle={inputStyle} weightOf={l => l.lump ?? 0} showSip={false} />
        </div>
      </div>

      {(exTotal > 0 || prMf + prSif > 0) && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
          {[
            ['Existing', inrShort(exTotal), EX_COLOUR],
            ['Proposed MF', inrShort(prMf), PR_COLOUR],
            ['Proposed SIF', inrShort(prSif), SIF_COLOUR],
            [prMf + prSif - exTotal >= 0 ? 'Fresh money needed' : 'Not yet reinvested', inrShort(Math.abs(prMf + prSif - exTotal)),
             Math.abs(prMf + prSif - exTotal) < 1 ? undefined : '#F59E0B'],
            ['Sold · gain realised', `${inrShort(soldTotal)}${gainTotal != null && soldTotal ? ` · ${inrShort(gainTotal)}` : ''}`, undefined],
          ].map(([l, v, c]) => (
            <div key={l} className="card p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{l}</div>
              <div className="font-display font-bold text-lg" style={{ color: c ?? 'var(--text-hi)' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── switches ── */}
      {existing.size > 0 && cur.proposed.length > 0 && (
        <div className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Switches to make</div>
          <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
            Gain realised = the part sold × the fund&apos;s gain (from the invested amount in the file). Check exit loads and tax before switching.
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th className="text-left">Fund</th><th className="text-left">Action</th>
                <th style={{ textAlign: 'right' }}>Existing</th><th style={{ textAlign: 'right' }}>Proposed</th>
                <th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Gain realised</th>
              </tr></thead>
              <tbody>
                {switches.map(s => {
                  const colour = { Exit: '#F87171', Reduce: '#F59E0B', Keep: 'var(--text-mid)', Add: '#34D399', New: '#22D3EE' }[s.action]
                  return (
                    <tr key={s.code}>
                      <td className="text-xs" style={{ maxWidth: 300 }}>
                        <div className="truncate"><FundLink code={s.code} name={fundByCode.get(s.code)?.n ?? s.code} /></div>
                        <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fundByCode.get(s.code)?.k}</div>
                      </td>
                      <td className="text-xs font-semibold" style={{ color: colour }}>{s.action}</td>
                      <td className="ret-cell text-xs">{s.ex ? inr(s.ex) : '—'}</td>
                      <td className="ret-cell text-xs">{s.pr ? inr(s.pr) : '—'}</td>
                      <td className="ret-cell text-xs" style={{ color: colour }}>{s.pr - s.ex === 0 ? '—' : `${s.pr > s.ex ? '+' : '−'}${inr(Math.abs(s.pr - s.ex))}`}</td>
                      <td className={`ret-cell text-xs ${retColor(s.gain)}`}>{s.sold ? (s.gain == null ? '—' : inr(s.gain)) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PortfolioReview title="Mutual funds — existing vs proposed" sides={[
        { label: 'Existing', colour: EX_COLOUR, lines: [...existing.entries()].map(([code, x]) => ({ code, amount: x.value })) },
        { label: 'Proposed', colour: PR_COLOUR, lines: cur.proposed.map(l => ({ code: l.code, amount: l.lump })) },
      ].filter(s => s.lines.some(l => (l.amount ?? 0) > 0))} />

      {cur.sif.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}><span>Proposed SIF — analysis</span></div>
          <SifAnalysis lines={cur.sif.map(l => ({ id: l.id, amount: l.lump ?? 0 }))} colour={SIF_COLOUR} />
        </>
      )}
    </section>
  )
}

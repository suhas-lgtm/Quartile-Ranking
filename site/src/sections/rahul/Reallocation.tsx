// src/sections/rahul/Reallocation.tsx — a client's existing mutual funds
// (uploaded from an MFBOX export) against the suggested portfolio after
// reallocation, mutual funds and SIFs.
//
// Upload → each line is matched to our fund list (weak matches flagged, every
// match can be changed) → the suggestion starts as a copy of the existing funds
// and is edited → the page lists the switches to make (exit / reduce / add /
// new), the gain being realised on what is sold, and the full analysis of
// existing vs suggested: allocation, holdings, returns, SIP returns and ratios,
// then the SIF part. Kept in this browser, one per client.

import { useEffect, useMemo, useState } from 'react'
import { nextMilestone } from '../../components/Milestone'
import { PdfButton, PdfProvider, PdfSection } from '../../components/PdfSections'
import { useJson } from '../../hooks/useData'
import FundPicker from '../../components/FundPicker'
import FundLink from '../../components/FundLink'
import PortfolioReview, { inr, inrShort, pct1 } from '../../components/PortfolioReview'
import { SifAnalysis, SifEditor, type SifLine } from '../../components/SifPlan'
import { readHoldingsFile, type UploadInfo, type UploadedRow } from '../../utils/holdingsUpload'
import { fmtPct, retColor } from '../../utils/format'
import { inputStyle, type MfLine } from './ClientPlan'
import SuggestedEditor from '../../components/SuggestedEditor'
import type { FundsIndex } from '../../types'

interface Realloc {
  client: string
  file: string | null
  /** Which columns of the file the values came from. */
  info?: UploadInfo | null
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
      const { rows, info } = await readHoldingsFile(file, funds)
      update({ file: file.name, rows, info })
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
      // Selling part of a fund books profit in proportion to that fund's overall gain:
      // sell ₹4 L of a fund worth ₹10 L that cost ₹6 L → ₹2.4 L is cost coming back, ₹1.6 L is profit.
      const sold = Math.max(0, ex - pr)
      const bought = Math.max(0, pr - ex)
      const gain = inv != null && ex > 0 ? sold * (1 - inv / ex) : null
      const cost = gain != null ? sold - gain : null
      return { code, ex, pr, action, sold, bought, gain, cost, inv }
    }).sort((a, b) => ['Exit', 'Reduce', 'Keep', 'Add', 'New'].indexOf(a.action) - ['Exit', 'Reduce', 'Keep', 'Add', 'New'].indexOf(b.action) || b.ex - a.ex)
  }, [existing, cur.proposed])
  const soldTotal = switches.reduce((s, x) => s + x.sold, 0)
  const gainTotal = switches.every(x => x.gain != null || x.sold === 0) ? switches.reduce((s, x) => s + (x.gain ?? 0), 0) : null
  const boughtTotal = switches.reduce((s, x) => s + x.bought, 0)
  const sellCount = switches.filter(x => x.sold > 0).length
  const buyCount = switches.filter(x => x.bought > 0).length

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
    <PdfProvider pageKey="rahul-realloc" doc={{
      kicker: 'Portfolio review', title: 'Portfolio Reallocation Proposal', client: cur.client || undefined,
      advisor: { name: 'Rahul', mobile: '+91 98091 10073' },
      stats: [
        { label: 'Existing portfolio', value: inrShort(exTotal) },
        { label: 'Suggested portfolio', value: inrShort(prMf + prSif) },
        { label: 'Funds', value: `${existing.size} → ${cur.proposed.filter(l => (l.lump ?? 0) > 0).length + cur.sif.filter(l => (l.lump ?? 0) > 0).length}` },
        prMf + prSif - exTotal >= 0
          ? { label: 'Fresh money', value: inrShort(prMf + prSif - exTotal) }
          : { label: 'Money left over', value: inrShort(exTotal - prMf - prSif) },
      ],
    }}>
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
          <PdfButton title={cur.client || 'Portfolio Reallocation'} />
        </span>
      </div>

      {/* ── upload ── */}
      <div className="card p-4 mb-4 print:hidden">
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
        {cur.info && (
          <div className="text-[11px] mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-mid)' }}>
            <span>Read from sheet <b>{cur.info.sheet}</b>:</span>
            {([['Fund', cur.info.columns.name], ['Current value', cur.info.columns.value], ['Invested', cur.info.columns.invested],
               ['Units', cur.info.columns.units], ['Folio', cur.info.columns.folio], ['SIP', cur.info.columns.sip]] as const).map(([k, v]) => (
              <span key={k}>{k} ← {v ? <b>&ldquo;{v}&rdquo;</b> : <b style={{ color: '#F59E0B' }}>not in the file</b>}</span>
            ))}
            {!cur.info.columns.sip && (
              <span style={{ color: '#F59E0B' }}>
                No SIP column found — type the SIP amounts in the SIP column below, or send us the column name MFBOX uses.
              </span>
            )}
          </div>
        )}
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-low)' }}>
          The file is read in this browser only, nothing is uploaded to a server. It needs a header row with the scheme name and
          the current / market value; invested amount, units and folio are used when present. Direct and IDCW plans are matched to
          the same fund&apos;s regular growth plan (the one the dashboard tracks).
        </p>
      </div>

      {cur.rows.length > 0 && (
        <PdfSection id="existing" page label="Existing holdings (from the upload)" kicker="Where you stand today" title="Existing Holdings">
        <div className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 flex items-center gap-3">
            <span className="font-display font-bold text-sm" style={{ color: EX_COLOUR }}>Existing holdings</span>
            <span className="text-[11px]" style={{ color: 'var(--text-mid)' }}>
              {inrShort(exTotal)} in {existing.size} funds
              {exInvested != null && <> · invested {inrShort(exInvested)} · gain <b className={retColor(exTotal - exInvested)}>{inrShort(exTotal - exInvested)} ({fmtPct(exTotal / exInvested - 1)})</b></>}
            </span>
            {(unmatched > 0 || unsure > 0) && (
              <span className="text-[11px] print:hidden" style={{ color: '#F59E0B' }}>
                {unmatched > 0 && `${unmatched} not matched`}{unmatched > 0 && unsure > 0 && ' · '}{unsure > 0 && `${unsure} to check`} — fix in the Matched fund column
              </span>
            )}
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                {/* Screen: the full working table. Print: Fund, Folio, Units, Invested, Current, Abs return, SIP. */}
                <th className="text-left print:hidden">In the file</th>
                <th className="text-left"><span className="print:hidden">Matched fund</span><span className="hidden print:inline">Fund</span></th>
                <th className="text-left">Folio</th>
                <th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Invested</th>
                <th style={{ textAlign: 'right' }}>Current value</th>
                <th style={{ textAlign: 'right' }}><span className="print:hidden">Gain</span><span className="hidden print:inline">Abs return</span></th>
                <th style={{ textAlign: 'right' }}>SIP ₹ / month</th>
                <th className="print:hidden" style={{ textAlign: 'right' }}>Weight</th><th className="print:hidden">Use</th>
              </tr></thead>
              <tbody>
                {cur.rows.map((r, i) => {
                  const f = r.code ? fundByCode.get(r.code) : null
                  return (
                    <tr key={i} className={r.skip ? 'print:hidden' : undefined} style={{ opacity: r.skip ? 0.45 : 1 }}>
                      <td className="text-[11px] print:hidden" style={{ maxWidth: 260, color: 'var(--text-mid)' }} title={r.raw}><div className="truncate">{r.raw}</div></td>
                      <td style={{ minWidth: 260 }}>
                        {f && fix[i] == null ? (
                          <div className="flex items-center gap-1.5">
                            {!r.sure && <span className="print:hidden" title="Check this match" style={{ color: '#F59E0B' }}>⚠</span>}
                            <span className="text-xs truncate" style={{ maxWidth: 300 }}><FundLink code={f.c} name={f.n} /></span>
                            <button className="text-[10px]" onClick={() => setFix(x => ({ ...x, [i]: '' }))}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-a)', cursor: 'pointer' }}>change</button>
                          </div>
                        ) : (
                          <>
                            <span className="hidden print:inline text-xs">{r.raw}</span>
                            <div className="print:hidden">
                              <FundPicker funds={funds} value={fix[i] ?? ''} onChange={v => setFix(x => ({ ...x, [i]: v }))} autoFocus={fix[i] != null}
                                          onPick={p => { setRow(i, { code: p.c, sure: true }); setFix(x => { const y = { ...x }; delete y[i]; return y }) }}
                                          placeholder={r.code ? 'Pick the right fund…' : 'Not matched — pick the fund…'} style={inputStyle} />
                            </div>
                          </>
                        )}
                      </td>
                      <td className="text-[11px]" style={{ color: 'var(--text-mid)' }}>{r.folio ?? '—'}</td>
                      <td className="ret-cell text-xs">{r.units == null ? '—' : r.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                      <td className="ret-cell text-xs">{r.invested == null ? '—' : inr(r.invested)}</td>
                      <td className="ret-cell text-xs font-semibold">{inr(r.value)}</td>
                      <td className={`ret-cell text-xs ${retColor(r.invested ? r.value - r.invested : null)}`}>
                        {r.invested ? fmtPct(r.value / r.invested - 1) : '—'}
                      </td>
                      <td className="ret-cell text-xs" style={{ width: 120 }}>
                        {/* From the file's SIP column when it has one; type it in when it does not. */}
                        <span className="hidden print:inline">{r.sip ? inr(r.sip) : '—'}</span>
                        <input type="number" min={0} step={500} value={r.sip ?? ''} placeholder="—"
                               onChange={e => setRow(i, { sip: e.target.value === '' ? null : Math.max(0, +e.target.value) })}
                               className="px-2 py-1 rounded text-xs w-full text-right print:hidden" style={inputStyle} />
                      </td>
                      <td className="ret-cell text-[11px] print:hidden" style={{ color: 'var(--text-low)' }}>{!r.skip && exTotal ? pct1(r.value / exTotal) : ''}</td>
                      <td className="print:hidden" style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!r.skip} onChange={e => setRow(i, { skip: !e.target.checked })} title="Include in the existing portfolio" />
                      </td>
                    </tr>
                  )
                })}
                {(() => {
                  const used = cur.rows.filter(r => !r.skip)
                  const inv = used.every(r => r.invested != null) ? used.reduce((t, r) => t + (r.invested ?? 0), 0) : null
                  const sip = used.reduce((t, r) => t + (r.sip ?? 0), 0)
                  return (
                    <tr className="benchmark-row">
                      <td className="print:hidden" />
                      <td className="text-xs font-semibold">Total · {used.length} holding{used.length === 1 ? '' : 's'}</td><td /><td />
                      <td className="ret-cell text-xs font-semibold">{inv == null ? '—' : inr(inv)}</td>
                      <td className="ret-cell text-xs font-semibold">{inr(exTotal)}</td>
                      <td className={`ret-cell text-xs font-semibold ${retColor(inv ? exTotal - inv : null)}`}>{inv ? fmtPct(exTotal / inv - 1) : '—'}</td>
                      <td className="ret-cell text-xs font-semibold">{sip ? inr(sip) : '—'}</td>
                      <td className="print:hidden" /><td className="print:hidden" />
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </div>
        </PdfSection>
      )}

      {/* ── suggested portfolio ── */}
      <PdfSection id="suggested" page label="Suggested portfolio — mutual funds (changes)" kicker="What we recommend" title="Suggested Portfolio — Mutual Funds">
      <div className="card p-4 mb-4">
        <SuggestedEditor existing={[...existing.entries()].map(([code, x]) => ({ code, amount: Math.round(x.value) }))}
                         lines={cur.proposed.map(l => ({ code: l.code, amount: l.lump }))}
                         onChange={ls => update({ proposed: ls.map(l => ({ code: l.code, lump: l.amount, sip: null })) })}
                         inputStyle={inputStyle} colour={PR_COLOUR} title="Suggested portfolio — mutual funds" />
      </div>
      </PdfSection>
      <PdfSection id="suggested-sif" label="Suggested portfolio — SIF" kicker="What we recommend" title="Suggested Portfolio — SIF">
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-display font-bold text-sm" style={{ color: SIF_COLOUR }}>Suggested portfolio — SIF</div>
          <span className="text-xs" style={{ color: 'var(--text-mid)' }}>Total <b style={{ color: 'var(--text-hi)' }}>{inr(prSif)}</b></span>
        </div>
        <SifEditor lines={cur.sif} onChange={sif => update({ sif })} inputStyle={inputStyle} weightOf={l => l.lump ?? 0} showSip={false} />
      </div>
      </PdfSection>

      {(exTotal > 0 || prMf + prSif > 0) && (
        <PdfSection id="totals" page label="Totals (existing, suggested, amount to sell and buy, profit booked)" kicker="The switch in numbers" title="What Changes">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-3">
          <Card label="Existing portfolio value" value={inrShort(exTotal)} colour={EX_COLOUR} />
          <Card label="Suggested — mutual funds" value={inrShort(prMf)} colour={PR_COLOUR} />
          <Card label="Suggested — SIF" value={inrShort(prSif)} colour={SIF_COLOUR} />
          {prMf + prSif - exTotal >= 0
            ? <Card label="Fresh money needed" value={inrShort(prMf + prSif - exTotal)} colour={prMf + prSif - exTotal > 1 ? '#F59E0B' : undefined}
                    sub="suggested total − existing value" />
            : <Card label="Money left over (not reinvested)" value={inrShort(exTotal - prMf - prSif)} colour="#F59E0B"
                    sub="existing value − suggested total" />}
          {([['Existing', exTotal, EX_COLOUR], ['Suggested', prMf + prSif, PR_COLOUR]] as const).map(([l, v, c]) => {
            const m = v > 0 ? nextMilestone(v) : null
            return m && (
              <Card key={l} label={`${l} — next milestone`} value={`${inrShort(m.more)} more`} colour={c}
                    sub={`to reach ${inrShort(m.at)} (now ${inrShort(v)})`} />
            )
          })}
        </div>
        {soldTotal > 0 && (
          <div className="card p-4 mb-4">
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>What the switch involves</div>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-2">
              <Card label="① Amount to sell (redeem)" value={inrShort(soldTotal)} colour="#F87171"
                    sub={`from ${sellCount} fund${sellCount === 1 ? '' : 's'} (exits and reductions)`} />
              <Card label="② of which: your original investment" value={gainTotal == null ? '—' : inrShort(soldTotal - gainTotal)}
                    sub="the money put in, coming back" />
              <Card label="③ of which: profit booked" value={gainTotal == null ? '—' : inrShort(gainTotal)}
                    colour={gainTotal != null && gainTotal < 0 ? '#F87171' : '#34D399'} sub="capital gain — taxable on sale" />
              <Card label="④ Amount to buy" value={inrShort(boughtTotal + prSif)} colour={PR_COLOUR}
                    sub={`into ${buyCount} fund${buyCount === 1 ? '' : 's'}${prSif ? ' + SIF' : ''} (new and increased)`} />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-mid)' }}>
              ① = ② + ③. Selling {inrShort(soldTotal)} gives back {gainTotal == null ? 'the money put in' : `${inrShort(soldTotal - gainTotal)} of the client's own money`} plus
              {gainTotal == null ? ' the profit on it' : ` ${inrShort(gainTotal)} of profit`}; that profit is what capital-gains tax applies to
              (short or long term depends on how long each purchase was held — check before switching, along with exit loads).
              {gainTotal == null && ' Profit needs the invested amount in the uploaded file.'}
            </p>
          </div>
        )}
        </PdfSection>
      )}

      {/* ── switches ── */}
      {existing.size > 0 && cur.proposed.length > 0 && (
        <PdfSection id="switches" label="Switches to make (sell, buy, profit booked per fund)" kicker="Fund by fund" title="Switches to Make">
        <div className="card overflow-hidden mb-4">
          <div className="px-4 pt-3 font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>Switches to make — fund by fund</div>
          <div className="px-4 text-[10px]" style={{ color: 'var(--text-low)' }}>
            Sell = existing − suggested. Of what is sold, &ldquo;your cost&rdquo; is the original investment coming back and &ldquo;profit booked&rdquo; the gain on it
            (in the same proportion as the fund&apos;s overall gain in the uploaded file). Check exit loads and tax before switching.
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th className="text-left">Fund</th><th className="text-left">Action</th>
                <th style={{ textAlign: 'right' }}>Existing value</th><th style={{ textAlign: 'right' }}>Suggested value</th>
                <th style={{ textAlign: 'right' }}>Sell ₹</th><th style={{ textAlign: 'right' }}>Buy ₹</th>
                <th style={{ textAlign: 'right' }}>of sale: your cost</th><th style={{ textAlign: 'right' }}>of sale: profit booked</th>
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
                      <td className="ret-cell text-xs font-semibold" style={{ color: s.sold ? '#F87171' : 'var(--text-low)' }}>{s.sold ? inr(s.sold) : '—'}</td>
                      <td className="ret-cell text-xs font-semibold" style={{ color: s.bought ? '#34D399' : 'var(--text-low)' }}>{s.bought ? inr(s.bought) : '—'}</td>
                      <td className="ret-cell text-xs">{s.sold ? (s.cost == null ? '—' : inr(s.cost)) : ''}</td>
                      <td className={`ret-cell text-xs ${retColor(s.gain)}`}>{s.sold ? (s.gain == null ? '—' : inr(s.gain)) : ''}</td>
                    </tr>
                  )
                })}
                <tr className="benchmark-row">
                  <td className="text-xs font-semibold">Total</td><td />
                  <td className="ret-cell text-xs font-semibold">{inr(exTotal)}</td>
                  <td className="ret-cell text-xs font-semibold">{inr(prMf)}</td>
                  <td className="ret-cell text-xs font-semibold" style={{ color: '#F87171' }}>{inr(soldTotal)}</td>
                  <td className="ret-cell text-xs font-semibold" style={{ color: '#34D399' }}>{inr(boughtTotal)}</td>
                  <td className="ret-cell text-xs font-semibold">{gainTotal == null ? '—' : inr(soldTotal - gainTotal)}</td>
                  <td className={`ret-cell text-xs font-semibold ${retColor(gainTotal)}`}>{gainTotal == null ? '—' : inr(gainTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </PdfSection>
      )}


      <PortfolioReview title="Mutual funds — existing vs suggested" sides={[
        { label: 'Existing', colour: EX_COLOUR, lines: [...existing.entries()].map(([code, x]) => ({ code, amount: x.value })) },
        { label: 'Suggested', colour: PR_COLOUR, lines: cur.proposed.map(l => ({ code: l.code, amount: l.lump })) },
      ].filter(s => s.lines.some(l => (l.amount ?? 0) > 0))} />

      {cur.sif.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}><span>Suggested SIF — analysis</span></div>
          <SifAnalysis lines={cur.sif.map(l => ({ id: l.id, amount: l.lump ?? 0 }))} colour={SIF_COLOUR} />
        </>
      )}
    </section>
    </PdfProvider>
  )
}

function Card({ label, value, sub, colour }: { label: string; value: string; sub?: string; colour?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px]" style={{ color: 'var(--text-low)' }}>{label}</div>
      <div className="font-display font-bold text-lg" style={{ color: colour ?? 'var(--text-hi)' }}>{value}</div>
      {sub && <div className="text-[10px]" style={{ color: 'var(--text-mid)' }}>{sub}</div>}
    </div>
  )
}

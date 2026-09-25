// src/components/TeamBlacklist.tsx — "Flagged by the team": the Blacklist the
// team keeps by hand, editable on the page.
//
// Membership comes live from /api/blacklist (server/lists.ts, Neon), so an
// added or removed fund shows at once. Quartiles, returns and ratios come from
// blacklist.json, which the build fills for every listed fund, so a fund added
// since the last refresh shows its name and reason until the next one.
// Viewing is public; adding or removing needs the team password.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useJson } from '../hooks/useData'
import { categoryColor } from '../config/categoryColors'
import { fmtDate, fmtPct, quartilePillClass, retColor } from '../utils/format'
import { periodLabelParts } from '../utils/periods'
import type { FundsIndex, ListedFund } from '../types'
import FundLink from './FundLink'

type Mode = 'monthly' | 'quarterly' | 'annual'
interface Entry { scheme_code: string; reason: string; added_by: string; added_at: string }

const NAME_KEY = 'bl_added_by'
const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

export default function TeamBlacklist({ built, mode, onModeChange }: {
  built: ListedFund[]; mode: Mode; onModeChange: (m: Mode) => void
}) {
  const { data: index } = useJson<FundsIndex>('funds_index.json')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auth, setAuth] = useState<'unknown' | 'in' | 'out'>('unknown')
  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState('')
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/blacklist', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { setEntries(d.funds); setLoadError(null) })
      .catch(e => setLoadError(String(e.message ?? e)))
  }, [])
  useEffect(load, [load])

  const fundByCode = useMemo(() => new Map((index?.funds ?? []).map(f => [f.c, f])), [index])
  const labelOf = (f: FundsIndex['funds'][number]) => `${f.n} — ${f.k}`
  const codeByLabel = useMemo(() => new Map((index?.funds ?? []).map(f => [labelOf(f), f.c])), [index])
  const builtByCode = useMemo(() => new Map(built.map(f => [f.scheme_code, f])), [built])

  const checkSession = async () => {
    const r = await fetch('/api/session', { cache: 'no-store' })
    setAuth(r.ok ? 'in' : 'out')
    return r.ok
  }

  const login = async () => {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
                                          body: JSON.stringify({ password }) })
    setBusy(false)
    if (r.ok) { setAuth('in'); setPassword('') } else setMsg(r.status === 401 ? 'Incorrect password.' : 'Login is not available.')
  }

  const openAdd = async () => { setAdding(true); setMsg(null); if (auth !== 'in') await checkSession() }

  const add = async () => {
    const code = codeByLabel.get(pick)
    if (!code) { setMsg('Pick a fund from the list.'); return }
    setBusy(true); setMsg(null)
    try { localStorage.setItem(NAME_KEY, by) } catch { /* not essential */ }
    const r = await fetch('/api/blacklist', { method: 'POST', headers: { 'content-type': 'application/json' },
                                              body: JSON.stringify({ scheme_code: code, reason, added_by: by }) })
    setBusy(false)
    if (r.status === 401) { setAuth('out'); setMsg('Please log in again.'); return }
    if (!r.ok) { setMsg('Could not save. Try again.'); return }
    setPick(''); setReason(''); setAdding(false); load()
  }

  const remove = async (code: string, name: string) => {
    if (auth !== 'in' && !(await checkSession())) { setAdding(true); setMsg('Log in to remove funds.'); return }
    if (!window.confirm(`Remove "${name}" from the team's blacklist?`)) return
    const r = await fetch(`/api/blacklist/${code}`, { method: 'DELETE' })
    if (r.status === 401) { setAuth('out'); setAdding(true); setMsg('Please log in again.'); return }
    load()
  }

  const rows = entries ?? []
  const inputStyle = { background: 'var(--bg-raised)', border: '1px solid var(--line)', color: 'var(--text-hi)', outline: 'none' }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
          ⛔ Flagged by the team <span style={{ color: 'var(--text-low)', fontWeight: 400 }}>({rows.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => (adding ? setAdding(false) : openAdd())} className="tab-btn font-semibold"
                  style={{ border: '1px solid var(--accent-a)', background: 'rgba(34,211,238,0.08)', color: 'var(--accent-a)' }}>
            {adding ? 'Close' : '+ Add fund'}
          </button>
          <div className="tab-bar flex items-center gap-2">
            {(['monthly', 'quarterly', 'annual'] as Mode[]).map(m => (
              <button key={m} onClick={() => onModeChange(m)} className={`tab-btn${mode === m ? ' active accent' : ''}`}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {adding && (
        <div className="card p-4 mb-3 text-xs" style={{ color: 'var(--text-mid)' }}>
          {auth !== 'in' ? (
            <form onSubmit={e => { e.preventDefault(); login() }} className="flex flex-wrap items-center gap-2">
              <span>🔒 Enter the team password to add or remove funds:</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus
                     className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} placeholder="Password" />
              <button type="submit" disabled={busy || !password} className="tab-btn active accent">Unlock</button>
            </form>
          ) : (
            <form onSubmit={e => { e.preventDefault(); add() }} className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] items-end">
              <label className="flex flex-col gap-1">
                <span>Fund</span>
                <input list="bl-fund-list" value={pick} onChange={e => setPick(e.target.value)} autoFocus
                       placeholder={index ? 'Start typing a fund name…' : 'Loading fund list…'}
                       className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
                <datalist id="bl-fund-list">
                  {(index?.funds ?? []).map(f => <option key={f.c} value={labelOf(f)} />)}
                </datalist>
              </label>
              <label className="flex flex-col gap-1">
                <span>Reason</span>
                <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                       placeholder="e.g. Fund manager changed Aug 2026"
                       className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1">
                <span>Your name</span>
                <input value={by} onChange={e => setBy(e.target.value)} maxLength={60}
                       className="px-3 py-1.5 rounded-lg text-sm" style={inputStyle} />
              </label>
              <button type="submit" disabled={busy || !pick} className="tab-btn active accent" style={{ height: 32 }}>
                {busy ? 'Saving…' : 'Add to blacklist'}
              </button>
            </form>
          )}
          {msg && <div className="mt-2" style={{ color: 'var(--loss)' }}>{msg}</div>}
        </div>
      )}

      <div className="card overflow-hidden mb-6">
        {entries === null && !loadError ? (
          <div className="p-6"><div className="skeleton h-8 w-full" /></div>
        ) : loadError ? (
          <div className="p-6 text-center text-xs" style={{ color: 'var(--text-mid)' }}>
            The team list could not be loaded ({loadError}).
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-xs" style={{ color: 'var(--text-mid)' }}>
            No funds flagged yet. Use <b>+ Add fund</b> to flag one with a reason.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col text-left" style={{ minWidth: 260 }}>Fund</th>
                  <th className="text-left" style={{ minWidth: 200 }}>Reason</th>
                  <th className="text-left">Added</th>
                  <th style={{ textAlign: 'right' }}>NAV</th>
                  <th style={{ textAlign: 'center', minWidth: 180 }}>Quartile · oldest → latest</th>
                  <th style={{ textAlign: 'right' }}>1Y</th>
                  <th style={{ textAlign: 'right' }}>3Y</th>
                  <th style={{ textAlign: 'right' }}>5Y</th>
                  <th style={{ textAlign: 'right' }}>Alpha (3Y)</th>
                  <th style={{ textAlign: 'right' }}>Beta (3Y)</th>
                  <th style={{ textAlign: 'right' }}>Sharpe (3Y)</th>
                  <th />
                </tr>
              </thead>
              <tbody className="rows-enter">
                {rows.map(e => {
                  const f = builtByCode.get(e.scheme_code)
                  const info = fundByCode.get(e.scheme_code)
                  const name = f?.scheme_name ?? info?.n ?? e.scheme_code
                  const slug = f?.category_slug ?? info?.s
                  const colour = slug ? categoryColor(slug, f?.asset_class ?? undefined) : 'var(--text-low)'
                  const q = f?.quartiles[mode]
                  return (
                    <tr key={e.scheme_code}>
                      <td className="sticky-col" style={{ maxWidth: 300 }}>
                        <div className="text-xs font-medium truncate"><FundLink code={e.scheme_code} name={name} /></div>
                        <div className="text-[10px] truncate" style={{ color: colour }}>{f?.category_name ?? info?.k ?? ''}</div>
                      </td>
                      <td className="text-xs" style={{ whiteSpace: 'normal', color: 'var(--text-mid)' }}>{e.reason || '—'}</td>
                      <td className="text-[11px]" style={{ color: 'var(--text-low)' }}>
                        {e.added_by || '—'}<br />{fmtDate(e.added_at)}
                      </td>
                      {f ? (
                        <>
                          <td className="ret-cell">
                            <div>{f.nav == null ? '—' : f.nav.toFixed(2)}</div>
                            <div className="text-[10px]" style={{ color: 'var(--text-low)' }}>{fmtDate(f.nav_date)}</div>
                          </td>
                          <td>
                            {q ? (
                              <div className="flex items-center justify-center gap-1">
                                {q.quartiles.map((qq, i) => {
                                  const { main, sub } = periodLabelParts(q.labels[i])
                                  return (
                                    <div key={i} className={quartilePillClass(qq)} title={`${main}${sub ? ' ' + sub : ''}: ${qq ? 'Q' + qq : 'not ranked'}`}>
                                      {qq ? `Q${qq}` : '−'}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : <div className="text-center text-[11px]" style={{ color: 'var(--text-low)' }}>not ranked</div>}
                          </td>
                          {(['12M', '3Y', '5Y'] as const).map(p => {
                            const v = f.returns?.[p] ?? null
                            return <td key={p} className={`ret-cell ${retColor(v)}`}>{fmtPct(v)}</td>
                          })}
                          <td className={`ret-cell ${retColor(f.ratios?.alpha ?? null)}`}>
                            {f.ratios?.alpha == null ? '—' : (f.ratios.alpha * 100).toFixed(2)}
                          </td>
                          <td className="ret-cell">{num(f.ratios?.beta)}</td>
                          <td className="ret-cell">{num(f.ratios?.sharpe)}</td>
                        </>
                      ) : (
                        <td colSpan={8} className="text-center text-[11px]" style={{ color: 'var(--text-low)' }}>
                          Quartiles, returns and ratios appear after the next data refresh (8:00 AM / 11:45 PM IST).
                        </td>
                      )}
                      <td>
                        <button onClick={() => remove(e.scheme_code, name)} title="Remove from the team's blacklist"
                                style={{ color: 'var(--text-low)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

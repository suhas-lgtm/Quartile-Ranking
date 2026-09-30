// src/components/PdfSections.tsx — choose what goes into a page's PDF.
//
// A page wraps itself in <PdfProvider>, each table or block in <PdfSection>, and
// shows a <PdfButton>. The button lists every section on the page (in page
// order) and the column groups (returns, SIP returns, ratios, AUM) with
// checkboxes. "Choose rows & columns" then puts a tick on every row and every
// column heading of every table: click one to leave it out (☐). "Download PDF"
// prints only what is ticked, in the light theme, on landscape A4 — the
// browser's print dialog saves it as a PDF. Choices are remembered per page.
//
// Rows and columns are remembered by their text (the row's first cell, the
// column's heading) within their section and table, so a choice survives
// re-renders and reloads, and a new fund added later is included by default.
// A column heading marked data-pdf-off starts left out; ticking it puts it in.

/** Is this column heading left out? `off` has the ones switched off; a heading that
 *  starts off (data-pdf-off) is out unless it was switched on ("on|" + key). */
const headOff = (th: Element, key: string, off: Set<string>) =>
  th.hasAttribute('data-pdf-off') ? !off.has(`on|${key}`) : off.has(key)

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { SharedLink } from '../utils/shareReport'

export const COL_GROUPS = [
  { id: 'ret', label: 'Returns (1M–10Y)' },
  { id: 'sip', label: 'SIP returns' },
  { id: 'ratio', label: 'Ratios (Sharpe, Std Dev, Alpha, Beta, captures, drawdown)' },
  { id: 'aum', label: 'AUM' },
] as const

interface Ctx {
  register: (id: string, label: string) => void
  unregister: (id: string) => void
  off: Set<string>
}
/** What the printed report is: its cover page and the footer on every page. */
export interface PdfDoc {
  /** Small line above the title, e.g. "PORTFOLIO REVIEW". */
  kicker: string
  /** The report's name, e.g. "Portfolio Reallocation Proposal". */
  title: string
  client?: string
  advisor?: { name: string; mobile: string }
  /** Headline numbers on the cover. */
  stats?: { label: string; value: string }[]
}

export const ARMSTRONG_ADDRESS = 'Corporate block, Golden Enclave Apartment, 5th Floor, A1 Tower, HAL Old Airport Rd, Bengaluru, Karnataka 560017'

interface ListState {
  doc?: PdfDoc
  sections: Map<string, string>
  off: Set<string>
  setOff: (s: Set<string>) => void
  picking: boolean
  setPicking: (b: boolean) => void
  /** The Download dialog is open (kept here so the rows & columns bar can go back to it). */
  dialog: boolean
  setDialog: (b: boolean) => void
  pageKey: string
  box: React.RefObject<HTMLDivElement | null>
}
const PdfCtx = createContext<Ctx | null>(null)
const ListCtx = createContext<ListState | null>(null)

function loadOff(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`pdf_off:${key}`) ?? '[]')) } catch { return new Set() }
}

const clean = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[☑☐]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)

/** Where a table cell belongs: its section, the table's position in the section. */
function place(el: Element) {
  const sec = el.closest<HTMLElement>('[data-pdf]')
  const table = el.closest('table')
  if (!sec || !table) return null
  const ti = [...sec.querySelectorAll('table')].indexOf(table)
  return { sec: sec.dataset.pdf!, ti, table }
}

/** Mark the rows and columns switched off, so the screen dims them and print drops them. */
function applyMarks(root: HTMLElement, off: Set<string>) {
  root.querySelectorAll<HTMLElement>('[data-pdf]').forEach(sec => {
    const id = sec.dataset.pdf!
    sec.querySelectorAll('table').forEach((table, ti) => {
      const head = table.tHead?.rows[table.tHead.rows.length - 1]
      const offCols = new Set<number>()
      if (head) [...head.cells].forEach((th, ci) => {
        const isOff = headOff(th, `c|${id}|${ti}|${clean(th)}`, off)
        if (isOff) offCols.add(ci)
        th.classList.toggle('pdf-cell-off', isOff)
      })
      for (const tb of [...table.tBodies]) for (const tr of [...tb.rows]) {
        const rowOff = off.has(`r|${id}|${ti}|${clean(tr.cells[0])}`)
        if (tr.classList.contains('pdf-row-off') !== rowOff) tr.classList.toggle('pdf-row-off', rowOff)
        // Column cells: only rows with one cell per heading line up with the headings.
        if (head && tr.cells.length === head.cells.length) [...tr.cells].forEach((td, ci) => {
          const c = offCols.has(ci)
          if (td.classList.contains('pdf-cell-off') !== c) td.classList.toggle('pdf-cell-off', c)
        })
      }
    })
  })
}

export function PdfProvider({ pageKey, doc, children }: { pageKey: string; doc?: PdfDoc; children: React.ReactNode }) {
  const [sections, setSections] = useState<Map<string, string>>(new Map())
  const [off, setOff] = useState<Set<string>>(() => loadOff(pageKey))
  const [picking, setPicking] = useState(false)
  const [dialog, setDialog] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { try { localStorage.setItem(`pdf_off:${pageKey}`, JSON.stringify([...off])) } catch { /* optional */ } }, [off, pageKey])
  const register = useCallback((id: string, label: string) => setSections(m => (m.get(id) === label ? m : new Map(m).set(id, label))), [])
  const unregister = useCallback((id: string) => setSections(m => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n }), [])
  const ctx = useMemo(() => ({ register, unregister, off }), [register, unregister, off])

  // Keep the marks on as the tables re-render (data loading, edits): re-apply after any DOM change.
  useEffect(() => {
    const root = box.current
    if (!root) return
    let raf = 0
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => applyMarks(root, off)) }
    run()
    const mo = new MutationObserver(run)
    mo.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [off])

  // While picking, a click on a row or a column heading switches it in or out.
  useEffect(() => {
    const root = box.current
    if (!root || !picking) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element
      const th = t.closest('thead th')
      const tr = th ? null : t.closest('tbody tr')
      const cell = th ?? (tr as HTMLTableRowElement | null)?.cells[0]
      const p = cell ? place(cell) : null
      if (!p || !cell) return
      e.preventDefault(); e.stopPropagation()
      let key = th ? `c|${p.sec}|${p.ti}|${clean(th)}` : `r|${p.sec}|${p.ti}|${clean(cell)}`
      if (key.endsWith('|')) return        // blank heading / row: nothing to name it by
      if (th?.hasAttribute('data-pdf-off')) key = `on|${key}`     // starts off: the tick is what is stored
      setOff(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
    }
    root.addEventListener('click', onClick, true)
    return () => root.removeEventListener('click', onClick, true)
  }, [picking])

  // Column groups switched off are hidden in print through a class on this wrapper.
  const colClasses = COL_GROUPS.filter(g => off.has(`col:${g.id}`)).map(g => `pdf-hide-${g.id}`).join(' ')
  const cellsOff = [...off].filter(k => k.startsWith('r|') || k.startsWith('c|'))
  return (
    <PdfCtx.Provider value={ctx}>
      <ListCtx.Provider value={{ doc, sections, off, setOff, picking, setPicking, dialog, setDialog, pageKey, box }}>
        <div ref={box} className={`pdf-doc ${colClasses} ${picking ? 'pdf-picking' : ''}`}>
          {doc && <PdfCover doc={doc} />}
          {children}
        </div>
        {picking && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] card px-4 py-3 flex items-center gap-3 flex-wrap text-xs print:hidden"
               style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.45)', border: '1px solid var(--accent-a)', maxWidth: 'calc(100vw - 32px)' }}>
            <span style={{ color: 'var(--text-hi)' }}>
              <b>Choosing rows &amp; columns for the PDF.</b> Click a row or a column heading to leave it out (☐); click again to put it back.
            </span>
            <span style={{ color: 'var(--text-mid)' }}>
              {cellsOff.filter(k => k.startsWith('r|')).length} rows · {cellsOff.filter(k => k.startsWith('c|')).length} columns left out
            </span>
            {cellsOff.length > 0 && (
              <button className="tab-btn" onClick={() => setOff(new Set([...off].filter(k => !k.startsWith('r|') && !k.startsWith('c|'))))}>Reset</button>
            )}
            <button className="tab-btn" onClick={() => { setPicking(false); setDialog(true) }}>⬇ Download / Share…</button>
            <button className="tab-btn active" onClick={() => setPicking(false)}>Done</button>
          </div>
        )}
      </ListCtx.Provider>
    </PdfCtx.Provider>
  )
}

/** One choosable block of the PDF. Outside a PdfProvider it simply renders its children. */
export function PdfSection({ id, label, kicker, title, page, children }: {
  id: string; label: string
  /** Start a new page here. Without it the section follows the previous one on the same page. */
  page?: boolean
  /** Printed above the section, like a slide: a small kicker line and a big title (default: the label). */
  kicker?: string; title?: string
  children: React.ReactNode
}) {
  const ctx = useContext(PdfCtx)
  useEffect(() => {
    ctx?.register(id, label)
    return () => ctx?.unregister(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, label])
  return (
    <div data-pdf={id} className={[ctx?.off.has(id) ? 'pdf-off' : '', page ? 'pdf-newpage' : ''].filter(Boolean).join(' ') || undefined}>
      <div className={`pdf-slide-head ${page ? '' : 'sub'}`} aria-hidden>
        {kicker && <div className="pdf-kicker">{kicker}</div>}
        <div className="pdf-title">{title ?? label}</div>
      </div>
      {children}
    </div>
  )
}

/** The first page of the printed report. Hidden on screen. */
function PdfCover({ doc }: { doc: PdfDoc }) {
  const month = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  return (
    <div className="pdf-cover" aria-hidden>
      <div className="pdf-cover-top">
        <div>
          <div className="pdf-kicker">{doc.kicker}</div>
          <div className="pdf-cover-title">{doc.title}</div>
          {doc.client && <div className="pdf-cover-client">Prepared for <b>{doc.client}</b></div>}
          <div className="pdf-cover-date">{month}</div>
        </div>
      </div>
      {doc.stats && doc.stats.length > 0 && (
        <div className="pdf-cover-stats">
          {doc.stats.map(s => (
            <div key={s.label} className="pdf-cover-stat">
              <div className="l">{s.label}</div>
              <div className="v">{s.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="pdf-cover-foot">
        <div>
          <div className="pdf-kicker">Armstrong Capital</div>
          <div className="pdf-cover-addr">{ARMSTRONG_ADDRESS}</div>
        </div>
        {doc.advisor && (
          <div className="pdf-cover-advisor">
            <div className="pdf-kicker">Your advisor</div>
            <div className="n">{doc.advisor.name}</div>
            <div className="m">{doc.advisor.mobile}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The corner logo as a data URL: page margin boxes print an image only when it is already in hand. */
let logoData: string | null = null
fetch('/logo-pdf.png').then(r => r.blob()).then(b => new Promise<string>(res => {
  const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b)
})).then(d => { logoData = d }).catch(() => { /* no logo in the corner */ })

/** Print the page with the light theme, then put the viewer's theme back. */
// No links in a PDF: Chrome turns every <a href> into a clickable link in the saved
// file, so the links are taken off while printing (Download PDF or Ctrl+P) and put back after.
const unlinked: [HTMLAnchorElement, string][] = []
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
      unlinked.push([a, a.getAttribute('href')!]); a.removeAttribute('href')
    })
  })
  window.addEventListener('afterprint', () => {
    for (const [a, href] of unlinked.splice(0)) a.setAttribute('href', href)
  })
}

function printLight(doc?: PdfDoc) {
  const root = document.documentElement
  const before = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  root.classList.add('pdf-printing')
  // The footer text lives in @page margin boxes, which only take fixed strings: write it for this report.
  const foot = document.createElement('style')
  const q = (t: string) => JSON.stringify(t)
  foot.textContent = `@media print { @page {
    @bottom-left { content: ${q(['Armstrong Capital', doc?.title, doc?.client].filter(Boolean).join('  ·  '))}; }
    ${logoData ? `@top-right { content: url(${logoData}); vertical-align: middle; }` : ''}
  } }`
  document.head.appendChild(foot)
  const restore = () => {
    if (before == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', before)
    root.classList.remove('pdf-printing')
    foot.remove()
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  // Let the theme repaint before the print dialog snapshots the page.
  setTimeout(() => window.print(), 150)
}

type Out = { pdf: boolean; link: boolean }
function loadOut(key: string): Out {
  try { const o = JSON.parse(localStorage.getItem(`pdf_out:${key}`) ?? 'null'); if (o && (o.pdf || o.link)) return { pdf: !!o.pdf, link: !!o.link } } catch { /* default */ }
  return { pdf: true, link: false }
}
const shortDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function PdfButton({ title }: { title?: string }) {
  const list = useContext(ListCtx)
  const [out, setOut] = useState<Out>(() => loadOut(list?.pageKey ?? ''))
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ url: string; token: string; expires: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [links, setLinks] = useState<SharedLink[] | null>(null)
  const [copied, setCopied] = useState(false)
  const open = list?.dialog ?? false
  const pageKey = list?.pageKey ?? ''
  const setOpen = (b: boolean) => { list?.setDialog(b); if (!b) { setMade(null); setErr(null); setCopied(false) } }
  useEffect(() => { try { if (pageKey) localStorage.setItem(`pdf_out:${pageKey}`, JSON.stringify(out)) } catch { /* optional */ } }, [out, pageKey])
  const loadLinks = useCallback(() => {
    if (!pageKey) return
    import('../utils/shareReport').then(m => m.listLinks(pageKey)).then(setLinks).catch(() => setLinks([]))
  }, [pageKey])
  useEffect(() => { if (open) loadLinks() }, [open, loadLinks])
  if (!list) return null
  // Page order, not registration order.
  const order = open ? [...document.querySelectorAll<HTMLElement>('[data-pdf]')].map(e => e.dataset.pdf!) : []
  const ids = [...new Set(order)].filter(id => list.sections.has(id))
  const toggle = (k: string) => { const n = new Set(list.off); if (n.has(k)) n.delete(k); else n.add(k); list.setOff(n) }
  const setAll = (on: boolean) => {
    const n = new Set(list.off)
    for (const id of ids) { if (on) n.delete(id); else n.add(id) }
    list.setOff(n)
  }
  const chosen = ids.filter(id => !list.off.has(id)).length
  const rowsOff = [...list.off].filter(k => k.startsWith('r|')).length
  const colsOff = [...list.off].filter(k => k.startsWith('c|')).length
  const label = out.pdf && out.link ? '⬇ Download PDF + 🔗 create link' : out.link ? '🔗 Create link' : '⬇ Download PDF'

  const go = async () => {
    setErr(null)
    if (out.link) {
      if (!list.box.current) return
      setBusy(true)
      try {
        const m = await import('../utils/shareReport')
        const html = await m.buildReportHtml(list.box.current, list.doc, logoData)
        const r = await m.shareReport(pageKey, html, list.doc?.title ?? title ?? '', list.doc?.client ?? '')
        setMade(r)
        loadLinks()
      } catch (e) {
        setErr(`The link could not be created (${e instanceof Error ? e.message : 'error'}).`)
        setBusy(false)
        return
      }
      setBusy(false)
    }
    if (out.pdf) {
      if (!out.link) setOpen(false)
      printLight(list.doc)
    }
  }
  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => undefined)
  }
  const turnOff = async (token: string) => {
    if (!window.confirm('Turn this link off? Anyone who opens it will see that it has expired.')) return
    const m = await import('../utils/shareReport')
    await m.revokeLink(token)
    if (made?.token === token) setMade(null)
    loadLinks()
  }
  const active = (links ?? []).filter(l => !l.revoked && new Date(l.expires_at) > new Date())

  return (
    <>
      <button className="tab-btn" onClick={() => setOpen(true)} title="Choose the tables, rows and columns, then download a PDF and/or create a web link">⬇ Download / Share</button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden" style={{ background: 'rgba(0,0,0,0.55)' }}
             onClick={() => setOpen(false)}>
          <div className="card p-5 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="font-display font-bold text-base mb-1" style={{ color: 'var(--text-hi)' }}>Download / Share{title ? ` — ${title}` : ''}</div>
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-mid)' }}>
              Tick what goes in. The same choices make the PDF and the web link.
            </p>

            <div className="card p-3 mb-4" style={{ background: 'var(--bg-raised)' }}>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>Make</div>
              <label className="flex items-start gap-2 text-xs cursor-pointer mb-1" style={{ color: 'var(--text-hi)' }}>
                <input type="checkbox" className="mt-0.5" checked={out.pdf} onChange={() => setOut(o => ({ ...o, pdf: !o.pdf }))} />
                <span><b>PDF</b> <span style={{ color: 'var(--text-mid)' }}>— in the print window choose <b>Save as PDF</b></span></span>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-hi)' }}>
                <input type="checkbox" className="mt-0.5" checked={out.link} onChange={() => setOut(o => ({ ...o, link: !o.link }))} />
                <span><b>Web link</b> <span style={{ color: 'var(--text-mid)' }}>— a page the client opens on phone or laptop without the
                  password; only this report, as it is now. Works for 90 days and can be turned off any time.</span></span>
              </label>
            </div>

            {made && (
              <div className="card p-3 mb-4" style={{ border: '1px solid #34D399' }}>
                <div className="text-xs font-semibold mb-1" style={{ color: '#34D399' }}>Link ready — send it to the client</div>
                <div className="flex gap-2 items-center">
                  <input readOnly value={made.url} onFocus={e => e.currentTarget.select()} className="flex-1 px-2 py-1 rounded text-xs"
                         style={{ background: 'var(--bg-base)', border: '1px solid var(--line)', color: 'var(--text-hi)' }} />
                  <button className="tab-btn" onClick={() => copy(made.url)}>{copied ? '✓ Copied' : 'Copy'}</button>
                  <a className="tab-btn" href={made.url} target="_blank" rel="noreferrer">Open</a>
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-mid)' }}>
                  Works until {shortDate(made.expires)}. It shows the report as it is now; after changes, create a new link.
                </div>
              </div>
            )}
            {err && <div className="text-xs mb-3" style={{ color: '#F87171' }}>{err}</div>}

            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="font-semibold" style={{ color: 'var(--text-hi)' }}>Tables &amp; sections</span>
              <span style={{ color: 'var(--text-low)' }}>{chosen} of {ids.length}</span>
              <button className="tab-btn ml-auto" onClick={() => setAll(true)}>All</button>
              <button className="tab-btn" onClick={() => setAll(false)}>None</button>
            </div>
            <div className="grid gap-1 mb-4">
              {ids.map(id => (
                <label key={id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-hi)' }}>
                  <input type="checkbox" checked={!list.off.has(id)} onChange={() => toggle(id)} /> {list.sections.get(id)}
                </label>
              ))}
            </div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-hi)' }}>Columns in the fund tables</div>
            <div className="grid gap-1 mb-4">
              {COL_GROUPS.map(g => (
                <label key={g.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-hi)' }}>
                  <input type="checkbox" checked={!list.off.has(`col:${g.id}`)} onChange={() => toggle(`col:${g.id}`)} /> {g.label}
                </label>
              ))}
            </div>
            <div className="card p-3 mb-4" style={{ background: 'var(--bg-raised)' }}>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-hi)' }}>Rows &amp; columns inside the tables</div>
              <div className="text-[11px] mb-2" style={{ color: 'var(--text-mid)' }}>
                Leave out single funds, stocks or measures: every row and column heading gets a ☑ — click to untick.
                {(rowsOff || colsOff) ? ` Now left out: ${rowsOff} rows, ${colsOff} columns.` : ''}
              </div>
              <button className="tab-btn" onClick={() => { setOpen(false); list.setPicking(true) }}>☑ Choose rows &amp; columns…</button>
            </div>

            {active.length > 0 && (
              <details className="mb-4">
                <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-hi)' }}>
                  Links shared from this page ({active.length} working)
                </summary>
                <div className="mt-2 grid gap-1">
                  {active.map(l => (
                    <div key={l.token} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-mid)' }}>
                      <span className="flex-1 truncate" style={{ color: 'var(--text-hi)' }}>{l.client || l.title || 'Report'}</span>
                      <span>{shortDate(l.created_at)} → {shortDate(l.expires_at)}</span>
                      <button className="tab-btn" onClick={() => copy(`${location.origin}/r/${l.token}`)}>Copy</button>
                      <button className="tab-btn" onClick={() => turnOff(l.token)}>Turn off</button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex justify-end gap-2">
              <button className="tab-btn" onClick={() => setOpen(false)}>{made ? 'Close' : 'Cancel'}</button>
              <button className="tab-btn active" disabled={!chosen || (!out.pdf && !out.link) || busy} onClick={go}>
                {busy ? 'Creating the link…' : label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

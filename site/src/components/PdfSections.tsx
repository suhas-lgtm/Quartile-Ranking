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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

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
interface ListState {
  sections: Map<string, string>
  off: Set<string>
  setOff: (s: Set<string>) => void
  picking: boolean
  setPicking: (b: boolean) => void
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
        const isOff = off.has(`c|${id}|${ti}|${clean(th)}`)
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

export function PdfProvider({ pageKey, children }: { pageKey: string; children: React.ReactNode }) {
  const [sections, setSections] = useState<Map<string, string>>(new Map())
  const [off, setOff] = useState<Set<string>>(() => loadOff(pageKey))
  const [picking, setPicking] = useState(false)
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
      const key = th ? `c|${p.sec}|${p.ti}|${clean(th)}` : `r|${p.sec}|${p.ti}|${clean(cell)}`
      if (key.endsWith('|')) return        // blank heading / row: nothing to name it by
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
      <ListCtx.Provider value={{ sections, off, setOff, picking, setPicking }}>
        <div ref={box} className={`${colClasses} ${picking ? 'pdf-picking' : ''}`}>{children}</div>
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
            <button className="tab-btn" onClick={() => { setPicking(false); printLight() }}>⬇ Download PDF</button>
            <button className="tab-btn active" onClick={() => setPicking(false)}>Done</button>
          </div>
        )}
      </ListCtx.Provider>
    </PdfCtx.Provider>
  )
}

/** One choosable block of the PDF. Outside a PdfProvider it simply renders its children. */
export function PdfSection({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const ctx = useContext(PdfCtx)
  useEffect(() => {
    ctx?.register(id, label)
    return () => ctx?.unregister(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, label])
  return <div data-pdf={id} className={ctx?.off.has(id) ? 'pdf-off' : undefined}>{children}</div>
}

/** Print the page with the light theme, then put the viewer's theme back. */
function printLight() {
  const root = document.documentElement
  const before = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  root.classList.add('pdf-printing')
  const restore = () => {
    if (before == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', before)
    root.classList.remove('pdf-printing')
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  // Let the theme repaint before the print dialog snapshots the page.
  setTimeout(() => window.print(), 150)
}

export function PdfButton({ title }: { title?: string }) {
  const list = useContext(ListCtx)
  const [open, setOpen] = useState(false)
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
  return (
    <>
      <button className="tab-btn" onClick={() => setOpen(true)} title="Choose the tables, rows and columns, then download as PDF">⬇ Download PDF</button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden" style={{ background: 'rgba(0,0,0,0.55)' }}
             onClick={() => setOpen(false)}>
          <div className="card p-5 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="font-display font-bold text-base mb-1" style={{ color: 'var(--text-hi)' }}>Download PDF{title ? ` — ${title}` : ''}</div>
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-mid)' }}>
              Tick what goes into the PDF. In the print window choose <b>Save as PDF</b> as the printer.
            </p>
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
            <div className="flex justify-end gap-2">
              <button className="tab-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="tab-btn active" disabled={!chosen}
                      onClick={() => { setOpen(false); printLight() }}>⬇ Download PDF</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// src/components/PdfSections.tsx — choose what goes into a page's PDF.
//
// A page wraps itself in <PdfProvider>, each table or block in <PdfSection>, and
// shows a <PdfButton>. The button lists every section on the page (in page
// order) and the column groups (returns, SIP returns, ratios, AUM) with
// checkboxes; "Download PDF" prints only what is ticked, in the light theme, on
// landscape A4 — the browser's print dialog saves it as a PDF. The choice is
// remembered per page in this browser.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

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
const PdfCtx = createContext<Ctx | null>(null)
const ListCtx = createContext<{ sections: Map<string, string>; off: Set<string>; setOff: (s: Set<string>) => void; pageKey: string } | null>(null)

function loadOff(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(`pdf_off:${key}`) ?? '[]')) } catch { return new Set() }
}

export function PdfProvider({ pageKey, children }: { pageKey: string; children: React.ReactNode }) {
  const [sections, setSections] = useState<Map<string, string>>(new Map())
  const [off, setOff] = useState<Set<string>>(() => loadOff(pageKey))
  useEffect(() => { try { localStorage.setItem(`pdf_off:${pageKey}`, JSON.stringify([...off])) } catch { /* optional */ } }, [off, pageKey])
  const register = useCallback((id: string, label: string) => setSections(m => (m.get(id) === label ? m : new Map(m).set(id, label))), [])
  const unregister = useCallback((id: string) => setSections(m => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n }), [])
  const ctx = useMemo(() => ({ register, unregister, off }), [register, unregister, off])
  // Column groups switched off are hidden in print through a class on this wrapper.
  const colClasses = COL_GROUPS.filter(g => off.has(`col:${g.id}`)).map(g => `pdf-hide-${g.id}`).join(' ')
  return (
    <PdfCtx.Provider value={ctx}>
      <ListCtx.Provider value={{ sections, off, setOff, pageKey }}>
        <div className={colClasses}>{children}</div>
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
  return (
    <>
      <button className="tab-btn" onClick={() => setOpen(true)} title="Choose the tables, then download as PDF">⬇ Download PDF</button>
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

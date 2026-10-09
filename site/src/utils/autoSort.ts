// src/utils/autoSort.ts — click any column heading, in any table, to sort by it.
//
// One switch for the whole dashboard, so every table sorts without each one
// carrying its own code: a click on a heading sorts the rows high → low (▼), a
// second low → high (▲), a third puts the original order back. Values are read
// from the cells as shown: ₹ amounts (₹5.00 L, ₹1.2 Cr, 12.3k), percentages,
// numbers, dates, else text. Blanks (—) always sink to the bottom.
//
// Rows that are not data stay where they are: totals, category average,
// benchmark and portfolio rows (and any row styled as .benchmark-row), and
// full-width group headings — rows sort within the group under each heading.
//
// Left alone: tables that already sort themselves (their headings set a pointer
// cursor — Risk & Returns, Fund Screener, AUM, Dividends…), tables marked
// data-nosort, and the PDF's row/column picking mode, which uses the same clicks.
//
// The rows are React's, moved in place. React only ever adds, removes or
// updates rows inside the same table body, which still works with the rows in
// another order; after any such change the sort is simply applied again.

type Dir = 'desc' | 'asc'
const state = new Map<HTMLTableElement, { col: number; dir: Dir }>()
const firstOrder = new WeakMap<HTMLTableRowElement, number>()

const PINNED = /^(total|totals|grand total|category average|category avg|benchmark|portfolio|average|sum)\b/i
const UNIT: Record<string, number> = { cr: 1e7, l: 1e5, lakh: 1e5, k: 1e3 }

/** A table that should get click-to-sort. */
function eligible(t: HTMLTableElement): boolean {
  if (!t.tHead || !t.tBodies.length || t.hasAttribute('data-nosort')) return false
  const head = t.tHead.rows[t.tHead.rows.length - 1]
  if (!head || head.cells.length < 2) return false
  // Sorts itself already: its headings are made clickable by the page.
  for (const th of t.tHead.querySelectorAll<HTMLElement>('th')) if (th.style.cursor === 'pointer') return false
  return true
}

/** Visual column (counting colspans) of each cell in a row. */
function columns(row: HTMLTableRowElement) {
  const out: { cell: HTMLTableCellElement; from: number; span: number }[] = []
  let at = 0
  for (const cell of row.cells) { out.push({ cell, from: at, span: cell.colSpan || 1 }); at += cell.colSpan || 1 }
  return { cells: out, width: at }
}

/** The first line of a cell's text — or, for a cell you type into, what is typed there. */
function textOf(c: HTMLTableCellElement | undefined): string {
  if (!c) return ''
  const box = c.querySelector<HTMLInputElement | HTMLSelectElement>('input:not([type=checkbox]):not([type=radio]), select')
  if (box) return box instanceof HTMLSelectElement ? box.selectedOptions[0]?.text ?? '' : box.value
  return (c.innerText ?? c.textContent ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
}

const NUM = /^([+\-−]?)\s*(?:₹|rs\.?|inr)?\s*([+\-−]?)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|cr|crore|l|lakh|k|x|pts?|days?|d|yrs?|y|months?|m)?\.?$/i

/** What a cell holds: a number, a date, text, or nothing. */
export function valueOf(text: string): { kind: 'blank' } | { kind: 'num' | 'date'; v: number } | { kind: 'text'; v: string } {
  const t = text.replace(/[▲▼↑↓▴▾]/g, '').trim()
  if (!t || /^[—–\-…·]+$/.test(t) || /^(n\/?a|nil|none|pending)$/i.test(t)) return { kind: 'blank' }
  const m = NUM.exec(t.replace(/\s+/g, ' '))
  if (m) {
    const neg = m[1] === '-' || m[1] === '−' || m[2] === '-' || m[2] === '−'
    let v = parseFloat(m[3].replace(/,/g, ''))
    const u = (m[4] ?? '').toLowerCase()
    v *= UNIT[u === 'crore' ? 'cr' : u] ?? 1
    return { kind: 'num', v: neg ? -v : v }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2} [A-Za-z]{3,5}\.? \d{4}$/.test(t) || /^[A-Za-z]{3,5} \d{4}$/.test(t)) {
    const d = Date.parse(t.replace(/Sept/i, 'Sep'))
    if (!Number.isNaN(d)) return { kind: 'date', v: d }
  }
  return { kind: 'text', v: t.toLowerCase() }
}

/** Put a table's rows in the order its sort (or the original order) asks for. */
function apply(t: HTMLTableElement) {
  const s = state.get(t)
  const head = t.tHead!.rows[t.tHead!.rows.length - 1]
  const total = columns(head).width
  for (const body of t.tBodies) {
    const rows = [...body.rows]
    rows.forEach((r, i) => { if (!firstOrder.has(r)) firstOrder.set(r, 1e6 + i) })
    // Split into groups at full-width heading rows; inside a group, data rows move, pinned rows stay.
    const out: HTMLTableRowElement[] = []
    let group: HTMLTableRowElement[] = []
    const flush = () => {
      const movable = group.filter(r => !pinned(r))
      const sorted = s ? sortRows(movable, s.col, s.dir) : [...movable].sort((a, b) => firstOrder.get(a)! - firstOrder.get(b)!)
      let k = 0
      for (const r of group) out.push(pinned(r) ? r : sorted[k++])
      group = []
    }
    for (const r of rows) {
      const c = columns(r)
      const isData = c.width === total && c.cells.every(x => x.span === 1)
      if (isData) group.push(r)
      else { flush(); out.push(r) }
    }
    flush()
    if (out.some((r, i) => rows[i] !== r)) for (const r of out) body.appendChild(r)
  }
  for (const th of head.cells) th.removeAttribute('data-sort-dir')
  if (s) {
    const target = columns(head).cells.find(x => x.from === s.col)?.cell
    target?.setAttribute('data-sort-dir', s.dir)
  }
}

function pinned(r: HTMLTableRowElement) {
  return r.classList.contains('benchmark-row') || PINNED.test(textOf(r.cells[0]))
}

function sortRows(rows: HTMLTableRowElement[], col: number, dir: Dir) {
  const val = (r: HTMLTableRowElement) => valueOf(textOf(columns(r).cells.find(x => x.from === col)?.cell))
  const vals = new Map(rows.map(r => [r, val(r)]))
  // A column is numeric when most of its filled cells are numbers (or dates).
  const filled = [...vals.values()].filter(v => v.kind !== 'blank')
  const numeric = filled.filter(v => v.kind === 'num' || v.kind === 'date').length >= filled.length / 2
  return [...rows].sort((a, b) => {
    const va = vals.get(a)!, vb = vals.get(b)!
    const ba = va.kind === 'blank' || (numeric && va.kind === 'text'), bb = vb.kind === 'blank' || (numeric && vb.kind === 'text')
    if (ba || bb) return ba && bb ? firstOrder.get(a)! - firstOrder.get(b)! : ba ? 1 : -1
    let d: number
    if (numeric) d = (va as { v: number }).v - (vb as { v: number }).v
    else d = String((va as { v: string | number }).v).localeCompare(String((vb as { v: string | number }).v), 'en', { numeric: true })
    if (d === 0) return firstOrder.get(a)! - firstOrder.get(b)!
    // Text reads A → Z first; numbers high → low first.
    return (numeric ? dir === 'desc' : dir === 'asc') ? -d : d
  })
}

/** Mark the headings of sortable tables (pointer cursor, a hint), once each. */
function mark(root: ParentNode) {
  for (const t of root.querySelectorAll<HTMLTableElement>('table')) {
    if (!eligible(t)) continue
    const head = t.tHead!.rows[t.tHead!.rows.length - 1]
    for (const th of head.cells) {
      if (th.hasAttribute('data-autosort') || !textOf(th)) continue
      th.setAttribute('data-autosort', '')
      if (!th.title) th.title = 'Click to sort'
    }
  }
}

let installed = false
export function installAutoSort() {
  if (installed || typeof document === 'undefined') return
  installed = true

  document.addEventListener('click', e => {
    const target = e.target as Element | null
    const th = target?.closest('th')
    if (!th || target!.closest('button, input, select, a, label')) return
    const t = th.closest('table') as HTMLTableElement | null
    if (!t || !t.tHead?.contains(th) || th.closest('.pdf-picking') || !eligible(t)) return
    const head = t.tHead.rows[t.tHead.rows.length - 1]
    if (th.parentElement !== head || !textOf(th as HTMLTableCellElement)) return
    const col = columns(head).cells.find(x => x.cell === th)!.from
    const s = state.get(t)
    // high → low, low → high, then back to the original order
    if (!s || s.col !== col) state.set(t, { col, dir: 'desc' })
    else if (s.dir === 'desc') state.set(t, { col, dir: 'asc' })
    else state.delete(t)
    apply(t)
  })

  // Keep sorted tables sorted as their rows change, and mark new tables.
  let raf = 0
  const run = () => {
    raf = 0
    mark(document)
    for (const t of [...state.keys()]) {
      if (!t.isConnected || !eligible(t)) { state.delete(t); continue }
      apply(t)
    }
  }
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run) })
    .observe(document.body, { childList: true, subtree: true, characterData: true })
  run()
}

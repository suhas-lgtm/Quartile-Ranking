// src/utils/shareReport.ts — the web-link twin of the PDF (server/reports.ts).
//
// The report is taken exactly as the PDF would print it: the same sections,
// rows and columns ticked in the Download dialog, the same light Armstrong
// look (the page's own print styles are applied on screen). Charts drawn on a
// canvas become pictures, inputs become their values, links and buttons go.
// What remains is one self-contained HTML file with no scripts: the server
// stores it and serves it at /r/<token>, readable on a phone or a laptop.
// Pictures made of SVG (the portfolio orbits, the SIP months) keep their
// animation and their hover labels, since those need no script.

import type { PdfDoc } from '../components/PdfSections'
import { ARMSTRONG_ADDRESS } from '../components/PdfSections'

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Every style rule on the page, with the print-only ones switched on. */
function pageCss(): string {
  const out: string[] = []
  const walk = (rules: CSSRuleList) => {
    for (const r of [...rules]) {
      if (r instanceof CSSMediaRule) {
        const m = r.media.mediaText
        if (/\bprint\b/.test(m) && !/\bscreen\b/.test(m)) walk(r.cssRules)     // the PDF look, on screen
        else out.push(r.cssText)
      } else if (!(r instanceof CSSPageRule)) out.push(r.cssText)
    }
  }
  for (const sh of [...document.styleSheets]) {
    try { walk(sh.cssRules) } catch { /* a stylesheet from another site (fonts): linked below instead */ }
  }
  return out.join('\n')
}

/** Adjustments for reading on a screen rather than an A2 page. */
const SHARE_CSS = `
html, body { background: #E6E7EB !important; margin: 0; }
body { font-family: 'Barlow', 'Inter', system-ui, sans-serif; }
.share-wrap { max-width: 1500px; margin: 0 auto; padding: 0 24px 40px; }
.share-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; border-bottom: 2px solid #C9CBD6; margin-bottom: 24px; }
.share-bar img { height: 44px; width: auto; }
.share-bar .t { font: 600 15px 'Barlow', sans-serif; color: #262D6B; text-align: right; }
.share-foot { border-top: 2px solid #C9CBD6; margin-top: 30px; padding-top: 14px; font: 400 13px/1.5 'Barlow', sans-serif; color: #3A3F55; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.pdf-doc { zoom: 1 !important; }
.pdf-cover { height: auto !important; min-height: 0 !important; gap: 28px; margin-bottom: 36px; padding-bottom: 28px; border-bottom: 2px solid #C9CBD6; }
[data-pdf].pdf-newpage { margin-top: 40px; }
.pdf-doc details { display: block !important; }
.pdf-doc details summary { cursor: pointer; }
.pdf-doc .table-scroll { overflow-x: auto !important; }
/* Charts (pictures now) shrink to the screen: their boxes kept the laptop's pixel width. */
.pdf-doc .echarts-for-react, .pdf-doc .echarts-for-react div { width: 100% !important; height: auto !important; }
.pdf-doc img { max-width: 100% !important; height: auto !important; }
/* Touch a planet or a pill for its details; the numbered list is for the PDF only. */
.orbit-legend { display: none !important; }
.orbit-tip { display: none !important; }
/* The print styles stop the orbits; on the web link they turn again. */
.orbit-turn { animation: orbit-spin var(--dur, 90s) linear infinite !important; }
.orbit-upright { animation: orbit-spin var(--dur, 90s) linear infinite reverse !important; }
.orbit-svg:hover .orbit-turn, .orbit-svg:hover .orbit-upright { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) { .orbit-turn, .orbit-upright { animation: none !important; } }
@media (max-width: 900px) {
  .share-wrap { padding: 0 12px 30px; }
  .share-bar img { height: 32px; }
  .pdf-cover-title { font-size: 40px !important; }
  .pdf-cover-client { font-size: 20px !important; }
  .pdf-cover-stats { grid-template-columns: repeat(2, 1fr) !important; }
  .pdf-cover-stat .v { font-size: 26px !important; }
  .pdf-cover-foot { flex-direction: column; align-items: flex-start !important; }
  .pdf-cover-advisor { text-align: left !important; }
  .pdf-title { font-size: 26px !important; }
  .pdf-doc .grid { grid-template-columns: minmax(0, 1fr) !important; }
  .pdf-doc .grid.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .pdf-doc .data-table, .pdf-doc .data-table td, .pdf-doc .data-table th, .pdf-doc .text-xs { font-size: 12px !important; }
  .pdf-doc .data-table th:first-child, .pdf-doc .data-table td:first-child { min-width: 150px; }
}
`

/**
 * The report as one HTML file. `box` is the page's PdfProvider element. The page is
 * switched to the light theme for a moment (as for printing) so the charts are
 * drawn in their printed colours, then put back.
 */
export async function buildReportHtml(box: HTMLElement, doc: PdfDoc | undefined, logo: string | null): Promise<string> {
  const root = document.documentElement
  const before = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  root.classList.add('pdf-printing')
  try {
    await new Promise(r => setTimeout(r, 450))            // let the charts redraw in the light theme
    await new Promise(r => requestAnimationFrame(() => r(null)))

    const clone = box.cloneNode(true) as HTMLElement
    const live = [...box.querySelectorAll('*')], copy = [...clone.querySelectorAll('*')]
    live.forEach((el, i) => {
      const c = copy[i]
      if (el instanceof HTMLCanvasElement) {
        let src = ''
        try { src = el.toDataURL('image/png') } catch { /* tainted: left out */ }
        const img = document.createElement('img')
        if (src) img.src = src
        img.style.width = `${el.clientWidth || el.width}px`
        img.style.maxWidth = '100%'
        img.style.height = 'auto'
        c.replaceWith(img)
      } else if (el instanceof HTMLInputElement) {
        c.setAttribute('value', el.value)
      } else if (el instanceof HTMLSelectElement) {
        const cs = c as HTMLSelectElement
        ;[...cs.options].forEach((o, j) => { if (j === el.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected') })
      }
    })

    // What the PDF leaves out, the link leaves out — removed, not just hidden.
    const hiddenCols = COL_CLASSES.filter(c => box.classList.contains(`pdf-hide-${c}`)).map(c => `.col-${c}`)
    const drop = ['.pdf-off', '.pdf-empty', '.pdf-print-skip', '.pdf-row-off', '.pdf-cell-off', '[class*="print:hidden"]', '.no-print', 'button', 'select',
                  'input[type=checkbox]', 'input[type=file]', 'script', 'noscript', 'iframe', ...hiddenCols]
    clone.querySelectorAll(drop.join(',')).forEach(e => e.remove())
    clone.querySelectorAll('input').forEach(e => { if (!e.getAttribute('value')) e.remove(); else e.setAttribute('readonly', '') })
    // No links and nothing clickable: text stays, the link goes.
    clone.querySelectorAll('a').forEach(a => { const s = document.createElement('span'); s.innerHTML = a.innerHTML; a.replaceWith(s) })
    clone.querySelectorAll('*').forEach(e => {
      // Planets keep tabindex, so a touch shows their details (CSS :focus).
      const tap = e.hasAttribute('data-tap')
      for (const at of [...e.attributes]) if (/^on/i.test(at.name) || (at.name === 'tabindex' && !tap) || at.name === 'contenteditable') e.removeAttribute(at.name)
      if (e.getAttribute('role') === 'button') e.removeAttribute('role')
    })
    clone.classList.remove('pdf-picking')

    const fonts = [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet][href*="fonts.googleapis.com"]')]
      .map(l => `<link rel="stylesheet" href="${esc(l.href)}">`).join('\n')
    const title = [doc?.title ?? 'Report', doc?.client].filter(Boolean).join(' — ')
    const made = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    return `<!doctype html>
<html lang="en" data-theme="light" class="pdf-printing share-page">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Armstrong Capital</title>
${fonts}
<style>${pageCss()}</style>
<style>${SHARE_CSS}</style>
</head>
<body>
<div class="share-wrap">
  <div class="share-bar">
    ${logo ? `<img src="${logo}" alt="Armstrong Capital">` : '<b>Armstrong Capital</b>'}
    <div class="t">${esc(doc?.title ?? '')}${doc?.client ? `<br>${esc(doc.client)}` : ''}</div>
  </div>
  ${clone.outerHTML}
  <div class="share-foot">
    <div><b>Armstrong Capital</b><br>${esc(ARMSTRONG_ADDRESS)}</div>
    <div>${doc?.advisor ? `Your advisor: <b>${esc(doc.advisor.name)}</b> · ${esc(doc.advisor.mobile)}<br>` : ''}Prepared ${esc(made)}.
      Mutual fund investments are subject to market risks; read all scheme-related documents carefully. Past performance does not guarantee future returns.</div>
  </div>
</div>
</body>
</html>`
  } finally {
    if (before == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', before)
    root.classList.remove('pdf-printing')
  }
}

const COL_CLASSES = ['ret', 'sip', 'ratio', 'aum']

/** Save the report and get its link. */
export async function shareReport(page: string, html: string, title: string, client: string) {
  const r = await fetch('/api/reports', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, title, client, html }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
  return { url: `${location.origin}/r/${d.token}`, token: d.token as string, expires: d.expires_at as string }
}

export interface SharedLink { token: string; title: string; client: string; created_at: string; expires_at: string; revoked: boolean }

export async function listLinks(page: string): Promise<SharedLink[]> {
  const r = await fetch(`/api/reports?page=${encodeURIComponent(page)}`, { credentials: 'same-origin' })
  if (!r.ok) return []
  return (await r.json()).links ?? []
}

export async function revokeLink(token: string) {
  await fetch(`/api/reports?token=${encodeURIComponent(token)}`, { method: 'DELETE', credentials: 'same-origin' })
}

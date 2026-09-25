// src/utils/portfolioReport.ts — the Portfolio Builder's printable report.
//
// Builds a self-contained, print-styled HTML page (white, A4, inline styles) and
// opens it in a new window with the print dialog, where "Save as PDF" produces
// the PDF. No PDF library: the browser's own printing gives crisp text and
// tables. A demo portfolio is watermarked DEMO on every page.

export interface ReportFund {
  name: string
  category: string
  invested: number
  value: number
  gain: number
  ret: number | null
  irr: number | null
  lines: { label: string; date: string; amount: number; units: number | null; value: number | null }[]
}

export interface ReportInput {
  demo: boolean
  asOf: string
  preparedOn: string
  funds: ReportFund[]
  total: { invested: number; value: number; gain: number; ret: number | null; irr: number | null }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')
const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`)
const col = (v: number | null) => (v == null ? '#6b7280' : v >= 0 ? '#15803d' : '#b91c1c')
const date = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export function openPortfolioReport(r: ReportInput) {
  const byCat = new Map<string, number>()
  for (const f of r.funds) byCat.set(f.category, (byCat.get(f.category) ?? 0) + f.value)
  const alloc = [...byCat.entries()].sort((a, b) => b[1] - a[1])

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${r.demo ? 'DEMO - ' : ''}Portfolio Report - ${esc(date(r.asOf))}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; font-size: 11px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; margin: 18px 0 6px; color: #1e3a8a; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; }
  .muted { color: #6b7280; }
  .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 12px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }
  .card .l { font-size: 9px; color: #6b7280; } .card .v { font-size: 15px; font-weight: bold; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; text-align: left; font-size: 10px; padding: 5px 6px; border-bottom: 1px solid #d1d5db; }
  td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; } .r { text-align: right; }
  .bar { height: 8px; background: #1e3a8a; border-radius: 4px; }
  .banner { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 6px 10px; border-radius: 6px; margin-top: 10px; font-weight: bold; }
  .wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 150px; font-weight: bold;
        color: rgba(220, 38, 38, 0.10); transform: rotate(-28deg); pointer-events: none; z-index: 0; }
  .disc { margin-top: 18px; font-size: 9px; color: #6b7280; line-height: 1.5; }
  tr { page-break-inside: avoid; }
</style></head><body>
${r.demo ? '<div class="wm">DEMO</div>' : ''}
<div class="head">
  <div><h1>Portfolio Report</h1><div class="muted">Value as of ${esc(date(r.asOf))} · prepared ${esc(date(r.preparedOn))}</div></div>
  <img src="${location.origin}/logo.jpg" alt="Armstrong Capital" style="height:38px">
</div>
${r.demo ? '<div class="banner">DEMO PORTFOLIO — for illustration only. Not a recommendation or an actual client holding.</div>' : ''}
<div class="cards">
  <div class="card"><div class="l">Invested</div><div class="v">${inr(r.total.invested)}</div></div>
  <div class="card"><div class="l">Current value</div><div class="v">${inr(r.total.value)}</div></div>
  <div class="card"><div class="l">Gain</div><div class="v" style="color:${col(r.total.gain)}">${inr(r.total.gain)}</div></div>
  <div class="card"><div class="l">Absolute return</div><div class="v" style="color:${col(r.total.ret)}">${pct(r.total.ret)}</div></div>
  <div class="card"><div class="l">XIRR (annualised)</div><div class="v" style="color:${col(r.total.irr)}">${pct(r.total.irr)}</div></div>
</div>

<h2>Holdings</h2>
<table><tr><th>Fund</th><th>Category</th><th class="r">Invested</th><th class="r">Value</th><th class="r">Gain</th>
<th class="r">Return</th><th class="r">XIRR</th><th class="r">Weight</th></tr>
${r.funds.map(f => `<tr><td>${esc(f.name)}</td><td class="muted">${esc(f.category)}</td>
<td class="r">${inr(f.invested)}</td><td class="r"><b>${inr(f.value)}</b></td>
<td class="r" style="color:${col(f.gain)}">${inr(f.gain)}</td><td class="r" style="color:${col(f.ret)}">${pct(f.ret)}</td>
<td class="r" style="color:${col(f.irr)}">${pct(f.irr)}</td>
<td class="r">${r.total.value ? ((f.value / r.total.value) * 100).toFixed(1) : '0'}%</td></tr>`).join('')}
<tr><td colspan="2"><b>Total</b></td><td class="r"><b>${inr(r.total.invested)}</b></td><td class="r"><b>${inr(r.total.value)}</b></td>
<td class="r" style="color:${col(r.total.gain)}"><b>${inr(r.total.gain)}</b></td><td class="r" style="color:${col(r.total.ret)}"><b>${pct(r.total.ret)}</b></td>
<td class="r" style="color:${col(r.total.irr)}"><b>${pct(r.total.irr)}</b></td><td class="r"><b>100%</b></td></tr>
</table>

<h2>Allocation by category</h2>
<table>${alloc.map(([c, v]) => {
    const w = r.total.value ? v / r.total.value : 0
    return `<tr><td style="width:30%">${esc(c)}</td><td><div class="bar" style="width:${(w * 100).toFixed(1)}%"></div></td>
<td class="r" style="width:12%">${(w * 100).toFixed(1)}%</td><td class="r" style="width:16%">${inr(v)}</td></tr>`
  }).join('')}</table>

<h2>Investments</h2>
<table><tr><th>Fund</th><th>Investment</th><th>Date</th><th class="r">Amount</th><th class="r">Units</th><th class="r">Value today</th></tr>
${r.funds.map(f => f.lines.map((l, i) => `<tr><td>${i === 0 ? esc(f.name) : ''}</td><td>${esc(l.label)}</td><td>${esc(l.date)}</td>
<td class="r">${inr(l.amount)}</td><td class="r">${l.units == null ? '—' : l.units.toFixed(3)}</td>
<td class="r">${l.value == null ? '—' : inr(l.value)}</td></tr>`).join('')).join('')}
</table>

<div class="disc">
  Values use each fund's NAV on or before the investment date and on the valuation date, adjusted for unit splits; no exit load,
  stamp duty or tax is deducted. XIRR is the annualised return allowing for the timing of each investment. Past performance
  does not guarantee future returns. Mutual fund investments are subject to market risks; read all scheme-related documents
  carefully. ${r.demo ? '<b>This is a demo portfolio for illustration only.</b>' : ''} Prepared by Armstrong Capital — for internal research use.
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300)</script>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups for this site to open the report.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

// src/utils/holdingsUpload.ts — read a client's mutual fund holdings from an
// Excel / CSV export (MFBOX or a similar statement) and match each line to a
// fund in our list.
//
// Exports differ in layout, so nothing is assumed about row or column
// positions: the header row is found by its words (scheme / fund name, current
// or market value, invested / cost, units, folio), total rows are skipped, and
// the same fund held in several folios or plans is added up. Names are matched
// fuzzily after dropping plan/option words, so "HDFC Flexi Cap Fund - Direct
// Plan - IDCW" lands on HDFC Flexi Cap Fund; weak matches are flagged for a
// person to confirm.

import { fuzzyFilter, fuzzyScore, prepare } from './fuzzy'
import type { FundsIndex } from '../types'

type IndexFund = FundsIndex['funds'][number]

export interface UploadedRow {
  /** Scheme name as written in the file. */
  raw: string
  folio: string | null
  units: number | null
  invested: number | null
  value: number
  /** Monthly SIP running in this holding, when the file has a SIP column. */
  sip?: number | null
  /** Our fund, or null when nothing looked close enough. */
  code: string | null
  /** false = the match needs checking by a person. */
  sure: boolean
  /** Left out of the portfolio by the user. */
  skip?: boolean
}

const NAME_RE = /scheme|fund\s*name|^fund$|security|instrument|particulars|description|^name$/i
const VALUE_RE = /(current|market|present|curr\.?|mkt\.?|latest)\s*(value|val|valuation|amount)|valuation|^value$|value\s*\(/i
const INV_RE = /invest|cost|purchase\s*(value|amount)|amount\s*paid|principal/i
const UNITS_RE = /^(balance\s*)?units|units$|^unit\s*balance|no\.?\s*of\s*units/i
const FOLIO_RE = /folio/i
// The monthly SIP amount goes by many names in statements: "SIP", "SIP Amt", "SIP Amount",
// "Monthly SIP", "Instalment Amount", "Installment", "Systematic Investment", "Monthly Investment".
const SIP_RE = /\bsip\b|systematic|instal+ment|monthly\s*(investment|amount|contribution)/i
// …but not the SIP's dates, count, frequency, status or type.
const SIP_NOT = /date|start|end|freq|count|status|type|\bday\b|tenure|units|no\.?$|reg(istration)?|mode|folio|scheme/i
const isSipCol = (c: string) => SIP_RE.test(c) && !SIP_NOT.test(c)
const TOTAL_RE = /^(grand\s*)?total\b|sub\s*-?\s*total|^total\s*:/i

/** "₹ 1,23,456.78", "(1,200)", "12.5 %" → number; null when there is no number. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const s = String(v).replace(/[₹,\s]|rs\.?|inr/gi, '')
  if (!s) return null
  const neg = /^\(.*\)$/.test(s)
  const n = parseFloat(s.replace(/[()%]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

/** Plan / option words that are not part of the fund's name. */
const NOISE = /\b(direct|regular|plan|growth|option|idcw|dividend|div|payout|pay\s*out|re-?invest(ment)?|reinv|sweep|transfer|bonus|monthly|quarterly|half\s*yearly|annual|daily|weekly|fortnightly|dir|reg|gr|g|formerly|known|as)\b/gi

export function cleanSchemeName(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')          // "(formerly …)", "(G)", "(IDCW)"
    .replace(/\s-\s.*$/, m => m.replace(NOISE, ' '))
    .replace(NOISE, ' ')
    .replace(/[-–_/.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Former names still printed on statements → today's name (SEBI recategorisation, later renames). */
const RENAMES: [RegExp, string][] = [
  [/\bblue\s*chip( equity)?\b/i, 'large cap'],
  [/\bfront\s*line equity\b/i, 'large cap'],
  [/\bemerging equity\b/i, 'mid cap'],
  [/\bmid\s*cap opportunities\b/i, 'mid cap'],
  [/\bsmall\s*cap opportunities\b/i, 'small cap'],
  [/\btax saver\b/i, 'elss tax saver'],
  [/\bequity opportunities\b/i, 'large and mid cap'],
]

/** The fund a scheme name most likely is, and whether the match is trusted. */
export function matchFund(funds: IndexFund[], name: string): { code: string | null; sure: boolean } {
  const cleaned = cleanSchemeName(name)
  let renamed = cleaned
  for (const [re, to] of RENAMES) renamed = renamed.replace(re, to)
  // Candidates from the name as written and as renamed, each shortened a word at a
  // time if nothing matches; then the one whose own name is best covered by the
  // client's wins — "ICICI Prudential Bluechip" is Large Cap, not US Bluechip Equity.
  let best: { code: string; fwd: number; back: number; dropped: number } | null = null
  for (const base of [...new Set([cleaned, renamed])]) {
    const theirs = prepare(base)
    let words = base.split(' ')
    for (let dropped = 0; words.length >= 2; dropped++, words = words.slice(0, -1)) {
      const q = words.join(' ')
      const hits = fuzzyFilter(funds, q, f => f.n, 6)
      if (!hits.length) continue
      for (const h of hits) {
        const fwd = fuzzyScore(q, prepare(h.n))
        const back = fuzzyScore(cleanSchemeName(h.n), theirs)
        const s = fwd + back - dropped * 0.2
        if (!best || s > best.fwd + best.back - best.dropped * 0.2) best = { code: h.c, fwd, back, dropped }
      }
      break
    }
  }
  if (!best) return { code: null, sure: false }
  return { code: best.code, sure: best.dropped === 0 && best.fwd >= 0.9 && best.back >= 0.85 }
}

/** Find the header row and the columns we need. */
function locate(rows: unknown[][], sipColumn?: string | null) {
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    // A table under a "SIP Summary" title is the SIP list, not the holdings.
    if (rows.slice(Math.max(0, i - 3), i).some(r => (r ?? []).some(c => SIP_TITLE.test(String(c ?? ''))))) continue
    const cells = rows[i].map(c => String(c ?? '').trim())
    const name = cells.findIndex(c => NAME_RE.test(c) && !FOLIO_RE.test(c))
    if (name < 0) continue
    // Never take a SIP amount column for the holding's value.
    let value = cells.findIndex(c => VALUE_RE.test(c) && !INV_RE.test(c) && !isSipCol(c))
    if (value < 0) value = cells.findIndex(c => /value|amount/i.test(c) && !INV_RE.test(c) && !/nav/i.test(c) && !isSipCol(c))
    if (value < 0) continue
    return {
      header: i, name, value,
      invested: cells.findIndex(c => INV_RE.test(c)),
      units: cells.findIndex(c => UNITS_RE.test(c)),
      folio: cells.findIndex(c => FOLIO_RE.test(c)),
      // A SIP column picked by the user wins over the guess.
      sip: sipColumn && cells.includes(sipColumn) ? cells.indexOf(sipColumn) : cells.findIndex(isSipCol),
      headers: cells,
    }
  }
  return null
}

const cellsOf = (r: unknown[]) => (r ?? []).map(c => String(c ?? '').trim())
const filled = (r: unknown[]) => cellsOf(r).filter(Boolean)
/** A titled section ("SIP Summary", "Transaction Details"…): one or two text cells and no numbers. */
function isSectionTitle(r: unknown[]) {
  const f = filled(r)
  return f.length > 0 && f.length <= 2 && f.every(c => num(c) == null) &&
    /summary|details|statement|transactions?|register|\bsip\b|systematic|redemption|dividend|switch|stp|swp|report/i.test(f.join(' '))
}
/** A second header row (a new table starts). */
const isHeaderRow = (r: unknown[]) => cellsOf(r).some(c => /^(scheme|fund)\s*name$|^scheme$|^fund$/i.test(c))
const SIP_TITLE = /\bsip\b.*(summary|details|register|book|list)|systematic\s+investment|sip\s*summary/i
const CEASED = /ceas|cancel|stop|terminat|inactive|closed|expir|paused|revok/i

/**
 * The "SIP Summary" table of a statement: a title row saying so, a header row
 * under it (scheme name, SIP amount / installment, folio, status…), then one
 * row per SIP until the next section. SIPs marked ceased / cancelled / stopped
 * are left out.
 */
function sipSummary(rows: unknown[][]) {
  const found: { raw: string; folio: string | null; amount: number }[] = []
  let header: string | null = null
  for (let t = 0; t < rows.length; t++) {
    if (!filled(rows[t]).some(c => SIP_TITLE.test(c)) || filled(rows[t]).length > 3) continue
    for (let i = t + 1; i < Math.min(rows.length, t + 7); i++) {
      const cells = cellsOf(rows[i])
      const name = cells.findIndex(c => NAME_RE.test(c) && !FOLIO_RE.test(c))
      if (name < 0) continue
      let amt = cells.findIndex(isSipCol)
      if (amt < 0) amt = cells.findIndex(c => /amount|amt|instal/i.test(c) && !/date|units/i.test(c))
      if (amt < 0) break
      const folio = cells.findIndex(c => FOLIO_RE.test(c))
      const status = cells.findIndex(c => /status/i.test(c))
      header = cells[amt]
      for (const r of rows.slice(i + 1)) {
        if (isSectionTitle(r) || isHeaderRow(r)) break
        const raw = String(r[name] ?? '').replace(/\s+/g, ' ').trim()
        const amount = num(r[amt])
        if (!raw || TOTAL_RE.test(raw) || amount == null || amount <= 0 || num(raw) != null) continue
        if (status >= 0 && CEASED.test(String(r[status] ?? ''))) continue
        found.push({ raw, folio: folio >= 0 ? (String(r[folio] ?? '').trim() || null) : null, amount })
      }
      break
    }
  }
  return found.length ? { header: header ?? 'Amount', rows: found } : null
}

/** A sheet listing SIPs (scheme name and SIP amount), when the statement keeps them apart from holdings. */
function sipSheet(rows: unknown[][], sheetName: string) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(c => String(c ?? '').trim())
    const name = cells.findIndex(c => NAME_RE.test(c) && !FOLIO_RE.test(c))
    if (name < 0) continue
    // On a sheet named for SIPs a plain "Amount" column is the SIP amount.
    let amt = cells.findIndex(isSipCol)
    if (amt < 0 && /sip|systematic|instal/i.test(sheetName)) amt = cells.findIndex(c => /amount|amt/i.test(c) && !/date/i.test(c))
    if (amt < 0) continue
    const folio = cells.findIndex(c => FOLIO_RE.test(c))
    const out: { raw: string; folio: string | null; amount: number }[] = []
    for (const r of rows.slice(i + 1)) {
      const raw = String(r[name] ?? '').replace(/\s+/g, ' ').trim()
      const amount = num(r[amt])
      if (!raw || TOTAL_RE.test(raw) || amount == null || amount <= 0) continue
      out.push({ raw, folio: folio >= 0 ? (String(r[folio] ?? '').trim() || null) : null, amount })
    }
    return { header: cells[amt], rows: out }
  }
  return null
}

export interface UploadInfo {
  sheet: string
  /** Which column each value was read from; null = not in the file. */
  columns: { name: string; value: string; invested: string | null; units: string | null; folio: string | null; sip: string | null }
  /** Every column heading of the holdings sheet, so the SIP column can be picked by hand. */
  headers: string[]
  /** The files read. */
  files: string[]
  /** Running SIPs in funds the client does not hold yet (from the SIP Summary). */
  extraSips?: { code: string | null; raw: string; amount: number }[]
}

/** Read the file (xlsx / xls / csv) into holdings rows matched to our funds. */
export async function readHoldingsFile(file: File, funds: IndexFund[], sipColumn?: string | null) {
  return readHoldingsFiles([file], funds, sipColumn)
}

/**
 * Read one or more files (a statement, or a folder with holdings and SIPs in
 * separate files). The sheet with the most holdings rows is the portfolio; the
 * SIP amounts come from its SIP column, the column the user picked, or a
 * sheet / file that lists the SIPs.
 */
export async function readHoldingsFiles(files: File[], funds: IndexFund[], sipColumn?: string | null): Promise<{ rows: UploadedRow[]; sheet: string; info: UploadInfo }> {
  const XLSX = await import('xlsx')
  const grids: { sheet: string; grid: unknown[][] }[] = []
  for (const file of files.filter(f => /\.(xlsx|xls|xlsm|csv)$/i.test(f.name))) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    for (const sheet of wb.SheetNames) {
      grids.push({
        // With several files the sheet is named with its file, so "SIP report.xlsx › Sheet1" still reads as a SIP list.
        sheet: files.length > 1 ? `${file.name} › ${sheet}` : sheet,
        grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, blankrows: false }),
      })
    }
  }
  if (!grids.length) throw new Error('No Excel or CSV file found. Upload .xlsx, .xls or .csv files.')
  // The sheet with the most holdings rows wins (statements often have a summary sheet first).
  let best: { rows: UploadedRow[]; sheet: string; info: UploadInfo | null } = { rows: [], sheet: grids[0].sheet, info: null }
  for (const { sheet, grid } of grids) {
    const at = locate(grid, sipColumn)
    if (!at) continue
    const out: UploadedRow[] = []
    for (const r of grid.slice(at.header + 1)) {
      // The holdings table ends where the next section (SIP Summary, transactions…) or table begins.
      if (isSectionTitle(r) || isHeaderRow(r)) break
      const raw = String(r[at.name] ?? '').replace(/\s+/g, ' ').trim()
      const value = num(r[at.value])
      if (!raw || TOTAL_RE.test(raw) || value == null || value <= 0) continue
      // A line whose "name" is a number is a stray total, not a fund.
      if (num(raw) != null) continue
      const m = matchFund(funds, raw)
      out.push({
        raw, value, ...m,
        invested: at.invested >= 0 ? num(r[at.invested]) : null,
        units: at.units >= 0 ? num(r[at.units]) : null,
        folio: at.folio >= 0 ? (String(r[at.folio] ?? '').trim() || null) : null,
        sip: at.sip >= 0 ? num(r[at.sip]) : null,
      })
    }
    const h = (k: number) => (k >= 0 ? at.headers[k] || null : null)
    if (out.length > best.rows.length) best = {
      rows: out, sheet,
      info: {
        sheet, columns: { name: at.headers[at.name], value: at.headers[at.value], invested: h(at.invested), units: h(at.units), folio: h(at.folio), sip: h(at.sip) },
        headers: at.headers.filter(Boolean), files: files.map(f => f.name),
      },
    }
  }
  if (!best.rows.length || !best.info) {
    throw new Error('No holdings found. The file needs a header row with the scheme name and its current / market value.')
  }

  // Bring SIP amounts across onto the holdings, matched by fund + folio where both give a folio,
  // else by fund. Several SIPs in one fund add up. Returns how many SIPs found no holding.
  const applySips = (list: { raw: string; folio: string | null; amount: number }[]) => {
    const byKey = new Map<string, number>()
    for (const r of list) {
      const code = matchFund(funds, r.raw).code ?? r.raw
      for (const k of [`${code}|${r.folio ?? ''}`, `${code}|`]) byKey.set(k, (byKey.get(k) ?? 0) + r.amount)
    }
    const used = new Set<string>()
    for (const row of best.rows) row.sip = null
    for (const row of best.rows) {
      const code = row.code ?? row.raw
      const k = row.folio && byKey.has(`${code}|${row.folio}`) ? `${code}|${row.folio}` : `${code}|`
      if (!byKey.has(k) || used.has(k)) continue
      row.sip = byKey.get(k)!
      used.add(k)
      if (k.endsWith('|') === false) used.add(`${code}|`)
    }
    const extra = list.filter(r => {
      const code = matchFund(funds, r.raw).code ?? r.raw
      return !best.rows.some(x => (x.code ?? x.raw) === code)
    })
    best.info!.extraSips = extra.map(r => ({ code: matchFund(funds, r.raw).code, raw: r.raw, amount: r.amount }))
    return extra.length
  }

  // 1. A "SIP Summary" table anywhere in the upload — the statement's own list of running SIPs — unless the
  //    user picked a column by hand.
  const summaries = sipColumn ? [] : grids.map(g => ({ sheet: g.sheet, t: sipSummary(g.grid) })).filter(x => x.t)
  if (summaries.length) {
    const all = summaries.flatMap(x => x.t!.rows)
    const missed = applySips(all)
    best.info.columns.sip = `"${summaries[0].t!.header}" in the SIP Summary table (${summaries.map(x => x.sheet).join(', ')}) — ${all.length} SIP${all.length === 1 ? '' : 's'}`
      + (missed ? `, ${missed} in funds not in the holdings` : '')
  } else if (!best.rows.some(r => r.sip)) {
    // 2. No SIP column beside the holdings: a sheet or file that lists the SIPs.
    for (const { sheet, grid } of grids) {
      if (sheet === best.sheet) continue
      const ss = sipSheet(grid, sheet)
      if (!ss || !ss.rows.length) continue
      applySips(ss.rows)
      best.info.columns.sip = `${ss.header} (sheet "${sheet}")`
      break
    }
  }
  return { rows: best.rows, sheet: best.sheet, info: best.info }
}

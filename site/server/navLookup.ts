// server/navLookup.ts — NAVs on any date, for Point to Point and Portfolio Builder.
//
//   GET /api/nav?codes=103174,118989&dates=2024-01-01,2026-09-25
//
// For each fund: its first and latest NAV, the NAV on or before each requested
// date (NEAREST-PREVIOUS within 10 days, the engine's rule; null when the fund
// had not launched or has a gap), and its unit splits so the page can keep
// returns right across one (nav_splits, written by the nightly build).
// Read-only and public. Shared by netlify/functions/auth.mts and Vite.
import { neon } from '@neondatabase/serverless'

const MAX_CODES = 300
const MAX_DATES = 200            // a 10-year monthly SIP is 120 dates
const SEARCH_WINDOW_DAYS = 10     // engine.calculation_engine.SEARCH_WINDOW

type Result = { status: number; body: string }
const json = (status: number, obj: unknown): Result => ({ status, body: JSON.stringify(obj) })

export async function handleNav(query: URLSearchParams, databaseUrl?: string): Promise<Result> {
  if (!databaseUrl) return json(503, { error: 'database is not configured' })
  const codes = [...new Set((query.get('codes') ?? '').split(',').map(s => s.trim()).filter(s => /^\d{3,9}$/.test(s)))]
  const dates = [...new Set((query.get('dates') ?? '').split(',').map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))]
  if (!codes.length) return json(400, { error: 'no funds given' })
  if (codes.length > MAX_CODES || dates.length > MAX_DATES) return json(400, { error: 'too many funds or dates' })
  const ids = codes.map(Number)
  const sql = neon(databaseUrl)

  const [latest, first, at, splits] = await Promise.all([
    sql.query(`SELECT DISTINCT ON (scheme_code) scheme_code, nav_date::text AS d, nav
               FROM nav_history WHERE scheme_code = ANY($1::int[])
               ORDER BY scheme_code, nav_date DESC`, [ids]),
    sql.query(`SELECT scheme_code, MIN(nav_date)::text AS d FROM nav_history
               WHERE scheme_code = ANY($1::int[]) GROUP BY scheme_code`, [ids]),
    dates.length
      ? sql.query(`SELECT c.code AS scheme_code, d.dt::text AS want, n.nav_date::text AS d, n.nav
                   FROM unnest($1::int[]) AS c(code)
                   CROSS JOIN unnest($2::date[]) AS d(dt)
                   LEFT JOIN LATERAL (
                     SELECT nav_date, nav FROM nav_history h
                     WHERE h.scheme_code = c.code AND h.nav_date <= d.dt
                     ORDER BY h.nav_date DESC LIMIT 1) n ON true`, [ids, dates])
      : Promise.resolve([]),
    sql.query(`SELECT scheme_code, split_date::text AS d, factor FROM nav_splits
               WHERE scheme_code = ANY($1::int[]) ORDER BY split_date`, [ids])
      .catch(() => []),                         // table not created yet
  ]) as [any[], any[], any[], any[]]

  const funds: Record<string, {
    first_date: string | null
    latest: { date: string; nav: number } | null
    at: Record<string, { date: string; nav: number } | null>
    splits: { date: string; factor: number }[]
  }> = {}
  for (const c of codes) funds[c] = { first_date: null, latest: null, at: {}, splits: [] }
  for (const r of first) funds[String(r.scheme_code)].first_date = r.d
  for (const r of latest) funds[String(r.scheme_code)].latest = { date: r.d, nav: Number(r.nav) }
  for (const r of splits) funds[String(r.scheme_code)].splits.push({ date: r.d, factor: Number(r.factor) })
  for (const r of at) {
    const f = funds[String(r.scheme_code)]
    const ok = r.d && f.first_date && r.d >= f.first_date &&
      (Date.parse(r.want) - Date.parse(r.d)) / 86_400_000 <= SEARCH_WINDOW_DAYS
    f.at[r.want] = ok ? { date: r.d, nav: Number(r.nav) } : null
  }
  return json(200, { funds })
}

/**
 *   GET /api/series?code=103174&from=2021-01-01
 * One fund's daily NAVs from `from` (all history when absent) plus its unit
 * splits, for the fund page and Compare. Raw NAVs; the page adjusts for splits.
 */
export async function handleSeries(query: URLSearchParams, databaseUrl?: string): Promise<Result> {
  if (!databaseUrl) return json(503, { error: 'database is not configured' })
  const code = (query.get('code') ?? '').trim()
  const from = (query.get('from') ?? '').trim()
  if (!/^\d{3,9}$/.test(code)) return json(400, { error: 'bad fund code' })
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return json(400, { error: 'bad date' })
  const sql = neon(databaseUrl)
  const [rows, splits] = await Promise.all([
    sql.query(`SELECT nav_date::text AS d, nav FROM nav_history
               WHERE scheme_code = $1 AND nav_date >= $2::date ORDER BY nav_date`,
              [Number(code), from || '1990-01-01']),
    sql.query(`SELECT split_date::text AS d, factor FROM nav_splits WHERE scheme_code = $1 ORDER BY split_date`,
              [Number(code)]).catch(() => []),
  ]) as [any[], any[]]
  return json(200, {
    code,
    points: rows.map(r => [r.d, Number(r.nav)]),
    splits: splits.map(r => ({ date: r.d, factor: Number(r.factor) })),
  })
}

/**
 *   GET /api/holdings?code=122640
 * The fund's latest stored portfolio (scripts/portfolios.py): month and equity
 * holdings by weight. Empty when its AMC's disclosures are not loaded yet.
 */
export async function handleHoldings(query: URLSearchParams, databaseUrl?: string): Promise<Result> {
  if (!databaseUrl) return json(503, { error: 'database is not configured' })
  const code = (query.get('code') ?? '').trim()
  if (!/^\d{3,9}$/.test(code)) return json(400, { error: 'bad fund code' })
  const sql = neon(databaseUrl)
  const rows = await sql.query(
    `SELECT to_char(h.month, 'YYYY-MM') AS month, h.isin, h.name, h.industry, h.pct
     FROM portfolio_holdings h
     WHERE h.scheme_code = $1
       AND h.month = (SELECT MAX(month) FROM portfolio_holdings WHERE scheme_code = $1)
     ORDER BY h.pct DESC`, [Number(code)]).catch(() => []) as any[]
  return json(200, {
    code,
    month: rows[0]?.month ?? null,
    holdings: rows.map(r => ({ isin: r.isin, name: r.name, industry: r.industry, pct: Number(r.pct) })),
  })
}

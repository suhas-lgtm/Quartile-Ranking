// server/reports.ts — client reports shared as a web link (the HTML twin of the PDF).
//
//   POST   /api/reports  {page, title, client, html}   save a snapshot → {token, expires_at}
//   GET    /api/reports?page=P                          this page's links, newest first
//   DELETE /api/reports?token=T                          turn a link off
//   GET    /r/<token>                                    the report itself — public
//
// The /api calls sit behind the dashboard password like every other; only
// /r/<token> is open, so a client can read the one report sent to them and
// nothing else. The token is 24 random characters (144 bits), so links cannot
// be guessed; each expires after LINK_DAYS and can be turned off earlier. The
// page is a finished snapshot built in the browser (text, tables, pictures):
// it is served with scripts switched off entirely, and kept out of search engines.
import { neon } from '@neondatabase/serverless'

const SCHEMA = `CREATE TABLE IF NOT EXISTS shared_reports (
  token       text PRIMARY KEY,
  page        text NOT NULL,
  title       text,
  client      text,
  html        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked     boolean NOT NULL DEFAULT false
)`
export const LINK_DAYS = 90
const MAX_BYTES = 12_000_000
const PAGES = new Set(['rahul-plan', 'rahul-realloc', 'pcompare', 'fund-screener'])
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/

type Result = { status: number; body: string; headers?: Record<string, string> }
const json = (status: number, obj: unknown): Result => ({ status, body: JSON.stringify(obj) })
let schemaReady = false

async function db(databaseUrl: string) {
  const sql = neon(databaseUrl)
  if (!schemaReady) { await sql.query(SCHEMA); schemaReady = true }
  return sql
}

function newToken() {
  const b = new Uint8Array(18)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_')
}

export async function handleReports(params: URLSearchParams, method: string, readBody: () => Promise<string>,
                                    databaseUrl: string | undefined): Promise<Result> {
  if (!databaseUrl) return json(503, { error: 'database is not configured' })
  const sql = await db(databaseUrl)

  if (method === 'POST') {
    const raw = await readBody()
    if (raw.length > MAX_BYTES) return json(413, { error: 'report too large to share' })
    let b: { page?: unknown; title?: unknown; client?: unknown; html?: unknown }
    try { b = JSON.parse(raw || '{}') } catch { return json(400, { error: 'bad request' }) }
    const page = String(b.page ?? ''), html = String(b.html ?? '')
    if (!PAGES.has(page) || !html.startsWith('<!doctype html>')) return json(400, { error: 'page and html are needed' })
    const token = newToken()
    const rows = await sql`INSERT INTO shared_reports (token, page, title, client, html, expires_at)
                           VALUES (${token}, ${page}, ${String(b.title ?? '').slice(0, 200)}, ${String(b.client ?? '').slice(0, 200)},
                                   ${html}, now() + make_interval(days => ${LINK_DAYS}))
                           RETURNING expires_at`
    return json(200, { token, expires_at: rows[0]?.expires_at })
  }
  if (method === 'GET') {
    const page = params.get('page') ?? ''
    if (!PAGES.has(page)) return json(400, { error: 'unknown page' })
    const rows = await sql`SELECT token, title, client, created_at, expires_at, revoked FROM shared_reports
                           WHERE page = ${page} ORDER BY created_at DESC LIMIT 50`
    return json(200, { links: rows })
  }
  if (method === 'DELETE') {
    const token = params.get('token') ?? ''
    if (!TOKEN_RE.test(token)) return json(400, { error: 'bad token' })
    await sql`UPDATE shared_reports SET revoked = true WHERE token = ${token}`
    return json(200, { ok: true })
  }
  return json(405, { error: 'method not allowed' })
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  // A finished snapshot: no scripts at all, pictures inline, fonts from Google.
  'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
    + "font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

const notice = (title: string, text: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#F6F8FC;color:#15172A;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
div{max-width:420px;text-align:center}h1{font-size:20px;color:#262D6B}</style></head>
<body><div><h1>${title}</h1><p>${text}</p><p>Armstrong Capital</p></div></body></html>`

/** GET /r/<token> — public. */
export async function serveReport(token: string, databaseUrl: string | undefined): Promise<Result> {
  if (!TOKEN_RE.test(token) || !databaseUrl) {
    return { status: 404, headers: PAGE_HEADERS, body: notice('Report not found', 'This link is not valid. Please ask your advisor for a new one.') }
  }
  const sql = await db(databaseUrl)
  const rows = await sql`SELECT html, expires_at < now() AS expired, revoked FROM shared_reports WHERE token = ${token}`
  if (!rows.length) return { status: 404, headers: PAGE_HEADERS, body: notice('Report not found', 'This link is not valid. Please ask your advisor for a new one.') }
  if (rows[0].revoked || rows[0].expired) {
    return { status: 410, headers: PAGE_HEADERS, body: notice('This link has expired', 'Please ask your advisor for an up-to-date report.') }
  }
  return { status: 200, headers: PAGE_HEADERS, body: rows[0].html as string }
}

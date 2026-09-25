// server/lists.ts — the team's hand-kept Blacklist, stored in Neon.
//
//   GET    /api/blacklist          the list (public, like the Blacklist tab)
//   POST   /api/blacklist          add or update one fund   (needs a session)
//   DELETE /api/blacklist/<code>   remove one fund          (needs a session)
//
// Writes require the same login as the Whitelist Screener (server/auth.ts).
// The nightly build (build_json.build_blacklist) reads this table too, so a
// flagged fund gets its quartiles, returns and ratios at the next refresh.
// Shared by netlify/functions/auth.mts and the Vite dev server.
import { neon } from '@neondatabase/serverless'
import { readCookie, sessionValid, SESSION_COOKIE } from './auth'

const SCHEMA = `CREATE TABLE IF NOT EXISTS blacklist_manual (
  scheme_code integer PRIMARY KEY,
  reason      text NOT NULL DEFAULT '',
  added_by    text NOT NULL DEFAULT '',
  added_at    timestamptz NOT NULL DEFAULT now()
)`

type Result = { status: number; body: string }
const json = (status: number, obj: unknown): Result => ({ status, body: JSON.stringify(obj) })

let schemaReady = false

export async function handleBlacklist(
  rest: string, method: string, cookieHeader: string | null | undefined,
  readBody: () => Promise<string>, env: { password?: string; databaseUrl?: string },
): Promise<Result> {
  if (!env.databaseUrl) return json(503, { error: 'database is not configured' })
  const sql = neon(env.databaseUrl)
  if (!schemaReady) {
    await sql.query(SCHEMA)
    schemaReady = true
  }

  if (method === 'GET' && rest === '') {
    const rows = await sql`SELECT scheme_code, reason, added_by, added_at
                           FROM blacklist_manual ORDER BY added_at DESC`
    return json(200, { funds: rows.map(r => ({ ...r, scheme_code: String(r.scheme_code) })) })
  }

  // Everything else changes the list: the team password is required.
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (!env.password || !sessionValid(token, env.password, env.databaseUrl)) {
    return json(401, { error: 'login required' })
  }

  if (method === 'POST' && rest === '') {
    let body: { scheme_code?: unknown; reason?: unknown; added_by?: unknown }
    try {
      body = JSON.parse(await readBody() || '{}')
    } catch {
      return json(400, { error: 'bad request' })
    }
    const code = String(body.scheme_code ?? '').trim()
    if (!/^\d{3,9}$/.test(code)) return json(400, { error: 'choose a fund from the list' })
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    const by = String(body.added_by ?? '').trim().slice(0, 60)
    await sql`INSERT INTO blacklist_manual (scheme_code, reason, added_by, added_at)
              VALUES (${Number(code)}, ${reason}, ${by}, now())
              ON CONFLICT (scheme_code) DO UPDATE
              SET reason = EXCLUDED.reason, added_by = EXCLUDED.added_by, added_at = now()`
    return json(200, { ok: true })
  }

  const del = /^\/?(\d{3,9})$/.exec(rest)
  if (method === 'DELETE' && del) {
    await sql`DELETE FROM blacklist_manual WHERE scheme_code = ${Number(del[1])}`
    return json(200, { ok: true })
  }

  return json(404, { error: 'not found' })
}

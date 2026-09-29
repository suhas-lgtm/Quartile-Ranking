// server/clients.ts — saved clients (Client Plan, Portfolio Reallocation,
// Portfolio Comparison), kept in Neon so they open on any computer.
//
//   GET    /api/clients?kind=K               the saved names, newest first
//   GET    /api/clients?kind=K&name=N        one client's saved page
//   PUT    /api/clients   {kind, name, data} save (create or replace)
//   DELETE /api/clients?kind=K&name=N        delete
//
// Behind the dashboard password (server/siteGate.ts runs before every /api
// call), so only the team reaches it; saved clients are shared by the team.
// Shared by the Cloudflare function (functions/_lib/handlers.ts) and the Vite
// dev server.
import { neon } from '@neondatabase/serverless'

const SCHEMA = `CREATE TABLE IF NOT EXISTS saved_clients (
  kind       text NOT NULL,
  name       text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, name)
)`
/** The pages that save clients. */
const KINDS = new Set(['rahul-plan', 'rahul-realloc', 'pcompare'])
const MAX_BYTES = 2_000_000

type Result = { status: number; body: string }
const json = (status: number, obj: unknown): Result => ({ status, body: JSON.stringify(obj) })
let schemaReady = false

export async function handleClients(params: URLSearchParams, method: string, readBody: () => Promise<string>,
                                    databaseUrl: string | undefined): Promise<Result> {
  if (!databaseUrl) return json(503, { error: 'database is not configured' })
  const sql = neon(databaseUrl)
  if (!schemaReady) { await sql.query(SCHEMA); schemaReady = true }

  if (method === 'PUT' || method === 'POST') {
    const raw = await readBody()
    if (raw.length > MAX_BYTES) return json(413, { error: 'too large to save' })
    let body: { kind?: unknown; name?: unknown; data?: unknown }
    try { body = JSON.parse(raw || '{}') } catch { return json(400, { error: 'bad request' }) }
    const kind = String(body.kind ?? ''), name = String(body.name ?? '').trim().slice(0, 120)
    if (!KINDS.has(kind) || !name || body.data == null || typeof body.data !== 'object') return json(400, { error: 'kind, name and data are needed' })
    const rows = await sql`INSERT INTO saved_clients (kind, name, data, updated_at)
                           VALUES (${kind}, ${name}, ${JSON.stringify(body.data)}::jsonb, now())
                           ON CONFLICT (kind, name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
                           RETURNING updated_at`
    return json(200, { ok: true, updated_at: rows[0]?.updated_at })
  }

  const kind = params.get('kind') ?? '', name = (params.get('name') ?? '').trim()
  if (!KINDS.has(kind)) return json(400, { error: 'unknown kind' })

  if (method === 'GET' && !name) {
    const rows = await sql`SELECT name, updated_at FROM saved_clients WHERE kind = ${kind} ORDER BY updated_at DESC`
    return json(200, { clients: rows })
  }
  if (method === 'GET') {
    const rows = await sql`SELECT data, updated_at FROM saved_clients WHERE kind = ${kind} AND name = ${name}`
    return rows.length ? json(200, { data: rows[0].data, updated_at: rows[0].updated_at }) : json(404, { error: 'not found' })
  }
  if (method === 'DELETE' && name) {
    await sql`DELETE FROM saved_clients WHERE kind = ${kind} AND name = ${name}`
    return json(200, { ok: true })
  }
  return json(405, { error: 'method not allowed' })
}

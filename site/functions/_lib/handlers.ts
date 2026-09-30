// functions/_lib/handlers.ts — the site's server routes on Cloudflare Pages.
//
// Same behaviour as netlify/functions/*.mts, on the same shared code in
// server/: /data/* and /live/indices/* read Neon's `files` table; /api/* is the
// Whitelist login, the team Blacklist and the NAV / series / holdings lookups.
//
// Secrets come from the Pages project's environment (DATABASE_URL,
// WHITELIST_PASSWORD), set with `wrangler pages secret put`, never from code.
import { route, readFile } from '../../server/neonFiles'
import { handleAuth, isProtected, readCookie, sessionValid, SESSION_COOKIE } from '../../server/auth'
import { handleBlacklist } from '../../server/lists'
import { handleClients } from '../../server/clients'
import { handleReports } from '../../server/reports'
import { handleHoldings, handleNav, handleSeries } from '../../server/navLookup'

export interface Env {
  DATABASE_URL?: string
  WHITELIST_PASSWORD?: string
}

const NO_STORE = { 'cache-control': 'private, no-store' }
// Data changes once a day (08:00 IST refresh), so browsers and Cloudflare's edge
// may reuse a file for an hour. Every miss is a read from Neon, whose free plan
// allows 5 GB of transfer a month — this keeps repeat visits off it.
const PUBLIC = 'public, max-age=3600'
const EDGE_TTL = 3600

/**
 * Serve a public GET from Cloudflare's edge cache, filling it on a miss. The key
 * is the URL alone (never cookies), so this must only wrap public responses.
 * x-edge-cache: HIT / MISS says which happened.
 */
async function edgeCached(req: Request, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default
  if (!cache || req.method !== 'GET') return make()
  const key = new Request(new URL(req.url).toString(), { method: 'GET' })
  const hit = await cache.match(key).catch(() => undefined)
  if (hit) {
    const r = new Response(hit.body, hit)
    r.headers.set('x-edge-cache', 'HIT')
    return r
  }
  const res = await make()
  if (res.status === 200 && !(res.headers.get('cache-control') ?? '').includes('no-store')) {
    const copy = new Response(res.clone().body, res)
    copy.headers.set('cache-control', `public, max-age=${EDGE_TTL}`)
    await cache.put(key, copy).catch(() => undefined)
  }
  const out = new Response(res.body, res)
  out.headers.set('x-edge-cache', 'MISS')
  return out
}

/** /data/* and /live/indices/* — a published file from Neon. */
export async function serveFile(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) return new Response('DATABASE_URL is not configured', { status: 500 })

  const target = route(new URL(req.url).pathname)
  if (!target) return new Response('Not found', { status: 404 })
  const protectedFile = target.bucket === 'MF Data' && isProtected(target.path)
  if (!protectedFile) return edgeCached(req, () => readPublic(req, databaseUrl, target))

  // Whitelist Screener data needs a login; fails closed without a password set.
  if (protectedFile) {
    const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE)
    if (!env.WHITELIST_PASSWORD || !sessionValid(token, env.WHITELIST_PASSWORD, databaseUrl)) {
      return new Response(JSON.stringify({ error: 'login required' }), {
        status: 401, headers: { 'content-type': 'application/json', ...NO_STORE },
      })
    }
  }

  // Protected (Whitelist Screener) files: after the login check, never cached.
  try {
    const file = await readFile(databaseUrl, target.bucket, target.path)
    if (!file) return new Response('Not found', { status: 404, headers: NO_STORE })
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(file.body), {
      status: 200, headers: { 'content-type': file.contentType, ...NO_STORE },
    })
  } catch (err) {
    console.error('neon read failed', target, err)
    return new Response('Upstream error', { status: 502, headers: NO_STORE })
  }
}

async function readPublic(req: Request, databaseUrl: string, target: { bucket: string; path: string }): Promise<Response> {
  try {
    const file = await readFile(databaseUrl, target.bucket, target.path)
    if (!file) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } })
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(file.body), {
      status: 200, headers: { 'content-type': file.contentType, 'cache-control': PUBLIC },
    })
  } catch (err) {
    console.error('neon read failed', target, err)
    return new Response('Upstream error', { status: 502, headers: NO_STORE })
  }
}

/** /api/* — login, team Blacklist, NAV lookups. */
export async function serveApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const action = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')

  const readers: Record<string, typeof handleNav> = { nav: handleNav, series: handleSeries, holdings: handleHoldings }
  if (readers[action]) {
    return edgeCached(req, async () => {
      const r = await readers[action](url.searchParams, env.DATABASE_URL)
        .catch(err => { console.error('nav', err); return { status: 502, body: '{"error":"database error"}' } })
      return new Response(r.body, { status: r.status, headers: {
        'content-type': 'application/json', 'cache-control': r.status === 200 ? PUBLIC : 'no-store',
      } })
    })
  }

  // Client reports shared as links (creating and managing them needs the dashboard password).
  if (action === 'reports') {
    const r = await handleReports(url.searchParams, req.method, () => req.text(), env.DATABASE_URL)
      .catch(err => { console.error('reports', err); return { status: 502, body: '{"error":"database error"}' } })
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }

  // Saved clients (behind the dashboard password, like every /api call).
  if (action === 'clients') {
    const r = await handleClients(url.searchParams, req.method, () => req.text(), env.DATABASE_URL)
      .catch(err => { console.error('clients', err); return { status: 502, body: '{"error":"database error"}' } })
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }

  const out: { status: number; body: string; setCookie?: string } =
    action === 'blacklist' || action.startsWith('blacklist/')
    ? await handleBlacklist(action.slice('blacklist'.length), req.method, req.headers.get('cookie'),
                            () => req.text(), { password: env.WHITELIST_PASSWORD, databaseUrl: env.DATABASE_URL })
        .catch(err => { console.error('blacklist', err); return { status: 502, body: '{"error":"database error"}' } })
    : await handleAuth(action, req.method, req.headers.get('cookie'), () => req.text(),
                       { password: env.WHITELIST_PASSWORD, salt: env.DATABASE_URL }, true)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' }
  if (out.setCookie) headers['set-cookie'] = out.setCookie
  return new Response(out.body, { status: out.status, headers })
}

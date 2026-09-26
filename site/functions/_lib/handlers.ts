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
import { handleHoldings, handleNav, handleSeries } from '../../server/navLookup'

export interface Env {
  DATABASE_URL?: string
  WHITELIST_PASSWORD?: string
}

const NO_STORE = { 'cache-control': 'private, no-store' }
const PUBLIC = 'public, max-age=300'

/** /data/* and /live/indices/* — a published file from Neon. */
export async function serveFile(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) return new Response('DATABASE_URL is not configured', { status: 500 })

  const target = route(new URL(req.url).pathname)
  if (!target) return new Response('Not found', { status: 404 })
  const protectedFile = target.bucket === 'MF Data' && isProtected(target.path)

  // Whitelist Screener data needs a login; fails closed without a password set.
  if (protectedFile) {
    const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE)
    if (!env.WHITELIST_PASSWORD || !sessionValid(token, env.WHITELIST_PASSWORD, databaseUrl)) {
      return new Response(JSON.stringify({ error: 'login required' }), {
        status: 401, headers: { 'content-type': 'application/json', ...NO_STORE },
      })
    }
  }

  try {
    const file = await readFile(databaseUrl, target.bucket, target.path)
    if (!file) return new Response('Not found', { status: 404, headers: protectedFile ? NO_STORE : { 'cache-control': PUBLIC } })
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(file.body), {
      status: 200,
      headers: {
        'content-type': file.contentType,
        ...(protectedFile ? NO_STORE : { 'cache-control': file.cacheControl ?? PUBLIC }),
      },
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
    const r = await readers[action](url.searchParams, env.DATABASE_URL)
      .catch(err => { console.error('nav', err); return { status: 502, body: '{"error":"database error"}' } })
    return new Response(r.body, { status: r.status, headers: {
      'content-type': 'application/json', 'cache-control': r.status === 200 ? PUBLIC : 'no-store',
    } })
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

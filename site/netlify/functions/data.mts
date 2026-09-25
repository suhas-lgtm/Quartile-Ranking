// netlify/functions/data.mts — the deployed site's /data/* and /live/indices/*.
//
// netlify.toml rewrites both prefixes here. The file itself comes from Neon's
// `files` table via server/neonFiles.ts, the same lookup `npm run dev` uses.
// Needs DATABASE_URL in the Netlify site's environment variables; a read-only
// Neon role is enough, since this only ever SELECTs.
import { route, readFile } from '../../server/neonFiles'
import { isProtected, readCookie, sessionValid, SESSION_COOKIE } from '../../server/auth'

const FN_PREFIX = '/.netlify/functions/data'

// CDN caching, to spend fewer Netlify credits: every uncached page view would
// otherwise invoke this function and query Neon. Public files are kept at the
// edge for 15 minutes and then revalidated in the background, so the data
// refreshed twice a day reaches visitors within ~15 minutes while the function
// runs at most about once per file per 15 minutes. "durable" shares the cached
// copy across Netlify's edge nodes.
const CDN_PUBLIC = 'public, durable, s-maxage=900, stale-while-revalidate=86400'
// Anything personal or failed must never be cached: the cache key ignores
// cookies, so a cached protected file would be served to everyone.
const NO_STORE = { 'cache-control': 'private, no-store', 'netlify-cdn-cache-control': 'no-store' }

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return new Response('DATABASE_URL is not configured', { status: 500 })
  }

  // Depending on how the rewrite is applied the function sees either the
  // original URL (/data/meta.json) or the rewritten one
  // (/.netlify/functions/data/data/meta.json). Accept both.
  let pathname = new URL(req.url).pathname
  if (pathname.startsWith(FN_PREFIX)) pathname = pathname.slice(FN_PREFIX.length)

  const target = route(pathname)
  if (!target) return new Response('Not found', { status: 404 })

  // Whitelist Screener data needs a login (server/auth.ts). Fails closed: with
  // no password configured the files are simply not served.
  if (target.bucket === 'MF Data' && isProtected(target.path)) {
    const password = process.env.WHITELIST_PASSWORD
    const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE)
    if (!password || !sessionValid(token, password, databaseUrl)) {
      return new Response(JSON.stringify({ error: 'login required' }), {
        status: 401, headers: { 'content-type': 'application/json', ...NO_STORE },
      })
    }
  }

  try {
    const file = await readFile(databaseUrl, target.bucket, target.path)
    const protectedFile = target.bucket === 'MF Data' && isProtected(target.path)
    if (!file) {
      // A category with no funds has no file, and the page asks for it on every
      // visit; caching the 404 briefly saves those calls too.
      return new Response('Not found', {
        status: 404,
        headers: protectedFile ? NO_STORE
          : { 'cache-control': 'public, max-age=300', 'netlify-cdn-cache-control': CDN_PUBLIC },
      })
    }
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(file.body), {
      status: 200,
      headers: {
        'content-type': file.contentType,
        ...(protectedFile ? NO_STORE : {
          'cache-control': file.cacheControl ?? 'public, max-age=300',
          'netlify-cdn-cache-control': CDN_PUBLIC,
        }),
      },
    })
  } catch (err) {
    console.error('neon read failed', target, err)
    return new Response('Upstream error', { status: 502, headers: NO_STORE })
  }
}

// netlify/functions/auth.mts — /api/login, /api/session, /api/logout for the
// Whitelist Screener password (see server/auth.ts). netlify.toml rewrites
// /api/* here. Needs WHITELIST_PASSWORD and DATABASE_URL in the site's
// environment variables.
import { handleAuth } from '../../server/auth'
import { handleBlacklist } from '../../server/lists'
import { handleNav } from '../../server/navLookup'

const FN_PREFIX = '/.netlify/functions/auth'

export default async (req: Request): Promise<Response> => {
  let path = new URL(req.url).pathname
  if (path.startsWith(FN_PREFIX)) path = path.slice(FN_PREFIX.length)
  const action = path.replace(/^\/(api\/)?/, '').replace(/\/$/, '')

  // /api/blacklist[/<code>]: the team's Blacklist (server/lists.ts); the rest is login.
  // /api/nav: NAVs on any date (server/navLookup.ts), public and CDN-cached.
  if (action === 'nav') {
    const r = await handleNav(new URL(req.url).searchParams, process.env.DATABASE_URL)
      .catch(err => { console.error('nav', err); return { status: 502, body: '{"error":"database error"}' } })
    return new Response(r.body, { status: r.status, headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
      'netlify-cdn-cache-control': r.status === 200
        ? 'public, durable, s-maxage=900, stale-while-revalidate=3600' : 'no-store',
    } })
  }

  const out: { status: number; body: string; setCookie?: string } =
    action === 'blacklist' || action.startsWith('blacklist/')
    ? await handleBlacklist(action.slice('blacklist'.length), req.method, req.headers.get('cookie'),
                            () => req.text(),
                            { password: process.env.WHITELIST_PASSWORD, databaseUrl: process.env.DATABASE_URL })
        .catch(err => { console.error('blacklist', err); return { status: 502, body: '{"error":"database error"}' } })
    : await handleAuth(
        action, req.method, req.headers.get('cookie'), () => req.text(),
        { password: process.env.WHITELIST_PASSWORD, salt: process.env.DATABASE_URL },
        true,
      )
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'netlify-cdn-cache-control': 'no-store',
  }
  if (out.setCookie) headers['set-cookie'] = out.setCookie
  return new Response(out.body, { status: out.status, headers })
}

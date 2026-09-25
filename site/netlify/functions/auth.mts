// netlify/functions/auth.mts — /api/login, /api/session, /api/logout for the
// Whitelist Screener password (see server/auth.ts). netlify.toml rewrites
// /api/* here. Needs WHITELIST_PASSWORD and DATABASE_URL in the site's
// environment variables.
import { handleAuth } from '../../server/auth'

const FN_PREFIX = '/.netlify/functions/auth'

export default async (req: Request): Promise<Response> => {
  let path = new URL(req.url).pathname
  if (path.startsWith(FN_PREFIX)) path = path.slice(FN_PREFIX.length)
  const action = path.replace(/^\/(api\/)?/, '').replace(/\/$/, '')

  const out = await handleAuth(
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

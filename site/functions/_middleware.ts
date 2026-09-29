// functions/_middleware.ts — the dashboard password, in front of every request
// (pages, static files, /data, /api, /live). See server/siteGate.ts.
import { siteGate } from '../server/siteGate'

interface Env { SITE_PASSWORD?: string; DATABASE_URL?: string }

export const onRequest = async (ctx: { request: Request; env: Env; next: () => Promise<Response> }) => {
  const req = ctx.request
  const url = new URL(req.url)
  const out = await siteGate({
    pathname: url.pathname, method: req.method, cookie: req.headers.get('cookie'),
    accept: req.headers.get('accept'), readBody: () => req.text(),
  }, { password: ctx.env.SITE_PASSWORD, salt: ctx.env.DATABASE_URL }, url.protocol === 'https:')
  if (!out) return ctx.next()
  return new Response(req.method === 'HEAD' ? null : out.body, { status: out.status, headers: out.headers })
}

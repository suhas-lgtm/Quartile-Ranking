// /r/<token> — a client report shared as a link (server/reports.ts). Public: the
// dashboard password is not asked here (server/siteGate.ts lets /r/ through).
import { serveReport } from '../../server/reports'

interface Env { DATABASE_URL?: string }

export const onRequestGet = async (ctx: { params: { token: string }; env: Env }) => {
  const r = await serveReport(String(ctx.params.token), ctx.env.DATABASE_URL)
    .catch(err => { console.error('report', err); return { status: 502, body: 'Error', headers: { 'content-type': 'text/plain' } } })
  return new Response(r.body, { status: r.status, headers: r.headers })
}

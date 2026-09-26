// /api/* — Whitelist login, team Blacklist, NAV / series / holdings (functions/_lib/handlers.ts).
import { serveApi, type Env } from '../_lib/handlers'

export const onRequest = (ctx: { request: Request; env: Env }) => serveApi(ctx.request, ctx.env)

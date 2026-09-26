// /live/indices/* — Market Pulse index files, from Neon (functions/_lib/handlers.ts).
import { serveFile, type Env } from '../../_lib/handlers'

export const onRequest = (ctx: { request: Request; env: Env }) => serveFile(ctx.request, ctx.env)

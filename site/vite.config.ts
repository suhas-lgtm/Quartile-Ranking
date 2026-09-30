import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { route, readFile } from './server/neonFiles'
import { handleAuth, isProtected, readCookie, sessionValid, SESSION_COOKIE } from './server/auth'
import { handleBlacklist } from './server/lists'
import { handleClients } from './server/clients'
import { handleReports, serveReport } from './server/reports'
import { handleHoldings, handleNav, handleSeries } from './server/navLookup'
import { siteGate } from './server/siteGate'

// Dev mirrors what the Netlify function does in production: /data/* and
// /live/indices/* are answered from Neon's `files` table, which the pipeline
// (scripts/publish_data.py, scripts/update_indices.py) fills. site/public/data is
// not committed, so a fresh clone has no local data and every request would 404
// without this.
// DATABASE_URL is read from ../.env and used only here, in the dev server
// process. It is never exposed to the browser.
function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    /* no .env */
  }
  return undefined
}

// LOCAL DATA WINS OVER NEON.
// A request is only sent to Neon when the file is genuinely absent locally, so a
// freshly built dataset shows up immediately and a clean clone still works.
//
// Populate the local copy with the layout the site expects (NOT the engine's flat
// output — see publish_data.write_local_tree):
//     MF_OUTPUT_DIR=build/data-flat python scripts/daily_run.py
//     MF_OUTPUT_DIR=build/data-flat python scripts/publish_data.py --to-dir site/public/data
const LOCAL_DATA = path.resolve(__dirname, 'public', 'data')

function hasLocal(pathname: string): boolean {
  if (!pathname.startsWith('/data/')) return false
  const rel = decodeURIComponent(pathname.slice('/data'.length))
  const target = path.resolve(LOCAL_DATA, '.' + rel)
  if (!target.startsWith(LOCAL_DATA)) return false
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function neonData(): Plugin {
  const databaseUrl = readEnv('DATABASE_URL')
  const password = readEnv('WHITELIST_PASSWORD')
  const sitePassword = readEnv('SITE_PASSWORD')
  return {
    name: 'neon-data',
    configureServer(server) {
      // The dashboard password (server/siteGate.ts), first so nothing is served around it —
      // the same gate as functions/_middleware.ts in production. Vite's own module
      // requests (/@vite, /src, /node_modules) are the app itself and need the login too.
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        const out = await siteGate({
          pathname, method: req.method ?? 'GET', cookie: req.headers.cookie, accept: req.headers.accept,
          readBody: () => new Promise<string>(resolve => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => resolve(b)) }),
        }, { password: sitePassword, salt: databaseUrl }, false)
        if (!out) return next()
        res.statusCode = out.status
        for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
        res.end(out.body)
      })
      if (!databaseUrl || databaseUrl.includes('YOUR-')) {
        console.warn('[vite] DATABASE_URL is not set in ../.env — /data requests will 404 '
          + 'until you add your Neon connection string there.')
      }
      // Shared client reports (functions/r/[token].ts in production).
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/r\/([A-Za-z0-9_-]+)$/.exec((req.url ?? '').split('?')[0])
        if (!m) return next()
        const r = await serveReport(m[1], databaseUrl)
          .catch(err => { console.error('[vite] report', err); return { status: 502, body: 'Error', headers: {} } })
        res.statusCode = r.status
        for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v)
        res.end(r.body)
      })
      // Whitelist Screener login, same handler as netlify/functions/auth.mts.
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith('/api/')) return next()
        const action = pathname.slice('/api/'.length).replace(/\/$/, '')
        const readers: Record<string, typeof handleNav> = { nav: handleNav, series: handleSeries, holdings: handleHoldings }
        if (readers[action]) {
          const r = await readers[action](new URL(req.url ?? '', 'http://localhost').searchParams, databaseUrl)
            .catch(err => { console.error('[vite] nav', err); return { status: 502, body: '{"error":"database error"}' } })
          res.statusCode = r.status
          res.setHeader('content-type', 'application/json')
          return res.end(r.body)
        }
        if (action === 'reports') {
          const read = () => new Promise<string>(resolve => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => resolve(b)) })
          const r = await handleReports(new URL(req.url ?? '', 'http://localhost').searchParams, req.method ?? 'GET', read, databaseUrl)
            .catch(err => { console.error('[vite] reports', err); return { status: 502, body: '{"error":"database error"}' } })
          res.statusCode = r.status
          res.setHeader('content-type', 'application/json')
          return res.end(r.body)
        }
        if (action === 'clients') {
          const read = () => new Promise<string>(resolve => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => resolve(b)) })
          const r = await handleClients(new URL(req.url ?? '', 'http://localhost').searchParams, req.method ?? 'GET', read, databaseUrl)
            .catch(err => { console.error('[vite] clients', err); return { status: 502, body: '{"error":"database error"}' } })
          res.statusCode = r.status
          res.setHeader('content-type', 'application/json')
          return res.end(r.body)
        }
        const body = () => new Promise<string>(resolve => {
          let b = ''
          req.on('data', c => { b += c })
          req.on('end', () => resolve(b))
        })
        const out: { status: number; body: string; setCookie?: string } =
          action === 'blacklist' || action.startsWith('blacklist/')
            ? await handleBlacklist(action.slice('blacklist'.length), req.method ?? 'GET', req.headers.cookie,
                                    body, { password, databaseUrl })
                .catch(err => { console.error('[vite] blacklist', err); return { status: 502, body: '{"error":"database error"}' } })
            : await handleAuth(action, req.method ?? 'GET', req.headers.cookie, body,
                               { password, salt: databaseUrl }, false)
        res.statusCode = out.status
        res.setHeader('content-type', 'application/json')
        if (out.setCookie) res.setHeader('set-cookie', out.setCookie)
        res.end(out.body)
      })
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        const target = route(pathname)
        if (!target) return next()
        if (target.bucket === 'MF Data' && isProtected(target.path)) {
          const token = readCookie(req.headers.cookie, SESSION_COOKIE)
          if (!password || !databaseUrl || !sessionValid(token, password, databaseUrl)) {
            res.statusCode = 401
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify({ error: 'login required' }))
          }
        }
        if (hasLocal(pathname)) return next()
        if (!databaseUrl) {
          res.statusCode = 404
          return res.end('DATABASE_URL not configured')
        }
        try {
          const file = await readFile(databaseUrl, target.bucket, target.path)
          if (!file) {
            res.statusCode = 404
            return res.end('Not found')
          }
          res.setHeader('content-type', file.contentType)
          res.setHeader('cache-control', 'no-cache')
          res.end(file.body)
        } catch (err) {
          console.error('[vite] neon read failed', target, err)
          res.statusCode = 502
          res.end('Upstream error')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), neonData()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['echarts', 'echarts-for-react'],
          table:  ['@tanstack/react-table'],
        },
      },
    },
  },
})

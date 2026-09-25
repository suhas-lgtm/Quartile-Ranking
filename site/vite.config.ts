import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { route, readFile } from './server/neonFiles'
import { handleAuth, isProtected, readCookie, sessionValid, SESSION_COOKIE } from './server/auth'

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
  return {
    name: 'neon-data',
    configureServer(server) {
      if (!databaseUrl || databaseUrl.includes('YOUR-')) {
        console.warn('[vite] DATABASE_URL is not set in ../.env — /data requests will 404 '
          + 'until you add your Neon connection string there.')
      }
      // Whitelist Screener login, same handler as netlify/functions/auth.mts.
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith('/api/')) return next()
        const out = await handleAuth(
          pathname.slice('/api/'.length), req.method ?? 'GET', req.headers.cookie,
          () => new Promise<string>(resolve => {
            let b = ''
            req.on('data', c => { b += c })
            req.on('end', () => resolve(b))
          }),
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

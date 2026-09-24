import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Dev mirrors what netlify.toml does in production. Required, not a nicety:
// site/public/data is no longer committed, so a fresh clone has no local data and
// `npm run dev` would 404 on every request without this.
// The project URL is read from ../.env, so pointing this at a different Supabase
// project is a one-file change. Only the URL is taken — never the service key.
// The browser must never hold a credential and does not need one: both buckets
// are public, which is why this proxy is a plain forward with no headers.
function readEnv(key: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
      if (m && m[1] === key) return m[2]
    }
  } catch {
    /* no .env — fall through to the placeholder */
  }
  return undefined
}

const SUPABASE_ROOT = (readEnv('SUPABASE_URL') || 'https://YOUR-PROJECT-REF.supabase.co')
  .replace(/\/+$/, '')
const SUPABASE_PUBLIC = `${SUPABASE_ROOT}/storage/v1/object/public`

if (SUPABASE_ROOT.includes('YOUR-PROJECT-REF')) {
  console.warn('[vite] SUPABASE_URL is not set in ../.env — /data requests will 404 '
    + 'until you put your own project URL there.')
}

// LOCAL DATA WINS OVER THE BUCKET.
// The proxy used to be unconditional, so a locally built dataset was invisible:
// `npm run dev` kept serving whatever was last published and the dashboard's "as
// of" date never moved, however many times the pipeline was run. Now a request is
// only forwarded when the file is genuinely absent locally, so a fresh build shows
// up immediately and a clean clone still works.
//
// Populate the local copy with the layout the site expects (NOT the engine's flat
// output — see publish_data.write_local_tree):
//     MF_OUTPUT_DIR=build/data-flat python scripts/daily_run.py
//     MF_OUTPUT_DIR=build/data-flat python scripts/publish_data.py --to-dir site/public/data
const LOCAL_DATA = path.resolve(__dirname, 'public', 'data')

function serveLocalIfPresent(prefix: string, root: string) {
  return (req: { url?: string }) => {
    const url = req.url ?? ''
    const rel = decodeURIComponent(url.slice(prefix.length).split('?')[0])
    // Refuse to climb out of the data directory.
    const target = path.resolve(root, '.' + (rel.startsWith('/') ? rel : '/' + rel))
    if (!target.startsWith(root)) return undefined
    try {
      if (fs.statSync(target).isFile()) return url   // returning the url serves it locally
    } catch {
      /* not present — fall through to the proxy */
    }
    return undefined
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/data': {
        target: `${SUPABASE_PUBLIC}/MF%20Data`,
        changeOrigin: true,
        bypass: serveLocalIfPresent('/data', LOCAL_DATA),
        rewrite: (p) => p.replace(/^\/data/, ''),
      },
      '/live/indices': {
        target: `${SUPABASE_PUBLIC}/Indicies%20Data`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live\/indices/, ''),
      },
    },
  },
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

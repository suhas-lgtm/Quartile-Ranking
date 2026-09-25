// server/neonFiles.ts — serve the dashboard's data files out of Neon.
//
// The pipeline (scripts/neon_store.py) writes every published JSON file into the
// `files` table, keyed by (bucket, path). This is the read side, shared by the
// two places that answer the browser's requests:
//
//   vite.config.ts                 `npm run dev`
//   netlify/functions/data.mts     the deployed site
//
// It runs server-side only. DATABASE_URL never reaches the browser, which keeps
// requesting the same same-origin URLs it always has:
//
//   /data/<path>            -> bucket "MF Data"
//   /live/indices/<slug>    -> bucket "Indicies Data"   (spelled as created)
import { neon } from '@neondatabase/serverless'

// Longest prefix first, so /live/indices/ can never be read as something else.
const ROUTES: Array<[prefix: string, bucket: string]> = [
  ['/live/indices/', 'Indicies Data'],
  ['/data/', 'MF Data'],
]

export interface StoredFile {
  body: Buffer
  contentType: string
  cacheControl: string | null
}

/** {bucket, path} for a request path, or null when it is not a data URL. */
export function route(pathname: string): { bucket: string; path: string } | null {
  for (const [prefix, bucket] of ROUTES) {
    if (!pathname.startsWith(prefix)) continue
    let path: string
    try {
      path = decodeURIComponent(pathname.slice(prefix.length))
    } catch {
      return null
    }
    // Paths are table keys, not filesystem paths, but refuse anything odd rather
    // than rely on that.
    if (!path || path.split('/').some(seg => seg === '..' || seg === '')) return null
    return { bucket, path }
  }
  return null
}

const clients = new Map<string, ReturnType<typeof neon>>()

function client(databaseUrl: string) {
  let sql = clients.get(databaseUrl)
  if (!sql) {
    sql = neon(databaseUrl)
    clients.set(databaseUrl, sql)
  }
  return sql
}

/** The stored file, or null when there is no such object. */
export async function readFile(databaseUrl: string, bucket: string,
                               path: string): Promise<StoredFile | null> {
  const sql = client(databaseUrl)
  // base64 because bytea over the HTTP driver arrives as a hex string; this
  // keeps the decode to one well-defined step.
  type Row = { b64: string; content_type: string; cache_control: string | null }
  const query = async () => (await sql`
    SELECT encode(body, 'base64') AS b64, content_type, cache_control
    FROM files WHERE bucket = ${bucket} AND path = ${path}
  `) as Row[]
  // Neon's free tier suspends an idle database, and the request that wakes it
  // can fail ("fetch failed") while it starts. One retry after a short pause
  // covers the wake-up so the visitor never sees it.
  let rows
  try {
    rows = await query()
  } catch {
    await new Promise(r => setTimeout(r, 1500))
    rows = await query()
  }
  if (!rows.length) return null
  return {
    body: Buffer.from(rows[0].b64, 'base64'),
    contentType: rows[0].content_type,
    cacheControl: rows[0].cache_control,
  }
}

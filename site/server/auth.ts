// server/auth.ts — the password gate in front of the Whitelist Screener.
//
// Server-side on purpose. Hiding the tab in the browser would still leave its
// data files readable at /data/.../screener.json, so the check lives where the
// files are served: the Netlify function in production, the Vite middleware in
// dev. Both call into this module.
//
// The password is never in the code (the repository is public). It comes from
// the WHITELIST_PASSWORD environment variable. A correct password earns an
// HttpOnly cookie holding "<expiry>.<HMAC(expiry)>"; the HMAC key is derived
// from the password and DATABASE_URL (itself a server-only secret), so changing
// the password logs everyone out and no extra secret has to be configured.
import { createHash, createHmac, timingSafeEqual } from 'crypto'

export const SESSION_COOKIE = 'wl_session'
const SESSION_DAYS = 30

/** Data paths (inside the MF Data bucket) that need a session. */
export function isProtected(path: string): boolean {
  return path.endsWith('/screener.json') || path === 'whitelist.json'
}

function signingKey(password: string, salt: string): Buffer {
  return createHash('sha256').update(`wl-session\0${password}\0${salt}`).digest()
}

function sign(payload: string, password: string, salt: string): string {
  return createHmac('sha256', signingKey(password, salt)).update(payload).digest('base64url')
}

function equal(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

export function passwordMatches(given: string, expected: string): boolean {
  return typeof given === 'string' && given.length > 0 && equal(given, expected)
}

export function issueSession(password: string, salt: string): string {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400)
  return `${exp}.${sign(exp, password, salt)}`
}

export function sessionValid(token: string | undefined, password: string, salt: string): boolean {
  if (!token) return false
  const [exp, sig] = token.split('.')
  if (!exp || !sig || !/^\d+$/.test(exp)) return false
  if (Number(exp) < Date.now() / 1000) return false
  return equal(sig, sign(exp, password, salt))
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

export function clearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

/**
 * The /api/login, /api/session and /api/logout endpoints, framework-free so the
 * Netlify function and the Vite middleware share them exactly.
 */
export async function handleAuth(
  action: string, method: string, cookieHeader: string | null | undefined,
  readBody: () => Promise<string>, env: { password?: string; salt?: string }, secure: boolean,
): Promise<{ status: number; body: string; setCookie?: string }> {
  const json = (status: number, obj: object, setCookie?: string) =>
    ({ status, body: JSON.stringify(obj), setCookie })

  if (!env.password || !env.salt) return json(503, { error: 'login is not configured on the server' })

  if (action === 'session') {
    const ok = sessionValid(readCookie(cookieHeader, SESSION_COOKIE), env.password, env.salt)
    return json(ok ? 200 : 401, { authenticated: ok })
  }
  if (action === 'logout') return json(200, { authenticated: false }, clearCookie(secure))
  if (action === 'login') {
    if (method !== 'POST') return json(405, { error: 'POST only' })
    let given = ''
    try {
      given = String(JSON.parse(await readBody() || '{}').password ?? '')
    } catch {
      return json(400, { error: 'bad request' })
    }
    // A fixed small delay blunts password guessing without any state to keep.
    await new Promise(r => setTimeout(r, 400))
    if (!passwordMatches(given, env.password)) return json(401, { error: 'Incorrect password' })
    return json(200, { authenticated: true }, sessionCookie(issueSession(env.password, env.salt), secure))
  }
  return json(404, { error: 'not found' })
}

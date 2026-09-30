// server/siteGate.ts — the password in front of the whole dashboard.
//
// Every request goes through siteGate() first: in production from
// functions/_middleware.ts (Cloudflare Pages), in dev from the Vite middleware.
// Without a valid session cookie a page request gets the opening (login) page,
// and a data or API request gets 401 — so the data files cannot be read by
// going around the page. The password is never in the code (the repository is
// public): it is the SITE_PASSWORD secret. The cookie is "<expiry>.<HMAC>", the
// same scheme as the Whitelist login (server/auth.ts) with its own key, so
// changing SITE_PASSWORD signs everyone out.
import { issueSession, passwordMatches, readCookie, sessionValid } from './auth'

export const SITE_COOKIE = 'amf_site'
const SITE_DAYS = 7

export interface GateResult {
  /** null = let the request through. */
  status: number
  headers: Record<string, string>
  body: string
}

// The key includes a label, so a Whitelist cookie can never pass as a site cookie.
const keyOf = (password: string) => `site-gate\0${password}`

function siteCookie(token: string, secure: boolean, maxAge = SITE_DAYS * 86400) {
  return `${SITE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function siteSessionValid(cookieHeader: string | null | undefined, password: string, salt: string): boolean {
  return sessionValid(readCookie(cookieHeader, SITE_COOKIE), keyOf(password), salt)
}

/** Paths the opening page itself needs before anyone has logged in, and shared client
 *  reports (/r/<token>, server/reports.ts): each opens only its own report. */
function isOpen(pathname: string) {
  return pathname === '/api/site-login' || pathname === '/logo.png' || pathname === '/favicon.ico'
    || /^\/r\/[A-Za-z0-9_-]{24}$/.test(pathname)
}

/**
 * Decide one request. Returns null to let it through, or the response to send
 * (the opening page, a 401, or the login result).
 */
export async function siteGate(req: {
  pathname: string; method: string; cookie: string | null | undefined; accept: string | null | undefined
  readBody: () => Promise<string>
}, env: { password?: string; salt?: string }, secure: boolean): Promise<GateResult | null> {
  const noStore = { 'cache-control': 'private, no-store' }
  const json = (status: number, obj: object, extra: Record<string, string> = {}) =>
    ({ status, headers: { 'content-type': 'application/json', ...noStore, ...extra }, body: JSON.stringify(obj) })

  // Fail closed: no password configured means nobody gets in.
  if (!env.password || !env.salt) {
    return { status: 503, headers: { 'content-type': 'text/plain', ...noStore }, body: 'Dashboard login is not configured (SITE_PASSWORD).' }
  }

  if (req.pathname === '/api/site-login') {
    if (req.method !== 'POST') return json(405, { error: 'POST only' })
    let given = ''
    try { given = String(JSON.parse(await req.readBody() || '{}').password ?? '') } catch { return json(400, { error: 'bad request' }) }
    // A fixed small delay blunts password guessing without any state to keep.
    await new Promise(r => setTimeout(r, 500))
    if (!passwordMatches(given, env.password)) return json(401, { error: 'Incorrect password' })
    return json(200, { ok: true }, { 'set-cookie': siteCookie(issueSession(keyOf(env.password), env.salt), secure) })
  }
  if (req.pathname === '/api/site-logout') {
    return json(200, { ok: true }, { 'set-cookie': siteCookie('', secure, 0) })
  }
  if (isOpen(req.pathname) || siteSessionValid(req.cookie, env.password, env.salt)) return null

  // Not logged in: data and API calls get a plain 401; anything a browser navigates to gets the opening page.
  if (/^\/(api|data|live)\//.test(req.pathname) || !(req.accept ?? '').includes('text/html')) {
    return json(401, { error: 'login required' })
  }
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...noStore }, body: OPENING_PAGE }
}

const OPENING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Armstrong MF Research</title>
<link rel="icon" href="/logo.png">
<style>
  :root { --bg: #0B1120; --card: #111A2E; --line: #22304D; --hi: #F1F5F9; --mid: #94A3B8; --low: #64748B; --accent: #22D3EE; --gold: #F59E0B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--hi);
    background: radial-gradient(1200px 600px at 15% -10%, rgba(34,211,238,0.16), transparent 60%),
                radial-gradient(900px 500px at 110% 110%, rgba(245,158,11,0.12), transparent 60%), var(--bg);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  .wrap { width: 100%; max-width: 980px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 28px; align-items: center; }
  .brand img { height: 56px; border-radius: 10px; background: #fff; padding: 6px; }
  .brand h1 { font-size: 34px; line-height: 1.15; margin: 22px 0 10px; letter-spacing: -0.02em; }
  .brand h1 span { color: var(--accent); }
  .brand p { color: var(--mid); font-size: 15px; line-height: 1.6; margin: 0 0 20px; max-width: 460px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; color: var(--mid); border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px; background: rgba(17,26,46,0.6); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 30px 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
  .card h2 { margin: 0 0 4px; font-size: 20px; }
  .card .sub { color: var(--mid); font-size: 13px; margin: 0 0 22px; }
  label { display: block; font-size: 12px; color: var(--mid); margin-bottom: 6px; }
  .field { position: relative; }
  input { width: 100%; font-size: 15px; padding: 12px 44px 12px 14px; border-radius: 10px; border: 1px solid var(--line);
          background: #0B1322; color: var(--hi); outline: none; }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(34,211,238,0.18); }
  .eye { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: 0; color: var(--low); cursor: pointer; font-size: 13px; padding: 6px; }
  button.go { width: 100%; margin-top: 16px; padding: 12px; border: 0; border-radius: 10px; font-size: 15px; font-weight: 700;
              color: #06202A; background: linear-gradient(90deg, #22D3EE, #38BDF8); cursor: pointer; }
  button.go:disabled { opacity: 0.6; cursor: wait; }
  .err { color: #F87171; font-size: 13px; min-height: 18px; margin-top: 10px; }
  .foot { color: var(--low); font-size: 11px; margin-top: 18px; line-height: 1.5; }
  @media (max-width: 780px) { .wrap { grid-template-columns: 1fr; } .brand h1 { font-size: 26px; } .chips { display: none; } }
</style>
</head>
<body>
  <main class="wrap">
    <section class="brand">
      <img src="/logo.png" alt="Armstrong Capital">
      <h1>Armstrong <span>MF Research</span> Dashboard</h1>
      <p>Mutual fund and SIF research for the Armstrong Capital team — quartile rankings, risk &amp; returns, portfolio building and client portfolio reviews, refreshed every working day.</p>
      <div class="chips">
        <span class="chip">Quartile Ranking</span><span class="chip">Risk &amp; Returns</span><span class="chip">Portfolio Builder</span>
        <span class="chip">Portfolio Comparison</span><span class="chip">SIF desk</span><span class="chip">Whitelist &amp; Blacklist</span>
      </div>
    </section>
    <section class="card">
      <h2>Welcome</h2>
      <p class="sub">Enter the team password to open the dashboard.</p>
      <form id="f" autocomplete="on">
        <label for="pw">Password</label>
        <div class="field">
          <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
          <button class="eye" type="button" id="eye" aria-label="Show password">Show</button>
        </div>
        <button class="go" id="go" type="submit">Open dashboard →</button>
        <div class="err" id="err" role="alert"></div>
      </form>
      <div class="foot">For Armstrong Capital employees only. You stay signed in on this device for 7 days.</div>
    </section>
  </main>
<script>
  var f = document.getElementById('f'), pw = document.getElementById('pw'), go = document.getElementById('go'), err = document.getElementById('err');
  document.getElementById('eye').onclick = function () {
    var show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; this.textContent = show ? 'Hide' : 'Show'; pw.focus();
  };
  f.onsubmit = function (e) {
    e.preventDefault(); err.textContent = ''; go.disabled = true; go.textContent = 'Checking…';
    fetch('/api/site-login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
                               body: JSON.stringify({ password: pw.value }) })
      .then(function (r) {
        if (r.ok) { location.reload(); return; }
        err.textContent = r.status === 401 ? 'Incorrect password. Please try again.' : 'Could not sign in right now (' + r.status + ').';
        go.disabled = false; go.textContent = 'Open dashboard →'; pw.select();
      })
      .catch(function () { err.textContent = 'Network error. Please try again.'; go.disabled = false; go.textContent = 'Open dashboard →'; });
  };
</script>
</body>
</html>`

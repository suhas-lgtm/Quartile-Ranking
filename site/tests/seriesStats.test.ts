// Returns, Std Dev, Sharpe for a fund and a whole portfolio (utils/seriesStats.ts),
// and SIP frequencies (utils/holdingsUpload.ts). Synthetic NAVs, so the right
// answers are known exactly. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portfolioRisk, seriesStats, type PricePoint } from '../src/utils/seriesStats'
import { perMonth } from '../src/utils/holdingsUpload'

/** Month-end NAVs from monthly returns, oldest first, ending on 2026-09-30. */
function navs(returns: number[]): PricePoint[] {
  const out: PricePoint[] = []
  let v = 100
  const n = returns.length
  for (let i = 0; i <= n; i++) {
    const d = new Date(Date.UTC(2026, 9 - (n - i), 0))            // last day of each month
    out.push([d.toISOString().slice(0, 10), +v.toFixed(6)])
    if (i < n) v *= 1 + returns[i]
  }
  return out
}
const close = (a: number | null | undefined, b: number, tol = 1e-3) => {
  assert.ok(a != null, 'value missing'); assert.ok(Math.abs(a! - b) < tol, `${a} is not ${b}`)
}

test('steady 1% a month: 3Y CAGR 12.68%, Std Dev 0, so no Sharpe', () => {
  const s = seriesStats(navs(Array(48).fill(0.01)), 0.065)!
  close(s.returns['3Y'], Math.pow(1.01, 12) - 1)
  close(s.std_annual, 0, 1e-6)
  assert.equal(s.sharpe, null)                                     // dividing by zero swing is not a ratio
})

test('Std Dev is the sample standard deviation of monthly returns × √12', () => {
  const r = Array.from({ length: 48 }, (_, i) => (i % 2 ? 0.03 : -0.01))
  const s = seriesStats(navs(r), 0.065)!
  const last = r.slice(-36), mean = last.reduce((a, b) => a + b, 0) / 36
  const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / 35) * Math.sqrt(12)
  close(s.std_annual, sd)
  close(s.sharpe, ((s.returns['3Y'] as number) - 0.065) / sd)
})

test('a one-fund portfolio has the fund’s own Std Dev', () => {
  const r = Array.from({ length: 48 }, (_, i) => Math.sin(i) * 0.04 + 0.01)
  const f = seriesStats(navs(r), 0.065)!
  const p = portfolioRisk([{ points: navs(r), amount: 100 }], 0.065)!
  close(p.std_annual, f.std_annual!)
})

test('funds that move against each other lower the portfolio’s swing (and raise its Sharpe)', () => {
  const a = Array.from({ length: 48 }, (_, i) => (i % 2 ? 0.04 : -0.02))
  const b = Array.from({ length: 48 }, (_, i) => (i % 2 ? -0.02 : 0.04))
  const fa = seriesStats(navs(a), 0.065)!, fb = seriesStats(navs(b), 0.065)!
  const p = portfolioRisk([{ points: navs(a), amount: 50 }, { points: navs(b), amount: 50 }], 0.065)!
  assert.ok(p.std_annual! < Math.min(fa.std_annual!, fb.std_annual!), 'portfolio should swing less than either fund')
  assert.equal(p.coverage, 1)
})

test('too little history: the portfolio ratios stay blank', () => {
  const p = portfolioRisk([{ points: navs(Array(12).fill(0.01)), amount: 100 }], 0.065)!
  assert.equal(p.sharpe, null); assert.equal(p.std_annual, null)
})

test('SIP frequency turned into a monthly amount', () => {
  assert.equal(perMonth(2500, 'Weekly'), 10000)
  assert.equal(perMonth(500, 'Daily'), 11000)
  assert.equal(perMonth(3000, 'Fortnightly'), 6000)
  assert.equal(perMonth(3000, 'Quarterly'), 1000)
  assert.equal(perMonth(10000, 'Monthly'), 10000)
  assert.equal(perMonth(10000, ''), 10000)
})

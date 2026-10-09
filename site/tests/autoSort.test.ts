// Click-to-sort reads values off the cells as shown (utils/autoSort.ts). Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valueOf } from '../src/utils/autoSort'

const num = (t: string) => { const v = valueOf(t); assert.equal(v.kind, 'num', `${t} should read as a number`); return (v as { v: number }).v }

test('rupee amounts in lakh, crore and thousands', () => {
  assert.equal(num('₹5.00 L'), 500000)
  assert.equal(num('₹1.2 Cr'), 12000000)
  assert.equal(num('12.3k'), 12300)
  assert.equal(num('₹10,00,000'), 1000000)
  assert.equal(num('+₹3,00,000'), 300000)
  assert.equal(num('−₹1,00,000'), -100000)                 // the typographic minus used on the dashboard
})

test('percentages and plain numbers, signs included', () => {
  assert.equal(num('+14.09%'), 14.09)
  assert.equal(num('−1.42%'), -1.42)
  assert.equal(num('-0.18%'), -0.18)
  assert.equal(num('0.56'), 0.56)
  assert.equal(num('91.4'), 91.4)
})

test('blanks sort as blanks', () => {
  for (const t of ['—', '-', '', '…', 'N/A', 'pending']) assert.equal(valueOf(t).kind, 'blank', JSON.stringify(t))
})

test('fund names starting with digits stay text', () => {
  assert.equal(valueOf('360 ONE Focused Fund').kind, 'text')
  assert.equal(valueOf('HDFC Flexi Cap Fund').kind, 'text')
})

test('dates', () => {
  const a = valueOf('28 Sept 2026'), b = valueOf('2026-10-01')
  assert.equal(a.kind, 'date'); assert.equal(b.kind, 'date')
  assert.ok((a as { v: number }).v < (b as { v: number }).v)
})

test('arrows on a heading cell are ignored', () => {
  assert.equal(num('▲ 5.5'), 5.5)
})

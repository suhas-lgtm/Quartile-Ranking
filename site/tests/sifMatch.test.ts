// SIF holdings in an uploaded statement (utils/sifMatch.ts): which rows are SIFs,
// and which strategy each one is. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchSif } from '../src/utils/sifMatch'
import type { SifPlan } from '../src/sections/sif/types'

const plan = (id: string, house: string, name: string) => ({ id, house, name } as unknown as SifPlan)
const PLANS = [
  plan('SIF-11', 'Altiva SIF', 'Altiva Hybrid Long-Short Fund - Regular Plan - Growth'),
  plan('SIF-122', 'Altiva SIF', 'Altiva Equity Ex- Top 100 Long - Short Fund - Regular Plan - Growth'),
  plan('SIF-1', 'qsif SIF', 'qsif Equity Long Short Fund - Growth Option - Regular Plan'),
  plan('SIF-35', 'iSIF SIF', 'iSIF Hybrid Long-Short Fund - Growth'),
  plan('SIF-60', 'Magnum SIF', 'Magnum Hybrid Long Short Fund - Regular Plan - Growth'),
  plan('SIF-87', 'DynaSIF SIF', 'DynaSIF Active Asset Allocator Long-Short Fund - Regular Plan - Growth Option'),
]
const id = (raw: string) => matchSif(raw, PLANS)?.id ?? null

test('statement names in every spelling find their SIF', () => {
  assert.equal(id('Altiva Hybrid Long-Short Fund - Regular Plan - Growth'), 'SIF-11')
  assert.equal(id('ALTIVA HYBRID LONG SHORT FUND REGULAR GROWTH'), 'SIF-11')
  assert.equal(id('Altiva Equity Ex-Top 100 Long-Short Fund - Reg (G)'), 'SIF-122')
  assert.equal(id('qsif Equity Long-Short Fund - Direct Plan - IDCW'), 'SIF-1')      // Direct / IDCW → the strategy
  assert.equal(id('iSIF Hybrid Long-Short Fund - Growth'), 'SIF-35')
  assert.equal(id('DynaSIF Active Asset Allocator Long-Short Fund - Reg (G)'), 'SIF-87')
})

test('ordinary mutual funds are never taken for SIFs', () => {
  assert.equal(id('SBI Magnum Midcap Fund - Regular Plan - Growth'), null)          // same house word, not long-short
  assert.equal(id('HDFC Flexi Cap Fund - Regular Plan - Growth'), null)
  assert.equal(id('Parag Parikh Flexi Cap Fund'), null)
  assert.equal(id('ICICI Prudential Equity Arbitrage Fund'), null)
})

test('a long-short name from an unknown house is not forced onto a SIF', () => {
  assert.equal(id('Unknown House Equity Long-Short Fund'), null)
})

test('no SIF list loaded: nothing matches', () => {
  assert.equal(matchSif('Altiva Hybrid Long-Short Fund', []), null)
})

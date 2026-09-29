// src/utils/equityOnly.ts — which funds the correlation and overlap tables compare.
//
// Only domestic, actively managed equity funds: debt, hybrid, index/ETF (the
// "Other" asset class) and international funds are left out, as their correlation
// and stock overlap with the equity funds say nothing useful.

/** Equity funds that invest abroad (sectoral/thematic funds named for overseas markets). */
const INTERNATIONAL_RE = /international|global|overseas|world|nasdaq|nyse|fang|s&p\s*500|\bus\b|u\.s\.|america|emerging|asia|china|japan|europe|taiwan|hang\s*seng|feeder/i

export const leftOutOfMatrices = (assetClass: string | undefined, fundName: string) =>
  assetClass !== 'Equity' || INTERNATIONAL_RE.test(fundName)

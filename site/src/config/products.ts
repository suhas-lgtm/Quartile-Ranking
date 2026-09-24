// src/config/products.ts — the research desk this build serves.
//
// The full project supports more than one desk and a rail to switch between
// them. This package is the mutual fund desk only, so what remains is the
// labelling the footer and the Excel exports read. The shape is unchanged from
// the original so the sections that call currentDesk() need no edits.

export type ProductId = 'mf'

export interface Product {
  id: ProductId
  /** Display name. */
  name: string
  /** Two or three letters, used to prefix downloaded file names. */
  code: string
  /** Freeze-row title. */
  headerTitle: string
  /** Footer wording. */
  footerName: string
  /** Footer data-source credit. */
  sources: string
  /** Where its JSON lives under /data. Empty means the bucket root. */
  dataPrefix: string
}

export const MF: Product = {
  id: 'mf',
  name: 'Mutual Fund',
  code: 'MF',
  headerTitle: 'MF RESEARCH CENTER',
  footerName: 'Mutual Fund Research Center',
  sources: 'AMFI (navs), Yahoo Finance (indices)',
  dataPrefix: '',
}

export const DEFAULT_PRODUCT: ProductId = 'mf'

/** Never returns undefined — there is only one desk here. */
export function productById(_id?: string | null): Product {
  return MF
}

/**
 * The desk that is open, for callers outside React.
 *
 * It exists for things that are not components and cannot take a prop — chiefly
 * naming an exported file and labelling its header block.
 */
export function currentDesk(): Product {
  return MF
}

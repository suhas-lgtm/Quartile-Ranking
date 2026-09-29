// src/config/spaces.ts — what the left sidebar offers, and the tabs each one shows.
//
// A "space" is either a DESK (Mutual Funds, SIF) or a PERSON. The top tab row
// shows the tabs of whichever space is open. A person's page is simply a chosen
// list of tabs — existing Mutual Fund / SIF tabs, plus any tab built for them —
// so adding a tab for someone is one line in PEOPLE below.

import { ALL_TABS, type SectionId } from './profile'

export type TabDef = { id: string; label: string }

export const SIF_TABS: TabDef[] = [
  { id: 'sif-nav',     label: 'NAV & Returns' },
  { id: 'sif-leaders', label: 'Leaderboard' },
  { id: 'sif-details', label: 'Strategy Details' },
  { id: 'sif-monthly', label: 'Monthly Returns' },
  { id: 'sif-p2p',     label: 'Point to Point' },
  { id: 'sif-compare', label: 'Compare SIFs' },
  { id: 'sif-nfo',     label: 'SIF NFOs' },
]

/** Tabs built for one person. */
export const PERSON_TABS: TabDef[] = [
  { id: 'rahul-plan',    label: 'Client Plan' },
  { id: 'rahul-realloc', label: 'Portfolio Reallocation' },
]

export interface Desk { id: 'mf' | 'sif'; label: string; icon: string; tabs: TabDef[] }

export const DESKS: Desk[] = [
  { id: 'mf',  label: 'Mutual Funds', icon: '📈', tabs: ALL_TABS as unknown as TabDef[] },
  { id: 'sif', label: 'SIF',          icon: '🧭', tabs: SIF_TABS },
]

export interface Person {
  id: string
  name: string
  /** Tab ids, from the Mutual Fund or SIF desks (or built for this person). */
  tabs: string[]
}

// Starter pages: the same few tabs for everyone until each person says what
// they need. Change a list here to change that person's page.
const STARTER: SectionId[] = ['market-pulse', 'risk', 'compare', 'portfolio']

export const PEOPLE: Person[] = [
  { id: 'ashish',   name: 'Ashish',   tabs: [...STARTER] },
  { id: 'rahul',    name: 'Rahul',    tabs: ['rahul-plan', 'rahul-realloc', ...STARTER] },
  { id: 'ratheesh', name: 'Ratheesh', tabs: [...STARTER] },
  { id: 'manju',    name: 'Manju',    tabs: [...STARTER] },
  { id: 'chandhan', name: 'Chandhan', tabs: [...STARTER] },
]

export type SpaceId = Desk['id'] | `person:${string}`

const ALL_KNOWN: TabDef[] = [...(ALL_TABS as unknown as TabDef[]), ...SIF_TABS, ...PERSON_TABS]

/** The tabs a space shows, in order. */
export function tabsForSpace(space: SpaceId): TabDef[] {
  if (space.startsWith('person:')) {
    const p = PEOPLE.find(x => `person:${x.id}` === space)
    return (p?.tabs ?? []).map(id => ALL_KNOWN.find(t => t.id === id)).filter((t): t is TabDef => !!t)
  }
  return DESKS.find(d => d.id === space)?.tabs ?? DESKS[0].tabs
}

export function spaceLabel(space: SpaceId): string {
  if (space.startsWith('person:')) return PEOPLE.find(x => `person:${x.id}` === space)?.name ?? ''
  return DESKS.find(d => d.id === space)?.label ?? ''
}

export function spaceAllowed(space: string): space is SpaceId {
  return DESKS.some(d => d.id === space) || PEOPLE.some(p => `person:${p.id}` === space)
}

// src/config/profile.ts — which sections this build has.
//
// The full project ships five further sections behind an admin password. This
// package is the three open ones only: they are not hidden here, they are not
// present, and there is no password prompt because there is nothing to unlock.
//
// The tab list below is the single source of truth. Adding a section means
// adding it to SectionId and ALL_TABS, and rendering it in App.tsx.

export type SectionId = 'market-pulse' | 'quartile' | 'risk' | 'watchlist' | 'whitelist' | 'blacklist' | 'alerts'

/** In the order they appear in the header. */
const ALL_TABS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'market-pulse', label: 'Market Pulse' },
  { id: 'quartile',     label: 'Quartile Ranking' },
  { id: 'risk',         label: 'Risk & Returns' },
  { id: 'watchlist',    label: 'Fund Signals' },
  { id: 'whitelist',    label: 'Whitelist Screener' },
  { id: 'blacklist',    label: 'Blacklist' },
  { id: 'alerts',       label: 'Auto Mailing' },
]

/** Landing tab, and the fallback when a saved tab is no longer valid. */
export const DEFAULT_TAB: SectionId = 'market-pulse'

export function visibleTabs() {
  return ALL_TABS
}

export function defaultTab(): SectionId {
  return DEFAULT_TAB
}

/**
 * Is `tab` a real tab in this build?
 *
 * Worth keeping even with three fixed tabs: the last-viewed tab is remembered in
 * localStorage, so a browser that once opened a build with more sections will
 * hand back an id that no longer exists, and rendering it shows a blank page.
 */
export function tabAllowed(tab: string): boolean {
  return ALL_TABS.some(t => t.id === tab)
}

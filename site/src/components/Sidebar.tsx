// src/components/Sidebar.tsx — the two slide-in panels opened from the header:
// SIF (its pages) and Employees (one page per person). Hidden until a header
// button opens one; picking an entry switches the dashboard to it and closes.

import { PEOPLE, SIF_TABS, type SpaceId } from '../config/spaces'

export type DrawerKind = 'sif' | 'people'

export default function Sidebar({ kind, space, activeTab, onPick, onClose }: {
  kind: DrawerKind | null
  space: SpaceId
  activeTab: string
  /** Switch to a space, optionally at a given tab. */
  onPick: (space: SpaceId, tab?: string) => void
  onClose: () => void
}) {
  if (!kind) return null
  const item = (key: string, label: string, icon: string, on: boolean, go: () => void) => (
    <button key={key} onClick={() => { go(); onClose() }}
            className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm"
            style={{ background: on ? 'rgba(34,211,238,0.12)' : 'transparent', color: on ? 'var(--accent-a)' : 'var(--text-hi)',
                     fontWeight: on ? 700 : 500, border: 'none', cursor: 'pointer' }}>
      <span className="inline-flex items-center justify-center rounded-full text-xs font-bold"
            style={{ width: 24, height: 24, background: 'var(--bg-raised)', color: 'var(--accent-a)' }}>{icon}</span>
      {label}
    </button>
  )
  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose} style={{ background: 'rgba(0,0,0,0.45)' }}>
      <aside className="absolute left-0 top-0 bottom-0 border-r shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}
             style={{ width: 260, background: 'var(--bg-card)', borderColor: 'var(--line)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
          <span className="font-display font-bold text-sm" style={{ color: 'var(--text-hi)' }}>
            {kind === 'sif' ? '🧭 SIF — Specialised Investment Funds' : '👥 Employees'}
          </span>
          <button onClick={onClose} aria-label="Close"
                  style={{ background: 'none', border: 'none', color: 'var(--text-low)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <nav className="p-2 overflow-y-auto">
          {kind === 'sif'
            ? SIF_TABS.map(t => item(t.id, t.label, '·', space === 'sif' && activeTab === t.id, () => onPick('sif', t.id)))
            : PEOPLE.map(p => item(p.id, p.name, p.name.slice(0, 1).toUpperCase(), space === `person:${p.id}`,
                                   () => onPick(`person:${p.id}`)))}
        </nav>
        {kind === 'people' && (
          <p className="px-4 py-3 text-[11px] mt-auto" style={{ color: 'var(--text-low)' }}>
            Each person&apos;s page holds the tabs they use. Ask Suhas to add or change a tab for someone.
          </p>
        )}
      </aside>
    </div>
  )
}

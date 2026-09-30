// src/utils/savedClients.ts — saved clients on the server (server/clients.ts),
// so a client saved on one computer opens on any other.
//
// Each page keeps its working copy in this browser as before (so nothing is
// lost while typing, or if the server cannot be reached); this adds the shared
// list: the dropdown shows every client saved by the team, opening one fetches
// the latest copy, and a saved client's changes are written back a moment
// after each edit. Clients saved only in this browser before are uploaded the
// first time the page opens.

import { useCallback, useEffect, useRef, useState } from 'react'

export type ClientKind = 'rahul-plan' | 'rahul-realloc' | 'pcompare' | 'fund-screener'
export interface ClientEntry { name: string; updated_at: string }

async function call(method: string, qs: string, body?: unknown) {
  const r = await fetch(`/api/clients${qs}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const q = (kind: ClientKind, name?: string) => `?kind=${encodeURIComponent(kind)}${name ? `&name=${encodeURIComponent(name)}` : ''}`

export function useSavedClients<T>(opts: {
  kind: ClientKind
  /** The client open now ('' = a new, unsaved one). */
  current: string
  /** Clients saved in this browser, by name. */
  local: Record<string, T>
  /** Put a client's data into the page (and this browser). */
  putLocal: (name: string, data: T) => void
  /** Remove a client from this browser. */
  dropLocal: (name: string) => void
}) {
  const { kind, current, local, putLocal, dropLocal } = opts
  const [server, setServer] = useState<ClientEntry[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'online' | 'offline'>('loading')
  const [note, setNote] = useState<string | null>(null)
  const migrated = useRef(false)
  const skipSave = useRef<string | null>(null)
  const localRef = useRef(local)
  localRef.current = local

  const refresh = useCallback(async () => {
    try {
      const d = await call('GET', q(kind))
      setServer(d.clients ?? []); setStatus('online')
      return (d.clients ?? []) as ClientEntry[]
    } catch { setStatus('offline'); return null }
  }, [kind])

  // First visit: the list, and any clients saved only in this browser go up to the server.
  useEffect(() => {
    (async () => {
      const list = await refresh()
      if (!list || migrated.current) return
      migrated.current = true
      const onServer = new Set(list.map(c => c.name))
      const up = Object.keys(localRef.current).filter(n => n && !onServer.has(n))
      for (const n of up) await call('PUT', '', { kind, name: n, data: localRef.current[n] }).catch(() => undefined)
      if (up.length) { setNote(`${up.length} client${up.length === 1 ? '' : 's'} from this browser now saved for the team`); refresh() }
    })()
  }, [kind, refresh])

  /** Open a saved client: the latest copy from the server (else this browser's). */
  const open = useCallback(async (name: string) => {
    if (!name) return
    try {
      const d = await call('GET', q(kind, name))
      skipSave.current = name          // just loaded: no need to write it straight back
      putLocal(name, d.data as T)
    } catch { /* offline: this browser's copy stays */ }
  }, [kind, putLocal])

  const save = useCallback(async (name: string, data: T) => {
    try {
      await call('PUT', '', { kind, name, data })
      setNote(`Saved “${name}” — opens on any computer`); refresh()
      return true
    } catch { setNote(`Saved in this browser only — the server could not be reached`); return false }
  }, [kind, refresh])

  const remove = useCallback(async (name: string) => {
    dropLocal(name)
    try { await call('DELETE', q(kind, name)); refresh() } catch { /* removed here; retry later */ }
  }, [kind, dropLocal, refresh])

  // A saved client's edits go to the server a moment after typing stops.
  const data = current ? local[current] : undefined
  useEffect(() => {
    if (!current || data === undefined) return
    if (skipSave.current === current) { skipSave.current = null; return }
    const t = setTimeout(() => { call('PUT', '', { kind, name: current, data }).catch(() => setStatus('offline')) }, 1500)
    return () => clearTimeout(t)
  }, [kind, current, data])

  // Everything in the dropdown: the team's list, plus anything only in this browser.
  const names = [...new Set([...(server ?? []).map(c => c.name), ...Object.keys(local).filter(Boolean)])]
  return { names, status, note, open, save, remove, refresh }
}

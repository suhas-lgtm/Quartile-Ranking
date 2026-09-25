// src/components/FundLink.tsx — a fund name that opens the fund page.
//
// Any table can wrap a fund name in <FundLink>; clicking it asks the single
// <FundDetail> mounted in App to open for that scheme code. An event rather
// than props, so no table has to thread a callback through.

const EVENT = 'mf:open-fund'

export function openFund(code: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: code }))
}

export function onOpenFund(handler: (code: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export default function FundLink({ code, name, className }: { code: string; name: string; className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={e => { e.stopPropagation(); openFund(code) }}
      onKeyDown={e => { if (e.key === 'Enter') openFund(code) }}
      className={`fund-link ${className ?? ''}`}
      title={`${name} — click for the fund page`}
      style={{ cursor: 'pointer' }}
    >
      {name}
    </span>
  )
}

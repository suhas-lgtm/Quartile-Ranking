// src/App.tsx — tab router and light/dark theme.
//
// Five sections, all open: Market Pulse, Quartile Ranking, Risk & Returns,
// Fund Signals and Whitelist Screener.
// There is no password gate in this build because there is nothing gated —
// the restricted sections are not present rather than hidden.

import { useState, useEffect } from 'react'
import HeroHeader      from './components/HeroHeader'
import MarketPulseBar  from './components/MarketPulseBar'
import MarketPulse     from './sections/MarketPulse'
import QuartileRanking from './sections/QuartileRanking'
import Watchlist       from './sections/Watchlist'
import RiskReturns     from './sections/RiskReturns'
import WhitelistScreener from './sections/WhitelistScreener'
import Blacklist       from './sections/Blacklist'
import AutoMailing     from './sections/AutoMailing'
import PointToPoint    from './sections/PointToPoint'
import PortfolioBuilder from './sections/PortfolioBuilder'
import { useMeta }     from './hooks/useData'
import { defaultTab, tabAllowed } from './config/profile'
import { currentDesk } from './config/products'
import { setDataRoot } from './config/dataPaths'

const TAB_STORAGE_KEY = 'mfrc_active_tab'

/** The tab to open on load, ignoring a saved id this build no longer has. */
function initialTab(): string {
  const saved = localStorage.getItem(TAB_STORAGE_KEY)
  return saved && tabAllowed(saved) ? saved : defaultTab()
}

function StatusPage() {
  const { data: meta } = useMeta()
  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'var(--bg-base)' }}>
      <div className="card p-8 max-w-lg w-full">
        <div className="font-display font-bold text-lg mb-4" style={{ color: 'var(--accent-a)' }}>
          📊 Platform Status
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-mid)' }}>Data as of:</span>
            <span>{meta?.as_of ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-mid)' }}>Categories:</span>
            <span>{meta?.categories.length ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-mid)' }}>Benchmarks:</span>
            <span>{meta?.benchmarks.length ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-mid)' }}>Risk-free rate:</span>
            <span>{meta ? `${(meta.risk_free_rate * 100).toFixed(1)}% p.a.` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-mid)' }}>Last generated:</span>
            <span className="text-xs">{meta?.generated ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { data: meta } = useMeta()
  const desk = currentDesk()

  // DURING RENDER, not in an effect. Every section fetches inside its own
  // effect, which runs after this, so the data root is already correct by the
  // time any request goes out.
  setDataRoot(desk.dataPrefix || 'data')

  const [activeTab, setActiveTab] = useState(initialTab)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('mfrc_theme') as 'light' | 'dark') || 'dark',
  )

  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    // Switching tabs while scrolled halfway down used to drop you into the
    // middle of the next section. Jump — not smooth-scroll, which fights the
    // fade and takes longer than the transition itself.
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem('mfrc_theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const [isStatus, setIsStatus] = useState(window.location.pathname === '/status')
  useEffect(() => {
    const handler = () => setIsStatus(window.location.pathname === '/status')
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  if (isStatus) return <StatusPage />

  return (
    <div className="min-h-screen transition-colors duration-150"
         style={{ background: 'var(--bg-base)', color: 'var(--text-hi)' }}>
      <HeroHeader
        asOf={meta?.as_of ?? null}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        theme={theme}
        onChangeTheme={setTheme}
      />

      {/* The key makes React remount on a tab change, which replays the
          .view-enter animation so switching sections fades in rather than
          snapping. */}
      <main key={activeTab} className="pt-[120px] pb-12 view-enter">
        {activeTab === 'market-pulse' && <MarketPulse />}

        {/* Live Market first on the other two, so the day's context is read
            before anything is compared against it. */}
        {activeTab === 'quartile' && (
          <>
            <MarketPulseBar />
            <QuartileRanking />
          </>
        )}

        {activeTab === 'risk' && (
          <>
            <MarketPulseBar />
            <RiskReturns />
          </>
        )}

        {activeTab === 'watchlist' && (
          <>
            <MarketPulseBar />
            <Watchlist />
          </>
        )}

        {activeTab === 'whitelist' && (
          <>
            <MarketPulseBar />
            <WhitelistScreener />
          </>
        )}

        {activeTab === 'blacklist' && (
          <>
            <MarketPulseBar />
            <Blacklist />
          </>
        )}

        {activeTab === 'alerts' && (
          <>
            <MarketPulseBar />
            <AutoMailing />
          </>
        )}

        {activeTab === 'p2p' && <PointToPoint />}

        {activeTab === 'portfolio' && <PortfolioBuilder />}
      </main>

      <footer className="site-footer">
        🔒 {desk.footerName} — For Internal Research Use Only. Not for distribution.
        <br />
        <span style={{ opacity: 0.6 }}>
          Data sources: {desk.sources} — for internal research purposes only.
          {' · '}
          <a href="/status" style={{ color: 'var(--accent-a)', textDecoration: 'none' }}
             onClick={e => { e.preventDefault(); window.history.pushState({}, '', '/status'); setIsStatus(true) }}>
            Status
          </a>
        </span>
      </footer>
    </div>
  )
}

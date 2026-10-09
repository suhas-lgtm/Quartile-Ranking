// src/App.tsx — tab router and light/dark theme.
//
// Five sections, all open: Market Pulse, Quartile Ranking, Risk & Returns,
// Fund Signals and Whitelist Screener.
// There is no password gate in this build because there is nothing gated —
// the restricted sections are not present rather than hidden.

import { useState, useEffect } from 'react'
import HeroHeader      from './components/HeroHeader'
import MarketPulseBar  from './components/MarketPulseBar'
import DataHealthBanner from './components/DataHealthBanner'
import MarketPulse     from './sections/MarketPulse'
import QuartileRanking from './sections/QuartileRanking'
import Watchlist       from './sections/Watchlist'
import RiskReturns     from './sections/RiskReturns'
import WhitelistScreener from './sections/WhitelistScreener'
import Blacklist       from './sections/Blacklist'
import AutoMailing     from './sections/AutoMailing'
import PointToPoint    from './sections/PointToPoint'
import PortfolioBuilder from './sections/PortfolioBuilder'
import FundDetail      from './components/FundDetail'
import CompareFunds    from './sections/CompareFunds'
import FundScreener    from './sections/FundScreener'
import CalendarReturns from './sections/CalendarReturns'
import AumFlows        from './sections/AumFlows'
import IndustryFlows   from './sections/IndustryFlows'
import NewFundOffers   from './sections/NewFundOffers'
import Sidebar, { type DrawerKind } from './components/Sidebar'
import SifSection      from './sections/sif/SifSection'
import Dividends       from './sections/Dividends'
import PortfolioComparison from './sections/PortfolioComparison'
import ClientPlan from './sections/rahul/ClientPlan'
import Reallocation from './sections/rahul/Reallocation'
import { useMeta }     from './hooks/useData'
import { currentDesk } from './config/products'
import { setDataRoot } from './config/dataPaths'
import { spaceAllowed, spaceLabel, tabsForSpace, type SpaceId } from './config/spaces'

const TAB_STORAGE_KEY = 'mfrc_active_tab'
const SPACE_STORAGE_KEY = 'mfrc_space'

function initialSpace(): SpaceId {
  try {
    const saved = localStorage.getItem(SPACE_STORAGE_KEY)
    return saved && spaceAllowed(saved) ? saved : 'mf'
  } catch { return 'mf' }
}

/** The tab to open in a space: the one last used there, else its first. */
function tabFor(space: SpaceId): string {
  const tabs = tabsForSpace(space)
  let saved: string | null = null
  try { saved = localStorage.getItem(`${TAB_STORAGE_KEY}:${space}`) ?? (space === 'mf' ? localStorage.getItem(TAB_STORAGE_KEY) : null) }
  catch { /* storage unavailable */ }
  return saved && tabs.some(t => t.id === saved) ? saved : (tabs[0]?.id ?? 'market-pulse')
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

  const [space, setSpaceState] = useState<SpaceId>(initialSpace)
  const [activeTab, setActiveTab] = useState(() => tabFor(initialSpace()))
  const [drawer, setDrawer] = useState<DrawerKind | null>(null)
  const goTo = (s: SpaceId, tab?: string) => { setSpaceState(s); setActiveTab(tab ?? tabFor(s)) }
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('mfrc_theme') as 'light' | 'dark') || 'dark',
  )

  useEffect(() => {
    try {
      localStorage.setItem(SPACE_STORAGE_KEY, space)
      localStorage.setItem(`${TAB_STORAGE_KEY}:${space}`, activeTab)
    } catch { /* storage unavailable */ }
    // Switching tabs while scrolled halfway down used to drop you into the
    // middle of the next section. Jump — not smooth-scroll, which fights the
    // fade and takes longer than the transition itself.
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeTab, space])

  // The page starts just under the header, whose height depends on the width.
  useEffect(() => {
    const h = document.getElementById('app-header')
    if (!h) return
    const set = () => document.documentElement.style.setProperty('--header-h', `${h.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(h)
    return () => ro.disconnect()
  }, [])

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
        tabs={tabsForSpace(space)}
        spaceName={spaceLabel(space)}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        theme={theme}
        onChangeTheme={setTheme}
        space={space}
        onGoMutualFunds={() => goTo('mf')}
        onGoSif={() => goTo('sif')}
        onOpenDrawer={setDrawer}
      />
      <Sidebar kind={drawer} space={space} activeTab={activeTab} onPick={goTo} onClose={() => setDrawer(null)} />

      {/* The key makes React remount on a tab change, which replays the
          .view-enter animation so switching sections fades in rather than
          snapping. */}
      <main key={`${space}:${activeTab}`} className="pb-12 view-enter" style={{ paddingTop: 'calc(var(--header-h, 118px) + 10px)' }}>
        {/* NAVs or monthly holdings behind (scripts/data_health.py): a banner for everyone. */}
        <DataHealthBanner />
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

        {activeTab === 'compare' && <CompareFunds />}
        {activeTab === 'screener' && <FundScreener />}

        {activeTab === 'calendar' && <CalendarReturns />}

        {activeTab === 'aum' && <AumFlows />}

        {activeTab === 'industry' && <IndustryFlows />}

        {activeTab === 'nfo' && <NewFundOffers />}

        {activeTab === 'dividends' && <Dividends />}

        {activeTab === 'pcompare' && <PortfolioComparison />}
        {activeTab === 'rahul-plan' && <ClientPlan />}
        {activeTab === 'rahul-realloc' && <Reallocation />}

        {activeTab.startsWith('sif-') && <SifSection tab={activeTab} />}
      </main>

      {/* The fund page, opened by clicking any fund name (components/FundLink). */}
      <FundDetail />

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

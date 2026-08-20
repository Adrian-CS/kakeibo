import { useEffect, useState } from 'react'
import { StoreProvider, useCurrentMonth, useStore } from './state/store'
import { MonthView } from './views/MonthView'
import { StatsView } from './views/StatsView'
import { SavingsView } from './views/SavingsView'
import { SettingsView } from './views/SettingsView'
import type { AppData } from './lib/types'

type Tab = 'month' | 'stats' | 'savings' | 'settings'

const TABS: { id: Tab; icon: string }[] = [
  { id: 'month', icon: 'M3 4h10v9H3zM3 7h10M6 4v9' },
  { id: 'stats', icon: 'M3 13V8m3.5 5V4M10 13v-6m3.5 6V6' },
  { id: 'savings', icon: 'M2.5 5.5h11v7h-11zM2.5 5.5 8 2l5.5 3.5M10.5 9h1.5' },
  { id: 'settings', icon: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1' },
]

function TabIcon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

function Shell() {
  const { t } = useStore()
  const [monthId, setMonthId] = useCurrentMonth()
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash.includes('stats')
      ? 'stats'
      : window.location.hash.includes('savings')
        ? 'savings'
        : window.location.hash.includes('settings')
          ? 'settings'
          : 'month',
  )

  // el hash guarda pestana y mes: recargar o compartir el enlace vuelve al sitio
  useEffect(() => {
    const next = `#/${tab}/${monthId}`
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [tab, monthId])

  const label: Record<Tab, string> = {
    month: t('nav.month'),
    stats: t('nav.stats'),
    savings: t('nav.savings'),
    settings: t('nav.settings'),
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-2.5 pb-24 sm:px-4 sm:pb-6">
      {/* cabecera: en escritorio la navegacion vive aqui */}
      <header className="flex items-center justify-between gap-3 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-ink">{t('app.title')}</span>
          <span className="hidden text-xs text-muted sm:inline">{t('app.subtitle')}</span>
        </div>
        <nav className="no-print hidden gap-0.5 sm:flex" aria-label={t('app.title')}>
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              aria-current={tab === tb.id ? 'page' : undefined}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
                tab === tb.id ? 'bg-surface text-ink' : 'text-muted hover:text-ink-2'
              }`}
            >
              <TabIcon d={tb.icon} />
              {label[tb.id]}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'month' && <MonthView monthId={monthId} setMonthId={setMonthId} />}
        {tab === 'stats' && <StatsView monthId={monthId} />}
        {tab === 'savings' && <SavingsView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      {/* movil: barra inferior, al alcance del pulgar */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label={t('app.title')}
      >
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            aria-current={tab === tb.id ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
              tab === tb.id ? 'text-ink' : 'text-muted'
            }`}
          >
            <TabIcon d={tb.icon} />
            {label[tb.id]}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function App({ initial }: { initial?: AppData }) {
  return (
    <StoreProvider initial={initial}>
      <Shell />
    </StoreProvider>
  )
}

export default App

import { useState, useContext, useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { QueryClient, QueryClientProvider, QueryClientContext } from '@tanstack/react-query'
import { CiAdminProvider } from './CiAdminContext'
import { CiConfigProvider, useCiConfig, DEFAULT_CI_API_BASE } from './CiConfigContext'
import { CiBoardContent } from './pages/CiBoardContent'
import { DefaultFooter } from './DefaultFooter'
import type { DashboardSnapshot } from './api/types'

export interface CiBoardProps {
  /** Whether the viewer is an admin: sees private repos + actionable PR links. Host-computed. */
  adminSignal: boolean
  /** Origin of the CI backend snapshot API (no trailing slash). Defaults to '' (relative URLs — requires a same-origin /api/ proxy). Pass 'https://ci.fixportal.org' to reach the public FixPortal backend. */
  apiBase?: string
  /** Fetcher for guest (non-admin) snapshot requests. Use when the public endpoint requires auth headers (e.g. MSAL Bearer token). Falls back to a plain fetch of apiBase + /api/dashboard/snapshot when absent. */
  snapshotFetcher?: () => Promise<DashboardSnapshot | null>
  /** Optional stable key folded into the snapshot cache key when a custom fetcher is used. Set a distinct value per board/source when several boards share the host's QueryClient, so their cache entries don't alias. */
  snapshotCacheKey?: string
  /** Full URL the board fetches when the viewer is admin. The host's backend should proxy this to the CI backend's /api/dashboard/snapshot/admin endpoint, adding the X-Admin-Key header server-side so the shared secret never reaches the browser. When unset, admin viewers see the public (private-repo-stripped) snapshot. */
  adminSnapshotUrl?: string
  /** Alternative to adminSnapshotUrl for hosts that must attach auth headers (e.g. MSAL Bearer) to the admin snapshot request. Takes precedence over adminSnapshotUrl when both are supplied. */
  adminSnapshotFetcher?: () => Promise<DashboardSnapshot | null>
  /** Optional stable key folded into the admin snapshot cache key when adminSnapshotFetcher is used. Counterpart of snapshotCacheKey for the admin path. */
  adminSnapshotCacheKey?: string
  /** Brand mark for the header. Defaults to a plain text wordmark. */
  logo?: ReactNode
  /** Footer node. Defaults to a generic, brand-free footer. */
  footerSlot?: ReactNode
  /** Optional namespace suffix for localStorage keys to avoid collisions when multiple boards run on the same origin. */
  storageNamespace?: string
  /** Whether to show the theme switcher (Light / Dark / System) in the header. Defaults to true. */
  showThemeSwitcher?: boolean
}

function QueryClientSafeProvider({ children }: { children: ReactNode }) {
  const existingClient = useContext(QueryClientContext)
  // Create the fallback client unconditionally: a spare, unused QueryClient is
  // inert while a host client exists, and this removes the non-null assertion that
  // would otherwise pass a null client to QueryClientProvider if the host's own
  // provider ever disappeared after mount.
  const [localClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  if (existingClient) {
    return <>{children}</>
  }

  return (
    <QueryClientProvider client={localClient}>
      {children}
    </QueryClientProvider>
  )
}

// The board is style-free at the component level: consumers import the
// stylesheets explicitly -- `@fix-portal/ci-frontend/board.css` (always) and
// optionally `@fix-portal/ci-frontend/tokens.css` if they have no design system
// of their own. This keeps CSS out of the JS bundle and lets a host with its
// own tokens (e.g. the simulator) skip the vendored set.
type Theme = 'light' | 'dark' | 'system'

function ThemeSwitcher({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  // Namespace the theme key like the other storage hooks, so co-hosted boards
  // with distinct storageNamespace values don't clobber each other's preference.
  const { storageNamespace } = useCiConfig()
  const themeKey = storageNamespace ? `ci:theme:${storageNamespace}` : 'ci:theme'

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(themeKey)
      return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    // Apply the theme to the board's OWN container (.ci-page), not
    // document.documentElement. As a published embeddable component the board must
    // not overwrite the host page's <html data-theme> (nor fight a co-hosted board
    // over that single global slot). The attribute lives on .ci-page and is removed
    // with the board's subtree on unmount, so no explicit cleanup is required.
    const root = pageRef.current
    if (!root) return
    const applyTheme = () => {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
      } else {
        root.setAttribute('data-theme', theme)
      }
    }
    applyTheme()
    try {
      localStorage.setItem(themeKey, theme)
    } catch {
      // ignore (private mode / quota) — theme persistence is best-effort
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', applyTheme)
      return () => mediaQuery.removeEventListener('change', applyTheme)
    }
    return undefined
  }, [theme, themeKey, pageRef])

  return (
    <div className="ci-theme-select-container">
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="ci-theme-select"
        aria-label="Select theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  )
}

export function CiBoard({
  adminSignal,
  apiBase = DEFAULT_CI_API_BASE,
  snapshotFetcher,
  snapshotCacheKey,
  adminSnapshotUrl,
  adminSnapshotFetcher,
  adminSnapshotCacheKey,
  logo,
  footerSlot,
  storageNamespace,
  showThemeSwitcher = true,
}: CiBoardProps) {
  // Label reflects whether the board actually consumes a privileged data source,
  // not merely that a signal was passed — matches the toolbar scope descriptor.
  const effectiveAdmin = adminSignal && Boolean(adminSnapshotUrl || adminSnapshotFetcher)

  // The sticky toolbar+summary band freezes at top = the header's height. That
  // height varies with the host's logo, so measure it and publish the exact value
  // as --ci-header-h rather than guessing — a stale guess makes the band creep a
  // few px before it sticks. The CSS default (56px) covers first paint / SSR.
  const headerRef = useRef<HTMLElement>(null)
  // The theme switcher applies `data-theme` to this container, not <html>, so the
  // board's theme never leaks onto the host page.
  const pageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const publishHeight = () => {
      header.parentElement?.style.setProperty('--ci-header-h', `${header.offsetHeight}px`)
    }
    publishHeight()
    const observer = new ResizeObserver(publishHeight)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return (
    <CiConfigProvider value={{ apiBase, snapshotFetcher, snapshotCacheKey, adminSnapshotUrl, adminSnapshotFetcher, adminSnapshotCacheKey, storageNamespace }}>
      <QueryClientSafeProvider>
        <div className="ci-page" ref={pageRef}>
          <div className="ci-embed">
            <header ref={headerRef} className="ci-embed__header">
              <span className="ci-embed__lockup">
                {logo ?? <span className="ci-embed__wordmark-text">CI Dashboard</span>}
                <span className="ci-embed__descriptor">
                  CI Dashboard {effectiveAdmin ? '[Admin]' : '[Guest]'}
                </span>
              </span>
              {showThemeSwitcher && (
                <div style={{ marginLeft: 'auto' }}>
                  <ThemeSwitcher pageRef={pageRef} />
                </div>
              )}
            </header>
            <CiAdminProvider value={effectiveAdmin}>
              <CiBoardContent />
            </CiAdminProvider>
          </div>
          {footerSlot ?? <DefaultFooter />}
        </div>
      </QueryClientSafeProvider>
    </CiConfigProvider>
  )
}

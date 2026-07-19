import { useState, useEffect, useMemo } from 'react'
import type { RepositorySnapshot } from '../api/types'
import { useDashboardSnapshot } from '../hooks/useDashboardSnapshot'
import { useCollapseState } from '../hooks/useCollapseState'
import { useHideNoCi } from '../hooks/useHideNoCi'
import { useCiAdmin } from '../CiAdminContext'
import { useCiConfig } from '../CiConfigContext'
import { isNoCi } from '../lib/isNoCi'
import { computeSummary } from '../lib/computeSummary'
import { SummaryStrip } from '../components/SummaryStrip'
import { RepoBoard } from '../components/RepoBoard'
import { RepoSection } from '../components/RepoSection'
import { LegendRow } from '../components/LegendRow'
import { PullRequestStepper } from '../components/PullRequestStepper'
import { flattenOpenPrs } from '../lib/flattenOpenPrs'
import { formatRelativeTime } from '../lib/relativeTime'
import { useRepoFilters } from '../hooks/useRepoFilters'
import { applyRepoFilters } from '../lib/applyRepoFilters'
import type { Visibility } from '../lib/applyRepoFilters'
import { RepoFilterBar } from '../components/RepoFilterBar'

// Apply the Hide No-CI toggle to a repo list. Shared by the pre-early-return
// openPrs computation and the post-guard visibleRepos so the filter shape lives
// in one place.
function applyNoCiFilter(repos: RepositorySnapshot[], hidden: boolean): RepositorySnapshot[] {
  return hidden ? repos.filter(r => !isNoCi(r)) : repos
}

const KEY_PUBLIC = 'section:public'
const KEY_PRIVATE = 'section:private'

function buildRepoList(
  visibleRepos: RepositorySnapshot[],
  publicRepos: RepositorySnapshot[],
  privateRepos: RepositorySnapshot[],
  showGroups: boolean,
  isNoCiHidden: boolean,
  noCiHidEverything: boolean,
  collapse: ReturnType<typeof useCollapseState>,
  filtersActive: boolean,
  onClearFilters: () => void,
) {
  if (visibleRepos.length === 0) {
    // Hide No-CI alone has emptied the board: clearing filters cannot restore
    // anything, so don't offer a "Clear filters" affordance that wouldn't help —
    // name the real cause (the toggle lives in the toolbar). Checked before the
    // filtersActive branch so the combined state isn't mislabelled.
    if (noCiHidEverything) {
      return <div className="state-msg">All repositories are No-CI — hidden.</div>
    }
    if (filtersActive) {
      return (
        <div className="state-msg">
          No repositories match the active filters.{' '}
          <button type="button" className="state-msg__action" onClick={onClearFilters}>
            Clear filters
          </button>
        </div>
      )
    }
    if (isNoCiHidden) {
      return <div className="state-msg">All repositories are No-CI — hidden.</div>
    }
    return <div className="state-msg">No repositories found.</div>
  }
  if (showGroups) {
    return (
      <>
        <RepoSection
          label="Public"
          count={publicRepos.length}
          collapsed={collapse.isCollapsed(KEY_PUBLIC)}
          onToggle={() => collapse.toggle(KEY_PUBLIC)}
        />
        {!collapse.isCollapsed(KEY_PUBLIC) &&
          publicRepos.map(repository => (
            <RepoBoard
              key={repository.name}
              repository={repository}
              collapsed={collapse.isCollapsed(repository.name)}
              onToggle={collapse.toggle}
            />
          ))
        }
        <RepoSection
          label="Private"
          count={privateRepos.length}
          collapsed={collapse.isCollapsed(KEY_PRIVATE)}
          onToggle={() => collapse.toggle(KEY_PRIVATE)}
        />
        {!collapse.isCollapsed(KEY_PRIVATE) &&
          privateRepos.map(repository => (
            <RepoBoard
              key={repository.name}
              repository={repository}
              collapsed={collapse.isCollapsed(repository.name)}
              onToggle={collapse.toggle}
            />
          ))
        }
      </>
    )
  }
  return visibleRepos.map(repository => (
    <RepoBoard
      key={repository.name}
      repository={repository}
      collapsed={collapse.isCollapsed(repository.name)}
      onToggle={collapse.toggle}
    />
  ))
}

export function CiBoardContent() {
  const snapshot = useDashboardSnapshot()
  const collapse = useCollapseState()
  const hideNoCi = useHideNoCi()
  const filters = useRepoFilters()
  const isAdmin = useCiAdmin()
  const { adminSnapshotUrl, adminSnapshotFetcher } = useCiConfig()
  const hasAdminSource = Boolean(adminSnapshotUrl || adminSnapshotFetcher)
  const [stepperOpen, setStepperOpen] = useState(false)

  // Memos must precede early returns (Rules of Hooks). snapshot.data is the stable
  // dep — React Query structural sharing keeps it reference-equal across no-change
  // poll ticks, so these only recompute when data actually changes.
  const repositories = useMemo(() => {
    const repos = snapshot.data?.repositories ?? []
    return isAdmin ? repos : repos.filter(r => !r.private)
  }, [isAdmin, snapshot.data])
  const noCiFiltered = useMemo(
    () => applyNoCiFilter(repositories, hideNoCi.hidden),
    [repositories, hideNoCi.hidden],
  )
  // The Visibility filter's controls are admin-only (RepoFilterBar gates the
  // fieldset on isAdmin), but its effect is role-independent. A visibility
  // selection persisted from a prior admin session would otherwise blank a
  // signed-out viewer's board with no visible chip to undo it — so drop the
  // group for non-admins, who already see only public repos anyway.
  const effectiveFilters = useMemo(
    () => (isAdmin ? filters.filters : { ...filters.filters, visibility: new Set<Visibility>() }),
    [isAdmin, filters.filters],
  )
  const visibleRepos = useMemo(
    () => applyRepoFilters(noCiFiltered, effectiveFilters),
    [noCiFiltered, effectiveFilters],
  )
  const summary = useMemo(() => {
    if (isAdmin && !hideNoCi.hidden && !filters.isActive) return snapshot.data?.summary ?? []
    return computeSummary(visibleRepos)
  }, [isAdmin, hideNoCi.hidden, filters.isActive, snapshot.data, visibleRepos])
  const lastMergedPr = useMemo(() => {
    const raw = snapshot.data?.lastMergedPr ?? null
    return raw && visibleRepos.some(r => r.name === raw.repo) ? raw : null
  }, [snapshot.data, visibleRepos])

  // Computed before the early returns so nextPr and the stepper guard are
  // available regardless of snapshot state.
  const openPrs = flattenOpenPrs(visibleRepos)

  useEffect(() => {
    if (openPrs.length === 0 && stepperOpen) {
      const id = setTimeout(() => setStepperOpen(false), 0)
      return () => clearTimeout(id)
    }
    return undefined
  }, [openPrs.length, stepperOpen])

  if (snapshot.isPending) {
    return (
      <main className="dashboard-page dashboard-page--loading" key="loading">
        <div className="state-msg">Loading dashboard…</div>
        <div className="summary-panels dashboard__loading-panels" aria-hidden="true">
          {[0, 1, 2].map(panel => (
            <div className="summary-panel dashboard__loading-panel" key={panel}>
              <span className="dashboard__loading-line dashboard__loading-line--short" />
              <span className="dashboard__loading-line" />
              <span className="dashboard__loading-line" />
            </div>
          ))}
        </div>
      </main>
    )
  }

  if (snapshot.isError && !snapshot.data) {
    return (
      <main className="dashboard-page">
        <div className="state-msg state-msg--error">
          Dashboard unavailable. Retrying automatically.{' '}
          <button
            type="button"
            className="state-msg__action"
          onClick={async () => {
            await snapshot.refetch().catch(() => {})
          }}
          >
            Retry now
          </button>
        </div>
      </main>
    )
  }

  // 204 -> null: backend is up but has not produced a snapshot yet.
  if (!snapshot.data) {
    return (
      <main className="dashboard-page">
        <div className="state-msg">Waiting for the first refresh…</div>
      </main>
    )
  }

  const { refreshedAt } = snapshot.data
  // Non-admin viewers see only public repos; admin sees all. repositories and
  // visibleRepos are memoized above the early returns (hooks must not follow returns).
  // Compute the names list and the all-collapsed flag once — they were rebuilt
  // and re-traversed twice per render (the onClick and the button label).
  const noCiCount = repositories.filter(isNoCi).length
  const repoNames = visibleRepos.map(r => r.name)
  const hiddenCount = repositories.length - noCiFiltered.length
  const publicRepos = visibleRepos.filter(r => !r.private)
  const privateRepos = visibleRepos.filter(r => r.private)
  const showGroups = publicRepos.length > 0 && privateRepos.length > 0
  const sectionKeys = showGroups ? [KEY_PUBLIC, KEY_PRIVATE] : []
  const allCollapsibleKeys = [...repoNames, ...sectionKeys]
  const allCollapsed = collapse.allCollapsed(allCollapsibleKeys)
  const isScopeFiltered = filters.isActive || hideNoCi.hidden
  // The stepper opens at the head of this oldest-first list, so its first entry
  // is "next in queue" — derive it from visibleRepos (the Hide No-CI filter
  // applied) so the card and stepper never advertise a PR from a repo the board
  // is currently hiding. openPrs is computed above before the early returns.
  const nextPr = openPrs[0] ?? null

  // Hide No-CI removed every repo on its own (independent of the filter bar) —
  // drives the empty-state copy so "Clear filters" isn't offered when it can't help.
  const noCiHidEverything = hideNoCi.hidden && noCiFiltered.length === 0 && repositories.length > 0
  const repoListContent = buildRepoList(
    visibleRepos, publicRepos, privateRepos, showGroups, hideNoCi.hidden, noCiHidEverything, collapse,
    filters.isActive, filters.clear,
  )

  return (
    <main className="dashboard-page" key="dashboard" tabIndex={-1}>
      <div className="dashboard__sticky">
      <div className="dashboard__toolbar">
        <input
          type="search"
          className="repo-filter__search"
          placeholder="Filter repos..."
          aria-label="Filter repos by name"
          value={filters.filters.search}
          onChange={e => filters.setSearch(e.target.value)}
        />
        <span className="dashboard__refresh-state">
          <span className="dashboard__refreshed">
            <span className="live-dot" aria-hidden="true" />
            updated {formatRelativeTime(refreshedAt)}
          </span>
          {snapshot.isError && (
            <span className="dashboard__refresh-warning" role="status">
              refresh failed · retrying
            </span>
          )}
        </span>
      </div>
      <div className="dashboard__filter-row">
        <RepoFilterBar
          filters={filters.filters}
          isAdmin={isAdmin}
          hideSearch={true}
          onSearch={filters.setSearch}
          onToggleVisibility={filters.toggleVisibility}
          onToggleCiStatus={filters.toggleCiStatus}
          onToggleHasOpenPrs={filters.toggleHasOpenPrs}
        />
        <div className="dashboard__board-controls">
          {noCiCount > 0 && (
            <button
              type="button"
              className={`dashboard__hide-noci${hideNoCi.hidden ? ' dashboard__hide-noci--on' : ''}`}
              onClick={hideNoCi.toggle}
              aria-pressed={hideNoCi.hidden}
            >
              {hideNoCi.hidden ? `Show No-CI · ${hiddenCount} hidden` : 'Hide No-CI'}
            </button>
          )}
          <button
            type="button"
            className="dashboard__collapse-all"
            onClick={() => (allCollapsed ? collapse.expandAll() : collapse.collapseAll(allCollapsibleKeys))}
          >
            {allCollapsed ? '⊞ Expand all' : '⊟ Collapse all'}
          </button>
        </div>
      </div>
      <SummaryStrip
        summary={summary}
        onOpenPrs={isAdmin ? () => setStepperOpen(true) : undefined}
        lastMerged={lastMergedPr}
        nextPr={nextPr}
        ciTrend={snapshot.data.ciTrend ?? []}
      />
      <LegendRow />
      </div>
      <div className="dashboard__repo-scope">
        {snapshot.data.org}
        {isScopeFiltered
          ? (
            <> · <span className="dashboard__scope-count">
              {visibleRepos.length} of {repositories.length} repositories
            </span></>
          )
          : ` · ${isAdmin && hasAdminSource ? 'all repositories' : 'public repositories'}`
        }
      </div>
      <div className="repo-list">
        {repoListContent}
      </div>
      {stepperOpen && openPrs.length > 0 && (
        <PullRequestStepper prs={openPrs} onClose={() => setStepperOpen(false)} />
      )}
    </main>
  )
}

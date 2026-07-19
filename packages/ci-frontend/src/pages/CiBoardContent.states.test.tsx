import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot } from '../api/types'
import { CiAdminProvider } from '../CiAdminContext'
import { CiConfigProvider } from '../CiConfigContext'
import * as snapshotHook from '../hooks/useDashboardSnapshot'
import { CiBoardContent } from './CiBoardContent'

const snapshot: DashboardSnapshot = {
  refreshedAt: '2026-07-16T10:00:00Z',
  org: 'FixPortal',
  repositories: [
    {
      name: 'cached-repository',
      htmlUrl: '',
      private: false,
      workflows: [],
      pullRequests: [],
      metrics: null,
      deploys: [],
      packages: [],
    },
  ],
  summary: [],
  lastMergedPr: null,
}

function renderContent() {
  render(
    <CiConfigProvider value={{ apiBase: '' }}>
      <CiAdminProvider value={false}>
        <CiBoardContent />
      </CiAdminProvider>
    </CiConfigProvider>,
  )
}

function mockSnapshot(result: {
  data?: DashboardSnapshot | null
  isError: boolean
  refetch: ReturnType<typeof vi.fn>
}) {
  vi.spyOn(snapshotHook, 'useDashboardSnapshot').mockReturnValue({
    data: result.data,
    isPending: false,
    isError: result.isError,
    refetch: result.refetch,
  } as unknown as ReturnType<typeof snapshotHook.useDashboardSnapshot>)
}

describe('CiBoardContent failure states', () => {
  afterEach(() => vi.restoreAllMocks())

  it('offers an immediate retry when the first snapshot fails', async () => {
    const refetch = vi.fn()
    mockSnapshot({ isError: true, refetch })
    renderContent()

    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps cached data visible after a background refresh failure', () => {
    mockSnapshot({ data: snapshot, isError: true, refetch: vi.fn() })
    renderContent()

    expect(screen.getByText('cached-repository')).toBeInTheDocument()
    expect(screen.getByText('refresh failed · retrying')).toBeInTheDocument()
  })
})

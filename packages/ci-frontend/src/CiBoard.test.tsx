import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DashboardSnapshot } from './api/types'
import { CiBoard } from './CiBoard'

const snapshot: DashboardSnapshot = {
  refreshedAt: '2026-07-16T10:00:00Z',
  org: 'FixPortal',
  repositories: [
    {
      name: 'ci-frontend',
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

describe('CiBoard admin source gating', () => {
  beforeEach(() => localStorage.clear())

  it('stays guest-only when the admin signal has no privileged source', async () => {
    render(
      <CiBoard
        adminSignal={true}
        snapshotFetcher={async () => snapshot}
        storageNamespace="guest-source"
      />,
    )

    expect(await screen.findByText('ci-frontend')).toBeInTheDocument()
    expect(screen.getByText(/\[Guest\]/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Visibility' })).not.toBeInTheDocument()
  })

  it('enables admin presentation when a privileged source is configured', async () => {
    render(
      <CiBoard
        adminSignal={true}
        snapshotFetcher={async () => snapshot}
        adminSnapshotFetcher={async () => snapshot}
        storageNamespace="admin-source"
      />,
    )

    expect(await screen.findByText('ci-frontend')).toBeInTheDocument()
    expect(screen.getByText(/\[Admin\]/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Visibility' })).toBeInTheDocument()
  })
})

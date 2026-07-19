import { describe, expect, it } from 'vitest'
import type { DashboardSnapshot } from './types'

describe('DashboardSnapshot wire contract', () => {
  it('accepts the nullable and optional fields emitted by the backend', () => {
    const contract = {
      refreshedAt: '2026-07-16T10:00:00Z',
      org: 'FixPortal',
      repositories: [
        {
          name: 'ci-frontend',
          htmlUrl: 'https://github.com/FixPortal/fixportal-ci-frontend',
          private: false,
          workflows: [
            {
              name: 'CI',
              file: 'ci.yml',
              state: 'success',
              lastRun: {
                status: 'completed',
                conclusion: 'success',
                htmlUrl: 'https://github.com/FixPortal/fixportal-ci-frontend/actions',
                title: 'Align snapshot contract',
                runNumber: 42,
                branch: 'main',
                event: 'push',
                updatedAt: '2026-07-16T10:00:00Z',
                repository: null,
                workflowFile: 'ci.yml',
              },
            },
          ],
          pullRequests: [],
          metrics: null,
          deploys: null,
          packages: null,
          lastMergedPr: null,
        },
      ],
      summary: [],
      lastMergedPr: null,
      ciTrend: null,
      publicCiTrend: [
        {
          bucketStart: '2026-07-16T09:00:00Z',
          state: 'passing',
          isBackfilled: true,
        },
      ],
    } satisfies DashboardSnapshot

    expect(contract.repositories[0].deploys).toBeNull()
  })
})

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { DashboardSnapshot } from '@fix-portal/ci-frontend'

const snapshot = {
  refreshedAt: '',
  org: 'FixPortal',
  repositories: [
    {
      name: 'fixportal-ci-frontend',
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
            title: 'CI frontend audit',
            runNumber: 42,
            branch: 'main',
            event: 'push',
            updatedAt: '2026-07-16T09:00:00Z',
          },
        },
      ],
      pullRequests: [],
      metrics: {
        nloc: 4200,
        avgComplexity: 2.4,
        functionCount: 180,
        highComplexityCount: 1,
        computedAt: '2026-07-16T09:00:00Z',
      },
      deploys: [],
      packages: [],
    },
  ],
  summary: [
    { key: 'passing', count: 1 },
    { key: 'failing', count: 0 },
    { key: 'running', count: 0 },
    { key: 'no-ci', count: 0 },
  ],
  lastMergedPr: null,
  ciTrend: [],
} satisfies DashboardSnapshot

async function openDashboard(page: Page, responseDelay = 0, refreshedAt = new Date().toISOString()) {
  await page.route('**/api/dashboard/snapshot', async route => {
    if (responseDelay > 0) await new Promise(resolve => setTimeout(resolve, responseDelay))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...snapshot,
        refreshedAt,
        repositories: snapshot.repositories.map(repository => ({
          ...repository,
          workflows: repository.workflows.map(workflow => ({
            ...workflow,
            lastRun: workflow.lastRun ? { ...workflow.lastRun, updatedAt: refreshedAt } : null,
          })),
        })),
      }),
    })
  })
  await page.addInitScript(() => localStorage.setItem('ci:theme', 'light'))
  await page.goto('/')
  await expect(page.getByText('fixportal-ci-frontend')).toBeVisible()
}

async function installClsObserver(page: Page) {
  await page.addInitScript(() => {
    const state = window as Window & { __cls: number; __clsObserver: PerformanceObserver }
    state.__cls = 0
    state.__clsObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
        if (!shift.hadRecentInput) state.__cls += shift.value
      }
    })
    state.__clsObserver.observe({ type: 'layout-shift', buffered: true })
  })
}

test('fits the dashboard within a phone viewport', async ({ page }) => {
  // Windows reserves a 15px vertical scrollbar gutter inside a 390px window.
  await page.setViewportSize({ width: 375, height: 844 })
  await openDashboard(page)
  const documentWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client)
})

test('keeps cold-load CLS within the good threshold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installClsObserver(page)
  await openDashboard(page, 750)
  const cls = await page.evaluate(() => (window as Window & { __cls: number }).__cls)
  expect(cls).toBeLessThanOrEqual(0.10)
})

test('reserves the first viewport while the dashboard loads', async ({ page }) => {
  await page.route('**/api/dashboard/snapshot', async route => {
    await new Promise(resolve => setTimeout(resolve, 750))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...snapshot, refreshedAt: new Date().toISOString() }),
    })
  })
  await page.addInitScript(() => localStorage.setItem('ci:theme', 'light'))
  await page.goto('/')
  await expect(page.getByText('Loading dashboard…')).toBeVisible()
  const loadingHeight = await page.locator('main').evaluate(element => element.getBoundingClientRect().height)
  expect(loadingHeight).toBeGreaterThanOrEqual(720)
})

test('preserves the desktop dashboard', async ({ page }) => {
  const now = new Date('2026-07-16T10:00:00Z')
  await page.clock.install({ time: now })
  await openDashboard(page, 0, now.toISOString())
  await expect(page).toHaveScreenshot('dashboard-desktop.png', { animations: 'disabled', maxDiffPixelRatio: 0.017 })
})

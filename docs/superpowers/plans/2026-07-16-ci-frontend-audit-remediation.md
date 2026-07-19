# CI Frontend Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all seven findings in the 2026-07-16 CI frontend audit without changing the steady-state desktop experience above 720px.

**Architecture:** Apply narrow, existing-boundary fixes: responsive rules stay inside the current mobile breakpoint; `CiBoard` owns effective admin gating; `CiBoardContent` uses TanStack Query's existing data/refetch state; wire types mirror the backend; nginx and workflows are hardened in place. Playwright covers browser-only layout and CLS regressions while Vitest covers component behaviour and types.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, Playwright 1.61.1, Vite 8, nginx, GitHub Actions.

## Global Constraints

- No steady-state visual change above 720px.
- Never expose `X-Admin-Key` or any admin secret to browser code.
- Reuse existing tokens, components and TanStack Query state.
- Write one failing regression test before each behavioural production change.
- Configuration-only changes use actionlint, Docker/nginx and header smoke checks instead of invented test abstractions.
- Preserve the job name `Publish Image (GHCR)` for the CI dashboard lane classifier.

---

### Task 1: Browser regression harness, mobile reflow and stable loading

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `e2e/dashboard.spec.ts`
- Create: `e2e/dashboard.spec.ts-snapshots/dashboard-desktop-chromium-win32.png`
- Modify: `packages/ci-frontend/src/pages/CiBoardContent.tsx`
- Modify: `packages/ci-frontend/src/styles/board.css`

**Interfaces:**
- Consumes: relative `GET /api/dashboard/snapshot`, existing CSS tokens and `CiBoardContent` pending state.
- Produces: `npm run test:e2e`; mobile document-width and cold-load CLS gates.

- [ ] **Step 1: Add the browser-test dependency and script**

Run:

```text
npm install --save-dev --save-exact @playwright/test@1.61.1
```

Add root script:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Add deterministic Playwright configuration**

Create `playwright.config.ts` with one Chromium project, `testDir: './e2e'`, a
1280x800 default viewport, and this web server:

```ts
webServer: {
  command: 'npm run dev -w dashboard -- --host 127.0.0.1',
  url: 'http://127.0.0.1:5173',
  reuseExistingServer: !process.env.CI,
}
```

- [ ] **Step 3: Write browser tests before CSS/loading changes**

Create a single deterministic snapshot fixture in `e2e/dashboard.spec.ts`, route
`**/api/dashboard/snapshot`, set `ci:theme` to `light`, and add:

```ts
test('fits the dashboard within a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openDashboard(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('keeps cold-load CLS within the good threshold', async ({ page }) => {
  await installClsObserver(page)
  await openDashboard(page, 150)
  const cls = await page.evaluate(() => (window as Window & { __cls: number }).__cls)
  expect(cls).toBeLessThanOrEqual(0.10)
})

test('preserves the desktop dashboard', async ({ page }) => {
  await openDashboard(page)
  await expect(page).toHaveScreenshot('dashboard-desktop.png', { animations: 'disabled' })
})
```

- [ ] **Step 4: Capture the pre-change desktop baseline only**

Run:

```text
npx playwright test --grep "preserves the desktop dashboard" --update-snapshots
```

Expected: PASS and one committed Windows Chromium baseline.

- [ ] **Step 5: Verify the mobile and CLS tests fail for the audited reasons**

Run:

```text
npx playwright test --grep "phone viewport|cold-load CLS"
```

Expected: phone `scrollWidth > 390`; CLS greater than `0.10`.

- [ ] **Step 6: Implement the minimum responsive and loading changes**

In the existing `@media (max-width: 720px)` block, add border-box page sizing,
16px inline page/header padding, header wrapping, and a column filter row with
`margin-left: 0` on board controls.

Give the pending `main` a loading modifier, retain visible `Loading dashboard…`
copy, and add an `aria-hidden` three-panel skeleton using existing summary panel
classes/tokens. Its loading page reserves at least one viewport height so the
footer never enters the first paint.

- [ ] **Step 7: Verify browser tests pass without updating the desktop baseline**

Run:

```text
npx playwright test
```

Expected: all three tests PASS; desktop screenshot matches the pre-change file.

- [ ] **Step 8: Commit**

```text
git add package.json package-lock.json playwright.config.ts e2e packages/ci-frontend/src/pages/CiBoardContent.tsx packages/ci-frontend/src/styles/board.css
git commit -m "fix(ui): stabilize responsive dashboard"
```

### Task 2: Gate admin controls on a privileged source

**Files:**
- Create: `packages/ci-frontend/src/CiBoard.test.tsx`
- Modify: `packages/ci-frontend/src/CiBoard.tsx`

**Interfaces:**
- Consumes: `adminSignal`, `adminSnapshotUrl`, `adminSnapshotFetcher`.
- Produces: one `effectiveAdmin` boolean shared by the header and `CiAdminProvider`.

- [ ] **Step 1: Write the failing component test**

Render `CiBoard` with `adminSignal={true}` and only a guest `snapshotFetcher`.
After the snapshot loads, assert `[Guest]` is present and the Visibility group is
absent. Add a companion positive assertion that an `adminSnapshotFetcher` shows
`[Admin]` and the Visibility group.

- [ ] **Step 2: Verify RED**

Run:

```text
npx vitest run packages/ci-frontend/src/CiBoard.test.tsx
```

Expected: the no-admin-source case fails because Visibility is rendered.

- [ ] **Step 3: Implement the shared gate**

In `CiBoard`, derive:

```ts
const effectiveAdmin = adminSignal && Boolean(adminSnapshotUrl || adminSnapshotFetcher)
```

Use `effectiveAdmin` in the descriptor and `CiAdminProvider` value. Do not change
the public props or standalone query-parameter persistence.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test, then:

```text
git add packages/ci-frontend/src/CiBoard.tsx packages/ci-frontend/src/CiBoard.test.tsx
git commit -m "fix(auth): gate admin controls on source"
```

### Task 3: Preserve stale data and provide explicit error recovery

**Files:**
- Create: `packages/ci-frontend/src/pages/CiBoardContent.states.test.tsx`
- Modify: `packages/ci-frontend/src/pages/CiBoardContent.tsx`
- Modify: `packages/ci-frontend/src/styles/board.css`

**Interfaces:**
- Consumes: `useDashboardSnapshot()` fields `data`, `isPending`, `isError`, `refetch`.
- Produces: first-load Retry action and cached-data refresh warning.

- [ ] **Step 1: Write failing state tests using the established hook-spy pattern**

Mock `useDashboardSnapshot` and assert:

```ts
it('offers an immediate retry when the first snapshot fails', async () => {
  // isError true, data undefined, refetch vi.fn()
  // click Retry now; expect refetch called once
})

it('keeps cached data visible after a background refresh failure', async () => {
  // isError true with snapshot data
  // expect repo visible and "refresh failed · retrying" visible
})
```

- [ ] **Step 2: Verify RED**

Run the new test file. Expected: no Retry button and cached data is replaced by
the current error branch.

- [ ] **Step 3: Implement the minimum branch changes**

- make the terminal error return conditional on `snapshot.isError && !snapshot.data`;
- add `Retry now` calling `void snapshot.refetch()`;
- when data exists and `isError` is true, render a muted warning beside the
  refreshed indicator while leaving the board intact.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused tests, then:

```text
git add packages/ci-frontend/src/pages/CiBoardContent.tsx packages/ci-frontend/src/pages/CiBoardContent.states.test.tsx packages/ci-frontend/src/styles/board.css
git commit -m "fix(ui): retain dashboard during refresh errors"
```

### Task 4: Align the exported snapshot contract

**Files:**
- Create: `packages/ci-frontend/src/api/types.contract.test.ts`
- Modify: `packages/ci-frontend/src/api/types.ts`

**Interfaces:**
- Consumes: backend `DashboardModels.cs` JSON shape.
- Produces: accurate public TypeScript wire contract.

- [ ] **Step 1: Write the compile-time contract test**

Create a representative object using `satisfies DashboardSnapshot` that includes
`repository`, `workflowFile`, repository `lastMergedPr`, `isBackfilled`,
`publicCiTrend`, and `deploys: null`, `packages: null`.

- [ ] **Step 2: Verify RED**

Run the focused test. Expected: TypeScript transform fails on unknown fields or
null collection assignment.

- [ ] **Step 3: Align the types**

Add the omitted optional/null properties and change server-nullable collections
to `JobSignal[] | null`. Keep runtime consumers unchanged because they already
coalesce null collections.

- [ ] **Step 4: Verify GREEN and commit**

Run focused test plus library typecheck, then:

```text
git add packages/ci-frontend/src/api/types.ts packages/ci-frontend/src/api/types.contract.test.ts
git commit -m "fix(api): align dashboard snapshot types"
```

### Task 5: Harden the standalone nginx image

**Files:**
- Modify: `nginx.conf.template`

**Interfaces:**
- Consumes: Vite's emitted static assets and same-origin `/api/` proxy.
- Produces: CSP, MIME-sniffing, referrer, framing and device-capability protections.

- [ ] **Step 1: Add the minimum response-header baseline**

Use `add_header ... always` for:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

- [ ] **Step 2: Validate with the real container**

Build the image, run it against the live public backend on a spare local port,
request `/`, and assert the four headers are present. Run `nginx -t` inside the
container. HSTS is intentionally absent because TLS terminates upstream.

- [ ] **Step 3: Commit**

```text
git add nginx.conf.template
git commit -m "fix(security): harden dashboard responses"
```

### Task 6: Normalize and pin CI/release automation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/mutation.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: current house CI standard and these verified GitHub tag commits.
- Produces: immutable, actionlint-checked CI with automated pin updates.

Verified pins:

```text
actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7
actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
raven-actions/actionlint@3d39aea434753780c3b3d4a1a31c854b4dbf49d7 # v2
useblacksmith/setup-docker-builder@47a5d0102cc44712a17a633c2599f755008cc40e # v1
docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9 # v3
useblacksmith/build-push-action@fb9e3e6a9299c78462bfadd0d93352c316adc9b8 # v2
```

- [ ] **Step 1: Normalize workflow triggers, concurrency and toolchain**

Use Node 24, add actionlint after checkout in every job, add all-branch/tag/manual
CI triggers, use branch-only cancellation for non-main work, and remove the
`npm@latest` upgrade. Keep privileged jobs ref-gated and preserve job names.

- [ ] **Step 2: Add browser regression execution to CI**

After existing builds, install Chromium with Playwright and run
`npm run test:e2e`.

- [ ] **Step 3: Add Dependabot**

Create weekly Monday 06:00 Europe/London grouped updates for root npm and
GitHub Actions with house commit prefixes.

- [ ] **Step 4: Validate and commit**

Run:

```text
actionlint .github/workflows/*.yml
```

Then commit all four files with:

```text
git commit -m "ci: pin and validate automation"
```

### Task 7: Full verification and living-audit closure

**Files:**
- Modify: `docs/audit/ci-frontend-2026-07-16/README.md`
- Add: after-remediation screenshots under `docs/audit/ci-frontend-2026-07-16/screenshots/`

**Interfaces:**
- Consumes: all remediation commits and test evidence.
- Produces: closed audit ledger with reproducible proof.

- [ ] **Step 1: Run the complete local gate**

```text
npm run lint
npm run test
npm run typecheck -w @fix-portal/ci-frontend
npm run build:lib
npm run build:app
npm run test:e2e
npm audit --omit=dev
actionlint .github/workflows/*.yml
```

- [ ] **Step 2: Re-run browser audit**

Use the local standalone app with a deterministic/public snapshot and capture:

- 390x844 after-remediation mobile view;
- 1280x800 desktop light view;
- first-load and failure recovery states;
- standalone `?admin=true` proving guest controls stay guest-only.

Confirm no page/console errors and desktop composition matches the baseline.

- [ ] **Step 3: Update the living audit**

For CI-UI-001 through CI-CI-007, retain the original finding and add a closure
block containing status, commit(s), exact test proof and after evidence. Update
the executive summary, recommendation table and action ledger. Do not erase the
original evidence.

- [ ] **Step 4: Validate document and commit**

Run `git diff --check`, validate the Mermaid diagram with pinned Mermaid CLI
11.16.0, verify every linked evidence file exists, then:

```text
git add docs/audit/ci-frontend-2026-07-16
git commit -m "docs(audit): close CI frontend findings"
```


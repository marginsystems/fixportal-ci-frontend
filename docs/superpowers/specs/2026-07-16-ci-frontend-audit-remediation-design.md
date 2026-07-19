# CI frontend audit remediation — design

**Date:** 2026-07-16
**Component:** `@fix-portal/ci-frontend` and standalone dashboard
**Status:** Approved

## Problem

The 2026-07-16 audit found seven issues: phone-width horizontal overflow,
standalone admin controls without an admin source, poor initial-load layout
stability, an unhelpful snapshot failure state, frontend/backend DTO drift,
missing browser hardening headers, and mutable CI/release inputs.

The desktop dashboard is already visually strong. Remediation must preserve its
steady-state appearance at widths above 720px.

## Goal

Close all seven findings with the smallest root-cause changes, add focused
regression checks, and update the living audit with before/after evidence.

## Constraints

- No steady-state desktop layout, spacing, colour, typography or hierarchy
  changes above 720px.
- No admin secret may enter browser code or configuration.
- Existing component and Vitest patterns are reused; no new abstraction layer.
- Browser hardening applies to the standalone nginx image, not library hosts.
- CI follows the current FixPortal house standard and preserves the dashboard's
  package-lane job names.
- Package versioning and publishing are separate release work.

## Approaches considered

### 1. Surgical remediation (selected)

Scope responsive CSS to the existing narrow breakpoint, gate admin behaviour at
the shared `CiBoard` boundary, keep stale query data visible after background
errors, align the exported DTO, and harden the existing nginx/workflow files.

This closes each root cause with few files and leaves the established desktop
surface alone.

### 2. Broad dashboard redesign

Rebuild the toolbar, summary strip and responsive grid around new primitives.
This could produce a cleaner mobile-first system, but it risks unnecessary
desktop changes and expands review scope far beyond the findings.

### 3. Configuration-only pass

Fix CI pins, headers and DTOs while deferring UI findings. This is lowest risk
but leaves the two user-visible defects and the poor layout-shift score open.

## Design

### Responsive layout

At `max-width: 720px` only:

- make `.dashboard-page` border-box so `width: 100%` includes its padding;
- reduce page/header inline padding from 24px to the existing 16px token;
- allow the header to wrap;
- stack `.dashboard__filter-row` so the already-wrapping filter bar and board
  controls each receive the full row;
- remove the controls' desktop-only auto margin.

No selector outside the media query changes desktop geometry. Acceptance is no
document-level horizontal scroll at 320, 390, 560 and 720px, with an unchanged
desktop reference screenshot at 1280px.

### Admin-source gating

`CiBoard` derives one effective boolean:

```text
effectiveAdmin = adminSignal && Boolean(adminSnapshotUrl || adminSnapshotFetcher)
```

The same value drives both the header label and `CiAdminProvider`. This removes
the contradictory `[Guest]` plus Private-controls state for every library host,
not only the standalone app. The standalone `?admin=true` preference may remain
harmlessly persisted, but it has no effect until a privileged fetch source is
actually configured.

### Snapshot error recovery

The board distinguishes first-load failure from background refresh failure:

- error with no snapshot: show `Dashboard unavailable. Retrying automatically.`
  and a native Retry button wired to `snapshot.refetch()`;
- error with cached snapshot: continue rendering the last good dashboard and
  add a compact status message near the refreshed timestamp;
- successful and loading states retain their existing appearance except for the
  loading geometry described below.

This uses TanStack Query's existing state and refetch function; no new state
store or retry mechanism is added.

### Initial-load stability

The pending branch renders the existing dashboard page and a lightweight,
non-animated skeleton shaped like the three summary panels. It uses existing
surface, border, radius and spacing tokens and is hidden from assistive
technology; the adjacent live-region text remains `Loading dashboard…`.

This changes only the short first-load phase. A production-like browser profile
must confirm CLS at or below 0.10; if the skeleton does not achieve that, the
individual layout-shift sources are traced before further CSS is added.

### DTO parity

`api/types.ts` is aligned to the backend wire record:

- add the five currently omitted properties;
- mark server-nullable collections nullable;
- keep properties unused by the board optional where older persisted snapshots
  may omit them.

A focused contract-shape test uses a checked-in representative object typed
with `satisfies DashboardSnapshot`. It guards frontend nullability and field
availability without introducing schema generation machinery. Full OpenAPI
generation remains unnecessary until this endpoint grows or additional clients
need it.

### Standalone browser headers

`nginx.conf.template` adds the minimum static-SPA baseline:

- `Content-Security-Policy` with same-origin scripts, styles, assets and API
  connections, plus `object-src 'none'`, `base-uri 'none'` and
  `frame-ancestors 'none'`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- a restrictive `Permissions-Policy` for unused device capabilities.

HSTS remains at the TLS terminator because the documented container listens on
plain HTTP 8080.

### CI and release reproducibility

Normalize the existing workflows rather than replacing them:

- use the current house action versions (`checkout@v7`, `setup-node@v6`,
  `upload-artifact@v7`, `raven-actions/actionlint@v2`);
- add actionlint as the first validation action in each job;
- use Node 24;
- remove the `npm@latest` upgrade and use the npm version bundled with the
  workflow's pinned Node 24 toolchain;
- add the no-deploy concurrency policy to build/release workflows while keeping
  the image-publish job name unchanged;
- add or align Dependabot for npm and GitHub Actions if no existing file covers
  them.

Third-party action references are resolved to reviewed immutable commit SHAs in
the implementation plan where GitHub's current SHAs can be verified. Version
comments remain beside SHA pins.

### Regression coverage

Existing Vitest component tests cover admin gating, error recovery and DTO
shape. A minimal Playwright smoke test is justified for the two behaviours
jsdom cannot measure: document horizontal overflow and cold-load CLS. It runs at
phone and desktop widths against a deterministic snapshot response.

Desktop acceptance is explicit: the 1280px screenshot must have no intentional
visual change. Mobile and loading screenshots replace the audit's before images
with paired after evidence.

## Interface intent

- **Human:** an operator scanning CI health quickly, often leaving the board open.
- **Task:** find failing/running work and open PRs without fighting the layout.
- **Feel:** dense, calm and terminal-like; existing hierarchy remains authoritative.
- **Focal point:** summary health and review work, unchanged on desktop.
- **Palette/depth/type:** existing tokens and borders only; no new colour, shadow,
  typeface or radius.
- **Spacing:** existing 4px scale; mobile uses the existing 16px spacing token.

## Testing and verification

Each behavioural change follows red-green TDD. Configuration changes are checked
with the narrowest available parser/runtime command, then the complete gate runs:

```text
npm run lint
npm run test
npm run typecheck -w @fix-portal/ci-frontend
npm run build:lib
npm run build:app
```

Additional checks:

- actionlint for all workflows;
- nginx configuration/container smoke test when Docker is available;
- Playwright phone overflow, desktop screenshot and CLS checks;
- live guest walkthrough in light/dark themes;
- audit document link and Mermaid validation.

## Audit closure

The living audit keeps the original findings and evidence, then records for each
ID: remediation commit, changed surface, automated proof, browser proof and
status `closed`. Any item that cannot meet its acceptance criterion remains open
with the measured blocker; it is not marked complete based on code inspection.

## Out of scope

- Redesigning desktop cards, toolbar, summary hierarchy or theme.
- Putting the admin key in frontend environment variables.
- Adding SSR or preloading the snapshot into HTML.
- Publishing a new npm package version or deploying the image.
- Replacing TanStack Query, Vitest, Vite or nginx.

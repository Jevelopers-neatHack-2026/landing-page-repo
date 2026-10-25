# Static artifact handoff proposal (LP-01.C)

Contract identifier: `ticketstub.landing-artifact/1`. This is a local proposal, not an owner-approved application integration. Its original comparison snapshot is landing `1d8379d1c5b0cb89ef869ea2cc7358886c9cf274` and host `388005240aa62374d49f709afc300adb5e98cd98`; this repository's current main is `dda1b5d48e71ed9c111b82111676b7ef033fe5ef`. The host snapshot reviewed for this update is `getticketstub.com` main `138e4b9019c0f5a55ad5e3f586d129216b680e4d`; its [current route inventory](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/138e4b9019c0f5a55ad5e3f586d129216b680e4d/docs/architecture/routes.md) describes the app-owned root. App implementation owner recorded in GT-01 is @lmvdz; affected reviewer roles are application technical lead and Product and frontend. No new approval receipt is recorded by this document.

## Artifact and URL rules

`node scripts/build.mjs` clears/rebuilds `dist/site/`, containing only byte-identical `index.html`, recursively copied reviewed asset file types from `site/assets/`, and `manifest.json`. The manifest records byte length and SHA-256 for each payload file in stable path order; it has no timestamps or absolute checkout paths. The manifest's own SHA-256 is the artifact inventory identity; retain it with the source commit and Node version in a review/release receipt. No docs, readmes, archive, markdown handoffs, zip, `.git` or tooling are copied. Symlink/hidden asset entries and unexpected asset types fail the build. These checks do not approve asset rights or guarantee that every permitted binary/JSON file is free of private data; LP-04/EVAL-04 review remains required.

The local artifact mounts at `/`, and existing relative `assets/...` references resolve to `/assets/...`. It is not a subpath export: nested base paths would change URL resolution. There is no HTML rewrite or source replacement in this build. `manifest.json` is handoff metadata and is not served by the preview.

Artifact validation requires a regular artifact root and `assets/` directory,
regular `index.html` and `manifest.json` files, and regular nested assets. A
symlink to matching bytes is rejected: the handed-off directory must carry its
own payload and manifest. These are static tree checks under the exclusive
writer contract below, not protection against concurrent path replacement.

**Current host distinction:** at host main `138e4b9019c0f5a55ad5e3f586d129216b680e4d`, `/` renders a host-owned React/component and script port of the page source, with the app's `StudioStart` section inserted after the hero. The host already serves app-owned assets beneath `/landing/`, including `/landing/ticketstub.gltf.json`, `/landing/flight.json`, and font files under `/landing/fonts/` referenced by its [landing script](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/138e4b9019c0f5a55ad5e3f586d129216b680e4d/src/customer/landing/landing.script.ts) and [landing stylesheet](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/138e4b9019c0f5a55ad5e3f586d129216b680e4d/src/customer/landing/landing.css). The host does not import this repository as a package or serve this repository's `dist/site/` artifact; the porting comment and shared `/landing/` URL prefix do not prove byte identity, standalone-artifact adoption, or owner acceptance. The earlier proposal to mount this standalone artifact at the host root is historical; the host root remains app-owned. This proposal describes only the separately built standalone artifact.

**Unresolved artifact handoff:** this artifact uses `/assets/...` URLs and includes its own local intake. Do not copy it over the host root or public directory as-is. If the standalone artifact itself is to be integrated, the owners must choose a compatible route and artifact adapter; agree asset URL rewrite/mount, intake ownership, script/style isolation, CSP/CDN allowances and rebuild/rollback; then pin both revisions and perform real host tests. No app files are changed here.

## Local build writer contract

Builds require a trusted checkout with exclusive control of the source tree,
`dist/`, and their ancestry. Concurrent mutation by unrelated or hostile processes
is unsupported. Do not build in a shared writable tree or let a watcher, editor,
cleanup job or other process rename these paths during a build. Use separate
checkouts for independent writers. Directory preflight rejects existing symlinks
and files; it is not atomic with later removal/writes and is **not a filesystem
security boundary** against a process that ignores the contract.

Every `buildSite` call acquires the same repository-wide `.landing-build.lock/`
using atomic directory creation, before inspecting or mutating source/output.
Checkout aliases resolve to the same lock. A second cooperating builder fails
immediately, even for a different output directory. Local code that deliberately
mutates source/output paths must use `withBuildLock(repository, async () => { ... })`
from `scripts/build.mjs` and await all its work before returning. Do not call
`buildSite` inside that callback: the lock is deliberately non-reentrant.
The CLI, validator and withdrawal builder all use `buildSite`.

The lock covers only the build operation. Serialize complete validation, preview
capture and withdrawal commands as well: a later build can invalidate a reader's
artifact after its build lock is released. Run the full Node suite with
`node --test --test-concurrency=1 tests/*.test.mjs`, without another build or
validation process using the same checkout.

Normal completion and exceptions release the lock. A killed process may leave
it behind; there is no automatic stale-lock recovery or timeout takeover. Stop
all writers and confirm exclusive checkout ownership before manually removing
a stale empty lock directory. Never delete an active lock. The lock does not
restrict OS permissions, block noncooperating writers, prevent ancestor swaps
by such writers, or make path-based filesystem operations race-free. Such
writers can still reproduce LP-REVIEW-001; they require isolation outside this
build tool. Tests establish cooperative exclusion and static-path rejection,
not containment against hostile concurrent mutation.

## Route isolation and error behavior

The preview binds to `127.0.0.1`, serving `/`, `/index.html`, and files below `/assets/` only. It serves correct local content types with `Cache-Control: no-store`, supports GET/HEAD, rejects malformed/traversal paths, returns 405 for other methods and 404 for unknown/public/app paths. There is no SPA fallback and no directory listing. It is a development preview, not a production hosting implementation.

The host retains all its existing route precedence, including `/make`, `/new`, `/studio/[id]`, `/wall`, commerce/share/organizer/account routes, `/admin/**`, `/api/**`, `/signin/**`, `/claim/**`, `/_next/**`, `/brand/**`, `/privacy`, `/terms`, and the `/map` → `/help` redirect. Unknown routes and error boundaries remain host-owned. No catch-all rewrite to this landing document is proposed.

Foundation HTTP tests load `/` and every existing asset, reject unknown routes, and inject synthetic response sentinels for `/make`, `/signin/confirm`, `/api/health` to verify that host-like handlers have precedence. Those route names come from actual host source; the sentinels are not host/app-owner fixtures. Tests do not run the Next application, exercise auth/API behavior or prove production route isolation. Owner-supplied fixtures and actual-host smoke are required to satisfy LP-01.C.

## Updates, cache and rollback

1. Pin the landing source commit and Node version; clean-build and run the applicable required suites. Keep `manifest.json` and its SHA-256 alongside evidence outside the public site.
2. Compare manifests to identify changes; review content and asset approval, and coordinate any path/route/cache change with the host owner.
3. After approval, the host owner selects the adapter/serving behavior and atomically switches a complete, pinned release. Do not merge files from unrelated versions.
4. As assets keep stable filenames rather than content hashes, proposed production cache behavior is revalidation (`Cache-Control: no-cache`) for HTML and assets; do not grant immutable caching to these names. Actual headers remain a host decision.
5. Roll back by restoring the prior complete artifact plus its host adapter/source revision and revalidating its manifest and routes. Keep the previous bytes and digest; a branch name alone is insufficient. No publication, provider work or rollback deployment is executed by this PR.

App-owner approval, product approval, browser screenshots, an exact adapter for this standalone artifact, acceptance of a standalone-artifact handoff into any host path (including the host's existing `/landing/` area), and real app/auth/API smoke remain unresolved. The observed app-owned `/landing/` asset paths do not establish that `dist/site/` is served or accepted. Foundation success changes none of the central acceptance states.

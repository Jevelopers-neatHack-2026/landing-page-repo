# landing-page-repo responsibility and handoff

**Repository role:** Source and offline tooling for a standalone static product-introduction page. **Accountable role:** Product and frontend. **Observed source:** main at `dda1b5d48e71ed9c111b82111676b7ef033fe5ef`, audited 2026-10-12.

## Responsibility

Maintain the single-page experience that introduces the product through illustrative copy, locally editable examples, static artwork and a navigation path into the application. Keep this page's public content separate from the authenticated ticket design, account, approval and ordering flows. Every product claim and asset remains subject to its own evidence and publication review.

The current page source is site/index.html, with local media and model data under site/assets/. Copy, calls to action and metadata have machine-readable source files under src/content/, while the page itself remains a standalone HTML document. Build, preview and validation commands are under scripts/; integration decisions and handoff requirements are under integration/; review records and claim evidence are under review/. The artifact builder copies a static output to dist/site/. This repository has no application framework or package install step.

## Current boundary

The built artifact is a local handoff product and preview target; it is not currently mounted into getticketstub.com. The host now serves an app-owned landing experience at `/` and its source comment identifies the landing repository's `site/index.html` as the porting source. The host keeps its own component, script, markup and media; the comment does not establish byte identity, package use, artifact serving or owner acceptance. The separately built artifact still uses root-relative `/assets/...` references and its own local intake, so it cannot be copied under `/landing/` without an agreed URL and isolation adapter. See the current application [architecture companion](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges), and the maintained static-output proposal and runtime decision for the distinct artifact handoff.

The page's current local interactions do not make a real order, verify event facts, submit typed text to the studio, or demonstrate physical printing or shipping. The studio link is navigation only. Claim, image-rights, privacy, destination and full release checks remain separate gates; successful local artifact validation does not satisfy them.

## Owned source and supporting records

- site/index.html and site/assets/: page and its local static resources.
- src/content/: structured copy, CTA and metadata inputs consumed by local validators.
- scripts/build.mjs, scripts/preview.mjs, scripts/validate-landing and scripts/suites/: artifact build, local HTTP preview and validation dispatcher.
- integration/: proposed host interface, route inventory, asset/mount constraints and policy decisions.
- review/: claim inventory, example mapping, privacy inventory and dated source/deployment observations.
- archive/, markdowns/, and the retained ZIP: historical or source-review material; not copied into the current static artifact.

## Validation and contributors

Use the exact Node version recorded in .nvmrc when reproducing the documented local checks. The foundation suite and scroll test run locally without provider calls. The full validator's default release mode requires all issue-defined content, CTA, proof, UX, brand, privacy, metadata and governance suites; draft passes and foundation checks must retain their narrower meaning. A recorded deployment inspection is a dated receipt, not a fresh deployment identity check.

Before changing public copy, links, assets, analytics, form behavior, or artifact paths, check the local privacy and content evidence and obtain the approvals required by the live issue and master acceptance checklist. Do not place credentials, customer information, unreviewed private material, or provider payloads in public output.

## Architecture and acceptance sources

- [Current application architecture and integration state](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges): current source-backed host behavior and cross-repository integration modes.
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md): immutable dated design intent, not the current implementation.
- [Local acceptance view](ACCEPTANCE.md) and the [master integration-evals checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning/acceptance-checklist.md): the latter owns acceptance state and evidence.
- [Organization contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md): read with local agent and security instructions.


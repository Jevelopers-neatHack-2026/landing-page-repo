# Maker focus follows native scroll state

Refs #17, #5, #7, #9 and #12. This is a local source repair and deterministic regression record. Browser qualification, publication and accountable acceptance remain separate.

## Problem and evidence boundary

The completed browser matrix on published `ee16f8a49e5039ee8d41d3fb0a0be9aeb4b98ec5` recorded normal and short-desktop maker-focus failures after each had passed all 14 native scrolling checks. The normal failure retained focus on an anchor with the document ready, renderer progress 100 and no observed wheel/touch cancellation during maker navigation. The original observation did not capture the board rectangle, `finale.inert` or ancestor visibility at failure. It proves missing focus, but does not establish the exact internal state or attribute the failure to a resource abort.

The existing source depended on two animation-frame paths: `boardState` set the maker's visibility/inert state from the renderer or static animation loop, while `focusMaker` polled that potentially stale state via another animation-frame callback and stopped after 2500 milliseconds. Deterministic checks of the actual source reproduce a reached but inert maker when those frames do not execute. These tests model the timing dependency; they do not replay the original browser process.

## Scoped repair

Runtime implementation revision: `058d3617e16c0fe434153608b74f5403ffdc5556`, based on published `ee16f8a49e5039ee8d41d3fb0a0be9aeb4b98ec5`. Repaired page SHA-256: `c92ab9f83dff2b15457617797147e7b7e2063cd1a7395a12bbab357d215df01a`.

Native scroll and resize events now synchronize the board's visibility and inert state from its measured geometry independently of decorative animation frames. A single pending maker-focus request follows those events. Its 2500-millisecond idle deadline rechecks actual geometry before expiring; continued native scrolling refreshes the idle deadline. Off-wall geometry keeps the maker hidden and inert.

Success, expiry, a newer anchor, wheel, touch, pointer or keyboard input removes the pending request's listeners and timer. Cancellation does not prevent the input event's default behavior. Native `scrollTo` behavior and `ev.focus()` scrolling remain in use. There is no new external request, data collection, style, copy, asset or destination change.

The privacy VM journey now executes the actual shared board-state section with its existing forbidden network/storage/logging surfaces. The routine UX suite runs the new maker-focus regressions alongside the existing scroll regressions; its isolated fixture carries both test files.

Independent review of that first implementation found an evidence-binding gap in the UX dispatcher: dedicated historical source overrides could redirect its child regression tests away from the built candidate. The [original REQUEST_CHANGES finding](source-binding/review-request-changes-058d361.json) and [independent real-built reproduction](independent-review-058d361/source-selection-results.json) are retained. Checker correction `34ddae6139fc6628bf7c20568b99d3dd554d818a` clears both `MAKER_FOCUS_TEST_HTML` and `SCROLL_TEST_HTML` from routine validation, while direct historical test commands keep their explicit controls. Separate negative cases remove the candidate’s native board or rail scroll listener and verify that a clean historical override cannot produce a pass. The runtime page digest remains unchanged.

## Recorded validation

All commands use Node **24.15.0**. The command records include exact argv, source/working-tree identity, page/test digests, UTC timestamps and separate output hashes.

| Record | Actual outcome | Meaning |
|---|---|---|
| [Before repair](before-repair-command.json) | 12 tests failed, zero skipped | New geometry/event/timer fixtures execute the unchanged `ee16f8a` handlers without animation frames; failed results are retained. |
| [Initial repaired focus and scroll](after-repair-focused-command.json) | 21 tests passed, zero skipped | Same new regressions plus existing scroll checks on the repaired working-tree bytes. |
| [Affected checks before audit-pin refresh](affected-checks-before-pin-refresh.json) | Build passed; four privacy VM journeys passed; full run had 161 passes and 50 failures, zero skipped | The four journeys cover blocked/failed collection surfaces with reduced motion on/off. All 50 full-suite failures arise from the existing copy/proof/privacy page or executable pins rejecting changed source before later assertions; they remain failures. This run preceded the final routine-UX test wiring. |
| [Exact implementation revision](final-058d361-commands.json) | 38 focused maker/scroll/UX tests passed; UX draft passed; UX release exited 1; diff check passed | The routine UX invocation ran all 21 actual handler regressions. Release remains blocked on the existing browser/manual/accessibility/performance requirements. |
| [Binding regressions before correction](source-binding/before-dispatcher-fix-command.json) | 17 UX checks passed, two binding regressions failed, zero skipped | Both real-built broken candidates incorrectly passed when their corresponding historical override selected the clean page. |
| [Binding correction checks](source-binding/after-dispatcher-fix-commands.json) | 40 focused checks and build passed; two mistaken entry-point commands exited 1; diff check passed | The commands were run on the exact checker/test bytes subsequently committed as `34ddae6139fc6628bf7c20568b99d3dd554d818a`. The failed commands referenced nonexistent `scripts/check.mjs`; they are retained as invocation errors, not release or product results. |
| [Correct repository UX commands](source-binding/corrected-entry-ux-commands.json) | UX draft passed, UX release exited 1 | `scripts/validate-landing` ran all 21 candidate handler checks in each mode. The existing browser/manual/performance release boundary remains. |

The new regression set covers reduced-motion immediate arrival, native smooth arrival, active scrolling beyond the former absolute timeout, a delayed DOM scroll receipt with reached geometry, off-wall expiry, four user cancellation inputs, repeated activation, navigation elsewhere, cleanup and manual board accessibility without a focus request. Geometry and event objects are test doubles; no physical input, browser rendering or animation performance is measured.

## Remaining qualification

The copy/proof/privacy author inventories still bind the previous page and must be re-audited against the exact published source before the complete candidate can qualify. Historical pins and failed runs must remain available. Their update supplies source consistency only and grants no owner, privacy or publication approval.

The repaired page requires a fresh actual browser run and independent exact-head re-review, including the previously failed normal and short-desktop maker entries and affected input/failure modes. That run must retain the original `ee16f8a` failures. The narrow-keyboard receipt-budget observation is a separate runner/timing question; this source repair does not turn its recorded failure into a pass.

No issue, gate, epic or foreign acceptance criterion is closed by this record. Product/frontend, accessibility/QA, privacy and app-assembly owners retain their applicable acceptance decisions.

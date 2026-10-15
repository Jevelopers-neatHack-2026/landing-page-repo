# Native input, recovery and local preview evidence

Refs #3, #6, #7, #9, #17 and #12. This record concerns the standalone landing artifact. The app-owned assembly, physical-device checks, manual accessibility and release acceptance remain separate owner inputs.

## Candidate and scope

The published integrated checkpoint is `c80d3829535d9f03ded28423f2d8ccec2015841d`, containing merged brand PR #33 and governance PR #34. Its page is byte-identical to published `db2e7c4bf8920f17b0ab132719edf910a284b5e6`: SHA-256 `91e9a369378376a45fe3a6a725a655229040ba4f3afb69d1d031116d97c33969`. The only runtime changes in this branch are the four existing section IDs described in [the page map](../../../integration/site-map.md). The native-scroll, fallback and maker-focus corrections were already merged and are reused.

The optional [browser runner](../../../scripts/check-scroll-browser.mjs) builds and serves the committed artifact, verifies the served page digest, records source/harness revisions and hashes, and uses a fresh Chromium process and context per scenario. Input is delivered through browser automation: wheel, small wheel deltas, classic scrollbar dragging, keyboard and emulated touch. Scripted scroll-position writes are not the input evidence. A passive observer records receipt and cancellation state; a protocol acknowledgement alone is not treated as input receipt. Renderer-dependent cases require completed progress and active 3D before deliberate context loss.

The current follow-up runner also checks blocked local media and a fresh-context local preview. The privacy probe uses a fictional canary, records request classifications and storage names without values, and never opens the studio. Its observation window is explicit. It does not establish privacy approval for external font/CDN services or the separately owned host.

**Qualification status at this source checkpoint: pending.** The final published runner must be executed and independently reviewed before this PR becomes ready. The complete earlier failure and diagnostic records below will be attached with the resulting evidence; missing or unexecuted cases remain pending.

## Preserved observations

The first expanded run against published `db2e7c4` completed with **8 passing scenarios and 2 failing scenarios**. The reduced-motion case did not observe backward wheel movement within the original polling window. The short-desktop case passed all 14 native input checks and then timed out while waiting for maker focus. That report is retained unchanged in [published-db2e7c4/observations.json](published-db2e7c4/observations.json).

Separate passive diagnostic runs on the same unchanged page and original runner base passed both cases. In reduced motion, the trusted backward wheel arrived after the protocol command resolved and moved the page without cancellation. The later short-desktop run focused a visible maker input and passed the examples and final link checks. These later observations do not identify the cause of either earlier failure. Resource abort messages alone do not prove unfinished startup or teardown timing.

The [diagnostic summary](diagnostics/passive-scroll-diagnostic-summary.json), exact diagnostic script, command records and complete reports preserve that distinction. Large diagnostic reports are gzip containers for the original JSON bytes; [diagnostics/manifest.json](diagnostics/manifest.json) records both compressed and decompressed hashes. Decompression must reproduce the original digest before analysis.

The [historical manifest](history/manifest.json) retains earlier failed setup/geometry/capture runs, the actual original context-loss stall, and the successful existing native-scroll correction. The two historical PNGs are original bytes and show historical revisions only. An early expanded original-source run timed out before inducing context loss; it is not a valid negative control. The separately recorded original context-loss run did induce `WEBGL_lose_context` and observed no post-loss native movement.

## Reproduction

Use the repository's pinned Node 24.15.0 and installed Playwright/Chromium paths. No browser dependency is added to the core build. Each output path must be new: a reused path fails before build or browser launch, preserving prior results.

```sh
LANDING_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
LANDING_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node scripts/check-scroll-browser.mjs --output /absolute/fresh/evidence/path --capture none
```

The runner supports `--scenario normal`, `context-loss`, `blocked-cdn`, `missing-media`, `webgl-failure`, `reduced-motion`, `touch`, `narrow-keyboard`, `tablet`, `short-desktop` and `no-javascript`. `--repository` selects another committed source checkout for a historical control while retaining the current harness hash. `--capture none` makes no screenshot claim. Optional `view` screenshots use the current browser view and are recorded only when capture actually succeeds.

## Remaining acceptance

The bounded Chromium observations do not certify physical wheel/trackpad/touch devices, all native scrollbar implementations, screen readers, native 200% text zoom, measured contrast, WCAG conformance, slow/offline behavior, or three-run mobile lab performance. A shared, resource-constrained headless process is not a clean performance lab. Source and VM checks do not evaluate these browser receipts automatically, and the UX release adapter continues to exit nonzero.

Product/frontend and accessibility/QA reviewers must assess the exact source and raw evidence and provide the remaining manual/device results. Product/Finance must accept the exact privacy boundary. The app owner must provide the accepted source/assets/rebuild/rollback contract and deployed revision/artifact identity before a public reproduction. EVAL-03/EVAL-04 and the landing gate/epic remain open until their accountable acceptance exists.

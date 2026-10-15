# Included-section anchor source and review evidence

Refs #3, #4, #6 and #9. Published runtime source is [`db2e7c4bf8920f17b0ab132719edf910a284b5e6`](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/commit/db2e7c4bf8920f17b0ab132719edf910a284b5e6), page SHA-256 `91e9a369378376a45fe3a6a725a655229040ba4f3afb69d1d031116d97c33969`. The page differs from the preceding audited source `36c0a841d5b5c5f6e7c3870e65c541825026d214` only by `problem`, `benefits`, `gallery` and `about` IDs on existing elements. The [source comparison](source-comparison.json) records the exact replacements, unchanged visible-text digest and all ten unchanged asset digests.

The copy/example/privacy audit pins now reference the published runtime revision. Their prior audit references are retained as history. Copy, product, marketing, privacy and asset publication approvals remain pending. These audit changes and the later checker repair were **local uncommitted inputs at capture**; the records hash each changed input and do not claim an exact final PR-head run. Required affected checks must be rerun after publication.

## Preserved results and scope

| Record | Actual result | Interpretation |
|---|---|---|
| [Initial missing-anchor run](prepublication/baseline-missing-anchors/command.json) | Exit 1 against unchanged page bytes `2bc1c248…` and locally added checker/tests | Historical prepublication failure. Its local source commit is not claimed to be a published revision. |
| [First published-source audit validation](db2e7c4-local-audit/commands.json) | 143 tests passed, no skips; foundation/content/proof/privacy drafts passed; required release exited 1 | Published runtime/test code plus hashed local audit updates. The independent review below subsequently found checker gaps; this earlier run does not resolve them. |
| [Independent review](review-findings-db2e7c4/foundation-review-db2e7c4.json) and [built-artifact probes](review-findings-db2e7c4/foundation-negative-probes-db2e7c4.json) | `REQUEST_CHANGES`; nested template/textarea lookalikes and an encoded duplicate ID were incorrectly accepted | Original review is preserved unchanged. Synthetic fixtures passed real build/artifact validation before the flawed section inspector accepted them. |
| [Regressions before repair](review-findings-db2e7c4/command.json) | Exit 1: 13 passed, 4 failed, no skips | Reproduces FND-R1/FND-R2 and ambiguous fragment handling before the checker repair. |
| [First local checker repair validation](db2e7c4-local-repair/commands.json) | 17 foundation tests and 147 full tests passed, no skips; foundation draft passed; required release exited 1 | Historical local repair. Subsequent independent re-review exposed the unquoted-ID slash case below. |
| [Unquoted-ID slash reproduction](re-review-unquoted-slash/command.json) | Exit 1: 17 passed, 1 failed, no skips | A trailing slash in unquoted `id=problem/` was incorrectly removed before parsing, making a nonexistent `#problem` appear present. The new built-artifact regression preserves that failure. |
| [Final local checker repair validation](db2e7c4-local-final-repair/commands.json) | 18 foundation tests and 148 full tests passed, no skips; foundation draft passed; required release exited 1 | Local final repair retains slashes in unquoted attribute values and recognizes a self-closing marker only between attributes. Independent review and exact published candidate verification remain separate. |

Every command record supplies actual executable arguments, UTC times, exit codes, source/input hashes, log digests and runtime. Node was pinned to **24.15.0**. Positive source checks use the real page and copied static artifact. Negative mutations and local app/auth/API route sentinels are synthetic; they are not host-owner acceptance fixtures. No browser or provider was run by these records.

## Checker boundary and remaining acceptance

The repaired checker scans quoted opening tags, skips raw-text/RCDATA bodies, and tracks nested template content. It does not claim to implement a complete HTML parser. The current page uses literal ASCII IDs/fragments and absolute HTTPS external links; encoded or ambiguous spellings fail closed for review. Required anchors must be unique and attached to the documented existing surfaces. No runtime page, style, script, resource or asset changed during this repair.

The nonzero required-release results are retained as failures. Product/copy approval, example permission/sanitization, broader CTA/deployed identity, UX browser/manual/performance evidence, privacy approval and production origin remain pending. Brand and governance validators were absent from this isolated source branch at those runs; their separate work is not inferred to pass here.

The four IDs provide stable targets for included content. `#about` points only to existing footer attribution. Product page-map approval, any dedicated hackathon content decision, host route agreement/consumer smoke, rendered anchor positioning and broader release acceptance remain open. This slice closes no issue, gate, epic or master criterion.

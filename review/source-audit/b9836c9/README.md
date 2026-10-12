# Published maker/accessibility source audit

Refs #4, #6, #7, #9, #11, #12 and #17. This local author audit binds existing copy, example and privacy inventories to published source `b9836c9e2a8555eac96738a17c5fccb00b0eb35d`, page SHA-256 `718175dd695404d66be52eb9e1ccf3cc35410f05a65cb743e9ee6b01ea34dd9a`.

The [audit record](audit.json) compares that source with the former published audit at `db2e7c4bf8920f17b0ab132719edf910a284b5e6`. Both executable blocks changed: native maker visibility/focus synchronization and generated ticket accessible names. All non-script page bytes, styles, external resource/import URLs, asset bytes and the separate query-free studio/input boundary remain unchanged. Original and per-entry source references are retained; the former current audit and executable hashes have been added to historical references.

All 65 exact-copy approval fields remain `PENDING`. All 10 assets retain `UNCONFIRMED` publication permission and `PENDING_VISUAL_OWNER_REVIEW` sanitization. Privacy review remains `PENDING`; no receipt or accountable acceptance is invented. The current claims register, page map and analytics decision now describe this published source. Brand projection/history pins are unchanged because the projection did not change.

## Validation

The [actual commands](commands.json) ran on local audit commit `2f2ef712be26c2274f5986610392d36c99a5f108` with Node **24.15.0**:

| Command | Actual result |
|---|---|
| `node scripts/build.mjs` | Passed; 11 public source files |
| `node --test tests/*.test.mjs` (expanded paths recorded) | **213 passed, zero failed/skipped** |
| `node scripts/validate-landing --mode draft` | All nine suites passed in their local/draft modes |
| `node scripts/validate-landing --mode release` | **Exit 1**; content, CTA, proof, UX, brand, privacy, metadata and governance each retain their actual release dependency |
| `git diff --check b9836c9e2a8555eac96738a17c5fccb00b0eb35d --` | Passed for the source/pin/prose audit before these untracked run logs were added |

The full test stdout includes intentionally failing child fixtures that the enclosing negative tests correctly reject. Their original output is retained without formatting edits; a raw whitespace check across imported logs is a separate check. The original pre-pin full run of **161 passes / 50 failures** remains unchanged in `review/ux/maker-focus-sync/full-tests-before-pin-refresh.stdout.log`; it is historical evidence from the earlier maker source, not a result of this b983 audit.

This does not supply a new browser run, axe result, manual accessibility or three-run lab performance record, host identity, owner/publication permission, issue closure or master acceptance. Actual browser/axe qualification of this source and the UX receipt-reader implementation are separate ongoing work.

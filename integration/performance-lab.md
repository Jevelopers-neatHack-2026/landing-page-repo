# Recorded mobile lab collection (LP-05.C)

This optional collector measures the existing static artifact. Core build/test tooling remains dependency-free. Install pinned tools separately; do not add a package manifest or runtime dependency to the landing site. The issue requires three recorded mobile-profile runs and the median budgets below. A shared host is a limitation to report, not a reason to omit executable measurements or alter the budgets.

## Exact profile

Use Node 24.15.0, Lighthouse 13.5.0 and the recorded Chromium executable. This task's supplied Chromium is 153.0.8010.0; the installed puppeteer-core 25.13.0 package targets Chrome 155, so compatibility is observed rather than assumed. Any protocol or runtime error remains a failed trial.

Each trial uses a fresh owned Chrome process/profile, a 412×823 CSS-pixel mobile viewport, DPR 1.75, Lighthouse's pinned mobile user-agent and `throttlingMethod: simulate`. Its modeled Slow4G profile is 150 ms RTT, 1638.4 Kbps throughput and 4× CPU slowdown. The observed navigation itself is unthrottled; Lighthouse models these conditions from that load. Record the resolved settings, benchmarkIndex, warnings, browser/tool versions, source/artifact identity and shared-host resource snapshots.

The required medians are LCP ≤ 2500 ms, CLS ≤ 0.1 and TBT ≤ 200 ms. All three trials must return valid metrics, match the source and profile, and have no recorded operational failure. Missing, failed, interrupted or unclosed trials do not produce a passing median. Individual slow numeric trials remain in the median; they are never discarded or silently retried.

## Optional invocation

Provision Lighthouse 13.5.0 in an isolated tooling directory with its package lock and installed version record. The repository code uses explicit module/executable paths; it does not install software or fetch a browser.

```sh
export LANDING_LIGHTHOUSE_MODULE=/absolute/tooling/node_modules/lighthouse/core/index.js
export LANDING_CHROME_LAUNCHER_MODULE=/absolute/tooling/node_modules/chrome-launcher/dist/index.js
export LANDING_CHROMIUM_EXECUTABLE=/absolute/chromium
export LANDING_TOOLING_LOCKFILE=/absolute/tooling/package-lock.json
node scripts/check-performance-browser.mjs --output /absolute/new-evidence-directory
```

Use the pinned Node in `PATH`. A retry requires a new output directory and retains the prior failure. The script refuses a reused destination before building or launching. An existing credential-free environment proxy and exact additional-CA public-key pins may be reused. It does not disable TLS checks globally, provide credentials, visit the studio, fill inputs or invoke product/provider actions.

The collector supplies a fresh Puppeteer page to Lighthouse. Page-level request interception allows static GET requests to the local artifact and its existing jsDelivr/Google Fonts origins. This adds recorded measurement overhead and is not a whole-browser network firewall: Lighthouse gatherers and Chromium background services have other network channels. Fresh profiles and the absence of supplied credentials remain explicit boundaries. Every actual main-document response body must match the artifact page hash; no separate warmup navigation supplies that receipt.

## Evidence and sanitization

Each trial retains command/settings, observations and an actual sanitized Lighthouse JSON report if Lighthouse returned one. Failed trials that returned no report remain failed with that absence recorded. Manual/not-applicable metric audits remain skipped even if an unexpected numeric field is present. The report binds the actual Node executable hash, original installed package-lock hash and installed Lighthouse/ChromeLauncher/Puppeteer package versions and file hashes; matching version entries in the lock are required. Sanitized copies of that tooling metadata and every created per-trial command are included in the evidence manifest. The original isolated installation remains the comparison point for raw metadata hashes.

The report hashes the exact raw Lighthouse report bytes in memory, then removes headers, cookies, request/response bodies, HTML/node snippets, node labels, script-content/screenshot fields, embedded data/blob payloads and long strings. It strips URL userinfo, all query values and fragments and normalizes the loopback origin. The hashed collector code and transform rule/count record identify the exact transformation; raw sensitive payloads are never saved for publication.

`disableFullPageScreenshot: true` prevents an expensive full-height capture of this long page. Lighthouse's other trace/filmstrip data may still exist in memory; raw traces/devtools logs are not retained. Numeric metrics, errors, audit/status categories, settings, benchmarkIndex and warnings remain in the sanitized LHR. Viewport screenshots, accessibility, input/failure-state checks and manual reviews are separate evidence.

ChromeLauncher's synchronous `kill()` return is not evidence that Chrome closed. The collector waits for its own child-process close event before starting the next trial and does not kill or reuse another workspace browser. An unresolved close stops further trials and keeps the run incomplete. The final evidence manifest binds the source, artifact, collector and retained reports; passing these local median budgets grants no release, owner, field-performance or deployed-artifact acceptance.

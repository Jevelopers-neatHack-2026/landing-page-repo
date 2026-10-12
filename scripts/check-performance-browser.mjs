#!/usr/bin/env node
// Optional, separately provisioned Lighthouse evidence. Core tooling has no dependencies.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import os from 'node:os';
import { buildSite, root, sha256 } from './build.mjs';
import { createPreview } from './preview.mjs';
import { validateArtifact } from './artifact.mjs';

export const PROFILE = Object.freeze({ formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttlingMethod: 'simulate', throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 } });
export const BUDGETS = Object.freeze({ lcpMs: 2500, cls: 0.1, tbtMs: 200 });
const metricIds = { lcpMs: 'largest-contentful-paint', cls: 'cumulative-layout-shift', tbtMs: 'total-blocking-time' };
const omittedKeys = /^(?:headers|requestHeaders|responseHeaders|headersText|cookies?|postData|requestBody|responseBody|body|nodeHTML|outerHTML|innerHTML|html|snippet|nodeLabel|scriptContent|sourceContent|screenshot|screenshotData|thumbnail|stack|stackTrace)$/i;

export function safeUrl(value, origin) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return url.protocol === 'about:' && url.pathname === 'blank' ? 'about:blank' : '[embedded-or-non-http-url-omitted]';
    return `${url.origin === origin ? 'LOCAL_ORIGIN' : url.origin}${url.pathname}${url.search ? '?[query-omitted]' : ''}${url.hash ? '#[fragment-omitted]' : ''}`;
  } catch { return '[unparseable-url-omitted]'; }
}

export function sanitizeReport(value, origin) {
  const counts = { fieldsOmitted: 0, markupOmitted: 0, embeddedOrLongStringsOmitted: 0, urlsRewritten: 0 };
  function visit(item, key = '') {
    if (omittedKeys.test(key)) { counts.fieldsOmitted++; return '[field-omitted]'; }
    if (Array.isArray(item)) return item.map(child => visit(child));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, visit(child, name)]));
    if (typeof item !== 'string') return item;
    if (/^data:|^blob:/i.test(item) || item.length > 8000) { counts.embeddedOrLongStringsOmitted++; return '[embedded-or-long-string-omitted]'; }
    if (/<(?:!doctype|[a-z][^>]*>)/i.test(item)) { counts.markupOmitted++; return '[markup-omitted]'; }
    if (/url$/i.test(key) && item) { counts.urlsRewritten++; return safeUrl(item, origin); }
    return item.replace(/https?:\/\/[^\s"'<>]+/g, url => { counts.urlsRewritten++; return safeUrl(url, origin); });
  }
  return { value: visit(value), transform: { version: 1, counts, rules: ['Omit named header/cookie/body/HTML/snippet/node-label/script-content/screenshot/stack fields.', 'Omit data/blob and strings longer than8000 characters.', 'Omit strings containing markup.', 'Strip HTTP userinfo, every query value and fragment; replace the measured loopback origin with LOCAL_ORIGIN.', 'Preserve all numeric/status/configuration fields and array/category positions. Raw report is hashed in memory and never saved unredacted.'] } };
}

export function inspectMetrics(lhr) {
  const problems = [], metrics = {};
  if (!lhr || typeof lhr !== 'object') return { valid: false, metrics, problems: ['Lighthouse returned no report'] };
  if (lhr.runtimeError) problems.push('Lighthouse runtimeError is present');
  for (const [name, id] of Object.entries(metricIds)) {
    const audit = lhr.audits?.[id], value = audit?.numericValue;
    if (!audit || ['error', 'manual', 'notApplicable'].includes(audit.scoreDisplayMode) || audit.errorMessage || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (name === 'lcpMs' && value === 0)) problems.push(`Missing, invalid, skipped or failed ${id}`);
    else metrics[name] = value;
  }
  return { valid: problems.length === 0, metrics, problems };
}

export function inspectProfile(settings) {
  const problems = [];
  if (!settings || settings.formFactor !== PROFILE.formFactor || settings.throttlingMethod !== PROFILE.throttlingMethod || settings.disableFullPageScreenshot !== true || settings.disableStorageReset !== false) problems.push('Resolved lab mode differs from the recorded profile');
  for (const [key, value] of Object.entries(PROFILE.screenEmulation)) if (settings?.screenEmulation?.[key] !== value) problems.push(`Resolved viewport ${key} differs`);
  for (const [key, value] of Object.entries(PROFILE.throttling)) if (settings?.throttling?.[key] !== value) problems.push(`Resolved throttling ${key} differs`);
  return problems;
}

export function summarizeRuns(runs) {
  if (runs.length !== 3 || runs.some(run => run.status !== 'measured' || !run.metricsValid || run.failures?.length || !run.browserClosed)) return { status: 'INCOMPLETE_OR_FAILED_RUNS', budgets: BUDGETS, medians: null, meetsBudgets: false };
  const medians = {};
  for (const name of Object.keys(BUDGETS)) {
    const values = runs.map(run => run.metrics?.[name]);
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (name === 'lcpMs' && value === 0))) return { status: 'INVALID_METRICS', budgets: BUDGETS, medians: null, meetsBudgets: false };
    medians[name] = values.sort((a, b) => a - b)[1];
  }
  const meetsBudgets = Object.entries(BUDGETS).every(([key, limit]) => medians[key] <= limit);
  return { status: meetsBudgets ? 'PASS_RECORDED_LOCAL_LAB_BUDGETS' : 'FAIL_RECORDED_LOCAL_LAB_BUDGETS', budgets: BUDGETS, medians, meetsBudgets };
}

async function deadline(label, promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: ${ms}ms Node-side deadline exceeded`)), ms); })]); }
  finally { clearTimeout(timer); }
}
// ChromeLauncher's kill() is synchronous and is not a close receipt.
export async function closeOwnedChrome(launcher, timeoutMs = 45000) {
  const child = launcher.chromeProcess;
  if (!child) return { closed: true, evidence: 'no-owned-child-was-created' };
  if (child.exitCode !== null || child.signalCode !== null) { launcher.kill(); return { closed: true, evidence: 'owned-child-already-exited', exitCode: child.exitCode, signalCode: child.signalCode }; }
  let listener;
  const closed = new Promise(done => { listener = (code, signal) => done({ closed: true, evidence: 'owned-child-close-event', exitCode: code, signalCode: signal }); child.once('close', listener); });
  try { launcher.kill(); return await deadline('Owned Chrome close receipt', closed, timeoutMs); }
  finally { child.removeListener('close', listener); }
}
async function json(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
async function machine() {
  const state = { platform: os.platform(), release: os.release(), arch: os.arch(), logicalCpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem(), loadAverage: os.loadavg() };
  for (const name of ['memory.current', 'memory.max', 'memory.events']) {
    try { state[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim(); }
    catch { state[name] = 'unavailable'; }
  }
  return state;
}

export async function collect({ repository = root, output }) {
  assert.ok(output, 'Supply a new --output directory');
  repository = resolve(repository); output = resolve(output);
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const required = ['LANDING_LIGHTHOUSE_MODULE', 'LANDING_CHROME_LAUNCHER_MODULE', 'LANDING_CHROMIUM_EXECUTABLE', 'LANDING_TOOLING_LOCKFILE'];
  for (const key of required) assert.ok(process.env[key], `Set ${key} to separately installed pinned tooling`);
  const lighthousePath = resolve(process.env.LANDING_LIGHTHOUSE_MODULE), launcherPath = resolve(process.env.LANDING_CHROME_LAUNCHER_MODULE), chromiumPath = resolve(process.env.LANDING_CHROMIUM_EXECUTABLE);
  const requireTool = createRequire(lighthousePath);
  const packagePaths = { lighthouse: requireTool.resolve('lighthouse/package.json'), 'chrome-launcher': createRequire(launcherPath).resolve('chrome-launcher/package.json'), 'puppeteer-core': requireTool.resolve('puppeteer-core/package.json') };
  const packageRecords = await Promise.all(Object.entries(packagePaths).map(async ([name, path]) => { const bytes = await readFile(path); const value = JSON.parse(bytes); return { name, version: value.version, sha256: sha256(bytes), bytes: bytes.length, value }; }));
  const toolPackage = packageRecords.find(item => item.name === 'lighthouse').value;
  assert.equal(toolPackage.version, '13.5.0', 'This profile/receipt collector is reviewed for Lighthouse13.5.0');
  assert.equal(process.version, 'v24.15.0', 'Use pinned Node24.15.0 for this lab profile');
  const puppeteerPackage = packageRecords.find(item => item.name === 'puppeteer-core').value;
  const lockBytes = await readFile(resolve(process.env.LANDING_TOOLING_LOCKFILE)), lock = JSON.parse(lockBytes);
  for (const item of packageRecords) assert.equal(lock.packages?.[`node_modules/${item.name}`]?.version, item.version, `Tool lock does not match installed ${item.name}`);
  const toolingBinding = { node: { version: process.version, executableSha256: sha256(await readFile(process.execPath)) }, lockfile: { filename: 'package-lock.json', sha256: sha256(lockBytes), bytes: lockBytes.length, lockfileVersion: lock.lockfileVersion }, packages: packageRecords.map(({ name, version, sha256, bytes }) => ({ name, version, sha256, bytes })) };
  const { default: lighthouse } = await import(pathToFileURL(lighthousePath).href);
  const chromeLauncher = await import(pathToFileURL(launcherPath).href);
  const puppeteer = await import(pathToFileURL(requireTool.resolve('puppeteer-core')).href);
  const constants = await import(pathToFileURL(resolve(dirname(lighthousePath), 'config/constants.js')).href);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'site'], { cwd: repository, encoding: 'utf8' }).trim(), '', 'Commit runtime source before measurements');
  const sourceBytes = await readFile(resolve(repository, 'site/index.html'));
  assert.equal(sha256(sourceBytes), sha256(execFileSync('git', ['show', `${sourceRevision}:site/index.html`], { cwd: repository })), 'Working page differs from recorded source');
  const { output: artifactDir } = await buildSite({ repository });
  await validateArtifact(repository, artifactDir);
  const manifestBytes = await readFile(resolve(artifactDir, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.files['index.html'].sha256, sha256(sourceBytes));
  const harnessBytes = await readFile(new URL(import.meta.url));
  const report = { format: 'ticketstub-local-mobile-lab-v1', startedAt: new Date().toISOString(), sourceRevision, sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repository, encoding: 'utf8' }).trim(), pageSha256: sha256(sourceBytes), artifactManifestSha256: sha256(manifestBytes), harnessSha256: sha256(harnessBytes), profile: PROFILE, budgets: BUDGETS, tooling: { node: process.version, lighthouse: toolPackage.version, puppeteer: puppeteerPackage.version, chromiumExecutableSha256: sha256(await readFile(chromiumPath)), lighthouseEntrySha256: sha256(await readFile(lighthousePath)), launcherEntrySha256: sha256(await readFile(launcherPath)) }, command: { executable: process.execPath, argv: process.argv.slice(1), environment: required.map(key => ({ key, configured: true })) }, limitations: ['Local headless software-WebGL observations; no field-performance, physical-device, accessibility or release acceptance.', 'Simulate uses an observed unthrottled load to model the recorded Slow4G/CPU profile. It is not measured physical network latency or a real4x CPU device.', 'Shared host load/memory and benchmarkIndex are retained; no cleanroom requirement or adjusted budget is invented.', 'Puppeteer25.13 was packaged for Chrome155; supplied Chromium153 is a compatibility variable. Protocol/runtime errors remain failures.', 'Page request interception overhead is part of this recorded profile. It blocks page requests outside the existing static resource boundary, not every browser/gatherer network channel.', 'Fresh profiles, no input values/credentials and no studio actions are used. CDP gatherer or Chromium background requests are not claimed absent from page interception alone.', 'Full-page screenshots are disabled. Raw filmstrip/trace/devtools payloads are not saved; sanitized LHR preserves metric/status/config data, with raw report hash and exact transform record.'], runs: [] };
  await writeFile(resolve(output, 'artifact-manifest.json'), manifestBytes);
  await writeFile(resolve(output, 'collector.mjs'), harnessBytes);
  report.tooling.binding = toolingBinding;
  await mkdir(resolve(output, 'tooling'));
  await json(resolve(output, 'tooling/bindings.json'), toolingBinding);
  // Apply the recorded payload/URL transformation to saved metadata. Exact raw
  // hashes remain the comparison point for the separately retained installation.
  await json(resolve(output, 'tooling/package-lock.sanitized.json'), sanitizeReport(lock, null));
  for (const item of packageRecords) await json(resolve(output, `tooling/${item.name}-package.sanitized.json`), sanitizeReport(item.value, null));
  await json(resolve(output, 'report.json'), report);
  const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY, proxy = proxyValue ? new URL(proxyValue) : null;
  assert.ok(!proxy?.username && !proxy?.password, 'Credential-bearing proxy is outside this reviewed collector setup');
  const caPins = proxy && process.env.NODE_EXTRA_CA_CERTS ? [...(await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8')).matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(match => createHash('sha256').update(new X509Certificate(match[0]).publicKey.export({ type: 'spki', format: 'der' })).digest('base64')) : [];
  report.transport = { mode: proxy ? 'existing-environment-proxy' : 'direct', trust: caPins.length ? 'existing-additional-ca-public-key-pins' : 'browser-default', caPinCount: caPins.length };
  const flags = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(proxy ? [`--proxy-server=${proxy.origin}`, '--proxy-bypass-list=127.0.0.1;localhost'] : []), ...(caPins.length ? [`--ignore-certificate-errors-spki-list=${caPins.join(',')}`] : [])];
  const server = createPreview({ artifactDir });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`, url = origin + '/';
  const safeError = error => sanitizeReport(String(error?.message || error), origin).value;
  try {
    for (let index = 1; index <= 3; index++) {
      const runDir = resolve(output, `run-${String(index).padStart(2, '0')}`); await mkdir(runDir);
      const run = { index, startedAt: new Date().toISOString(), status: 'running', failures: [], requests: [], failedRequests: [], pageErrors: [], servedDocuments: [], machineBefore: await machine(), freshProfile: true, browserClosed: false };
      report.runs.push(run); await json(resolve(output, 'report.json'), report);
      let chrome, browser, profileDir;
      const pendingResponses = new Set();
      try {
        profileDir = await mkdtemp(join(os.tmpdir(), 'ticketstub-lab-'));
        // Retain the exact owned instance even if launch fails after spawning.
        // Port0 avoids ChromeLauncher's existing-port reuse behavior.
        chrome = new chromeLauncher.Launcher({ chromePath: chromiumPath, chromeFlags: flags, port: 0, userDataDir: profileDir, logLevel: 'silent', handleSIGINT: false });
        await deadline('Owned Chrome launch', chrome.launch(), 45000);
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
        run.browserVersion = await browser.version();
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (request.isInterceptResolutionHandled()) return;
          const address = new URL(request.url());
          const allowed = ['data:', 'blob:', 'about:'].includes(address.protocol) || request.method() === 'GET' && [origin, 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(address.origin);
          run.requests.push({ url: safeUrl(request.url(), origin), method: request.method(), resourceType: request.resourceType(), disposition: allowed ? 'allowed' : 'blocked' });
          if (!allowed) run.failures.push('Page attempted request outside recorded static GET boundary');
          (allowed ? request.continue() : request.abort('blockedbyclient')).catch(error => run.failures.push(`Request interception failed: ${safeError(error)}`));
        });
        page.on('requestfailed', request => run.failedRequests.push({ url: safeUrl(request.url(), origin), error: safeError(request.failure()?.errorText || 'request failed') }));
        page.on('pageerror', error => run.pageErrors.push(safeError(error)));
        page.on('response', response => {
          const request = response.request();
          if (!request.isNavigationRequest() || request.frame() !== page.mainFrame() || response.url() !== url) return;
          const promise = (async () => { const bytes = await response.buffer(); run.servedDocuments.push({ url: 'LOCAL_ORIGIN/', status: response.status(), bytes: bytes.length, sha256: sha256(bytes), fromCache: response.fromCache() }); })().catch(error => run.failures.push(`Main-document receipt failed: ${safeError(error)}`));
          pendingResponses.add(promise); promise.finally(() => pendingResponses.delete(promise));
        });
        const settings = { port: chrome.port, hostname: '127.0.0.1', logLevel: 'silent', output: 'json', onlyCategories: ['performance'], ...PROFILE, throttling: { ...constants.throttling.mobileSlow4G, ...PROFILE.throttling }, emulatedUserAgent: constants.userAgents.mobile, disableFullPageScreenshot: true, disableStorageReset: false, enableErrorReporting: false, maxWaitForFcp: 30000, maxWaitForLoad: 45000 };
        run.requestedSettings = { ...settings, port: '[fresh-ephemeral-port]' };
        await json(resolve(runDir, 'command.json'), { method: 'lighthouse(url, flags, undefined, suppliedFreshPuppeteerPage)', measuredUrl: 'LOCAL_ORIGIN/', requestedSettings: run.requestedSettings, profile: PROFILE, startedAt: run.startedAt, sourceRevision, pageSha256: report.pageSha256, harnessSha256: report.harnessSha256 });
        run.commandPath = `run-${String(index).padStart(2, '0')}/command.json`;
        const result = await deadline('Lighthouse measurement', lighthouse(url, settings, undefined, page), 180000);
        await deadline('Main-document response receipts', Promise.all([...pendingResponses]), 15000);
        assert.ok(result?.lhr, 'Lighthouse returned no actual report');
        const lhr = result.lhr;
        const raw = typeof result.report === 'string' ? result.report : JSON.stringify(lhr);
        const rawJsonMatchesLhr = JSON.stringify(JSON.parse(raw)) === JSON.stringify(lhr);
        const sanitized = sanitizeReport(lhr, origin), bytes = Buffer.from(JSON.stringify(sanitized.value, null, 2) + '\n');
        await writeFile(resolve(runDir, 'lighthouse.sanitized.json'), bytes);
        run.lighthouseReport = { path: `run-${String(index).padStart(2, '0')}/lighthouse.sanitized.json`, rawUtf8Sha256: sha256(Buffer.from(raw)), rawUtf8Bytes: Buffer.byteLength(raw), sanitizedSha256: sha256(bytes), sanitizedBytes: bytes.length, rawRetained: false, rawJsonMatchesLhr, transform: sanitized.transform };
        await json(resolve(runDir, 'transform.json'), run.lighthouseReport);
        const resultMetrics = inspectMetrics(lhr);
        run.metrics = resultMetrics.metrics; run.metricsValid = resultMetrics.valid; run.failures.push(...resultMetrics.problems);
        if (!rawJsonMatchesLhr) run.failures.push('Raw JSON report and measured LHR disagree');
        run.failures.push(...inspectProfile(lhr.configSettings));
        run.resolvedSettings = sanitizeReport(lhr.configSettings, origin).value;
        run.environment = sanitizeReport(lhr.environment, origin).value;
        run.runWarnings = sanitizeReport(lhr.runWarnings || [], origin).value;
        run.runtimeError = sanitizeReport(lhr.runtimeError || null, origin).value;
        if (lhr.requestedUrl !== url || (lhr.finalDisplayedUrl || lhr.finalUrl) !== url) run.failures.push('Lighthouse measured or ended at an unexpected URL');
        if (run.servedDocuments.length !== 1 || run.servedDocuments.some(doc => doc.status !== 200 || doc.sha256 !== report.pageSha256 || doc.bytes !== sourceBytes.length)) run.failures.push('Exactly one matching actual main-document receipt is required');
        if (run.pageErrors.length || run.failedRequests.length) run.failures.push('Observed page or resource failures during normal-profile run; retain metrics diagnostically only');
        run.finalPage = await deadline('Final page state', page.evaluate(() => ({ rootClasses: document.documentElement.className, readyState: document.readyState, innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })), 10000);
        run.status = run.failures.length ? 'failed' : 'measured';
      } catch (error) { run.status = 'failed'; run.failures.push(safeError(error)); }
      finally {
        if (browser) { try { await browser.disconnect(); } catch (error) { run.failures.push(`Browser disconnect: ${safeError(error)}`); } }
        if (chrome) { try { run.browserCloseReceipt = await closeOwnedChrome(chrome); run.browserClosed = run.browserCloseReceipt.closed; } catch (error) { run.failures.push(`Owned Chrome close failed: ${safeError(error)}`); } }
        else run.browserClosed = true; // No owned browser was successfully launched.
        if (profileDir && run.browserClosed) await rm(profileDir, { recursive: true, force: true });
        if (run.failures.length) run.status = 'failed';
        run.finishedAt = new Date().toISOString(); run.machineAfter = await machine();
        await json(resolve(runDir, 'observation.json'), run); await json(resolve(output, 'report.json'), report);
        console.log(JSON.stringify({ run: index, status: run.status, metrics: run.metrics || null, failures: run.failures, browserClosed: run.browserClosed }));
      }
      if (!run.browserClosed) { report.abortReason = 'Owned browser close unresolved; remaining runs not executed to avoid parallel browsers'; break; }
    }
  } finally {
    await new Promise(done => server.close(done));
    const finalManifest = await readFile(resolve(artifactDir, 'manifest.json'));
    try { await validateArtifact(repository, artifactDir); report.artifactUnchanged = sha256(finalManifest) === report.artifactManifestSha256; }
    catch (error) { report.artifactUnchanged = false; report.artifactFailure = safeError(error); }
    report.summary = summarizeRuns(report.runs);
    if (!report.artifactUnchanged) report.summary = { status: 'ARTIFACT_CHANGED', budgets: BUDGETS, medians: null, meetsBudgets: false };
    report.finishedAt = new Date().toISOString(); report.releaseAcceptance = 'not-granted-by-local-lab';
    await json(resolve(output, 'report.json'), report);
    const paths = ['artifact-manifest.json', 'collector.mjs', 'report.json', 'tooling/bindings.json', 'tooling/package-lock.sanitized.json', ...packageRecords.map(item => `tooling/${item.name}-package.sanitized.json`), ...report.runs.flatMap(run => [`run-${String(run.index).padStart(2, '0')}/observation.json`, ...(run.commandPath ? [run.commandPath] : []), ...(run.lighthouseReport ? [run.lighthouseReport.path, `run-${String(run.index).padStart(2, '0')}/transform.json`] : [])])];
    await json(resolve(output, 'evidence-manifest.json'), { sourceRevision, pageSha256: report.pageSha256, harnessSha256: report.harnessSha256, files: await Promise.all(paths.map(async path => { const bytes = await readFile(resolve(output, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) }; })) });
    console.log(JSON.stringify(report.summary));
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    if (!['--repository', '--output'].includes(key) || !value || args.has(key)) { console.error('Usage: check-performance-browser.mjs --output NEW_DIRECTORY [--repository PATH]'); process.exit(2); }
    args.set(key, value);
  }
  collect({ repository: args.get('--repository') || root, output: args.get('--output') }).then(report => { process.exitCode = report.summary.meetsBudgets ? 0 : 1; }).catch(error => { console.error(sanitizeReport(error.message, null).value); process.exitCode = 2; });
}

#!/usr/bin/env node
// Optional browser evidence runner. Core build/test tooling remains dependency-free.
// Inputs are browser automation events, not a claim about physical input devices.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import os from 'node:os';
import { buildSite, root, sha256 } from './build.mjs';
import { createPreview } from './preview.mjs';

const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--repository', '--output', '--scenario', '--capture'].includes(key) || !value || options.has(key)) throw new Error('Usage: check-scroll-browser.mjs [--repository PATH] [--output PATH] [--scenario NAME] [--capture none|view]');
  options.set(key, value);
}
const repository = resolve(options.get('--repository') || root);
const output = resolve(options.get('--output') || resolve(repository, 'dist/browser-scroll'));
const capture = options.get('--capture') || 'none';
assert.ok(['none', 'view'].includes(capture), 'Unknown screenshot capture mode');
const scenarioNames = ['normal', 'context-loss', 'blocked-cdn', 'missing-media', 'webgl-failure', 'reduced-motion', 'touch', 'narrow-keyboard', 'tablet', 'short-desktop', 'no-javascript'];
const selected = options.has('--scenario') ? [options.get('--scenario')] : scenarioNames;
assert.ok(selected.every(name => scenarioNames.includes(name)), 'Unknown browser scenario');
assert.ok(process.env.LANDING_PLAYWRIGHT_MODULE, 'Set LANDING_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
assert.ok(process.env.LANDING_CHROMIUM_EXECUTABLE, 'Set LANDING_CHROMIUM_EXECUTABLE to the test Chromium binary');
// Refuse a reused destination before any build or browser work. Failed evidence
// stays immutable; every retry must explicitly choose a fresh directory.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const { chromium } = await import(pathToFileURL(resolve(process.env.LANDING_PLAYWRIGHT_MODULE)).href);
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'site'], { cwd: repository, encoding: 'utf8' }).trim(), '', 'Commit runtime source before capturing immutable browser evidence');
const { output: artifactDir } = await buildSite({ repository });
const manifestBytes = await readFile(resolve(artifactDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const server = createPreview({ artifactDir });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  schema: 'ticketstub.browser-scroll-observation/1', startedAt: new Date().toISOString(), sourceRevision,
  harnessRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  harnessSha256: sha256(await readFile(new URL(import.meta.url))),
  artifactManifestSha256: sha256(manifestBytes), pageSha256: manifest.files['index.html'].sha256,
  mode: 'local-browser-emulated-input', screenshotCapture: capture, platform: { os: os.platform(), release: os.release(), arch: os.arch(), node: process.version },
  limitations: ['Headless Chromium; no physical wheel, trackpad, scrollbar or touch device attestation.', 'Software WebGL where available; not GPU/device performance evidence.', 'No screen-reader, native text-zoom, WCAG or public deployment acceptance.', 'Only the local page and its existing static CDN/font resources are loaded; studio navigation is not executed.'],
  scenarios: [],
};
let browser;
try {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const proxy = proxyUrl ? new URL(proxyUrl) : null;
  report.networkTransport = proxy ? 'existing-environment-proxy' : 'direct';
  // Chromium does not inherit Node's existing additional CA trust. Limit the
  // temporary test browser to those exact public keys; do not disable TLS checks.
  const caPins = proxy && process.env.NODE_EXTRA_CA_CERTS ? [...(await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8')).matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(match => createHash('sha256').update(new X509Certificate(match[0]).publicKey.export({ type: 'spki', format: 'der' })).digest('base64')) : [];
  report.tlsTrust = caPins.length ? 'platform-additional-ca-public-key-pins' : 'browser-default';
  const launchOptions = { executablePath: process.env.LANDING_CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(caPins.length ? [`--ignore-certificate-errors-spki-list=${caPins.join(',')}`] : [])], ...(proxy ? { proxy: { server: proxy.origin, bypass: '127.0.0.1,localhost', ...(proxy.username ? { username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) } : {}) } } : {}) };
  for (const name of selected) {
    // Release renderer/GPU allocations between modes, as well as profile state.
    browser = await chromium.launch(launchOptions);
    report.browserVersion = browser.version();
    const mobile = name === 'touch';
    const viewport = mobile ? { width: 375, height: 812 } : name === 'narrow-keyboard' ? { width: 320, height: 568 } : name === 'tablet' ? { width: 768, height: 1024 } : name === 'short-desktop' ? { width: 1440, height: 568 } : { width: 1440, height: 900 };
    const observation = { name, viewport, results: [], console: [], requests: [], failedRequests: [], screenshots: [] };
    const fictionalInput = 'TicketStub-Fictional-Privacy-Canary-20261012';
    const redactFixture = value => value.replaceAll(fictionalInput, '[FICTIONAL_INPUT]').replaceAll(encodeURIComponent(fictionalInput), '[FICTIONAL_INPUT]');
    const safeUrl = value => {
      try {
        const url = new URL(value);
        return `${url.origin === origin ? 'LOCAL_ORIGIN' : url.origin}${redactFixture(url.pathname)}${url.search ? '?[query-values-omitted]' : ''}`;
      } catch { return '[unparseable-url]'; }
    };
    const safeMessage = value => redactFixture(value.replace(/https?:\/\/[^\s"'<>]+/g, safeUrl).replaceAll(origin, 'LOCAL_ORIGIN'));
    report.scenarios.push(observation);
    const context = await browser.newContext({ viewport: observation.viewport, hasTouch: mobile, isMobile: mobile, reducedMotion: name === 'reduced-motion' ? 'reduce' : 'no-preference', javaScriptEnabled: name !== 'no-javascript' });
    const page = await context.newPage();
    const started = performance.now();
    observation.resourceLifecycle = [];
    for (const [event, state] of [['request', 'started'], ['requestfinished', 'finished'], ['requestfailed', 'failed']]) page.on(event, request => {
      if (observation.resourceLifecycle.length >= 160) return;
      observation.resourceLifecycle.push({ state, atNodeMs: performance.now() - started, url: safeUrl(request.url()), ...(state === 'failed' ? { error: safeMessage(request.failure()?.errorText || '') } : {}) });
    });
    if (name !== 'no-javascript') await page.addInitScript(() => {
      // Observe receipt without canceling input or changing application handlers,
      // focus, styles or scrolling. A protocol response alone is not receipt.
      const audit = window.__ticketStubInputAudit = { phase: '', events: [] };
      for (const type of ['wheel', 'keydown', 'touchstart', 'touchend', 'pointerdown', 'pointerup']) addEventListener(type, event => {
        if (audit.events.length >= 300) return;
        const row = { phase: audit.phase, type, atPageMs: performance.now(), eventTimeStamp: event.timeStamp, trusted: event.isTrusted, cancelable: event.cancelable, targetTag: event.target?.tagName || '', targetId: event.target?.id || '', ...(type === 'wheel' ? { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode } : {}), ...(type === 'keydown' && ['PageDown', 'PageUp', ' ', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key) ? { key: event.key, shiftKey: event.shiftKey } : {}) };
        audit.events.push(row);
        setTimeout(() => { row.defaultPreventedAfterDispatch = event.defaultPrevented; }, 0);
      }, { capture: true, passive: true });
    });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => observation.console.push({ type: 'pageerror', message: safeMessage(error.message) }));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) observation.console.push({ type: message.type(), message: safeMessage(message.text()) }); });
    page.on('requestfailed', request => observation.failedRequests.push({ url: safeUrl(request.url()), error: safeMessage(request.failure()?.errorText || '') }));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const local = url.origin === origin;
      const expected = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin);
      const blocked = (local && name === 'missing-media' && url.pathname.startsWith('/assets/')) || (!local && (name === 'blocked-cdn' || !expected));
      const body = route.request().postData() || '';
      observation.requests.push({ url: safeUrl(url.href), method: route.request().method(), hasRequestBody: Boolean(body), containsFictionalInput: [url.href, body].some(value => value.includes(fictionalInput) || value.includes(encodeURIComponent(fictionalInput))), resourceType: route.request().resourceType(), disposition: blocked ? 'blocked-by-test' : 'allowed' });
      return blocked ? route.abort('blockedbyclient') : route.continue();
    });
    if (name === 'webgl-failure') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      window.__testWebglAttempts = 0;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (/^(webgl2?|experimental-webgl)$/.test(type)) { window.__testWebglAttempts++; return null; }
        return original.call(this, type, ...args);
      };
    });
    const sample = () => page.evaluate(() => ({ scrollY, innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, rootClasses: document.documentElement.className, activeId: document.activeElement?.id || '', activeTag: document.activeElement?.tagName || '', railPointerEvents: getComputedStyle(document.querySelector('.rail')).pointerEvents, railProgress: document.querySelector('.rail').style.getPropertyValue('--rp'), makerScroll: document.querySelector('#finale').scrollTop, progress: Number(document.querySelector('#lbar')?.getAttribute('aria-valuenow') ?? document.querySelector('#lpct')?.textContent ?? 0), readyState: document.readyState, visible: document.visibilityState, hasFocus: document.hasFocus() }));
    const inputAudit = () => page.evaluate(() => window.__ticketStubInputAudit || null);
    const storage = async () => {
      const names = await page.evaluate(async () => ({ localStorageKeys: Object.keys(localStorage).sort(), sessionStorageKeys: Object.keys(sessionStorage).sort(), indexedDBNames: (await indexedDB.databases()).map(database => database.name).sort(), cacheNames: await caches.keys(), serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map(registration => new URL(registration.scope).pathname) }));
      return {
        cookies: (await context.cookies()).map(({ name, domain, httpOnly, secure, sameSite }) => ({ name: safeMessage(name), domain: safeMessage(domain), httpOnly, secure, sameSite })),
        page: Object.fromEntries(Object.entries(names).map(([kind, values]) => [kind, values.map(value => safeMessage(String(value)))])),
      };
    };
    const phase = label => page.evaluate(label => { if (window.__ticketStubInputAudit) window.__ticketStubInputAudit.phase = label; }, label);
    const waitState = async (label, predicate, timeout = 5000) => {
      // Node-side polling remains observable when document animation frames are
      // delayed. Keep the last state in any failure instead of losing the cause.
      const deadline = Date.now() + timeout;
      let current;
      do {
        current = await sample();
        if (predicate(current)) return current;
        await page.waitForTimeout(100);
      } while (Date.now() < deadline);
      throw new Error(`${label} timed out; last state: ${JSON.stringify(current)}`);
    };
    const shot = async label => {
      if (capture === 'none') return;
      const file = `${name}-${label}.png`;
      const cdp = await context.newCDPSession(page);
      let timer;
      try {
        // Capture the current view without waiting for the animated GPU surface
        // to become idle. No page style, motion or scroll state is changed.
        const result = await Promise.race([cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('View screenshot timed out')), 20000); })]);
        const bytes = Buffer.from(result.data, 'base64');
        await writeFile(resolve(output, file), bytes);
        observation.screenshots.push({ file, sha256: sha256(bytes), method: 'Page.captureScreenshot fromSurface=false' });
      } finally { clearTimeout(timer); await cdp.detach(); }
    };
    const settled = async (position = 'scrollY') => {
      let previous = await sample(), stableSince = Date.now();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(100);
        const current = await sample();
        if (Math.abs(current[position] - previous[position]) > 1) stableSince = Date.now();
        if (Date.now() - stableSince >= 400) return current;
        previous = current;
      }
      throw new Error('Native scroll did not settle within ten seconds');
    };
    const move = async (label, action, direction, position = 'scrollY') => {
      const before = await settled(position);
      await phase(label);
      const dispatch = { startedAtNodeMs: performance.now() - started };
      await action();
      dispatch.resolvedAtNodeMs = performance.now() - started;
      // The five-second receipt window and subsequent five-second movement
      // window are separate. Never turn an undelivered event into a scroll pass.
      const wheelReceiptRequired = name !== 'no-javascript' && label.includes('wheel');
      const receiptDeadline = Date.now() + 5000;
      let receipt = null;
      if (wheelReceiptRequired) {
        do {
          receipt = (await inputAudit()).events.find(event => event.phase === label && event.type === 'wheel' && event.trusted && event.deltaY * direction > 0);
          if (receipt) break;
          await page.waitForTimeout(100);
        } while (Date.now() < receiptDeadline);
      }
      const deadline = Date.now() + 5000;
      let observed, movementWithinWindow = false;
      do { await page.waitForTimeout(100); observed = await sample(); }
      while (observed[position] * direction <= before[position] * direction + 2 && Date.now() < deadline);
      movementWithinWindow = Date.now() <= deadline && observed[position] * direction > before[position] * direction + 2;
      const after = await settled(position);
      const passed = (!wheelReceiptRequired || receipt) && movementWithinWindow && after[position] * direction > before[position] * direction + 2;
      const error = passed ? null : wheelReceiptRequired && !receipt ? 'Trusted wheel receipt was not observed within five seconds' : 'Expected native movement did not occur';
      observation.results.push({ label, input: label, before, after, dispatch, movementWithinWindow, wheelReceipt: wheelReceiptRequired ? receipt : 'not-required', result: passed ? 'pass' : 'fail', ...(error ? { error } : {}) });
      assert.ok(passed, label);
    };
    try {
      const response = await page.goto(origin + '/', { waitUntil: 'load', timeout: 45000 });
      assert.equal(response.status(), 200);
      assert.equal(sha256(await response.body()), report.pageSha256, 'Served page must match source artifact');
      if (name !== 'no-javascript') await page.locator('#loader').waitFor({ state: 'hidden', timeout: 35000 });
      else assert.equal(await page.locator('#loader').isVisible(), false, 'No-JavaScript fallback must dismiss loader');
      observation.loaded = await sample();
      console.log(`${name}: loaded ${observation.loaded.rootClasses || 'no-script'} at ${observation.viewport.width}x${observation.viewport.height}`);
      await writeFile(resolve(output, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
      await shot('loaded');
      if (['normal', 'context-loss'].includes(name)) {
        observation.rendererReady = await waitState('Completed renderer startup', state => !state.rootClasses.split(/\s+/).includes('no3d') && state.progress === 100, 30000);
      }
      if (name === 'normal') observation.privacy = { mode: 'fresh-context-local-preview-only', before: await storage(), input: 'fictional test canary only; no user data', studioNavigation: 'not-executed' };
      if (name === 'missing-media') {
        assert.ok(observation.requests.some(request => request.url.startsWith('LOCAL_ORIGIN/assets/') && request.disposition === 'blocked-by-test'), 'Missing-media scenario must actually block local assets');
        await waitState('Missing-media static fallback', state => state.rootClasses.split(/\s+/).includes('no3d'));
      }
      if (name === 'webgl-failure') {
        const attempts = await page.evaluate(() => window.__testWebglAttempts);
        assert.ok(attempts > 0, 'WebGL failure scenario must reach the renderer; CDN failures are not WebGL evidence');
        observation.webglAttempts = attempts;
        assert.match(observation.loaded.rootClasses, /no3d/);
      }
      // An actual anchor click establishes the scene position; subsequent checks
      // use input events rather than window.scrollTo or element.scrollTop writes.
      const sceneTarget = await page.locator('#scenes').evaluate(element => element.getBoundingClientRect().top + scrollY);
      await page.locator('#hero .hero-actions a[href="#scenes"]').click();
      const anchorDeadline = Date.now() + 10000;
      while (Math.abs((await sample()).scrollY - sceneTarget) > 3 && Date.now() < anchorDeadline) await page.waitForTimeout(100);
      observation.sceneEntry = await settled();
      observation.sceneAnchor = { target: sceneTarget, actual: observation.sceneEntry.scrollY, reached: Math.abs(observation.sceneEntry.scrollY - sceneTarget) <= 3 };
      // Older Lenis revisions can counteract the native fragment handler. Keep
      // that observation explicit; actual pre-loss wheel movement is required
      // independently before the historical context-loss negative control.
      if (name !== 'context-loss') assert.ok(observation.sceneAnchor.reached, 'Native scene anchor reaches its settled target before input checks');
      if (name === 'context-loss') {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await move('wheel-before-context-loss', () => page.mouse.wheel(0, 900), 1);
        await shot('before-context-loss');
        const lost = await page.evaluate(() => {
          const context = document.querySelector('#gl').getContext('webgl2');
          const extension = context?.getExtension('WEBGL_lose_context');
          if (!extension) return false;
          extension.loseContext(); return true;
        });
        assert.equal(lost, true, 'Software renderer must support an actual context loss');
        await waitState('Actual context-loss fallback', state => state.rootClasses.split(/\s+/).includes('no3d'), 15000);
        observation.contextLoss = 'WEBGL_lose_context.loseContext';
        observation.afterContextLoss = await sample();
        await shot('after-context-loss');
      }
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        const swipe = async direction => {
          const x = 190, start = direction > 0 ? 650 : 280, end = direction > 0 ? 280 : 650;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
          for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * i / 12 }] }); await page.waitForTimeout(20); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await move('emulated-touch-forward', () => swipe(1), 1);
        await move('emulated-touch-backward', () => swipe(-1), -1);
      } else {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await move('wheel-content-forward', () => page.mouse.wheel(0, 540), 1);
        await move('wheel-content-backward', () => page.mouse.wheel(0, -360), -1);
        await move('small-delta-wheel-forward', async () => { for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 24); await page.waitForTimeout(20); } }, 1);
        await move('small-delta-wheel-backward', async () => { for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -24); await page.waitForTimeout(20); } }, -1);
        const rail = await page.locator('.rail').boundingBox();
        const edgeState = await sample();
        observation.rightEdge = { decorativeRail: rail ? 'visible' : 'hidden-by-responsive-layout', x: rail ? rail.x + rail.width / 2 : edgeState.clientWidth - 3, y: rail ? rail.y + rail.height / 2 : viewport.height / 2 };
        await page.mouse.move(observation.rightEdge.x, observation.rightEdge.y);
        await move('wheel-right-edge-forward', () => page.mouse.wheel(0, 360), 1);
        await move('wheel-right-edge-backward', () => page.mouse.wheel(0, -240), -1);
        if (rail) assert.equal((await sample()).railPointerEvents, 'none', 'The decorative rail must not intercept input');
        for (const [key, direction] of [['PageDown', 1], ['PageUp', -1], ['Space', 1], ['Shift+Space', -1], ['ArrowDown', 1], ['ArrowUp', -1]]) {
          // Centered tickets are keyboard buttons: Space correctly flips them.
          // Establish document focus with an observed inert native click, then
          // assert that these cases test document scrolling, not control input.
          const target = await page.evaluate(() => {
            const candidates = [[8, innerHeight / 2], [document.documentElement.clientWidth - 8, innerHeight / 2], [8, innerHeight * .8]];
            return candidates.find(([x, y]) => {
              const element = document.elementFromPoint(x, y);
              return element && !element.isContentEditable && !element.closest('a,button,input,textarea,select,[tabindex],[role="button"],[contenteditable]:not([contenteditable="false"])');
            });
          });
          assert.ok(target, 'Find an inert native pointer target for document keyboard input');
          observation.keyboardSetup ||= [];
          observation.keyboardSetup.push({ key, point: target, hit: await page.evaluate(([x, y]) => { const element = document.elementFromPoint(x, y); return { tag: element.tagName, className: String(element.className), role: element.getAttribute('role') }; }, target) });
          await page.mouse.click(...target);
          assert.ok(['BODY', 'HTML'].includes((await sample()).activeTag), 'Document keyboard case must not focus an interactive control');
          await move(`keyboard-${key}`, () => page.keyboard.press(key), direction);
        }
        const drag = async proportion => {
          const state = await sample();
          assert.ok(state.innerWidth > state.clientWidth, 'A native non-overlay scrollbar is required for this drag check');
          // This runner's classic Linux Chromium scrollbar has end arrows,
          // each as tall as the gutter is wide. Exclude them from the track.
          const inset = state.innerWidth - state.clientWidth;
          const trackHeight = state.innerHeight - 2 * inset;
          const thumbHeight = Math.max(18, trackHeight * state.innerHeight / state.scrollHeight);
          const y = inset + state.scrollY / (state.scrollHeight - state.innerHeight) * (trackHeight - thumbHeight) + thumbHeight / 2;
          await page.mouse.move(state.innerWidth - (state.innerWidth - state.clientWidth) / 2, y);
          await page.mouse.down();
          await page.waitForTimeout(200);
          const pressed = await sample();
          observation.scrollbarPresses ||= [];
          observation.scrollbarPresses.push({ before: state.scrollY, pressed: pressed.scrollY, thumbCenterY: y });
          assert.ok(Math.abs(pressed.scrollY - state.scrollY) <= 2, 'Pressing the scrollbar thumb must not page the track before dragging');
          await page.mouse.move(state.innerWidth - (state.innerWidth - state.clientWidth) / 2, state.innerHeight * proportion, { steps: 15 });
          await page.mouse.up();
        };
        await move('emulated-native-scrollbar-forward', () => drag(.55), 1);
        await move('emulated-native-scrollbar-backward', () => drag(.22), -1);
      }
      await shot('after-input');
      if (name !== 'no-javascript') {
        const scenes = await page.locator('.scene .info').evaluateAll(items => items.map(element => ({ text: element.innerText.slice(0, 100), opacity: getComputedStyle(element).opacity })));
        assert.ok(scenes.length >= 5);
        if (['blocked-cdn', 'missing-media', 'webgl-failure', 'context-loss'].includes(name)) assert.ok(scenes.every(scene => Number(scene.opacity) > 0), 'Fallback scene copy stays readable');
        observation.scenes = scenes;
        await phase('maker-anchor');
        observation.beforeMakerAnchor = await sample();
        await page.locator('.navcta[href="#make"]').click();
        await waitState('Maker input focus', state => state.activeId === 'ev');
        const input = await page.locator('#ev').boundingBox();
        assert.ok(input && input.y >= 0 && input.y + input.height <= observation.viewport.height, 'Maker anchor focuses a visible input');
        observation.makerEntry = await sample();
        await shot('maker');
        if (name === 'normal') {
          const forms = await page.locator('form').count();
          await page.locator('#ev').fill('');
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#ev').getAttribute('aria-invalid'), 'true', 'Empty input produces the existing local error');
          await page.locator('#ev').fill(fictionalInput);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1200); // Covers the 60ms edit debounce and 900ms preview animation in this bounded observation.
          const after = await storage();
          const localStatus = safeMessage(await page.locator('#finNote').innerText());
          const studioDisclosure = safeMessage(await page.locator('#demoUnavailable').innerText());
          const href = await page.locator('#demoLink').getAttribute('href');
          observation.privacy = { ...observation.privacy, after, forms, observationWindowMs: 1200, localStatus, studioDisclosure, studioHref: safeUrl(href), canaryRequestAttempts: observation.requests.filter(request => request.containsFictionalInput).length, nonGetRequestAttempts: observation.requests.filter(request => request.method !== 'GET').length };
          assert.equal(forms, 0, 'Local preview has no submitting form');
          assert.equal(href, 'https://getticketstub.com/make');
          assert.match(localStatus, /Nothing was sent to the studio/);
          assert.equal(observation.privacy.canaryRequestAttempts, 0, 'Fictional input is absent from all observed request URLs and bodies');
          assert.equal(observation.privacy.nonGetRequestAttempts, 0, 'No non-GET request attempt occurs in this local preview observation');
          for (const state of [observation.privacy.before, after]) {
            assert.equal(state.cookies.length, 0, 'Fresh context has no observed cookies');
            for (const names of Object.values(state.page)) assert.equal(names.length, 0, 'Local preview leaves observed storage and service-worker registrations empty');
          }
        }
        for (let chip = 0; chip < 3; chip++) {
          await page.keyboard.press('Tab'); // Update preview button.
          for (let tab = 0; tab <= chip; tab++) await page.keyboard.press('Tab');
          const focused = await page.evaluate(() => document.activeElement?.dataset.demo);
          assert.equal(focused, ['gulls', 'nova', 'wolves'][chip], 'Keyboard navigation reaches each example chip');
          await page.keyboard.press(chip === 1 ? 'Space' : 'Enter');
          const bounds = await page.locator('#ev').boundingBox();
          const active = await page.evaluate(() => document.activeElement?.id);
          const passed = active === 'ev' && bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height;
          observation.results.push({ label: `keyboard-example-${focused}`, input: chip === 1 ? 'Space' : 'Enter', activeId: active, inputBounds: bounds, result: passed ? 'pass' : 'fail' });
          assert.ok(passed, 'Example activation returns focus to a visible input');
        }
        // Native Tab scrolling must expose the separate link at the end of the
        // current maker, without sending any locally entered fictional values.
        for (let tab = 0; tab < 5; tab++) await page.keyboard.press('Tab');
        const studio = await page.locator('#demoLink').boundingBox();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'demoLink');
        assert.ok(studio && studio.y >= 0 && studio.y + studio.height <= viewport.height, 'Native keyboard scrolling exposes the studio link');
        assert.equal(await page.locator('#demoLink').getAttribute('href'), 'https://getticketstub.com/make');
        observation.studioLink = { navigation: 'not-executed', bounds: studio, href: 'https://getticketstub.com/make' };
        await shot('keyboard-studio-link');
      }
      observation.result = 'pass';
    } catch (error) {
      observation.result = 'fail'; observation.error = safeMessage(error.message);
      observation.failureSample = await sample().catch(failure => ({ unavailable: failure.message }));
      await shot('failure').catch(() => {});
      process.exitCode = 1;
    } finally {
      observation.inputAudit = await inputAudit().catch(error => ({ unavailable: error.message }));
      observation.teardownStartedAtNodeMs = performance.now() - started;
      await context.close(); await browser.close(); browser = null;
      observation.teardownCompletedAtNodeMs = performance.now() - started;
    }
    console.log(`${name}: ${observation.result}; ${observation.results.filter(item => item.result === 'pass').length}/${observation.results.length} input checks passed${observation.error ? '; ' + observation.error : ''}`);
    await writeFile(resolve(output, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  await browser?.close(); server.close();
  report.completedAt = new Date().toISOString();
  report.result = report.scenarios.length === selected.length && report.scenarios.every(scenario => scenario.result === 'pass') ? 'pass' : 'fail';
  await writeFile(resolve(output, 'observations.json'), JSON.stringify(report, null, 2) + '\n');
}

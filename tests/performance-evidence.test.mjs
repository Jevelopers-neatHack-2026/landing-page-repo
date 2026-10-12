import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PROFILE, inspectMetrics, inspectProfile, summarizeRuns, sanitizeReport, safeUrl, closeOwnedChrome } from '../scripts/check-performance-browser.mjs';

const fixtureReport = () => ({ audits: { 'largest-contentful-paint': { numericValue: 2200 }, 'cumulative-layout-shift': { numericValue: .04 }, 'total-blocking-time': { numericValue: 100 } } });
const run = (metrics = { lcpMs: 2200, cls: .04, tbtMs: 100 }) => ({ status: 'measured', metricsValid: true, metrics, failures: [], browserClosed: true });

test('synthetic three-run median uses the actual middle value for each metric', () => {
  const summary = summarizeRuns([run({ lcpMs: 6000, cls: 0, tbtMs: 1000 }), run({ lcpMs: 2000, cls: .04, tbtMs: 100 }), run({ lcpMs: 2300, cls: .02, tbtMs: 150 })]);
  assert.deepEqual(summary.medians, { lcpMs: 2300, cls: .02, tbtMs: 150 });
  assert.equal(summary.meetsBudgets, true);
});
test('synthetic missing third measurement cannot pass from two good runs', () => assert.equal(summarizeRuns([run(), run()]).meetsBudgets, false));
test('synthetic failed, skipped or unclosed trial blocks a plausible median', () => {
  for (const bad of [{ ...run(), status: 'failed' }, { ...run(), status: 'skipped' }, { ...run(), browserClosed: false }, { ...run(), failures: ['network failed'] }, { ...run(), metricsValid: false }]) assert.equal(summarizeRuns([run(), bad, run()]).meetsBudgets, false);
});
test('synthetic nonfinite and zero LCP metrics cannot qualify', () => {
  for (const value of [NaN, Infinity, -1, 0, undefined]) assert.equal(summarizeRuns([run(), run({ lcpMs: value, cls: 0, tbtMs: 0 }), run()]).meetsBudgets, false);
});
test('synthetic actual median above an unchanged budget fails', () => {
  const summary = summarizeRuns([run({ lcpMs: 2600, cls: .2, tbtMs: 250 }), run({ lcpMs: 2700, cls: .1, tbtMs: 260 }), run({ lcpMs: 2300, cls: .01, tbtMs: 0 })]);
  assert.equal(summary.meetsBudgets, false); assert.equal(summary.medians.lcpMs, 2600);
});
test('Lighthouse numeric values do not override runtime or audit errors', () => {
  const valid = fixtureReport(); assert.equal(inspectMetrics(valid).valid, true);
  valid.runtimeError = { code: 'PROTOCOL_TIMEOUT' }; assert.equal(inspectMetrics(valid).valid, false);
  delete valid.runtimeError; valid.audits['total-blocking-time'].scoreDisplayMode = 'error'; assert.equal(inspectMetrics(valid).valid, false);
});
test('missing Lighthouse metrics stay missing instead of defaulting to zero', () => {
  const fixture = fixtureReport(); delete fixture.audits['cumulative-layout-shift']; assert.equal(inspectMetrics(fixture).valid, false);
  assert.equal(inspectMetrics(null).valid, false);
});
test('synthetic manual or notApplicable audit cannot pass even with plausible numeric values', () => {
  for (const mode of ['manual', 'notApplicable']) {
    const fixture = fixtureReport(); fixture.audits['largest-contentful-paint'].scoreDisplayMode = mode;
    const inspected = inspectMetrics(fixture); assert.equal(inspected.valid, false);
    assert.equal(summarizeRuns([run(), { ...run(), metricsValid: inspected.valid }, run()]).meetsBudgets, false);
  }
});
test('resolved profile rejects a desktop, provided-throttle or changed-budget environment', () => {
  const settings = { ...PROFILE, disableFullPageScreenshot: true, disableStorageReset: false };
  assert.deepEqual(inspectProfile(settings), []);
  assert.ok(inspectProfile({ ...settings, formFactor: 'desktop' }).length);
  assert.ok(inspectProfile({ ...settings, throttlingMethod: 'provided' }).length);
  assert.ok(inspectProfile({ ...settings, throttling: { ...PROFILE.throttling, cpuSlowdownMultiplier: 1 } }).length);
  assert.ok(inspectProfile({ ...settings, screenEmulation: { ...PROFILE.screenEmulation, width: 1440 } }).length);
});
test('sanitization removes credential URLs, query/fragment values, headers, node HTML and embedded images', () => {
  const marker = 'SYNTHETIC_NOT_A_CREDENTIAL';
  const fixture = { requestedUrl: `https://fixture:${marker}@example.invalid/path?token=${marker}#${marker}`, headers: { Authorization: marker }, details: { items: [{ snippet: `<input value="${marker}">`, nodeLabel: marker, data: `data:image/png;base64,${marker}`, nested: { outerHTML: marker }, message: `Resource https://example.invalid/x?secret=${marker}` }] }, audits: fixtureReport().audits };
  const result = sanitizeReport(fixture, 'http://127.0.0.1:1234');
  assert.equal(JSON.stringify(result.value).includes(marker), false);
  assert.equal(result.value.requestedUrl, 'https://example.invalid/path?[query-omitted]#[fragment-omitted]');
  assert.equal(result.value.audits['largest-contentful-paint'].numericValue, 2200);
  assert.ok(result.transform.counts.fieldsOmitted >= 4);
});
test('sanitization keeps complete metric/status/config categories while removing long payloads', () => {
  const fixture = { audits: fixtureReport().audits, runtimeError: { code: 'FAILED', message: 'Failure recorded' }, configSettings: { ...PROFILE }, data: 'x'.repeat(9000) };
  const result = sanitizeReport(fixture, null).value;
  assert.deepEqual(result.audits, fixture.audits); assert.equal(result.runtimeError.code, 'FAILED');
  assert.deepEqual(result.configSettings, fixture.configSettings); assert.equal(result.data, '[embedded-or-long-string-omitted]');
});
test('local URL rewrite preserves path but never local port, query or fragment', () => {
  assert.equal(safeUrl('http://127.0.0.1:1234/?q=fixture#test', 'http://127.0.0.1:1234'), 'LOCAL_ORIGIN/?[query-omitted]#[fragment-omitted]');
  assert.equal(safeUrl('data:text/html,fixture', null), '[embedded-or-non-http-url-omitted]');
});
test('synthetic synchronous ChromeLauncher kill return is not a child-close receipt', async () => {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  let killed = false;
  await assert.rejects(closeOwnedChrome({ chromeProcess: child, kill() { killed = true; } }, 15), /deadline exceeded/);
  assert.equal(killed, true);
});
test('synthetic owned child close event is awaited and recorded', async () => {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  const result = await closeOwnedChrome({ chromeProcess: child, kill() { setImmediate(() => child.emit('close', null, 'SIGKILL')); } }, 1000);
  assert.equal(result.closed, true); assert.equal(result.evidence, 'owned-child-close-event'); assert.equal(result.signalCode, 'SIGKILL');
});

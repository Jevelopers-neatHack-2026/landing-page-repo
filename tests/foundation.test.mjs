import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { buildSite, root, withBuildLock } from '../scripts/build.mjs';
import { validateArtifact } from '../scripts/artifact.mjs';
import { createPreview } from '../scripts/preview.mjs';
import { inspectSectionAnchors } from '../scripts/suites/foundation.mjs';

const page = await readFile(resolve(root, 'site/index.html'), 'utf8');
test('included page sections have unique anchors on the documented existing surfaces', () => {
  assert.deepEqual(inspectSectionAnchors(page), {
    anchors: ['top', 'hero', 'problem', 'benefits', 'scenes', 'how', 'studio', 'gallery', 'wall', 'make', 'about'],
    coverage: 'static-section-targets',
  });
});

for (const id of ['problem', 'benefits', 'gallery', 'about']) {
  test(`missing included #${id} target fails even when no current navigation link refers to it`, () => {
    assert.throws(() => inspectSectionAnchors(page.replace(` id="${id}"`, '')), new RegExp(`Included section anchor missing: #${id}`));
  });
}

test('comments, scripts and templates cannot replace a missing section anchor', () => {
  const missing = page.replace(' id="problem"', '');
  const fake = '<section class="statement" id="problem"></section>';
  for (const inert of [`<!-- ${fake} -->`, `<script>const fixture = '${fake}';</script>`, `<template>${fake}</template>`]) {
    assert.throws(() => inspectSectionAnchors(missing + inert), /Included section anchor missing: #problem/);
  }
});

test('misplaced, duplicate and hidden anchors fail instead of satisfying the page map', () => {
  assert.throws(() => inspectSectionAnchors(page.replace(' id="problem"', '') + '<span id="problem"></span>'), /wrong element/);
  assert.throws(() => inspectSectionAnchors(page.replace('class="statement grain"', 'class="unrelated"')), /wrong surface/);
  assert.throws(() => inspectSectionAnchors(page + '<span id="problem"></span>'), /Duplicate static element IDs/);
  assert.throws(() => inspectSectionAnchors(page.replace('id="problem"', 'id="problem" id="different"')), /Repeated id attribute/);
  for (const hidden of ['hidden', 'inert', 'aria-hidden="true"']) {
    assert.throws(() => inspectSectionAnchors(page.replace('id="problem"', `id="problem" ${hidden}`)), /#problem is hidden/);
  }
});

test('page-map validation rejects a dangling public fragment without inventing navigation', () => {
  assert.throws(() => inspectSectionAnchors(page + '<a href="#absent-surface">Fixture</a>'), /Missing public fragment target/);
});

for (const [name, insertion, removeProblem, expected] of [
  ['nested template contents', '<template><template></template><section class="statement" id="problem"></section></template>', true, /Included section anchor missing: #problem/],
  ['textarea literal text', '<textarea><section class="statement" id="problem"></section></textarea>', true, /Included section anchor missing: #problem/],
  ['encoded duplicate ID', '<span id="pro&#98;lem"></span>', false, /literal ASCII/],
  ['slash in an unquoted ID', '<section class="statement" id=problem/></section>', true, /literal ASCII/],
]) {
  test(`built artifact rejects ${name} from independent FND review`, async t => {
    const repository = await sandbox(t, true);
    const source = (removeProblem ? page.replace(' id="problem"', '') : page).replace('</body>', insertion + '</body>');
    await writeFile(resolve(repository, 'site/index.html'), source);
    const { output } = await buildSite({ repository });
    await validateArtifact(repository, output);
    assert.throws(() => inspectSectionAnchors(source), expected);
  });
}

test('ambiguous encoded or whitespace-prefixed public fragments fail closed', () => {
  for (const href of ['#pro&#98;lem', '#pro%62lem', '&#35;problem', '&num;problem', ' #problem']) {
    assert.throws(() => inspectSectionAnchors(page + `<a href="${href}">Fixture</a>`), /literal ASCII fragment/);
  }
});

async function sandbox(t, actual = false) {
  const repository = await mkdtemp(resolve(tmpdir(), 'lp-foundation-test-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  if (actual) await cp(resolve(root, 'site'), resolve(repository, 'site'), { recursive: true });
  else {
    await mkdir(resolve(repository, 'site/assets'), { recursive: true });
    await writeFile(resolve(repository, 'site/index.html'), '<img src="assets/sample.svg">');
    await writeFile(resolve(repository, 'site/assets/sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  }
  return repository;
}

test('actual illustrated source builds reproducibly with every asset and no repository documents', async t => {
  const repository = await sandbox(t, true);
  const {output,files} = await buildSite({ repository });
  assert.ok(files.length >= 11);
  await validateArtifact(repository, output);
  const first = await readFile(resolve(output, 'manifest.json'));
  await writeFile(resolve(output, 'stale-private-note.md'), 'must disappear');
  await buildSite({ repository });
  assert.deepEqual(await readFile(resolve(output, 'manifest.json')), first);
  await validateArtifact(repository, output);
});

test('validator detects missing referenced assets, tampering, stale manifests and unexpected files', async t => {
  const repository = await sandbox(t);
  const {output} = await buildSite({ repository });
  await writeFile(resolve(output, 'assets/sample.svg'), '<svg>tampered</svg>');
  await assert.rejects(validateArtifact(repository, output), /hash\/source mismatch/);
  await buildSite({ repository });
  const manifestPath = resolve(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.files['assets/sample.svg'].sha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validateArtifact(repository, output), /hash\/source mismatch/);
  await writeFile(resolve(repository, 'site/index.html'), '<img src="assets/absent.svg">');
  await buildSite({ repository });
  await assert.rejects(validateArtifact(repository, output), /Missing local reference/);
  await writeFile(resolve(output, 'private.md'), 'synthetic');
  await assert.rejects(validateArtifact(repository, output), /Unexpected/);
});

test('build refuses symlinks, unreviewed asset types and unsafe output destinations', async t => {
  const repository = await sandbox(t);
  await assert.rejects(buildSite({repository, output: repository}), /below repository\/dist/);
  await writeFile(resolve(repository, 'site/assets/secret.env'), 'synthetic=fixture');
  await assert.rejects(buildSite({ repository }), /Unreviewed asset type/);
  await rm(resolve(repository, 'site/assets/secret.env'));
  await symlink(resolve(repository, 'site/index.html'), resolve(repository, 'site/assets/leak.html'));
  await assert.rejects(buildSite({ repository }), /Unsafe asset entry/);
});

test('preview serves homepage and every actual asset; unknown and app routes cannot fall back to landing', async t => {
  const repository = await sandbox(t, true);
  const {output,files} = await buildSite({ repository });
  // Paths read from host source at 388005240aa62374d49f709afc300adb5e98cd98.
  // Responses are synthetic isolation sentinels, not host-provided acceptance fixtures.
  const fixtures = new Map([
    ['/make', {status: 200, body: 'synthetic-app', type: 'text/plain'}],
    ['/signin/confirm', {status: 401, body: 'synthetic-auth', type: 'text/plain'}],
    ['/api/health', {status: 200, body: '{"fixture":true}', type: 'application/json'}]
  ]);
  const server = createPreview({artifactDir:output, fixtures});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const homepage = await fetch(base + '/');
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-type'), /text\/html/);
  assert.equal(await homepage.text(), await readFile(resolve(output,'index.html'), 'utf8'));
  for (const name of files.filter(name => name.startsWith('assets/'))) {
    const response = await fetch(base + '/' + name);
    assert.equal(response.status, 200, name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve(output,name)));
    assert.match(response.headers.get('content-type'), /(?:image\/webp|application\/json)/);
  }
  for (const [path, fixture] of fixtures) {
    const response = await fetch(base + path);
    assert.equal(response.status, fixture.status);
    assert.equal(await response.text(), fixture.body);
  }
  for (const path of ['/unknown','/studio/fixture','/admin/nested','/api/auth/me','/README.md','/archive/','/manifest.json']) assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base + '/%2e%2e%2fREADME.md')).status,400);
  assert.equal((await fetch(base + '/', {method:'POST'})).status,405);
  assert.equal(await (await fetch(base + '/', {method:'HEAD'})).text(),'');
  const standalone = createPreview({artifactDir:output});
  await new Promise(resolve => standalone.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => standalone.close(resolve)));
  const standaloneBase = `http://127.0.0.1:${standalone.address().port}`;
  for (const path of fixtures.keys()) assert.equal((await fetch(standaloneBase+path)).status,404);
});

test('dispatcher rejects invalid arguments and no-argument validation fails for unavailable required suites', async t => {
  for (const args of [['--suite','bogus'],['--suite'],['--suite','foundation','extra'],['--mode','bogus'],['--mode','draft','--mode','release']]) {
    const result = spawnSync(process.execPath, ['scripts/validate-landing', ...args], {cwd:root, encoding:'utf8'});
    assert.equal(result.status,2);
    assert.match(result.stderr,/Usage:/);
  }
  const repository = await sandbox(t);
  await mkdir(resolve(repository,'scripts/suites'),{recursive:true});
  await writeFile(resolve(repository,'scripts/suites/foundation.mjs'),"export default async () => ({status:'PASS_LOCAL'});");
  const module = resolve(root,'scripts/validate.mjs');
  const run = args => spawnSync(process.execPath, ['--input-type=module','-e',`import {main} from ${JSON.stringify(module)}; await main(${JSON.stringify(args)}, {repository:${JSON.stringify(repository)}});`], {encoding:'utf8'});
  const all = run([]);
  assert.equal(all.status,1);
  assert.match(all.stdout,/PASS_LOCAL foundation/);
  assert.match(all.stderr,/FAIL cta: required validator unavailable/);
  assert.match(all.stderr,/FAIL governance: required validator unavailable/);
  const missing = run(['--suite','cta']);
  assert.equal(missing.status,1);
  assert.match(missing.stderr,/Implement scripts\/suites\/cta.mjs/);
  await writeFile(resolve(repository,'scripts/suites/content.mjs'), "export default async ({mode}) => ({status:mode==='draft' ? 'PASS_DRAFT' : 'PASS_DRAFT'});");
  const release = run(['--suite','content']);
  assert.equal(release.status,1);
  assert.match(release.stderr,/Draft evidence cannot pass release/);
  const draft = run(['--suite','content','--mode','draft']);
  assert.equal(draft.status,0);
  assert.match(draft.stdout,/PASS_DRAFT content/);
  assert.doesNotMatch(draft.stdout,/^PASS content/m);
});


test('pre-existing nested output symlink is rejected under exclusive ownership', async t => {
  const repository = await sandbox(t);
  const unrelated = await mkdtemp(resolve(tmpdir(), 'lp-unrelated-output-'));
  t.after(() => rm(unrelated, { recursive: true, force: true }));
  await mkdir(resolve(unrelated, 'release'), { recursive: true });
  const sentinel = resolve(unrelated, 'release/keep.txt');
  await writeFile(sentinel, 'unrelated work');
  await mkdir(resolve(repository, 'dist'));
  await symlink(unrelated, resolve(repository, 'dist/linked'));
  await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/linked/release') }), /regular directory/);
  assert.equal(await readFile(sentinel, 'utf8'), 'unrelated work');
});

test('build rejects source-containing output before removing any existing bytes', async t => {
  const repository = await sandbox(t);
  await mkdir(resolve(repository, 'dist'));
  await cp(resolve(repository, 'site'), resolve(repository, 'dist/source/site'), { recursive: true });
  await rm(resolve(repository, 'site'), { recursive: true });
  await symlink(resolve(repository, 'dist/source/site'), resolve(repository, 'site'));
  const page = await readFile(resolve(repository, 'site/index.html'));
  await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/source') }), /site must be a regular directory/);
  assert.deepEqual(await readFile(resolve(repository, 'site/index.html')), page);
});

test('build permits a new nested artifact but refuses file and symlink output components', async t => {
  const repository = await sandbox(t);
  const output = resolve(repository, 'dist/reviews/candidate/site');
  await buildSite({ repository, output });
  await validateArtifact(repository, output);
  await writeFile(resolve(repository, 'dist/file'), 'unrelated');
  await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/file/site') }), /regular directory/);
  await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/file') }), /regular directory/);
  assert.equal(await readFile(resolve(repository, 'dist/file'), 'utf8'), 'unrelated');
  await symlink(output, resolve(repository, 'dist/alias'));
  await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/alias') }), /regular directory/);
  await validateArtifact(repository, output);
});


test('cooperative writer lock excludes overlapping builds and releases after failure', async t => {
  const repository = await sandbox(t);
  await withBuildLock(repository, async () => {
    await assert.rejects(buildSite({ repository }), /writer busy/);
    await assert.rejects(buildSite({ repository, output: resolve(repository, 'dist/other') }), /writer busy/);
  });
  await assert.rejects(withBuildLock(repository, async () => { throw new Error('fixture failure'); }), /fixture failure/);
  const { output } = await buildSite({ repository });
  await validateArtifact(repository, output);
  await assert.rejects(buildSite({ repository, output: repository }), /below repository/);
  await buildSite({ repository }); // Rejected preflight must release its lock too.
});

test('cross-process cooperative ancestor replacement excludes builds until it finishes', { timeout: 10000 }, async t => {
  const repository = await sandbox(t);
  const unrelated = await mkdtemp(resolve(tmpdir(), 'lp-cooperative-writer-'));
  t.after(() => rm(unrelated, { recursive: true, force: true }));
  const output = resolve(repository, 'dist/slot/release');
  await mkdir(output, { recursive: true });
  await mkdir(resolve(unrelated, 'release'));
  const sentinel = resolve(unrelated, 'release/keep.txt');
  await writeFile(sentinel, 'unrelated work');
  const script = `
    import { withBuildLock } from ${JSON.stringify(new URL('../scripts/build.mjs', import.meta.url).href)};
    import { rm, symlink } from 'node:fs/promises';
    await withBuildLock(process.argv[1], async () => {
      process.stdin.resume();
      const released = new Promise(resolve => process.stdin.once('data', resolve));
      process.stdout.write('locked\\n');
      await released;
      await rm(process.argv[1] + '/dist/slot', { recursive: true });
      await symlink(process.argv[2], process.argv[1] + '/dist/slot');
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, repository, unrelated], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Writer exited before lock: ${code} ${errors}`)));
  });
  await assert.rejects(buildSite({ repository, output }), /writer busy/);
  assert.equal(await readFile(sentinel, 'utf8'), 'unrelated work');
  child.stdin.end('finish');
  assert.equal(await exited, 0, errors);
  // Once the writer completes, static preflight rejects its now-visible symlink.
  await assert.rejects(buildSite({ repository, output }), /regular directory/);
  assert.equal(await readFile(sentinel, 'utf8'), 'unrelated work');
  await assert.rejects(readFile(resolve(unrelated, 'release/index.html')), { code: 'ENOENT' });
});

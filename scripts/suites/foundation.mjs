import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateArtifact } from '../artifact.mjs';
import { spawnSync } from 'node:child_process';

// The current one-page map binds included surfaces to their existing elements.
// This checks static markup; it does not certify browser positioning or approval.
export const sectionAnchors = {
  top: ['main'], hero: ['section', 'hero'], problem: ['section', 'statement'],
  benefits: ['section', 'interlude'], scenes: ['section', 'scenes-intro'],
  how: ['section', 'how'], studio: ['section', 'studio'], gallery: ['section', 'gallery'],
  wall: ['section', 'board'], make: ['span'], about: ['footer'],
};

export function inspectSectionAnchors(html) {
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const elements = [...markup.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)].map(match => {
    const pairs = [...match[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]);
    assert.ok(pairs.filter(([name]) => name === 'id').length <= 1, 'Repeated id attribute');
    return { tag: match[1].toLowerCase(), attributes: Object.fromEntries(pairs), opening: match[2] };
  });
  const targets = elements.filter(element => element.attributes.id);
  assert.equal(new Set(targets.map(element => element.attributes.id)).size, targets.length, 'Duplicate static element IDs');
  for (const [id, [tag, className]] of Object.entries(sectionAnchors)) {
    const target = targets.find(element => element.attributes.id === id);
    assert.ok(target, `Included section anchor missing: #${id}`);
    assert.equal(target.tag, tag, `Section anchor #${id} is on the wrong element`);
    if (className) assert.ok((target.attributes.class || '').split(/\s+/).includes(className), `Section anchor #${id} is on the wrong surface`);
    assert.ok(!/(?:^|\s)(?:hidden|inert)(?:\s|=|$)/i.test(target.opening) && target.attributes['aria-hidden'] !== 'true', `Included section anchor #${id} is hidden`);
  }
  for (const element of elements.filter(element => element.tag === 'a' && element.attributes.href?.startsWith('#'))) {
    assert.ok(targets.some(target => target.attributes.id === element.attributes.href.slice(1)), `Missing public fragment target: ${element.attributes.href}`);
  }
  return { anchors: Object.keys(sectionAnchors), coverage: 'static-section-targets' };
}

export default async function run({ root, artifactDir }) {
  await validateArtifact(root, artifactDir);
  const sections = inspectSectionAnchors(await readFile(resolve(artifactDir, 'index.html'), 'utf8'));
  const result = spawnSync(process.execPath, ['--test', 'tests/foundation.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `Foundation tests exited ${result.status}`);
  return { status: 'PASS_LOCAL', ...sections };
}

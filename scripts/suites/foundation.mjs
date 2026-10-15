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

const literalId = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Bounded scanner for this static page, not an HTML conformance parser. Respect
// quoted tag attributes, raw-text/RCDATA bodies and nested inert templates.
// IDs use the page's literal ASCII convention; encoded spellings fail closed.
function staticElements(html) {
  const elements = [], rawText = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
  let cursor = 0, templateDepth = 0;
  while (cursor < html.length) {
    cursor = html.indexOf('<', cursor);
    if (cursor < 0) break;
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      assert.ok(end >= 0, 'Unclosed static HTML comment'); cursor = end + 3; continue;
    }
    const doctype = html.slice(cursor).match(/^<!doctype\s+html\s*>/i);
    if (doctype) { cursor += doctype[0].length; continue; }
    assert.ok(!/[!?]/.test(html[cursor + 1] || ''), 'Unsupported static HTML declaration');
    const start = html.slice(cursor).match(/^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i);
    if (!start) { cursor++; continue; }
    let end = cursor + start[0].length, quote = null;
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) { if (character === quote) quote = null; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    assert.ok(end < html.length, 'Unclosed static HTML tag');
    const opening = html.slice(cursor + start[0].length, end);
    cursor = end + 1;
    const tag = start[2].toLowerCase();
    if (start[1]) { if (tag === 'template' && templateDepth) templateDepth--; continue; }
    const attributes = Object.create(null);
    let rest = opening;
    while (rest.trim()) {
      // A slash belongs to an unquoted value until whitespace or a quoted value
      // ends that attribute. Only recognize the marker between attributes.
      if (rest.trim() === '/') break;
      const attribute = rest.match(/^\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/);
      assert.ok(attribute, 'Unsupported static attribute syntax');
      const name = attribute[1].toLowerCase();
      assert.ok(!Object.hasOwn(attributes, name), name === 'id' ? 'Repeated id attribute' : 'Repeated static attribute');
      attributes[name] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      rest = rest.slice(attribute[0].length);
    }
    if (!templateDepth) elements.push({ tag, attributes });
    if (tag === 'template') templateDepth++;
    if (tag === 'plaintext') cursor = html.length;
    else if (rawText.has(tag)) {
      const close = new RegExp(`</${tag}(?=[\\s/>])`, 'ig'); close.lastIndex = cursor;
      cursor = close.exec(html)?.index ?? html.length;
    }
  }
  return elements;
}

export function inspectSectionAnchors(html) {
  const elements = staticElements(html);
  for (const element of elements) if (Object.hasOwn(element.attributes, 'id')) {
    assert.match(element.attributes.id, literalId, 'Static IDs require literal ASCII spellings; encoded/ambiguous IDs need review');
  }
  const targets = elements.filter(element => element.attributes.id);
  assert.equal(new Set(targets.map(element => element.attributes.id)).size, targets.length, 'Duplicate static element IDs');
  for (const [id, [tag, className]] of Object.entries(sectionAnchors)) {
    const target = targets.find(element => element.attributes.id === id);
    assert.ok(target, `Included section anchor missing: #${id}`);
    assert.equal(target.tag, tag, `Section anchor #${id} is on the wrong element`);
    if (className) assert.ok((target.attributes.class || '').split(/\s+/).includes(className), `Section anchor #${id} is on the wrong surface`);
    assert.ok(!Object.hasOwn(target.attributes, 'hidden') && !Object.hasOwn(target.attributes, 'inert') && target.attributes['aria-hidden']?.toLowerCase() !== 'true', `Included section anchor #${id} is hidden`);
  }
  for (const element of elements.filter(element => element.tag === 'a' && Object.hasOwn(element.attributes, 'href'))) {
    const href = element.attributes.href;
    assert.ok((href.startsWith('#') && literalId.test(href.slice(1))) || href.startsWith('https://'), 'Public links require a literal ASCII fragment or absolute HTTPS URL; encoded/ambiguous references need review');
    if (href.startsWith('#')) assert.ok(targets.some(target => target.attributes.id === href.slice(1)), `Missing public fragment target: ${href}`);
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

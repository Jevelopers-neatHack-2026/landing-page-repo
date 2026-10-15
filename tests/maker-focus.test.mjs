import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Run the actual board-state and anchor handlers with deterministic geometry,
// native-event and timer doubles. No animation frame is executed in these cases.
// This is a source regression check, not rendered or physical-browser evidence.
const html = readFileSync(process.env.MAKER_FOCUS_TEST_HTML || new URL('../site/index.html', import.meta.url), 'utf8');
function section(from, to) {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Actual page section exists: ${from}`);
  return html.slice(start, end);
}

function element() {
  const classes = new Set();
  return {
    hidden: true, inert: false, textContent: '',
    classList: {
      contains: name => classes.has(name),
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
      add: name => classes.add(name),
      remove: name => classes.delete(name),
    },
  };
}

function harness({ reduced = false, immediate = false, nativeScroll = false, smoothStartMs = 0 } = {}) {
  let now = 0, nextTimer = 0;
  const listeners = new Map(), timers = new Map(), frames = [], calls = [];
  const elements = Object.fromEntries(['wall', 'boardUI', 'finale', 'bh1', 'ev'].map(id => [id, element()]));
  const handlers = new Map();
  const anchors = ['#make', '#scenes'].map(href => ({
    tagName: 'A', getAttribute: () => href,
    addEventListener: (type, handler) => handlers.set(href, handler),
  }));
  const document = {
    documentElement: element(), activeElement: anchors[0],
    getElementById: id => elements[id],
    querySelectorAll: () => anchors,
    querySelector: href => href === '#make' ? {} : { getBoundingClientRect: () => ({ top: 500 }) },
  };
  const context = vm.createContext({
    document, reduced, innerHeight: 600, scrollY: 0,
    performance: { now: () => now },
    history: { pushState: (_, __, href) => calls.push({ hash: href }) },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener(type, handler, options) {
      const entries = listeners.get(type) || new Map();
      entries.set(handler, options); listeners.set(type, entries);
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    scrollTo(options) {
      calls.push({ scroll: options });
      if (immediate || (nativeScroll && options.behavior !== 'smooth')) context.scrollY = options.top;
      else if (nativeScroll) {
        const id = ++nextTimer;
        timers.set(id, { due: now + smoothStartMs, callback: () => {
          context.scrollY = options.top; dispatch('scroll');
        } });
      }
    },
  });
  context.window = context;
  Object.assign(elements.wall, {
    offsetTop: 12000, offsetHeight: 6000,
    getBoundingClientRect() { const top = this.offsetTop - context.scrollY; return { top, bottom: top + this.offsetHeight, height: this.offsetHeight }; },
  });
  elements.ev.focus = options => {
    calls.push({ focus: options, at: now, inert: elements.finale.inert, hidden: elements.boardUI.hidden });
    if (!elements.finale.inert && !elements.boardUI.hidden) document.activeElement = elements.ev;
  };
  vm.runInContext(section('/* =============================== board state (shared', '// nav colour follows'), context);
  vm.runInContext(section('/* ---------- in-page links:', '// Progress follows native'), context);
  const baselineListeners = new Map([...listeners].map(([type, entries]) => [type, entries.size]));
  function dispatch(type) {
    let prevented = false;
    for (const [handler, options] of [...(listeners.get(type) || [])]) {
      if (!listeners.get(type)?.has(handler)) continue;
      if (options?.once) listeners.get(type).delete(handler);
      handler({ type, preventDefault() { prevented = true; } });
    }
    return prevented;
  }
  function advance(ms) {
    const until = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      const [id, timer] = entry; timers.delete(id); now = timer.due; timer.callback();
    }
    now = until;
  }
  return {
    context, document, elements, frames, timers, calls, dispatch, advance,
    target: () => elements.wall.offsetTop + elements.wall.offsetHeight - context.innerHeight * 1.02,
    click(href = '#make') { document.activeElement = anchors.find(anchor => anchor.getAttribute() === href); handlers.get(href)({ preventDefault() {} }); },
    arrive(y) { context.scrollY = y; dispatch('scroll'); },
    assertClean() {
      assert.equal(timers.size, 0, 'No abandoned focus timer remains');
      for (const [type, entries] of listeners) assert.equal(entries.size, baselineListeners.get(type) || 0, `No abandoned ${type} focus listener remains`);
    },
  };
}

test('maker navigation synchronizes an in-range inert board without animation frames', () => {
  const h = harness({ reduced: true, immediate: true });
  assert.equal(h.elements.finale.inert, true);
  h.click();
  assert.equal(h.document.activeElement, h.elements.ev, 'Native field focus follows actual board geometry');
  assert.equal(h.elements.finale.inert, false);
  assert.equal(h.elements.boardUI.hidden, false);
  assert.equal(h.calls.find(call => call.scroll).scroll.behavior, 'instant');
  assert.ok(h.calls.some(call => Object.hasOwn(call, 'focus') && call.focus === undefined), 'Native focus may scroll the field into view');
  h.assertClean();
});

test('a delayed native position receipt activates the maker while rendering frames are paused', () => {
  const h = harness();
  h.click();
  assert.notEqual(h.document.activeElement, h.elements.ev);
  assert.equal(h.calls.find(call => call.scroll).scroll.behavior, 'instant');
  h.arrive(h.target());
  assert.equal(h.document.activeElement, h.elements.ev);
  h.assertClean();
});

test('direct maker entry focuses without waiting for delayed smooth-scroll startup', () => {
  // A retained actual desktop trace had no first scroll receipt for 3601.2ms.
  // Model that startup delay only for smooth navigation; frames never execute.
  const h = harness({ nativeScroll: true, smoothStartMs: 3601.2 });
  h.click();
  assert.equal(h.document.activeElement, h.elements.ev, 'The maker action must reach and focus its real geometry immediately');
  h.advance(4000);
  assert.equal(h.document.activeElement, h.elements.ev);
  assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 1);
  h.assertClean();
});

test('other anchors keep smooth navigation and honor reduced motion', () => {
  for (const reduced of [false, true]) {
    const h = harness({ reduced });
    h.click('#scenes');
    assert.equal(h.calls.find(call => call.scroll).scroll.behavior, reduced ? 'auto' : 'smooth');
    assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 0);
    h.assertClean();
  }
});

test('continuing native scroll can reach the maker after the former absolute focus timeout', () => {
  const h = harness();
  h.click(); h.advance(2000); h.arrive(14000); h.advance(1000);
  assert.notEqual(h.document.activeElement, h.elements.ev, 'Do not focus a maker before its range');
  h.arrive(h.target());
  assert.equal(h.document.activeElement, h.elements.ev, 'An active native navigation is not expired by delayed renderer frames');
  h.assertClean();
});

test('the idle deadline samples reached geometry before expiring a pending focus request', () => {
  const h = harness();
  h.click();
  h.context.scrollY = h.target(); // Compositor position arrived before a delayed DOM scroll receipt.
  h.advance(2500);
  assert.equal(h.document.activeElement, h.elements.ev);
  h.assertClean();
});

test('an off-wall idle request expires without exposing or focusing the maker', () => {
  const h = harness();
  h.click(); h.advance(2500);
  assert.equal(h.elements.finale.inert, true);
  assert.equal(h.elements.boardUI.hidden, true);
  assert.notEqual(h.document.activeElement, h.elements.ev);
  h.assertClean();
  h.arrive(h.target());
  assert.notEqual(h.document.activeElement, h.elements.ev, 'Expired requests cannot steal later focus');
});

for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
  test(`${type} cancels pending maker focus without preventing native input`, () => {
    const h = harness();
    h.click();
    assert.equal(h.dispatch(type), false);
    h.arrive(h.target()); h.advance(3000);
    assert.notEqual(h.document.activeElement, h.elements.ev);
    assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 0);
    h.assertClean();
  });
}

test('a newer maker activation owns one pending focus and cleans up after success', () => {
  const h = harness();
  h.click(); h.advance(1000); h.click(); h.arrive(h.target()); h.advance(5000);
  assert.equal(h.document.activeElement, h.elements.ev);
  assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 1);
  h.assertClean();
});

test('a different native anchor cancels the old maker focus request', () => {
  const h = harness();
  h.click(); h.click('#scenes'); h.arrive(h.target()); h.advance(3000);
  assert.notEqual(h.document.activeElement, h.elements.ev);
  assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 0);
  h.assertClean();
});

test('native board synchronization keeps manual scrolling accessible without requesting focus', () => {
  const h = harness();
  h.arrive(h.target());
  assert.equal(h.elements.finale.inert, false);
  assert.equal(h.elements.boardUI.hidden, false);
  assert.equal(h.elements.finale.classList.contains('on'), true);
  h.arrive(0);
  assert.equal(h.elements.finale.inert, true);
  assert.equal(h.elements.boardUI.hidden, true);
  assert.equal(h.calls.filter(call => Object.hasOwn(call, 'focus')).length, 0);
});

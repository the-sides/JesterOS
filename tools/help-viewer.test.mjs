import { expect, test } from 'bun:test';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import { helpArticles, searchHelpArticles } from '../frontend/src/help-content.js';
import { createHelpViewerCommands } from '../frontend/src/help-viewer-commands.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(proxyPane = false) {
  let pane = null, active = 'notes', root = true, view;
  const restores = [], panes = new Map();
  const token = new Proxy({}, { get() { throw Error('private focus token inspected'); }, ownKeys() { throw Error('private focus token enumerated'); } });
  const ctx = { profile, namespace: 'consumer', getPane: () => pane,
    setPane(value) {
      pane = value && proxyPane ? new Proxy(value, {}) : value;
      if (pane && !panes.has(pane.helpId)) panes.set(pane.helpId, createNative(pane));
      view = pane ? panes.get(pane.helpId) : null;
    },
    getActiveAppId: () => active, available: () => root, getView: () => view,
    captureFocus: () => token, restoreFocus: async (value, guard) => { if (guard()) restores.push(value); }, settle: async () => {} };
  function createNative(owned) {
    const state = { focused: null, article: { top: 0, left: 0 }, results: { top: 0, left: 0 },
      prepareGate: null, prepareResult: true, focusResult: true, scrollResult: true, hidden: false };
    return { state, available: () => root && active === owned.appId && pane === owned && !state.hidden,
      async prepare() { return state.prepareGate ? await state.prepareGate.promise : state.prepareResult; },
      controlIds: () => ['search', 'contents', 'close', ...(owned.backStack.length ? ['back'] : []),
        ...(owned.forwardStack.length ? ['forward'] : []), ...searchHelpArticles(profile, owned.appId, owned.query).map(article => `article:${article.articleId}`)],
      async focus(control) { if (state.focusResult === true && this.available() && this.controlIds().includes(control)) state.focused = control; return state.focusResult; },
      focusedControl: () => state.focused,
      async scroll(region, top, left) {
        if (state.scrollResult !== true) return state.scrollResult;
        // The viewport owns finite geometry: requested positions are not echoed.
        state[region] = { top: Math.min(top, region === 'article' ? 180 : 90), left: Math.min(left, 12) };
        return { ...state[region] };
      },
      scrollPosition: region => ({ ...state[region] }),
      bounds: () => ({ helpId: owned.helpId, appId: owned.appId, bounds: { x: 10, y: 20, width: 800, height: 600 }, controls: [], regions: [] }),
    };
  }
  const commands = createHelpViewerCommands(ctx);
  return { commands, ctx, restores, token, pane: () => pane, native: () => view,
    replaceView: () => { view = createNative(pane); },
    activate: appId => { active = appId; }, root: value => { root = value; commands.reconcile(); },
    target: () => ({ helpId: pane.helpId }),
    run: (name, target, payload = {}) => commands.handlers[`help.viewer.${name}`](target, payload),
    open: (appId = active, payload = {}) => commands.handlers['help.viewer.open']({ appId }, payload),
    read: articleId => commands.handlers['help.viewer.read']({ helpId: pane.helpId, articleId }, {}),
  };
}

test('offline search uses bounded literal AND words and returns detached original articles', () => {
  expect(searchHelpArticles(profile, 'notes', '  PLAIN-TEXT\ncloud ').map(article => article.articleId)).toEqual(['overview', 'notes-editing']);
  expect(searchHelpArticles(profile, 'notes', 'plain-text impossible-word')).toEqual([]);
  expect(searchHelpArticles(profile, 'notes', '.*')).toEqual([]);
  expect(searchHelpArticles(profile, 'notes', '[')).toEqual([]);
  expect(searchHelpArticles(profile, 'notes', ' '.repeat(256))).toEqual(helpArticles(profile, 'notes'));
  expect(searchHelpArticles(profile, 'notes', ' '.repeat(257))).toEqual([]);
  expect(helpArticles(profile, 'not-installed')).toEqual([]);
  expect(helpArticles({ ...profile, id: 'macos-sonoma' }, 'notes')).toEqual([]);
  const copied = searchHelpArticles(profile, 'notes', ''); copied[0].sections[0].paragraphs[0] = 'altered';
  expect(helpArticles(profile, 'notes')[0].sections[0].paragraphs[0]).not.toBe('altered');
  expect(helpArticles(profile, 'terminal')[0].sections[0].paragraphs.join(' ')).toContain('interior is not represented');
  expect(helpArticles(profile, 'finder').find(article => article.articleId === 'lifecycle').sections[1].paragraphs[0]).toContain('cannot be quit');
  expect(helpArticles(profile, 'notes').find(article => article.articleId === 'windows').sections[1].paragraphs[0]).toContain('one ordinary window');
});

test('owner isolation forbids background opens and cross-app article IDs while keeping same-owner pane', async () => {
  const model = fixture(); expect((await model.open('finder')).status).toBe('rejected');
  await model.open(); const original = model.pane();
  await model.read('notes-editing'); await model.open();
  expect(model.pane()).toBe(original); expect(original.articleId).toBe('notes-editing');
  const before = structuredClone(original);
  expect((await model.read('finder-files')).status).toBe('rejected'); expect(original).toEqual(before);
  model.activate('finder'); await model.open('finder'); const replacement = model.pane();
  expect(replacement.helpId).not.toBe(original.helpId);
  expect((await model.run('search', { helpId: original.helpId }, { query: 'text' })).status).toBe('rejected');
  expect(replacement.query).toBe('');
  const projection = model.commands.targets(); projection.pane.query = 'tampered'; projection.articles[0].title = 'tampered';
  expect(model.pane().query).toBe(''); expect(model.commands.targets().articles[0].title).not.toBe('tampered');
});

test('navigation records actual scroll, retains results scroll, clears forward branches and skips identical visits', async () => {
  const model = fixture(); await model.open();
  const result = await model.run('scroll', { ...model.target(), region: 'article' }, { top: 900, left: 100 });
  expect(result.target).toEqual({ ...model.target(), region: 'article', top: 180, left: 12 });
  await model.run('scroll', { ...model.target(), region: 'results' }, { top: 60 });
  await model.read('windows'); await model.read('windows');
  expect(model.pane().backStack).toEqual([{ articleId: 'overview', top: 180, left: 12 }]);
  await model.run('scroll', { ...model.target(), region: 'article' }, { top: 77 });
  await model.read('lifecycle'); await model.run('navigate', model.target(), { direction: 'back' });
  expect(model.pane().articleId).toBe('windows'); expect(model.pane().scroll.article).toEqual({ top: 77, left: 0 });
  expect(model.pane().scroll.results).toEqual({ top: 60, left: 0 });
  const history = structuredClone({ back: model.pane().backStack, forward: model.pane().forwardStack });
  await model.run('search', model.target(), { query: 'plain-text' });
  expect(model.pane().articleId).toBe('windows'); expect({ back: model.pane().backStack, forward: model.pane().forwardStack }).toEqual(history);
  await model.run('navigate', model.target(), { direction: 'forward' }); expect(model.pane().articleId).toBe('lifecycle');
  await model.run('navigate', model.target(), { direction: 'back' }); await model.read('notes-view');
  expect(model.pane().forwardStack).toEqual([]);
  for (let index = 0; index < 140; index++) await model.read(index % 2 ? 'windows' : 'overview');
  expect(model.pane().backStack).toHaveLength(128);
  for (let index = 0; index < 128; index++) expect((await model.run('navigate', model.target(), { direction: 'back' })).status).toBe('applied');
  expect((await model.run('navigate', model.target(), { direction: 'back' })).status).toBe('rejected');
});

test('observe commands accept only the actual current native focus and scroll owner', async () => {
  const model = fixture(); await model.open();
  expect((await model.run('focus', { ...model.target(), controlId: 'close' }, { observe: true })).status).toBe('rejected');
  expect(model.pane().focusedControl).toBe('search');
  await model.native().focus('contents');
  expect((await model.run('focus', { ...model.target(), controlId: 'contents' }, { observe: true })).status).toBe('applied');
  expect((await model.run('scroll', { ...model.target(), region: 'article' }, { top: 3, observe: true })).status).toBe('rejected');
  await model.native().scroll('article', 15, 2);
  expect((await model.run('scroll', { ...model.target(), region: 'article' }, { top: 15, left: 2, observe: true })).status).toBe('applied');
  model.native().state.hidden = true;
  expect((await model.run('focus', { ...model.target(), controlId: 'contents' }, { observe: true })).status).toBe('rejected');
  expect(model.pane().scroll.article).toEqual({ top: 15, left: 2 });
});

test('native failure rejects atomically, including invalid truthy bridge returns', async () => {
  const model = fixture(); await model.open(); const before = structuredClone(model.pane());
  model.native().state.prepareResult = 'yes';
  expect((await model.read('windows')).status).toBe('rejected'); expect(model.pane()).toEqual(before);
  model.native().state.prepareResult = true; model.native().state.scrollResult = { top: NaN, left: 0 };
  expect((await model.read('windows')).status).toBe('rejected'); expect(model.pane()).toEqual(before);
  expect((await model.run('search', model.target(), { query: 'plain-text' })).status).toBe('rejected'); expect(model.pane()).toEqual(before);
  model.native().state.focusResult = 'truthy';
  expect((await model.run('focus', { ...model.target(), controlId: 'close' })).status).toBe('rejected'); expect(model.pane()).toEqual(before);
  expect((await model.run('search', model.target(), { query: 'x'.repeat(257) })).status).toBe('rejected');
  expect((await model.run('scroll', { ...model.target(), region: 'article' }, { top: Infinity })).status).toBe('rejected');
});

test('failed replacement restores original pane without inspecting opaque focus tokens', async () => {
  const model = fixture(); await model.open(); const old = model.pane(); model.activate('finder');
  const replacement = model.open('finder'); model.native().state.prepareResult = false;
  expect((await replacement).status).toBe('rejected'); expect(model.pane()).toBe(old); expect(model.restores).toEqual([model.token]);
  model.activate('notes'); await model.run('close', model.target()); expect(model.pane()).toBeNull();
  expect(model.restores.at(-1)).toBe(model.token);
});

test('pending preparation cannot borrow a replacement pane or its native facade', async () => {
  const model = fixture(); await model.open(); const old = model.pane(), gate = deferred();
  model.native().state.prepareGate = gate; const pending = model.read('windows');
  model.activate('finder'); await model.open('finder'); const replacement = model.pane();
  gate.resolve(true); expect((await pending).status).toBe('rejected');
  expect(model.pane()).toBe(replacement); expect(replacement.articleId).toBe('overview'); expect(old.articleId).toBe('overview');
  expect(model.restores).toEqual([]);
});

test('root replacement and disposal invalidate pending open without restoring stale focus', async () => {
  const model = fixture(), gate = deferred();
  const pending = model.open(); model.native().state.prepareGate = gate;
  // Open first awaits the render settlement, allowing a deterministic root cutover.
  await Promise.resolve(); model.root(false); model.root(true); await model.open(); const current = model.pane();
  gate.resolve(true); expect((await pending).status).toBe('rejected'); expect(model.pane()).toBe(current); expect(model.restores).toEqual([]);
  const nextGate = deferred(); model.native().state.prepareGate = nextGate;
  const next = model.read('windows'); model.commands.dispose(); nextGate.resolve(true);
  expect((await next).status).toBe('rejected'); expect(model.pane()).toBeNull(); expect(model.restores).toEqual([]);
  expect((await model.open()).status).toBe('rejected');
});

test('valid-looking native scroll reports must agree with the actual viewport', async () => {
  const model = fixture(); await model.open(); const before = structuredClone(model.pane());
  model.native().state.scrollResult = { top: 42, left: 0 };
  expect((await model.run('scroll', { ...model.target(), region: 'article' }, { top: 42 })).status).toBe('rejected');
  expect(model.pane()).toEqual(before);
  model.native().state.scrollResult = true; model.native().state.focusResult = false;
  expect((await model.open('notes', { articleId: 'windows' })).status).toBe('rejected');
  expect(model.pane()).toEqual(before);
});

test('same pane cannot adopt a replacement native view after original preparation', async () => {
  const model = fixture(); await model.open(); const gate = deferred(), before = structuredClone(model.pane());
  model.native().state.prepareGate = gate; const pending = model.read('windows');
  model.replaceView(); gate.resolve(true);
  expect((await pending).status).toBe('rejected'); expect(model.pane()).toEqual(before);
  expect(model.native().state.focused).toBeNull();
});

test('an older failed open cannot roll back a newer pane or restore its old invoker', async () => {
  const model = fixture(); await model.open(); model.activate('finder');
  const gate = deferred(), pending = model.open('finder');
  model.native().state.prepareGate = gate; await Promise.resolve();
  model.activate('notes'); await model.open('notes'); const current = model.pane();
  gate.resolve(false); expect((await pending).status).toBe('rejected');
  expect(model.pane()).toBe(current); expect(current.appId).toBe('notes'); expect(model.restores).toEqual([]);
});

test('private interruption hand-off retains only the opaque current invoker, never projected data', async () => {
  const model = fixture();
  expect(model.commands.getReturnFocus()).toBeUndefined();
  const pending = model.open();
  expect(model.commands.getReturnFocus()).toBe(model.token);
  await pending; expect(model.commands.getReturnFocus()).toBe(model.token);
  const transported = JSON.parse(JSON.stringify(model.commands.targets()));
  expect(transported.pane.helpId).toBe(model.pane().helpId);
  transported.pane.query = 'detached'; expect(model.pane().query).toBe('');
  model.root(false); expect(model.commands.getReturnFocus()).toBeUndefined(); expect(model.restores).toEqual([]);
});

test('reactive pane proxies retain identity leases and transport detached history', async () => {
  const model = fixture(true); expect((await model.open()).status).toBe('applied');
  const original = model.pane();
  await model.run('scroll', { ...model.target(), region: 'article' }, { top: 35 });
  expect((await model.read('windows')).status).toBe('applied');
  const projection = model.commands.targets();
  expect(projection.pane.backStack).toEqual([{ articleId: 'overview', top: 35, left: 0 }]);
  projection.pane.backStack[0].top = 999;
  await model.run('navigate', model.target(), { direction: 'back' });
  expect(model.pane()).toBe(original); expect(original.scroll.article).toEqual({ top: 35, left: 0 });
});

import { expect, test } from 'bun:test';
import { rankSpotlightSources, searchSpotlightSources } from '../frontend/src/spotlight-model.js';
import { createSpotlightCommands } from '../frontend/src/spotlight-commands.js';
import { spotlightPreferencesDefaults } from '../frontend/src/spotlight-preferences.js';

const source = (kind, id, label, terms = []) => ({ kind, id, label, terms, secondary: '', icon: null, canReveal: kind === 'file', token: {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(initial = [source('file', 'one', 'Résumé')], beforeOpen) {
  let pane = null, sources = initial, foreground = true, root = true, view;
  const activated = [], restored = [], token = new Proxy({}, { ownKeys() { throw Error('private token inspected'); } });
  let activationGate = null;
  const activationStarted = deferred();
  const ctx = { profile: { id: 'macos-golden-gate-27.0.1' }, namespace: 'test', getPane: () => pane,
    setPane(value) { pane = value; view = value ? createView(value) : null; }, getView: () => view,
    available: () => foreground, alive: () => root, getSources: () => sources, isSourceCurrent: item => sources.includes(item),
    getPreferences: spotlightPreferencesDefaults,
    captureReturn: () => token, restoreReturn: async (value, guard) => { if (guard()) restored.push(value); }, dismissMenus() {}, settle: async () => {},
    ...(beforeOpen ? { beforeOpen } : {}),
    async activate(item, action, guard) {
      activationStarted.resolve();
      if (activationGate) await activationGate.promise;
      if (!guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original source retired' } };
      activated.push({ item, action }); return { status: 'applied', target: { appId: 'finder', windowId: 'real-window', itemId: item.id } };
    } };
  function createView(owner) {
    const state = { focused: null, composing: false, scroll: { top: 0, left: 0 }, prepareGate: null, focusResult: true, revealed: [] };
    return { state, available: () => root && foreground && pane === owner,
      describe() { return { composing: state.composing, focusedControl: state.focused, scroll: { ...state.scroll },
        controlIds: ['search', 'close', ...(owner.busy ? [] : ['open', 'reveal', ...owner.results.map(result => `result:${result.resultId}`)])] }; },
      async prepare(control, guard) { if (state.prepareGate) await state.prepareGate.promise; return guard() && this.available(); },
      async focus(control, selection, guard) { if (!guard() || !this.available() || state.focusResult !== true) return false; state.focused = control; return true; },
      async setQuery(query, guard) { return guard() && !state.composing; },
      async reveal(resultId, guard) { if (!guard()) return false; state.revealed.push(resultId); return true; },
      async scroll(requested, guard) { if (!guard()) return null; state.scroll = { top: Math.min(80, requested.top), left: Math.min(5, requested.left) }; return { ...state.scroll }; },
    };
  }
  const commands = createSpotlightCommands(ctx);
  return { commands, activated, restored, activationStarted: activationStarted.promise, pane: () => pane, view: () => view,
    sources(value) { sources = value; commands.reconcile(); }, foreground(value) { foreground = value; commands.reconcile(); },
    root(value) { root = value; commands.reconcile(); }, activationGate(value) { activationGate = value; },
    target: () => ({ spotlightId: pane.spotlightId }), run: (name, target = {}, payload = {}) => commands.handlers[`spotlight.${name}`](target, payload),
  };
}

test('Unicode AND ranking is literal, deterministic, group ordered and untruncated', () => {
  const items = [source('mail', 'same', 'Résumé'), source('note', 'same', 'Résumé'), source('file', 'same', 'Résumé'),
    source('contact', 'same', 'Résumé'), source('app', 'same', 'Résumé'), source('file', 'prefix', 'Résumé draft'),
    source('file', 'label', 'A résumé'), source('file', 'content', 'Other', ['résumé'])];
  expect(searchSpotlightSources(items, ' RESUME ').map(item => item.resultId)).toEqual([
    'app:same', 'file:same', 'note:same', 'file:prefix', 'file:label', 'file:content', 'contact:same', 'mail:same']);
  expect(rankSpotlightSources(items, 'draft resume').map(item => item.id)).toEqual(['prefix']);
  expect(searchSpotlightSources(items, '.*')).toEqual([]);
  expect(searchSpotlightSources(items, ' ')).toEqual([]);
  expect(searchSpotlightSources(items, 'x'.repeat(257))).toEqual([]);
  const many = Array.from({ length: 300 }, (_, index) => source('note', String(index), 'Résumé'));
  expect(searchSpotlightSources(many, 'resume')).toHaveLength(300);
});

test('same-ID replacement cannot acquire original result authority through reconciliation', async () => {
  const old = source('file', 'one', 'Résumé'), model = fixture([old]);
  await model.run('open'); await model.run('query', model.target(), { query: 'resume' });
  const target = { ...model.target(), resultId: 'file:one' };
  model.sources([source('file', 'one', 'Résumé')]);
  expect(model.pane().results).toEqual([]);
  expect((await model.run('openResult', target)).status).toBe('rejected'); expect(model.activated).toEqual([]);
  await model.run('query', model.target(), { query: 'resume' });
  expect((await model.run('reveal', target)).target).toEqual({ ...target, action: 'reveal', appId: 'finder', windowId: 'real-window', itemId: 'one' });
  expect(model.pane()).toBeNull(); expect(model.restored).toEqual([]);
});

test('composition and native focus failure reject query without changing canonical results', async () => {
  const model = fixture(); await model.run('open'); const before = model.commands.summary();
  model.view().state.composing = true;
  expect((await model.run('query', model.target(), { query: 'resume' })).status).toBe('rejected'); expect(model.commands.summary()).toEqual(before);
  model.view().state.composing = false; model.view().state.focusResult = false;
  expect((await model.run('query', model.target(), { query: 'resume' })).status).toBe('rejected'); expect(model.commands.summary()).toEqual(before);
});

test('late native preparation cannot borrow a reopened or suspended owner', async () => {
  const model = fixture(); await model.run('open'); const gate = deferred(); model.view().state.prepareGate = gate;
  const old = model.target(), pending = model.run('query', old, { query: 'resume' });
  model.commands.clear(); await model.run('open'); const fresh = model.pane(); gate.resolve();
  expect((await pending).status).toBe('rejected'); expect(model.pane()).toBe(fresh); expect(fresh.query).toBe('');
  const secondGate = deferred(); model.view().state.prepareGate = secondGate;
  const suspended = model.run('query', model.target(), { query: 'resume' });
  model.foreground(false); model.foreground(true); secondGate.resolve();
  expect((await suspended).status).toBe('rejected'); expect(fresh.query).toBe('');
});

test('opening across a pending overlay cutover cannot borrow a resumed or replaced Root', async () => {
  for (const retire of [
    model => model.root(false),
    model => { model.foreground(false); model.foreground(true); },
    model => model.commands.clear(),
  ]) {
    const gate = deferred(), started = deferred();
    const model = fixture(undefined, async () => { started.resolve(); await gate.promise; return true; });
    const pending = model.run('open');
    await started.promise; retire(model); gate.resolve();
    expect((await pending).status).toBe('rejected');
    expect(model.pane()).toBeNull();
  }
});

test('pending source activation rejects replacement, duplicate activation and dead Root', async () => {
  const model = fixture(); await model.run('open'); await model.run('query', model.target(), { query: 'resume' });
  const target = { ...model.target(), resultId: 'file:one' }, gate = deferred(); model.activationGate(gate);
  const pending = model.run('openResult', target); await model.activationStarted;
  expect((await model.run('openResult', target)).status).toBe('rejected');
  model.sources([source('file', 'one', 'Résumé')]); model.root(false); gate.resolve();
  expect((await pending).status).toBe('rejected'); expect(model.activated).toEqual([]); expect(model.pane()).toBeNull();
});

test('empty navigation keeps real search focus and scrolling reports achieved viewport offsets', async () => {
  const model = fixture(); await model.run('open');
  expect((await model.run('navigate', model.target(), { direction: 'last' })).target.selectedResultId).toBeNull();
  await model.run('query', model.target(), { query: 'missing' });
  const retained = model.pane().results; model.commands.reconcile(); expect(model.pane().results).toBe(retained);
  expect((await model.run('navigate', model.target(), { direction: 'next' })).target.selectedResultId).toBeNull();
  expect((await model.run('scroll', model.target(), { top: 1000, left: 999 })).target).toEqual({ ...model.target(), top: 80, left: 5 });
  const summary = model.commands.summary(); summary.scroll.top = 999; expect(model.commands.summary().scroll.top).toBe(80);
  expect(JSON.stringify(model.commands.targets())).not.toContain('token');
});

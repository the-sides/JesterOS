import { rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice } from './command-schema.js';
import { rankSpotlightSources, publicSpotlightResult, spotlightResultId, spotlightQueryLimit } from './spotlight-model.js';

const fields = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && [...required, ...optional].includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const offsets = value => fields(value, ['top', 'left']) && position(value.top) && position(value.left);
const applied = target => ({ status: 'applied', target });
const fail = code => rejected(code, code === 'invalid_arguments' ? 'Use the closed documented Spotlight target and payload.'
  : code === 'disabled' ? 'This Spotlight action is disabled.' : 'The original Spotlight source, foreground owner or native control is unavailable.');
const targetPane = (target, extra = []) => fields(target, ['spotlightId', ...extra]) && id(target.spotlightId);
const directions = ['forward', 'backward', 'none'];

export function createSpotlightCommands(ctx) {
  const namespace = ctx.namespace ?? globalThis.crypto.randomUUID();
  let sequence = 0, epoch = 0, revision = 0, disposed = false, wasAvailable = false, ownerId = null, returnToken;
  let owners = new Map();
  const supported = () => ctx.profile.id === 'macos-golden-gate-27.0.1';
  const alive = () => !disposed && supported() && ctx.alive() === true;
  const available = () => alive() && ctx.available() === true;
  const owned = () => { const pane = ctx.getPane(); return pane?.spotlightId === ownerId ? pane : null; };
  const structural = (pane, generation) => alive() && epoch === generation && owned() === pane;
  const lease = pane => { const generation = epoch, version = ++revision; return () => structural(pane, generation) && version === revision && available(); };
  const failure = pane => fail(alive() && owned() === pane ? 'unavailable' : 'stale_target');
  async function native(call) { try { return await call(); } catch { return null; } }
  const live = (view, guard) => guard() && ctx.getView() === view && view.available() === true;
  function describe(view) { return view.describe(); }
  function controls(view) {
    const pane = owned(), allowed = new Set(['search', 'close', ...(pane && !pane.busy && pane.selectedResultId ? ['open'] : []),
      ...(pane && !pane.busy && pane.results.some(result => result.resultId === pane.selectedResultId && result.canReveal) ? ['reveal'] : []),
      ...(pane && !pane.busy ? pane.results.map(result => `result:${result.resultId}`) : [])]);
    const values = describe(view).controlIds;
    return Array.isArray(values) ? values.filter(value => allowed.has(value)) : [];
  }
  async function prepare(pane, controlId, guard, composing = false) {
    const view = ctx.getView();
    if (!view || !live(view, guard) || (!composing && describe(view).composing)) return null;
    if (await native(() => view.prepare(controlId, guard)) !== true || !live(view, guard)
      || (!composing && describe(view).composing) || !controls(view).includes(controlId)) return null;
    return view;
  }
  async function focus(view, controlId, selection, guard) {
    if (!live(view, guard) || describe(view).composing || !controls(view).includes(controlId)) return false;
    return await native(() => view.focus(controlId, selection, guard)) === true && live(view, guard)
      && describe(view).focusedControl === controlId;
  }
  function refresh(pane, fresh = false) {
    const next = new Map(fresh ? [] : owners), matched = [];
    for (const source of rankSpotlightSources(ctx.getSources(), pane.query)) {
      const resultId = spotlightResultId(source), original = next.get(resultId);
      if (original && !ctx.isSourceCurrent(original)) continue;
      const retained = original ?? source;
      if (!ctx.isSourceCurrent(retained)) continue;
      next.set(resultId, retained); matched.push(publicSpotlightResult(retained));
    }
    owners = next;
    const keys = ['resultId', 'group', 'kind', 'label', 'secondary', 'icon', 'canReveal'];
    if (pane.results.length !== matched.length || matched.some((result, index) =>
      keys.some(key => pane.results[index][key] !== result[key]))) pane.results = matched;
    if (pane.selectedResultId !== null && !matched.some(result => result.resultId === pane.selectedResultId)) pane.selectedResultId = null;
  }
  function retire() { epoch++; revision++; ownerId = null; returnToken = undefined; owners.clear(); ctx.setPane(null); }
  function reconcile() {
    if (!alive()) { if (ownerId !== null) retire(); return; }
    const foreground = available();
    if (foreground !== wasAvailable) { revision++; wasAvailable = foreground; }
    const pane = owned();
    if (pane) refresh(pane);
    else if (ownerId !== null) { epoch++; revision++; ownerId = null; owners.clear(); returnToken = undefined; }
  }
  const get = target => { const pane = owned(); return pane?.spotlightId === target.spotlightId ? pane : null; };
  async function choose(pane, resultId) {
    if (pane.busy) return fail('disabled');
    const guard = lease(pane), view = await prepare(pane, 'search', guard);
    if (!view) return failure(pane);
    refresh(pane);
    if (resultId !== null && !pane.results.some(result => result.resultId === resultId)) return fail('stale_target');
    if (!await focus(view, 'search', undefined, guard)) return failure(pane);
    if (resultId !== null && (await native(() => view.reveal(resultId, guard)) !== true || !live(view, guard))) return failure(pane);
    if (resultId !== null && !ctx.isSourceCurrent(owners.get(resultId))) return fail('stale_target');
    pane.selectedResultId = resultId; pane.focusedControl = 'search';
    const actual = describe(view).scroll; if (offsets(actual)) pane.scroll = { ...actual };
    return applied({ spotlightId: pane.spotlightId, selectedResultId: resultId });
  }
  async function activate(target, payload, action) {
    if (!targetPane(target, ['resultId']) || !id(target.resultId) || !fields(payload, [])) return fail('invalid_arguments');
    const pane = get(target); if (!pane) return fail('stale_target');
    if (!available()) return fail('unavailable');
    if (pane.busy) return fail('disabled');
    const source = owners.get(target.resultId);
    if (!source || !pane.results.some(result => result.resultId === target.resultId) || !ctx.isSourceCurrent(source)) return fail('stale_target');
    if (action === 'reveal' && !source.canReveal) return fail('disabled');
    const base = lease(pane), guard = () => base() && ctx.isSourceCurrent(source);
    const view = await prepare(pane, 'search', guard);
    if (!view) return guard() ? fail('unavailable') : fail('stale_target');
    pane.busy = true; pane.error = null;
    try {
      const result = await ctx.activate(source, action, guard);
      if (!guard()) return fail('stale_target');
      if (result.status !== 'applied') { pane.error = result.error?.message ?? 'The destination could not be opened.'; return result; }
      const destination = result.target;
      if (!fields(destination, ['appId', 'windowId', 'itemId']) || !id(destination.appId)
        || !(destination.windowId === null || id(destination.windowId)) || !id(destination.itemId)) throw new TypeError('Invalid Spotlight activation destination');
      retire(); await ctx.settle();
      return applied({ spotlightId: target.spotlightId, resultId: target.resultId, action, ...destination });
    } finally { if (owned() === pane) pane.busy = false; }
  }
  const handlers = {
    'spotlight.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return fail('invalid_arguments');
      if (!available()) return fail('unavailable');
      let pane = owned(); const reused = !!pane;
      if (pane?.busy) return fail('disabled');
      if (!pane) {
        const token = ctx.captureReturn(); ctx.dismissMenus(); epoch++; revision++; wasAvailable = true;
        ownerId = `${namespace}-spotlight-${++sequence}`; returnToken = token; owners.clear();
        ctx.setPane({ spotlightId: ownerId, query: '', selectedResultId: null, results: [], busy: false, error: null,
          scroll: { top: 0, left: 0 }, focusedControl: null });
        pane = owned();
      }
      const guard = lease(pane); await ctx.settle();
      const view = guard() ? await prepare(pane, 'search', guard) : null;
      if (!view || !await focus(view, 'search', undefined, guard)) {
        const result = failure(pane);
        if (!reused && owned() === pane && alive()) {
          const token = returnToken; retire(); const generation = epoch; await ctx.settle();
          await native(() => ctx.restoreReturn(token, () => available() && epoch === generation && ctx.getPane() === null));
        }
        return result;
      }
      pane.focusedControl = 'search'; return applied({ spotlightId: pane.spotlightId, reused });
    },
    'spotlight.close': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, [], ['restoreFocus']) || payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean') return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      if (!available()) return fail('unavailable');
      const token = returnToken; retire(); const generation = epoch; await ctx.settle();
      if (payload.restoreFocus !== false) await native(() => ctx.restoreReturn(token, () => available() && epoch === generation && ctx.getPane() === null));
      return applied({ spotlightId: target.spotlightId, closed: true });
    },
    'spotlight.query': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > spotlightQueryLimit) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      if (pane.busy) return fail('disabled');
      const guard = lease(pane), view = await prepare(pane, 'search', guard); if (!view) return failure(pane);
      if (!await focus(view, 'search', undefined, guard)) return failure(pane);
      if (await native(() => view.setQuery(payload.query, guard)) !== true || !live(view, guard) || describe(view).composing) return failure(pane);
      pane.query = payload.query; pane.error = null; refresh(pane, true); pane.selectedResultId = pane.results[0]?.resultId ?? null;
      pane.focusedControl = 'search'; await ctx.settle();
      if (!live(view, guard)) return failure(pane);
      if (pane.selectedResultId && (await native(() => view.reveal(pane.selectedResultId, guard)) !== true || !live(view, guard))) return failure(pane);
      if (pane.selectedResultId && !ctx.isSourceCurrent(owners.get(pane.selectedResultId))) return fail('stale_target');
      const actual = describe(view).scroll; if (offsets(actual)) pane.scroll = { ...actual };
      return applied({ spotlightId: pane.spotlightId, query: pane.query, selectedResultId: pane.selectedResultId });
    },
    'spotlight.select': async (target, payload) => {
      if (!targetPane(target, ['resultId']) || !id(target.resultId) || !fields(payload, [])) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      const result = await choose(pane, target.resultId);
      return result.status === 'applied' ? applied({ spotlightId: pane.spotlightId, resultId: target.resultId }) : result;
    },
    'spotlight.navigate': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, ['direction']) || !['next', 'previous', 'first', 'last'].includes(payload.direction)) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target'); refresh(pane);
      const ids = pane.results.map(result => result.resultId), index = ids.indexOf(pane.selectedResultId);
      const next = payload.direction === 'first' ? 0 : payload.direction === 'last' ? ids.length - 1
        : payload.direction === 'next' ? Math.min(index + 1, ids.length - 1) : Math.max(0, index - 1);
      return choose(pane, ids[next] ?? null);
    },
    'spotlight.openResult': (target, payload) => activate(target, payload, 'open'),
    'spotlight.reveal': (target, payload) => activate(target, payload, 'reveal'),
    'spotlight.focus': async (target, payload) => {
      if (!targetPane(target, ['controlId']) || !id(target.controlId) || !fields(payload, [], ['start', 'end', 'direction'])) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      const hasSelection = Object.keys(payload).length > 0;
      if (hasSelection && (target.controlId !== 'search' || !Number.isInteger(payload.start) || !Number.isInteger(payload.end)
        || payload.start < 0 || payload.end < payload.start || payload.end > pane.query.length
        || payload.direction !== undefined && !directions.includes(payload.direction))) return fail('invalid_arguments');
      if (pane.busy) return fail('disabled');
      const guard = lease(pane), view = await prepare(pane, target.controlId, guard);
      if (!view || !await focus(view, target.controlId, hasSelection ? { ...payload, direction: payload.direction ?? 'none' } : undefined, guard)) return failure(pane);
      pane.focusedControl = target.controlId; return applied({ spotlightId: pane.spotlightId, controlId: target.controlId });
    },
    'spotlight.scroll': async (target, payload) => {
      if (!targetPane(target) || !offsets(payload)) return fail('invalid_arguments');
      const pane = get(target); if (!pane) return fail('stale_target');
      if (pane.busy) return fail('disabled');
      const guard = lease(pane), view = await prepare(pane, 'search', guard, true); if (!view) return failure(pane);
      const actual = await native(() => view.scroll(payload, guard)), observed = live(view, guard) ? describe(view).scroll : null;
      if (!offsets(actual) || !offsets(observed) || actual.top !== observed.top || actual.left !== observed.left) return failure(pane);
      pane.scroll = { ...actual }; return applied({ spotlightId: pane.spotlightId, ...actual });
    },
  };
  function summary() {
    const pane = owned(); if (!pane) return null;
    const view = available() ? ctx.getView() : null;
    const observed = view?.available() === true ? describe(view) : null;
    const focusedControl = observed?.controlIds?.includes(observed.focusedControl) ? observed.focusedControl : null;
    return { spotlightId: pane.spotlightId, query: pane.query, selectedResultId: pane.selectedResultId,
      results: pane.results.map(result => ({ ...result })), busy: pane.busy, error: pane.error,
      scroll: { ...(offsets(observed?.scroll) ? observed.scroll : pane.scroll) }, focusedControl };
  }
  return { handlers, summary, reconcile,
    targets() { const pane = summary(), view = available() && pane ? ctx.getView() : null;
      return { spotlightId: pane?.spotlightId ?? null, pane, results: pane?.results.map(result => ({ ...result })) ?? [],
        controls: view?.available() === true ? controls(view) : [] }; },
    clear() { if (!disposed) retire(); },
    dispose() { if (disposed) return; disposed = true; retire(); },
  };
}

const profiles = ['macos-golden-gate-27.0.1'], capability = 'shell.spotlight';
const query = { type: 'string', maxLength: spotlightQueryLimit };
const nullableId = { anyOf: [identity, { type: 'null' }] };
const offset = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const paneTarget = object({ spotlightId: identity }), resultTarget = object({ spotlightId: identity, resultId: identity });
const catalog = (name, target, payload, output) => defineCommand(profiles, `spotlight.${name}`, capability, target, payload,
  ['current foreground nonmodal Root', 'original live Spotlight owner and canonical source'], ['transient authored offline Spotlight'], [], [], object(output));
const destination = { spotlightId: identity, resultId: identity, action: choice('open', 'reveal'), appId: identity, windowId: nullableId, itemId: identity };
export const spotlightCatalog = Object.fromEntries([
  catalog('open', empty, empty, { spotlightId: identity, reused: flag }),
  catalog('close', paneTarget, object({ restoreFocus: flag }, []), { spotlightId: identity, closed: { const: true } }),
  catalog('query', paneTarget, object({ query }), { spotlightId: identity, query, selectedResultId: nullableId }),
  catalog('select', resultTarget, empty, { spotlightId: identity, resultId: identity }),
  catalog('navigate', paneTarget, object({ direction: choice('next', 'previous', 'first', 'last') }), { spotlightId: identity, selectedResultId: nullableId }),
  catalog('openResult', resultTarget, empty, { ...destination, action: { const: 'open' } }),
  catalog('reveal', resultTarget, empty, { ...destination, action: { const: 'reveal' } }),
  catalog('focus', object({ spotlightId: identity, controlId: identity }), object({ start: { type: 'integer', minimum: 0, maximum: 256 },
    end: { type: 'integer', minimum: 0, maximum: 256 }, direction: choice(...directions) }, []), { spotlightId: identity, controlId: identity }),
  catalog('scroll', paneTarget, object({ top: offset, left: offset }), { spotlightId: identity, top: offset, left: offset }),
]);

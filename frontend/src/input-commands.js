import { isRecord, rejected } from './feature-commands.js';
import { inputSummary, validateInputState, keyboardRows, characterResults, characterById } from './input-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && allowed.includes(key) && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented authored Input target and payload; browser physical keyboard and host IME are unchanged.');
const stale = () => rejected('stale_target', 'The original Input state, viewer or editable owner changed; a different editor is never substituted.');
const unavailable = () => rejected('unavailable', 'The original foreground Input viewer or native control is not currently available.');
const disabled = () => rejected('disabled', 'This viewer has no original available editable lease; browsing and modifiers remain available.');
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;
const snapshot = object => ({ object, prototype: Object.getPrototypeOf(object), descriptors: Object.getOwnPropertyDescriptors(object) });
const unchanged = entry => Object.getPrototypeOf(entry.object) === entry.prototype
  && Reflect.ownKeys(entry.object).length === Reflect.ownKeys(entry.descriptors).length
  && Reflect.ownKeys(entry.descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(entry.object, key), entry.descriptors[key]));
const text = value => typeof value === 'string' ? value.length : 0;
const sourceListText = values => values.reduce((total, value, index) => total + value.length + String(index).length, 0);
const paneKeys = ['viewerId', 'kind', 'shift', 'option', 'query', 'category', 'selectedCharacterId', 'error'];

/** Root-local modeless viewers. Opaque native/editor leases never enter panes,
 * summaries, menu descriptors or saved canonical data. */
export function createInputCommands(ctx) {
  const { presentation } = ctx;
  const namespace = globalThis.crypto.randomUUID();
  const entries = new Map();
  const openSequences = { keyboard: 0, characters: 0 };
  let sequence = 0, epoch = 0, foregroundEpoch = 0, disposed = false;
  const summary = () => inputSummary(ctx.getState());
  function allowed() {
    try { return !disposed && ctx.available() === true && ctx.canBegin() === true; }
    catch { return false; }
  }
  function current(root) {
    try { return !disposed && ctx.getState() === root.state && root.snapshots.every(unchanged); }
    catch { return false; }
  }
  function begin() {
    const state = ctx.getState();
    if (!validateInputState(state).ok) return { error: invalid() };
    const root = { state, snapshots: [snapshot(state), snapshot(state.sourceIds)] };
    const available = allowed();
    if (!current(root)) return { error: stale() };
    return available ? root : { error: unavailable() };
  }
  function mutate(edit, result, beforeCommit) {
    const root = begin(); if (root.error) return root.error;
    const state = root.state, plan = { ...state, sourceIds: [...state.sourceIds] };
    const denied = edit(plan); if (denied) return denied;
    if (!validateInputState(plan).ok) return invalid();
    const changes = ['activeSourceId', 'previousSourceId', 'showInMenuBar'].filter(key => state[key] !== plan[key]);
    const listChanged = state.sourceIds.length !== plan.sourceIds.length || state.sourceIds.some((value, index) => value !== plan.sourceIds[index]);
    if (changes.some(key => Object.getOwnPropertyDescriptor(state, key).writable !== true)) return invalid();
    if (listChanged) {
      const array = state.sourceIds, length = array.length;
      if (Object.getOwnPropertyDescriptor(state, 'sourceIds').writable !== true
        || length !== plan.sourceIds.length && Object.getOwnPropertyDescriptor(array, 'length').writable !== true
        || plan.sourceIds.length > length && !Object.isExtensible(array)) return invalid();
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
        if (index >= plan.sourceIds.length ? descriptor.configurable !== true
          : array[index] !== plan.sourceIds[index] && descriptor.writable !== true) return invalid();
      }
    }
    if (typeof ctx.canCommit !== 'function') return invalid();
    if (beforeCommit) beforeCommit();
    if (!current(root)) return stale();
    const delta = changes.reduce((total, key) => total + text(plan[key]) - text(state[key]), 0)
      + (listChanged ? sourceListText(plan.sourceIds) - sourceListText(state.sourceIds) : 0);
    let accepted = false;
    try { accepted = ctx.canCommit(delta) === true; } catch { /* No failed quota callback authorizes a write. */ }
    if (!current(root)) return stale();
    if (!accepted) return rejected('limit_exceeded', 'The Input transition exceeds the complete-scene text budget.');
    const available = allowed();
    if (!current(root)) return stale();
    if (!available) return unavailable();
    if (listChanged) {
      for (let index = 0; index < plan.sourceIds.length; index++) if (state.sourceIds[index] !== plan.sourceIds[index]) state.sourceIds[index] = plan.sourceIds[index];
      if (state.sourceIds.length !== plan.sourceIds.length) state.sourceIds.length = plan.sourceIds.length;
    }
    for (const key of changes) state[key] = plan[key];
    return applied(result(plan));
  }
  function ownerCurrent(original) {
    try { return ctx.ownerCurrent(original) === true; } catch { return false; }
  }
  function entryCurrent(entry) {
    return !disposed && entries.get(entry.id) === entry && presentation[entry.kind] === entry.pane
      && ctx.getState() === entry.state;
  }
  function structural(session) {
    try { return session.epoch === epoch && current(session.root) && entryCurrent(session.entry)
      && session.entry.revision === session.revision && unchanged(session.pane)
      && (session.openSequence === undefined || session.openSequence === openSequences[session.entry.kind] && session.openSequence === session.entry.openSequence)
      && (!session.active || presentation.activeKind === session.entry.kind && session.foregroundEpoch === foregroundEpoch); }
    catch { return false; }
  }
  function liveSession(session) {
    if (!structural(session)) return false;
    const owner = ownerCurrent(session.entry.original);
    if (!structural(session) || !owner) return false;
    const available = allowed();
    return structural(session) && available;
  }
  function failure(session) {
    return !structural(session) || !ownerCurrent(session.entry.original) || !structural(session) ? stale() : unavailable();
  }
  function sessionFor(viewerId, kind) {
    const entry = entries.get(viewerId);
    if (!entry || kind && entry.kind !== kind || !entryCurrent(entry)) return { error: stale() };
    const root = begin(); if (root.error) return root;
    const session = { entry, root, epoch, revision: entry.revision, pane: snapshot(entry.pane) };
    return liveSession(session) ? session : { error: failure(session) };
  }
  function update(session, values) {
    if (!liveSession(session)) return false;
    if (Object.keys(values).some(key => !paneKeys.includes(key)
      || Object.getOwnPropertyDescriptor(session.entry.pane, key)?.writable !== true)) return false;
    Object.assign(session.entry.pane, values);
    session.revision = ++session.entry.revision;
    session.pane = snapshot(session.entry.pane);
    return true;
  }
  async function native(call) { try { return await call(); } catch { return null; } }
  function viewLive(session, view) {
    if (!liveSession(session) || ctx.getView(session.entry.kind) !== view) return false;
    const available = view?.available() === true;
    return available && liveSession(session) && ctx.getView(session.entry.kind) === view;
  }
  function viewFor(session) {
    if (!liveSession(session)) return null;
    const view = ctx.getView(session.entry.kind);
    return viewLive(session, view) ? view : null;
  }
  function editable(entry) {
    try { return entryCurrent(entry) && ownerCurrent(entry.original) && allowed()
      && entry.editor !== null && ctx.editorCurrent(entry.editor) === true && entryCurrent(entry); }
    catch { return false; }
  }
  function controls(session, view) {
    if (!viewLive(session, view)) return [];
    const pane = session.entry.pane;
    const permitted = new Set(['panel', 'close', ...(pane.kind === 'keyboard'
      ? ['shift', 'option', ...keyboardRows(session.root.state.activeSourceId, pane).flat().filter(key => key.action !== 'modifier').map(key => `key:${key.keyId}`)]
      : ['search', 'insert', ...['all', 'emoji', 'symbols', 'latin'].map(category => `category:${category}`),
        ...characterResults(pane.query, pane.category).map(character => `character:${character.id}`)])]);
    const actual = view.controlIds();
    if (!Array.isArray(actual) || !viewLive(session, view)) return [];
    return [...new Set(actual.filter(control => typeof control === 'string' && permitted.has(control) && view.available(control) === true))];
  }
  async function focus(session, view, control) {
    if (!controls(session, view).includes(control) || !viewLive(session, view)) return false;
    const previous = view.focusedControl();
    if (!viewLive(session, view)) return false;
    const focused = await native(() => view.focus(control));
    if (focused === true && viewLive(session, view) && view.focusedControl() === control && viewLive(session, view)) return true;
    if (viewLive(session, view) && controls(session, view).includes(previous)) await native(() => view.focus(previous));
    return false;
  }
  function setActive(kind) {
    if (presentation.activeKind !== kind) { presentation.activeKind = kind; foregroundEpoch++; }
  }
  function activate(session) {
    if (!liveSession(session)) return false;
    setActive(session.entry.kind);
    session.active = true; session.foregroundEpoch = foregroundEpoch;
    return liveSession(session);
  }
  function discard(entry) {
    if (entries.get(entry.id) !== entry) return;
    const ownsPane = presentation[entry.kind] === entry.pane;
    entries.delete(entry.id); entry.revision++;
    entry.editor = null; entry.original = null;
    if (ownsPane) presentation[entry.kind] = null;
    if (ownsPane && presentation.activeKind === entry.kind) setActive(null);
  }
  function clear() {
    epoch++;
    for (const entry of [...entries.values()]) discard(entry);
    presentation.keyboard = null; presentation.characters = null; setActive(null);
  }
  function reconcile() {
    if (disposed) { clear(); return; }
    for (const entry of [...entries.values()]) if (!entryCurrent(entry) || !ownerCurrent(entry.original)) discard(entry);
  }
  const sourceResult = plan => ({ sourceId: plan.activeSourceId, previousSourceId: plan.previousSourceId });
  function select(plan, selected) {
    if (!plan.sourceIds.includes(selected)) return stale();
    if (plan.activeSourceId !== selected) { plan.previousSourceId = plan.activeSourceId; plan.activeSourceId = selected; }
  }
  const targetViewer = (target, extra = []) => fields(target, ['viewerId', ...extra]) && id(target.viewerId);
  const observePayload = payload => fields(payload, ['observe'], []) && (!Object.hasOwn(payload, 'observe') || typeof payload.observe === 'boolean');
  async function rollback(session, previous, view, previousQuery) {
    const entry = session.entry;
    if (session.epoch !== epoch || !entryCurrent(entry) || entry.revision !== session.revision || !unchanged(session.pane)) return;
    if (Object.keys(previous).some(key => Object.getOwnPropertyDescriptor(entry.pane, key)?.writable !== true)) return;
    Object.assign(entry.pane, previous);
    session.revision = ++entry.revision; session.pane = snapshot(entry.pane);
    await native(() => ctx.settle());
    if (previousQuery !== undefined && viewLive(session, view) && view.query() !== previousQuery) await native(() => view.setQuery(previousQuery));
  }
  async function modifiers(session, requested) {
    const view = viewFor(session); if (!view) return failure(session);
    if (typeof view.modifiers !== 'function') return unavailable();
    const previous = { shift: session.entry.pane.shift, option: session.entry.pane.option };
    const actual = view.modifiers();
    if (!fields(actual, ['shift', 'option']) || typeof actual.shift !== 'boolean' || typeof actual.option !== 'boolean'
      || actual.shift !== previous.shift || actual.option !== previous.option || !viewLive(session, view)) return unavailable();
    if (!update(session, { ...previous, ...requested }) || !activate(session)) return failure(session);
    await native(() => ctx.settle());
    if (!viewLive(session, view)) { const result = failure(session); await rollback(session, previous, view); return result; }
    const after = view.modifiers();
    if (!fields(after, ['shift', 'option']) || after.shift !== session.entry.pane.shift || after.option !== session.entry.pane.option || !viewLive(session, view)) {
      await rollback(session, previous, view); return failure(session);
    }
    return applied({ viewerId: session.entry.id, shift: after.shift, option: after.option });
  }
  async function insert(session, action, resultTarget) {
    const entry = session.entry;
    if (entry.editor === null) return disabled();
    if (!editable(entry) || !liveSession(session)) return stale();
    const editor = entry.editor;
    const captures = [];
    for (const candidate of entries.values()) {
      if (candidate !== entry && (!entryCurrent(candidate) || !ownerCurrent(candidate.original)
        || candidate.editor === null || ctx.editorCurrent(candidate.editor) !== true
        || typeof ctx.sameEditor !== 'function' || ctx.sameEditor(editor, candidate.editor) !== true)) continue;
      captures.push({ entry: candidate, editor: candidate.editor, original: candidate.original,
        revision: candidate.revision, pane: snapshot(candidate.pane), state: candidate.state, epoch });
    }
    if (!editable(entry) || !liveSession(session)) return stale();
    const written = await native(() => ctx.insert(editor, action));
    if (!written?.result || !['applied', 'rejected'].includes(written.result.status)) return unavailable();
    if (written.result.status !== 'applied') return written.result;
    // The canonical writer owns its commit and post-commit native selection. An
    // already-applied edit remains applied if the modeless viewer disappeared.
    for (const capture of captures) {
      const candidate = capture.entry;
      const retained = () => capture.epoch === epoch && entryCurrent(candidate) && candidate.state === capture.state
        && candidate.editor === capture.editor && candidate.original === capture.original
        && candidate.revision === capture.revision && unchanged(capture.pane);
      if (retained() && ownerCurrent(capture.original) && retained()) {
        candidate.editor = written.editor ?? null;
        if (Object.hasOwn(written, 'original')) candidate.original = written.original;
      }
    }
    ctx.onChanged?.();
    return applied(resultTarget);
  }
  const handlers = {
    'input.source.select': (target, payload) => {
      if (!fields(target, ['sourceId']) || !['us', 'fr', 'de'].includes(target.sourceId) || !fields(payload, [])) return invalid();
      const sourceId = target.sourceId;
      return mutate(plan => select(plan, sourceId), sourceResult);
    },
    'input.source.cycle': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['direction']) || !['last', 'next'].includes(payload.direction)) return invalid();
      const direction = payload.direction;
      return mutate(plan => {
        if (plan.sourceIds.length === 1) { plan.previousSourceId = null; return; }
        const next = direction === 'last' && plan.previousSourceId !== null ? plan.previousSourceId
          : plan.sourceIds[(plan.sourceIds.indexOf(plan.activeSourceId) + 1) % plan.sourceIds.length];
        return select(plan, next);
      }, sourceResult);
    },
    'input.sources.configure': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['sourceIds'])) return invalid();
      const candidate = { sourceIds: payload.sourceIds, activeSourceId: 'us', previousSourceId: null, showInMenuBar: true };
      // Validate the list descriptor-first without reading a potentially sparse or accessor first element.
      const list = Object.getOwnPropertyDescriptor(payload.sourceIds ?? {}, '0');
      if (!list || !Object.hasOwn(list, 'value')) return invalid();
      candidate.activeSourceId = list.value;
      if (!validateInputState(candidate).ok) return invalid();
      const sourceIds = [...payload.sourceIds];
      return mutate(plan => {
        plan.sourceIds = sourceIds;
        if (!sourceIds.includes(plan.activeSourceId)) plan.activeSourceId = sourceIds[0];
        if (!sourceIds.includes(plan.previousSourceId) || plan.previousSourceId === plan.activeSourceId) plan.previousSourceId = null;
      }, plan => ({ sourceIds: [...plan.sourceIds], ...sourceResult(plan) }));
    },
    'input.menu.configure': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['showInMenuBar']) || typeof payload.showInMenuBar !== 'boolean') return invalid();
      const showInMenuBar = payload.showInMenuBar; let original;
      const result = mutate(plan => { plan.showInMenuBar = showInMenuBar; }, plan => ({ showInMenuBar: plan.showInMenuBar }), () => { original = ctx.capture(); });
      if (result.status === 'applied' && !showInMenuBar) await native(() => ctx.retireMenu(original));
      return result;
    },
    'input.viewer.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['kind']) || !['keyboard', 'characters'].includes(payload.kind)) return invalid();
      const kind = payload.kind, root = begin(); if (root.error) return root.error;
      const openSequence = ++openSequences[kind];
      let original;
      try { original = ctx.capture(); } catch { return unavailable(); }
      if (!current(root) || openSequence !== openSequences[kind]) return stale();
      const old = [...entries.values()].find(entry => entry.kind === kind);
      if (old && (!entryCurrent(old) || !ownerCurrent(old.original))) return stale();
      let editor = null;
      if (!old) {
        try { editor = ctx.captureEditor(original) ?? null; } catch { return unavailable(); }
        if (!current(root) || openSequence !== openSequences[kind]) return stale();
        if (!ownerCurrent(original)) return stale();
      }
      await native(() => ctx.retireMenu(original));
      if (!current(root) || openSequence !== openSequences[kind]) return stale();
      if (!allowed()) return unavailable();
      if (!current(root) || openSequence !== openSequences[kind]) return stale();
      const previousActive = presentation.activeKind;
      let entry = old;
      if (!entry) {
        const candidate = { viewerId: `${namespace}:${++sequence}`, kind, shift: false, option: false,
          query: '', category: 'all', selectedCharacterId: null, error: null };
        presentation[kind] = candidate;
        entry = { id: candidate.viewerId, kind, pane: presentation[kind], original, editor, state: root.state, revision: 0 };
        entries.set(entry.id, entry);
      }
      entry.openSequence = openSequence;
      const session = { entry, root, epoch, openSequence, revision: entry.revision, pane: snapshot(entry.pane) };
      if (!activate(session)) { if (!old) discard(entry); return failure(session); }
      await native(() => ctx.settle());
      const view = viewFor(session), control = kind === 'characters' ? 'search' : 'panel';
      if (!view || !await focus(session, view, control)) {
        const result = failure(session);
        if (!old && entries.get(entry.id) === entry && entry.openSequence === openSequence) {
          const token = entry.original; discard(entry);
          if (presentation.activeKind === null && [...entries.values()].some(value => value.kind === previousActive)) setActive(previousActive);
          const generation = epoch, focusGeneration = foregroundEpoch;
          await native(() => ctx.settle());
          if (generation === epoch && focusGeneration === foregroundEpoch && current(root) && ownerCurrent(token) && allowed()
            && presentation.activeKind === null) await native(() => ctx.restore(token, () => generation === epoch && focusGeneration === foregroundEpoch && current(root) && ownerCurrent(token) && allowed()));
        } else if (old && liveSession(session) && presentation.activeKind === kind) setActive(previousActive);
        return result;
      }
      return applied({ viewerId: entry.id, kind });
    },
    'input.viewer.close': async (target, payload) => {
      if (!targetViewer(target) || !fields(payload, ['restoreFocus'], [])
        || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return invalid();
      const viewerId = target.viewerId, shouldRestore = payload.restoreFocus !== false;
      const session = sessionFor(viewerId); if (session.error) return session.error;
      const view = viewFor(session); if (!view || !controls(session, view).includes('close')) return failure(session);
      const entry = session.entry, original = entry.original, restore = shouldRestore && presentation.activeKind === entry.kind;
      discard(entry); const generation = epoch, focusGeneration = foregroundEpoch;
      await native(() => ctx.settle());
      const guard = () => generation === epoch && focusGeneration === foregroundEpoch && current(session.root) && allowed() && ownerCurrent(original) && presentation.activeKind === null;
      if (restore && guard()) await native(() => ctx.restore(original, guard));
      return applied({ viewerId });
    },
    'input.viewer.focus': async (target, payload) => {
      if (!targetViewer(target, ['control']) || !id(target.control) || !observePayload(payload)) return invalid();
      const viewerId = target.viewerId, control = target.control, observe = payload.observe === true;
      const session = sessionFor(viewerId); if (session.error) return session.error;
      const view = viewFor(session); if (!view || !controls(session, view).includes(control)) return failure(session);
      if (!activate(session)) return failure(session);
      if (observe ? view.focusedControl() !== control || !viewLive(session, view) : !await focus(session, view, control)) return failure(session);
      return applied({ viewerId, control });
    },
    'input.viewer.scroll': async (target, payload) => {
      if (!targetViewer(target) || !fields(payload, ['top', 'observe'], ['top']) || !position(payload.top)
        || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const viewerId = target.viewerId, top = payload.top, observe = payload.observe === true;
      const session = sessionFor(viewerId); if (session.error) return session.error;
      const view = viewFor(session); if (!view) return failure(session);
      const previous = view.scrollTop(); if (!position(previous) || !viewLive(session, view)) return failure(session);
      const result = observe ? previous : await native(() => view.scrollTo(top));
      const actual = viewLive(session, view) ? view.scrollTop() : null;
      if (!position(result) || !position(actual) || actual !== result || observe && actual !== top || !viewLive(session, view)) {
        if (viewLive(session, view)) await native(() => view.scrollTo(previous));
        return failure(session);
      }
      return applied({ viewerId, top: actual });
    },
    'input.keyboard.modifiers': (target, payload) => {
      if (!targetViewer(target) || !fields(payload, ['shift', 'option'], []) || Reflect.ownKeys(payload).length === 0
        || Object.keys(payload).some(key => typeof payload[key] !== 'boolean')) return invalid();
      const viewerId = target.viewerId, requested = { ...payload };
      const session = sessionFor(viewerId, 'keyboard');
      return session.error ?? modifiers(session, requested);
    },
    'input.keyboard.press': async (target, payload) => {
      if (!targetViewer(target, ['keyId']) || !id(target.keyId) || !fields(payload, [])) return invalid();
      const viewerId = target.viewerId, keyId = target.keyId;
      const session = sessionFor(viewerId, 'keyboard'); if (session.error) return session.error;
      const pane = session.entry.pane;
      const key = keyboardRows(session.root.state.activeSourceId, pane).flat().find(value => value.keyId === keyId);
      if (!key) return stale();
      const view = viewFor(session), control = key.action === 'modifier' ? key.keyId.toLowerCase() : `key:${key.keyId}`;
      if (!view) return failure(session);
      if (key.action !== 'modifier' && !editable(session.entry)) return session.entry.editor === null ? disabled() : stale();
      if (!controls(session, view).includes(control)) return unavailable();
      if (!activate(session)) return failure(session);
      if (key.action === 'modifier') {
        const name = key.keyId.toLowerCase();
        const result = await modifiers(session, { [name]: !pane[name] });
        return result.status === 'applied' ? applied({ viewerId, keyId: key.keyId }) : result;
      }
      return insert(session, { action: key.action, text: key.text }, { viewerId, keyId: key.keyId });
    },
    'input.characters.search': async (target, payload) => {
      if (!targetViewer(target) || !fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 256) return invalid();
      const viewerId = target.viewerId, query = payload.query, session = sessionFor(viewerId, 'characters'); if (session.error) return session.error;
      const view = viewFor(session); if (!view || !controls(session, view).includes('search')) return failure(session);
      const previous = { query: session.entry.pane.query, selectedCharacterId: session.entry.pane.selectedCharacterId };
      const actual = view.query(); if (typeof actual !== 'string' || actual.length > 256 || !viewLive(session, view)) return unavailable();
      if (actual !== query && await native(() => view.setQuery(query)) !== true || !viewLive(session, view) || view.query() !== query || !viewLive(session, view)) {
        const result = failure(session);
        if (viewLive(session, view) && view.query() !== actual) await native(() => view.setQuery(actual));
        return result;
      }
      const selectedCharacterId = characterResults(query, session.entry.pane.category).some(character => character.id === previous.selectedCharacterId)
        ? previous.selectedCharacterId : null;
      if (!update(session, { query, selectedCharacterId }) || !activate(session)) return failure(session);
      await native(() => ctx.settle());
      if (!viewLive(session, view) || view.query() !== query || !viewLive(session, view)) {
        const result = failure(session); await rollback(session, previous, view, actual); return result;
      }
      return applied({ viewerId, query });
    },
    'input.characters.category': async (target, payload) => {
      if (!targetViewer(target) || !fields(payload, ['category']) || !['all', 'emoji', 'symbols', 'latin'].includes(payload.category)) return invalid();
      const viewerId = target.viewerId, category = payload.category, session = sessionFor(viewerId, 'characters'); if (session.error) return session.error;
      const view = viewFor(session); if (!view || !controls(session, view).includes(`category:${category}`)) return failure(session);
      const previous = { category: session.entry.pane.category, selectedCharacterId: session.entry.pane.selectedCharacterId };
      const selectedCharacterId = characterResults(session.entry.pane.query, category).some(character => character.id === previous.selectedCharacterId)
        ? previous.selectedCharacterId : null;
      if (!update(session, { category, selectedCharacterId }) || !activate(session)) return failure(session);
      await native(() => ctx.settle());
      if (!viewLive(session, view) || !controls(session, view).includes(`category:${category}`)) {
        const result = failure(session); await rollback(session, previous, view); return result;
      }
      return applied({ viewerId, category });
    },
    'input.characters.select': async (target, payload) => {
      if (!targetViewer(target, ['characterId']) || !id(target.characterId) || !fields(payload, [])) return invalid();
      const viewerId = target.viewerId, characterId = target.characterId;
      const session = sessionFor(viewerId, 'characters'); if (session.error) return session.error;
      const pane = session.entry.pane;
      if (!characterResults(pane.query, pane.category).some(character => character.id === characterId)) return stale();
      const view = viewFor(session); if (!view) return failure(session);
      if (!activate(session) || !await focus(session, view, `character:${characterId}`)) return failure(session);
      const previous = { selectedCharacterId: pane.selectedCharacterId };
      if (!update(session, { selectedCharacterId: characterId })) return failure(session);
      await native(() => ctx.settle());
      if (!viewLive(session, view) || view.focusedControl() !== `character:${characterId}` || !viewLive(session, view)) {
        const result = failure(session); await rollback(session, previous, view); return result;
      }
      return applied({ viewerId, characterId });
    },
    'input.characters.insert': async (target, payload) => {
      if (!targetViewer(target, ['characterId']) || !id(target.characterId) || !fields(payload, [])) return invalid();
      const viewerId = target.viewerId, characterId = target.characterId;
      const session = sessionFor(viewerId, 'characters'); if (session.error) return session.error;
      const pane = session.entry.pane;
      const character = characterById(characterId);
      if (!character || !characterResults(pane.query, pane.category).includes(character)) return stale();
      const view = viewFor(session); if (!view) return failure(session);
      if (!controls(session, view).includes(`character:${character.id}`)) return unavailable();
      if (!activate(session)) return failure(session);
      return insert(session, { action: 'insert', text: character.text }, { viewerId, characterId: character.id });
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) => {
      if (ctx.profile.id !== 'macos-golden-gate-27.0.1' || !ctx.profile.capabilities.includes('status.input'))
        return rejected('unsupported_profile', 'Only Golden Gate represents the bounded authored Input menu and viewers.');
      return handler(target, payload);
    }])),
    summary, clear, reconcile,
    dispose() { disposed = true; clear(); },
    getReturnFocus(node) {
      if (!node || disposed) return undefined;
      for (const entry of entries.values()) {
        try {
          if (!entryCurrent(entry) || !ownerCurrent(entry.original)) continue;
          const view = ctx.getView(entry.kind), element = view?.element();
          if (element?.isConnected === true && (element === node || element.contains(node))
            && entryCurrent(entry) && ownerCurrent(entry.original)) return entry.original;
        } catch { /* A detached or foreign node cannot inherit an editor owner. */ }
      }
      return undefined;
    },
    targets() {
      const viewers = [...entries.values()].filter(entryCurrent).map(entry => {
        const session = sessionFor(entry.id), view = session.error ? null : viewFor(session);
        let controlIds = [], focusedControl = null, scrollTop = null;
        if (view) {
          controlIds = controls(session, view);
          const focused = view.focusedControl(), top = view.scrollTop();
          if (viewLive(session, view)) { focusedControl = controlIds.includes(focused) ? focused : null; scrollTop = position(top) ? top : null; }
        }
        return { ...Object.fromEntries(paneKeys.map(key => [key, entry.pane[key]])), controlIds, focusedControl, scrollTop, canInsert: editable(entry) };
      });
      return { ...summary(), viewers, activeKind: presentation.activeKind,
        boundaries: { hostKeyboard: false, hostIME: false, authoredLayouts: ['us', 'fr', 'de'], optionLayer: 'original-bounded-symbols',
          characterCatalogue: 'original-bounded', deadKeyComposition: false, candidateConversion: false,
          scope: 'retained-root', viewersSaved: false, editorLeasesPublic: false, editorLeasesSaved: false } };
    },
    menuProvider(enabled) {
      const current = summary(), active = enabled === true && current.showInMenuBar;
      return { menuId: 'input', kind: 'input', label: current.activeSource.short, symbol: current.activeSource.short,
        showInMenuBar: current.showInMenuBar, enabled: active, items: [
          ...current.sources.map(source => ({ id: `source:${source.id}`, label: source.name, checked: source.id === current.activeSourceId,
            radio: true, enabled: active, request: { command: 'input.source.select', target: { sourceId: source.id } } })),
          { id: 'input-viewers-separator', separator: true, enabled: false },
          { id: 'keyboard-viewer', label: 'Show Keyboard Viewer', enabled: active, request: { command: 'input.viewer.open', payload: { kind: 'keyboard' } } },
          { id: 'character-viewer', label: 'Show Emoji & Symbols', enabled: active, request: { command: 'input.viewer.open', payload: { kind: 'characters' } } },
          { id: 'input-settings-separator', separator: true, enabled: false },
          { id: 'preferences', label: 'Open Keyboard Settings…', enabled: active, request: { command: 'system.settings.open', payload: { pane: 'keyboard' } } },
        ] };
    },
  };
}

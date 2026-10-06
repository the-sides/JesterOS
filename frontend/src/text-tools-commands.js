import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, identity, object, empty, choice, flag } from './command-schema.js';
import { EDITING_OPTION_KEYS, validLearnedWord, validateEditingPreferences } from './editing-state.js';
import { findTextMatches, replaceAllNoteMatches } from './text-find.js';
import { applyTextSubstitutions } from './text-assistance.js';

const MAX = Number.MAX_SAFE_INTEGER - 1;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX;
const invalid = () => rejected('invalid_arguments', 'Use the documented owned text-tool target and closed payload.');
const stale = () => rejected('stale_target', 'The original note, window, text revision or tool changed.');
const unavailable = () => rejected('unavailable', 'The original text tool is not available.');
const limited = () => rejected('limit_exceeded', 'The operation exceeds the bounded text or preference budget.');
const applied = target => ({ status: 'applied', target });
const folded = word => word.normalize('NFC').toLocaleLowerCase('en-US').replaceAll('’', "'");
const documentTarget = target => fields(target, ['windowId', 'noteId']) && id(target.windowId) && id(target.noteId);
const versionedTarget = target => fields(target, ['windowId', 'noteId', 'revision']) && id(target.windowId) && id(target.noteId) && integer(target.revision);
const rangeTarget = target => fields(target, ['windowId', 'noteId', 'revision', 'start', 'end'])
  && id(target.windowId) && id(target.noteId) && integer(target.revision) && integer(target.start) && integer(target.end) && target.start < target.end;

export function createTextToolsCommands(state, preferences, clipboard, assistance, ctx) {
  const returns = new Map(), ignored = new Map();
  const draftHistory = new Map();
  let matchCache;
  let toolSequence = 0;
  let ignoredCount = 0, preferencesRevision = 0;
  const noteOwner = target => ctx.available() ? ctx.getDocument(target) : null;
  const sameDocument = (target, text, revision) => {
    const source = noteOwner(target);
    return source && source.note.text === text && source.note.updatedAt === revision ? source : null;
  };
  const findOwner = target => documentTarget(target) && state.find?.windowId === target.windowId && state.find.noteId === target.noteId && noteOwner(target);
  function matches(source, index = state.find?.matchIndex ?? 0) {
    const find = state.find;
    if (!find || !source) return { count: 0, selected: null, highlights: [], truncated: false };
    if (!matchCache || matchCache.text !== source.note.text || matchCache.query !== find.query
      || matchCache.caseSensitive !== find.caseSensitive || matchCache.wholeWord !== find.wholeWord || matchCache.index !== index) {
      matchCache = { text: source.note.text, query: find.query, caseSensitive: find.caseSensitive, wholeWord: find.wholeWord, index,
        value: findTextMatches(source.note.text, find.query, find, index) };
    }
    return matchCache.value;
  }
  function setFind(target, open = true) {
    if (!state.find || state.find.windowId !== target.windowId || state.find.noteId !== target.noteId) {
      state.find = { ...target, toolId: `text-tool-${++toolSequence}`, open, query: state.find?.query ?? '', replacement: '', caseSensitive: false, wholeWord: false,
        replace: false, matchIndex: 0 };
      draftHistory.delete('find:query'); draftHistory.delete('find:replacement');
      matchCache = undefined;
    } else {
      if (open && !state.find.open) {
        state.find.toolId = `text-tool-${++toolSequence}`;
        draftHistory.delete('find:query'); draftHistory.delete('find:replacement');
      }
      state.find.open = open;
    }
  }
  function remember(kind, target) {
    const token = ctx.captureReturn(), existing = returns.get(kind);
    if (existing && token?.toolPanel === (kind === 'find' ? 'find' : state.panel?.kind)
      && existing.target.windowId === target.windowId && existing.target.noteId === target.noteId) return existing.token;
    returns.set(kind, { target: { ...target }, revision: noteOwner(target)?.note.updatedAt, token });
    return token;
  }
  async function returnFocus(kind, guard) {
    const entry = returns.get(kind); returns.delete(kind);
    if (entry && noteOwner(entry.target)) await ctx.restoreReturn(entry.token, entry.target, entry.revision, guard);
  }
  async function showMatch(target, source, match) {
    if (!match) return true;
    const text = source.note.text, revision = source.note.updatedAt;
    const revealed = await ctx.revealMatch(target, match);
    return Boolean(revealed && sameDocument(target, text, revision));
  }
  const optionsOwner = target => fields(target, ['windowId']) && id(target.windowId) && ctx.available() && ctx.getNotesWindow(target.windowId);
  function commitPreferences(next) {
    if (!validateEditingPreferences(next).ok) return invalid();
    if (!ctx.canCommitPreferences(next)) return limited();
    Object.assign(preferences, next);
    preferencesRevision++;
    state.liveSpelling = null; state.spellingEpoch = (state.spellingEpoch ?? 0) + 1;
    ctx.onPreferencesChanged?.(); ctx.onChanged();
    return null;
  }
  function toolField(target) {
    if (!id(target.windowId) || typeof target.control !== 'string' || !ctx.available()) return null;
    const find = state.find?.open && state.find.windowId === target.windowId
      && findOwner({ windowId: state.find.windowId, noteId: state.find.noteId });
    if (find && ['query', 'replacement'].includes(target.control)) return { kind: 'find', key: target.control, value: state.find[target.control], max: 4096, toolId: state.find.toolId };
    const panel = state.panel?.windowId === target.windowId && ctx.getNotesWindow(target.windowId) ? state.panel : null;
    if (panel && panel.kind === 'spelling' && target.control === 'word' && state.spelling
      && state.spelling.noteId === state.panel.noteId && noteOwner(state.spelling)?.note.updatedAt === state.spelling.revision)
      return { kind: 'spelling', key: 'replacement', value: state.spelling.replacement, max: 128, toolId: state.spelling.toolId };
    return null;
  }
  function recordDraft(field, before, after, beforeRange, afterRange) {
    if (before === after) return;
    const key = `${field.kind}:${field.key}`;
    const history = draftHistory.get(key) ?? { undo: [], redo: [] };
    history.undo.push({ before, after, beforeRange, afterRange }); history.redo = [];
    if (history.undo.length > 64) history.undo.shift();
    draftHistory.set(key, history);
  }
  function writeDraft(field, value) {
    if (field.kind === 'find') { state.find[field.key] = value; state.find.matchIndex = 0; matchCache = undefined; }
    else if (state.spelling) state.spelling.replacement = value;
    ctx.onChanged();
  }
  async function checkSpelling(target, payload, panel = false) {
    if (!versionedTarget(target) || !fields(payload, ['from', 'maxIssues', 'suggestions'], [])
      || (payload.from !== undefined && !integer(payload.from)) || (payload.maxIssues !== undefined && (!integer(payload.maxIssues) || payload.maxIssues < 1 || payload.maxIssues > 1000))
      || (payload.suggestions !== undefined && typeof payload.suggestions !== 'boolean')) return invalid();
    const source = noteOwner(target);
    if (!source) return unavailable();
    const text = source.note.text, revision = source.note.updatedAt;
    if (target.revision !== revision || (payload.from ?? 0) > text.length) return stale();
    const ignoredWords = [...(ignored.get(target.noteId) ?? [])];
    const learnedWords = [...preferences.learnedWords];
    const previousPanel = state.panel, previousSpelling = state.spelling, focusToken = panel ? returns.get('panel')?.token : null;
    let result;
    if (ctx.prepareAssistance && !await ctx.prepareAssistance()) return rejected('unavailable', 'The bundled English spelling dictionary could not be loaded.');
    try { result = await assistance.check(text, { learnedWords, ignoredWords, from: payload.from ?? 0,
      maxIssues: payload.maxIssues ?? (panel ? 1 : 500), suggestions: payload.suggestions ?? panel }); }
    catch { return rejected('unavailable', 'The bundled English spelling dictionary could not be loaded.'); }
    if (!sameDocument(target, text, revision)
      || learnedWords.join('\u0000') !== preferences.learnedWords.join('\u0000')
      || ignoredWords.join('\u0000') !== [...(ignored.get(target.noteId) ?? [])].join('\u0000')
      || panel && (state.panel !== previousPanel || state.spelling !== previousSpelling || ctx.isReturnCurrent && !ctx.isReturnCurrent(focusToken))) return stale();
    const checked = { ...target, issues: result.issues, nextFrom: result.nextFrom, replacement: result.issues[0]?.suggestions[0] ?? '', checkedFrom: payload.from ?? 0 };
    if (!panel && payload.suggestions === false) state.liveSpelling = preferences.checkSpellingWhileTyping ? checked : null;
    else {
      state.spelling = { ...checked, toolId: `text-tool-${++toolSequence}` };
      draftHistory.delete('spelling:replacement');
    }
    if (panel) {
      const previous = state.panel;
      state.panel = { kind: 'spelling', windowId: target.windowId, noteId: target.noteId };
      const current = state.panel;
      const focused = await ctx.focusTool('spelling', result.issues.length ? 'word' : 'panel', focusToken);
      if (!focused || !sameDocument(target, text, revision)) {
        if (state.panel === current) state.panel = previous;
        if (state.spelling?.revision === revision && state.spelling.noteId === target.noteId) state.spelling = null;
        return stale();
      }
    } else if (payload.suggestions !== false && result.issues.length && !await showMatch(target, source, result.issues[0])) return stale();
    ctx.onChanged();
    return applied({ ...target, issues: result.issues, nextFrom: result.nextFrom });
  }
  const handlers = {
    'text.find.open': async (target, payload) => {
      if (!documentTarget(target) || !fields(payload, ['replace'], []) || (payload.replace !== undefined && typeof payload.replace !== 'boolean')) return invalid();
      const source = noteOwner(target); if (!source) return unavailable();
      const text = source.note.text, revision = source.note.updatedAt;
      const previous = state.find ? { ...state.find } : null, previousReturn = returns.get('find');
      const previousDrafts = ['find:query', 'find:replacement'].map(key => [key, draftHistory.get(key)]);
      const focusToken = remember('find', target); setFind(target); state.find.replace = payload.replace ?? false;
      const current = state.find, lease = { ...current };
      const focused = await ctx.focusTool('find', 'query', focusToken);
      if (!focused || !sameDocument(target, text, revision)) {
        if (state.find === current && Object.keys(lease).every(key => current[key] === lease[key])) {
          state.find = previous;
          for (const [key, history] of previousDrafts) history ? draftHistory.set(key, history) : draftHistory.delete(key);
          previousReturn ? returns.set('find', previousReturn) : returns.delete('find');
        }
        return stale();
      }
      return applied(target);
    },
    'text.find.configure': (target, payload) => {
      if (!documentTarget(target) || !fields(payload, ['query', 'replacement', 'caseSensitive', 'wholeWord', 'replace'], []) || !Object.keys(payload).length
        || ['query', 'replacement'].some(key => payload[key] !== undefined && (typeof payload[key] !== 'string' || payload[key].length > 4096))
        || ['caseSensitive', 'wholeWord', 'replace'].some(key => payload[key] !== undefined && typeof payload[key] !== 'boolean')) return invalid();
      if (!findOwner(target)) return stale();
      for (const key of ['query', 'replacement']) if (payload[key] !== undefined) {
        const field = { kind: 'find', key };
        const native = ctx.getToolInput({ windowId: target.windowId, control: key });
        const before = native?.value === payload[key] && native.before?.value === state.find[key] ? native.before.selection : { start: 0, end: 0, direction: 'none' };
        const after = native?.value === payload[key] ? native.selection : { start: payload[key].length, end: payload[key].length, direction: 'none' };
        recordDraft(field, state.find[key], payload[key], before, after);
      }
      Object.assign(state.find, payload, { matchIndex: 0 }); matchCache = undefined; ctx.onChanged(); return applied(target);
    },
    'text.find.close': async (target, payload) => {
      if (!documentTarget(target) || !fields(payload, [])) return invalid();
      if (!findOwner(target) || !state.find.open) return stale();
      const closing = state.find; state.find.open = false;
      await returnFocus('find', () => state.find === closing && !closing.open); return applied(target);
    },
    'text.find.next': async (target, payload) => {
      if (!documentTarget(target) || !fields(payload, ['backward'], []) || (payload.backward !== undefined && typeof payload.backward !== 'boolean')) return invalid();
      const source = findOwner(target); if (!source) return stale();
      const current = matches(source);
      if (!current.count) return rejected('not_found', 'No literal matches in this note.');
      const next = matches(source, (current.selected?.index ?? 0) + (payload.backward ? -1 : 1));
      if (!await showMatch(target, source, next.selected)) return stale();
      state.find.matchIndex = next.selected.index;
      return applied({ ...target, index: next.selected.index, count: next.count, start: next.selected.start, end: next.selected.end });
    },
    'text.find.useSelection': (target, payload) => {
      if (!rangeTarget(target) || !fields(payload, [])) return invalid();
      const source = noteOwner(target);
      if (!source || source.note.updatedAt !== target.revision || target.end > source.note.text.length) return stale();
      const query = source.note.text.slice(target.start, target.end);
      if (query.length > 4096) return limited();
      setFind({ windowId: target.windowId, noteId: target.noteId }, Boolean(state.find?.open));
      state.find.query = query; state.find.matchIndex = 0; matchCache = undefined;
      draftHistory.delete('find:query'); ctx.onChanged();
      return applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.find.replace': async (target, payload) => {
      if (!versionedTarget(target) || !fields(payload, ['all'], []) || (payload.all !== undefined && typeof payload.all !== 'boolean')) return invalid();
      const source = findOwner({ windowId: target.windowId, noteId: target.noteId });
      if (!source || source.note.updatedAt !== target.revision) return stale();
      if (source.note.deleted) return rejected('read_only', 'Deleted notes cannot be replaced.');
      const found = matches(source); if (!found.count) return rejected('not_found', 'No literal matches in this note.');
      const text = source.note.text, revision = source.note.updatedAt, replacement = state.find.replacement;
      const findLease = { ...state.find };
      const changed = payload.all ? replaceAllNoteMatches(text, state.find.query, replacement, state.find)
        : { text: text.slice(0, found.selected.start) + replacement + text.slice(found.selected.end), count: 1 };
      if (!await ctx.prepareDocument(target) || !sameDocument(target, text, revision)
        || !state.find || Object.keys(findLease).some(key => state.find[key] !== findLease[key])) return stale();
      const committed = await ctx.invoke('notes.edit', { noteId: target.noteId }, { text: changed.text }, 'replace');
      if (committed.status !== 'applied') return committed;
      state.find.matchIndex = 0; matchCache = undefined;
      const after = noteOwner(target);
      if (after) { try { await showMatch(target, after, matches(after).selected); } catch { /* The edit is already committed. */ } }
      return applied({ windowId: target.windowId, noteId: target.noteId, count: changed.count });
    },
    'text.preferences.set': async (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, EDITING_OPTION_KEYS, []) || !Object.keys(payload).length
        || Object.values(payload).some(value => typeof value !== 'boolean')) return invalid();
      if (!optionsOwner(target)) return unavailable();
      const preferenceLease = preferencesRevision;
      if (payload.correctSpellingAutomatically && !preferences.correctSpellingAutomatically) {
        let ready;
        try { ready = ctx.prepareAssistance ? await ctx.prepareAssistance() : await assistance.ready(); } catch { ready = false; }
        if (!ready) return rejected('unavailable', 'The bundled English spelling dictionary could not be loaded.');
        if (!optionsOwner(target) || preferencesRevision !== preferenceLease) return stale();
      }
      const error = commitPreferences({ ...preferences, ...payload }); return error ?? applied(target);
    },
    'text.replacements.set': (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, ['replacements']) || !Array.isArray(payload.replacements)
        || payload.replacements.some(entry => !fields(entry, ['from', 'to']))) return invalid();
      if (!optionsOwner(target)) return unavailable();
      const error = commitPreferences({ ...preferences, replacements: payload.replacements.map(entry => ({ ...entry })) }); return error ?? applied(target);
    },
    'text.spelling.check': (target, payload) => checkSpelling(target, payload),
    'text.spelling.open': async (target, payload) => {
      if (!versionedTarget(target) || !fields(payload, [])) return invalid();
      if (!noteOwner(target)) return unavailable();
      remember('panel', { windowId: target.windowId, noteId: target.noteId });
      return checkSpelling(target, { maxIssues: 1, suggestions: true }, true);
    },
    'text.spelling.configure': (target, payload) => {
      if (!rangeTarget(target) || !fields(payload, ['replacement']) || typeof payload.replacement !== 'string' || payload.replacement.length > 128 || /[\r\n]/u.test(payload.replacement)) return invalid();
      const source = noteOwner(target), issue = state.spelling?.issues[0];
      if (state.panel?.kind !== 'spelling' || state.panel.windowId !== target.windowId || state.panel.noteId !== target.noteId
        || !source || source.note.updatedAt !== target.revision || state.spelling?.revision !== target.revision
        || issue?.start !== target.start || issue.end !== target.end) return stale();
      const native = ctx.getToolInput({ windowId: target.windowId, control: 'word' });
      const before = native?.value === payload.replacement && native.before?.value === state.spelling.replacement ? native.before.selection : { start: 0, end: 0, direction: 'none' };
      const after = native?.value === payload.replacement ? native.selection : { start: payload.replacement.length, end: payload.replacement.length, direction: 'none' };
      recordDraft({ kind: 'spelling', key: 'replacement' }, state.spelling.replacement, payload.replacement, before, after);
      state.spelling.replacement = payload.replacement; ctx.onChanged(); return applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.spelling.learn': (target, payload) => {
      if (!rangeTarget(target) || !fields(payload, [])) return invalid();
      const source = noteOwner(target);
      if (!source || source.note.updatedAt !== target.revision || target.end > source.note.text.length) return stale();
      const word = source.note.text.slice(target.start, target.end);
      if (!validLearnedWord(word)) return invalid();
      if (preferences.learnedWords.some(value => folded(value) === folded(word))) return applied({ windowId: target.windowId, noteId: target.noteId });
      const error = commitPreferences({ ...preferences, learnedWords: [...preferences.learnedWords, word] });
      if (!error) state.spelling = null;
      return error ?? applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.spelling.unlearn': (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, ['word']) || !validLearnedWord(payload.word)) return invalid();
      if (!optionsOwner(target)) return unavailable();
      const error = commitPreferences({ ...preferences, learnedWords: preferences.learnedWords.filter(word => folded(word) !== folded(payload.word)) });
      if (!error) state.spelling = null;
      return error ?? applied(target);
    },
    'text.spelling.ignore': (target, payload) => {
      if (!rangeTarget(target) || !fields(payload, [])) return invalid();
      const source = noteOwner(target);
      if (!source || source.note.updatedAt !== target.revision || target.end > source.note.text.length) return stale();
      const word = source.note.text.slice(target.start, target.end); if (!validLearnedWord(word)) return invalid();
      const words = ignored.get(target.noteId) ?? new Set(), key = folded(word);
      if (!words.has(key)) { if (ignoredCount >= 1024) return limited(); words.add(key); ignoredCount++; }
      ignored.set(target.noteId, words); state.spelling = null;
      state.liveSpelling = null; state.spellingEpoch = (state.spellingEpoch ?? 0) + 1; ctx.onChanged();
      return applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.spelling.replace': async (target, payload) => {
      if (!rangeTarget(target) || !fields(payload, ['replacement']) || typeof payload.replacement !== 'string' || payload.replacement.length > 128 || /[\r\n]/u.test(payload.replacement)) return invalid();
      const source = noteOwner(target);
      if (!source || source.note.updatedAt !== target.revision || target.end > source.note.text.length) return stale();
      if (source.note.deleted) return rejected('read_only', 'Deleted notes cannot be corrected.');
      const text = source.note.text, revision = source.note.updatedAt;
      if (!await ctx.prepareDocument(target) || !sameDocument(target, text, revision)) return stale();
      const committed = await ctx.invoke('notes.edit', { noteId: target.noteId }, { text: text.slice(0, target.start) + payload.replacement + text.slice(target.end) }, 'spelling');
      if (committed.status !== 'applied') return committed;
      state.spelling = null;
      try { await ctx.revealMatch({ windowId: target.windowId, noteId: target.noteId }, { start: target.start, end: target.start + payload.replacement.length }); } catch { /* The correction is already committed. */ }
      return applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.substitutions.open': async (target, payload) => {
      if (!documentTarget(target) || !fields(payload, [])) return invalid();
      const source = noteOwner(target); if (!source) return unavailable();
      const text = source.note.text, revision = source.note.updatedAt;
      const previous = state.panel;
      const focusToken = remember('panel', target); state.panel = { kind: 'substitutions', ...target, selection: ctx.getDocumentSelection?.(target) ?? null };
      const current = state.panel;
      if (!await ctx.focusTool('substitutions', 'panel', focusToken) || !sameDocument(target, text, revision)) {
        if (state.panel === current) state.panel = previous;
        return stale();
      }
      return applied(target);
    },
    'text.substitutions.apply': async (target, payload) => {
      if (!versionedTarget(target) || !fields(payload, ['start', 'end'], []) || (Object.hasOwn(payload, 'start') !== Object.hasOwn(payload, 'end'))
        || (payload.start !== undefined && (!integer(payload.start) || !integer(payload.end) || payload.start > payload.end))) return invalid();
      const source = noteOwner(target);
      if (!source || source.note.updatedAt !== target.revision) return stale();
      if (source.note.deleted) return rejected('read_only', 'Deleted notes cannot receive substitutions.');
      const text = source.note.text, revision = source.note.updatedAt;
      const start = payload.start ?? 0, end = payload.end ?? text.length; if (end > text.length) return stale();
      const selected = text.slice(start, end);
      const preferenceLease = preferencesRevision;
      const replaced = applyTextSubstitutions(selected, preferences, preferences.replacements, { before: text.slice(0, start), after: text.slice(end) });
      if (!await ctx.prepareDocument(target) || !sameDocument(target, text, revision) || preferencesRevision !== preferenceLease) return stale();
      const committed = await ctx.invoke('notes.edit', { noteId: target.noteId }, { text: text.slice(0, start) + replaced + text.slice(end) }, 'substitution');
      if (committed.status !== 'applied') return committed;
      try { await ctx.revealMatch({ windowId: target.windowId, noteId: target.noteId }, { start, end: start + replaced.length }); } catch { /* The substitution is already committed. */ }
      return applied({ windowId: target.windowId, noteId: target.noteId });
    },
    'text.tools.close': async (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, [])) return invalid();
      if (!ctx.available() || state.panel?.windowId !== target.windowId || !ctx.getNotesWindow(target.windowId)) return stale();
      state.panel = null; await returnFocus('panel', () => state.panel === null); return applied(target);
    },
    'text.tools.focus': async (target, payload) => {
      if (!fields(target, ['windowId', 'control']) || !id(target.windowId) || typeof target.control !== 'string' || !fields(payload, [])) return invalid();
      if (!ctx.available() || !ctx.getNotesWindow(target.windowId)) return unavailable();
      const kind = state.find?.open && state.find.windowId === target.windowId && ['query', 'replacement', 'previous', 'next', 'find-close', 'replace-one', 'replace-all', 'replace-toggle', 'case-sensitive', 'whole-word'].includes(target.control)
        ? 'find' : state.panel?.windowId === target.windowId ? state.panel.kind : null;
      if (!kind || !await ctx.focusTool(kind, target.control) || !ctx.available() || !ctx.getNotesWindow(target.windowId)) return unavailable();
      return applied(target);
    },
    'text.tools.clipboard': async (target, payload) => {
      if (!fields(target, ['windowId', 'control', 'toolId', 'value', 'start', 'end'])
        || !id(target.windowId) || !id(target.toolId) || !['query', 'replacement', 'word'].includes(target.control)
        || typeof target.value !== 'string' || target.value.length > 4096 || !integer(target.start) || !integer(target.end)
        || target.start > target.end || target.end > target.value.length
        || !fields(payload, ['operation']) || !['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll'].includes(payload.operation)) return invalid();
      const field = toolField(target), input = field && ctx.getToolInput(target);
      if (!field || field.toolId !== target.toolId || field.value !== target.value || !input || input.value !== field.value
        || input.start !== target.start || input.end !== target.end) return stale();
      const range = { start: input.start, end: input.end, direction: input.direction };
      if (!integer(range.start) || !integer(range.end) || range.start > range.end || range.end > field.value.length) return stale();
      const op = payload.operation;
      if (op === 'selectAll') {
        if (!await ctx.focusTool(field.kind, target.control)) return unavailable();
        const current = toolField(target), native = ctx.getToolInput(target);
        if (!current || current.toolId !== field.toolId || current.value !== field.value || !native
          || native.value !== field.value || native.start !== range.start || native.end !== range.end) return stale();
        try { await ctx.finishToolSelection(target, { start: 0, end: field.value.length, direction: 'forward' }); } catch { return unavailable(); }
        const actual = ctx.getToolInput(target);
        if (toolField(target)?.toolId !== field.toolId || !actual || actual.value !== field.value || actual.start !== 0 || actual.end !== field.value.length) return stale();
        return applied({ windowId: target.windowId, control: target.control, start: 0, end: field.value.length });
      }
      if (op === 'copy' || op === 'cut') {
        if (range.start === range.end) return rejected('disabled', 'Select real tool text first.');
      }
      const history = draftHistory.get(`${field.kind}:${field.key}`);
      const undo = op === 'undo', redo = op === 'redo';
      const entry = (undo ? history?.undo : redo ? history?.redo : null)?.at(-1);
      if ((undo || redo) && (!entry || field.value !== (undo ? entry.after : entry.before))) return rejected('disabled', 'No current tool draft transaction can be restored.');
      if (op === 'paste' && (clipboard.kind !== 'text' || !clipboard.text)) return rejected('disabled', 'The scene clipboard does not contain text.');
      const insertion = op === 'paste' ? clipboard.text.replace(/[\r\n]/g, '') : '';
      const value = op === 'copy' ? field.value : undo || redo ? undo ? entry.before : entry.after : field.value.slice(0, range.start) + insertion + field.value.slice(range.end);
      if (value.length > field.max) return limited();
      const afterRange = op === 'copy' ? range : undo || redo ? undo ? entry.beforeRange : entry.afterRange
        : { start: range.start + insertion.length, end: range.start + insertion.length, direction: 'none' };
      if (!await ctx.focusTool(field.kind, target.control)) return unavailable();
      const current = toolField(target), native = ctx.getToolInput(target);
      if (!current || current.toolId !== field.toolId || current.value !== field.value || !native || native.value !== field.value || native.start !== range.start || native.end !== range.end) return stale();
      if (op === 'copy') {
        Object.assign(clipboard, { kind: 'text', text: field.value.slice(range.start, range.end), fileIds: [] }); ctx.onChanged();
        return applied({ windowId: target.windowId, control: target.control, start: range.start, end: range.end });
      }
      if (op === 'cut') Object.assign(clipboard, { kind: 'text', text: field.value.slice(range.start, range.end), fileIds: [] });
      if (undo || redo) { (undo ? history.undo : history.redo).pop(); (undo ? history.redo : history.undo).push(entry); }
      else recordDraft(field, field.value, value, range, afterRange);
      writeDraft(field, value);
      try { await ctx.finishToolSelection(target, afterRange); } catch { /* The draft transaction is already committed. */ }
      return applied({ windowId: target.windowId, control: target.control, start: afterRange.start, end: afterRange.end });
    },
  };
  function targets() {
    const source = state.find && noteOwner(state.find);
    const found = matches(source);
    return { find: state.find ? { ...state.find, revision: source?.note.updatedAt ?? null, ...found } : null,
      panel: state.panel ? { ...state.panel } : null, spelling: state.spelling ? { ...state.spelling, issues: state.spelling.issues.map(issue => ({ ...issue, suggestions: [...issue.suggestions] })) } : null,
      liveSpelling: state.liveSpelling ? { ...state.liveSpelling, issues: state.liveSpelling.issues.map(issue => ({ ...issue, suggestions: [...issue.suggestions] })) } : null,
      error: state.error ?? null,
      ignored: [...ignored].map(([noteId, words]) => ({ noteId, words: [...words] })),
      drafts: [...draftHistory].map(([key, history]) => ({ key, undo: history.undo.length, redo: history.redo.length })) };
  }
  return { handlers, targets };
}

const profiles = ['macos-golden-gate-27.0.1'];
const offset = { type: 'integer', minimum: 0, maximum: MAX };
const text = (maxLength = 4096) => ({ type: 'string', maxLength });
const owner = object({ windowId: identity, noteId: identity });
const versioned = object({ windowId: identity, noteId: identity, revision: offset });
const range = object({ windowId: identity, noteId: identity, revision: offset, start: offset, end: offset });
const window = object({ windowId: identity });
const tool = object({ windowId: identity, control: identity });
const issue = object({ word: text(1024 * 1024), start: offset, end: offset, suggestions: { type: 'array', maxItems: 8, items: text(128) }, reason: choice('misspelled', 'word_too_long') });
const checked = object({ windowId: identity, noteId: identity, revision: offset, issues: { type: 'array', maxItems: 1000, items: issue }, nextFrom: { anyOf: [offset, { type: 'null' }] } });
const partial = properties => ({ ...object(properties, []), minProperties: 1 });
const definitions = [
  ['text.find.open', owner, object({ replace: flag }, []), owner],
  ['text.find.configure', owner, partial({ query: text(), replacement: text(), caseSensitive: flag, wholeWord: flag, replace: flag }), owner],
  ['text.find.close', owner, empty, owner],
  ['text.find.next', owner, object({ backward: flag }, []), object({ windowId: identity, noteId: identity, index: offset, count: offset, start: offset, end: offset })],
  ['text.find.useSelection', range, empty, owner],
  ['text.find.replace', versioned, object({ all: flag }, []), object({ windowId: identity, noteId: identity, count: offset })],
  ['text.preferences.set', window, partial(Object.fromEntries(EDITING_OPTION_KEYS.map(key => [key, flag]))), window],
  ['text.replacements.set', window, object({ replacements: { type: 'array', maxItems: 1024, items: object({ from: { ...text(128), minLength: 1 }, to: text() }) } }), window],
  ['text.spelling.check', versioned, object({ from: offset, maxIssues: { ...offset, minimum: 1, maximum: 1000 }, suggestions: flag }, []), checked],
  ['text.spelling.open', versioned, empty, checked],
  ['text.spelling.configure', range, object({ replacement: text(128) }), owner],
  ['text.spelling.learn', range, empty, owner],
  ['text.spelling.unlearn', window, object({ word: { ...text(128), minLength: 1 } }), window],
  ['text.spelling.ignore', range, empty, owner],
  ['text.spelling.replace', range, object({ replacement: text(128) }), owner],
  ['text.substitutions.open', owner, empty, owner],
  ['text.substitutions.apply', versioned, object({ start: offset, end: offset }, []), owner],
  ['text.tools.close', window, empty, window],
  ['text.tools.focus', tool, empty, tool],
  ['text.tools.clipboard', object({ windowId: identity, control: choice('query', 'replacement', 'word'), toolId: identity, value: text(), start: offset, end: offset }),
    object({ operation: choice('copy', 'cut', 'paste', 'undo', 'redo', 'selectAll') }), object({ windowId: identity, control: identity, start: offset, end: offset })],
];
export const textToolsCatalog = Object.fromEntries(definitions.map(([name, target, payload, result]) => {
  const entry = defineCommand(profiles, name, 'shell.edit-workflows', target, payload,
    ['Exact foreground ordinary Notes owner and current readable note; native controls cannot borrow another window or retained user.',
      'Owned source/revision, read-only, size and preference limits validate before commit. Pure note changes and foreground loss invalidate pending preparations.'],
    ['Operate the real page-local Find, English spelling, substitution preferences or connected text-tool control; never host clipboard or cloud writing tools.'],
    ['editing', 'notes', 'textTools'], [], result);
  entry[1].resultSchema.additionalProperties = false;
  if (payload.minProperties && !entry[1].requestSchema.required.includes('payload')) entry[1].requestSchema.required.push('payload');
  return entry;
}));

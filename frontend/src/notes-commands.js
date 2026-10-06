import { tick } from 'svelte';
import { rejected } from './feature-commands.js';
import { visibleNotes, createNote, updateNote, togglePin, trashNote, restoreNote, selectFolder, selectNote, setSearch, nextNoteTimestamp } from './notes-state.js';

/** Transport-neutral Notes handlers. Record targets use {noteId}; focus targets use
 * {control,noteId?,folder?,item?}; scroll targets use {area:'list'|'editor'}.
 * Data commands work while unmounted. Only explicit presentation/focus requests
 * use the registered view, and never reopen a closed or minimized window. */
export function createNotesCommands(noteState, viewState, { getView, focusWindow, isVisible, prepareFocus, getSceneTime, onTimeChanged }) {
  viewState.scroll ??= { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } };
  const invalid = () => rejected('invalid_arguments', 'Invalid Notes target or payload.');
  const unavailable = () => rejected('unavailable', 'Notes presentation is not available.');
  const applied = (target = {}) => ({ status: 'applied', target });
  const fields = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));
  const focusPayload = (payload, extra = []) => fields(payload, ['focus', ...extra]) && (payload.focus === undefined || typeof payload.focus === 'boolean');
  const mounted = () => isVisible() && getView();
  const record = (target) => fields(target, ['noteId']) && typeof target.noteId === 'string' && target.noteId
    ? visibleNotes(noteState).find((note) => note.id === target.noteId) : undefined;
  const missing = () => rejected('stale_target', 'The note is not in the current visible collection.');
  const limited = () => rejected('limit_exceeded', 'The Notes authored clock is invalid or exhausted.');
  const clearContext = () => {
    viewState.context = null;
    viewState.contextItem = null;
    if (viewState.focusedControl?.control === 'context') viewState.focusedControl = null;
  };
  const items = () => noteState.folder === 'deleted' ? ['restore'] : ['pin', 'delete'];
  function validControl(target) {
    if (!fields(target, ['control', 'noteId', 'folder', 'item'])) return false;
    if (target.control === 'row') return fields(target, ['control', 'noteId']) && Boolean(record({ noteId: target.noteId }));
    if (target.control === 'folder') return fields(target, ['control', 'folder']) && noteState.sidebarVisible && ['notes', 'deleted'].includes(target.folder);
    if (target.control === 'context') return fields(target, ['control', 'item']) && Boolean(viewState.context) && items().includes(target.item);
    if (!fields(target, ['control'])) return false;
    if (['title', 'body'].includes(target.control)) return Boolean(record({ noteId: noteState.selectedId }));
    if (target.control === 'delete') return noteState.folder === 'notes' && Boolean(record({ noteId: noteState.selectedId }));
    if (target.control === 'restore') return noteState.folder === 'deleted' && Boolean(record({ noteId: noteState.selectedId }));
    return ['search', 'new-note', 'sidebar', 'none'].includes(target.control);
  }
  function reconcileFocus() {
    if (viewState.focusedControl && !validControl(viewState.focusedControl)) viewState.focusedControl = null;
  }
  async function focus(target, select = false, activate = true) {
    prepareFocus?.(target);
    if (activate) focusWindow();
    await tick();
    if (!mounted() || !validControl(target)) return;
    viewState.focusedControl = { ...target };
    if (target.control === 'context') viewState.contextItem = target.item;
    getView().focus(target, { select });
  }
  async function returnToRow(preferred) {
    const id = record({ noteId: preferred }) ? preferred : noteState.selectedId;
    await focus(id ? { control: 'row', noteId: id } : { control: 'new-note' });
  }
  function canRequestFocus(payload) { return !payload.focus || mounted(); }
  async function mutateRecord(kind, target, payload) {
    if (!focusPayload(payload, kind === 'pin' ? ['pinned'] : []) || !fields(target, ['noteId']) || typeof target.noteId !== 'string') return invalid();
    if (kind === 'pin' && typeof payload.pinned !== 'boolean') return invalid();
    const note = record(target);
    if (!note) return missing();
    if ((kind === 'restore') !== note.deleted) return rejected('read_only', kind === 'restore' ? 'Only deleted notes can be restored.' : 'Deleted notes are read-only.');
    if (!canRequestFocus(payload)) return unavailable();
    const retainedRow = !payload.focus && mounted() && viewState.focusedControl?.control === 'row' && viewState.focusedControl.noteId === note.id;
    const sceneTime = getSceneTime?.();
    if (kind !== 'pin' && nextNoteTimestamp(noteState, sceneTime) === null) return limited();
    if (kind === 'pin') { if (note.pinned !== payload.pinned) togglePin(noteState, note.id); }
    else if (kind === 'trash') trashNote(noteState, note.id, sceneTime);
    else restoreNote(noteState, note.id, sceneTime);
    if (kind !== 'pin') onTimeChanged?.(note.updatedAt);
    clearContext();
    reconcileFocus();
    if (payload.focus) await returnToRow(note.id);
    else if (retainedRow) {
      const id = record(target) ? note.id : noteState.selectedId;
      await focus(id ? { control: 'row', noteId: id } : { control: 'new-note' }, false, false);
    }
    return applied(target);
  }
  return {
    'notes.create': async (target, payload) => {
      if (!fields(target, []) || !focusPayload(payload)) return invalid();
      if (!canRequestFocus(payload)) return unavailable();
      const sceneTime = getSceneTime?.();
      if (nextNoteTimestamp(noteState, sceneTime) === null) return limited();
      clearContext();
      const noteId = createNote(noteState, '', sceneTime);
      onTimeChanged?.(noteState.notes.find(note => note.id === noteId).updatedAt);
      if (payload.focus) await focus({ control: 'title' });
      return applied({ noteId });
    },
    'notes.edit': (target, payload) => {
      if (!fields(target, ['noteId']) || typeof target.noteId !== 'string' || !fields(payload, ['text']) || typeof payload.text !== 'string') return invalid();
      const note = record(target);
      if (!note || note.id !== noteState.selectedId) return missing();
      if (note.deleted) return rejected('read_only', 'Deleted notes are read-only.');
      const sceneTime = getSceneTime?.(), beforeTime = note.updatedAt;
      if (note.text !== payload.text && nextNoteTimestamp(noteState, sceneTime) === null) return limited();
      // Match typing: leave the active search before changing a visible result.
      if (noteState.search) setSearch(noteState, '');
      clearContext();
      updateNote(noteState, note.id, payload.text, sceneTime);
      if (note.updatedAt !== beforeTime) onTimeChanged?.(note.updatedAt);
      return applied(target);
    },
    'notes.setPinned': (target, payload) => mutateRecord('pin', target, payload),
    'notes.trash': (target, payload) => mutateRecord('trash', target, payload),
    'notes.restore': (target, payload) => mutateRecord('restore', target, payload),
    'notes.select': async (target, payload) => {
      if (!fields(target, ['noteId']) || typeof target.noteId !== 'string' || !focusPayload(payload)) return invalid();
      if (!record(target)) return missing();
      if (!canRequestFocus(payload)) return unavailable();
      clearContext();
      selectNote(noteState, target.noteId);
      if (payload.focus) await focus({ control: 'row', noteId: target.noteId });
      return applied(target);
    },
    'notes.selectFolder': (target, payload) => {
      if (!fields(target, ['folder']) || !['notes', 'deleted'].includes(target.folder) || !fields(payload, [])) return invalid();
      clearContext();
      selectFolder(noteState, target.folder);
      reconcileFocus();
      return applied(target);
    },
    'notes.search': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['query']) || typeof payload.query !== 'string') return invalid();
      clearContext();
      setSearch(noteState, payload.query);
      reconcileFocus();
      return applied();
    },
    'notes.setSidebarVisible': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['visible']) || typeof payload.visible !== 'boolean') return invalid();
      clearContext();
      noteState.sidebarVisible = payload.visible;
      if (!payload.visible && viewState.focusedControl?.control === 'folder') viewState.focusedControl = null;
      return applied();
    },
    'notes.context.open': async (target, payload) => {
      if (!fields(target, ['noteId']) || typeof target.noteId !== 'string' || !focusPayload(payload, ['x', 'y'])
        || ((payload.x !== undefined || payload.y !== undefined) && (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)))) return invalid();
      if (!record(target)) return missing();
      if (!mounted()) return unavailable();
      const position = getView().anchorContext(target.noteId, payload.x === undefined ? undefined : { x: payload.x, y: payload.y });
      if (!position) return missing();
      selectNote(noteState, target.noteId);
      viewState.context = { id: target.noteId, ...position };
      viewState.contextItem = items()[0];
      if (payload.focus) await focus({ control: 'context', item: viewState.contextItem });
      return applied(target);
    },
    'notes.context.close': async (target, payload) => {
      if (!fields(target, []) || !focusPayload(payload)) return invalid();
      if (!mounted()) return unavailable();
      const id = viewState.context?.id;
      if (!id) return rejected('stale_target', 'No Notes context menu is open.');
      clearContext();
      if (payload.focus) await returnToRow(id);
      return applied();
    },
    'notes.context.select': async (target, payload) => {
      if (!fields(target, ['item']) || typeof target.item !== 'string' || !focusPayload(payload)) return invalid();
      if (!mounted()) return unavailable();
      if (!viewState.context || !record({ noteId: viewState.context.id }) || !items().includes(target.item)) return rejected('stale_target', 'The context item is not available.');
      viewState.contextItem = target.item;
      if (payload.focus) await focus({ control: 'context', item: target.item });
      return applied(target);
    },
    'notes.context.execute': (target, payload) => {
      if (!fields(target, ['noteId', 'item']) || typeof target.noteId !== 'string' || !['pin', 'delete', 'restore'].includes(target.item)
        || !focusPayload(payload, target.item === 'pin' ? ['pinned'] : []) || (target.item === 'pin' && typeof payload.pinned !== 'boolean')) return invalid();
      if (!mounted()) return unavailable();
      if (viewState.context?.id !== target.noteId || !items().includes(target.item)) return rejected('stale_target', 'The context action is no longer available.');
      return mutateRecord(target.item === 'delete' ? 'trash' : target.item, { noteId: target.noteId }, payload);
    },
    'notes.focus': async (target, payload) => {
      if (!fields(payload, ['observe', 'select']) || (payload.observe !== undefined && typeof payload.observe !== 'boolean')
        || (payload.select !== undefined && typeof payload.select !== 'boolean') || (payload.observe && payload.select) || !validControl(target)) return invalid();
      if (!mounted()) return unavailable();
      if (payload.observe) {
        viewState.focusedControl = target.control === 'none' ? null : { ...target };
        if (target.control === 'context') viewState.contextItem = target.item;
      } else {
        if (target.control === 'none') return invalid();
        await focus(target, payload.select);
      }
      return applied(target);
    },
    'notes.scroll': (target, payload) => {
      if (!fields(target, ['area']) || !['list', 'editor'].includes(target.area) || !fields(payload, ['top', 'left', 'observe'])
        || (!Object.hasOwn(payload, 'top') && !Object.hasOwn(payload, 'left'))
        || (payload.top !== undefined && (!Number.isFinite(payload.top) || payload.top < 0))
        || (payload.left !== undefined && (!Number.isFinite(payload.left) || payload.left < 0))
        || (payload.observe !== undefined && typeof payload.observe !== 'boolean')) return invalid();
      if (!mounted() || (target.area === 'editor' && !record({ noteId: noteState.selectedId }))) return unavailable();
      if (!payload.observe) getView().scroll(target.area, payload);
      viewState.scroll[target.area] = getView().scrollPosition(target.area);
      return applied(target);
    },
  };
}

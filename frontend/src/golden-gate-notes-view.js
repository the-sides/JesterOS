// Golden Gate DOM facade. Canonical Notes commands own all application state.
export function createGoldenGateNotesView({ execute, state, presentation, refs, isActive }) {
  const command = (name, target = {}, payload = {}) => execute({ command: `notes.${name}`, target, payload });
  const selected = () => state().notes.find((note) => note.id === state().selectedId);
  const firstLine = (note) => note.text.split('\n', 1)[0];
  const bodyText = (note) => { const newline = note.text.indexOf('\n'); return newline < 0 ? '' : note.text.slice(newline + 1); };
  const newNote = () => execute({ command: 'notes.document.create', target: {}, payload: {} });
  const edit = (title, body) => command('edit', { noteId: selected().id }, { text: body ? `${title}\n${body}` : title });

  function controlElement(target) {
    const elements = refs();
    if (target.control === 'title') return elements.title;
    if (target.control === 'body') return elements.body;
    if (target.control === 'search') return elements.search;
    return [...elements.root.querySelectorAll('[data-golden-gate-notes-control]')].find((element) =>
      element.dataset.goldenGateNotesControl === target.control
      && (target.noteId === undefined || element.dataset.noteId === target.noteId)
      && (target.folder === undefined || element.dataset.folder === target.folder)
      && (target.item === undefined || element.dataset.item === target.item));
  }
  function observeFocus(event) {
    const element = event.target.closest('[data-golden-gate-notes-control]');
    if (!element || !refs().root.contains(element)) return command('focus', { control: 'none' }, { observe: true });
    const target = { control: element.dataset.goldenGateNotesControl };
    if (target.control === 'row') target.noteId = element.dataset.noteId;
    if (target.control === 'folder') target.folder = element.dataset.folder;
    if (target.control === 'context') target.item = element.dataset.item;
    return command('focus', target, { observe: true });
  }
  function observeBlur(event) {
    if (!refs().root.contains(event.relatedTarget)) command('focus', { control: 'none' }, { observe: true });
  }
  function observeScroll(area, event) {
    command('scroll', { area }, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true });
  }
  function keyboard(event) {
    if (!isActive() || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); newNote(); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); command('focus', { control: 'search' }, { select: true }); }
  }
  function dismissContext(event) {
    if (isActive() && presentation().context && !refs().context?.contains(event.target)) command('context.close');
  }
  function openContext(event, note, fromKeyboard = false) {
    event.preventDefault();
    const payload = { focus: true };
    if (!fromKeyboard) {
      const root = refs().root;
      const rect = root.getBoundingClientRect();
      const scale = rect.width / root.clientWidth;
      payload.x = (event.clientX - rect.left) / scale;
      payload.y = (event.clientY - rect.top) / scale;
    }
    command('context.open', { noteId: note.id }, payload);
  }
  function contextAction(item) {
    const noteId = presentation().context.id;
    const note = state().notes.find((entry) => entry.id === noteId);
    return command('context.execute', { noteId, item }, { focus: true, ...(item === 'pin' ? { pinned: !note.pinned } : {}) });
  }
  function contextKeydown(event) {
    const items = state().folder === 'deleted' ? ['restore'] : ['pin', 'delete'];
    const index = items.indexOf(presentation().contextItem);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); command('context.close', {}, { focus: true }); return; }
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    command('context.select', { item: items[next] }, { focus: true });
  }
  function rowKeydown(event, note, notes) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { openContext(event, note, true); return; }
    let index = notes.findIndex((item) => item.id === note.id);
    if (event.key === 'ArrowDown') index = Math.min(notes.length - 1, index + 1);
    else if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = notes.length - 1;
    else return;
    event.preventDefault();
    command('select', { noteId: notes[index].id }, { focus: true });
  }
  function register(registerView) {
    const scrollElement = (area) => area === 'list' ? refs().list : refs().body;
    const view = {
      anchorContext(noteId, position) {
        const row = controlElement({ control: 'row', noteId });
        if (!row) return null;
        if (!position) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const root = refs().root;
        const rect = root.getBoundingClientRect();
        const scale = rect.width / root.clientWidth;
        const anchor = row.getBoundingClientRect();
        return {
          left: Math.max(4, Math.min(root.clientWidth - 220, position?.x ?? (anchor.right - rect.left) / scale)),
          top: Math.max(4, Math.min(root.clientHeight - 90, position?.y ?? (anchor.top - rect.top) / scale)),
        };
      },
      focus(target, { select = false } = {}) {
        const element = controlElement(target);
        if (!element) return;
        if (document.activeElement !== element) element.focus();
        if (select) element.select?.();
      },
      scroll(area, position) {
        const element = scrollElement(area);
        if (!element) return;
        if (position.top !== undefined) element.scrollTop = position.top;
        if (position.left !== undefined) element.scrollLeft = position.left;
      },
      scrollPosition(area) {
        const element = scrollElement(area);
        return { top: element?.scrollTop ?? 0, left: element?.scrollLeft ?? 0 };
      },
    };
    const cleanup = registerView(view);
    for (const area of ['list', 'editor']) view.scroll(area, presentation().scroll?.[area] ?? { top: 0, left: 0 });
    return cleanup;
  }
  return { command, firstLine, bodyText, newNote, edit, observeFocus, observeBlur, observeScroll, keyboard, dismissContext, openContext, contextAction, contextKeydown, rowKeydown, register };
}

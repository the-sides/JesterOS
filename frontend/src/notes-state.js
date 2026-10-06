const SCENE_TIME = Date.UTC(2018, 8, 24, 17, 0);

export function createNotesState(timeBase = SCENE_TIME) {
  return {
    timeBase,
    notes: [
      {
        id: 'note-1',
        text: 'Camping trip\nLeave Friday after lunch and drive up to the lake.\n\nBring the tent, sleeping bags, a lantern, and the little camp stove. Check the weather before we go.\n\nMeet Emma at the trailhead at 3:00. She is bringing coffee and the map.',
        pinned: true,
        deleted: false,
        createdAt: timeBase,
        updatedAt: timeBase + 42 * 60 * 1000,
      },
      {
        id: 'note-2',
        text: 'Photography spots\nThe old pier at sunrise.\nThe overlook above the lake, just before sunset.\nThe trail through the birch trees if the leaves have started turning.\n\nPack the 35mm lens, a spare battery, and the tripod.',
        pinned: false,
        deleted: false,
        createdAt: timeBase + 5 * 60 * 1000,
        updatedAt: timeBase + 35 * 60 * 1000,
      },
      {
        id: 'note-3',
        text: 'Shopping list\nApples\nBread and cheese\nCoffee\nTrail mix\nMarshmallows\nMatches\n\nPick everything up on Thursday evening.',
        pinned: false,
        deleted: false,
        createdAt: timeBase + 10 * 60 * 1000,
        updatedAt: timeBase + 20 * 60 * 1000,
      },
      {
        id: 'note-4',
        text: 'Old packing list\nRain jacket\nExtra socks\nWater bottles\n\nCopied these into the camping note.',
        pinned: false,
        deleted: true,
        createdAt: timeBase + 2 * 60 * 1000,
        updatedAt: timeBase + 30 * 60 * 1000,
      },
    ],
    selectedId: 'note-1',
    folder: 'notes',
    search: '',
    sidebarVisible: true,
  };
}

export function noteTitle(note) {
  return note.text.split(/\r?\n/, 1)[0].trim() || 'New Note';
}

export function notePreview(note) {
  const firstBreak = note.text.indexOf('\n');
  return firstBreak === -1 ? '' : normalizeWhitespace(note.text.slice(firstBreak + 1));
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const titleOrder = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const DAY = 24 * 60 * 60 * 1000;
const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function visibleNotes(state) {
  const query = normalizeWhitespace(state.search).toLowerCase();
  const deleted = state.folder === 'deleted';
  return state.notes
    .filter((note) => note.deleted === deleted && (!query || normalizeWhitespace(`${noteTitle(note)}\n${note.text}`).toLowerCase().includes(query)))
    .sort((a, b) => {
      if (!deleted && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (state.preferences) {
        const sortBy = state.preferences.sortBy;
        const direction = state.preferences.sortDirection === 'ascending' ? 1
          : state.preferences.sortDirection === 'descending' ? -1 : sortBy === 'title' ? 1 : -1;
        if (sortBy === 'title') return direction * titleOrder.compare(noteTitle(a), noteTitle(b)) || compareIds(a, b);
        const primary = sortBy === 'date-created' ? 'createdAt' : 'updatedAt';
        const secondary = sortBy === 'date-created' ? 'updatedAt' : 'createdAt';
        return direction * (a[primary] - b[primary] || a[secondary] - b[secondary]) || compareIds(a, b);
      }
      return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
    });
}

// The fixture's latest record (including hidden/deleted records) is the clock.
// UTC day boundaries keep date groups stable across hosts and saved sessions.
export function groupNotes(state) {
  const notes = visibleNotes(state);
  if (!notes.length) return [];
  const groups = [];
  const pinned = state.folder !== 'deleted' ? notes.filter(note => note.pinned) : [];
  const unpinned = state.folder !== 'deleted' ? notes.filter(note => !note.pinned) : notes;
  if (pinned.length) groups.push({ id: 'pinned', label: 'Pinned', notes: pinned });
  if (!unpinned.length) return groups;
  if (!state.preferences?.groupByDate || state.preferences.sortBy === 'title') {
    groups.push({ id: 'notes', label: 'Notes', notes: unpinned });
    return groups;
  }
  const clock = state.notes.reduce((latest, note) => Math.max(latest, note.createdAt, note.updatedAt), state.timeBase);
  const today = Math.floor(clock / DAY);
  const year = new Date(clock).getUTCFullYear();
  const field = state.preferences.sortBy === 'date-created' ? 'createdAt' : 'updatedAt';
  const byId = new Map();
  for (const note of unpinned) {
    const age = today - Math.floor(note[field] / DAY);
    const date = new Date(note[field]);
    let id, label;
    if (age === 0) { id = 'today'; label = 'Today'; }
    else if (age === 1) { id = 'yesterday'; label = 'Yesterday'; }
    else if (age < 7) { id = 'previous-7-days'; label = 'Previous 7 Days'; }
    else if (age < 30) { id = 'previous-30-days'; label = 'Previous 30 Days'; }
    else if (date.getUTCFullYear() === year) {
      id = `month-${year}-${date.getUTCMonth() + 1}`;
      label = monthLabel.format(date);
    } else {
      id = `year-${date.getUTCFullYear()}`;
      label = String(date.getUTCFullYear());
    }
    let group = byId.get(id);
    if (!group) {
      group = { id, label, notes: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.notes.push(note);
  }
  return groups;
}

function nextTimestamp(state) {
  return state.notes.reduce((latest, note) => Math.max(latest, note.createdAt, note.updatedAt), state.timeBase) + 1;
}

function reconcileSelection(state, fallbackIndex = 0) {
  const notes = visibleNotes(state);
  if (!notes.some((note) => note.id === state.selectedId)) {
    state.selectedId = notes[Math.min(fallbackIndex, notes.length - 1)]?.id ?? null;
  }
}

function editableNote(state, id) {
  if (state.folder !== 'notes') return undefined;
  return visibleNotes(state).find((note) => note.id === id);
}

export function createNote(state, text = '') {
  const timestamp = nextTimestamp(state);
  let number = state.notes.length + 1;
  while (state.notes.some((note) => note.id === `note-${number}`)) number += 1;
  const note = {
    id: `note-${number}`,
    text,
    pinned: false,
    deleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.notes.push(note);
  state.folder = 'notes';
  state.search = '';
  state.selectedId = note.id;
  return note.id;
}

export function updateNote(state, id, text) {
  const note = editableNote(state, id);
  if (!note || typeof text !== 'string' || note.text === text) return;
  note.updatedAt = nextTimestamp(state);
  note.text = text;
  // Losing a search match must not silently switch the editor to another note.
  if (!visibleNotes(state).some((entry) => entry.id === state.selectedId)) state.selectedId = null;
}

export function togglePin(state, id) {
  const note = editableNote(state, id);
  if (!note) return;
  note.pinned = !note.pinned;
  reconcileSelection(state);
}

export function trashNote(state, id) {
  const notes = visibleNotes(state);
  const index = notes.findIndex((note) => note.id === id);
  if (state.folder !== 'notes' || index === -1) return;
  const note = notes[index];
  note.updatedAt = nextTimestamp(state);
  note.deleted = true;
  reconcileSelection(state, index);
}

export function restoreNote(state, id) {
  const notes = visibleNotes(state);
  const index = notes.findIndex((note) => note.id === id);
  if (state.folder !== 'deleted' || index === -1) return;
  const note = notes[index];
  note.updatedAt = nextTimestamp(state);
  note.deleted = false;
  reconcileSelection(state, index);
}

export function selectFolder(state, folder) {
  if (folder !== 'notes' && folder !== 'deleted') return;
  state.folder = folder;
  reconcileSelection(state);
}

export function selectNote(state, id) {
  if (visibleNotes(state).some((note) => note.id === id)) state.selectedId = id;
}

export function setSearch(state, query) {
  if (typeof query !== 'string') return;
  state.search = query;
  reconcileSelection(state);
}

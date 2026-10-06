import { isRecord, rejected } from './feature-commands.js';
import { createNote, noteTitle, visibleNotes } from './notes-state.js';
import { liveMacFileRecords, validMacDesktopName } from './desktop-file-state.js';
import { createNotesPdf } from './notes-pdf.js';
import { PRINTING_LIMITS, printedPageTotal, validatePrintingState } from './printing-state.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL = 4 * MAX_TEXT, MAX_ITEMS = 1024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const identity = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  && ![...Object.getOwnPropertyNames(Object.prototype), 'prototype'].includes(value);
const optional = (object, key, check) => !Object.hasOwn(object, key) || check(object[key]);
const rangeFields = payload => optional(payload, 'pageFrom', value => integer(value, 1, 1024))
  && optional(payload, 'pageTo', value => integer(value, 1, 1024));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed target and payload with valid field types.');
const stale = () => rejected('stale_target', 'The source or destination changed while preparing this operation.');
const unavailable = () => rejected('unavailable', 'This file workflow is not available in the current scene.');
const limited = () => rejected('limit_exceeded', 'The operation exceeds the scene’s safe content, collection, clock or counter limits.');
const anchors = new Set(['disk', 'desktop', 'downloads', 'trash', 'applications', 'documents', 'icloud-drive', 'mail-cache']);

function stringBudget(value, seen = new Set()) {
  if (typeof value === 'string') return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return Infinity;
  seen.add(value);
  let total = 0;
  // Match scene-seed plainData: enumerable keys (including array indices) and
  // string values both consume UTF-16 units; array length is not enumerable.
  for (const [key, entry] of Object.entries(value)) {
    total += key.length + stringBudget(entry, seen);
    if (total > MAX_TOTAL) break;
  }
  seen.delete(value);
  return total;
}
export function notesMarkdown(text) {
  const match = /\r\n|\r|\n/.exec(text);
  const title = match ? text.slice(0, match.index) : text;
  const body = match ? text.slice(match.index + match[0].length) : '';
  // Escape inline Markdown syntax in the heading without trimming the source.
  const heading = title.replace(/[\\`*_{}\[\]()#+.!<>~-]/g, '\\$&');
  return `# ${heading}\n\n${body}`;
}

/** Data-only handlers. captureLease() returns a guard captured once per call;
 * prepareNotesFocus resolves before duplication; notesCreated settles its new native view after commit.
 * No handler opens a window or owns a UI sheet. */
export function createNotesFileCommands(notes, files, printing, context) {
  const available = () => context.available();
  const source = noteId => visibleNotes(notes).find(note => note.id === noteId);
  const primitiveKeys = ['id', 'text', 'pinned', 'deleted', 'createdAt', 'updatedAt'];
  function capture(noteId) {
    const note = source(noteId);
    if (!note || !identity(note.id) || typeof note.text !== 'string' || note.text.length > MAX_TEXT
      || typeof note.pinned !== 'boolean' || typeof note.deleted !== 'boolean'
      || !integer(note.createdAt, 0, MAX_TIME) || !integer(note.updatedAt, note.createdAt, MAX_TIME)) return null;
    const values = primitiveKeys.map(key => note[key]);
    return { note, valid: () => source(noteId) === note && primitiveKeys.every((key, index) => note[key] === values[index]), text: note.text };
  }
  const budget = () => {
    const other = context.otherTextSize?.() ?? 0;
    if (!integer(other, 0, MAX_TOTAL)) return Infinity;
    return other + stringBudget(notes) + stringBudget({ ...files, files: files.files.filter(file => !file.readOnly) }) + stringBudget(printing);
  };
  const noteClock = () => notes.notes.reduce((latest, note) => Math.max(latest, note.createdAt, note.updatedAt), notes.timeBase);
  const begin = () => context.captureLease?.() ?? (() => true);
  function check(snapshot, current) {
    if (!current() || !available()) return unavailable();
    if (!snapshot.valid()) return stale();
    return null;
  }
  function destination(payload) {
    const live = liveMacFileRecords(files);
    const folder = live.find(file => file.id === payload.folderId);
    if (!folder || folder.kind !== 'folder') return { error: stale() };
    const byId = new Map(files.files.map(file => [file.id, file]));
    const seen = new Set();
    let ancestor = folder;
    while (ancestor) {
      if (seen.has(ancestor.id) || ancestor.kind !== 'folder') return { error: stale() };
      if (ancestor.readOnly || ancestor.id === 'trash') return { error: rejected('disabled', 'This simulated destination is read-only or Trash.') };
      seen.add(ancestor.id);
      if (ancestor.parentId === null) break;
      ancestor = byId.get(ancestor.parentId);
      if (!ancestor) return { error: stale() };
    }
    const collisions = live.filter(file => file.parentId === folder.id && file.name.toLowerCase() === payload.name.toLowerCase());
    const replacement = payload.replaceFileId === undefined ? null : live.find(file => file.id === payload.replaceFileId);
    if (payload.replaceFileId !== undefined && (!replacement || replacement.parentId !== folder.id
      || replacement.name.toLowerCase() !== payload.name.toLowerCase())) return { error: stale() };
    if (replacement && (replacement.kind !== 'document' || replacement.readOnly || anchors.has(replacement.id))) {
      return { error: rejected('disabled', 'Protected folders and application catalog records cannot be overwritten.') };
    }
    if (collisions.some(file => file !== replacement)) return { error: rejected('collision', 'A live file already has that name. Explicit replacement is required.') };
    return { folder, replacement };
  }
  function destinationSnapshot(value) {
    const records = [value.folder, value.replacement].filter(Boolean);
    const values = records.map(record => Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? JSON.stringify(value) : value]));
    return () => records.every((record, index) => files.files.includes(record)
      && Object.keys(record).length === values[index].length
      && values[index].every(([key, value]) => (Array.isArray(record[key]) ? JSON.stringify(record[key]) : record[key]) === value));
  }
  async function pdf(snapshot, current, timestamp, range = {}, destinationCheck) {
    return createNotesPdf(snapshot.text, timestamp, { ...range, fontLoader: context.fontLoader ? async () => {
      const bytes = await context.fontLoader();
      const failure = check(snapshot, current) ?? destinationCheck?.();
      if (failure) { const error = new Error(failure.error.message); error.code = failure.error.code; throw error; }
      return bytes;
    } : undefined });
  }
  const pdfError = error => rejected(['unsupported_content', 'invalid_arguments', 'limit_exceeded', 'stale_target', 'collision', 'disabled'].includes(error?.code) ? error.code : 'unavailable', error?.message ?? 'Document preparation failed.');
  const validPrinting = () => validatePrintingState(printing).ok;
  return {
    'notes.duplicate': async (target, payload) => {
      if (!fields(target, ['noteId']) || !identity(target.noteId) || !fields(payload, ['focus'], [])
        || !optional(payload, 'focus', value => typeof value === 'boolean')) return invalid();
      const current = begin();
      if (!current() || !available()) return unavailable();
      const snapshot = capture(target.noteId);
      if (!snapshot) return stale();
      if (snapshot.note.deleted || notes.folder !== 'notes') return rejected('disabled', 'Recently Deleted notes are read-only.');
      if (payload.focus) {
        if (!context.isNotesVisible()) return unavailable();
        let ready;
        try { ready = await context.prepareNotesFocus(); } catch { return unavailable(); }
        const failure = check(snapshot, current);
        if (failure) return failure;
        if (!ready || !context.isNotesVisible()) return unavailable();
      }
      const failure = check(snapshot, current);
      if (failure) return failure;
      const time = noteClock();
      let number = notes.notes.length + 1;
      while (notes.notes.some(note => note.id === `note-${number}`) && number < MAX_COUNTER) number++;
      const newId = `note-${number}`;
      const projected = { ...notes, notes: [...notes.notes, { id: newId, text: snapshot.text, pinned: false, deleted: false,
        createdAt: time + 1, updatedAt: time + 1 }], folder: 'notes', search: '', selectedId: newId };
      if (notes.notes.length >= MAX_ITEMS || !integer(time, 0, MAX_TIME - 1) || number >= MAX_COUNTER
        || budget() - stringBudget(notes) + stringBudget(projected) > MAX_TOTAL) return limited();
      const noteId = createNote(notes, snapshot.text);
      await context.notesCreated?.(noteId, payload.focus === true);
      return applied({ noteId });
    },
    'notes.export': async (target, payload) => {
      if (!fields(target, ['noteId']) || !identity(target.noteId)
        || !fields(payload, ['folderId', 'name', 'format', 'tags', 'replaceFileId', 'pageFrom', 'pageTo'], ['folderId', 'name', 'format'])
        || !identity(payload.folderId) || !validMacDesktopName(payload.name) || !['markdown', 'pdf'].includes(payload.format)
        || !optional(payload, 'replaceFileId', identity) || !rangeFields(payload)
        || (payload.format !== 'pdf' && (Object.hasOwn(payload, 'pageFrom') || Object.hasOwn(payload, 'pageTo')))
        || !optional(payload, 'tags', value => Array.isArray(value) && value.length <= 64 && Array.from(value).every(tag => typeof tag === 'string' && tag.length <= 256))) return invalid();
      // Freeze request values too: internal callers need not have passed JSON.
      const draft = { ...payload, tags: [...(payload.tags ?? [])] };
      const current = begin();
      if (!current() || !available()) return unavailable();
      const snapshot = capture(target.noteId);
      if (!snapshot) return stale();
      const initial = destination(draft);
      if (initial.error) return initial.error;
      const unchangedDestination = destinationSnapshot(initial);
      const destinationCheck = () => {
        if (!unchangedDestination()) return stale();
        const checked = destination(draft);
        return checked.error ?? (checked.folder !== initial.folder || checked.replacement !== initial.replacement ? stale() : null);
      };
      let content;
      if (draft.format === 'pdf') {
        try { const output = await pdf(snapshot, current, snapshot.note.updatedAt, { pageFrom: draft.pageFrom, pageTo: draft.pageTo }, destinationCheck); content = `data:application/pdf;base64,${output.base64}`; }
        catch (error) { return pdfError(error); }
      } else content = notesMarkdown(snapshot.text);
      const failure = check(snapshot, current);
      if (failure) return failure;
      if (!unchangedDestination()) return stale();
      const final = destination(draft);
      if (final.error) return final.error;
      if (final.folder !== initial.folder || final.replacement !== initial.replacement) return stale();
      const replacing = final.replacement;
      if (!integer(files.sceneTime, 0, MAX_TIME - 1) || content.length > MAX_TEXT
        || (replacing && !integer(replacing.revision, 1, MAX_COUNTER - 1))) return limited();
      const timestamp = files.sceneTime + 1;
      let number = files.nextFileId;
      if (!replacing) {
        if (!integer(number, 1, MAX_COUNTER - 1)) return limited();
        while (files.files.some(file => file.id === `file-${number}`) && number < MAX_COUNTER) number++;
        if (files.files.filter(file => !file.readOnly).length >= MAX_ITEMS || number >= MAX_COUNTER) return limited();
      }
      const file = { ...(replacing ?? {}), id: replacing?.id ?? `file-${number}`, parentId: draft.folderId,
        name: draft.name, kind: 'document', appId: draft.format === 'markdown' ? 'textedit' : 'preview', icon: draft.format === 'pdf' ? 'pdf' : 'document',
        content, deleted: false, revision: replacing ? replacing.revision + 1 : 1,
        createdAt: replacing?.createdAt ?? timestamp, modifiedAt: timestamp, addedAt: replacing?.addedAt ?? timestamp,
        lastOpenedAt: replacing?.lastOpenedAt ?? null, tags: draft.tags };
      const addedIndexBudget = replacing ? 0 : String(files.files.filter(entry => !entry.readOnly).length).length;
      if (budget() - (replacing ? stringBudget(replacing) : 0) + stringBudget(file) + addedIndexBudget > MAX_TOTAL) return limited();
      // All fallible preparation/revalidation precedes the single commit.
      files.sceneTime = timestamp;
      if (replacing) Object.assign(replacing, file);
      else { files.files.push(file); files.nextFileId = number + 1; }
      return applied({ fileId: file.id });
    },
    'printing.submit': async (target, payload) => {
      if (!fields(target, ['noteId']) || !identity(target.noteId) || !fields(payload, ['copies', 'pageFrom', 'pageTo'], ['copies'])
        || !integer(payload.copies, 1, 99) || !rangeFields(payload)) return invalid();
      const draft = { ...payload }, current = begin();
      if (!current() || !available()) return unavailable();
      const snapshot = capture(target.noteId);
      if (!snapshot) return stale();
      let output;
      try { output = await pdf(snapshot, current, snapshot.note.updatedAt, { pageFrom: draft.pageFrom, pageTo: draft.pageTo }); } catch (error) { return pdfError(error); }
      const failure = check(snapshot, current);
      if (failure) return failure;
      const pageFrom = draft.pageFrom ?? 1, pageTo = draft.pageTo ?? output.pageCount;
      if (pageFrom > pageTo || pageTo > output.pageCount) return rejected('invalid_arguments', 'The requested range exceeds this note’s actual pagination.');
      if (!validPrinting()) return rejected('invalid_state', 'The print queue is not a valid bounded state.');
      const timestamp = Math.max(noteClock(), files.sceneTime, ...printing.jobs.map(job => job.createdAt));
      if (printing.jobs.length >= PRINTING_LIMITS.jobs || !integer(printing.nextJobId, 1, MAX_COUNTER - 1)
        || !integer(timestamp, 0, MAX_TIME - 1)) return limited();
      const job = { id: `job-${printing.nextJobId}`, title: noteTitle(snapshot.note), sourceNoteId: snapshot.note.id,
        printerId: 'studio-printer', copies: draft.copies, pageCount: output.pageCount, pageFrom, pageTo,
        pdfBase64: output.base64, status: 'queued', printedPages: 0, createdAt: timestamp + 1 };
      if (budget() + stringBudget(job) + String(printing.jobs.length).length > MAX_TOTAL) return limited();
      printing.jobs.push(job); printing.nextJobId++;
      return applied({ jobId: job.id });
    },
    'printing.job.setPaused': (target, payload) => {
      if (!fields(target, ['jobId']) || !identity(target.jobId) || !fields(payload, ['paused']) || typeof payload.paused !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (!validPrinting()) return rejected('invalid_state', 'The print queue is not a valid bounded state.');
      const job = printing.jobs.find(job => job.id === target.jobId);
      if (!job) return stale();
      if (payload.paused ? !['queued', 'printing'].includes(job.status) : job.status !== 'paused') return rejected('disabled', 'Only pending jobs can pause and only paused jobs can resume.');
      job.status = payload.paused ? 'paused' : 'queued';
      return applied({ jobId: job.id });
    },
    'printing.job.cancel': (target, payload) => {
      if (!fields(target, ['jobId']) || !identity(target.jobId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!validPrinting()) return rejected('invalid_state', 'The print queue is not a valid bounded state.');
      const job = printing.jobs.find(job => job.id === target.jobId);
      if (!job) return stale();
      if (!['queued', 'printing', 'paused'].includes(job.status)) return rejected('disabled', 'Completed and cancelled jobs are terminal.');
      if (budget() + 'cancelled'.length - job.status.length > MAX_TOTAL) return limited();
      job.status = 'cancelled';
      return applied({ jobId: job.id });
    },
    'printing.advance': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['pages']) || !integer(payload.pages, 1, 1024)) return invalid();
      if (!available()) return unavailable();
      if (!validPrinting()) return rejected('invalid_state', 'The print queue is not a valid bounded state.');
      let remaining = payload.pages;
      const jobIds = [];
      const updates = [];
      const pending = printing.jobs.filter(job => ['queued', 'printing'].includes(job.status));
      // A resumed earlier FIFO job can preempt a later partial job. Queued jobs
      // retain progress; a resume never discards already printed virtual pages.
      for (const job of pending) {
        if (!remaining) {
          if (job.status === 'printing') updates.push({ job, status: 'queued', printedPages: job.printedPages });
          continue;
        }
        const count = Math.min(remaining, printedPageTotal(job) - job.printedPages);
        const printedPages = job.printedPages + count;
        remaining -= count;
        updates.push({ job, printedPages, status: printedPages === printedPageTotal(job) ? 'completed' : 'printing' });
        jobIds.push(job.id);
      }
      const addedBudget = updates.reduce((total, update) => total + update.status.length - update.job.status.length, 0);
      if (budget() + addedBudget > MAX_TOTAL) return limited();
      for (const update of updates) { update.job.printedPages = update.printedPages; update.job.status = update.status; }
      return applied({ jobIds });
    },
  };
}

import { defineCommand, object, empty, flag, identity, choice, NONE } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const capability = 'shell.file-workflows';
const page = { type: 'integer', minimum: 1, maximum: 1024 };
const noteTarget = object({ noteId: identity }), jobTarget = object({ jobId: identity });
const range = { pageFrom: page, pageTo: page };
const available = 'A live current Golden Gate per-user scene supports shell.file-workflows and permits file workflows; no host IO.';
const readable = 'The noteId names an existing readable record in the current visible Notes collection; nonselected and Recently Deleted records can export or print.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const entry = defineCommand(profiles, name, capability, target, payload, [available, ...requires], presentation, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied',
    settles: 'Real model mutation and immutable PDF preparation, followed by the host’s DOM settlement. Failure never changes counters, notes, files or jobs. No physical printer, host filesystem or network service.' };
  return entry;
};
const catalog = Object.fromEntries([
  define('notes.duplicate', noteTarget, object({ focus: flag }, []),
    ['The source is a current visible, nondeleted note. Explicit focus additionally requires an already-visible Notes window and successful focus preparation.'],
    ['Select a new unpinned note with the exact complete source text; never implicitly reopen Notes.'],
    ['Append one note at the next deterministic note timestamp. Preserve every source primitive, pin and timestamp. Revalidate source and captured scene lease after asynchronous focus preparation.'], noteTarget),
  define('notes.export', noteTarget, {
    ...object({ folderId: identity, name: { type: 'string', minLength: 1, maxLength: 255 }, format: choice('markdown', 'pdf'),
      tags: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 256 } }, replaceFileId: identity, ...range }, ['folderId', 'name', 'format']),
    allOf: [{ if: { type: 'object', properties: { format: { const: 'markdown' } }, required: ['format'] },
      then: { type: 'object', properties: { pageFrom: false, pageTo: false } } }],
  }, [readable, 'A live writable ordinary folder, valid native Mac filename and collision-free destination, or an explicit matching writable document replacement. Protected anchors and application catalog records cannot be replaced.',
    'PDF ranges are inclusive and validated against actual pagination. Unsupported font content rejects honestly.'],
  ['Create or replace a genuine Markdown/TextEdit or PDF/Preview virtual document; no download or host picker.'],
  ['Preserve original note and selection. Markdown uses a first-line title heading and full body; PDF embeds the bundled font and stores a standard data:application/pdf;base64 URL.',
    'Allocate native file-N IDs only for new files; preserve replacement identity, created/added/last-opened timestamps; advance revision/modifiedAt and sceneTime only on success.'], object({ fileId: identity })),
  define('printing.submit', noteTarget, object({ copies: { type: 'integer', minimum: 1, maximum: 99 }, ...range }, ['copies']),
    [readable, 'An actual PDF can faithfully represent the complete note and the inclusive selected range fits its actual pagination.'],
    ['Queue an immutable note PDF snapshot on the fictional Studio Printer; never contact a physical printer.'],
    ['Append one bounded job-N record and increment nextJobId only after all asynchronous source/lease and range checks. Store only selected PDF output pages alongside full source pagination, range and copies; later note edits cannot alter queued PDF bytes.'], jobTarget),
  define('printing.job.setPaused', jobTarget, object({ paused: flag }),
    ['Pause only queued/printing jobs; resume only paused jobs. Completed and cancelled jobs are terminal.'],
    ['Show paused status or return the job to the FIFO queue without discarding progress.'], ['Change only the targeted job status.'], jobTarget),
  define('printing.job.cancel', jobTarget, empty,
    ['A queued, printing or paused job exists; terminal jobs cannot be cancelled again.'],
    ['Cancel the fictional job and retain its archive, immutable PDF and existing progress.'], ['Change only the targeted job status to cancelled.'], jobTarget),
  define('printing.advance', empty, object({ pages: page }), [],
    ['Advance virtual printed pages only; paused and terminal jobs are skipped.'],
    ['Process pending jobs in submission FIFO order, including all selected pages multiplied by copies. Complete at exact total; retain partial progress and return only IDs advanced in this call.'],
    object({ jobIds: { type: 'array', items: identity, uniqueItems: true } })),
]);

/** No historical profile exposes the current-only workflow commands. */
export function fileWorkflowCatalog(profile) {
  return profile?.id === profiles[0] && profile.capabilities?.includes(capability) ? catalog : {};
}

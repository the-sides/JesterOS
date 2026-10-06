import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const dialog = object({ dialogId: identity });
const page = { type: 'integer', minimum: 1, maximum: 1024 };
const tags = { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 256 } };
const available = 'Foreground awake local Golden scene without a competing shell presentation; no host filesystem or printer access.';
const owned = 'Exact current dialogId and its original visible ordinary Notes window and unchanged readable note; stale targets never retarget.';
const define = (name, target, payload, requires, presentation, data = ['fileDialog'], result = dialog) => {
  const entry = defineCommand(profiles, name, 'shell.file-workflows', target, payload,
    requires, presentation, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  if (payload.minProperties && !entry[1].requestSchema.required.includes('payload')) entry[1].requestSchema.required.push('payload');
  return entry;
};
export const fileDialogCatalog = Object.fromEntries([
  define('fileDialog.open', object({ windowId: identity }), object({ format: choice('markdown', 'pdf', 'print') }),
    [available, 'Exact active ordinary Notes window with a current readable note; utility, closed and minimized windows are not documents.'],
    ['Open a native-style virtual Save sheet or print dialog. Capture original immutable note identity/text/timestamps and native return caret/scroll.',
      'Print preview uses the same embedded-font A4 line layout as actual PDF output, without unnecessary PDF serialization. Unsupported font glyphs reject honestly before opening.',
      'Sheet drafts are transient, never saved-session fields; opening, cancelling and exporting do not mutate source notes.']),
  define('fileDialog.configure', dialog, { ...object({ name: { type: 'string', maxLength: 255 }, folderId: identity, tags,
    copies: { type: 'integer', minimum: 1, maximum: 99 }, pageFrom: page, pageTo: page }, []), minProperties: 1 },
    [available, owned, 'No pending output. Export supports name/folderId/tags; Print supports copies/pageFrom/pageTo. Validate the whole partial patch before mutation.'],
    ['Update only the canonical native draft. A filename draft may be invalid until Save; output validation rejects invalid names without writing.',
      'Live writable folders only; actual page bounds and From <= To are checked together.']),
  define('fileDialog.confirm', dialog, object({ replace: flag }, []), [available, owned, 'No pending output; valid draft, actual collision/range/glyph/budget and source checks precede every allocation.'],
    ['Export an actual Markdown or font-embedded PDF virtual document, or submit an immutable selected-page PDF to the fictional Studio Printer.',
      'replace:true is explicit overwrite confirmation for one real writable document collision; folders/catalog/anchors cannot be overwritten. Print does not accept replace.',
      'Cancellation invalidates the operation-captured lease even if the same document immediately opens another sheet. Successful output closes the sheet and restores eligible original native caret/scroll.'],
    ['fileDialog', 'files', 'printing']),
  define('fileDialog.cancel', dialog, empty, [available, 'Exact live dialog; cancellation remains available while PDF output is being prepared.'],
    ['Discard the transient draft with no note/file/job changes, invalidate pending output leases and restore eligible original native caret/scroll.',
      'Cancel Save as PDF entered from Print returns to the original print options; a second Cancel closes Print.']),
  define('fileDialog.exportPdf', dialog, empty, [available, owned, 'Current nonbusy Print dialog.'],
    ['Open the actual virtual PDF Save sheet from Print, preserving selected page range and copies. Cancellation returns to Print without printing or exporting.']),
  define('fileDialog.focus', object({ dialogId: identity, control: choice('panel', 'name', 'folder', 'tags', 'copies', 'page-from', 'page-to', 'confirm', 'cancel', 'save-pdf', 'preview-previous', 'preview-next'), fileId: identity }, ['dialogId', 'control']),
    empty, [available, 'Exact current sheet and connected enabled native control; absent or disabled controls cannot be focused.'],
    ['Focus the physically rendered semantic control; never use a raw selector, implicitly open a sheet or focus a stale sheet.']),
  define('fileDialog.scroll', object({ dialogId: identity, area: choice('files', 'preview') }), object({ top: offset, left: offset }, ['top']),
    [available, 'Exact current sheet and actual mounted inner files/preview scroller.'],
    ['Scroll the native inner area with actual DOM clamping; actual offsets and dimensions are exposed in targets.fileDialog.native. No root/page scrolling.']),
]);

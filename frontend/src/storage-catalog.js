import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';

export const storageFileIdsSchema = { type: 'array', maxItems: 1024, uniqueItems: true, items: identity };
export const storageViewSchema = object({ category: choice('applications', 'documents', 'icloud', 'mail', 'trash'),
  scope: choice('large-files', 'downloads', 'file-browser'), sort: choice('name', 'kind', 'last-accessed', 'size'),
  direction: choice('ascending', 'descending'), folderId: identity, selectedFileIds: storageFileIdsSchema });
const windowTarget = object({ windowId: identity });
const fileTarget = object({ windowId: identity, fileId: identity });
const files = object({ fileIds: { ...storageFileIdsSchema, minItems: 1 } });
const changes = { changedFileIds: storageFileIdsSchema, removedFileIds: storageFileIdsSchema };
const recommendation = choice('storeInCloud', 'optimizeStorage', 'emptyTrashAutomatically');
const confirmation = object({ confirmationId: identity, windowId: identity,
  action: choice('trash', 'purge', 'empty-trash'), fileIds: { ...storageFileIdsSchema, minItems: 1 } });
const viewResult = object({ windowId: identity, view: { anyOf: [storageViewSchema, { type: 'null' }] } });
const maxTime = 8_640_000_000_000_000 - 1;
const scrollPayload = object({ top: offset, left: offset, observe: flag }, ['top']);
const define = (name, target, payload, effect, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], `system.storage.${name}`, 'shell.apple-menu', target, payload,
    ['Interactive retained Golden desktop, no private panel preparation or blocking session/file presentation.',
      'Window commands require the exact visible ordinary Settings Storage management panel; file commands require a current real eligible row. No borrowed window, fabricated bundle size, host disk or network.'],
    [effect], ['Owned storage view/selection; canonical system.storage preferences and actual virtual records/scene clock. Confirmation and private revision leases are never saved.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
export const storageCatalog = Object.fromEntries([
  define('list.scroll', windowTarget, scrollPayload, 'Apply/read DOM-clamped owned native file-list offsets; observe:true reads instead of setting. Semantic list scroll saves only with its exact owned Storage category.', object({ windowId: identity, top: offset, left: offset })),
  define('confirmation.scroll', object({ confirmationId: identity }), scrollPayload, 'Apply/read actual owned transient confirmation-name-list scroll. Never saved and never borrowed from another confirmation/window.', object({ confirmationId: identity, top: offset, left: offset })),
  define('category.open', windowTarget, object({ category: storageViewSchema.properties.category }), 'Open the real category within the owned Storage window; reset its category-specific view/selection.', viewResult),
  define('category.close', windowTarget, empty, 'Return to the live recommendations/category overview; cancel this owner’s pending confirmation without changing files.', viewResult),
  define('view.set', windowTarget, { ...object({ scope: storageViewSchema.properties.scope, sort: storageViewSchema.properties.sort,
    direction: storageViewSchema.properties.direction, folderId: identity }, []), minProperties: 1 }, 'Set actual Documents scope/folder or category sort; discard selections not visible in the resulting real rows.', viewResult),
  define('selection.set', windowTarget, object({ fileIds: storageFileIdsSchema }), 'Select exact unique currently visible rows; empty selection clears. No implicit filesystem operation.', object({ windowId: identity, fileIds: storageFileIdsSchema })),
  define('file.open', fileTarget, empty, 'Navigate an actual File Browser folder or open the actual virtual document/application. Successful file opening restores cloud/cache residency through the shared file-open lifecycle.', object({ windowId: identity, fileId: identity, openedWindowId: identity })),
  define('file.reveal', fileTarget, empty, 'Reveal the actual record in its real parent Finder folder and select its stable ID.', object({ windowId: identity, fileId: identity, finderWindowId: identity })),
  define('file.download', fileTarget, empty, 'Restore an eligible evicted payload’s simulated local residency, preserving literal backing content and updating its scene access time. No network transfer.', object({ windowId: identity, fileId: identity, localResident: { const: true } })),
  define('delete.request', windowTarget, files, 'Capture eligible current row/subtree identities and revisions, showing an owned confirmation. Live files move to Trash; Trash files purge permanently only on accepted unchanged confirmation.', confirmation),
  define('restore', windowTarget, files, 'Atomically restore eligible Trash roots/subtrees to their original live parent without overwriting; protected, changed or colliding batches do not partially restore.', object({ windowId: identity, fileIds: storageFileIdsSchema })),
  define('trash.empty.request', windowTarget, empty, 'Capture all actual Trash roots for permanent-deletion confirmation; empty Trash rejects disabled instead of claiming activity.', confirmation),
  define('confirmation.respond', object({ confirmationId: identity }), object({ accept: flag }), 'Cancel without file mutation, or revalidate the exact owned complete subtree/revision lease before atomic Trash/purge. Permanent removal reconciles file references/history and cannot revive through Undo.', object({ confirmationId: identity, windowId: identity, accepted: flag, fileIds: storageFileIdsSchema })),
  define('recommendation.set', windowTarget, object({ recommendation, enabled: flag }), 'Set the real per-root recommendation and run bounded scene-clock maintenance: fictional cloud backing, old Mail-cache residency or strictly over30-day known Trash deletion. Recently opened/unknown-age payloads remain local.', object({ windowId: identity, recommendation, enabled: flag, ...changes })),
  define('clock.advance', empty, object({ milliseconds: { type: 'integer', minimum: 0, maximum: maxTime } }), 'Advance only the virtual filesystem scene clock within its timestamp budget and perform enabled maintenance once. Changed-record metadata consumes scene-clock ticks; sceneTime reports the final actual clock. No host clock/timer.', object({ sceneTime: { type: 'integer', minimum: 0, maximum: maxTime }, ...changes })),
]);

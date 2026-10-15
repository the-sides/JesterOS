import { defineCommand, object, empty, identity as identitySchema, choice, flag, offset } from './command-schema.js';

const identity = { ...identitySchema, maxLength: 512 };
const app = choice('contacts', 'mail', 'messages');
const range = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const ids = { type: 'array', items: identity, maxItems: 1024 };
const owner = object({ appId: app, windowId: identity });
const source = { appId: identity, sourceId: identity };
const serviceId = choice('lookup', 'create-note', 'new-contact', 'new-message', 'new-mail', 'copy-paths', 'show-info',
  'new-mail-with-attachments', 'email-contact', 'message-contact');
const performResult = { oneOf: [
  object({ ...source, serviceId: { const: 'lookup' }, lookupId: identity, found: flag }),
  object({ ...source, serviceId: { const: 'create-note' }, noteId: identity, windowId: identity }),
  object({ ...source, serviceId: choice('new-contact', 'new-message', 'new-mail', 'new-mail-with-attachments', 'email-contact', 'message-contact'),
    recordId: identity, windowId: identity }),
  object({ ...source, serviceId: { const: 'copy-paths' }, fileIds: ids }),
  object({ ...source, serviceId: { const: 'show-info' }, fileIds: ids, windowIds: ids }),
] };
const available = 'Alive interactive Golden Gate scene, original foreground app/window/Space and actual connected noninert native source or provider; no competing modal, switcher, pairing or disposed owner.';
const native = 'Actual native surface preparation/focus and original entity/revision/value lease are checked across asynchronous work; stale owners never borrow replacement controls.';
const local = 'Original local simulation services, not an asserted factory Services inventory. No host clipboard/files/apps, network dictionary, account authentication or external mail/message delivery.';
const define = (name, target, payload, requirements, effects, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'shell.services-workflows', target, payload,
    [available, native, ...requirements], effects, [local], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const serviceCatalog = Object.fromEntries([
  define('app.service.perform', object({ ...source, serviceId }), empty,
    ['Exact opaque current sourceId from targets.services; real nonempty selected UTF-16 text, current virtual file selection/revisions, or selected local contact endpoint. Registry filters input type/provider/size.'],
    ['Lookup opens an original truthful offline dictionary popover. Create-note prepares actual Notes body before copying exact selected bytes into one complete editable note.',
      'Contact/message/mail services prepare their real ordinary managed provider workspace before allocating one editable local draft; contact endpoint actions address the draft, never send immediately.',
      'Mail attachments snapshot exact selected virtual document content/name/revision. Copy paths writes only the scene clipboard; Get Info uses real existing file utilities.'], performResult),
  define('services.panel.focus', object({ ...owner.properties, control: identity }), { anyOf: [empty, object({ start: range, end: range, direction: choice('forward', 'backward', 'none') }, ['start', 'end'])] },
    ['Control is currently rendered; optional native UTF-16 range only for actual input/textarea field with start<=end<=value.length.'], ['Focus exact live native control and observe physical focus/range.'], object({ ...owner.properties, control: identity })),
  define('services.panel.scroll', object({ ...owner.properties, area: identity }), object({ top: offset, left: offset }, ['top']), [],
    ['Scroll the exact actual native provider area and return observed clamped offsets.'], object({ ...owner.properties, top: offset, left: offset })),
  define('services.lookup.search', object({ lookupId: identity }), object({ query: { type: 'string', maxLength: 256 } }), [],
    ['Search bundled original definitions; absence remains honest no-entry, never synthesized or fetched.'], object({ lookupId: identity, query: { type: 'string', maxLength: 256 }, found: flag })),
  define('services.lookup.close', object({ lookupId: identity }), object({ restoreFocus: flag }, []), [], ['Dismiss exact popover and restore original unchanged native source focus/caret when still owned; false preserves a new native outside-click focus.'], object({ lookupId: identity })),
  define('services.lookup.focus', object({ lookupId: identity, control: choice('query', 'reader', 'close') }), empty, [], ['Focus actual current popover control.'], object({ lookupId: identity, control: choice('query', 'reader', 'close') })),
  define('services.context.open', object(source), object({ x: offset, y: offset }), ['Applicable exact source. Coordinates are finite viewport CSS pixels; rendering clips to actual workspace/viewport.'],
    ['Open original Local Services context popup from same registry as application menu; preserve original native selection.'], object({ contextId: identity, ...source })),
  define('services.context.select', object({ contextId: identity, itemId: identity }), empty, [], ['Highlight/focus one actual applicable registry leaf.'], object({ contextId: identity, itemId: identity })),
  define('services.context.close', object({ contextId: identity }), object({ restoreFocus: flag }, []), [], ['Dismiss original context and restore original owned native selection; false preserves new outside-click focus.'], object({ contextId: identity })),
  define('services.context.execute', object({ contextId: identity, itemId: identity }), empty, ['Exact live registry leaf; restore original native source before canonical dispatch.'],
    ['Execute the same app.service.perform request, never a parallel contextual implementation.'], object({ contextId: identity, itemId: identity, result: performResult })),
]);

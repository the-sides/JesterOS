import { defineCommand, object, choice, flag, empty } from './command-schema.js';
import { MAIL_PROFILES, MAIL_PANES, MAIL_TOOLBAR, mailAttachmentSchema, mailPreferencesSchema } from './mail-state.js';
const s = (maxLength = 256, minLength = 0) => ({ type: 'string', minLength, maxLength });
export const mailIdentitySchema = { ...s(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const id = mailIdentitySchema;
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const w = object({ windowId: id });
const message = object({ windowId: id, messageId: id }, ['windowId']);
const attachment = object({ windowId: id, messageId: id, attachmentId: id });
const maybe = properties => object(properties, []);
const offset = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const named = { name: s(256, 1) };
export const mailSpecs = {
  'mail.compose.new': [w, maybe({ mode: choice('new', 'reply', 'replyAll', 'forward'), messageId: id }), 'Open a distinct window-owned local composer; reply recipients exclude every configured local identity.'],
  'mail.draft.update': [w, object({ field: choice('to', 'cc', 'bcc', 'subject', 'body', 'accountId', 'signatureId', 'priority', 'format'), value: s(65536) }), 'Edit the exact window-owned draft and bounded body undo history.'],
  'mail.draft.save': [w, empty, 'Save the actual draft to the canonical Drafts mailbox without delivering it.'],
  'mail.draft.send': [w, empty, 'Validate recipients and queue local Outbox; fictional transport moves to Sent or a visible offline/failure state.'],
  'mail.draft.cancel': [w, object({ discard: flag }), 'Explicitly discard or save the draft and retire its original composer.'],
  'mail.draft.attach': [w, object({ name: s(256, 1), mime: mailAttachmentSchema.properties.mime, text: mailAttachmentSchema.properties.text, fileId: nullable(id) }, ['name', 'mime', 'text']), 'Attach supplied exact local content or read an existing canonical file identity without rewriting the source; never a host file handle.'],
  'mail.draft.chooseAttachment': [w, empty, 'Open the genuine shared Files picker; cancel preserves the original draft and accept copies exact source bytes under its source lease.'],
  'mail.draft.removeAttachment': [w, object({ attachmentId: id }), 'Remove the exact draft attachment.'],
  'mail.draft.format': [w, object({ style: choice('bold', 'italic', 'underline', 'quote', 'list', 'plain', 'rich'), start: offset, end: offset }, ['style']), 'Format selected real composer text using the closed safe local rich vocabulary.'],
  'mail.draft.undo': [w, empty, 'Restore the preceding canonical composer body transaction.'],
  'mail.draft.redo': [w, empty, 'Restore the succeeding canonical composer body transaction.'],
  'mail.recipients.resolve': [w, object({ query: s(1024), field: choice('to', 'cc', 'bcc') }), 'Resolve actual shared Contacts through the parent bridge; missing bridge rejects.'],
  'mail.recipients.choose': [w, object({ field: choice('to', 'cc', 'bcc'), email: s(254, 3), name: s(256) }, ['field', 'email']), 'Commit a selected valid contact address into the actual composer.'],
  'mail.mailbox.select': [w, object({ mailboxId: id }), 'Show the exact canonical mailbox and matching message list.'],
  'mail.mailbox.create': [w, object({ ...named, smart: flag, field: choice('all', 'sender', 'subject', 'unread', 'flagged', 'attachment'), value: s(1024), accountId: id }, ['name']), 'Create a real local mailbox or saved smart predicate; Windows smart mailbox is disclosed local extension.'],
  'mail.mailbox.rename': [w, object({ mailboxId: id, ...named }), 'Rename a custom or smart mailbox.'],
  'mail.mailbox.delete': [w, object({ mailboxId: id }), 'Delete an empty custom/smart mailbox; referenced move rules prevent deletion.'],
  'mail.mailbox.favorite': [w, object({ mailboxId: id, favorite: flag }), 'Change canonical favorite disclosure.'],
  'mail.message.select': [w, object({ messageId: id, extend: flag, toggle: flag }, ['messageId']), 'Select one, toggle membership, or extend the real visible message range. Opening a Drafts record reopens its exact composer.'],
  'mail.selection.all': [w, empty, 'Select all current search/filter results, not hidden mail.'],
  'mail.message.action': [message, object({ action: choice('read', 'unread', 'flag', 'unflag', 'archive', 'junk', 'move', 'delete', 'restore'), mailboxId: id, confirm: flag }, ['action']), 'Apply a bounded operation to exact current selected records; permanent Trash deletion opens an original-selection confirmation, confirm:true accepts that sheet. Restore uses the original canonical mailbox.'],
  'mail.view.set': [w, maybe({ query: s(4096), filter: choice('all', 'unread', 'flagged', 'attachments'), sort: choice('date', 'sender', 'subject'), ascending: flag, threaded: flag, sidebarVisible: flag, headersVisible: flag, readingMode: choice('html', 'text'), pane: choice(...MAIL_PANES), sheet: choice('none', 'mailbox', 'smart', 'account', 'toolbar', 'attach') }), 'Change per-window presentation without borrowing another window selection.'],
  'mail.attachment.preview': [attachment, empty, 'Return actual canonical attachment content for a safe local preview; never load remote HTML.'],
  'mail.attachment.save': [attachment, empty, 'Create or reveal an actual shared virtual file; bridge absence rejects.'],
  'mail.attachment.open': [attachment, empty, 'Create if needed and open an actual shared virtual file in its associated app.'],
  'mail.attachments.saveAll': [message, empty, 'Save every exact attachment of one represented message to actual shared Files.'],
  'mail.attachments.remove': [message, empty, 'Remove attachments from the selected canonical message; independently saved Files are retained.'],
  'mail.contact.create': [message, empty, 'Create sender in shared Contacts authority via bridge.'],
  'mail.invitation.respond': [message, object({ response: choice('accepted', 'declined', 'tentative') }), 'Apply the response through shared Calendar; only store acknowledged canonical event identity.'],
  'mail.message.print': [message, empty, 'Open shared Print workflow for actual message content.'],
  'mail.message.share': [message, empty, 'Share actual message through shared scene integration.'],
  'mail.message.export': [message, empty, 'Export actual RFC-like plain local message to shared Files.'],
  'mail.preferences.open': [w, maybe({ pane: choice(...MAIL_PANES) }), 'Open a native settings/preferences window with all eight working domains.'],
  'mail.preferences.set': [w, maybe(mailPreferencesSchema.properties), 'Change real bounded local preferences; recipient/signature/format and viewing defaults affect reading/composing.'],
  'mail.sound.preview': [w, empty, 'Preview the enabled local new-mail sound through actual shared scene sound authority, respecting volume/mute; missing bridge rejects.'],
  'mail.account.add': [w, object({ ...named, email: s(254, 3) }), 'Set up a frontend-only fictional account and all canonical system mailboxes; no credential fields.'],
  'mail.account.update': [w, object({ accountId: id, name: s(256, 1), email: s(254, 3), enabled: flag, online: flag, failure: choice('none', 'send', 'receive'), signatureId: nullable(id) }, ['accountId']), 'Edit fictional identity/availability and deliberately selected local failure mode.'],
  'mail.account.remove': [w, object({ accountId: id }), 'Remove an empty nonfinal local account; never silently erase messages or drafts.'],
  'mail.signature.save': [w, object({ signatureId: id, ...named, text: s(4096) }, ['name', 'text']), 'Create/edit actual canonical signature text.'],
  'mail.signature.delete': [w, object({ signatureId: id }), 'Delete the signature and clear all canonical references.'],
  'mail.rule.save': [w, object({ ruleId: id, ...named, enabled: flag, field: choice('sender', 'subject', 'body', 'attachment'), match: s(1024, 1), action: choice('move', 'flag', 'read', 'junk'), mailboxId: nullable(id) }, ['name', 'enabled', 'field', 'match', 'action']), 'Create/edit a bounded literal local rule; Windows rules are explicitly a local extension.'],
  'mail.rule.delete': [w, object({ ruleId: id }), 'Delete the exact local rule.'],
  'mail.rule.apply': [message, empty, 'Apply enabled literal rules to selected actual incoming messages.'],
  'mail.connection.check': [w, empty, 'Record cancellable local account connection activity; simulated receive failures do not invent remote delivery.'],
  'mail.connection.offline': [w, object({ offline: flag }), 'Switch all fictional transports offline/online and retain queued Outbox.'],
  'mail.delivery.retry': [message, empty, 'Retry actual failed/queued local Outbox records; no replacement message borrowing.'],
  'mail.delivery.cancel': [message, empty, 'Cancel actual queued/failed local sends and running connection activity.'],
  'mail.activity.open': [w, empty, 'Open actual canonical account activity.'],
  'mail.doctor.open': [w, empty, 'Open local Connection Doctor; Windows equivalent is clearly labeled diagnostic extension.'],
  'mail.toolbar.open': [w, empty, 'Show actual bounded toolbar customization; Windows local extension is disclosed.'],
  'mail.toolbar.set': [w, object({ items: { type: 'array', items: choice(...MAIL_TOOLBAR), maxItems: MAIL_TOOLBAR.length, uniqueItems: true } }), 'Set the visible functional per-window toolbar controls.'],
  'mail.help.open': [w, empty, 'Open local usage and native-version/local-transport disclosures.'],
  'mail.window.close': [w, empty, 'Close exact Mail window, preserving a saved composer draft.'],
  'mail.native.focus': [w, object({ control: s(256, 1) }), 'Focus a real connected visible enabled Mail control.'],
  'mail.native.scroll': [w, object({ area: choice('list', 'reader', 'sidebar', 'settings', 'activity'), top: offset, left: offset }), 'Scroll an actual mounted area and return observed clamped offsets.'],
  'mail.edit.copy': [w, empty, 'Copy actual native selected text to the shared scene clipboard.'],
  'mail.edit.cut': [w, empty, 'Cut actual selected composer text through the canonical draft setter.'],
  'mail.edit.paste': [w, empty, 'Paste the shared scene clipboard into actual selected composer text.'],
  'mail.edit.selectAll': [w, empty, 'Select actual focused native input text, or all visible messages.'],
};
export const mailCatalog = Object.fromEntries(Object.entries(mailSpecs).map(([name, [target, payload, description]]) => defineCommand(MAIL_PROFILES, name, 'mail.local', target, payload,
  ['Original live Mail window and canonical graph, visible mounted native view; all required integration bridges must be present.', 'Accounts, connection results and transport are fictional frontend-local; no real credentials or network.'], [description], ['Canonical mail domain only, plus explicitly named parent bridge authority.'])));

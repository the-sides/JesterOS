import { expect, test } from 'bun:test';
import { decodeNotesAttachment, NOTES_ATTACHMENT_PREVIEW_LIMITS } from '../frontend/src/notes-workspace-attachments.js';
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const file = fields => ({ id: 'actual-image', name: 'Pixel.gif', mime: 'image/gif', text: gif, ...fields });
test('actual Files data-URI decodes bytes rather than synthesizing content or fetching a URL', () => {
  const decoded = decodeNotesAttachment(file()); expect(decoded.status).toBe('applied'); expect(decoded.fileId).toBe('actual-image'); expect(decoded.kind).toBe('image'); expect(Array.from(decoded.bytes.slice(0, 6))).toEqual([71, 73, 70, 56, 57, 97]);
});
test('canonical Files content alias cannot disagree with actual text or authorize host/network URLs', () => {
  expect(decodeNotesAttachment(file({ content: 'different' })).status).toBe('rejected'); expect(decodeNotesAttachment(file({ text: 'https://example.com/Pixel.gif' })).status).toBe('rejected');
  const alias = file(); delete alias.text; alias.content = gif; expect(decodeNotesAttachment(alias).status).toBe('applied');
});
test('mime/signature mismatch, SVG, truncated binary and expired Files are rejected', () => {
  for (const malformed of [file({ mime: 'image/png' }), file({ mime: 'image/svg+xml', text: '<svg/>' }), file({ text: 'data:image/gif;base64,AA==' }), file({ deleted: true })]) expect(decodeNotesAttachment(malformed).status).toBe('rejected');
});
test('attachment decoder rejects accessor fields without invoking user supplied getters', () => {
  let invoked = false; const malformed = file(); Object.defineProperty(malformed, 'text', { enumerable: true, get() { invoked = true; return gif; } }); expect(decodeNotesAttachment(malformed).status).toBe('rejected'); expect(invoked).toBe(false);
});

test('actual content exceeding the shared text bound is rejected before byte allocation', () => {
  const oversized = file({ text: 'data:image/gif;base64,' + 'A'.repeat(NOTES_ATTACHMENT_PREVIEW_LIMITS.text) });
  expect(decodeNotesAttachment(oversized).status).toBe('rejected');
});

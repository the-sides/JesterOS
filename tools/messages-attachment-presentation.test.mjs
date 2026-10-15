import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { registerMessagesAttachmentPresentation, presentMessagesAttachment, describeMessagesAttachmentPresentations } from '../frontend/src/messages-attachment-presentation.js';

test('repeated attachment IDs in different genuine message owners never borrow the first mounted presentation', async () => {
  const dom = new JSDOM('<section><figure class="messages-attachment" data-messages-attachment-id="shared"></figure><figure class="messages-attachment" data-messages-attachment-id="shared"></figure></section>');
  try {
    const root = dom.window.document.querySelector('section'), nodes = [...root.children], changed = [];
    const targets = ['first-message', 'second-message'].map(messageId => ({ windowId: 'original-window', conversationId: 'original-thread', messageId, attachmentId: 'shared' }));
    for (let index = 0; index < nodes.length; index++) registerMessagesAttachmentPresentation(nodes[index], {
      target: targets[index], describe: () => ({ kind: 'image', expanded: false }),
      present: async (_payload, guard) => { if (!guard()) return false; changed.push(targets[index].messageId); return true; },
    });
    expect(await presentMessagesAttachment(root, targets[1], { expanded: true }, () => true)).toBe(true);
    expect(changed).toEqual(['second-message']);
    expect(describeMessagesAttachmentPresentations(root).map(row => row.target)).toEqual(targets);
    nodes[1].replaceWith(nodes[1].cloneNode(true));
    expect(await presentMessagesAttachment(root, targets[1], { expanded: true }, () => true)).toBe(false);
    expect(changed).toEqual(['second-message']);
  } finally { dom.window.close(); }
});

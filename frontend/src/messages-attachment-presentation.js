// Mounted presentation facades are private and never enter canonical scene data.
const presentations = new WeakMap();
export function registerMessagesAttachmentPresentation(node, facade) {
  presentations.set(node, facade);
  return () => { if (presentations.get(node) === facade) presentations.delete(node); };
}
export async function presentMessagesAttachment(root, target, payload, guard) {
  if (!root?.isConnected || !guard()) return false;
  const activePanel = () => root.querySelector('.messages-quick-look') ?? root.querySelector('.messages-rich-panel');
  const panel = activePanel();
  const owner = panel ?? root;
  const selector = Object.hasOwn(payload, 'page') ? '.messages-pdf-preview'
    : Object.hasOwn(payload, 'playing') || Object.hasOwn(payload, 'time') ? '.messages-audio-preview' : '.messages-attachment';
  const node = [...owner.querySelectorAll(selector)].find(node => sameMessagesAttachmentTarget(presentations.get(node)?.target, target));
  const facade = node && presentations.get(node);
  if (!facade || !guard()) return false;
  return await facade.present(payload, () => guard() && root.isConnected && root.contains(node)
    && (activePanel() ?? root) === owner
    && presentations.get(node) === facade) === true && guard();
}

export function describeMessagesAttachmentPresentations(root) {
  if (!root?.isConnected) return [];
  const owner = root.querySelector('.messages-quick-look') ?? root.querySelector('.messages-rich-panel') ?? root;
  return [...owner.querySelectorAll('.messages-attachment, .messages-pdf-preview, .messages-audio-preview')].flatMap(node => {
    const presentation = presentations.get(node)?.describe();
    return presentation ? [{ target: { ...presentations.get(node).target }, ...presentation }] : [];
  });
}

export function sameMessagesAttachmentTarget(left, right) {
  return Boolean(left && right && ['windowId', 'draftId', 'conversationId', 'messageId', 'attachmentId']
    .every(key => (left[key] ?? null) === (right[key] ?? null)));
}

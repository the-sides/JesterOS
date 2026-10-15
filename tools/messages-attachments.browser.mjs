const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Invoke only against a real mounted Messages/Teams attachment surface after
// choosing and sending original Files. No renderer, canvas or decoder mocks.
export async function runMessagesAttachmentPreviewRegression({ root, imageFile, pdfFile, textFile }) {
  assert(root?.isConnected, 'The original native Messages/Teams root must be mounted.');
  const find = file => [...root.querySelectorAll('[data-messages-source-file-id]')]
    .find(node => node.dataset.messagesSourceFileId === file.id && node.matches('.messages-attachment'));
  const image = find(imageFile), pdf = find(pdfFile), text = find(textFile);
  assert(image && pdf && text, 'All three actual original File attachment surfaces are required.');
  for (const [node, file] of [[image, imageFile], [pdf, pdfFile], [text, textFile]])
    assert(node.dataset.messagesSourceRevision === String(file.revision), 'The original retained revision must match the actual File.');
  const img = image.querySelector('img');
  await img.decode();
  assert(img.getAttribute('src') === imageFile.content && img.naturalWidth === 960 && img.naturalHeight === 640,
    'The genuine Harbor PNG must decode to its original 960×640 pixels.');
  assert(text.querySelector('.messages-inline-text')?.textContent === textFile.content,
    'The complete original Unicode text and final newline must survive the inline preview.');
  const originalPdf = pdf, canvas = pdf.querySelector('canvas'), deadline = performance.now() + 10000;
  assert(canvas, 'The real inline PDF canvas must be mounted.');
  while (!/Page 1 of 3/u.test(pdf.querySelector('nav span')?.textContent ?? '')) {
    assert(root.isConnected && originalPdf.isConnected && pdf.querySelector('canvas') === canvas,
      'The original attachment presentation retired while the decoder was pending.');
    const error = pdf.querySelector('[role="status"]')?.textContent ?? '';
    assert(!/no longer current|unavailable|invalid|cannot/iu.test(error), error);
    assert(performance.now() < deadline, 'The genuine inline PDF never decoded its three original pages.');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  while (pdf.querySelector('[role="status"]')) {
    assert(performance.now() < deadline && canvas.isConnected, 'The original decoded PDF page was not painted.');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  assert(canvas.width > 0 && canvas.height > 0 && pixels.some((value, index) => index % 4 === 3 && value > 0),
    'A default blank canvas is not proof of decoded original PDF pixels.');
  assert(pixels.some((value, index) => index % 4 === 0 && pixels[index + 3] > 0
    && Math.min(value, pixels[index + 1], pixels[index + 2]) < 220),
    'The original itinerary page must contain visible page ink, not only a painted blank background.');
  return { imageId: imageFile.id, pdfId: pdfFile.id, textId: textFile.id,
    dimensions: [img.naturalWidth, img.naturalHeight], pdfCanvas: [canvas.width, canvas.height], pdfPages: 3,
    completeOriginalText: true, originalPresentation: true };
}

// Invoke after an actual native right-click on an original shared Details photo.
export function runMessagesDetailsAttachmentMenuRegression({ root, sourceFileId }) {
  assert(root?.isConnected, 'The original native Details surface must be mounted.');
  const attachment = [...root.querySelectorAll('.messages-attachment.shared-details')]
    .find(node => node.dataset.messagesSourceFileId === sourceFileId);
  assert(attachment && !attachment.classList.contains('expanded'), 'The original compact Details photo must remain mounted.');
  const menu = attachment.querySelector('[role="menu"]');
  assert(menu && menu.getBoundingClientRect().width > 0 && menu.getBoundingClientRect().height > 0,
    'The genuine shared photo context menu must not be hidden with its compact caption/action row.');
  for (let node = menu; node && node !== root; node = node.parentElement)
    assert(getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden',
      'The genuine attachment context menu must remain visible through all original ancestors.');
  assert(menu.querySelectorAll('[role="menuitem"]').length === 3, 'Quick Look, Open and Save As must all remain reachable.');
  return { sourceFileId, compactPhoto: true, genuineMenuVisible: true };
}

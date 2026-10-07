import { rejected } from './feature-commands.js';

const reject = message => rejected('unsupported_content', message);
const stale = () => rejected('stale_target', 'The original Spotlight preview source is no longer current.');
let renderer;
async function pdfRenderer() {
  renderer ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([library, worker]) => { library.GlobalWorkerOptions.workerSrc = worker.default; return library; })
    .catch(error => { renderer = undefined; throw error; });
  return renderer;
}

/** Only existing virtual bytes are interpreted. Never fetch a document URL or
 * manufacture a page for an empty/unsupported source. Opaque resources stay private. */
export async function prepareSpotlightPreview(source, guard) {
  if (!guard()) return stale();
  const descriptor = { resultId: `${source.kind}:${source.id}`, title: source.label,
    kind: 'text', text: '', fields: [], page: 1, pageCount: 1 };
  let resource = null;
  if (source.kind === 'app') {
    descriptor.kind = 'application';
    descriptor.fields = [{ label: 'Application', value: source.label },
      { label: 'Bundle', value: source.token.bundle.name }, { label: 'Identifier', value: source.id }];
  } else if (source.kind === 'note') descriptor.text = source.token.text;
  else if (source.kind === 'contact' || source.kind === 'mail') {
    descriptor.kind = 'fields';
    descriptor.fields = Object.entries(source.token.fields).map(([label, value]) => ({ label, value }));
  } else if (source.kind === 'file') {
    const file = source.token.record, content = file.content;
    if (!content) {
      descriptor.kind = 'empty'; descriptor.text = 'This virtual file has no stored content.';
    } else if (/^data:application\/pdf;base64,/i.test(content)) {
      const encoded = content.slice(content.indexOf(',') + 1);
      if (encoded.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
        return reject('The virtual PDF contains invalid or oversized base64 bytes.');
      const bytes = Uint8Array.fromBase64(encoded);
      if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
        return reject('The virtual file does not contain a PDF document.');
      const library = await pdfRenderer();
      if (!guard()) return stale();
      const task = library.getDocument({ data: bytes, useSystemFonts: false, enableXfa: false,
        disableAutoFetch: true, disableStream: true, useWorkerFetch: false,
        maxImageSize: 4 * 1024 * 1024, canvasMaxAreaInBytes: 16 * 1024 * 1024 });
      let passwordRequired = false;
      task.onPassword = () => { passwordRequired = true; void task.destroy(); };
      let document;
      try { document = await task.promise; }
      catch (error) {
        await task.destroy();
        return guard() ? reject(passwordRequired ? 'Password-protected PDFs cannot be previewed.'
          : `The stored PDF could not be read: ${error.message}`) : stale();
      }
      resource = { document, destroy: () => task.destroy() };
      if (!guard()) { await resource.destroy(); return stale(); }
      if (document.numPages < 1 || document.numPages > 1024) {
        await resource.destroy(); return reject('PDF previews support one to1024 actual pages.');
      }
      descriptor.kind = 'pdf'; descriptor.pageCount = document.numPages;
    } else if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)(?:;[^,]*)?,/i.test(content)) {
      descriptor.kind = 'image'; resource = { image: content };
    } else if (file.kind === 'image' || /^data:/i.test(content)) {
      return reject('This virtual image or encoded document format is not supported by Spotlight preview.');
    } else descriptor.text = content;
  } else return reject('This result has no supported local preview.');
  return guard() ? { status: 'applied', descriptor, resource } : stale();
}

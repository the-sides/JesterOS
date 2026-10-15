import { rejected } from './feature-commands.js';

export const NOTES_ATTACHMENT_PREVIEW_LIMITS = Object.freeze({
  text: 1024 * 1024,
  pages: 1024,
  imagePixels: 4 * 1024 * 1024,
  canvasBytes: 16 * 1024 * 1024,
  pageWidth: 520,
  pageHeight: 960,
  outputScale: 2,
});
const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function field(file, key) {
  const descriptor = Object.getOwnPropertyDescriptor(file, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new Error(`The Files ${key} field must be a data property.`);
  return descriptor;
}
function startsWith(bytes, values, offset = 0) {
  return bytes.length >= offset + values.length && values.every((value, index) => bytes[offset + index] === value);
}
function signature(bytes, mime) {
  if (mime === 'application/pdf') return startsWith(bytes, [37, 80, 68, 70, 45]);
  if (mime === 'image/png') return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (mime === 'image/jpeg') return startsWith(bytes, [255, 216, 255]);
  if (mime === 'image/gif') return startsWith(bytes, [71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97;
  return startsWith(bytes, [82, 73, 70, 70]) && startsWith(bytes, [87, 69, 66, 80], 8);
}
function decodeBase64(encoded) {
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  // atob accepts nonzero padding bits; reject those noncanonical encodings too.
  if (encoded.endsWith('==') && (BASE64.indexOf(encoded.at(-3)) & 15)
    || encoded.endsWith('=') && !encoded.endsWith('==') && (BASE64.indexOf(encoded.at(-2)) & 3)) return null;
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Interpret actual Files bridge data, without fetching a URL or inventing bytes.
 * Required own data fields: {id: string, name: string, mime: string, text: string}.
 * Existing Files stores use `content`; that exact string is accepted only when
 * `text` is absent, or when both strings agree. No bytes/data/url aliases exist.
 * Supported MIME values: image/png, image/jpeg, image/gif, image/webp,
 * application/pdf. MIME values are case-insensitive, without parameters.
 * Content must be `data:<matching MIME>;base64,<canonical padded base64>`.
 * The complete stored string is limited to 1 Mi UTF-16 units, matching Files.
 * SVG (including existing Windows raw SVG records), remote/blob URLs, raw PDF
 * strings and unsupported MIME values are rejected rather than approximated.
 * Successful `bytes` are newly decoded, caller-owned bytes; PDF.js may transfer
 * their buffer to its worker. This function creates no object URLs/resources.
 * Result: applied {fileId,name,mime,kind,bytes}, or rejected {error:{code,message}}.
 */
export function decodeNotesAttachment(file) {
  try {
    if (!file || typeof file !== 'object' || Array.isArray(file))
      return rejected('malformed_file', 'The Files bridge did not return an actual file record.');
    const id = field(file, 'id')?.value, name = field(file, 'name')?.value,
      rawMime = field(file, 'mime')?.value, text = field(file, 'text'), content = field(file, 'content');
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || typeof rawMime !== 'string')
      return rejected('malformed_file', 'The actual Files record needs nonempty id/name and an explicit MIME type.');
    if (field(file, 'deleted')?.value === true || field(file, 'kind')?.value === 'folder')
      return rejected('stale_target', 'The original attachment file is deleted or is not a document.');
    const mime = rawMime.toLowerCase();
    if (!MIMES.has(mime))
      return rejected('unsupported_mime', 'Local previews support PNG, JPEG, GIF, WebP and PDF files only; SVG is not supported.');
    if (text && typeof text.value !== 'string' || content && typeof content.value !== 'string'
      || text && content && text.value !== content.value)
      return rejected('malformed_file', 'Files text/content fields must contain the same actual stored string.');
    const stored = (text ?? content)?.value;
    if (typeof stored !== 'string' || !stored)
      return rejected('malformed_file', 'The attachment has no actual stored file data.');
    if (stored.length > NOTES_ATTACHMENT_PREVIEW_LIMITS.text)
      return rejected('limit_exceeded', 'The attachment exceeds the 1 Mi-unit Files content limit.');
    const comma = stored.indexOf(',');
    if (comma < 0 || stored.slice(0, comma).toLowerCase() !== `data:${mime};base64`)
      return rejected('malformed_file', 'The Files content must be a matching base64 data URI; document URLs and guessed binary encodings are not supported.');
    const bytes = decodeBase64(stored.slice(comma + 1));
    if (!bytes || !signature(bytes, mime))
      return rejected('malformed_file', 'The stored attachment bytes are invalid or do not match the actual file MIME type.');
    return { status: 'applied', fileId: id, name, mime, kind: mime === 'application/pdf' ? 'pdf' : 'image', bytes };
  } catch (error) {
    return rejected('malformed_file', error instanceof Error ? error.message : 'The actual attachment file could not be decoded.');
  }
}

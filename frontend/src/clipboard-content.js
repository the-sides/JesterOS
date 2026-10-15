import { unzlibSync } from 'fflate';

const PNG_PREFIX = 'data:image/png;base64,';
const uint32 = (bytes, offset) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// The clipboard supports genuine non-interlaced 8-bit RGB/RGBA PNGs emitted by
// the local canvases. Validate chunks and inflated scanlines, not just MIME text.
export function validateClipboardPNG(content, width, height) {
  if (typeof content !== 'string' || content.length > 1024 * 1024 || !content.startsWith(PNG_PREFIX)
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 3840 || height > 2160) return false;
  const base64 = content.slice(PNG_PREFIX.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) return false;
  try {
    const binary = atob(base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return false;
    let offset = 8, channels = 0, header = false, ended = false, payloadSize = 0, finishedData = false;
    const payloads = [];
    while (offset + 12 <= bytes.length && !ended) {
      const size = uint32(bytes, offset), start = offset + 8, end = start + size;
      if (end + 4 > bytes.length || crc32(bytes, offset + 4, end) !== uint32(bytes, end)) return false;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (!/^[A-Za-z]{4}$/.test(type)) return false;
      if (!header && type !== 'IHDR') return false;
      if (type === 'IHDR') {
        if (header || size !== 13 || uint32(bytes, start) !== width || uint32(bytes, start + 4) !== height
          || bytes[start + 8] !== 8 || ![2, 6].includes(bytes[start + 9])
          || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0) return false;
        channels = bytes[start + 9] === 2 ? 3 : 4; header = true;
      } else if (type === 'IDAT') {
        if (finishedData) return false;
        payloads.push(bytes.subarray(start, end)); payloadSize += size;
      } else if (type === 'IEND') {
        if (size !== 0 || payloadSize === 0) return false;
        ended = true;
      } else {
        if (payloads.length) finishedData = true;
        if (type !== 'PLTE' && type.charCodeAt(0) < 97) return false;
      }
      offset = end + 4;
    }
    if (!ended || offset !== bytes.length) return false;
    const compressed = new Uint8Array(payloadSize);
    let writeOffset = 0;
    for (const payload of payloads) { compressed.set(payload, writeOffset); writeOffset += payload.length; }
    const stride = width * channels + 1, expected = stride * height;
    const pixels = unzlibSync(compressed, { out: new Uint8Array(expected + 1) });
    if (pixels.length !== expected) return false;
    for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) return false;
    return true;
  } catch { return false; }
}

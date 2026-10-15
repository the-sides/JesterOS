import { previewImageGeometry } from './preview-codec.js';

// Encoded headers only, not proof of decodable pixels. Reuse the sole Preview
// PNG/JPEG/WebP parser; Photos decoder independently proves actual source pixels.
export function photoGeometry(content, mime) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime))
    throw Object.assign(new Error('Photos requires PNG, JPEG or WebP geometry.'), { code: 'unsupported_content' });
  const geometry = previewImageGeometry(content);
  if (geometry.mime !== mime)
    throw Object.assign(new Error('Photos source MIME does not match encoded image geometry.'), { code: 'unsupported_content' });
  return geometry;
}

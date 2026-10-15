import { toCanvas } from 'html-to-image';

// Rasterize only the original simulated desktop DOM. This never requests host
// screen/device permission, and never substitutes a hand-painted desktop.
export function createDesktopFrameCapture(ctx) {
  return async function captureFrame({ width, height, guard }) {
    const root = ctx.getRoot(), generation = ctx.getGeneration();
    if (typeof guard !== 'function' || !root?.isConnected)
      throw new Error('Use an original mounted desktop and ownership guard.');
    const bounds = root.getBoundingClientRect();
    width ??= Math.round(bounds.width);
    height ??= Math.round(bounds.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
      || width > 3840 || height > 2160 || bounds.width <= 0 || bounds.height <= 0)
      throw new Error('Use a bounded frame and an original desktop with rendered pixels.');
    const current = () => {
      if (!ctx.alive() || guard() !== true || ctx.getRoot() !== root
        || ctx.getGeneration() !== generation || !root.isConnected || root.closest('[inert]')) return false;
      const actual = root.getBoundingClientRect();
      return actual.x === bounds.x && actual.y === bounds.y
        && actual.width === bounds.width && actual.height === bounds.height;
    };
    if (!current()) throw new Error('The original simulated desktop is unavailable.');
    await root.ownerDocument.fonts.ready;
    if (!current()) throw new Error('The original desktop changed during font preparation.');
    const raster = await toCanvas(root, {
      width: bounds.width, height: bounds.height, pixelRatio: 1,
      cacheBust: false, skipAutoScale: true,
    });
    if (!current()) { raster.width = raster.height = 0; throw new Error('The original desktop changed during capture.'); }
    const canvas = root.ownerDocument.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) { raster.width = raster.height = 0; throw new Error('The local recording canvas is unavailable.'); }
    context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
    const scale = Math.min(width / raster.width, height / raster.height);
    const targetWidth = raster.width * scale, targetHeight = raster.height * scale;
    const imageRect = { x: (width - targetWidth) / 2, y: (height - targetHeight) / 2,
      width: targetWidth, height: targetHeight };
    context.drawImage(raster, imageRect.x, imageRect.y, targetWidth, targetHeight);
    raster.width = raster.height = 0;
    if (!current()) { canvas.width = canvas.height = 0; throw new Error('The original desktop changed during capture.'); }
    return { canvas, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, imageRect };
  };
}

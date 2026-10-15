import { windows11AppsForWindow } from '../frontend/src/windows11-app-state.js';
import { svgData } from '../frontend/src/windows11-app-helpers.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Parent runs against the actual changed Root actor/dispatcher and mounted views.
// No window factory, forwarding echo, source-record render snapshot or fake image decoder.
export async function runWindows11SvgPhotosNativeRegression({ apps, getWindows, getRoot, execute, flush, sourceWindowId, fileId = 'studio-photo' }) {
  const sourceWindow = getWindows().find(window => window.id === sourceWindowId);
  const sourceFile = apps.files.find(file => file.id === fileId);
  assert(sourceWindow?.appId === 'explorer' && sourceFile?.kind === 'image', 'Original Explorer and shared SVG File required.');
  assert(/^\s*<svg[\s>]/.test(sourceFile.content), 'Complete standalone original SVG bytes required.');
  const files = apps.files, fileState = JSON.stringify(files);
  const rasterWindows = getWindows().filter(window => window.appId === 'photos' && window.utilityKind !== 'photos-svg');
  assert(!getWindows().some(window => window.utilityKind === 'photos-svg'), 'Regression must begin with no pre-existing SVG destination.');

  const result = await execute({ command: 'win11.files.open', target: { windowId: sourceWindow.id, fileId }, payload: {} });
  assert(result.status === 'applied', 'Canonical Explorer SVG open must apply: ' + JSON.stringify(result));
  await flush();
  const destination = getWindows().find(window => window.id === result.target.windowId);
  assert(destination && destination !== sourceWindow && destination.appId === 'photos' && destination.utilityKind === 'photos-svg', 'Open must return the actual distinct legacy Photos destination.');
  const scoped = windows11AppsForWindow(apps, destination.id);
  assert(scoped?.photos.selectedId === fileId && scoped.photos.mode === 'viewer', 'Real original scoped Photos model must select the source SVG.');
  const root = getRoot(destination.id), image = root?.querySelector('.photos-app .main-image');
  assert(root?.isConnected && image?.isConnected && image.getAttribute('src') === svgData(sourceFile.content), 'Actual mounted SVG viewer must consume the complete original source.');
  await image.decode();
  assert(image.naturalWidth > 0 && image.naturalHeight > 0, 'Original rendered SVG must genuinely decode.');
  const canvas = image.ownerDocument.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Set();
  for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset + 3]) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
  assert(colors.size > 1, 'Actual SVG content must paint nonempty, nonblank authored pixels.');
  assert(getWindows().find(window => window.id === sourceWindow.id) === sourceWindow && apps.files === files && apps.files.find(file => file.id === fileId) === sourceFile && JSON.stringify(files) === fileState, 'Opening must preserve original Explorer, shared Files and complete bytes/revisions.');
  assert(rasterWindows.every(window => getWindows().find(row => row.id === window.id) === window), 'Existing genuine raster Photos windows must remain exact originals.');

  const reopened = await execute({ command: 'win11.files.open', target: { windowId: sourceWindow.id, fileId }, payload: {} });
  await flush();
  assert(reopened.status === 'applied' && reopened.target.windowId === destination.id && getWindows().find(window => window.id === destination.id) === destination && windows11AppsForWindow(apps, destination.id) === scoped, 'Reopen must reuse the actual original SVG viewer/session.');
  assert(getRoot(destination.id).querySelector('.main-image') === image, 'Reopen must retain the original actual image element.');
  return { status: 'applied', windowId: destination.id, fileId, decodedWidth: image.naturalWidth, decodedHeight: image.naturalHeight, paintedColors: colors.size, behaviors: ['absent-destination-launch', 'real-sdk-photos-model', 'complete-original-svg-source', 'actual-image-decode', 'actual-painted-svg-pixels', 'exact-window-session-reuse', 'raster-window-preservation'] };
}

import { createCalculatorState, createCalculatorWindow } from './calculator-state.js';
import { evaluateCalculator } from './calculator-engine.js';
import { storePackage } from './store-fixtures.js';

// Transient, read-only authored examples, not installed processes or retained
// Calculator domain sessions. They render the actual shared CalculatorApp.
export function createStoreScreenshotState(packageId, index, profile, actualStoreWindowId, sceneTime) {
  const pkg = storePackage(packageId), shot = pkg?.screenshots[index];
  if (!shot) return null;
  const state = createCalculatorState(profile, { sceneTime }), session = createCalculatorWindow(actualStoreWindowId, pkg.installedId, shot.mode);
  const expression = packageId === 'trail-calculator' ? index === 0 ? '125+37' : '9*9' : index === 0 ? '255' : '15';
  const result = evaluateCalculator(expression, { mode: shot.mode, base: 10, wordBits: 64 });
  session.expression = expression;
  session.value = result.value;
  session.repeat = result.repeat;
  session.completed = true;
  if (shot.mode === 'programmer') session.base = 16;
  state.windows.push(session);
  return { id: shot.id, state, shot, width: shot.mode === 'basic' ? 340 : 760, height: shot.mode === 'programmer' ? 880 : 640 };
}

// Capture real mounted local-component DOM and its actual computed styles into
// genuine SVG screenshot bytes. No hand-drawn surrogate, host capture, or fake
// view acknowledgement. Images remain presentation-only, outside saved JSON.
export function captureStoreScreenshot(original, guard) {
  if (!original?.isConnected || guard() !== true) return null;
  const bounds = original.getBoundingClientRect(), width = Math.ceil(bounds.width), height = Math.ceil(Math.max(bounds.height, original.scrollHeight));
  if (width < 1 || height < 1 || width > 2048 || height > 2048) return null;
  const clone = original.cloneNode(true), source = [original, ...original.querySelectorAll('*')], destination = [clone, ...clone.querySelectorAll('*')];
  if (source.length !== destination.length || source.length > 2048) return null;
  const win = original.ownerDocument.defaultView;
  for (let index = 0; index < source.length; index++) {
    const computed = win.getComputedStyle(source[index]), copy = destination[index];
    for (let key = 0; key < computed.length; key++) { const name = computed[key]; copy.style.setProperty(name, computed.getPropertyValue(name)); }
    copy.style.setProperty('animation', 'none');
    copy.style.setProperty('transition', 'none');
    for (const attribute of [...copy.attributes]) if (attribute.name.startsWith('on')) copy.removeAttribute(attribute.name);
    if (source[index].tagName === 'INPUT') { copy.setAttribute('value', source[index].value); if (source[index].checked) copy.setAttribute('checked', 'checked'); else copy.removeAttribute('checked'); }
    if (source[index].tagName === 'TEXTAREA') copy.textContent = source[index].value;
    if (source[index].tagName === 'SELECT') [...copy.options].forEach((option, i) => { if (i === source[index].selectedIndex) option.setAttribute('selected', 'selected'); else option.removeAttribute('selected'); });
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.setProperty('position', 'relative');
  clone.style.setProperty('inset', 'auto');
  clone.style.setProperty('transform', 'none');
  clone.style.setProperty('width', `${width}px`);
  clone.style.setProperty('height', `${height}px`);
  const markup = new win.XMLSerializer().serializeToString(clone);
  if (markup.length > 4 * 1024 * 1024 || !original.isConnected || guard() !== true || original.getBoundingClientRect().width !== bounds.width) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, mime: 'image/svg+xml', width, height };
}

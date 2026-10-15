import { createMicrosoftOfficeCommands } from './microsoft-office-controller.js';
import { encodePPTX, decodePPTX } from './createoffice-xml-codec.js';
import { validatePowerPointState, powerpointWindow, createPowerPointWindow, powerpointWindowMetadata, powerpointCapabilities, createPowerPointDocument, validatePowerPointDocument, createPowerPointObject, resetPowerPointSelection } from './powerpoint-state.js';
import { powerpointCommandSpecs, mutatePowerPoint } from './powerpoint-model.js';
export { powerpointCatalog } from './powerpoint-catalog.js';
export const POWERPOINT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const unsupported = message => { const error = new Error(message); error.code = 'unsupported_content'; throw error; };
const rgb = (value, fallback) => typeof value === 'string' ? value.toLowerCase() : fallback;
export function encodePowerPointDocument(document) {
  const valid = validatePowerPointDocument(document);
  if (!valid.ok) unsupported(valid.message);
  return encodePPTX({ ...document, slides: document.slides.map(slide => ({ ...slide, transitionDuration: slide.transition === 'none' ? 0 : slide.transitionDuration ?? .6, objects: slide.objects.map(item => item.type === 'image' ? item : { ...item, font: item.font ?? 'Calibri', fill: item.type === 'text' || item.shape === 'line' ? 'none' : item.fill, stroke: item.type === 'shape' && item.shape === 'line' ? item.fill : 'none', strokeWidth: item.type === 'shape' && item.shape === 'line' ? 3 : 0 }) })) });
}
export function normalizePowerPointDocument(source) {
  if (!source || !Array.isArray(source.slides)) unsupported('A supported PPTX presentation is required.');
  const identities = new Set();
  const id = (value, fallback) => {
    let candidate = typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) && ![...Object.getOwnPropertyNames(Object.prototype), 'prototype'].includes(value) ? value : fallback;
    let index = 1;
    if (identities.has(candidate)) candidate = fallback;
    while (identities.has(candidate)) candidate = `${fallback}-${index++}`;
    identities.add(candidate);
    return candidate;
  };
  const document = { title: source.title ?? 'Presentation1', width: source.width ?? 960, height: source.height ?? 540, slides: source.slides.map((slide, slideIndex) => {
    if (slide.notes) unsupported('Speaker notes are not supported by this editor; they will not be silently discarded.');
    const transition = typeof slide.transition === 'object' ? slide.transition.type : slide.transition ?? 'none';
    const duration = slide.transitionDuration ?? (typeof slide.transition === 'object' ? slide.transition.duration : undefined);
    return { id: id(slide.id, `import-slide-${slideIndex + 1}`), background: rgb(slide.background, '#ffffff'), transition, ...(duration !== undefined ? { transitionDuration: duration } : {}), objects: (slide.objects ?? []).map((item, objectIndex) => {
      if (!['text', 'shape', 'image'].includes(item.type)) unsupported('PPTX charts and media objects cannot be edited here; no object is silently removed.');
      if (item.italic || item.align && item.align !== 'left') unsupported('Italic and non-left-aligned PPTX text are not supported by this editor.');
      let text = item.text ?? '';
      const contentRuns = item.runs?.filter(run => !/^[\r\n]*$/u.test(run.text)) ?? [];
      if (contentRuns.length) {
        const first = contentRuns[0];
        if (contentRuns.some(run => run.italic || run.underline || ['bold', 'color', 'size', 'font'].some(key => run[key] !== first[key]))) unsupported('Mixed rich-text runs cannot be flattened without losing formatting.');
      }
      if (!text && item.runs?.length) text = item.runs.map(run => run.text).join('');
      const run = contentRuns[0] ?? item.runs?.[0];
      const shape = item.shape === 'rect' ? 'rectangle' : item.shape ?? 'rectangle';
      if (!['rectangle', 'ellipse', 'line'].includes(shape)) unsupported('This editor supports rectangle, ellipse and line shapes only.');
      if (item.type === 'text' && item.fill && item.fill !== 'none') unsupported('Filled text-box backgrounds cannot be imported by this transparent-text editor.');
      if (item.type !== 'image' && shape !== 'line' && item.stroke && item.stroke !== 'none' && item.strokeWidth !== 0) unsupported('Shape outlines cannot be imported without losing their appearance.');
      if (item.type === 'shape' && shape === 'line' && item.strokeWidth !== undefined && item.strokeWidth !== 3) unsupported('Only three-point line strokes are supported.');
      if (item.type === 'shape' && shape !== 'line' && item.fill === 'none') unsupported('Transparent shapes are not supported by this solid-fill editor.');
      const fill = item.type === 'shape' && shape === 'line' ? rgb(item.stroke === 'none' ? item.fill : item.stroke, '#d24726') : rgb(item.fill === 'none' ? undefined : item.fill, '#d24726');
      const mime = item.type === 'image' ? item.mime ?? (/^data:image\/jpeg;/u.test(item.content) ? 'image/jpeg' : 'image/png') : '';
      return createPowerPointObject(id(item.id, `import-object-${slideIndex + 1}-${objectIndex + 1}`), item.type, { x: item.x ?? 0, y: item.y ?? 0, width: item.width ?? 1, height: item.height ?? 1, text: item.type === 'image' ? '' : text, shape, fill, color: rgb(item.color ?? run?.color, '#242424'), fontSize: item.fontSize ?? item.size ?? run?.size ?? 32, font: item.font ?? item.fontFamily ?? run?.font ?? 'Calibri', bold: item.bold ?? run?.bold ?? false, content: item.type === 'image' ? item.content : '', mime });
    }) };
  }) };
  const result = validatePowerPointDocument(document);
  if (!result.ok) unsupported(result.message);
  return document;
}
export function createPowerPointCommands(state, ctx) {
  return createMicrosoftOfficeCommands(state, ctx, { appId: 'powerpoint', validate: validatePowerPointState, session: powerpointWindow, createWindow: createPowerPointWindow, metadata: powerpointWindowMetadata, capabilities: powerpointCapabilities, createDocument: createPowerPointDocument, validateDocument: validatePowerPointDocument, commandSpecs: powerpointCommandSpecs, mutate: mutatePowerPoint, encode: encodePowerPointDocument, decode: decodePPTX, mime: POWERPOINT_MIME, resetSelection: resetPowerPointSelection, normalizeDocument: normalizePowerPointDocument });
}

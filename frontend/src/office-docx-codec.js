import {
  XMLNS, xml, fail, children, child, descendants, nodeText, attr,
  pack, unpack, getXML, putXML, rels, readRels, contentTypes, rootRels,
  xmlHeader, imageData, dataURL, addChart, readChart,
} from './office-xml-common.js';

// WordprocessingML uses twentieths of a point; DrawingML uses 12,700 EMU/point.
const MAIN = 'word/document.xml';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CORE_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const MAX_BLOCKS = 10000;
const FORMAT_KEYS = new Set(['text', 'font', 'fontFamily', 'size', 'fontSize', 'color', 'bold', 'italic', 'underline', 'align', 'id', 'type', 'runs', 'style', 'pageBreakBefore']);
const TABLE_KEYS = new Set(['type', 'id', 'rows', 'columnWidths', 'borders', 'layout']);
const IMAGE_KEYS = new Set(['type', 'id', 'content', 'mime', 'width', 'height']);
const CHART_KEYS = new Set(['type', 'id', 'kind', 'title', 'labels', 'values', 'width', 'height']);
const local = node => node?.name?.split(':').at(-1);
const unsupported = message => fail('unsupported_content', message);
const invalid = message => fail('invalid_format', message);

function charge(budget, key, amount, limit) {
  budget[key] = (budget[key] ?? 0) + amount;
  if (budget[key] > limit) fail('limit_exceeded', `DOCX ${key} exceeds the supported bound.`);
}
function number(value, fallback, min = 0, max = 100000) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) unsupported('Invalid or unsupported document dimensions.');
  return n;
}
function text(value, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') unsupported('Document text must be a string.');
  if (value.length > 2000000) fail('limit_exceeded', 'Document text is too large.');
  xml(value);
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) unsupported('Only RGB document colors are supported.');
  return value.toLowerCase();
}
function alignment(value = 'left') {
  if (!['left', 'center', 'right', 'justify'].includes(value)) unsupported('Unsupported paragraph alignment.');
  return value;
}
function format(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) unsupported('Invalid text formatting.');
  for (const key in source) if (Object.hasOwn(source, key) && !FORMAT_KEYS.has(key)) unsupported(`Unsupported text formatting/content property: ${key}.`);
  const result = {};
  for (const mark of ['bold', 'italic', 'underline']) {
    if (source[mark] !== undefined) {
      if (typeof source[mark] !== 'boolean') unsupported('Text marks must be booleans.');
      result[mark] = source[mark];
    }
  }
  const font = source.font ?? source.fontFamily;
  const size = source.size ?? source.fontSize;
  if (font !== undefined) {
    result.font = text(font);
    if (!result.font.length || result.font.length > 256) unsupported('Font names must be nonempty and bounded.');
  }
  if (size !== undefined) {
    result.size = number(size, 12, 0.5, 409);
    if (!Number.isInteger(result.size * 2)) unsupported('DOCX font sizes must be whole or half points.');
  }
  if (source.color !== undefined) result.color = color(source.color);
  return result;
}
function paragraph(source, budget) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) unsupported('Invalid paragraph.');
  for (const key in source) if (Object.hasOwn(source, key) && !FORMAT_KEYS.has(key)) unsupported(`Unsupported paragraph property: ${key}.`);
  const base = format(source.style ?? source);
  const pageBreakBefore = Object.hasOwn(source, 'pageBreakBefore') ? source.pageBreakBefore : source.style?.pageBreakBefore;
  if (pageBreakBefore !== undefined && typeof pageBreakBefore !== 'boolean') unsupported('Paragraph page breaks must be booleans.');
  const runs = source.runs ?? [{ text: source.text ?? '', ...base }];
  if (!Array.isArray(runs) || runs.length > MAX_BLOCKS) unsupported('Invalid or oversized paragraph runs.');
  charge(budget, 'runs', runs.length, 20000);
  charge(budget, 'xmlNodes', 4 + Number(pageBreakBefore !== undefined), 180000);
  return { type: 'paragraph', align: alignment(source.align ?? source.style?.align), ...(pageBreakBefore !== undefined ? { pageBreakBefore } : {}), runs: runs.map(run => {
    if (!run || typeof run !== 'object' || Array.isArray(run)) unsupported('Invalid paragraph run.');
    if (Object.hasOwn(run, 'pageBreakBefore')) unsupported('Page breaks belong to paragraphs, not text runs.');
    const value = text(run.text);
    charge(budget, 'text', value.length, 2000000);
    let controls = 0;
    for (let index = 0; index < value.length; index++) if ('\t\r\n'.includes(value[index])) controls++;
    charge(budget, 'xmlNodes', 12 + controls * 2, 180000);
    return { text: value, ...base, ...format(run) };
  }) };
}
function pageLayout(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) unsupported('Invalid page layout.');
  const width = number(source.width, 612, 1, 1584);
  const height = number(source.height, 792, 1, 1584);
  const margin = source.margin ?? 72;
  const margins = typeof margin === 'number'
    ? { top: margin, right: margin, bottom: margin, left: margin }
    : margin;
  if (!margins || typeof margins !== 'object') unsupported('Invalid page margins.');
  const sides = {};
  for (const side of ['top', 'right', 'bottom', 'left']) sides[side] = number(margins[side], 72, 0, 1584);
  if (sides.left + sides.right >= width || sides.top + sides.bottom >= height) unsupported('Margins leave no page content area.');
  return { width, height, margin: Object.values(sides).every(n => n === sides.top) ? sides.top : sides };
}
function marginsOf(page) {
  return typeof page.margin === 'number'
    ? { top: page.margin, right: page.margin, bottom: page.margin, left: page.margin }
    : page.margin;
}
function runXML(run) {
  const props = (run.font === undefined ? '' : `<w:rFonts w:ascii="${xml(run.font)}" w:hAnsi="${xml(run.font)}"/>`)
    + ['bold', 'italic'].map(mark => run[mark] === undefined ? '' : `<w:${mark === 'bold' ? 'b' : 'i'} w:val="${run[mark] ? '1' : '0'}"/>`).join('')
    + (run.color === undefined ? '' : `<w:color w:val="${run.color.slice(1)}"/>`)
    + (run.size === undefined ? '' : `<w:sz w:val="${Math.round(run.size * 2)}"/>`)
    + (run.underline === undefined ? '' : `<w:u w:val="${run.underline ? 'single' : 'none'}"/>`);
  const content = run.text.split(/(\t|\n|\r\n|\r)/).map(part => part === '\t' ? '<w:tab/>' : /^(\r\n|\r|\n)$/.test(part) ? '<w:br/>' : `<w:t xml:space="preserve">${xml(part)}</w:t>`).join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${content}</w:r>`;
}
function paragraphXML(p) {
  return `<w:p><w:pPr>${p.pageBreakBefore !== undefined ? `<w:pageBreakBefore w:val="${p.pageBreakBefore ? '1' : '0'}"/>` : ''}<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/></w:pPr>${p.runs.map(runXML).join('')}</w:p>`;
}
function cellParagraphs(cell, budget) {
  charge(budget, 'cells', 1, 20000);
  charge(budget, 'xmlNodes', 3, 180000);
  if (typeof cell === 'string') return [paragraph({ text: cell }, budget)];
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) unsupported('Invalid table cell.');
  const ps = cell.paragraphs ?? cell.blocks;
  if (ps !== undefined) {
    if (!Array.isArray(ps) || !ps.length || ps.length > MAX_BLOCKS || ps.some(p => !p || typeof p !== 'object' || p.type && p.type !== 'paragraph')) unsupported('Only bounded paragraph content is supported in table cells.');
    return ps.map(p => paragraph(p, budget));
  }
  return [paragraph(cell, budget)];
}
function tableXML(table, page, budget) {
  for (const key in table) if (Object.hasOwn(table, key) && !TABLE_KEYS.has(key)) unsupported(`Unsupported table property: ${key}.`);
  if (!Array.isArray(table.rows) || !table.rows.length || table.rows.length > 1000) unsupported('Tables require bounded rows.');
  const columns = table.rows[0]?.length;
  if (!columns || columns > 100 || table.rows.some(row => !Array.isArray(row) || row.length !== columns)) unsupported('Only rectangular, unmerged tables are supported.');
  charge(budget, 'xmlNodes', 16 + columns + table.rows.length, 180000);
  const m = marginsOf(page);
  const widths = table.columnWidths ?? Array(columns).fill((page.width - m.left - m.right) / columns);
  if (!Array.isArray(widths) || widths.length !== columns) unsupported('Table column widths must match the grid.');
  const grid = widths.map(w => Math.round(number(w, 72, 0.05, 1584) * 20));
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => {
    const style = table.borders?.[side] ?? (table.borders ? 'nil' : 'single');
    if (!['single', 'nil', 'none'].includes(style)) unsupported('Unsupported table borders.');
    return `<w:${side} w:val="${style}" w:sz="4" w:color="000000"/>`;
  }).join('');
  const layout = table.layout ?? 'fixed';
  if (!['fixed', 'autofit'].includes(layout)) unsupported('Unsupported table layout.');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="${layout}"/></w:tblPr><w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${table.rows.map(row => `<w:tr>${row.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${grid[index]}" w:type="dxa"/></w:tcPr>${cellParagraphs(cell, budget).map(paragraphXML).join('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}
function drawingXML(id, width, height, payload, uri) {
  const cx = Math.round(width * 12700), cy = Math.round(height * 12700);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Object ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function encodeDOCX(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) unsupported('DOCX requires a document object, not a native Pages file.');
  if (!['blocks', 'paragraphs', 'tables', 'images'].some(key => Object.hasOwn(document, key))) unsupported('Unrecognized document representation; native Pages documents are unsupported.');
  for (const key of ['blocks', 'paragraphs', 'tables', 'images']) if (document[key] !== undefined && !Array.isArray(document[key])) unsupported(`Document ${key} must be an array.`);
  if ((document.blocks?.length ?? (document.paragraphs?.length ?? 0) + (document.tables?.length ?? 0) + (document.images?.length ?? 0)) > MAX_BLOCKS) fail('limit_exceeded', 'DOCX blocks exceed the supported bound.');
  const title = text(document.title, 'Untitled');
  const page = pageLayout(document.page);
  const blocks = document.blocks ?? [
    ...(document.paragraphs ?? []).map(p => ({ ...p, type: 'paragraph' })),
    ...(document.tables ?? []).map(t => ({ ...t, type: 'table' })),
    ...(document.images ?? []).map(image => ({ ...image, type: 'image' })),
  ];
  if (!Array.isArray(blocks) || blocks.length > MAX_BLOCKS) fail('limit_exceeded', 'DOCX blocks exceed the supported bound.');
  const parts = {}, relationships = [], overrides = [{ path: MAIN, type: MAIN_TYPE }, { path: 'docProps/core.xml', type: CORE_TYPE }];
  const budget = { text: title.length, xmlNodes: 50 };
  let objectId = 0;
  const body = blocks.map(block => {
    if (!block || typeof block !== 'object') unsupported('Invalid document block.');
    if (block.type === 'paragraph') return paragraphXML(paragraph(block, budget));
    if (block.type === 'table') return tableXML(block, page, budget);
    if (!['image', 'chart'].includes(block.type)) unsupported(`Unsupported DOCX block: ${block.type}.`);
    const keys = block.type === 'image' ? IMAGE_KEYS : CHART_KEYS;
    for (const key in block) if (Object.hasOwn(block, key) && !keys.has(key)) unsupported(`Unsupported ${block.type} property: ${key}.`);
    const id = ++objectId;
    const width = number(block.width, block.type === 'chart' ? 360 : 144, 0.05, 1584);
    const height = number(block.height, block.type === 'chart' ? 216 : 144, 0.05, 1584);
    const rid = `rId${id}`;
    if (block.type === 'chart') {
      if (block.series !== undefined) unsupported('DOCX charts accept a single unnamed labels/values series.');
      charge(budget, 'chartPoints', block.labels?.length ?? 0, 20000);
      charge(budget, 'xmlNodes', 100 + (block.labels?.length ?? 0) * 4, 180000);
      charge(budget, 'text', text(block.title).length, 2000000);
      if (Array.isArray(block.labels)) for (const label of block.labels) charge(budget, 'text', text(typeof label === 'number' && Number.isFinite(label) ? String(label) : label).length, 2000000);
      const path = addChart(parts, `word/charts/chart${id}.xml`, block);
      relationships.push({ id: rid, type: 'chart', target: `charts/chart${id}.xml` });
      overrides.push({ path, type: CHART_TYPE });
      return drawingXML(id, width, height, `<c:chart r:id="${rid}"/>`, XMLNS.c);
    }
    charge(budget, 'mediaText', typeof block.content === 'string' ? block.content.length : 0, 32 * 1024 * 1024);
    charge(budget, 'xmlNodes', 40, 180000);
    const image = imageData(block.content);
    const path = `word/media/image${id}.${image.extension}`;
    parts[path] = image.bytes;
    relationships.push({ id: rid, type: 'image', target: `media/image${id}.${image.extension}` });
    const cx = Math.round(width * 12700), cy = Math.round(height * 12700);
    const picture = `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;
    return drawingXML(id, width, height, picture, XMLNS.pic);
  }).join('');
  const margin = marginsOf(page);
  const sect = `<w:sectPr><w:pgSz w:w="${Math.round(page.width * 20)}" w:h="${Math.round(page.height * 20)}"/><w:pgMar ${Object.entries(margin).map(([key, value]) => `w:${key}="${Math.round(value * 20)}"`).join(' ')} w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  putXML(parts, MAIN, xmlHeader + `<w:document xmlns:w="${XMLNS.w}" xmlns:r="${XMLNS.r}" xmlns:a="${XMLNS.a}" xmlns:wp="${XMLNS.wp}" xmlns:pic="${XMLNS.pic}" xmlns:c="${XMLNS.c}"><w:body>${body || '<w:p/>'}${sect}</w:body></w:document>`);
  putXML(parts, 'word/_rels/document.xml.rels', rels(relationships));
  putXML(parts, '_rels/.rels', rootRels(MAIN));
  putXML(parts, 'docProps/core.xml', xmlHeader + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`);
  putXML(parts, '[Content_Types].xml', contentTypes(overrides));
  return pack(parts, 'docx');
}

function allowed(node, names, label) {
  for (const item of node?.children ?? []) if (!names.includes(local(item))) unsupported(`Unsupported ${label}: ${local(item)}.`);
}
function xmlNumber(node, name, fallback, scale = 1) {
  const raw = attr(node, name);
  if (raw === undefined) return fallback;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) invalid('Invalid numeric WordprocessingML property.');
  return Number(raw) / scale;
}
function toggle(node) {
  const value = attr(node, 'val');
  if (value === undefined || ['1', 'true', 'on'].includes(value)) return true;
  if (['0', 'false', 'off'].includes(value)) return false;
  invalid('Invalid WordprocessingML boolean.');
}
function themeValues(parts, relationships) {
  const relationship = [...relationships.values()].find(r => r.type.endsWith('/theme'));
  if (!relationship) return { fonts: {}, colors: {} };
  const theme = getXML(parts, relationship.path);
  const scheme = descendants(theme, 'fontScheme')[0];
  const fonts = {};
  for (const kind of ['major', 'minor']) fonts[kind] = attr(child(child(scheme, `${kind}Font`), 'latin'), 'typeface');
  const colors = {};
  const clr = descendants(theme, 'clrScheme')[0];
  for (const item of clr?.children ?? []) {
    const rgb = child(item, 'srgbClr'), system = child(item, 'sysClr');
    const value = attr(rgb, 'val') ?? attr(system, 'lastClr');
    if (value && /^[0-9a-f]{6}$/i.test(value)) colors[local(item)] = `#${value.toLowerCase()}`;
  }
  return { fonts, colors };
}
function readRunProperties(node, themes) {
  allowed(node, ['rStyle', 'rFonts', 'b', 'i', 'bCs', 'iCs', 'u', 'sz', 'szCs', 'color', 'lang', 'noProof', 'rtl', 'cs'], 'run formatting');
  const result = {};
  for (const [element, field] of [['b', 'bold'], ['i', 'italic']]) if (child(node, element)) result[field] = toggle(child(node, element));
  for (const [element, field] of [['bCs', 'bold'], ['iCs', 'italic']]) {
    if (child(node, element) && result[field] !== toggle(child(node, element))) unsupported('Different complex-script text formatting is unsupported.');
  }
  if (child(node, 'rtl') && toggle(child(node, 'rtl'))) unsupported('Right-to-left runs are unsupported.');
  if (child(node, 'cs') && toggle(child(node, 'cs'))) unsupported('Complex-script-only runs are unsupported.');
  const u = child(node, 'u');
  if (u) {
    const value = attr(u, 'val') ?? 'single';
    if (!['single', 'none'].includes(value) || attr(u, 'color') || attr(u, 'themeColor')) unsupported('Only plain single underline is supported.');
    result.underline = value === 'single';
  }
  const fonts = child(node, 'rFonts');
  if (fonts) {
    const ascii = attr(fonts, 'ascii'), ansi = attr(fonts, 'hAnsi');
    if (ascii && ansi && ascii !== ansi) unsupported('Different fonts within one run are unsupported.');
    const themeFont = attr(fonts, 'asciiTheme') ?? attr(fonts, 'hAnsiTheme');
    const resolved = ascii ?? ansi ?? (themeFont ? themes.fonts[themeFont.startsWith('major') ? 'major' : 'minor'] : undefined);
    for (const key of ['eastAsia', 'cs']) if (attr(fonts, key) && attr(fonts, key) !== resolved) unsupported('Different script-specific fonts are unsupported.');
    if (themeFont && !resolved) unsupported('Unresolved theme font.');
    if (resolved) result.font = resolved;
  }
  if (child(node, 'sz')) result.size = number(xmlNumber(child(node, 'sz'), 'val', undefined, 2), undefined, 0.5, 409);
  if (child(node, 'szCs') && result.size !== undefined && xmlNumber(child(node, 'szCs'), 'val', undefined, 2) !== result.size) unsupported('Different complex-script font sizes are unsupported.');
  const ink = child(node, 'color');
  if (ink) {
    const themeName = attr(ink, 'themeColor');
    const aliases = { text1: 'dk1', text2: 'dk2', background1: 'lt1', background2: 'lt2' };
    const value = attr(ink, 'val');
    let rgb = themeName ? themes.colors[aliases[themeName] ?? themeName] : value === 'auto' ? '#000000' : value ? `#${value}` : undefined;
    if (!rgb) unsupported('Unresolved document text color.');
    rgb = color(rgb);
    for (const effect of ['themeShade', 'themeTint']) {
      const amount = attr(ink, effect);
      if (amount === undefined) continue;
      if (!/^[0-9a-f]{2}$/i.test(amount)) invalid('Invalid theme color adjustment.');
      const factor = parseInt(amount, 16) / 255;
      rgb = '#' + [1, 3, 5].map(i => {
        const component = parseInt(rgb.slice(i, i + 2), 16);
        return Math.round(effect === 'themeShade' ? component * factor : component + (255 - component) * (1 - factor)).toString(16).padStart(2, '0');
      }).join('');
    }
    result.color = rgb;
  }
  return result;
}
function readParagraphProperties(node) {
  allowed(node, ['pStyle', 'jc', 'rPr', 'spacing', 'widowControl', 'contextualSpacing', 'keepNext', 'keepLines', 'suppressAutoHyphens', 'pageBreakBefore'], 'paragraph formatting');
  const jc = attr(child(node, 'jc'), 'val');
  const result = {};
  if (jc !== undefined) result.align = alignment(jc === 'both' ? 'justify' : jc === 'start' ? 'left' : jc === 'end' ? 'right' : jc);
  if (child(node, 'pageBreakBefore')) result.pageBreakBefore = toggle(child(node, 'pageBreakBefore'));
  const spacing = child(node, 'spacing');
  if (spacing && Object.entries(spacing.attrs).some(([key, value]) => !['line', 'lineRule'].includes(key.split(':').at(-1)) && value !== '0')) unsupported('Custom paragraph spacing is unsupported.');
  if (spacing && (attr(spacing, 'lineRule') && attr(spacing, 'lineRule') !== 'auto' || attr(spacing, 'line') && attr(spacing, 'line') !== '240')) unsupported('Custom line spacing is unsupported.');
  for (const key of ['keepNext', 'keepLines']) if (child(node, key) && toggle(child(node, key))) unsupported('Paragraph pagination rules are unsupported.');
  return result;
}
function stylesReader(parts, relationships, themes) {
  const rel = [...relationships.values()].find(r => r.type.endsWith('/styles'));
  let defaults = {}, defaultParagraph, defaultCharacter;
  const styles = new Map(), cache = new Map();
  if (rel) {
    const root = getXML(parts, rel.path), docDefaults = child(root, 'docDefaults');
    defaults = { ...readRunProperties(child(child(docDefaults, 'rPrDefault'), 'rPr'), themes), ...readParagraphProperties(child(child(docDefaults, 'pPrDefault'), 'pPr')) };
    for (const style of children(root, 'style')) {
      const id = attr(style, 'styleId');
      if (!id || styles.has(id)) invalid('Invalid document style IDs.');
      styles.set(id, style);
      if (attr(style, 'default') === '1' || attr(style, 'default') === 'true') {
        if (attr(style, 'type') === 'paragraph') defaultParagraph = id;
        if (attr(style, 'type') === 'character') defaultCharacter = id;
      }
    }
  }
  function resolve(id, trail = new Set()) {
    if (!id) return {};
    if (cache.has(id)) return cache.get(id);
    if (trail.has(id) || trail.size > 32) invalid('Cyclic document style inheritance.');
    const style = styles.get(id);
    if (!style) unsupported(`Missing referenced document style: ${id}.`);
    trail.add(id);
    const result = { ...resolve(attr(child(style, 'basedOn'), 'val'), trail), ...readRunProperties(child(style, 'rPr'), themes), ...readParagraphProperties(child(style, 'pPr')) };
    trail.delete(id);
    cache.set(id, result);
    return result;
  }
  return { defaults, resolve, defaultParagraph, defaultCharacter };
}
function readPage(body) {
  const sections = children(body, 'sectPr');
  if (sections.length > 1 || descendants(body, 'sectPr').length !== sections.length) unsupported('Multiple document sections are unsupported.');
  const sect = sections[0];
  if (sect && body.children.at(-1) !== sect) invalid('Section properties must end the document body.');
  allowed(sect, ['pgSz', 'pgMar', 'cols', 'docGrid', 'type'], 'page layout');
  const columns = child(sect, 'cols');
  if (columns && (xmlNumber(columns, 'num', 1) !== 1 || children(columns, 'col').length)) unsupported('Multi-column pages are unsupported.');
  const grid = child(sect, 'docGrid');
  if (grid && attr(grid, 'type') && attr(grid, 'type') !== 'default') unsupported('Document grid layouts are unsupported.');
  const mar = child(sect, 'pgMar');
  if (xmlNumber(mar, 'gutter', 0) !== 0) unsupported('Page gutters are unsupported.');
  const margin = {};
  for (const side of ['top', 'right', 'bottom', 'left']) margin[side] = xmlNumber(mar, side, 72, 20);
  return pageLayout({ width: xmlNumber(child(sect, 'pgSz'), 'w', 612, 20), height: xmlNumber(child(sect, 'pgSz'), 'h', 792, 20), margin });
}
function readDrawing(drawing, environment) {
  const { parts, relationships, mediaCache } = environment;
  allowed(drawing, ['inline'], 'drawing placement');
  const inline = child(drawing, 'inline');
  if (!inline || children(drawing, 'inline').length !== 1) unsupported('Only inline image/chart drawings are supported.');
  allowed(inline, ['extent', 'effectExtent', 'docPr', 'cNvGraphicFramePr', 'graphic'], 'inline drawing');
  for (const key of ['distT', 'distB', 'distL', 'distR']) if (xmlNumber(inline, key, 0) !== 0) unsupported('Custom image/chart wrapping distances are unsupported.');
  const effects = child(inline, 'effectExtent');
  for (const key of ['l', 't', 'r', 'b']) if (xmlNumber(effects, key, 0) !== 0) unsupported('Image/chart effect extents are unsupported.');
  const extent = child(inline, 'extent');
  const width = number(xmlNumber(extent, 'cx', undefined, 12700), undefined, 0.05, 1584);
  const height = number(xmlNumber(extent, 'cy', undefined, 12700), undefined, 0.05, 1584);
  const data = child(child(inline, 'graphic'), 'graphicData');
  function relationship(id, kind) {
    const r = relationships.get(id);
    if (!r || !r.type.endsWith('/' + kind) || !parts[r.path]) invalid('Drawing relationship is missing or has the wrong type.');
    if (r.external) unsupported('External image/chart relationships are unsupported.');
    return r.path;
  }
  if (attr(data, 'uri') === XMLNS.c && data.children.length === 1 && child(data, 'chart')) {
    const path = relationship(attr(child(data, 'chart'), 'id'), 'chart');
    for (const r of readRels(parts, path).values()) if (r.external) unsupported('External chart data is unsupported.');
    const chart = readChart(parts, path);
    if (chart.series?.length > 1) unsupported('Only single-series DOCX charts are supported.');
    if (descendants(getXML(parts, path), 'ser').some(series => nodeText(child(series, 'tx')).trim())) unsupported('Named chart series are unsupported in DOCX.');
    return { type: 'chart', ...chart, width, height };
  }
  if (attr(data, 'uri') !== XMLNS.pic || data.children.length !== 1 || !child(data, 'pic')) unsupported('Only embedded picture and chart drawings are supported.');
  const picture = child(data, 'pic');
  allowed(picture, ['nvPicPr', 'blipFill', 'spPr'], 'picture');
  const fill = child(picture, 'blipFill');
  allowed(fill, ['blip', 'stretch'], 'picture fill');
  const rectangle = child(child(fill, 'stretch'), 'fillRect');
  if (!rectangle || children(fill, 'blip').length !== 1 || Object.keys(rectangle.attrs).length) unsupported('Cropped/tiled image fills are unsupported.');
  const blip = child(fill, 'blip');
  if (attr(blip, 'link') || blip.children.length) unsupported('Linked images and image effects are unsupported.');
  const sp = child(picture, 'spPr');
  allowed(sp, ['xfrm', 'prstGeom'], 'picture transforms');
  const transform = child(sp, 'xfrm');
  if (xmlNumber(transform, 'rot', 0) !== 0 || ['flipH', 'flipV'].some(key => ['1', 'true'].includes(attr(transform, key)))) unsupported('Rotated/flipped images are unsupported.');
  const offset = child(transform, 'off');
  if (xmlNumber(offset, 'x', 0) !== 0 || xmlNumber(offset, 'y', 0) !== 0) unsupported('Offset picture transforms are unsupported.');
  const transformExtent = child(transform, 'ext');
  if (transformExtent && (xmlNumber(transformExtent, 'cx', undefined, 12700) !== width || xmlNumber(transformExtent, 'cy', undefined, 12700) !== height)) unsupported('Image transform and display dimensions must agree.');
  if (attr(child(sp, 'prstGeom'), 'prst') !== 'rect') unsupported('Nonrectangular image geometry is unsupported.');
  const path = relationship(attr(blip, 'embed'), 'image');
  let image = mediaCache.get(path);
  if (!image) {
    const type = imageMime(parts, path);
    const content = dataURL(parts[path], type);
    imageData(content);
    image = { content, mime: type };
    mediaCache.set(path, image);
  }
  return { type: 'image', ...image, width, height };
}
function imageMime(parts, path) {
  const types = getXML(parts, '[Content_Types].xml');
  const override = children(types, 'Override').find(n => attr(n, 'PartName') === '/' + path);
  const extension = path.split('.').at(-1).toLowerCase();
  const defaultType = children(types, 'Default').find(n => attr(n, 'Extension')?.toLowerCase() === extension);
  const mime = attr(override ?? defaultType, 'ContentType');
  if (!['image/png', 'image/jpeg'].includes(mime)) unsupported('Only PNG and JPEG image parts are supported.');
  return mime;
}
function readParagraph(p, environment, allowDrawing = true) {
  allowed(p, ['pPr', 'r', 'bookmarkStart', 'bookmarkEnd', 'proofErr'], 'paragraph content');
  const { styles, themes } = environment;
  const props = child(p, 'pPr');
  const inherited = { font: 'Calibri', size: 11, bold: false, italic: false, underline: false, color: '#000000', ...styles.defaults, ...styles.resolve(attr(child(props, 'pStyle'), 'val') ?? styles.defaultParagraph), ...readParagraphProperties(props) };
  const runs = [], drawings = [];
  for (const r of children(p, 'r')) {
    allowed(r, ['rPr', 't', 'tab', 'br', 'cr', 'drawing', 'lastRenderedPageBreak'], 'run content');
    const rpr = child(r, 'rPr');
    const style = { ...inherited, ...styles.resolve(attr(child(rpr, 'rStyle'), 'val') ?? styles.defaultCharacter), ...readRunProperties(rpr, themes) };
    let value = '';
    for (const item of r.children) {
      const name = local(item);
      if (name === 't') value += nodeText(item);
      if (name === 'tab') value += '\t';
      if (name === 'cr') value += '\n';
      if (name === 'br') {
        if (attr(item, 'type') && attr(item, 'type') !== 'textWrapping' || attr(item, 'clear') && attr(item, 'clear') !== 'none') unsupported('Page/column breaks and wrapping rules are unsupported.');
        value += '\n';
      }
      if (name === 'drawing') {
        if (!allowDrawing) unsupported('Drawings in table cells are unsupported.');
        drawings.push(readDrawing(item, environment));
      }
    }
    if (value || !children(r, 'drawing').length) runs.push({ text: value, ...format(style) });
  }
  if (drawings.length) {
    if (runs.some(r => r.text.length)) unsupported('Mixed inline drawings and paragraph text cannot be represented without loss.');
    if (inherited.align && inherited.align !== 'left') unsupported('Aligned image/chart paragraphs are unsupported.');
    if (inherited.pageBreakBefore) unsupported('Page breaks before image/chart paragraphs are unsupported.');
    return drawings;
  }
  return [{ type: 'paragraph', align: inherited.align ?? 'left', ...(inherited.pageBreakBefore !== undefined ? { pageBreakBefore: inherited.pageBreakBefore } : {}), runs: runs.length ? runs : [{ text: '', ...format(inherited) }] }];
}
function readTable(table, environment) {
  allowed(table, ['tblPr', 'tblGrid', 'tr'], 'table content');
  const properties = child(table, 'tblPr');
  allowed(properties, ['tblW', 'tblBorders', 'tblLayout', 'tblLook'], 'table formatting');
  const borders = child(properties, 'tblBorders');
  const borderStyles = Object.fromEntries(['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => [side, attr(child(borders, side), 'val') ?? 'nil']));
  const width = child(properties, 'tblW');
  if (width && (attr(width, 'type') !== 'auto' || xmlNumber(width, 'w', 0) !== 0)) unsupported('Custom table widths are unsupported.');
  const layout = attr(child(properties, 'tblLayout'), 'type') ?? 'autofit';
  if (!['fixed', 'autofit'].includes(layout)) unsupported('Unsupported table layout.');
  for (const border of borders?.children ?? []) {
    if (!['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].includes(local(border)) || attr(border, 'themeColor') || attr(border, 'themeTint') || attr(border, 'themeShade') || xmlNumber(border, 'space', 0) !== 0 || ['frame', 'shadow'].some(key => ['1', 'true', 'on'].includes(attr(border, key)))) unsupported('Custom table border effects are unsupported.');
    if (!['single', 'nil', 'none'].includes(attr(border, 'val')) || attr(border, 'color') && !['000000', 'auto'].includes(attr(border, 'color')) || attr(border, 'sz') && attr(border, 'sz') !== '4') unsupported('Custom table border formatting is unsupported.');
  }
  const rows = children(table, 'tr');
  if (!rows.length || rows.length > 1000) unsupported('Empty or oversized tables are unsupported.');
  const columnWidths = children(child(table, 'tblGrid'), 'gridCol').map(col => number(xmlNumber(col, 'w', undefined, 20), undefined, 0.05, 1584));
  const result = rows.map(row => {
    allowed(row, ['trPr', 'tc'], 'table row');
    allowed(child(row, 'trPr'), [], 'table row formatting');
    return children(row, 'tc').map((cell, index) => {
      allowed(cell, ['tcPr', 'p'], 'table cell');
      allowed(child(cell, 'tcPr'), ['tcW'], 'table cell formatting');
      const cellWidth = child(child(cell, 'tcPr'), 'tcW');
      if (cellWidth) {
        const type = attr(cellWidth, 'type') ?? 'dxa';
        const value = xmlNumber(cellWidth, 'w', 0, 20);
        if (!(type === 'auto' && value === 0) && !(type === 'dxa' && columnWidths[index] === value)) unsupported('Cell widths inconsistent with the table grid are unsupported.');
      }
      const paragraphs = children(cell, 'p').map(p => readParagraph(p, environment, false)[0]);
      if (!paragraphs.length) invalid('A table cell must contain a paragraph.');
      return { text: paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'), paragraphs };
    });
  });
  const columns = result[0].length;
  if (!columns || columns > 100 || result.some(row => row.length !== columns) || columnWidths.length && columnWidths.length !== columns) unsupported('Merged or nonrectangular tables are unsupported.');
  return { type: 'table', rows: result, borders: borderStyles, layout, ...(columnWidths.length ? { columnWidths } : {}) };
}

export function decodeDOCX(content) {
  if (typeof content === 'string' && /^data:application\/(?:vnd\.apple\.pages|x-iwork-pages-sffpages);/i.test(content)) unsupported('Native Pages packages are unsupported; export a genuine DOCX file first.');
  const parts = unpack(content, 'docx');
  const types = getXML(parts, '[Content_Types].xml');
  const mainType = children(types, 'Override').find(n => attr(n, 'PartName') === '/' + MAIN);
  if (attr(mainType, 'ContentType') !== MAIN_TYPE) unsupported('Only nonmacro DOCX documents are supported; native Pages packages are not DOCX.');
  const roots = readRels(parts, '');
  const main = [...roots.values()].filter(r => r.type.endsWith('/officeDocument'));
  if (main.length !== 1 || main[0].external || main[0].path !== MAIN) invalid('Invalid Word main-document relationship.');
  const relationships = readRels(parts, MAIN);
  const permitted = ['styles', 'theme', 'settings', 'fontTable', 'webSettings', 'image', 'chart', 'numbering'];
  for (const r of relationships.values()) {
    if (r.external) unsupported('External document relationships are unsupported.');
    if (!permitted.some(type => r.type.endsWith('/' + type))) unsupported(`Unsupported Word document relationship: ${r.type}.`);
    if (!parts[r.path]) invalid('A document relationship references a missing part.');
  }
  const root = getXML(parts, MAIN);
  if (local(root) !== 'document') invalid('Invalid Word document root.');
  const prefix = root.name.includes(':') ? root.name.split(':')[0] : '';
  if (root.attrs[prefix ? `xmlns:${prefix}` : 'xmlns'] !== XMLNS.w) unsupported('Unsupported WordprocessingML namespace.');
  allowed(root, ['body'], 'document structure');
  const body = child(root, 'body');
  if (!body || children(root, 'body').length !== 1) invalid('Word document requires one body.');
  allowed(body, ['p', 'tbl', 'sectPr'], 'document body');
  const themes = themeValues(parts, relationships);
  const environment = { parts, relationships, themes, mediaCache: new Map(), styles: stylesReader(parts, relationships, themes) };
  const page = readPage(body);
  const blocks = [];
  for (const item of body.children) {
    if (local(item) === 'p') blocks.push(...readParagraph(item, environment));
    if (local(item) === 'tbl') blocks.push(readTable(item, environment));
    if (blocks.length > MAX_BLOCKS) fail('limit_exceeded', 'Decoded document has too many blocks.');
  }
  const core = [...roots.values()].find(r => r.type.endsWith('/metadata/core-properties'));
  if (core?.external) unsupported('External core properties are unsupported.');
  const titleNode = core ? child(getXML(parts, core.path), 'title') : undefined;
  const title = titleNode ? nodeText(titleNode) : 'Untitled';
  const paragraphs = [], tables = [], images = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const first = block.runs[0] ?? {};
      paragraphs.push({ id: `paragraph-${paragraphs.length + 1}`, text: block.runs.map(run => run.text).join(''), runs: block.runs.map(run => ({ ...run })), style: {
        fontFamily: first.font ?? 'Calibri', fontSize: first.size ?? 11,
        bold: first.bold ?? false, italic: first.italic ?? false, underline: first.underline ?? false,
        color: first.color ?? '#000000', align: block.align,
        ...(block.pageBreakBefore !== undefined ? { pageBreakBefore: block.pageBreakBefore } : {}),
      } });
    }
    if (block.type === 'table') tables.push({ id: `table-${tables.length + 1}`, rows: block.rows.map(row => row.map(cell => cell.text)) });
    if (block.type === 'image') images.push({ id: `image-${images.length + 1}`, content: block.content, mime: block.mime, width: block.width, height: block.height });
  }
  return { title, page, blocks, paragraphs, tables, images };
}

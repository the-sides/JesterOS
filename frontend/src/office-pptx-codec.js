import {
  XMLNS, xmlHeader, xml, fail, pack, unpack, getXML, putXML, rels,
  readRels, contentTypes, rootRels, children, child, descendants, nodeText,
  attr, imageData, dataURL, addChart, readChart,
} from './office-xml-common.js';

// PresentationML/OPC, not an application-state container. Geometry is points.
// Schema references: https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document
// https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.transition.duration
const EMU = 12700;
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const namespaces = `xmlns:p="${XMLNS.p}" xmlns:a="${XMLNS.a}" xmlns:r="${XMLNS.r}"`;
const ptType = suffix => `application/vnd.openxmlformats-officedocument.presentationml.${suffix}+xml`;
const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const mapOverride = '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';
const treeHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const local = node => node?.name?.split(':').at(-1);
const unsupported = message => fail('unsupported_content', message);
const invalid = message => fail('invalid_format', message);
const relationshipID = node => Object.entries(node?.attrs ?? {}).find(([key]) => key.includes(':') && key.split(':').at(-1) === 'id')?.[1];

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value;
}
function number(value, fallback, label, min = 0, max = 100000) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) invalid(`${label} is outside its supported bounds.`);
  return n;
}
function text(value, label = 'Text') {
  if (value === undefined) return '';
  if (typeof value !== 'string') invalid(`${label} must be a string.`);
  if (value.length > 2000000) fail('limit_exceeded', `${label} is too long.`);
  return value;
}
function color(value, fallback) {
  const c = value === undefined ? fallback : value;
  if (c === 'none') return c;
  if (typeof c !== 'string' || !/^#[a-f\d]{6}$/i.test(c)) unsupported('Only solid six-digit RGB colors are supported.');
  return c.toUpperCase();
}
const fillXML = c => c === 'none' ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${c.slice(1)}"/></a:solidFill>`;
function geometry(object) {
  return {
    x: number(object.x, 0, 'Object x', -100000), y: number(object.y, 0, 'Object y', -100000),
    width: number(object.width, 200, 'Object width'), height: number(object.height, 100, 'Object height'),
  };
}
const transform = g => `<a:xfrm><a:off x="${Math.round(g.x * EMU)}" y="${Math.round(g.y * EMU)}"/><a:ext cx="${Math.round(g.width * EMU)}" cy="${Math.round(g.height * EMU)}"/></a:xfrm>`;
function basicStyle(run, defaults = {}) {
  const merged = { ...defaults, ...run };
  for (const key of ['bold', 'italic', 'underline']) if (merged[key] !== undefined && typeof merged[key] !== 'boolean') invalid(`${key} must be boolean.`);
  return {
    font: text(run.font ?? run.fontFamily ?? defaults.font ?? defaults.fontFamily ?? 'Arial', 'Font'),
    size: number(run.size ?? run.fontSize ?? defaults.size ?? defaults.fontSize, 24, 'Font size', 1, 400),
    color: color(merged.color, '#000000'), bold: merged.bold ?? false,
    italic: merged.italic ?? false, underline: merged.underline ?? false,
  };
}
function runXML(run, defaults) {
  record(run, 'Text run');
  const style = basicStyle(run, defaults);
  if (style.color === 'none') unsupported('Text color cannot be transparent.');
  return `<a:r><a:rPr lang="en-US" sz="${Math.round(style.size * 100)}" b="${style.bold ? 1 : 0}" i="${style.italic ? 1 : 0}" u="${style.underline ? 'sng' : 'none'}">${fillXML(style.color)}<a:latin typeface="${xml(style.font)}"/></a:rPr><a:t xml:space="preserve">${xml(text(run.text))}</a:t></a:r>`;
}
function textBody(object) {
  const align = object.align ?? 'left';
  const alignment = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[align];
  if (!alignment) unsupported('Unsupported text alignment.');
  let runs = object.runs === undefined ? [{ text: text(object.text) }] : object.runs;
  if (!Array.isArray(runs) || runs.length > 10000) fail('limit_exceeded', 'Text runs must be a bounded array.');
  if (!runs.length) runs = [{ text: text(object.text) }];
  // Paragraphs, not XML text newlines, determine DrawingML line layout.
  const paragraphs = [[]];
  for (const run of runs) {
    record(run, 'Text run');
    const lines = text(run.text).split('\n');
    lines.forEach((line, i) => {
      if (i) paragraphs.push([]);
      paragraphs.at(-1).push({ ...run, text: line });
    });
  }
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphs.map(r => `<a:p><a:pPr algn="${alignment}"/>${r.map(run => runXML(run, object)).join('')}<a:endParaRPr lang="en-US"/></a:p>`).join('')}</p:txBody>`;
}
function nonvisual(tag, id, object, extra = '') {
  return `<p:nv${tag}Pr><p:cNvPr id="${id}" name="${xml(text(object.id ?? object.name ?? `Object ${id}`, 'Object identifier'))}"/><p:cNv${tag}Pr${extra}/><p:nvPr/></p:nv${tag}Pr>`;
}
function transitionXML(slide) {
  const transition = slide.transition ?? 'none';
  if (typeof transition !== 'string') record(transition, 'Transition');
  const type = typeof transition === 'string' ? transition : transition.type;
  if (!['none', 'fade', 'push', 'wipe'].includes(type)) unsupported('Only none, fade, push and wipe transitions are supported.');
  const duration = number(typeof transition === 'object' ? transition.duration ?? slide.transitionDuration : slide.transitionDuration, type === 'none' ? 0 : 0.5, 'Transition duration', 0, 60);
  if (type === 'none') {
    if (duration) unsupported('A none transition cannot have a duration.');
    return '';
  }
  return `<p:transition spd="${duration <= 0.5 ? 'fast' : duration <= 1 ? 'med' : 'slow'}" p14:dur="${Math.round(duration * 1000)}"><p:${type}${type === 'fade' ? '' : ' dir="l"'}/></p:transition>`;
}
function themeXML() {
  const palette = { dk1: '000000', lt1: 'FFFFFF', dk2: '1F497D', lt2: 'EEECE1', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0000FF', folHlink: '800080' };
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/></a:ln>`;
  const font = name => `<a:${name}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:${name}>`;
  return `${xmlHeader}<a:theme xmlns:a="${XMLNS.a}" name="Local Office"><a:themeElements><a:clrScheme name="Local Office">${Object.entries(palette).map(([key, value]) => `<a:${key}><a:srgbClr val="${value}"/></a:${key}>`).join('')}</a:clrScheme><a:fontScheme name="Local Office">${font('majorFont')}${font('minorFont')}</a:fontScheme><a:fmtScheme name="Local Office"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

export function encodePPTX(input) {
  const deck = record(input, 'Presentation');
  if (!Array.isArray(deck.slides) || deck.slides.length > 1024) fail('limit_exceeded', 'Presentation requires a bounded slides array.');
  const width = number(deck.width, 960, 'Slide width', 1), height = number(deck.height, 540, 'Slide height', 1);
  const parts = {}, overrides = [];
  const put = (path, source, type) => { putXML(parts, path, source); if (type) overrides.push({ path, type }); };
  put('_rels/.rels', rootRels('ppt/presentation.xml'));
  put('docProps/core.xml', `${xmlHeader}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(text(deck.title))}</dc:title></cp:coreProperties>`, 'application/vnd.openxmlformats-package.core-properties+xml');
  put('ppt/theme/theme1.xml', themeXML(), 'application/vnd.openxmlformats-officedocument.theme+xml');
  put('ppt/presProps.xml', `${xmlHeader}<p:presentationPr ${namespaces}/>`, ptType('presProps'));
  put('ppt/slideMasters/slideMaster1.xml', `${xmlHeader}<p:sldMaster ${namespaces}><p:cSld><p:spTree>${treeHead}</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`, ptType('slideMaster'));
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]));
  put('ppt/slideLayouts/slideLayout1.xml', `${xmlHeader}<p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${treeHead}</p:spTree></p:cSld>${mapOverride}</p:sldLayout>`, ptType('slideLayout'));
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
  const presentationRels = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }, { id: 'rIdProps', type: 'presProps', target: 'presProps.xml' }];
  const hasNotes = deck.slides.some(s => s?.notes !== undefined && s.notes !== '');
  if (hasNotes) {
    put('ppt/notesMasters/notesMaster1.xml', `${xmlHeader}<p:notesMaster ${namespaces}><p:cSld><p:spTree>${treeHead}</p:spTree></p:cSld>${clrMap}<p:notesStyle/></p:notesMaster>`, ptType('notesMaster'));
    put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: 'theme', target: '../theme/theme1.xml' }]));
    presentationRels.push({ id: 'rIdNotes', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
  }
  let objectCount = 0, imageCount = 0, chartCount = 0;
  const slideIDs = [];
  deck.slides.forEach((slideValue, index) => {
    const slide = record(slideValue, 'Slide'), n = index + 1;
    if (!Array.isArray(slide.objects) || (objectCount += slide.objects.length) > 10000) fail('limit_exceeded', 'Slides require bounded object arrays.');
    const path = `ppt/slides/slide${n}.xml`, relations = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    const drawings = slide.objects.map((value, i) => {
      const object = record(value, 'Slide object'), id = i + 2, g = geometry(object);
      if (object.rotation || object.flipH || object.flipV) unsupported('Rotated and flipped objects are not supported.');
      if (object.type === 'text' || object.type === 'shape') {
        const isText = object.type === 'text';
        const preset = isText ? 'rect' : { rect: 'rect', rectangle: 'rect', ellipse: 'ellipse', triangle: 'triangle', line: 'line' }[object.shape];
        if (!preset) unsupported('Unsupported shape geometry.');
        const fill = color(object.fill, isText || preset === 'line' ? 'none' : '#4472C4');
        const stroke = color(object.stroke, isText ? 'none' : '#000000');
        const body = isText || object.text !== undefined || object.runs !== undefined ? textBody(object) : '';
        return `<p:sp>${nonvisual('Sp', id, object, isText ? ' txBox="1"' : '')}<p:spPr>${transform(g)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fillXML(fill)}<a:ln w="${Math.round(number(object.strokeWidth, 1, 'Stroke width', 0, 100) * EMU)}">${fillXML(stroke)}</a:ln></p:spPr>${body}</p:sp>`;
      }
      if (object.type === 'image') {
        const image = imageData(object.content), imagePath = `ppt/media/image${++imageCount}.${image.extension}`;
        parts[imagePath] = image.bytes;
        const rid = `rId${relations.length + 1}`;
        relations.push({ id: rid, type: 'image', target: `../media/image${imageCount}.${image.extension}` });
        return `<p:pic>${nonvisual('Pic', id, object)}<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(g)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      }
      if (object.type === 'chart') {
        if (object.series !== undefined) unsupported('PPTX charts require the canonical single labels/values series.');
        const chartPath = `ppt/charts/chart${++chartCount}.xml`;
        addChart(parts, chartPath, object);
        overrides.push({ path: chartPath, type: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml' });
        const rid = `rId${relations.length + 1}`;
        relations.push({ id: rid, type: 'chart', target: `../charts/chart${chartCount}.xml` });
        return `<p:graphicFrame>${nonvisual('GraphicFrame', id, object)}<p:xfrm><a:off x="${Math.round(g.x * EMU)}" y="${Math.round(g.y * EMU)}"/><a:ext cx="${Math.round(g.width * EMU)}" cy="${Math.round(g.height * EMU)}"/></p:xfrm><a:graphic><a:graphicData uri="${XMLNS.c}"><c:chart xmlns:c="${XMLNS.c}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
      }
      unsupported(`Unsupported slide object ${String(object.type)}; audio/video must not be exported as fake media.`);
    }).join('');
    const notes = text(slide.notes, 'Slide notes');
    if (notes) {
      const notesPath = `ppt/notesSlides/notesSlide${n}.xml`;
      relations.push({ id: `rId${relations.length + 1}`, type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` });
      const body = textBody({ text: notes, size: 12 });
      put(notesPath, `${xmlHeader}<p:notes ${namespaces}><p:cSld><p:spTree>${treeHead}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${transform({ x: 36, y: 300, width: 648, height: 360 })}</p:spPr>${body}</p:sp></p:spTree></p:cSld>${mapOverride}</p:notes>`, ptType('notesSlide'));
      put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` }]));
    }
    const background = color(slide.background, '#FFFFFF');
    if (background === 'none') unsupported('Slide background cannot be transparent.');
    put(path, `${xmlHeader}<p:sld ${namespaces} xmlns:p14="${P14}" xmlns:mc="${MC}" mc:Ignorable="p14"><p:cSld name="${xml(text(slide.name ?? `Slide ${n}`))}"><p:bg><p:bgPr>${fillXML(background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${treeHead}${drawings}</p:spTree></p:cSld>${mapOverride}${transitionXML(slide)}</p:sld>`, ptType('slide'));
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(relations));
    const rid = `rIdSlide${n}`;
    presentationRels.push({ id: rid, type: 'slide', target: `slides/slide${n}.xml` });
    slideIDs.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
  });
  put('ppt/presentation.xml', `${xmlHeader}<p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotes"/></p:notesMasterIdLst>' : ''}<p:sldIdLst>${slideIDs.join('')}</p:sldIdLst><p:sldSz cx="${Math.round(width * EMU)}" cy="${Math.round(height * EMU)}" type="custom"/><p:notesSz cx="9144000" cy="6858000"/><p:defaultTextStyle/></p:presentation>`, ptType('presentation.main'));
  put('ppt/_rels/presentation.xml.rels', rels(presentationRels));
  put('[Content_Types].xml', contentTypes(overrides));
  return pack(parts, 'pptx');
}

function relation(map, id, kind) {
  const rel = map.get(id);
  if (!rel || !rel.type.endsWith(`/${kind}`)) invalid(`Missing ${kind} relationship.`);
  if (rel.external) unsupported(`External ${kind} content is not supported.`);
  return rel.path;
}
function numericAttr(node, key, fallback) {
  const raw = attr(node, key);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(Number(raw))) invalid(`Invalid DrawingML ${key}.`);
  return Number(raw);
}
function readGeometry(node) {
  const xfrm = child(node, 'xfrm');
  if (!xfrm) unsupported('Inherited placeholder geometry is not supported.');
  if (numericAttr(xfrm, 'rot', 0) || ['flipH', 'flipV'].some(k => ['1', 'true'].includes(attr(xfrm, k)))) unsupported('Rotated/flipped shapes are not supported.');
  const off = child(xfrm, 'off'), ext = child(xfrm, 'ext');
  return geometry({ x: numericAttr(off, 'x') / EMU, y: numericAttr(off, 'y') / EMU, width: numericAttr(ext, 'cx') / EMU, height: numericAttr(ext, 'cy') / EMU });
}
function readColor(fill, fallback) {
  if (!fill) return fallback;
  const rgb = child(fill, 'srgbClr');
  if (!rgb || rgb.children.length) unsupported('Theme/transformed colors require an unsupported color model.');
  return color(`#${attr(rgb, 'val')}`);
}
function readFill(node, fallback) {
  if (child(node, 'noFill')) return 'none';
  if (['gradFill', 'pattFill', 'blipFill', 'grpFill'].some(k => child(node, k))) unsupported('Only solid fills are supported.');
  return readColor(child(node, 'solidFill'), fallback);
}
function readStyle(node, defaults = {}) {
  const result = { ...defaults };
  for (const key of ['b', 'i']) {
    const value = attr(node, key);
    if (value !== undefined) {
      if (!['0', '1', 'true', 'false'].includes(value)) invalid('Invalid text boolean.');
      result[key === 'b' ? 'bold' : 'italic'] = value === '1' || value === 'true';
    }
  }
  const underline = attr(node, 'u');
  if (underline !== undefined) {
    if (!['sng', 'none'].includes(underline)) unsupported('Only single underline is supported.');
    result.underline = underline === 'sng';
  }
  if (attr(node, 'sz') !== undefined) result.size = number(numericAttr(node, 'sz') / 100, 24, 'Font size', 1, 400);
  const latin = child(node, 'latin');
  if (latin) {
    result.font = attr(latin, 'typeface');
    if (!result.font || result.font.startsWith('+')) unsupported('Inherited theme fonts are not supported.');
  }
  if (child(node, 'solidFill')) result.color = readColor(child(node, 'solidFill'));
  if (child(node, 'noFill')) unsupported('Transparent text is unsupported.');
  for (const key of ['strike', 'baseline', 'spc', 'cap']) if (attr(node, key) !== undefined && !['0', 'noStrike', 'none'].includes(attr(node, key))) unsupported(`Unsupported text property ${key}.`);
  if (node?.children.some(n => ['hlinkClick', 'hlinkMouseOver', 'gradFill', 'pattFill', 'effectLst', 'effectDag', 'highlight'].includes(local(n)))) unsupported('Unsupported text effects or hyperlinks.');
  return result;
}
function readTextBody(body) {
  if (!body) return { text: '', runs: [] };
  const bodyPr = child(body, 'bodyPr');
  if (numericAttr(bodyPr, 'rot', 0) || (attr(bodyPr, 'vert') && attr(bodyPr, 'vert') !== 'horz')) unsupported('Vertical or rotated text is unsupported.');
  const paragraphs = children(body, 'p'), runs = [];
  let align;
  const listStyle = child(body, 'lstStyle');
  const baseStyle = readStyle(child(child(listStyle, 'lvl1pPr'), 'defRPr'), { font: 'Arial', size: 24, color: '#000000', bold: false, italic: false, underline: false });
  paragraphs.forEach((paragraph, i) => {
    const pPr = child(paragraph, 'pPr');
    if (pPr?.children.some(n => ['buChar', 'buAutoNum', 'buBlip', 'tabLst'].includes(local(n)))) unsupported('Bullets and tabs are unsupported.');
    const a = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[attr(pPr, 'algn') ?? 'l'];
    if (!a || (align && align !== a)) unsupported('Mixed/unsupported paragraph alignments are unsupported.');
    align = a;
    const defaults = readStyle(child(pPr, 'defRPr'), baseStyle);
    if (i) runs.push({ ...defaults, text: '\n' });
    for (const item of paragraph.children) {
      if (local(item) === 'r') runs.push({ ...readStyle(child(item, 'rPr'), defaults), text: nodeText(child(item, 't')) });
      else if (local(item) === 'br') runs.push({ ...readStyle(child(item, 'rPr'), defaults), text: '\n' });
      else if (!['pPr', 'endParaRPr'].includes(local(item))) unsupported('Unsupported text paragraph content.');
    }
  });
  const style = runs.length ? basicStyle(runs[0], baseStyle) : baseStyle;
  return { ...style, fontFamily: style.font, fontSize: style.size, text: runs.map(r => r.text).join(''), runs, align: align ?? 'left' };
}
function rejectUnsupported(root) {
  for (const name of ['timing', 'videoFile', 'audioFile', 'wavAudioFile', 'media', 'oleObj', 'contentPart', 'grpSp', 'AlternateContent', 'custGeom', 'table', 'tbl', 'hlinkClick', 'hlinkMouseOver', 'sndAc', 'controls']) {
    if (descendants(root, name).length) unsupported(`Unsupported PresentationML ${name}.`);
  }
  for (const effect of descendants(root, 'effectLst')) if (effect.children.length) unsupported('Shape effects are unsupported.');
}
function readTransition(root) {
  const node = child(root, 'transition');
  if (!node) return { transition: 'none', transitionDuration: 0 };
  const effects = node.children;
  if (effects.length !== 1 || !['fade', 'push', 'wipe'].includes(local(effects[0]))) unsupported('Unsupported transition.');
  if (attr(node, 'advTm') !== undefined) unsupported('Automatic slide advancement is unsupported.');
  if (['1', 'true'].includes(attr(effects[0], 'thruBlk'))) unsupported('Fade-through-black transitions are unsupported.');
  const direction = attr(effects[0], 'dir');
  if (direction && direction !== 'l') unsupported('Only left-directed push/wipe transitions are supported.');
  const duration = attr(node, 'dur') === undefined ? { fast: 0.5, med: 1, slow: 2 }[attr(node, 'spd') ?? 'fast'] : numericAttr(node, 'dur') / 1000;
  return { transition: local(effects[0]), transitionDuration: number(duration, 0.5, 'Transition duration', 0, 60) };
}
function readNotes(parts, path, slidePath) {
  const root = getXML(parts, path);
  if (local(root) !== 'notes') invalid('Invalid notes part.');
  rejectUnsupported(root);
  const relations = readRels(parts, path);
  const master = [...relations.values()].find(r => r.type.endsWith('/notesMaster'));
  const sourceSlide = [...relations.values()].find(r => r.type.endsWith('/slide'));
  if (!master || local(getXML(parts, master.path)) !== 'notesMaster' || sourceSlide?.path !== slidePath) invalid('Notes require notes-master and source-slide relationships.');
  const tree = child(child(root, 'cSld'), 'spTree');
  if (tree?.children.some(n => !['nvGrpSpPr', 'grpSpPr', 'sp', 'extLst'].includes(local(n)))) unsupported('Non-text notes objects are unsupported.');
  const bodies = [];
  for (const shape of children(child(child(root, 'cSld'), 'spTree'), 'sp')) {
    const ph = descendants(shape, 'ph')[0], type = attr(ph, 'type');
    if (['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(type)) continue;
    if (type !== 'body' && nodeText(child(shape, 'txBody'))) unsupported('Non-body notes objects are unsupported.');
    if (type === 'body') bodies.push(readTextBody(child(shape, 'txBody')).text);
  }
  return bodies.join('\n');
}

export function decodePPTX(content) {
  const parts = unpack(content, 'pptx');
  // No fetching external media or silently dropping foreign executable objects.
  for (const path of Object.keys(parts)) {
    if (/vbaProject|activeX|embeddings|comments|commentAuthors/i.test(path)) unsupported('Macros, embedded objects and comments are unsupported.');
    if (path.endsWith('.rels')) {
      const root = getXML(parts, path);
      if (children(root, 'Relationship').some(r => attr(r, 'TargetMode') === 'External')) unsupported('External relationships are unsupported.');
    }
  }
  const rootRelations = readRels(parts, '');
  const main = [...rootRelations.values()].find(r => r.type.endsWith('/officeDocument'));
  if (!main || main.external) invalid('Missing presentation package relationship.');
  const presentation = getXML(parts, main.path);
  if (local(presentation) !== 'presentation') invalid('Expected a PresentationML presentation.');
  rejectUnsupported(presentation);
  if (child(presentation, 'custShowLst')) unsupported('Custom slide shows are unsupported.');
  const size = child(presentation, 'sldSz');
  const width = number(numericAttr(size, 'cx') / EMU, 960, 'Slide width', 1), height = number(numericAttr(size, 'cy') / EMU, 540, 'Slide height', 1);
  const presentationRelations = readRels(parts, main.path), ids = children(child(presentation, 'sldIdLst'), 'sldId');
  if (ids.length > 1024) fail('limit_exceeded', 'Too many slides.');
  const masters = children(child(presentation, 'sldMasterIdLst'), 'sldMasterId');
  if (!masters.length) invalid('Presentation requires a slide master.');
  // Visible inherited artwork cannot be flattened without inventing geometry/style.
  const checkTemplate = path => {
    const root = getXML(parts, path);
    rejectUnsupported(root);
    const tree = child(child(root, 'cSld'), 'spTree');
    for (const object of tree?.children ?? []) {
      if (['nvGrpSpPr', 'grpSpPr'].includes(local(object))) continue;
      if (local(object) !== 'sp' || !descendants(object, 'ph').length) unsupported('Visible master/layout artwork is unsupported.');
    }
    return root;
  };
  for (const id of masters) checkTemplate(relation(presentationRelations, relationshipID(id), 'slideMaster'));
  let objectCount = 0;
  const seenSlides = new Set();
  const slides = ids.map((id, index) => {
    const path = relation(presentationRelations, relationshipID(id), 'slide');
    if (seenSlides.has(path)) invalid('Duplicate slide reference.');
    seenSlides.add(path);
    const root = getXML(parts, path);
    if (local(root) !== 'sld') invalid('Invalid slide part.');
    if (attr(root, 'show') === '0' || attr(root, 'show') === 'false') unsupported('Hidden slides are unsupported.');
    rejectUnsupported(root);
    const relations = readRels(parts, path);
    const layouts = [...relations.values()].filter(r => r.type.endsWith('/slideLayout'));
    if (layouts.length !== 1) invalid('Slide requires one layout.');
    const layout = checkTemplate(layouts[0].path);
    if (local(layout) !== 'sldLayout') invalid('Invalid slide layout.');
    const layoutRelations = readRels(parts, layouts[0].path);
    const layoutMasters = [...layoutRelations.values()].filter(r => r.type.endsWith('/slideMaster'));
    if (layoutMasters.length !== 1) invalid('Slide layout requires one master.');
    const master = checkTemplate(layoutMasters[0].path);
    if (local(master) !== 'sldMaster') invalid('Invalid slide master.');
    const common = child(root, 'cSld'), tree = child(common, 'spTree');
    if (!tree) invalid('Slide has no shape tree.');
    const objects = [];
    for (const node of tree.children) {
      const kind = local(node);
      if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(kind)) continue;
      if (++objectCount > 10000) fail('limit_exceeded', 'Too many slide objects.');
      if (descendants(node, 'ph').length) unsupported('Inherited slide placeholders are unsupported.');
      if (child(node, 'style')) unsupported('Theme-derived shape styles are unsupported.');
      const nv = descendants(node, 'cNvPr')[0];
      const identity = text(attr(nv, 'name') ?? attr(nv, 'id'), 'Object identifier');
      if (kind === 'sp' || kind === 'cxnSp') {
        const props = child(node, 'spPr'), preset = attr(child(props, 'prstGeom'), 'prst');
        if (!['rect', 'ellipse', 'triangle', 'line'].includes(preset)) unsupported(`Unsupported shape ${preset}.`);
        if (child(child(props, 'prstGeom'), 'avLst')?.children.length) unsupported('Adjusted shapes are unsupported.');
        const body = child(node, 'txBody'), isText = ['1', 'true'].includes(attr(descendants(node, 'cNvSpPr')[0], 'txBox'));
        const line = child(props, 'ln');
        if (line?.children.some(n => !['solidFill', 'noFill', 'prstDash', 'round', 'bevel', 'miter'].includes(local(n))) || (child(line, 'prstDash') && attr(child(line, 'prstDash'), 'val') !== 'solid')) unsupported('Dashed/arrowed strokes are unsupported.');
        if (descendants(node, 'stCxn').length || descendants(node, 'endCxn').length) unsupported('Connected shapes are unsupported.');
        const object = { id: identity, type: isText ? 'text' : 'shape', ...readGeometry(props), fill: readFill(props, isText ? 'none' : '#4472C4'), stroke: readFill(line, line ? '#000000' : 'none'), strokeWidth: numericAttr(line, 'w', EMU) / EMU };
        if (!isText) object.shape = preset;
        if (body) Object.assign(object, readTextBody(body));
        objects.push(object);
      } else if (kind === 'pic') {
        const props = child(node, 'spPr'), blipFill = child(node, 'blipFill'), blip = child(blipFill, 'blip');
        if (child(props, 'ln') || (child(props, 'prstGeom') && attr(child(props, 'prstGeom'), 'prst') !== 'rect')) unsupported('Image borders and non-rectangular clipping are unsupported.');
        if (child(blipFill, 'srcRect') || !child(blipFill, 'stretch') || blip?.children.length) unsupported('Cropped, tiled or transformed images are unsupported.');
        const imagePath = relation(relations, attr(blip, 'embed'), 'image'), bytes = parts[imagePath];
        if (!bytes) invalid('Missing embedded image.');
        const mime = bytes[0] === 137 ? 'image/png' : 'image/jpeg', imageContent = dataURL(bytes, mime);
        imageData(imageContent);
        objects.push({ id: identity, type: 'image', ...readGeometry(props), content: imageContent, mime });
      } else if (kind === 'graphicFrame') {
        const graphic = child(child(node, 'graphic'), 'graphicData');
        const chart = child(graphic, 'chart');
        if (!chart || attr(graphic, 'uri') !== XMLNS.c) unsupported('Only chart graphic frames are supported.');
        const chartPath = relation(relations, attr(chart, 'id'), 'chart');
        const chartXML = getXML(parts, chartPath);
        if (descendants(chartXML, 'ser').some(series => nodeText(child(series, 'tx')).trim())) unsupported('Named chart series cannot be represented by the PPTX canonical model.');
        const chartData = readChart(parts, chartPath);
        if (chartData.series?.length > 1) unsupported('Multi-series PPTX charts are unsupported.');
        objects.push({ id: identity, type: 'chart', ...readGeometry(node), ...chartData });
      } else unsupported(`Unsupported slide object ${kind}.`);
    }
    const background = child(common, 'bg') ?? child(child(layout, 'cSld'), 'bg') ?? child(child(master, 'cSld'), 'bg');
    if (child(background, 'bgRef')) unsupported('Theme background references are unsupported.');
    const noteRelations = [...relations.values()].filter(r => r.type.endsWith('/notesSlide'));
    if (noteRelations.length > 1) invalid('Duplicate notes slide.');
    return { id: attr(id, 'id') ?? `slide-${index + 1}`, name: attr(common, 'name') ?? `Slide ${index + 1}`, background: readFill(child(background, 'bgPr'), '#FFFFFF'), ...readTransition(root), notes: noteRelations.length ? readNotes(parts, noteRelations[0].path, path) : '', objects };
  });
  const core = [...rootRelations.values()].find(r => r.type.endsWith('/metadata/core-properties'));
  return { title: core ? nodeText(child(getXML(parts, core.path), 'title')) : '', width, height, slides };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePPTX, decodePPTX } from './office-pptx-codec.js';
import {
  unpack, pack, getXML, readRels, descendants, child, children, attr,
  XMLNS, xmlHeader, contentTypes, rootRels, rels,
} from './office-xml-common.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=';
const source = () => ({
  title: 'Résumé & pitch', width: 960, height: 540,
  slides: [{
    id: 'opening', name: 'Opening & overview', background: '#FAFAFA',
    transition: { type: 'fade', duration: 1.25 }, notes: 'Presenter notes\nSecond line <literal>',
    objects: [
      { id: 'headline', type: 'text', x: 20, y: 30, width: 400, height: 80, fontFamily: 'Verdana', fontSize: 32, align: 'center', runs: [{ text: 'Rich & ', bold: true, color: '#CC2200' }, { text: 'plain\nnext', italic: true, underline: true, size: 18 }] },
      ...['rectangle', 'ellipse', 'triangle', 'line'].map((shape, i) => ({ id: shape, type: 'shape', shape, x: 40 + i * 90, y: 140, width: 70, height: 60, fill: shape === 'line' ? 'none' : '#33AA44', stroke: '#223344' })),
      { id: 'photo', type: 'image', x: 460, y: 30, width: 100, height: 100, content: png },
      { id: 'results', type: 'chart', x: 460, y: 150, width: 400, height: 300, kind: 'bar', title: 'Actual results', labels: ['A', 'B'], values: [12, 24] },
    ],
  }, { name: 'Push', objects: [], transition: 'push', transitionDuration: 0.75 },
  { name: 'Wipe', objects: [], transition: { type: 'wipe', duration: 2 } },
  { name: 'Still', objects: [], transition: 'none' }],
});
const partText = (parts, path) => new TextDecoder().decode(parts[path]);
const errorCode = code => error => error.code === code;

test('exports genuine package parts, master/layout/theme and all resolved relationships', () => {
  const encoded = encodePPTX(source());
  assert.equal(encoded.extension, 'pptx');
  assert.equal(encoded.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const parts = unpack(encoded.content, 'pptx');
  assert.ok(!Object.keys(parts).some(path => /json|customXml/i.test(path)));
  for (const [path, root] of [
    ['ppt/presentation.xml', 'presentation'], ['ppt/slideMasters/slideMaster1.xml', 'sldMaster'],
    ['ppt/slideLayouts/slideLayout1.xml', 'sldLayout'], ['ppt/theme/theme1.xml', 'theme'],
    ['ppt/notesMasters/notesMaster1.xml', 'notesMaster'], ['ppt/notesSlides/notesSlide1.xml', 'notes'],
    ['ppt/presProps.xml', 'presentationPr'],
  ]) assert.equal(getXML(parts, path).name.split(':').at(-1), root);
  for (const path of Object.keys(parts).filter(path => path.endsWith('.xml'))) {
    for (const relationship of readRels(parts, path).values()) assert.ok(parts[relationship.path], `${path} -> ${relationship.path}`);
  }
  const slide = getXML(parts, 'ppt/slides/slide1.xml'), slideRelations = readRels(parts, 'ppt/slides/slide1.xml');
  const picture = descendants(slide, 'blip')[0];
  const image = slideRelations.get(attr(picture, 'embed'));
  assert.ok(image.type.endsWith('/image'));
  assert.deepEqual([...parts[image.path].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chart = descendants(slide, 'chart')[0], chartRelationship = slideRelations.get(attr(chart, 'id'));
  assert.ok(chartRelationship.type.endsWith('/chart'));
  assert.equal(descendants(getXML(parts, chartRelationship.path), 'barChart').length, 1);
  assert.equal(descendants(getXML(parts, chartRelationship.path), 'numCache').length, 1);
  const notesRelations = [...readRels(parts, 'ppt/notesSlides/notesSlide1.xml').values()];
  assert.ok(notesRelations.some(row => row.type.endsWith('/notesMaster') && row.path === 'ppt/notesMasters/notesMaster1.xml'));
  assert.ok(notesRelations.some(row => row.type.endsWith('/slide') && row.path === 'ppt/slides/slide1.xml'));
  const size = child(getXML(parts, 'ppt/presentation.xml'), 'sldSz');
  assert.equal(Number(attr(size, 'cx')), 960 * 12700);
  assert.equal(Number(attr(size, 'cy')), 540 * 12700);
});

test('decodes XML rich runs, aliases, shapes, images, chart cache, notes and real transitions', () => {
  const decoded = decodePPTX(encodePPTX(source()).content);
  assert.equal(decoded.title, 'Résumé & pitch');
  assert.equal(decoded.width, 960);
  assert.equal(decoded.height, 540);
  assert.deepEqual(decoded.slides.map(s => [s.transition, s.transitionDuration]), [['fade', 1.25], ['push', 0.75], ['wipe', 2], ['none', 0]]);
  const slide = decoded.slides[0], heading = slide.objects[0];
  assert.equal(slide.notes, 'Presenter notes\nSecond line <literal>');
  assert.equal(slide.name, 'Opening & overview');
  assert.equal(slide.background, '#FAFAFA');
  assert.equal(heading.text, 'Rich & plain\nnext');
  assert.equal(heading.fontSize, 32);
  assert.equal(heading.fontFamily, 'Verdana');
  assert.equal(heading.align, 'center');
  assert.equal(heading.runs[0].bold, true);
  assert.equal(heading.runs[0].color, '#CC2200');
  assert.ok(heading.runs.some(run => run.text === 'plain' && run.size === 18 && run.italic && run.underline));
  assert.deepEqual(slide.objects.slice(1, 5).map(o => o.shape), ['rect', 'ellipse', 'triangle', 'line']);
  assert.equal(slide.objects[5].content, png);
  assert.deepEqual(slide.objects[6].labels, ['A', 'B']);
  assert.deepEqual(slide.objects[6].values, [12, 24]);
  assert.equal(slide.objects[6].title, 'Actual results');
  const again = decodePPTX(encodePPTX(decoded).content);
  assert.equal(again.slides[0].objects[0].text, heading.text);
  assert.equal(again.slides[0].objects[0].fontSize, 32);
  assert.equal(again.slides[0].notes, slide.notes);
});

test('stores transition effects and Office 2010 duration as real schema attributes', () => {
  const parts = unpack(encodePPTX(source()).content, 'pptx');
  for (const [index, type, milliseconds] of [[1, 'fade', 1250], [2, 'push', 750], [3, 'wipe', 2000]]) {
    const transition = child(getXML(parts, `ppt/slides/slide${index}.xml`), 'transition');
    assert.equal(children(transition, type).length, 1);
    assert.equal(transition.attrs['p14:dur'], String(milliseconds));
    assert.ok(partText(parts, `ppt/slides/slide${index}.xml`).includes('mc:Ignorable="p14"'));
  }
  assert.equal(child(getXML(parts, 'ppt/slides/slide4.xml'), 'transition'), undefined);
});

test('reads independently authored PresentationML with alternate namespace prefixes and relative relationships', () => {
  const type = suffix => `application/vnd.openxmlformats-officedocument.presentationml.${suffix}+xml`;
  const ns = `xmlns:q="${XMLNS.p}" xmlns:d="${XMLNS.a}" xmlns:rel="${XMLNS.r}"`;
  const emptyTree = '<q:cSld><q:spTree><q:nvGrpSpPr><q:cNvPr id="1" name=""/><q:cNvGrpSpPr/><q:nvPr/></q:nvGrpSpPr><q:grpSpPr/></q:spTree></q:cSld>';
  const themeFill = '<d:solidFill><d:schemeClr val="phClr"/></d:solidFill>';
  const theme = `${xmlHeader}<d:theme xmlns:d="${XMLNS.a}" name="Independent"><d:themeElements><d:clrScheme name="Independent">${['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((key, i) => `<d:${key}><d:srgbClr val="${i % 2 ? 'FFFFFF' : '000000'}"/></d:${key}>`).join('')}</d:clrScheme><d:fontScheme name="Independent"><d:majorFont><d:latin typeface="Arial"/><d:ea typeface=""/><d:cs typeface=""/></d:majorFont><d:minorFont><d:latin typeface="Arial"/><d:ea typeface=""/><d:cs typeface=""/></d:minorFont></d:fontScheme><d:fmtScheme name="Independent"><d:fillStyleLst>${themeFill.repeat(3)}</d:fillStyleLst><d:lnStyleLst>${`<d:ln w="12700">${themeFill}</d:ln>`.repeat(3)}</d:lnStyleLst><d:effectStyleLst>${'<d:effectStyle><d:effectLst/></d:effectStyle>'.repeat(3)}</d:effectStyleLst><d:bgFillStyleLst>${themeFill.repeat(3)}</d:bgFillStyleLst></d:fmtScheme></d:themeElements></d:theme>`;
  const parts = {
    '_rels/.rels': rootRels('ppt/presentation.xml'),
    'docProps/core.xml': `${xmlHeader}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`,
    'ppt/presentation.xml': `${xmlHeader}<q:presentation ${ns}><q:sldMasterIdLst><q:sldMasterId id="2147483648" rel:id="master"/></q:sldMasterIdLst><q:sldIdLst><q:sldId id="412" rel:id="slide"/></q:sldIdLst><q:sldSz cx="9144000" cy="5143500"/><q:notesSz cx="6858000" cy="9144000"/></q:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([{ id: 'master', type: 'slideMaster', target: 'slideMasters/base.xml' }, { id: 'slide', type: 'slide', target: 'slides/external.xml' }, { id: 'properties', type: 'presProps', target: 'presProps.xml' }]),
    'ppt/presProps.xml': `${xmlHeader}<q:presentationPr ${ns}/>`,
    'ppt/theme/independent.xml': theme,
    'ppt/slideMasters/_rels/base.xml.rels': rels([{ id: 'layout', type: 'slideLayout', target: '../slideLayouts/blank.xml' }, { id: 'theme', type: 'theme', target: '../theme/independent.xml' }]),
    'ppt/slideMasters/base.xml': `${xmlHeader}<q:sldMaster ${ns}>${emptyTree}<q:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><q:sldLayoutIdLst><q:sldLayoutId id="2147483649" rel:id="layout"/></q:sldLayoutIdLst></q:sldMaster>`,
    'ppt/slideLayouts/blank.xml': `${xmlHeader}<q:sldLayout ${ns} type="blank">${emptyTree}</q:sldLayout>`,
    'ppt/slideLayouts/_rels/blank.xml.rels': rels([{ id: 'm', type: 'slideMaster', target: '../slideMasters/base.xml' }]),
    'ppt/slides/_rels/external.xml.rels': rels([{ id: 'l', type: 'slideLayout', target: '../slideLayouts/blank.xml' }]),
    'ppt/slides/external.xml': `${xmlHeader}<q:sld ${ns}><q:cSld name="Independent"><q:spTree><q:nvGrpSpPr><q:cNvPr id="1" name=""/><q:cNvGrpSpPr/><q:nvPr/></q:nvGrpSpPr><q:grpSpPr/><q:sp><q:nvSpPr><q:cNvPr id="2" name="Real text"/><q:cNvSpPr txBox="1"/><q:nvPr/></q:nvSpPr><q:spPr><d:xfrm><d:off x="127000" y="254000"/><d:ext cx="2540000" cy="1270000"/></d:xfrm><d:prstGeom prst="rect"><d:avLst/></d:prstGeom><d:noFill/></q:spPr><q:txBody><d:bodyPr/><d:lstStyle/><d:p><d:r><d:rPr sz="2800" b="1"><d:solidFill><d:srgbClr val="114477"/></d:solidFill><d:latin typeface="Calibri"/></d:rPr><d:t>Externally authored &amp; editable</d:t></d:r></d:p></q:txBody></q:sp></q:spTree></q:cSld><q:transition spd="med"><q:fade/></q:transition></q:sld>`,
  };
  parts['[Content_Types].xml'] = contentTypes([
    { path: 'ppt/presentation.xml', type: type('presentation.main') },
    { path: 'ppt/slideMasters/base.xml', type: type('slideMaster') },
    { path: 'ppt/slideLayouts/blank.xml', type: type('slideLayout') },
    { path: 'ppt/slides/external.xml', type: type('slide') },
    { path: 'ppt/presProps.xml', type: type('presProps') },
    { path: 'ppt/theme/independent.xml', type: 'application/vnd.openxmlformats-officedocument.theme+xml' },
    { path: 'docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' },
  ]);
  const decoded = decodePPTX(pack(parts, 'pptx').content);
  assert.equal(decoded.slides[0].id, '412');
  assert.equal(decoded.slides[0].objects[0].text, 'Externally authored & editable');
  assert.equal(decoded.slides[0].objects[0].fontSize, 28);
  assert.equal(decoded.slides[0].objects[0].fontFamily, 'Calibri');
  assert.equal(decoded.slides[0].objects[0].x, 10);
  assert.equal(decoded.slides[0].objects[0].y, 20);
  assert.equal(decoded.slides[0].transitionDuration, 1);
});

test('rejects unsupported export media, fake images, transitions and geometry rather than losing content', () => {
  for (const type of ['video', 'audio', 'movie', 'group', 'unknown']) {
    assert.throws(() => encodePPTX({ slides: [{ objects: [{ type, content: 'data:video/mp4;base64,AAAA' }] }] }), errorCode('unsupported_content'));
  }
  assert.throws(() => encodePPTX({ slides: [{ objects: [{ type: 'image', content: 'data:image/png;base64,e30=' }] }] }), errorCode('invalid_format'));
  assert.throws(() => encodePPTX({ slides: [{ objects: [], transition: 'zoom' }] }), errorCode('unsupported_content'));
  assert.throws(() => encodePPTX({ slides: [{ objects: [{ type: 'shape', shape: 'star' }] }] }), errorCode('unsupported_content'));
  assert.throws(() => encodePPTX({ slides: [{ objects: [{ type: 'text', x: Infinity }] }] }), errorCode('invalid_format'));
  assert.throws(() => encodePPTX({ slides: [{ objects: [{ type: 'chart', series: [{ labels: ['A'], values: [1] }, { labels: ['A'], values: [2] }] }] }] }), errorCode('unsupported_content'));
});

test('rejects external relationships, missing notes master, unrepresented timing and placeholder content', () => {
  const transformPackage = change => {
    const parts = unpack(encodePPTX(source()).content, 'pptx');
    change(parts);
    return pack(parts, 'pptx').content;
  };
  assert.throws(() => decodePPTX(transformPackage(parts => {
    parts['ppt/slides/_rels/slide1.xml.rels'] = rels([{ id: 'outside', type: 'image', target: 'https://example.com/photo.png', external: true }]);
  })), errorCode('unsupported_content'));
  assert.throws(() => decodePPTX(transformPackage(parts => {
    parts['ppt/notesSlides/_rels/notesSlide1.xml.rels'] = rels([{ id: 'slide', type: 'slide', target: '../slides/slide1.xml' }]);
  })), errorCode('invalid_format'));
  assert.throws(() => decodePPTX(transformPackage(parts => {
    parts['ppt/slides/slide1.xml'] = partText(parts, 'ppt/slides/slide1.xml').replace('</p:sld>', '<p:timing/></p:sld>');
  })), errorCode('unsupported_content'));
  assert.throws(() => decodePPTX(transformPackage(parts => {
    parts['ppt/slides/slide1.xml'] = partText(parts, 'ppt/slides/slide1.xml').replace('<p:cNvSpPr txBox="1"/><p:nvPr/>', '<p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title"/></p:nvPr>');
  })), errorCode('unsupported_content'));
  assert.throws(() => decodePPTX(transformPackage(parts => {
    const sourceXML = partText(parts, 'ppt/charts/chart1.xml');
    parts['ppt/charts/chart1.xml'] = sourceXML.replace(/(<c:order[^>]*\/>)/, '$1<c:tx><c:v>Revenue</c:v></c:tx>');
  })), errorCode('unsupported_content'));
});

test('preserves empty text styles, size/font aliases and text-bearing shapes', () => {
  const decoded = decodePPTX(encodePPTX({ slides: [{ objects: [
    { id: 'empty', type: 'text', text: '', runs: [], font: 'Georgia', size: 36, color: '#113355', bold: true },
    { id: 'shape-text', type: 'shape', shape: 'rectangle', text: 'Caption', fontFamily: 'Verdana', fontSize: 16, italic: true, fill: '#FFEEDD', stroke: 'none' },
  ] }] }).content);
  assert.equal(decoded.slides[0].objects[0].fontSize, 36);
  assert.equal(decoded.slides[0].objects[0].fontFamily, 'Georgia');
  assert.equal(decoded.slides[0].objects[0].bold, true);
  assert.equal(decoded.slides[0].objects[0].text, '');
  assert.equal(decoded.slides[0].objects[1].shape, 'rect');
  assert.equal(decoded.slides[0].objects[1].text, 'Caption');
  assert.equal(decoded.slides[0].objects[1].fontSize, 16);
  assert.equal(decoded.slides[0].objects[1].italic, true);
  assert.equal(decoded.slides[0].objects[1].stroke, 'none');
});

for (const kind of ['bar', 'line', 'pie']) {
  test(`encodes ${kind} chart as a real DrawingML chart part`, () => {
    const output = encodePPTX({ slides: [{ objects: [{ id: 'chart', type: 'chart', kind, title: 'Measurements', labels: ['One', 'Two'], values: [3, 7], x: 12, y: 24, width: 320, height: 240 }] }] });
    const parts = unpack(output.content, 'pptx');
    assert.equal(descendants(getXML(parts, 'ppt/charts/chart1.xml'), `${kind}Chart`).length, 1);
    const chart = decodePPTX(output.content).slides[0].objects[0];
    assert.equal(chart.kind, kind);
    assert.equal(chart.title, 'Measurements');
    assert.deepEqual(chart.labels, ['One', 'Two']);
    assert.deepEqual(chart.values, [3, 7]);
    assert.equal(chart.x, 12);
    assert.equal(chart.height, 240);
  });
}

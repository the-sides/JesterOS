import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8 } from 'fflate';
import { encodeDOCX, decodeDOCX } from './office-docx-codec.js';
import { XMLNS, unpack, pack, getXML, descendants, child, attr, nodeText, readRels, rels, contentTypes } from './office-xml-common.js';

const MAIN = 'word/document.xml';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const unsupported = error => error.code === 'unsupported_content';
const invalid = error => error.code === 'invalid_format';
const baseParts = () => unpack(encodeDOCX({ title: 'Imported Word', blocks: [{ type: 'paragraph', text: 'Original' }] }).content, 'docx');
function withMain(xml) {
  const parts = baseParts();
  parts[MAIN] = xml;
  return pack(parts, 'docx').content;
}
function changeMain(content, transform) {
  const parts = unpack(content, 'docx');
  parts[MAIN] = transform(strFromU8(parts[MAIN]));
  return pack(parts, 'docx').content;
}
const wordXML = body => `<q:document xmlns:q="${XMLNS.w}"><q:body>${body}</q:body></q:document>`;

test('DOCX export contains genuine WordprocessingML ZIP parts and relationship-based core title', () => {
  const encoded = encodeDOCX({ title: 'A & B <draft>', blocks: [{ type: 'paragraph', text: 'Real document' }] });
  assert.equal(encoded.extension, 'docx');
  assert.equal(encoded.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes = Buffer.from(encoded.content.split(',')[1], 'base64');
  assert.deepEqual([...bytes.subarray(0, 4)], [80, 75, 3, 4]);
  const parts = unpack(encoded.content, 'docx');
  assert.equal(nodeText(descendants(getXML(parts, MAIN), 't')[0]), 'Real document');
  const roots = readRels(parts, '');
  assert.equal(roots.get('rId1').path, MAIN);
  assert.equal(roots.get('rId2').path, 'docProps/core.xml');
  assert.equal(nodeText(child(getXML(parts, roots.get('rId2').path), 'title')), 'A & B <draft>');
  assert.ok(!Object.keys(parts).some(path => path.endsWith('.json')));
  assert.equal(decodeDOCX(encoded.content).title, 'A & B <draft>');
});

test('mixed rich runs, entities, tabs, breaks, alignment and asymmetric page margins survive canonical roundtrip', () => {
  const source = {
    title: 'Rich letter',
    page: { width: 595, height: 842, margin: { top: 36, right: 48, bottom: 60, left: 72 } },
    blocks: [{ type: 'paragraph', align: 'justify', runs: [
      { text: 'Bold & <escaped>', bold: true, font: 'Arial', size: 14, color: '#123abc' },
      { text: ' plain\t', bold: false, italic: false, underline: false },
      { text: 'Italic\nunderlined 😀', italic: true, underline: true, size: 12.5 },
    ] }],
  };
  const decoded = decodeDOCX(encodeDOCX(source).content);
  assert.deepEqual(decoded.page, source.page);
  assert.equal(decoded.blocks[0].align, 'justify');
  assert.equal(decoded.paragraphs[0].text, 'Bold & <escaped> plain\tItalic\nunderlined 😀');
  assert.equal(decoded.blocks[0].runs[0].bold, true);
  assert.equal(decoded.blocks[0].runs[0].font, 'Arial');
  assert.equal(decoded.blocks[0].runs[0].color, '#123abc');
  assert.equal(decoded.blocks[0].runs[1].bold, false);
  assert.equal(decoded.blocks[0].runs[2].italic, true);
  assert.equal(decoded.blocks[0].runs[2].underline, true);
  assert.equal(decoded.blocks[0].runs[2].size, 12.5);
  assert.deepEqual(decodeDOCX(encodeDOCX(decoded).content), decoded);
});

test('Microsoft paragraphs retain heterogeneous runs instead of inheriting first-run marks on re-export', () => {
  const source = {
    title: 'Microsoft shape', page: { width: 612, height: 792, margin: 72 },
    paragraphs: [{ id: 'p1', text: 'Bold plain', style: { fontFamily: 'Arial', fontSize: 13, align: 'center', bold: false, italic: false, underline: false, color: '#112233' }, runs: [{ text: 'Bold', bold: true }, { text: ' plain', bold: false }] }],
    tables: [{ id: 't1', rows: [['A', 'B'], ['C', 'D']] }],
    images: [{ id: 'i1', content: PNG, mime: 'image/png', width: 72, height: 36 }],
  };
  const decoded = decodeDOCX(encodeDOCX(source).content);
  assert.deepEqual(decoded.blocks.map(block => block.type), ['paragraph', 'table', 'image']);
  assert.equal(decoded.paragraphs[0].style.align, 'center');
  assert.equal(decoded.paragraphs[0].runs[0].bold, true);
  assert.equal(decoded.paragraphs[0].runs[1].bold, false);
  const derivedOnly = { title: decoded.title, page: decoded.page, paragraphs: decoded.paragraphs, tables: decoded.tables, images: decoded.images };
  const imported = decodeDOCX(encodeDOCX(derivedOnly).content);
  assert.equal(imported.paragraphs[0].runs[1].bold, false);
  assert.deepEqual(imported.tables[0].rows, source.tables[0].rows);
  assert.equal(imported.images[0].content, PNG);
});

test('tables are true w:tbl/w:tr/w:tc elements and retain rich cell paragraphs and grid widths', () => {
  const source = { title: 'Grid', blocks: [{ type: 'table', columnWidths: [90, 180], rows: [
    [{ text: 'Heading', bold: true }, { paragraphs: [{ type: 'paragraph', align: 'right', runs: [{ text: 'One', italic: true }] }, { type: 'paragraph', text: 'Two' }] }],
    ['left', 'right'],
  ] }] };
  const encoded = encodeDOCX(source);
  const parts = unpack(encoded.content, 'docx');
  const root = getXML(parts, MAIN);
  assert.equal(descendants(root, 'tbl').length, 1);
  assert.equal(descendants(root, 'tr').length, 2);
  assert.equal(descendants(root, 'tc').length, 4);
  assert.deepEqual(descendants(root, 'gridCol').map(node => Number(attr(node, 'w'))), [1800, 3600]);
  const decoded = decodeDOCX(encoded.content);
  assert.deepEqual(decoded.tables[0].rows, [['Heading', 'One\nTwo'], ['left', 'right']]);
  assert.equal(decoded.blocks[0].rows[0][0].paragraphs[0].runs[0].bold, true);
  assert.equal(decoded.blocks[0].rows[0][1].paragraphs[0].align, 'right');
  assert.deepEqual(decoded.blocks[0].columnWidths, [90, 180]);
  assert.deepEqual(decodeDOCX(encodeDOCX(decoded).content), decoded);
});

test('embedded genuine PNG uses DrawingML blip relationship and returns original bytes', () => {
  const encoded = encodeDOCX({ title: 'Picture', blocks: [{ type: 'image', content: PNG, width: 120, height: 64 }] });
  const parts = unpack(encoded.content, 'docx');
  const main = getXML(parts, MAIN);
  assert.equal(descendants(main, 'drawing').length, 1);
  assert.equal(attr(descendants(main, 'graphicData')[0], 'uri'), XMLNS.pic);
  const embed = attr(descendants(main, 'blip')[0], 'embed');
  const target = readRels(parts, MAIN).get(embed);
  assert.equal(target.type, XMLNS.r + '/image');
  assert.deepEqual(Buffer.from(parts[target.path]), Buffer.from(PNG.split(',')[1], 'base64'));
  const decoded = decodeDOCX(encoded.content);
  assert.equal(decoded.paragraphs.length, 0);
  assert.equal(decoded.images[0].content, PNG);
  assert.equal(decoded.images[0].width, 120);
  assert.equal(decoded.images[0].height, 64);
});

for (const kind of ['bar', 'line', 'pie']) test(`${kind} charts use real chart parts/caches instead of image or JSON substitutes`, () => {
  const source = { title: 'Chart', blocks: [{ type: 'chart', kind, title: 'Quarter & year', labels: ['East', 'West'], values: [12.25, 19], width: 300, height: 180 }] };
  const encoded = encodeDOCX(source);
  const parts = unpack(encoded.content, 'docx');
  const rid = attr(descendants(getXML(parts, MAIN), 'chart')[0], 'id');
  const relationship = readRels(parts, MAIN).get(rid);
  assert.equal(relationship.type, XMLNS.r + '/chart');
  const chart = getXML(parts, relationship.path);
  assert.equal(descendants(chart, kind + 'Chart').length, 1);
  assert.equal(descendants(chart, 'pt').length, 4);
  const decoded = decodeDOCX(encoded.content);
  assert.deepEqual(decoded.blocks[0], { ...source.blocks[0] });
  assert.deepEqual(decodeDOCX(encodeDOCX(decoded).content).blocks, decoded.blocks);
});

test('import understands alternate Word namespace prefix, style inheritance, explicit false and theme fonts/colors', () => {
  const parts = baseParts();
  parts[MAIN] = wordXML('<q:p><q:pPr><q:pStyle q:val="Strong"/><q:jc q:val="right"/></q:pPr><q:r><q:rPr><q:b q:val="0"/><q:color q:themeColor="accent1"/></q:rPr><q:t>Styled &amp; real</q:t></q:r></q:p>');
  parts['word/styles.xml'] = `<q:styles xmlns:q="${XMLNS.w}"><q:docDefaults><q:rPrDefault><q:rPr><q:rFonts q:asciiTheme="minorHAnsi"/><q:sz q:val="24"/></q:rPr></q:rPrDefault></q:docDefaults><q:style q:type="paragraph" q:default="1" q:styleId="Normal"><q:rPr><q:i/></q:rPr></q:style><q:style q:type="paragraph" q:styleId="Strong"><q:basedOn q:val="Normal"/><q:rPr><q:b/></q:rPr></q:style></q:styles>`;
  parts['word/theme/theme1.xml'] = `<a:theme xmlns:a="${XMLNS.a}"><a:themeElements><a:clrScheme name="Test"><a:accent1><a:srgbClr val="123ABC"/></a:accent1></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  parts['word/_rels/document.xml.rels'] = rels([{ id: 'styles', type: 'styles', target: 'styles.xml' }, { id: 'theme', type: 'theme', target: 'theme/theme1.xml' }]);
  const decoded = decodeDOCX(pack(parts, 'docx').content);
  assert.equal(decoded.paragraphs[0].text, 'Styled & real');
  assert.equal(decoded.paragraphs[0].style.bold, false);
  assert.equal(decoded.paragraphs[0].style.italic, true);
  assert.equal(decoded.paragraphs[0].style.fontFamily, 'Calibri');
  assert.equal(decoded.paragraphs[0].style.fontSize, 12);
  assert.equal(decoded.paragraphs[0].style.color, '#123abc');
  assert.equal(decoded.paragraphs[0].style.align, 'right');
});

test('unknown rich content, fields, links, numbering, tracked changes and sections reject rather than flatten', () => {
  for (const body of [
    '<q:p><q:hyperlink><q:r><q:t>Link</q:t></q:r></q:hyperlink></q:p>',
    '<q:p><q:r><q:fldChar q:fldCharType="begin"/></q:r></q:p>',
    '<q:p><q:r><q:rPr><q:strike/></q:rPr><q:t>Strike</q:t></q:r></q:p>',
    '<q:p><q:pPr><q:numPr><q:numId q:val="1"/></q:numPr></q:pPr><q:r><q:t>List</q:t></q:r></q:p>',
    '<q:p><q:ins><q:r><q:t>Change</q:t></q:r></q:ins></q:p>',
    '<q:p><q:pPr><q:sectPr/></q:pPr></q:p><q:sectPr/>',
    '<q:sectPr><q:headerReference q:type="default"/></q:sectPr>',
    '<q:sectPr><q:cols q:num="2"/></q:sectPr>',
  ]) assert.throws(() => decodeDOCX(withMain(wordXML(body))), unsupported);
});

test('unsupported floating/cropped/mixed drawing content is not silently converted', () => {
  const image = encodeDOCX({ blocks: [{ type: 'image', content: PNG, width: 72, height: 72 }] }).content;
  assert.throws(() => decodeDOCX(changeMain(image, source => source.replaceAll('wp:inline', 'wp:anchor'))), unsupported);
  assert.throws(() => decodeDOCX(changeMain(image, source => source.replace('<a:stretch>', '<a:srcRect l="1000"/><a:stretch>'))), unsupported);
  assert.throws(() => decodeDOCX(changeMain(image, source => source.replace('<w:r><w:drawing>', '<w:r><w:t>Inline text</w:t><w:drawing>'))), unsupported);
  const parts = unpack(image, 'docx');
  parts['word/_rels/document.xml.rels'] = rels([{ id: 'rId1', type: 'image', target: 'https://example.invalid/image.png', external: true }]);
  assert.throws(() => decodeDOCX(pack(parts, 'docx').content), unsupported);
});

test('merged tables reject rather than losing spanning geometry', () => {
  const table = encodeDOCX({ blocks: [{ type: 'table', rows: [['A', 'B']] }] }).content;
  assert.throws(() => decodeDOCX(changeMain(table, source => source.replace('<w:tcPr>', '<w:tcPr><w:gridSpan w:val="2"/>'))), unsupported);
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'table', rows: [['A', 'B'], ['C']] }] }), unsupported);
});

test('native Pages MIME, arbitrary objects, fake Office JSON and mismatched image bytes reject honestly', () => {
  assert.throws(() => decodeDOCX('data:application/vnd.apple.pages;base64,UEs='), unsupported);
  assert.throws(() => encodeDOCX({ format: 'pages', content: 'native' }), unsupported);
  assert.throws(() => encodeDOCX({ paragraphs: 'not an array' }), unsupported);
  assert.throws(() => decodeDOCX('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,eyJ0aXRsZSI6ImZha2UifQ=='), invalid);
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'image', content: 'data:image/png;base64,AQID' }] }), invalid);
});

test('malformed XML and incorrectly namespaced Word parts fail before decoding', () => {
  assert.throws(() => decodeDOCX(withMain(`<w:document xmlns:w="${XMLNS.w}"><w:body><w:p></w:body></w:document>`)), invalid);
  assert.throws(() => decodeDOCX(withMain('<document><body><p/></body></document>')), unsupported);
  const parts = baseParts();
  parts['[Content_Types].xml'] = contentTypes([{ path: MAIN, type: 'application/vnd.ms-word.document.macroEnabled.main+xml' }]);
  assert.throws(() => decodeDOCX(pack(parts, 'docx').content), unsupported);
});

test('empty core title is retained rather than replaced by an invented title', () => {
  assert.equal(decodeDOCX(encodeDOCX({ title: '', blocks: [{ type: 'paragraph', text: 'Text' }] }).content).title, '');
});

test('aggregate text and XML-node bounds stop repeated or control-heavy input before oversized XML construction', () => {
  assert.throws(() => encodeDOCX({ blocks: Array(3).fill({ type: 'paragraph', text: 'x'.repeat(800000) }) }), error => error.code === 'limit_exceeded');
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'paragraph', text: '\t'.repeat(100000) }] }), error => error.code === 'limit_exceeded');
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'paragraph', runs: [{ text: 'Text', size: 12.2 }] }] }), unsupported);
});

test('chart series outside the declared DOCX labels/values subset reject on export and import', () => {
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'chart', kind: 'bar', labels: ['A'], values: [1], series: [{ name: 'Named', values: [1] }] }] }), unsupported);
  const parts = unpack(encodeDOCX({ blocks: [{ type: 'chart', kind: 'bar', labels: ['A'], values: [1] }] }).content, 'docx');
  const path = 'word/charts/chart1.xml';
  parts[path] = strFromU8(parts[path]).replace('<c:ser>', '<c:ser><c:tx><c:v>Named series</c:v></c:tx>');
  assert.throws(() => decodeDOCX(pack(parts, 'docx').content), unsupported);
});

test('real paragraph page breaks preserve native Add Page content in WordprocessingML', () => {
  const encoded = encodeDOCX({ blocks: [
    { type: 'paragraph', text: 'First page' },
    { type: 'paragraph', pageBreakBefore: true, text: 'Second page' },
    { type: 'paragraph', style: { pageBreakBefore: false }, text: 'Same page' },
  ] });
  const parts = unpack(encoded.content, 'docx'), nodes = descendants(getXML(parts, MAIN), 'pageBreakBefore');
  assert.deepEqual(nodes.map(n => attr(n, 'val')), ['1', '0']);
  const decoded = decodeDOCX(encoded.content);
  assert.equal(decoded.blocks[0].pageBreakBefore, undefined);
  assert.equal(decoded.blocks[1].pageBreakBefore, true);
  assert.equal(decoded.blocks[2].pageBreakBefore, false);
  assert.equal(decoded.paragraphs[1].style.pageBreakBefore, true);
  assert.equal(decoded.paragraphs[2].style.pageBreakBefore, false);
  const imported = decodeDOCX(withMain(wordXML('<q:p><q:pPr><q:pageBreakBefore/></q:pPr><q:r><q:t>New page</q:t></q:r></q:p>')));
  assert.equal(imported.blocks[0].pageBreakBefore, true);
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'paragraph', pageBreakBefore: null, text: 'Invalid flag' }] }), unsupported);
  assert.throws(() => encodeDOCX({ blocks: [{ type: 'paragraph', runs: [{ text: 'Wrong scope', pageBreakBefore: true }] }] }), unsupported);
});

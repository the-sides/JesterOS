import { expect, test } from 'bun:test';
import { createTextEditContent, textEditPlainText, textEditHtml, replaceTextEditRange, formatTextEditRange, validateTextEditContent, TEXTEDIT_MARK_DEFAULTS } from '../frontend/src/textedit-content.js';
import { encodeTextEditFile, decodeTextEditFile, parseTextEditRtf, serializeTextEditRtf, TEXTEDIT_BYTE_PREFIX } from '../frontend/src/textedit-codec.js';
import { createTextEditPdf } from '../frontend/src/textedit-pdf.js';

const run = (text, marks = {}) => ({ text, marks: { ...TEXTEDIT_MARK_DEFAULTS, ...marks } });
const paragraph = (id, text, props = {}) => ({ ...createTextEditContent(text).blocks[0], id, ...props });
const table = () => ({ id: 'table-1', type: 'table', rows: [[{ runs: [run('Alpha', { bold: true })] }, { runs: [run('Beta', { color: '#123456' })] }], [{ runs: [run('Gamma')] }, { runs: [run('Delta', { italic: true })] }]] });
const attachment = () => ({ id: 'attachment-1', type: 'attachment', fileId: 'actual-file-42', name: 'Report {final}.pdf', mime: 'application/pdf' });
const errorCode = (operation, code) => { let error; try { operation(); } catch (caught) { error = caught; } expect(error?.code).toBe(code); };
const fontLoader = async () => new Uint8Array(await Bun.file(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url)).arrayBuffer());
async function extractPdf(base64) {
  const process = Bun.spawn(['pdftotext', '-layout', '-', '-'], { stdin: Buffer.from(base64, 'base64'), stdout: 'pipe', stderr: 'pipe' });
  const [text, errors, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  expect(exit, errors).toBe(0); return text;
}

test('canonical validator refuses accessors, unknown fields, sparse arrays, bad marks and duplicate identities without invoking getters', () => {
  let reads = 0;
  for (const location of ['kind', 'block', 'run', 'marks', 'array', 'color']) {
    const content = createTextEditContent('safe');
    const getter = { enumerable: true, configurable: true, get() { reads++; throw new Error('Getter was invoked'); } };
    if (location === 'kind') Object.defineProperty(content, 'kind', getter);
    if (location === 'block') Object.defineProperty(content.blocks[0], 'type', getter);
    if (location === 'run') Object.defineProperty(content.blocks[0].runs[0], 'text', getter);
    if (location === 'marks') Object.defineProperty(content.blocks[0].runs[0].marks, 'bold', getter);
    if (location === 'array') Object.defineProperty(content.blocks, '0', getter);
    if (location === 'color') content.blocks[0].runs[0].marks.color = { toString() { reads++; throw new Error('Coercion'); } };
    expect(validateTextEditContent(content)).toBe(false);
  }
  expect(reads).toBe(0);
  const unknown = createTextEditContent('safe'); unknown.html = '<p>shadow</p>'; expect(validateTextEditContent(unknown)).toBe(false);
  const sparse = createTextEditContent('safe'); sparse.blocks.length = 2; expect(validateTextEditContent(sparse)).toBe(false);
  const duplicate = createTextEditContent('a\nb'); duplicate.blocks[1].id = duplicate.blocks[0].id; expect(validateTextEditContent(duplicate)).toBe(false);
  const plain = createTextEditContent('a', 'plain'); plain.blocks[0].runs[0].marks.bold = true; expect(validateTextEditContent(plain)).toBe(false);
  const malformed = createTextEditContent('a'); malformed.blocks[0].runs[0].text = '\ud800'; expect(validateTextEditContent(malformed)).toBe(false);
});

test('text projection defines exact paragraph, table and attachment offsets without parallel mirrors', () => {
  const content = { kind: 'rich', blocks: [paragraph('p', 'Start'), table(), attachment(), paragraph('end', 'End')] };
  expect(validateTextEditContent(content)).toBe(true);
  expect(textEditPlainText(content)).toBe('Start\nAlpha\tBeta\nGamma\tDelta\n\ufffc\nEnd');
  expect(createTextEditContent('a\r\nb\rc\n').blocks.map(block => block.runs[0].text)).toEqual(['a', 'b', 'c', '']);
});

test('HTML escapes authored text/font/link/file labels and leaves every link inert', () => {
  const content = createTextEditContent('<script>bad</script> & "quoted"');
  content.blocks[0].runs[0].marks.font = 'Family "quoted"';
  content.blocks[0].runs[0].marks.link = 'javascript:alert("<&")';
  content.blocks.push({ ...attachment(), name: '<img src=x onerror=bad>' });
  const html = textEditHtml(content);
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x onerror=bad&gt;');
  expect(html).toContain('data-textedit-link=');
  expect(html).not.toMatch(/<script|<img|\shref=/);
});

test('replacement splits/joins paragraphs, preserves unaffected runs and does not mutate source', () => {
  const content = createTextEditContent('abcd\nefgh');
  content.blocks[0].runs = [run('ab', { bold: true }), run('cd')];
  content.blocks[1].runs = [run('ef', { italic: true }), run('gh', { underline: true })];
  const before = structuredClone(content), output = replaceTextEditRange(content, 2, 7, 'X\nY');
  expect(textEditPlainText(output)).toBe('abX\nYgh');
  expect(output.blocks[0].runs).toEqual([run('abX', { bold: true })]);
  expect(output.blocks[1].runs).toEqual([run('Y', { bold: true }), run('gh', { underline: true })]);
  expect(output.blocks[0].id).toBe(content.blocks[0].id);
  expect(output.blocks[1].id).not.toBe(output.blocks[0].id);
  expect(content).toEqual(before);
  expect(textEditPlainText(replaceTextEditRange(content, 0, 9, ''))).toBe('');
});

test('table edits stay within a real cell and object/boundary deletion cannot silently flatten rich data', () => {
  const content = { kind: 'rich', blocks: [table(), attachment()] };
  const output = replaceTextEditRange(content, 1, 4, 'Z');
  expect(output.blocks[0].rows[0][0].runs).toEqual([run('AZa', { bold: true })]);
  expect(output.blocks[0].rows[0][1]).toEqual(content.blocks[0].rows[0][1]);
  errorCode(() => replaceTextEditRange(content, 4, 8, 'x'), 'unsupported_content');
  expect(replaceTextEditRange(content, 1, 2, '\n').blocks[0].rows[0][0].runs).toEqual([run('A\npha', { bold: true })]);
  const offset = textEditPlainText(content).indexOf('\ufffc');
  errorCode(() => replaceTextEditRange(content, offset, offset + 1, ''), 'unsupported_content');
});

test('UTF16 range boundaries cannot split a surrogate pair or accept reversed/outside selection', () => {
  const content = createTextEditContent('A😀Z');
  errorCode(() => replaceTextEditRange(content, 2, 3, 'x'), 'invalid_range');
  errorCode(() => formatTextEditRange(content, 1, 2, { bold: true }), 'invalid_range');
  errorCode(() => replaceTextEditRange(content, 4, 1, 'x'), 'invalid_range');
  expect(textEditPlainText(replaceTextEditRange(content, 1, 3, '♥'))).toBe('A♥Z');
});

test('range formatting splits only selected marks, updates real paragraphs and tables, and preserves source', () => {
  const content = { kind: 'rich', blocks: [paragraph('p', 'abcd'), table()] }, before = structuredClone(content);
  const output = formatTextEditRange(content, 1, 3, { marks: { bold: true, color: '#ff0000' }, align: 'center', spacing: 1.5, indent: 18, tabs: [36, 72] });
  expect(output.blocks[0]).toMatchObject({ align: 'center', spacing: 1.5, indent: 18, tabs: [36, 72] });
  expect(output.blocks[0].runs).toEqual([run('a'), run('bc', { bold: true, color: '#ff0000' }), run('d')]);
  expect(formatTextEditRange(content, 5, 10, { italic: true }).blocks[1].rows[0][0].runs).toEqual([run('Alpha', { bold: true, italic: true })]);
  expect(content).toEqual(before);
  errorCode(() => formatTextEditRange(createTextEditContent('a', 'plain'), 0, 1, { bold: true }), 'unsupported_content');
  errorCode(() => formatTextEditRange(content, 0, 1, { color: 'red;script:x' }), 'invalid_arguments');
});

test('genuine RTF roundtrip preserves supported rich text, fonts/colors, Unicode, links, lists, ruler tabs, tables and local attachment IDs', () => {
  const content = createTextEditContent('First\nSecond\nBullet\nEnd');
  content.blocks[0].runs = [run('héllo {\\} 😀\tlink', { bold: true, italic: true, underline: true, strike: true, font: 'Liberation Serif', size: 13.5, color: '#123456', link: 'https://fictional.local/a?x="b"&y=\\z' })];
  Object.assign(content.blocks[0], { align: 'justify', spacing: 1.5, indent: 18, tabs: [36, 72], list: 'number' });
  content.blocks[1].list = 'number'; content.blocks[2].list = 'bullet';
  content.blocks.splice(3, 0, table(), attachment());
  const file = encodeTextEditFile(content, 'utf-8');
  expect(file.mime).toBe('application/rtf'); expect(file.text.startsWith('{\\rtf1')).toBe(true);
  expect(file.text).toContain('\\trowd'); expect(file.text).toContain('\\cellx'); expect(file.text).not.toContain('"blocks":');
  expect(decodeTextEditFile(file)).toEqual({ content, encoding: 'utf-8' });
});

test('RTF independently authored scoped marks, ANSI hex escapes and signed Unicode decode without borrowing writer output', () => {
  const source = String.raw`{\rtf1\ansi\ansicpg1252\uc1{\fonttbl{\f0\fnil Liberation Sans;}}\pard\qc\sl360\slmult1\tx720 A{\b B}C \'80 \u-10179?\u-8704?\par}`;
  const content = parseTextEditRtf(source);
  expect(textEditPlainText(content)).toBe('ABC € 😀');
  expect(content.blocks[0]).toMatchObject({ align: 'center', spacing: 1.5, tabs: [36] });
  expect(content.blocks[0].runs).toEqual([run('A'), run('B', { bold: true }), run('C € 😀')]);
  const scoped = parseTextEditRtf(String.raw`{\rtf1\ansi\uc1 {\uc0\u233}X\u233?Y\par}`);
  expect(textEditPlainText(scoped)).toBe('éXéY');
});

test('empty styled paragraphs/cells and distinct adjacent tables retain canonical identity and authored marks', () => {
  const content = createTextEditContent(''); content.blocks[0].runs = [run('', { bold: true, size: 18, font: 'Liberation Serif' })];
  const first = table(), second = { ...table(), id: 'table-2' };
  first.rows[0][0].runs = [run('', { italic: true, size: 14 })];
  content.blocks.push(first, second);
  expect(parseTextEditRtf(serializeTextEditRtf(content))).toEqual(content);
});

test('RTF rejects unsupported or lossy constructs, malformed nesting, malformed attachment metadata and nonrepresentable units', () => {
  for (const source of [String.raw`{\rtf1\ansi{\pict\pngblip 00}}`, String.raw`{\rtf1\ansi\super X\par}`, String.raw`{\rtf1\ansi{\*\unknown hidden}}`, String.raw`{\rtf1\ansi{\stylesheet{\s0 Normal;}}X}`, String.raw`{\rtf1\ansi\ansicpg932 X}`, String.raw`{\rtf1\ansi\sl300 X\par}`, String.raw`{\rtf1\ansi{\pntext 99.\tab}X\par}`, String.raw`{\rtf1\ansi{\field{\*\fldinst AUTHOR}{\fldrslt A}}}`])
    errorCode(() => parseTextEditRtf(source), 'unsupported_rtf');
  for (const source of [String.raw`{\rtf1\ansi X`, String.raw`{\rtf1\ansi \'zz}`, String.raw`{\rtf1\ansi\u999999?}`, String.raw`{\rtf1\ansi\u233}`, String.raw`{\rtf1\ansi{\*\jesterosattachment ff 61 62}}`])
    errorCode(() => parseTextEditRtf(source), 'invalid_rtf');
  const tooPrecise = createTextEditContent('x'); tooPrecise.blocks[0].runs[0].marks.size = 12.25;
  errorCode(() => serializeTextEditRtf(tooPrecise), 'unsupported_content');
  errorCode(() => encodeTextEditFile(createTextEditContent('x'), 'windows-1252'), 'unsupported_encoding');
});

test('table parser refuses unequal or unrepresentable geometry and mismatched real cell counts', () => {
  errorCode(() => parseTextEditRtf(String.raw`{\rtf1\ansi\trowd\cellx2000\cellx9360\pard\intbl A\cell B\cell\row}`), 'unsupported_rtf');
  errorCode(() => parseTextEditRtf(String.raw`{\rtf1\ansi\trowd\cellx4680\cellx9360\pard\intbl A\cell\row}`), 'invalid_rtf');
  errorCode(() => parseTextEditRtf(String.raw`{\rtf1\ansi\trowd\cellx9360\pard\qc\intbl A\cell\row}`), 'unsupported_rtf');
});

test('nonUTF8 encodings use exact bytes, not Unicode text mislabeled as a legacy file', () => {
  const source = createTextEditContent('€ “é”', 'plain');
  const cp = encodeTextEditFile(source, 'windows-1252');
  expect(cp.text).toBe(`${TEXTEDIT_BYTE_PREFIX}windows-1252:gCCT6ZQ=`);
  expect(cp.mime).toBe('text/plain;charset=windows-1252;jesteros-bytes=base64');
  expect(decodeTextEditFile(cp)).toEqual({ content: source, encoding: 'windows-1252' });
  const unicode = createTextEditContent('A😀', 'plain'), utf16 = encodeTextEditFile(unicode, 'utf-16le');
  expect([...Buffer.from(utf16.text.split(':').at(-1), 'base64')]).toEqual([255, 254, 65, 0, 61, 216, 0, 222]);
  expect(decodeTextEditFile(utf16)).toEqual({ content: unicode, encoding: 'utf-16le' });
  errorCode(() => encodeTextEditFile(unicode, 'windows-1252'), 'unrepresentable_character');
  const literal = createTextEditContent(`${TEXTEDIT_BYTE_PREFIX}windows-1252:AAAA`, 'plain');
  expect(decodeTextEditFile(encodeTextEditFile(literal)).content).toEqual(literal);
});

test('encoded-file decoder rejects MIME/discriminator mismatches, invalid base64, invalid UTF16 and fake file types', () => {
  for (const file of [
    { mime: 'text/plain;charset=utf-16le', text: 'not bytes' },
    { mime: 'text/plain;charset=utf-16le;jesteros-bytes=base64', text: `${TEXTEDIT_BYTE_PREFIX}windows-1252:QQ==` },
    { mime: 'text/plain;charset=windows-1252;jesteros-bytes=base64', text: `${TEXTEDIT_BYTE_PREFIX}windows-1252:QQ=$` },
    { mime: 'text/plain;charset=utf-16le;jesteros-bytes=base64', text: `${TEXTEDIT_BYTE_PREFIX}utf-16le://5BAA==X` },
    { mime: 'text/plain;charset=utf-16le;jesteros-bytes=base64', text: `${TEXTEDIT_BYTE_PREFIX}utf-16le://4A2A==` },
  ]) errorCode(() => decodeTextEditFile(file), 'invalid_encoding');
  errorCode(() => decodeTextEditFile({ mime: 'text/html', text: '<p>x</p>' }), 'unsupported_file_type');
  errorCode(() => decodeTextEditFile({ mime: 'text/plain;charset=shift_jis', text: 'x' }), 'unsupported_encoding');
  let reads = 0; const file = { mime: 'text/plain', get text() { reads++; return 'x'; } };
  errorCode(() => decodeTextEditFile(file), 'invalid_arguments'); expect(reads).toBe(0);
});

test('real rich PDF retains authored epoch, embeds bundled font, contains table/attachment text and records honest substitutions', async () => {
  const content = createTextEditContent('Heading\nTab\tTarget');
  content.blocks[0].runs = [run('Heading', { size: 24, bold: true, italic: true, underline: true, strike: true, color: '#123456', font: 'Authored Missing Font' })];
  content.blocks[0].align = 'center'; content.blocks[0].spacing = 1.5; content.blocks[1].tabs = [72];
  content.blocks.push(table(), attachment());
  const timestamp = 1696507200000, output = await createTextEditPdf(content, timestamp, { fontLoader });
  const bytes = Buffer.from(output.base64, 'base64'); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const { PDFDocument } = await import('../frontend/node_modules/pdf-lib/es/index.js');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getCreationDate().getTime()).toBe(timestamp); expect(pdf.getModificationDate().getTime()).toBe(timestamp);
  expect(pdf.getPageCount()).toBe(output.pageCount);
  expect(output.fontSubstitutions).toEqual([{ from: 'Authored Missing Font', to: 'Liberation Sans' }]);
  expect(output.syntheticEmphasis).toBe(true); expect(output.attachments).toBe('textual-labels-only');
  const text = await extractPdf(output.base64);
  for (const marker of ['Heading', 'Target', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Report {final}.pdf', 'actual-file-42']) expect(text).toContain(marker);
  const heading = output.pages[0].lines[0]; expect(heading.height).toBe(45); expect(heading.x).toBeGreaterThan(48);
  const target = output.pages[0].lines[1].fragments.find(fragment => fragment.text === 'Target'); expect(target.x).toBe(120);
  expect(output.pages[0].tables).toHaveLength(2);
});

test('PDF paginates actual content, captures source before async loading and rejects missing glyphs instead of fake output', async () => {
  const content = createTextEditContent(Array.from({ length: 100 }, (_, i) => `Marker${i}`).join('\n'));
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const pending = createTextEditPdf(content, 1696507200000, { fontLoader: async () => { entered(); await gate; return fontLoader(); } });
  await started; content.blocks[0].runs[0].text = 'Changed after export'; release();
  const output = await pending; expect(output.pageCount).toBeGreaterThan(1);
  const text = await extractPdf(output.base64); expect(text).toContain('Marker0'); expect(text).toContain('Marker99'); expect(text).not.toContain('Changed after export');
  await expect(createTextEditPdf(createTextEditContent('\u{10ffff}'), 1696507200000, { fontLoader })).rejects.toMatchObject({ code: 'unsupported_content' });
  await expect(createTextEditPdf(createTextEditContent('مرحبا'), 1696507200000, { fontLoader })).rejects.toMatchObject({ code: 'unsupported_content' });
  await expect(createTextEditPdf(createTextEditContent('x'), NaN, { fontLoader })).rejects.toMatchObject({ code: 'invalid_arguments' });
});

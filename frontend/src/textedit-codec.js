import { createTextEditContent, textEditPlainText, validateTextEditContent, TEXTEDIT_MARK_DEFAULTS, TEXTEDIT_CONTENT_LIMITS } from './textedit-content.js';
export const TEXTEDIT_ENCODINGS = Object.freeze(['utf-8', 'utf-16le', 'windows-1252']);
export const TEXTEDIT_BYTE_PREFIX = 'JESTEROS-TEXT-BYTES/1:';
const MAX_FILE = 8 * 1024 * 1024;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const assert = content => { if (!validateTextEditContent(content)) fail('invalid_content', 'Expected canonical TextEdit content.'); };
const bytes64 = bytes => { let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(result); };
const from64 = text => {
  if (text.length > MAX_FILE || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail('invalid_encoding', 'Malformed base64 byte representation.');
  const raw = atob(text), bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (bytes64(bytes) !== text) fail('invalid_encoding', 'Noncanonical base64 byte representation.');
  return bytes;
};
const utf8 = new TextEncoder();
const hex = text => Array.from(utf8.encode(text), byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = text => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) fail('invalid_rtf', 'Invalid local RTF metadata.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16))); }
  catch { fail('invalid_rtf', 'Invalid UTF-8 metadata.'); }
};
const cpDecoder = new TextDecoder('windows-1252', { fatal: true, ignoreBOM: true });
const cpText = cpDecoder.decode(Uint8Array.from({ length: 256 }, (_, i) => i));
const cpMap = new Map(Array.from(cpText, (character, i) => [character, i]));
const escapeRtf = text => {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const value = text.charCodeAt(i), character = text[i];
    if (character === '\\' || character === '{' || character === '}') result += `\\${character}`;
    else if (character === '\n') result += '\\line ';
    else if (character === '\t') result += '\\tab ';
    else if (value >= 32 && value <= 126) result += character;
    else result += `\\u${value > 32767 ? value - 65536 : value}?`;
  }
  return result;
};
const exactUnit = (value, factor, label) => { const unit = value * factor; if (!Number.isSafeInteger(unit)) fail('unsupported_content', `${label} is not exactly representable in the supported RTF units.`); return unit; };
export function serializeTextEditRtf(content) {
  assert(content);
  const fonts = [], colors = [];
  const collect = runs => { for (const { marks } of runs) { if (!fonts.includes(marks.font)) fonts.push(marks.font); const color = marks.color.toLowerCase(); if (!colors.includes(color)) colors.push(color); } };
  for (const block of content.blocks) if (block.type === 'paragraph') collect(block.runs); else if (block.type === 'table') for (const row of block.rows) for (const cell of row) collect(cell.runs);
  if (!fonts.length) fonts.push('Liberation Sans');
  const runs = values => values.map(({ text, marks }) => {
    const controls = `\\plain\\f${fonts.indexOf(marks.font)}\\fs${exactUnit(marks.size, 2, 'Font size')}\\cf${colors.indexOf(marks.color.toLowerCase()) + 1}\\b${+marks.bold}\\i${+marks.italic}\\ul${+marks.underline}\\strike${+marks.strike} `;
    const body = `${controls}${escapeRtf(text)}`;
    if (!marks.link) return `{${body}}`;
    // HYPERLINK instruction quoting uses doubled RTF backslashes to preserve field escapes.
    const instruction = `HYPERLINK "${marks.link.replace(/[\\"]/g, character => `\\${character}`)}"`;
    return `{\\field{\\*\\fldinst ${escapeRtf(instruction)}}{\\fldrslt ${body}}}`;
  }).join('');
  const fontTable = `{\\fonttbl${fonts.map((font, i) => `{\\f${i}\\fnil\\fcharset0 ${escapeRtf(font)};}`).join('')}}`;
  const colorTable = `{\\colortbl;${colors.map(color => `\\red${parseInt(color.slice(1, 3), 16)}\\green${parseInt(color.slice(3, 5), 16)}\\blue${parseInt(color.slice(5), 16)};`).join('')}}`;
  let body = '', number = 0;
  for (const block of content.blocks) {
    const id = `{\\*\\jesterosid ${hex(block.id)}}`;
    if (block.type === 'paragraph') {
      number = block.list === 'number' ? number + 1 : 0;
      let list = '';
      if (block.list === 'bullet') list = '{\\pntext\\u8226?\\tab}{\\*\\pn\\pnlvlblt\\pnf0{\\pntxtb\\u8226?}}';
      if (block.list === 'number') list = `{\\pntext ${number}.\\tab}{\\*\\pn\\pnlvlbody\\pndec\\pnstart${number}{\\pntxta .}}`;
      body += `{${id}\\pard\\${{ left: 'ql', center: 'qc', right: 'qr', justify: 'qj' }[block.align]}\\li${exactUnit(block.indent, 20, 'Indent')}\\sl${exactUnit(block.spacing, 240, 'Line spacing')}\\slmult1${block.tabs.map(tab => `\\tx${exactUnit(tab, 20, 'Tab stop')}`).join('')}${list}${runs(block.runs)}\\par}\n`;
    } else if (block.type === 'table') {
      number = 0;
      body += `{${id}${block.rows.map(row => `\\trowd${row.map((_, i) => `\\cellx${Math.round(9360 * (i + 1) / row.length)}`).join('')}${row.map(cell => `\\pard\\intbl ${runs(cell.runs)}\\cell`).join('')}\\row`).join('\n')}}\n`;
    } else {
      number = 0;
      // Only local identity metadata, never embedded external bytes or native RTF/OLE attachments.
      body += `{${id}{\\*\\jesterosattachment ${hex(block.fileId)} ${hex(block.name)} ${hex(block.mime)}}}\n`;
    }
  }
  const text = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1${fontTable}${colorTable}\n${body}}`;
  if (text.length > MAX_FILE) fail('limit_exceeded', 'RTF exceeds the supported file limit.');
  return text;
}
function tokenize(source) {
  if (typeof source !== 'string') fail('invalid_arguments', 'Expected an RTF string.');
  if (source.length > MAX_FILE) fail('limit_exceeded', 'RTF exceeds the supported file limit.');
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(source)) fail('unsupported_rtf', 'RTF shared text must use ASCII controls, hex bytes or Unicode escapes.');
  let index = 0, count = 0;
  function group(depth) {
    if (depth > 128 || source[index++] !== '{') fail('invalid_rtf', 'Invalid or excessively nested RTF group.');
    const tokens = [];
    while (index < source.length) {
      if (++count > 2 * TEXTEDIT_CONTENT_LIMITS.text) fail('limit_exceeded', 'RTF token limit exceeded.');
      const character = source[index++];
      if (character === '}') return tokens;
      if (character === '{') { index--; tokens.push({ group: group(depth + 1) }); continue; }
      if (character === '\r' || character === '\n') continue;
      if (character !== '\\') { let text = character; while (index < source.length && !/[{}\\\r\n]/.test(source[index])) text += source[index++]; tokens.push({ text }); continue; }
      const symbol = source[index++];
      if (symbol === undefined) fail('invalid_rtf', 'Truncated RTF escape.');
      if (symbol === "'") {
        const value = source.slice(index, index + 2); if (!/^[0-9a-f]{2}$/i.test(value)) fail('invalid_rtf', 'Invalid RTF hex escape.');
        index += 2; tokens.push({ text: cpDecoder.decode(Uint8Array.of(parseInt(value, 16))) }); continue;
      }
      if (!/[a-z]/i.test(symbol)) { tokens.push({ symbol }); continue; }
      let word = symbol; while (/[a-z]/i.test(source[index] ?? '') && index < source.length) word += source[index++];
      if (word.length > 32) fail('invalid_rtf', 'RTF control word exceeds 32 letters.');
      let digits = ''; if (source[index] === '-') digits = source[index++];
      while (index < source.length && /[0-9]/.test(source[index])) digits += source[index++];
      if (digits === '-' || digits.length > 11) fail('invalid_rtf', 'Invalid RTF numeric parameter.');
      const n = digits ? Number(digits) : undefined;
      if (n !== undefined && (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647)) fail('invalid_rtf', 'RTF parameter out of range.');
      if (source[index] === ' ') index++;
      tokens.push({ word, n });
    }
    fail('invalid_rtf', 'Unclosed RTF group.');
  }
  while (/\s/.test(source[index] ?? '') && index < source.length) index++;
  const result = group(0);
  if (source.slice(index).trim()) fail('invalid_rtf', 'Unexpected content after RTF root.');
  if (result[0]?.word !== 'rtf' || result[0].n !== 1) fail('invalid_rtf', 'Expected RTF version 1.');
  return result;
}
const head = tokens => tokens[0]?.symbol === '*' ? tokens[1]?.word : tokens[0]?.word;
const copyMarks = () => ({ ...TEXTEDIT_MARK_DEFAULTS });
const paragraphDefaults = () => ({ align: 'left', spacing: 1, indent: 0, list: 'none', tabs: [] });
function readLiteral(tokens, inheritedUc = 1) {
  let result = '', uc = inheritedUc, skip = 0;
  for (const token of tokens) {
    if (token.group) { if (skip) fail('unsupported_rtf', 'Unicode fallback cannot cross literal groups.'); result += readLiteral(token.group, uc); continue; }
    if (skip && (token.word || token.symbol)) { if (token.word === 'bin') fail('unsupported_rtf', 'Binary RTF fallback is unsupported.'); skip--; continue; }
    if (token.text !== undefined) { result += token.text.slice(skip); skip = Math.max(0, skip - token.text.length); }
    else if (token.word === 'uc') { if (!Number.isInteger(token.n) || token.n < 0 || token.n > 16) fail('invalid_rtf', 'Invalid Unicode fallback length.'); uc = token.n; }
    else if (token.word === 'u') { if (!Number.isInteger(token.n) || token.n < -32768 || token.n > 32767 || skip) fail('invalid_rtf', 'Invalid Unicode escape.'); result += String.fromCharCode(token.n & 65535); skip = uc; }
    else if (['\\', '{', '}'].includes(token.symbol)) { if (skip) skip--; else result += token.symbol; }
    else if (token.word === 'tab' || token.word === 'line') { if (skip) skip--; else result += token.word === 'tab' ? '\t' : '\n'; }
    else if (token.symbol === '*' || ['f', 'fnil', 'froman', 'fswiss', 'fmodern', 'fscript', 'fdecor', 'ftech', 'fbidi', 'fcharset', 'fldinst', 'pntxtb', 'pntxta', 'pntext', 'jesterosid', 'jesterosattachment'].includes(token.word)) { /* Validated literal destination/header. */ }
    else fail('unsupported_rtf', 'Unsupported control in literal RTF destination.');
  }
  if (skip) fail('invalid_rtf', 'Truncated Unicode literal fallback.');
  return result;
}
export function parseTextEditRtf(source) {
  const root = tokenize(source), fonts = new Map(), colors = ['#000000'];
  let defaultFont = 0, headerUc = 1;
  for (const token of root) {
    if (token.word === 'deff') defaultFont = token.n;
    if (token.word === 'uc') headerUc = token.n;
    if (!token.group) continue;
    const destination = head(token.group);
    if (destination === 'fonttbl') {
      for (const entry of token.group.slice(1)) {
        if (!entry.group) fail('unsupported_rtf', 'Only grouped font table entries are supported.');
        const definition = entry.group, font = definition.find(value => value.word === 'f');
        if (!font || !Number.isInteger(font.n) || font.n < 0 || fonts.has(font.n)) fail('invalid_rtf', 'Invalid font index.');
        for (const value of definition) if (value.word && !['f', 'fnil', 'froman', 'fswiss', 'fmodern', 'fscript', 'fdecor', 'ftech', 'fbidi', 'fcharset', 'uc', 'u'].includes(value.word)) fail('unsupported_rtf', `Unsupported font property ${value.word}.`);
        if (definition.some(value => value.word === 'fcharset' && value.n !== 0)) fail('unsupported_rtf', 'Only ANSI/Unicode RTF fonts are supported.');
        const name = readLiteral(definition, headerUc); if (!name.endsWith(';') || name.slice(0, -1).includes(';')) fail('invalid_rtf', 'Invalid font name terminator.');
        fonts.set(font.n, name.slice(0, -1));
      }
    } else if (destination === 'colortbl') {
      let red = 0, green = 0, blue = 0, index = 0;
      for (const value of token.group.slice(1)) {
        if (value.word) {
          if (!['red', 'green', 'blue'].includes(value.word) || !Number.isInteger(value.n) || value.n < 0 || value.n > 255) fail('unsupported_rtf', 'Unsupported color table entry.');
          if (value.word === 'red') red = value.n; if (value.word === 'green') green = value.n; if (value.word === 'blue') blue = value.n;
        } else if (value.text !== undefined) {
          for (const character of value.text) {
            if (character !== ';') fail('invalid_rtf', 'Invalid color table text.');
            colors[index++] = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`; red = green = blue = 0;
          }
        } else fail('unsupported_rtf', 'Unsupported color table group.');
      }
    }
  }
  if (!fonts.size) fonts.set(0, TEXTEDIT_MARK_DEFAULTS.font);
  if (!fonts.has(defaultFont)) fail('invalid_rtf', 'Default font does not exist.');
  const blocks = [], usedIds = new Set(); let sequence = 1, pendingId = null, pending = [], pendingProps = paragraphDefaults(), row = null, table = null, cellBounds = [], fallback = 0, textUnits = 0;
  let emptyMarks = { ...copyMarks(), font: fonts.get(defaultFont) };
  const id = () => { let result = pendingId; pendingId = null; if (!result) { do { result = `rtf-block-${sequence++}`; } while (usedIds.has(result)); } if (usedIds.has(result)) fail('invalid_rtf', 'Duplicate block ID.'); usedIds.add(result); return result; };
  const append = (text, state) => {
    if (fallback) { const removed = Math.min(text.length, fallback); fallback -= removed; text = text.slice(removed); }
    if (!text) return;
    textUnits += text.length; if (textUnits > TEXTEDIT_CONTENT_LIMITS.text) fail('limit_exceeded', 'RTF text limit exceeded.');
    pendingProps = { ...state.props, tabs: [...state.props.tabs] };
    const previous = pending.at(-1);
    if (previous && Object.keys(TEXTEDIT_MARK_DEFAULTS).every(key => previous.marks[key] === state.marks[key])) previous.text += text;
    else pending.push({ text, marks: { ...state.marks } });
  };
  const finishRuns = () => { const result = pending.length ? pending : [{ text: '', marks: { ...emptyMarks } }]; pending = []; emptyMarks = { ...copyMarks(), font: fonts.get(defaultFont) }; return result; };
  const finishParagraph = state => {
    if (row) fail('unsupported_rtf', 'Multiple paragraphs per table cell are not supported.');
    const props = state.props;
    blocks.push({ id: id(), type: 'paragraph', runs: finishRuns(), ...props, tabs: [...props.tabs] }); table = null;
  };
  function walk(tokens, inherited) {
    const state = { marks: { ...inherited.marks }, props: { ...inherited.props, tabs: [...inherited.props.tabs] }, uc: inherited.uc };
    let listFallback = null;
    for (const token of tokens) {
      if (token.group) {
        if (fallback) fail('unsupported_rtf', 'Unicode fallback cannot cross RTF groups.');
        const values = token.group, destination = head(values);
        if (['fonttbl', 'colortbl'].includes(destination)) continue;
        if (destination === 'jesterosid') {
          if (pendingId || pending.length) fail('invalid_rtf', 'Misplaced block ID metadata.');
          pendingId = unhex(readLiteral(values).trim()); continue;
        }
        if (destination === 'jesterosattachment') {
          if (pending.length || row) fail('invalid_rtf', 'Misplaced attachment metadata.');
          const fields = readLiteral(values).trim().split(' '); if (fields.length !== 3) fail('invalid_rtf', 'Invalid attachment metadata.');
          blocks.push({ id: id(), type: 'attachment', fileId: unhex(fields[0]), name: unhex(fields[1]), mime: unhex(fields[2]) }); table = null; continue;
        }
        if (destination === 'pntext') {
          if (listFallback !== null) fail('invalid_rtf', 'Duplicate list fallback text.');
          listFallback = readLiteral(values, state.uc); continue;
        }
        if (destination === 'pn') {
          const bullet = values.some(value => value.word === 'pnlvlblt'), decimal = values.some(value => value.word === 'pndec');
          if (bullet === decimal) fail('unsupported_rtf', 'Only simple bullet and decimal lists are supported.');
          const allowed = ['pn', 'pnlvlblt', 'pnlvlbody', 'pndec', 'pnstart', 'pnf'];
          if (values.some(value => value.word && !allowed.includes(value.word)) || values.some(value => value.group && !['pntxtb', 'pntxta'].includes(head(value.group)))) fail('unsupported_rtf', 'Unsupported list properties.');
          const prefix = values.find(value => value.group && head(value.group) === 'pntxtb'), suffix = values.find(value => value.group && head(value.group) === 'pntxta');
          if ((bullet && (!prefix || readLiteral(prefix.group, state.uc) !== '•')) || (decimal && (prefix || !suffix || readLiteral(suffix.group, state.uc) !== '.'))) fail('unsupported_rtf', 'Only bullet and decimal-dot list markers are supported.');
          const start = values.find(value => value.word === 'pnstart');
          const previous = blocks.at(-1), expected = previous?.type === 'paragraph' && previous.list === 'number'
            ? (() => { let count = 1; for (let i = blocks.length - 1; i >= 0 && blocks[i].type === 'paragraph' && blocks[i].list === 'number'; i--) count++; return count; })() : 1;
          if (decimal && start && start.n !== expected) fail('unsupported_rtf', 'Custom numbering starts/restarts are not representable.');
          if (listFallback !== (bullet ? '•\t' : `${expected}.\t`)) fail('unsupported_rtf', 'List fallback text does not match supported numbering.');
          listFallback = null;
          state.props.list = bullet ? 'bullet' : 'number'; continue;
        }
        if (destination === 'field') {
          const instructions = values.find(value => value.group && head(value.group) === 'fldinst'), result = values.find(value => value.group && head(value.group) === 'fldrslt');
          if (!instructions || !result || values.length !== 3) fail('unsupported_rtf', 'Only simple HYPERLINK fields are supported.');
          const instruction = readLiteral(instructions.group, state.uc), match = /^HYPERLINK "((?:[^"\\]|\\["\\])*)"$/.exec(instruction);
          if (!match) fail('unsupported_rtf', 'Unsupported field instruction.');
          const link = match[1].replace(/\\(["\\])/g, '$1');
          walk(result.group.slice(1), { ...state, marks: { ...state.marks, link } }); continue;
        }
        if (values[0]?.symbol === '*') fail('unsupported_rtf', `Unsupported RTF destination ${destination ?? '(unknown)'}.`);
        walk(values, state); continue;
      }
      if (token.text !== undefined) { append(token.text, state); continue; }
      if (token.symbol !== undefined) {
        if (fallback) { fallback--; continue; }
        if (['\\', '{', '}'].includes(token.symbol)) append(token.symbol, state);
        else if (token.symbol === '~') append('\u00a0', state);
        else if (token.symbol === '-') append('\u00ad', state);
        else if (token.symbol === '_') append('\u2011', state);
        else fail('unsupported_rtf', `Unsupported RTF symbol ${token.symbol}.`);
        continue;
      }
      const { word, n } = token;
      if (fallback) { if (word === 'bin') fail('unsupported_rtf', 'Binary RTF fallback is unsupported.'); fallback--; continue; }
      const parameter = () => { if (!Number.isInteger(n)) fail('invalid_rtf', `${word} needs an integer parameter.`); return n; };
      if (word === 'rtf') { if (n !== 1) fail('unsupported_rtf', 'Unsupported RTF version.'); }
      else if (word === 'ansi') { /* Supported single-byte fallback. */ }
      else if (word === 'ansicpg') { if (n !== 1252) fail('unsupported_rtf', 'Only Windows-1252 RTF fallback is supported.'); }
      else if (word === 'deff') { parameter(); }
      else if (word === 'uc') { state.uc = parameter(); if (n < 0 || n > 16) fail('invalid_rtf', 'Invalid Unicode fallback length.'); }
      else if (word === 'u') { parameter(); if (n < -32768 || n > 32767 || fallback) fail('invalid_rtf', 'Invalid or truncated Unicode fallback.'); append(String.fromCharCode(n & 65535), state); fallback = state.uc; }
      else if (word === 'plain') { const link = state.marks.link; state.marks = { ...copyMarks(), font: fonts.get(defaultFont), link }; }
      else if (word === 'pard') state.props = paragraphDefaults();
      else if (['b', 'i', 'ul', 'strike'].includes(word)) state.marks[{ b: 'bold', i: 'italic', ul: 'underline', strike: 'strike' }[word]] = n !== 0;
      else if (word === 'ulnone') state.marks.underline = false;
      else if (word === 'f') { if (!fonts.has(parameter())) fail('invalid_rtf', 'Unknown font index.'); state.marks.font = fonts.get(n); }
      else if (word === 'fs') state.marks.size = parameter() / 2;
      else if (word === 'cf') { if (!colors[parameter()]) fail('invalid_rtf', 'Unknown color index.'); state.marks.color = colors[n]; }
      else if (['ql', 'qc', 'qr', 'qj'].includes(word)) state.props.align = { ql: 'left', qc: 'center', qr: 'right', qj: 'justify' }[word];
      else if (word === 'li') state.props.indent = parameter() / 20;
      else if (word === 'sl') { state.props.spacing = parameter() / 240; const following = tokens[tokens.indexOf(token) + 1]; if (following?.word !== 'slmult' || following.n !== 1) fail('unsupported_rtf', 'Only proportional line spacing is supported.'); }
      else if (word === 'slmult') { if (n !== 1) fail('unsupported_rtf', 'Only proportional line spacing is supported.'); }
      else if (word === 'tx') state.props.tabs.push(parameter() / 20);
      else if (word === 'tab') append('\t', state);
      else if (word === 'line') append('\n', state);
      else if (word === 'par') finishParagraph(state);
      else if (word === 'trowd') {
        if (row || pending.length) fail('invalid_rtf', 'Misplaced table row.'); row = []; cellBounds = [];
        if (!table || pendingId) { table = { id: id(), type: 'table', rows: [] }; blocks.push(table); }
      }
      else if (word === 'cellx') { if (!row || parameter() <= (cellBounds.at(-1) ?? 0)) fail('invalid_rtf', 'Invalid cell boundary.'); cellBounds.push(n); }
      else if (word === 'intbl') { if (!row) fail('invalid_rtf', 'Cell content without a row.'); }
      else if (word === 'cell') {
        if (!row) fail('invalid_rtf', 'Cell outside table.');
        if (state.props.align !== 'left' || state.props.spacing !== 1 || state.props.indent !== 0 || state.props.list !== 'none' || state.props.tabs.length)
          fail('unsupported_rtf', 'Paragraph formatting in table cells is not representable.');
        row.push({ runs: finishRuns() });
      }
      else if (word === 'row') {
        if (!row || pending.length || !row.length || row.length !== cellBounds.length) fail('invalid_rtf', 'Cell count does not match row definition.');
        // Canonical tables have equal cells: reject nonuniform geometry instead of discarding it.
        const widths = cellBounds.map((bound, i) => bound - (cellBounds[i - 1] ?? 0));
        if (Math.max(...widths) - Math.min(...widths) > 1 || cellBounds.at(-1) !== 9360) fail('unsupported_rtf', 'Only equal columns in a 468-point table are representable.');
        table.rows.push(row); row = null;
      }
      else fail('unsupported_rtf', `Unsupported RTF control word ${word}.`);
      if (blocks.length > TEXTEDIT_CONTENT_LIMITS.blocks) fail('limit_exceeded', 'RTF block limit exceeded.');
      if (['plain', 'b', 'i', 'ul', 'strike', 'ulnone', 'f', 'fs', 'cf'].includes(word)) emptyMarks = { ...state.marks };
    }
    if (fallback) fail('invalid_rtf', 'Truncated Unicode fallback at group boundary.');
    if (listFallback !== null) fail('unsupported_rtf', 'List fallback has no supported list definition.');
  }
  walk(root, { marks: { ...copyMarks(), font: fonts.get(defaultFont) }, props: paragraphDefaults(), uc: 1 });
  if (fallback || row || pendingId) fail('invalid_rtf', 'Truncated RTF content or metadata.');
  if (pending.length) { blocks.push({ id: id(), type: 'paragraph', runs: finishRuns(), ...pendingProps }); }
  const content = blocks.length ? { kind: 'rich', blocks } : createTextEditContent();
  if (!validateTextEditContent(content)) fail('invalid_rtf', 'RTF exceeds canonical content constraints.');
  return content;
}
export function encodeTextEditFile(content, encoding = 'utf-8') {
  assert(content); if (!TEXTEDIT_ENCODINGS.includes(encoding)) fail('unsupported_encoding', 'Encoding must be utf-8, utf-16le or windows-1252.');
  if (content.kind === 'rich') {
    if (encoding !== 'utf-8') fail('unsupported_encoding', 'Rich RTF uses ASCII controls with Unicode escapes; plain encodings do not apply.');
    return { text: serializeTextEditRtf(content), mime: 'application/rtf', encoding: 'utf-8' };
  }
  const text = textEditPlainText(content);
  if (encoding === 'utf-8') return { text, mime: 'text/plain;charset=utf-8', encoding };
  let bytes;
  if (encoding === 'utf-16le') {
    bytes = new Uint8Array(2 + text.length * 2); bytes[0] = 255; bytes[1] = 254;
    for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); bytes[i * 2 + 2] = code & 255; bytes[i * 2 + 3] = code >>> 8; }
  } else {
    bytes = new Uint8Array(text.length); let i = 0;
    for (const character of text) { if (!cpMap.has(character)) fail('unrepresentable_character', 'Windows-1252 cannot represent every document character.'); bytes[i++] = cpMap.get(character); }
  }
  return { text: `${TEXTEDIT_BYTE_PREFIX}${encoding}:${bytes64(bytes)}`, mime: `text/plain;charset=${encoding};jesteros-bytes=base64`, encoding };
}
export function decodeTextEditFile(file) {
  if (!file || typeof file !== 'object') fail('invalid_arguments', 'Expected a shared Files record.');
  const properties = Object.getOwnPropertyDescriptors(file);
  if (!properties.text || !('value' in properties.text) || !properties.mime || !('value' in properties.mime)
    || typeof file.text !== 'string' || typeof file.mime !== 'string' || file.text.length > MAX_FILE) fail('invalid_arguments', 'Expected bounded shared Files text and MIME.');
  const mime = file.mime.toLowerCase(), base = mime.split(';')[0].trim();
  if (base === 'application/rtf' || base === 'text/rtf') return { content: parseTextEditRtf(file.text), encoding: 'utf-8' };
  if (base !== 'text/plain') fail('unsupported_file_type', 'Only plain text and supported-subset RTF are supported.');
  const charset = /(?:^|;)\s*charset=([^;\s]+)/.exec(mime)?.[1] ?? 'utf-8';
  if (!TEXTEDIT_ENCODINGS.includes(charset)) fail('unsupported_encoding', 'Unsupported plain text encoding.');
  const encoded = /(?:^|;)\s*jesteros-bytes=base64(?:;|$)/.test(mime);
  if (!encoded) {
    if (charset !== 'utf-8') fail('invalid_encoding', 'Non-UTF8 shared text requires an explicit byte representation.');
    return { content: createTextEditContent(file.text, 'plain'), encoding: 'utf-8' };
  }
  const prefix = `${TEXTEDIT_BYTE_PREFIX}${charset}:`;
  if (charset === 'utf-8' || !file.text.startsWith(prefix)) fail('invalid_encoding', 'Byte discriminator and MIME encoding disagree.');
  const bytes = from64(file.text.slice(prefix.length));
  if (charset === 'utf-16le' && (bytes.length < 2 || bytes.length % 2 || bytes[0] !== 255 || bytes[1] !== 254)) fail('invalid_encoding', 'Expected BOM-marked UTF-16LE bytes.');
  let text;
  try { text = new TextDecoder(charset, { fatal: true, ignoreBOM: true }).decode(charset === 'utf-16le' ? bytes.subarray(2) : bytes); }
  catch { fail('invalid_encoding', 'Malformed encoded plain text bytes.'); }
  return { content: createTextEditContent(text, 'plain'), encoding: charset };
}

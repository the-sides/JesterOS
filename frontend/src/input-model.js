import { object, flag, choice } from './command-schema.js';
import { isRecord } from './feature-commands.js';

export const INPUT_SOURCES = Object.freeze([
  Object.freeze({ id: 'us', name: 'U.S.', language: 'English', layout: 'QWERTY', short: 'US' }),
  Object.freeze({ id: 'fr', name: 'French', language: 'French', layout: 'AZERTY', short: 'FR' }),
  Object.freeze({ id: 'de', name: 'German', language: 'German', layout: 'QWERTZ', short: 'DE' }),
]);
const sourceId = choice('us', 'fr', 'de');
export const inputSchema = object({
  sourceIds: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: sourceId },
  activeSourceId: sourceId, previousSourceId: { oneOf: [sourceId, { type: 'null' }] }, showInMenuBar: flag,
});
const stateKeys = ['sourceIds', 'activeSourceId', 'previousSourceId', 'showInMenuBar'];
const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
const validSource = value => ['us', 'fr', 'de'].includes(value);
function validSources(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.value < 1 || length.value > 3
    || Reflect.ownKeys(value).length !== length.value + 1) return false;
  const seen = new Set();
  for (let index = 0; index < length.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || !validSource(descriptor.value) || seen.has(descriptor.value)) return false;
    seen.add(descriptor.value);
  }
  return true;
}
export const inputDefaults = () => ({ sourceIds: ['us', 'fr', 'de'], activeSourceId: 'us', previousSourceId: null, showInMenuBar: true });
export function validateInputState(state) {
  try {
    if (closedData(state, stateKeys) && validSources(state.sourceIds) && validSource(state.activeSourceId)
      && state.sourceIds.includes(state.activeSourceId) && typeof state.showInMenuBar === 'boolean'
      && (state.previousSourceId === null || validSource(state.previousSourceId)
        && state.previousSourceId !== state.activeSourceId && state.sourceIds.includes(state.previousSourceId))) return { ok: true };
  } catch { /* Exotic descriptor/prototype traps cannot authorize canonical input. */ }
  return { ok: false, message: 'Input requires complete closed literal preferences, one to three distinct authored U.S./French/German sources, a configured active source, a different configured previous source or null, and a boolean menu preference. Browser physical keyboard and host IME are unchanged.' };
}
export function inputSummary(state) {
  const validation = validateInputState(state);
  if (!validation.ok) throw new TypeError(validation.message);
  const availableSources = INPUT_SOURCES.map(source => ({ ...source }));
  const sources = state.sourceIds.map(id => ({ ...INPUT_SOURCES.find(source => source.id === id) }));
  const activeSource = { ...INPUT_SOURCES.find(source => source.id === state.activeSourceId) };
  return { sourceIds: [...state.sourceIds], activeSourceId: state.activeSourceId,
    previousSourceId: state.previousSourceId, showInMenuBar: state.showInMenuBar,
    sources, availableSources, activeSource, label: activeSource.short };
}

// Original bounded Latin layouts: spacing accent glyphs insert literally; there
// is no dead-key or host IME composition, and Option is our authored symbol layer.
const codes = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['IntlBackslash', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
const layouts = {
  us: {
    base: [['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], [...'qwertyuiop', '[', ']', '\\'], [...'asdfghjkl', ';', "'"], ['\\', ...'zxcvbnm', ',', '.', '/']],
    shift: [['~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+'], [...'QWERTYUIOP', '{', '}', '|'], [...'ASDFGHJKL', ':', '"'], ['|', ...'ZXCVBNM', '<', '>', '?']],
  },
  fr: {
    base: [['²', '&', 'é', '"', "'", '(', '-', 'è', '_', 'ç', 'à', ')', '='], [...'azertyuiop', '^', '$', '*'], [...'qsdfghjklm', 'ù'], ['<', ...'wxcvbn', ',', ';', ':', '!']],
    shift: [['²', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '°', '+'], [...'AZERTYUIOP', '¨', '£', 'µ'], [...'QSDFGHJKLM', '%'], ['>', ...'WXCVBN', '?', '.', '/', '§']],
  },
  de: {
    base: [['^', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß', '´'], [...'qwertzuiop', 'ü', '+', '#'], [...'asdfghjkl', 'ö', 'ä'], ['<', ...'yxcvbnm', ',', '.', '-']],
    shift: [['°', '!', '"', '§', '$', '%', '&', '/', '(', ')', '=', '?', '`'], [...'QWERTZUIOP', 'Ü', '*', "'"], [...'ASDFGHJKL', 'Ö', 'Ä'], ['>', ...'YXCVBNM', ';', ':', '_']],
  },
};
const optionSymbols = {
  Backquote: '≈', Digit1: '¡', Digit2: '™', Digit3: '£', Digit4: '¢', Digit5: '∞', Digit6: '§', Digit7: '¶', Digit8: '•', Digit9: 'ª', Digit0: 'º', Minus: '–', Equal: '≠',
  KeyQ: 'œ', KeyW: '∑', KeyE: '€', KeyR: '®', KeyT: '†', KeyY: '¥', KeyU: 'ü', KeyI: 'î', KeyO: 'ø', KeyP: 'π', BracketLeft: '«', BracketRight: '»', Backslash: '¬',
  KeyA: 'æ', KeyS: 'ß', KeyD: '∂', KeyF: 'ƒ', KeyG: '©', KeyH: '˙', KeyJ: '∆', KeyK: '˚', KeyL: '¬', Semicolon: '…', Quote: '’',
  IntlBackslash: '≤', KeyZ: 'Ω', KeyX: '≈', KeyC: 'ç', KeyV: '√', KeyB: '∫', KeyN: 'ñ', KeyM: 'µ', Comma: '≤', Period: '≥', Slash: '÷',
};
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row.map(key => Object.freeze(key)))));
const key = (keyId, label, text, action = 'insert') => ({ keyId, label, text, action });
const layoutRows = new Map();
for (const source of INPUT_SOURCES) for (const shift of [false, true]) for (const option of [false, true]) {
  const glyphs = layouts[source.id][shift ? 'shift' : 'base'];
  const rows = codes.map((row, rowIndex) => row.filter(code => source.id !== 'us' || code !== 'IntlBackslash').map(code => {
    const index = row.indexOf(code);
    const text = option ? optionSymbols[code] : glyphs[rowIndex][index];
    return key(code, text, text);
  }));
  rows[0].push(key('Backspace', '⌫', '', 'backspace'));
  rows[2].push(key('Enter', 'Return', '\n', 'newline'));
  rows[3].unshift(key('Shift', 'Shift', '', 'modifier'));
  rows.push([key('Option', 'Option', '', 'modifier'), key('Space', 'Space', ' ')]);
  layoutRows.set(`${source.id}:${shift}:${option}`, freezeRows(rows));
}
const noRows = Object.freeze([]);
export function keyboardRows(source, { shift = false, option = false } = {}) {
  return layoutRows.get(`${source}:${shift === true}:${option === true}`) ?? noRows;
}

const characters = [
  ['grinning-face', '😀', 'Grinning face', 'emoji', ['happy', 'smile']],
  ['joy', '😂', 'Face with tears of joy', 'emoji', ['laugh', 'funny']],
  ['smiling-heart-eyes', '😍', 'Smiling face with heart eyes', 'emoji', ['love', 'admire']],
  ['thinking-face', '🤔', 'Thinking face', 'emoji', ['think', 'question']],
  ['waving-hand', '👋', 'Waving hand', 'emoji', ['hello', 'goodbye']],
  ['thumbs-up', '👍', 'Thumbs up', 'emoji', ['yes', 'approve']],
  ['clapping-hands', '👏', 'Clapping hands', 'emoji', ['applause', 'well done']],
  ['red-heart', '❤️', 'Red heart', 'emoji', ['love', 'affection']],
  ['sparkles', '✨', 'Sparkles', 'emoji', ['magic', 'shine']],
  ['party-popper', '🎉', 'Party popper', 'emoji', ['celebrate', 'party']],
  ['fire', '🔥', 'Fire', 'emoji', ['flame', 'hot']],
  ['sun', '☀️', 'Sun', 'emoji', ['weather', 'sunny']],
  ['coffee', '☕', 'Hot beverage', 'emoji', ['coffee', 'tea']],
  ['globe', '🌍', 'Globe showing Europe and Africa', 'emoji', ['earth', 'world']],
  ['family', '👨‍👩‍👧', 'Family: man, woman, girl', 'emoji', ['family', 'parents', 'child']],
  ['woman-technologist', '👩‍💻', 'Woman technologist', 'emoji', ['computer', 'developer', 'work']],
  ['euro', '€', 'Euro sign', 'symbols', ['currency', 'money']],
  ['pound', '£', 'Pound sign', 'symbols', ['sterling', 'currency']],
  ['yen', '¥', 'Yen sign', 'symbols', ['currency', 'money']],
  ['copyright', '©', 'Copyright sign', 'symbols', ['rights', 'legal']],
  ['registered', '®', 'Registered sign', 'symbols', ['trademark', 'legal']],
  ['trademark', '™', 'Trade mark sign', 'symbols', ['brand', 'legal']],
  ['degree', '°', 'Degree sign', 'symbols', ['temperature', 'angle']],
  ['plus-minus', '±', 'Plus-minus sign', 'symbols', ['math', 'tolerance']],
  ['multiply', '×', 'Multiplication sign', 'symbols', ['math', 'times']],
  ['divide', '÷', 'Division sign', 'symbols', ['math', 'divide']],
  ['not-equal', '≠', 'Not equal to', 'symbols', ['math', 'comparison']],
  ['less-equal', '≤', 'Less-than or equal to', 'symbols', ['math', 'comparison']],
  ['greater-equal', '≥', 'Greater-than or equal to', 'symbols', ['math', 'comparison']],
  ['infinity', '∞', 'Infinity', 'symbols', ['math', 'infinite']],
  ['right-arrow', '→', 'Rightwards arrow', 'symbols', ['direction', 'right']],
  ['ellipsis', '…', 'Horizontal ellipsis', 'symbols', ['punctuation', 'dots']],
  ['a-grave', 'à', 'Latin small letter a with grave', 'latin', ['French', 'accent']],
  ['a-umlaut', 'ä', 'Latin small letter a with diaeresis', 'latin', ['German', 'umlaut']],
  ['a-ring', 'å', 'Latin small letter a with ring above', 'latin', ['ring', 'Nordic']],
  ['ae', 'æ', 'Latin small letter ae', 'latin', ['ligature', 'Nordic']],
  ['c-cedilla', 'ç', 'Latin small letter c with cedilla', 'latin', ['French', 'cedilla']],
  ['e-acute', 'é', 'Latin small letter e with acute', 'latin', ['French', 'accent']],
  ['e-grave', 'è', 'Latin small letter e with grave', 'latin', ['French', 'accent']],
  ['e-circumflex', 'ê', 'Latin small letter e with circumflex', 'latin', ['French', 'accent']],
  ['i-circumflex', 'î', 'Latin small letter i with circumflex', 'latin', ['French', 'accent']],
  ['n-tilde', 'ñ', 'Latin small letter n with tilde', 'latin', ['Spanish', 'tilde']],
  ['o-umlaut', 'ö', 'Latin small letter o with diaeresis', 'latin', ['German', 'umlaut']],
  ['o-stroke', 'ø', 'Latin small letter o with stroke', 'latin', ['Nordic', 'stroke']],
  ['oe', 'œ', 'Latin small ligature oe', 'latin', ['French', 'ligature']],
  ['sharp-s', 'ß', 'Latin small letter sharp s', 'latin', ['German', 'eszett']],
  ['u-grave', 'ù', 'Latin small letter u with grave', 'latin', ['French', 'accent']],
  ['u-umlaut', 'ü', 'Latin small letter u with diaeresis', 'latin', ['German', 'umlaut']],
];
export const CHARACTER_CATALOG = Object.freeze(characters.map(([id, text, name, category, keywords]) =>
  Object.freeze({ id, text, name, category, keywords: Object.freeze(keywords) })));
const byCharacterId = new Map(CHARACTER_CATALOG.map(record => [record.id, record]));
const searchable = new Map(CHARACTER_CATALOG.map(record => [record.id,
  `${record.text} ${record.name} ${record.keywords.join(' ')} ${[...record.text].map(glyph => `U+${glyph.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}`.toLocaleLowerCase('en-US')]));
export const characterById = id => byCharacterId.get(id) ?? null;
export function characterResults(query = '', category = 'all') {
  if (typeof query !== 'string' || !['all', 'emoji', 'symbols', 'latin'].includes(category)) return [];
  const terms = query.trim().toLocaleLowerCase('en-US').split(/\s+/u).filter(Boolean);
  return CHARACTER_CATALOG.filter(record => (category === 'all' || record.category === category)
    && terms.every(term => searchable.get(record.id).includes(term)));
}

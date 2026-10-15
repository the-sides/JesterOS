import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { createTextEditController } from '../frontend/src/textedit-commands.js';
import { createTextEditState, TEXTEDIT_PROFILE_IDS } from '../frontend/src/textedit-state.js';
import {
  textEditNativeSegments,
  textEditNativeTypingRange,
  textEditNativeDifference,
  createTextEditNativeView,
} from '../frontend/src/textedit-native.js';
import { createTextEditContent, textEditPlainText } from '../frontend/src/textedit-content.js';
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));

const MARKS = Object.freeze({ bold: false, italic: false, underline: false, strike: false, font: 'Liberation Sans', size: 12, color: '#000000', link: '' });
const run = text => ({ text, marks: { ...MARKS } });
const paragraph = (id, text) => ({ id, type: 'paragraph', runs: [run(text)], align: 'left', spacing: 1, indent: 0, list: 'none', tabs: [] });
const cell = text => ({ runs: [run(text)] });
const EMOJI = '\u{1f600}'; // Two UTF-16 units: every boundary test depends on this.

const mixedDocument = () => ({
  kind: 'rich',
  blocks: [
    paragraph('p1', 'Intro'),
    { id: 't1', type: 'table', rows: [[cell('a1'), cell('b1')]] },
    { id: 'a1', type: 'attachment', fileId: 'file-1', name: 'Poster.png', mime: 'image/png' },
  ],
});

test('segments reproduce the canonical plain projection exactly, including separators', () => {
  const segments = textEditNativeSegments(mixedDocument());
  expect(segments.map(entry => entry.text)).toEqual(['Intro', 'a1', 'b1', '\uFFFC']);
  expect(segments.map(entry => entry.type)).toEqual(['paragraph', 'table', 'table', 'attachment']);
  expect(segments.map(entry => [entry.start, entry.end])).toEqual([[0, 5], [6, 8], [9, 11], [12, 13]]);
  expect(textEditPlainText(mixedDocument())).toBe('Intro\na1\tb1\n\uFFFC');
  expect(segments.at(-1).end).toBe(textEditPlainText(mixedDocument()).length);
});

test('tables report row/column and never merge into paragraph ranges', () => {
  const segments = textEditNativeSegments(mixedDocument());
  expect(segments[1]).toMatchObject({ blockId: 't1', row: 0, column: 0 });
  expect(segments[2]).toMatchObject({ blockId: 't1', row: 0, column: 1 });
});

test('typing deletes respect whole Unicode graphemes, words, and line boundaries', () => {
  const document = createTextEditContent(`Tom${EMOJI}turkey\nsecond slot`, 'rich');
  const text = textEditPlainText(document);
  const at = text.indexOf(EMOJI);
  expect(textEditNativeTypingRange(document, { start: at + 2, end: at + 2 }, 'deleteContentBackward')).toEqual({ start: at, end: at + 2 });
  expect(textEditNativeTypingRange(document, { start: at, end: at }, 'deleteContentForward')).toEqual({ start: at, end: at + 2 });
  const word = textEditNativeTypingRange(document, { start: at, end: at }, 'deleteWordBackward');
  expect(text.slice(word.start, word.end)).toBe('Tom');
  const secondStart = text.indexOf('second');
  expect(textEditNativeTypingRange(document, { start: secondStart, end: secondStart }, 'deleteHardLineForward').end).toBe(text.length);
  expect(textEditNativeTypingRange(document, { start: secondStart + 3, end: secondStart + 3 }, 'deleteWordBackward')).toEqual({ start: secondStart, end: secondStart + 3 });
  // Typed insertion is unchanged at collapsed selection.
  expect(textEditNativeTypingRange(document, { start: 4, end: 4 }, 'insertText')).toEqual({ start: 4, end: 4 });
});

test('difference never splits a surrogate pair inside replaced text', () => {
  expect(textEditNativeDifference(`TomXturkey`, `Tom${EMOJI}turkey`)).toEqual({ start: 3, end: 4, text: EMOJI });
  expect(textEditNativeDifference(`Tom${EMOJI}turkey`, 'Xom turkey').start).not.toBe(4);
  expect(textEditNativeDifference(`a${EMOJI}`, `a`)).toEqual({ start: 1, end: 3, text: '' });
});

function createNativeStub({ kind = 'plain', modal = null } = {}) {
  const listeners = new Map();
  const editor = {
    tagName: kind === 'plain' ? 'TEXTAREA' : 'DIV',
    contentEditable: kind === 'plain' ? undefined : 'true',
    isConnected: true,
    dataset: {},
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientLeft: 0,
    clientTop: 0,
    clientWidth: 320,
    disabled: false,
    hasAttribute: () => false,
    parentElement: null,
    style: { cssText: '', setProperty() {} },
    replaceChildren() {},
    getClientRects: () => [{ width: 320, height: 240 }],
    addEventListener(event, listener) { const list = listeners.get(event) ?? []; list.push(listener); listeners.set(event, list); },
    removeEventListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)); },
    contains() { return true; },
    focus() { stub.focused = editor; },
  };
  const root = {
    isConnected: true,
    dataset: { texteditWindowId: 'win-1' },
    contains: () => true,
    querySelectorAll: () => [],
    getClientRects: () => [{ width: 320, height: 240 }],
  };
  const shadow = { id: 'doc-1', generation: 3 };
  const documentValue = kind === 'plain'
    ? createTextEditContent('Plain test body', 'plain')
    : createTextEditContent('Rich test body', 'rich');
  shadow.content = documentValue;
  const windowValue = { windowId: 'win-1', documentId: 'doc-1', selection: { start: 0, end: documentValue ? textEditPlainText(documentValue).length : 0 }, dialog: modal, find: { query: '', replacement: '', matchCase: false, message: '' }, showRuler: true, wrap: true, zoom: 100, menu: null, typingMarks: null };
  const win = () => windowValue;
  const stub = { editor: null, root, documentValue: shadow, windowValue, focused: null };
  const ownerDocument = {
    activeElement: null,
    defaultView: { getComputedStyle: () => ({ lineHeight: '20px', fontSize: '16px' }) },
    body: { append() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement(name) { return { className: '', tagName: name, style: { cssText: '' }, setAttribute() {}, append() {}, replaceChildren() {}, remove() {}, textContent: '', offsetTop: 0, offsetLeft: 0, classList: { add() {} }, dataset: {}, getContext: () => null }; },
    createTextNode(text) { return { textContent: text }; },
    createRange() { return { setStart() {}, setEnd() {}, collapse() {}, selectNodeContents() {}, compareBoundaryPoints: () => -1, toString: () => '' }; },
    createDocumentFragment() { return { append() {} }; },
    createTreeWalker() { return { nextNode: () => null }; },
    getSelection: () => ({ rangeCount: 0 }),
  };
  editor.ownerDocument = ownerDocument;
  root.ownerDocument = ownerDocument;
  stub.editor = editor;
  function execute() { throw new Error('Read-only native facade probes cannot publish canonical edits.'); }
  const view = createTextEditNativeView({
    getRoot: () => root, getEditor: () => editor, getState: () => stub, getDocument: () => shadow, getWindow: win,
    windowId: 'win-1', available: () => root.isConnected, execute,
  });
  stub.view = view; stub.ownerDocument = ownerDocument; stub.execute = execute;
  return stub;
}

test('facade availability is bound to the original window/document identity and root', () => {
  const stub = createNativeStub();
  expect(stub.view.available()).toBe(true);
  expect(stub.view.documentId()).toBe('doc-1');
  expect(stub.view.generation()).toBe(3);
  expect(stub.view.files()).toEqual([]);
  stub.disconnect = () => { stub.root.isConnected = false; };
  stub.disconnect();
  expect(stub.view.available()).toBe(false);
  expect(stub.view.documentId()).toBe(null);
  expect(stub.view.focus()).toBe(false);
  const other = createNativeStub();
  expect(other.view.available()).toBe(true);
  expect(other.view.documentId()).toBe('doc-1');
  other.root.dataset.texteditWindowId = 'win-2';
  expect(other.view.available()).toBe(false);
});

test('find/spelling sheets keep the editor interactive while modal sheets do not', () => {
  const stub = createNativeStub({ modal: { kind: 'open', message: '', spelling: null } });
  expect(stub.view.available()).toBe(true);
  stub.ownerDocument.activeElement = stub.editor;
  expect(stub.view.captureSelection()).toBe(null);
  expect(stub.view.selectRange({ start: 0, end: 4 })).toBe(false);
  expect(stub.view.replaceSelection('x')).toBe(false);
  const panel = createNativeStub({ modal: { kind: 'find', message: '', spelling: null } });
  panel.ownerDocument.activeElement = panel.editor;
  expect(panel.view.captureSelection()).toEqual({ start: 0, end: 0 });
  expect(panel.view.available()).toBe(true);
});

test('plain capture reads the actual control selection, focused by default and unfocused on request', () => {
  const stub = createNativeStub();
  stub.ownerDocument.activeElement = stub.editor;
  const observed = { start: 4, end: 9 };
  stub.editor.selectionStart = observed.start; stub.editor.selectionEnd = observed.end;
  expect(stub.view.captureSelection()).toEqual(observed);
  stub.ownerDocument.activeElement = null;
  expect(stub.view.captureSelection()).toBe(null);
  expect(stub.view.captureSelection({ allowUnfocused: true })).toEqual(observed);
  expect(stub.view.captureSelection({ allowUnfocused: true }).end).toBe(observed.end);
});

function createNativeConsumer(profileId = 'macos-mojave-10.14', content = null) {
  const profile = { id: profileId, family: profileId.startsWith('windows') ? 'windows' : 'macos' };
  const state = proxy(createTextEditState(profile)), windowId = 'native-rich-window';
  // Literal authoring is tested with the user's typography/spelling preferences disabled.
  Object.assign(state.preferences, { smartQuotes: false, smartDashes: false, spellcheck: false });
  const dom = new JSDOM(`<!doctype html><body><section data-textedit-window-id="${windowId}"><div contenteditable="true" tabindex="0"></div></section></body>`);
  const ownerDocument = dom.window.document, originalRoot = ownerDocument.querySelector('section'), originalEditor = originalRoot.querySelector('div');
  // jsdom has genuine DOM/Range/Selection but no layout or canvas measurement.
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 320, height: 240 }];
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const errors = [], messages = [], pending = [];
  dom.window.addEventListener('error', event => errors.push(event.error));
  const managedWindow = { id: windowId, appId: profile.family === 'windows' ? 'wordpad' : 'textedit' };
  let root = originalRoot, editor = originalEditor, view = null, budget = true;
  const controller = createTextEditController({
    profile, getState: () => state, alive: () => true, canCommit: () => budget,
    getWindow: id => id === windowId ? managedWindow : null,
    getView: id => id === windowId ? view : null,
    available: window => window === managedWindow,
    getSceneTime: () => 1696988520000,
    tick: async () => { view?.render(); },
  });
  expect(controller.windowOpened(managedWindow, { documentKind: 'rich' })).toBe(true);
  const document = state.documents[0], session = state.windows[0], target = { windowId };
  if (content) document.content = content;
  function execute(command, destination, payload) {
    const result = controller.handlers[command](destination, payload);
    if (result?.then) pending.push(result);
    return result;
  }
  view = createTextEditNativeView({
    getRoot: () => root, getEditor: () => editor, getState: () => state,
    getDocument: () => state.documents.find(row => row.id === state.windows.find(row => row.windowId === windowId)?.documentId),
    getWindow: () => state.windows.find(row => row.windowId === windowId), windowId, execute,
    onMessage: message => messages.push(message),
  });
  async function flush() {
    while (pending.length) await Promise.all(pending.splice(0));
    await Promise.resolve();
    view.render();
  }
  function select(from, start, to = from, end = start) {
    const range = ownerDocument.createRange();
    range.setStart(from, start); range.setEnd(to, end);
    const selection = ownerDocument.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    return selection;
  }
  async function publishNativeSelection() {
    // Range mutation alone does not synchronously deliver jsdom's queued event.
    // Exercise the real observer/guarded command before invalidating that DOM.
    ownerDocument.dispatchEvent(new dom.window.Event('selectionchange'));
    await flush();
  }
  async function nativeInput(inputType = 'insertReplacementText') {
    originalEditor.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType }));
    await flush();
  }
  async function fill(text) {
    originalEditor.focus();
    if (text) {
      const node = ownerDocument.createTextNode(text);
      originalEditor.replaceChildren(node); select(node, text.length);
    } else { originalEditor.replaceChildren(); select(originalEditor, 0); }
    await nativeInput();
  }
  async function type(text) {
    const event = new dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text });
    originalEditor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flush();
  }
  return { dom, ownerDocument, root: originalRoot, editor: originalEditor, state, document, session, view, errors, messages, flush, select, type, fill, nativeInput, publishNativeSelection,
    run: (command, payload) => controller.handlers[`textedit.${command}`](target, payload),
    setRoot: value => { root = value; }, setEditor: value => { editor = value; }, setBudget: value => { budget = value; } };
}

for (const profileId of TEXTEDIT_PROFILE_IDS) {
  test(`${profileId}: original rich empty editor recovers native DOM replacement and authors literal Unicode with a real caret`, async () => {
    const h = createNativeConsumer(profileId);
    try {
      expect(h.view.selectRange({ start: 0, end: 0 })).toBe(true);
      expect((await h.run('format', { bold: true })).status).toBe('applied');
      const generation = h.document.generation, oldParagraph = h.editor.firstChild;
      // Native contenteditable fill('') detaches the rendered paragraph while its editor stays mounted.
      h.editor.replaceChildren(); h.select(h.editor, 0);
      expect(oldParagraph.isConnected).toBe(false);
      expect(oldParagraph.ownerDocument).toBe(h.ownerDocument);
      expect(h.view.captureSelection()).toBe(null);
      expect(h.view.selectRange({ start: 0, end: 0 })).toBe(false);
      expect(h.view.selectionStyle().bold).toBe(true);
      await h.nativeInput();
      expect(h.document.generation).toBe(generation);
      expect(textEditPlainText(h.document.content)).toBe('');
      expect(h.editor.firstChild).not.toBe(oldParagraph);
      expect(h.view.captureSelection()).toEqual({ start: 0, end: 0 });
      const literal = 'Ω🚀 e\u0301 漢字 <>& "quotes" --\t終';
      await h.fill(literal);
      expect(textEditPlainText(h.document.content)).toBe(literal);
      expect(h.editor.textContent).toBe(literal);
      expect(h.document.content.blocks[0].runs.every(run => run.marks.bold)).toBe(true);
      expect(h.document.generation).toBeGreaterThan(generation);
      expect(h.session.selection).toEqual({ start: literal.length, end: literal.length });
      expect(h.view.captureSelection()).toEqual(h.session.selection);
      const suffix = '\n第二行🚀';
      await h.type(suffix);
      expect(textEditPlainText(h.document.content)).toBe(literal + suffix);
      expect([...h.editor.querySelectorAll('.textedit-paragraph')].map(node => node.textContent).join('\n')).toBe(literal + suffix);
      expect(h.view.captureSelection()).toEqual({ start: literal.length + suffix.length, end: literal.length + suffix.length });
      const selection = h.ownerDocument.getSelection();
      expect(selection.anchorNode.ownerDocument).toBe(h.ownerDocument);
      expect(selection.anchorNode.isConnected).toBe(true);
      expect(h.editor.contains(selection.anchorNode)).toBe(true);
      expect(h.ownerDocument.activeElement).toBe(h.editor);
      expect(h.view.documentId()).toBe(h.document.id);
      expect(h.errors).toEqual([]);
      expect(h.messages.filter(Boolean)).toEqual([]);
    } finally { h.view.destroy(); h.dom.window.close(); }
  });
}

test('rich DOM ranges follow each paragraph, table cell and canonical attachment through native typing and rerender', async () => {
  const content = mixedDocument();
  content.blocks[1].rows[0][1].runs[0].marks.italic = true;
  const h = createNativeConsumer('macos-mojave-10.14', content);
  try {
    h.editor.focus();
    const secondCell = h.editor.querySelectorAll('td')[1], oldText = secondCell.querySelector('span').firstChild;
    h.select(oldText, 0, oldText, 2);
    expect(h.view.captureSelection()).toEqual({ start: 9, end: 11 });
    expect(h.view.tableContext()).toMatchObject({ blockId: 't1', row: 0, column: 1 });
    expect(h.view.selectionStyle().italic).toBe(true);
    await h.type('🚀');
    expect(textEditPlainText(h.document.content)).toBe('Intro\na1\t🚀\n\uFFFC');
    expect(h.document.content.blocks[1].rows[0][0].runs[0].text).toBe('a1');
    expect(h.document.content.blocks[1].rows[0][1].runs[0].marks.italic).toBe(true);
    expect(h.document.content.blocks[2]).toEqual(content.blocks[2]);
    expect(oldText.isConnected).toBe(false);
    expect(h.view.captureSelection()).toEqual({ start: 11, end: 11 });
    const liveCell = h.editor.querySelectorAll('td')[1];
    liveCell.textContent = '🧭';
    // Native pasted HTML styling is not document authority; only its literal text is.
    liveCell.style.fontWeight = '900';
    h.select(liveCell.firstChild, 2);
    await h.nativeInput('insertFromPaste');
    expect(textEditPlainText(h.document.content)).toBe('Intro\na1\t🧭\n\uFFFC');
    expect(h.document.content.blocks[1].rows[0][1].runs[0].marks.italic).toBe(true);
    expect(h.document.content.blocks[1].rows[0][1].runs[0].marks.bold).toBe(false);
    expect(h.document.content.blocks[2]).toEqual(content.blocks[2]);
    expect(h.view.captureSelection()).toEqual({ start: 11, end: 11 });
    expect(h.view.selectRange({ start: 12, end: 13 })).toBe(true);
    expect(h.view.captureSelection()).toEqual({ start: 12, end: 13 });
    h.select(h.editor, 0, h.editor, h.editor.childNodes.length);
    expect(h.view.captureSelection()).toEqual({ start: 0, end: 13 });
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

test('detached or adopted rich segments cannot supply ranges or rebind to another document/editor', async () => {
  const h = createNativeConsumer('macos-mojave-10.14', createTextEditContent('Original Ω', 'rich'));
  const foreign = new JSDOM('<!doctype html><body></body>');
  try {
    expect(h.view.selectRange({ start: 10, end: 10 })).toBe(true);
    await h.publishNativeSelection();
    expect(h.session.selection).toEqual({ start: 10, end: 10 });
    expect(h.view.captureSelection()).toEqual({ start: 10, end: 10 });
    const oldParagraph = h.editor.firstChild;
    foreign.window.document.body.append(oldParagraph);
    h.select(h.editor, 0);
    expect(oldParagraph.isConnected).toBe(true);
    expect(oldParagraph.ownerDocument).toBe(foreign.window.document);
    expect(h.view.captureSelection()).toBe(null);
    expect(h.view.selectRange({ start: 0, end: 0 })).toBe(false);
    // An unchanged canonical content identity must still repair its invalid DOM projection.
    expect(h.view.render()).toBe(true);
    expect(h.editor.firstChild.ownerDocument).toBe(h.ownerDocument);
    expect(h.editor.firstChild).not.toBe(oldParagraph);
    expect(foreign.window.document.body.firstChild).toBe(oldParagraph);
    expect(h.view.captureSelection()).toEqual({ start: 10, end: 10 });
    await h.type('🚀');
    expect(textEditPlainText(h.document.content)).toBe('Original Ω🚀');
    expect(oldParagraph.textContent).toBe('Original Ω');
    const replacement = h.editor.cloneNode(true);
    h.editor.replaceWith(replacement); h.setEditor(replacement);
    expect(h.view.available()).toBe(false);
    expect(h.view.selectRange({ start: 0, end: 0 })).toBe(false);
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); foreign.window.close(); }
});

test('a composition cannot commit a detached segment snapshot or an adopted original editor', async () => {
  const h = createNativeConsumer('macos-mojave-10.14', createTextEditContent('Original', 'rich'));
  const foreign = new JSDOM('<!doctype html><body></body>');
  try {
    expect(h.view.selectRange({ start: 8, end: 8 })).toBe(true);
    await h.publishNativeSelection();
    expect(h.session.selection).toEqual({ start: 8, end: 8 });
    expect(h.view.captureSelection()).toEqual({ start: 8, end: 8 });
    h.editor.dispatchEvent(new h.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    const oldParagraph = h.editor.firstChild;
    foreign.window.document.body.append(oldParagraph);
    oldParagraph.textContent = 'Injected';
    h.select(h.editor, 0);
    h.editor.dispatchEvent(new h.dom.window.CompositionEvent('compositionend', { bubbles: true, data: 'Injected' }));
    await h.flush();
    expect(textEditPlainText(h.document.content)).toBe('Original');
    expect(h.document.generation).toBe(0);
    expect(h.view.captureSelection()).toEqual({ start: 8, end: 8 });
    foreign.window.document.body.append(h.root);
    expect(h.root.isConnected).toBe(true);
    expect(h.editor.isConnected).toBe(true);
    expect(h.view.available()).toBe(false);
    expect(h.view.render(true)).toBe(false);
    expect(await h.view.replaceSelection('foreign')).toBe(false);
    expect(textEditPlainText(h.document.content)).toBe('Original');
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); foreign.window.close(); }
});




test('native plaintext input preserves paragraph styles and caret without importing HTML attributes', async () => {
  const content = createTextEditContent('Alpha Ω\nSecond', 'rich');
  content.blocks[0].runs[0].marks.bold = true;
  content.blocks[1].runs[0].marks.italic = true;
  const h = createNativeConsumer('macos-mojave-10.14', content);
  try {
    const second = h.editor.children[1], nativeLine = h.ownerDocument.createElement('p'), span = h.ownerDocument.createElement('span');
    span.style.color = '#ff0000'; span.dataset.texteditBlockId = 'foreign-id';
    span.textContent = 'Alpha Ω🚀'; nativeLine.append(span);
    h.editor.children[0].replaceWith(nativeLine);
    h.editor.focus(); h.select(span.firstChild, 9);
    expect(h.view.captureSelection()).toBe(null);
    await h.nativeInput('insertFromPaste');
    expect(textEditPlainText(h.document.content)).toBe('Alpha Ω🚀\nSecond');
    expect(h.document.content.blocks[0].id).toBe('paragraph-1');
    expect(h.document.content.blocks[0].runs[0].marks.bold).toBe(true);
    expect(h.document.content.blocks[0].runs[0].marks.color).toBe('#000000');
    expect(h.document.content.blocks[1].runs[0].marks.italic).toBe(true);
    expect(second.isConnected).toBe(false);
    expect(h.view.captureSelection()).toEqual({ start: 9, end: 9 });
    await h.fill('Literal Ω\r\n第二行🚀\n');
    expect(textEditPlainText(h.document.content)).toBe('Literal Ω\n第二行🚀\n');
    expect(h.view.captureSelection()).toEqual({ start: 16, end: 16 });
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

test('rejected or stale native plaintext input restores the exact current canonical rich document', async () => {
  const h = createNativeConsumer('macos-mojave-10.14', createTextEditContent('Original Ω', 'rich'));
  try {
    expect(h.view.selectRange({ start: 10, end: 10 })).toBe(true);
    await h.publishNativeSelection();
    expect(h.session.selection).toEqual({ start: 10, end: 10 });
    expect(h.view.captureSelection()).toEqual({ start: 10, end: 10 });
    h.setBudget(false);
    await h.fill('must not publish 🚀');
    expect(textEditPlainText(h.document.content)).toBe('Original Ω');
    expect(h.document.generation).toBe(0);
    expect(h.editor.textContent).toBe('Original Ω');
    expect(h.view.captureSelection()).toEqual({ start: 10, end: 10 });
    expect(h.messages.some(message => message.includes('budget'))).toBe(true);
    h.setBudget(true);
    // A pending native owner cannot inherit a new canonical generation.
    h.editor.dispatchEvent(new h.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', isComposing: true }));
    const result = await h.run('input', { documentId: h.document.id, generation: h.document.generation, content: createTextEditContent('Current Ω', 'rich'), start: 9, end: 9 });
    expect(result.status).toBe('applied');
    await h.fill('stale native replacement');
    expect(textEditPlainText(h.document.content)).toBe('Current Ω');
    expect(h.editor.textContent).toBe('Current Ω');
    expect(h.view.captureSelection()).toEqual({ start: 9, end: 9 });
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

test('a retained original rich segment commits Unicode IME text and keeps its canonical style and caret', async () => {
  const content = createTextEditContent('A😀Z', 'rich');
  content.blocks[0].runs[0].marks.bold = true;
  const h = createNativeConsumer('macos-mojave-10.14', content);
  try {
    expect(h.view.selectRange({ start: 3, end: 3 })).toBe(true);
    const paragraph = h.editor.firstChild;
    h.editor.dispatchEvent(new h.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    paragraph.textContent = 'A😃漢Z';
    h.select(paragraph.firstChild, 4);
    h.editor.dispatchEvent(new h.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', data: '😃漢', isComposing: true }));
    h.editor.dispatchEvent(new h.dom.window.InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
    expect(textEditPlainText(h.document.content)).toBe('A😀Z');
    h.editor.dispatchEvent(new h.dom.window.CompositionEvent('compositionend', { bubbles: true, data: '😃漢' }));
    await h.flush();
    expect(textEditPlainText(h.document.content)).toBe('A😃漢Z');
    expect(h.document.content.blocks[0].runs[0].marks.bold).toBe(true);
    expect(h.view.captureSelection()).toEqual({ start: 4, end: 4 });
    expect(paragraph.isConnected).toBe(false);
    expect(h.ownerDocument.activeElement).toBe(h.editor);
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

test('live Svelte canonical getters retain original rich document/session ownership through native selection, menus and input', async () => {
  const h = createNativeConsumer('macos-mojave-10.14');
  try {
    const originalDocument = h.document, originalSession = h.session;
    expect((await h.run('menu', { menu: 'Format' })).status).toBe('applied');
    await h.flush();
    expect(h.state.documents.find(row => row.id === originalDocument.id)).toBe(originalDocument);
    expect(h.state.windows.find(row => row.windowId === originalSession.windowId)).toBe(originalSession);
    expect(h.view.available()).toBe(true);
    expect((await h.run('menu', { menu: null })).status).toBe('applied');
    await h.flush();
    await h.fill('Ω🚀 literal');
    expect(textEditPlainText(h.state.documents[0].content)).toBe('Ω🚀 literal');
    expect(h.view.selectRange({ start: 3, end: 3 })).toBe(true);
    await h.publishNativeSelection();
    expect(h.state.windows[0].selection).toEqual({ start: 3, end: 3 });
    expect(h.state.documents[0]).toBe(originalDocument);
    expect(h.state.windows[0]).toBe(originalSession);
    expect(h.view.available()).toBe(true);
    expect((await h.run('format', { italic: true })).status).toBe('applied');
    await h.flush();
    await h.type('漢');
    expect(textEditPlainText(h.state.documents[0].content)).toBe('Ω🚀漢 literal');
    expect(h.state.documents[0]).toBe(originalDocument);
    expect(h.state.windows[0]).toBe(originalSession);
    expect(h.view.captureSelection()).toEqual({ start: 4, end: 4 });
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

for (const replacement of ['document', 'session']) {
  test(`live Svelte native getters reject an equal-ID replacement ${replacement} rather than grafting the original editor`, async () => {
    const h = createNativeConsumer('macos-mojave-10.14', createTextEditContent('Retained Ω', 'rich'));
    try {
      if (replacement === 'document') h.state.documents[0] = { ...h.document };
      else h.state.windows[0] = { ...h.session };
      expect(h.root.isConnected).toBe(true);
      expect(h.editor.isConnected).toBe(true);
      expect(h.view.available()).toBe(false);
      expect(h.view.documentId()).toBe(null);
      expect(h.view.focus()).toBe(false);
      expect(h.view.selectRange({ start: 0, end: 0 })).toBe(false);
      expect(await h.view.replaceSelection('must not graft')).toBe(false);
      expect(textEditPlainText(h.state.documents[0].content)).toBe('Retained Ω');
      expect(h.errors).toEqual([]);
    } finally { h.view.destroy(); h.dom.window.close(); }
  });
}

test('native plaintext beforeinput after descendant replacement reaches browser input instead of dropping Unicode at a detached cache', async () => {
  const content = createTextEditContent('Original Ω\nKeep', 'rich');
  content.blocks[0].runs[0].marks.bold = true;
  content.blocks[1].runs[0].marks.italic = true;
  const h = createNativeConsumer('macos-mojave-10.14', content);
  try {
    const originalDocument = h.document, originalSession = h.session, detached = h.editor.firstChild;
    const nativeParagraph = h.ownerDocument.createElement('p');
    detached.replaceWith(nativeParagraph);
    h.editor.focus(); h.select(nativeParagraph, 0);
    expect(detached.isConnected).toBe(false);
    expect(h.view.captureSelection()).toBe(null);
    const literal = 'Literal Ω🚀';
    const event = new h.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: literal });
    h.editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(textEditPlainText(h.document.content)).toBe('Original Ω\nKeep');
    // Execute the browser's default Range edit only when the real handler allows it.
    const selection = h.ownerDocument.getSelection(), range = selection.getRangeAt(0), inserted = h.ownerDocument.createTextNode(literal);
    range.deleteContents(); range.insertNode(inserted);
    range.setStart(inserted, literal.length); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    await h.nativeInput('insertText');
    expect(textEditPlainText(h.state.documents[0].content)).toBe('Literal Ω🚀\nKeep');
    expect(h.state.documents[0]).toBe(originalDocument);
    expect(h.state.windows[0]).toBe(originalSession);
    expect(h.document.content.blocks[0].runs[0].marks.bold).toBe(true);
    expect(h.document.content.blocks[1].runs[0].marks.italic).toBe(true);
    expect(h.document.generation).toBe(1);
    expect(h.document.contentRevision).toBe(1);
    expect(h.view.captureSelection()).toEqual({ start: 11, end: 11 });
    expect(h.ownerDocument.activeElement).toBe(h.editor);
    expect(h.errors).toEqual([]);
    expect(h.messages.filter(Boolean)).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

test('a detached rich cache cannot borrow a foreign native selection for beforeinput', () => {
  const h = createNativeConsumer('macos-mojave-10.14', createTextEditContent('Original Ω', 'rich'));
  try {
    const outside = h.ownerDocument.createElement('p'); outside.textContent = 'Outside';
    h.ownerDocument.body.append(outside);
    h.editor.replaceChildren(); h.select(outside.firstChild, 0);
    const event = new h.dom.window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'must not graft' });
    h.editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(textEditPlainText(h.document.content)).toBe('Original Ω');
    expect(h.document.generation).toBe(0);
    expect(outside.textContent).toBe('Outside');
    expect(h.errors).toEqual([]);
  } finally { h.view.destroy(); h.dom.window.close(); }
});

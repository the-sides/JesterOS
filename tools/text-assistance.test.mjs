import { expect, test } from 'bun:test';
import { createTextAssistance, applyTextSubstitutions, textSubstitutionPlan } from '../frontend/src/text-assistance.js';

async function loadDictionary() {
  const [aff, dic] = await Promise.all([
    Bun.file(new URL('../frontend/node_modules/dictionary-en/index.aff', import.meta.url)).text(),
    Bun.file(new URL('../frontend/node_modules/dictionary-en/index.dic', import.meta.url)).text(),
  ]);
  return { aff, dic };
}
const assistance = createTextAssistance({ loadDictionary });

test('offline English dictionary recognizes inflections and suggests an actual American spelling', async () => {
  expect(await assistance.check("The children are walking with cats and dogs. Don't stop.")).toEqual({ issues: [], nextFrom: null });
  const result = await assistance.check('The colour is blue.');
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]).toMatchObject({ word: 'colour', start: 4, end: 10, reason: 'misspelled' });
  expect(result.issues[0].suggestions).toContain('color');
  expect(result.issues[0].suggestions.length).toBeLessThanOrEqual(8);
  expect(await assistance.check('The colour is blue.')).toEqual(result);
});

test('Unicode words and apostrophes keep exact UTF16 ranges while numbers, emoji, and punctuation are skipped', async () => {
  const text = "😀 don't 😺 colour’s 123 -- नमस्ते";
  const result = await assistance.check(text);
  expect(result.issues.map(issue => issue.word)).toEqual(['colour’s', 'नमस्ते']);
  for (const issue of result.issues) {
    expect(text.slice(issue.start, issue.end)).toBe(issue.word);
    expect(issue.start).toBe(text.indexOf(issue.word));
  }
  expect(result.issues[0].start).toBe(12);
});

test('learned and ignored words belong to each caller, never the shared dictionary', async () => {
  const text = 'colour zorbquux';
  expect((await assistance.check(text, { learnedWords: ['zorbquux'], ignoredWords: ['colour'] })).issues).toEqual([]);
  expect((await assistance.check(text)).issues.map(issue => issue.word)).toEqual(['colour', 'zorbquux']);
  const otherRoot = createTextAssistance({ loadDictionary });
  expect((await otherRoot.check(text)).issues.map(issue => issue.word)).toEqual(['colour', 'zorbquux']);
});

test('bounded spelling pages resume at the next complete issue without repeats or false continuation', async () => {
  const text = 'colour good colour good colour good';
  const first = await assistance.check(text, { maxIssues: 1 });
  expect(first.issues.map(issue => issue.start)).toEqual([0]);
  expect(first.nextFrom).toBe(12);
  const second = await assistance.check(text, { from: first.nextFrom, maxIssues: 1 });
  expect(second.issues.map(issue => issue.start)).toEqual([12]);
  expect(second.nextFrom).toBe(24);
  const last = await assistance.check(text, { from: second.nextFrom, maxIssues: 1 });
  expect(last.issues.map(issue => issue.start)).toEqual([24]);
  expect(last.nextFrom).toBeNull();
});

test('dictionary failure is visible, shared by concurrent actions, and the next explicit action retries', async () => {
  let attempts = 0;
  const checker = createTextAssistance({ loadDictionary: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('dictionary unavailable');
    return loadDictionary();
  } });
  const failures = await Promise.allSettled([checker.check('colour'), checker.check('colour')]);
  expect(failures.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(failures[0].reason.message).toBe('dictionary unavailable');
  expect(attempts).toBe(1);
  expect((await checker.check('colour')).issues[0].suggestions).toContain('color');
  expect(attempts).toBe(2);
});

test('an in-flight spelling request snapshots caller-owned learned and ignored arrays', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const checker = createTextAssistance({ loadDictionary: async () => { await gate; return loadDictionary(); } });
  const learnedWords = ['colour'];
  const ignoredWords = ['zorbquux'];
  const pending = checker.check('colour zorbquux', { learnedWords, ignoredWords });
  learnedWords.length = 0;
  ignoredWords.length = 0;
  release();
  expect((await pending).issues).toEqual([]);
  expect((await checker.check('colour zorbquux')).issues).toHaveLength(2);
});

test('smart quotes pair around content, retain contractions and plural apostrophes, and transform double dashes', () => {
  expect(applyTextSubstitutions(`"Don't stop" -- 'hello' -- teachers' books`, {
    smartQuotes: true, smartDashes: true,
  })).toBe('“Don’t stop” — ‘hello’ — teachers’ books');
  expect(applyTextSubstitutions(`他说"hello"`, { smartQuotes: true })).toBe('他说“hello”');
});

test('literal whole-token replacements escape metacharacters, honor token boundaries, and never cascade or cycle', () => {
  const replacements = [
    { from: 'a+b', to: '$&' }, { from: 'cat', to: 'dog' },
    { from: 'dog', to: 'cat' }, { from: 'a.b', to: '[x]' },
  ];
  expect(applyTextSubstitutions('a+b cat dog a.b xa+b a+bz concatenate', { textReplacement: true }, replacements))
    .toBe('$& dog cat [x] xa+b a+bz concatenate');
  expect(applyTextSubstitutions('a b', { textReplacement: true }, [
    { from: 'a b', to: 'long' }, { from: 'a', to: 'short' },
  ])).toBe('long');
});

test('selection substitution uses surrounding quote and token context without changing outside text', () => {
  const source = `She said "hello" and can't stop -- now.`;
  const start = source.indexOf('" and');
  const selected = source.slice(start, start + 1);
  const transformed = applyTextSubstitutions(selected, { smartQuotes: true }, [], {
    before: source.slice(0, start), after: source.slice(start + 1),
  });
  expect(transformed).toBe('”');
  expect(source.slice(0, start) + transformed + source.slice(start + 1)).toBe(`She said "hello” and can't stop -- now.`);
  expect(applyTextSubstitutions("'", { smartQuotes: true }, [], { before: 'can', after: 't' })).toBe('’');
  expect(applyTextSubstitutions('cat', { textReplacement: true }, [{ from: 'cat', to: 'dog' }], { before: 'bob', after: 's' })).toBe('cat');
  expect(applyTextSubstitutions('-', { smartDashes: true }, [], { before: '-', after: '' })).toBe('-');
});

test('automatic spelling corrects only the immediately terminated word and leaves unfinished words untouched', async () => {
  const preferences = { correctSpellingAutomatically: true };
  expect(await assistance.correctInput('colour', 6, preferences)).toEqual({ text: 'colour', cursor: 6, changed: false });
  expect(await assistance.correctInput('colour ', 7, preferences)).toEqual({ text: 'color ', cursor: 6, changed: true });
  expect(await assistance.correctInput('colour good ', 12, preferences)).toEqual({ text: 'colour good ', cursor: 12, changed: false });
  expect(await assistance.correctInput('colour  ', 8, preferences)).toEqual({ text: 'colour  ', cursor: 8, changed: false });
  expect(await assistance.correctInput("colour'", 7, preferences)).toEqual({ text: "colour'", cursor: 7, changed: false });
  expect(await assistance.correctInput('colour2 ', 8, preferences)).toEqual({ text: 'colour2 ', cursor: 8, changed: false });
});

test('automatic correction preserves title/uppercase casing, surrounding content and UTF16 caret offsets', async () => {
  const preferences = { correctSpellingAutomatically: true };
  expect(await assistance.correctInput('😀 Colour ! suffix colour', 10, preferences))
    .toEqual({ text: '😀 Color ! suffix colour', cursor: 9, changed: true });
  expect(await assistance.correctInput('COLOUR, rest', 7, preferences))
    .toEqual({ text: 'COLOR, rest', cursor: 6, changed: true });
  expect(await assistance.correctInput('colour ', 7, preferences, ['colour']))
    .toEqual({ text: 'colour ', cursor: 7, changed: false });
  expect(await assistance.correctInput('colour ', 7, preferences))
    .toEqual({ text: 'color ', cursor: 6, changed: true });
});

test('input substitutions are independently enabled and alter only the new boundary or completed replacement token', async () => {
  expect(await assistance.correctInput('old -- "hello"', 14, { smartQuotes: true }))
    .toEqual({ text: 'old -- "hello”', cursor: 14, changed: true });
  expect(await assistance.correctInput("don't", 4, { smartQuotes: true }))
    .toEqual({ text: 'don’t', cursor: 4, changed: true });
  expect(await assistance.correctInput('old -- new -- suffix', 13, { smartDashes: true }))
    .toEqual({ text: 'old -- new — suffix', cursor: 12, changed: true });
  expect(await assistance.correctInput('a+b rest', 4, {
    textReplacement: true, replacements: [{ from: 'a+b', to: 'hello' }],
  })).toEqual({ text: 'hello rest', cursor: 6, changed: true });
  expect(await assistance.correctInput('a+b', 3, {
    textReplacement: true, replacements: [{ from: 'a+b', to: 'hello' }],
  })).toEqual({ text: 'a+b', cursor: 3, changed: false });
  expect(await assistance.correctInput('cat ', 4, {
    textReplacement: true, correctSpellingAutomatically: true,
    replacements: [{ from: 'cat', to: 'dog' }, { from: 'dog', to: 'cat' }],
  })).toEqual({ text: 'dog ', cursor: 4, changed: true });
  expect(await assistance.correctInput('colour -- "', 11, {}))
    .toEqual({ text: 'colour -- "', cursor: 11, changed: false });
});

test('automatic correction propagates dictionary failure without applying a partially prepared quote edit', async () => {
  const checker = createTextAssistance({ loadDictionary: async () => { throw new Error('offline corpus failed'); } });
  await expect(checker.correctInput('colour"', 7, {
    correctSpellingAutomatically: true, smartQuotes: true,
  })).rejects.toThrow('offline corpus failed');
  expect(await checker.correctInput('"', 1, { smartQuotes: true }))
    .toEqual({ text: '“', cursor: 1, changed: true });
});

test('detection-only checking retains issue ranges and continuation without generating suggestions', async () => {
  const text = '😀 colour good colour';
  const detection = await assistance.check(text, { suggestions: false, maxIssues: 1 });
  expect(detection).toEqual({
    issues: [{ word: 'colour', start: 3, end: 9, reason: 'misspelled', suggestions: [] }],
    nextFrom: 15,
  });
  const panel = await assistance.check(text, { from: detection.issues[0].start, maxIssues: 1, suggestions: true });
  expect(panel.issues[0]).toMatchObject({ word: 'colour', start: 3, end: 9, reason: 'misspelled' });
  expect(panel.issues[0].suggestions).toContain('color');
  expect(panel.nextFrom).toBe(detection.nextFrom);
  expect((await assistance.check(text, { from: detection.nextFrom, suggestions: false })).issues)
    .toEqual([{ word: 'colour', start: 15, end: 21, reason: 'misspelled', suggestions: [] }]);
});

test('128 UTF16 units is the dictionary boundary, and longer words are reported explicitly rather than hidden', async () => {
  const supported = 'x'.repeat(128);
  const unsupported = 'x'.repeat(129);
  const text = `${supported} ${unsupported}`;
  const result = await assistance.check(text, { suggestions: false });
  expect(result).toEqual({
    issues: [
      { word: supported, start: 0, end: 128, reason: 'misspelled', suggestions: [] },
      { word: unsupported, start: 129, end: 258, reason: 'word_too_long', suggestions: [] },
    ],
    nextFrom: null,
  });
  expect(await assistance.check(unsupported)).toEqual({
    issues: [{ word: unsupported, start: 0, end: 129, reason: 'word_too_long', suggestions: [] }],
    nextFrom: null,
  });
  // Astral letters count as two UTF16 units each, not one Unicode character.
  const astralLetters = '𐐀'.repeat(65);
  expect((await assistance.check(`😀 ${astralLetters}`)).issues).toEqual([
    { word: astralLetters, start: 3, end: 133, reason: 'word_too_long', suggestions: [] },
  ]);
});

test('a huge token never invokes dictionary correction and retains its full source/caret', async () => {
  const huge = 'x'.repeat(100000);
  const text = `😀 ${huge} suffix`;
  expect(await assistance.check(text, { maxIssues: 1 })).toEqual({
    issues: [{ word: huge, start: 3, end: 100003, reason: 'word_too_long', suggestions: [] }],
    nextFrom: null,
  });
  const checker = createTextAssistance({ loadDictionary: async () => { throw new Error('must not load for a long input token'); } });
  expect(await checker.correctInput(text, 100004, { correctSpellingAutomatically: true }))
    .toEqual({ text, cursor: 100004, changed: false });
});

test('substitution provenance stages reproduce the unchanged shared engine with exact UTF-16 ranges', () => {
  const source = '😀 cat "cat" -- a+b';
  const preferences = { textReplacement: true, smartDashes: true, smartQuotes: true };
  const replacements = [{ from: 'cat', to: '"dog" --' }, { from: 'a+b', to: '$&' }];
  const plan = textSubstitutionPlan(source, preferences, replacements);
  let actual = source;
  for (const stage of plan.stages) {
    let previousEnd = 0;
    for (const edit of stage) {
      expect(edit.start).toBeGreaterThanOrEqual(previousEnd); expect(edit.end).toBeGreaterThanOrEqual(edit.start);
      previousEnd = edit.end;
    }
    for (const edit of [...stage].reverse()) actual = actual.slice(0, edit.start) + edit.text + actual.slice(edit.end);
  }
  expect(actual).toBe(plan.text);
  expect(plan.text).toBe(applyTextSubstitutions(source, preferences, replacements));
  expect(plan.stages[0][0]).toEqual({ start: 3, end: 6, text: '"dog" --' });
});

test('substitution provenance retains original selection context and omits unchanged tokens', () => {
  const context = { before: 'She said “hello', after: ' next' };
  const plan = textSubstitutionPlan('" --', { smartQuotes: true, smartDashes: true }, [], context);
  expect(plan.text).toBe(applyTextSubstitutions('" --', { smartQuotes: true, smartDashes: true }, [], context));
  expect(textSubstitutionPlan('cat', { textReplacement: true }, [{ from: 'cat', to: 'cat' }]).stages).toEqual([]);
});

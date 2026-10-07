import { test, expect } from 'bun:test';
import { inputDefaults, validateInputState, inputSummary, keyboardRows, characterResults, characterById } from '../frontend/src/input-model.js';
import { systemDefaults, validateSystemState } from '../frontend/src/system-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');

test('complete input preferences retain explicit configured order and reject invalid active or previous membership', () => {
  const state = { sourceIds: ['de', 'fr'], activeSourceId: 'fr', previousSourceId: 'de', showInMenuBar: false };
  expect(validateInputState(JSON.parse(JSON.stringify(state))).ok).toBe(true);
  const summary = inputSummary(state);
  expect(summary.sources.map(source => source.id)).toEqual(['de', 'fr']);
  expect(summary.sources.map(source => source.short)).toEqual(['DE', 'FR']);
  summary.sourceIds.pop(); summary.sources[0].name = 'Changed';
  expect(state.sourceIds).toEqual(['de', 'fr']);
  expect(inputSummary(state).sources[0].name).toBe('German');
  for (const invalid of [
    { ...state, sourceIds: [] }, { ...state, sourceIds: ['fr', 'fr'] },
    { ...state, sourceIds: ['English'] }, { ...state, activeSourceId: 'us' },
    { ...state, previousSourceId: 'fr' }, { ...state, previousSourceId: 'us' },
    { ...state, showInMenuBar: 'false' }, { ...state, extra: false },
  ]) expect(validateInputState(invalid).ok).toBe(false);
});

test('accessors, symbols, sparse lists and exotic input data reject without reading properties', () => {
  let reads = 0;
  for (const alter of [
    state => Object.defineProperty(state, 'activeSourceId', { enumerable: true, get() { reads++; return 'us'; } }),
    state => Object.defineProperty(state.sourceIds, '0', { enumerable: true, get() { reads++; return 'us'; } }),
    state => { state[Symbol('private')] = true; },
    state => { state.sourceIds[Symbol('private')] = true; },
    state => { delete state.sourceIds[0]; },
    state => { Object.setPrototypeOf(state.sourceIds, null); },
    state => { Object.setPrototypeOf(state, { inherited: true }); },
    state => { delete state.previousSourceId; },
  ]) {
    const state = inputDefaults(); alter(state);
    expect(validateInputState(state).ok).toBe(false);
  }
  expect(reads).toBe(0);
  const system = systemDefaults(profile); delete system.input;
  expect(validateSystemState(system, profile).ok).toBe(false);
  Object.defineProperty(system, 'input', { enumerable: true, get() { reads++; return inputDefaults(); } });
  expect(validateSystemState(system, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

test('authored source and shift selection changes emitted physical-key glyphs without pretending to compose dead keys', () => {
  const key = (source, keyId, modifiers = {}) => keyboardRows(source, modifiers).flat().find(entry => entry.keyId === keyId);
  expect(key('us', 'KeyQ').text).toBe('q');
  expect(key('fr', 'KeyQ').text).toBe('a');
  expect(key('de', 'KeyY').text).toBe('z');
  expect(key('de', 'KeyZ', { shift: true }).text).toBe('Y');
  expect(key('fr', 'Digit2').text).toBe('é');
  expect(key('fr', 'Digit2', { shift: true }).text).toBe('2');
  expect(key('de', 'BracketLeft', { shift: true }).text).toBe('Ü');
  expect(key('us', 'KeyE', { option: true }).text).toBe('€');
  expect(key('fr', 'BracketLeft').dead).toBeUndefined();
  expect(keyboardRows('jp', {}).length).toBe(0);
});

test('bounded character discovery searches literal glyphs, Unicode codes, names and keywords and has honest empty results', () => {
  expect(characterResults('U+1F600', 'all').map(record => record.text)).toContain('😀');
  expect(characterResults('family', 'emoji').map(record => record.text)).toContain('👨‍👩‍👧');
  expect(characterResults('€', 'symbols').map(record => record.name)).toContain('Euro sign');
  expect(characterResults('a cute non-existent unicorn', 'all')).toEqual([]);
  expect(characterResults('euro', 'latin')).toEqual([]);
  const family = characterResults('family', 'emoji')[0];
  expect(characterById(family.id).text).toBe('👨‍👩‍👧');
  expect(characterById('not-in-the-catalogue')).toBeNull();
  expect(Object.isFrozen(family)).toBe(true);
  expect(Object.isFrozen(family.keywords)).toBe(true);
});

import { object, flag } from './command-schema.js';

export const EDITING_OPTION_KEYS = ['checkSpellingWhileTyping', 'correctSpellingAutomatically', 'smartQuotes', 'smartDashes', 'textReplacement'];
const word = { type: 'string', minLength: 1, maxLength: 128 };
export const editingPreferencesSchema = object({
  ...Object.fromEntries(EDITING_OPTION_KEYS.map(key => [key, flag])),
  learnedWords: { type: 'array', maxItems: 1024, uniqueItems: true, items: word },
  replacements: { type: 'array', maxItems: 1024, items: object({ from: word, to: { type: 'string', maxLength: 4096 } }) },
});

export function editingPreferencesDefaults() {
  return { checkSpellingWhileTyping: true, correctSpellingAutomatically: false, smartQuotes: false,
    smartDashes: false, textReplacement: false, learnedWords: [], replacements: [{ from: '(c)', to: '©' }] };
}

export function validLearnedWord(word) {
  return typeof word === 'string' && word.length > 0 && word.length <= 128 && /^\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*$/u.test(word);
}

export function validateEditingPreferences(preferences) {
  if (!preferences || EDITING_OPTION_KEYS.some(key => typeof preferences[key] !== 'boolean')
    || !Array.isArray(preferences.learnedWords) || preferences.learnedWords.length > 1024
    || preferences.learnedWords.some(word => !validLearnedWord(word))
    || new Set(preferences.learnedWords.map(word => word.normalize('NFC').toLocaleLowerCase('en-US').replaceAll('’', "'"))).size !== preferences.learnedWords.length
    || !Array.isArray(preferences.replacements) || preferences.replacements.length > 1024
    || preferences.replacements.some(entry => typeof entry?.from !== 'string' || !entry.from.length || entry.from.length > 128
      || /[\r\n\u0000-\u001f\u007f]/u.test(entry.from) || typeof entry.to !== 'string' || entry.to.length > 4096)
    || new Set(preferences.replacements.map(entry => entry.from)).size !== preferences.replacements.length) {
    return { ok: false, message: 'Text assistance needs bounded distinct learned words and literal replacement sources.' };
  }
  return { ok: true };
}

/*!
 * (The MIT License)
 *
 * Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * nspell 2.1.5 license; dictionary-en notices: /licenses/dictionary-en.txt.
 */
import nspell from 'nspell';

// English (en-US) Hunspell only: unknown words in other languages are not grammar errors.
// No browser spellcheck, host services, or root-specific mutation of the dictionary.
async function loadBundledDictionary() {
  const [aff, dic] = await Promise.all([
    import('../node_modules/dictionary-en/index.aff?raw'),
    import('../node_modules/dictionary-en/index.dic?raw'),
  ]);
  return { aff: aff.default, dic: dic.default };
}

function cachedChecker(loadDictionary) {
  let pending;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(loadDictionary).then(({ aff, dic }) => {
        if (typeof aff !== 'string' || !aff.trim() || typeof dic !== 'string' || !dic.trim()) {
          throw new Error('The English Hunspell dictionary is incomplete.');
        }
        return nspell({ aff, dic });
      }).catch(error => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}
const bundledChecker = cachedChecker(loadBundledDictionary);
const wordPattern = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
const tokenCharacter = /[\p{L}\p{M}\p{N}_'’]/u;
const letter = /[\p{L}\p{M}]/u;
const canonicalWord = word => word.normalize('NFC').replaceAll('’', "'").toLowerCase();
const personalWords = words => new Set(Array.from(words, canonicalWord));
const maximumDictionaryWordLength = 128; // UTF16 units; never send larger tokens to nspell.
const suggestionsFor = (checker, word) => checker.suggest(word).slice(0, 8);
function characterBefore(text, index) {
  if (!index) return '';
  const code = text.charCodeAt(index - 1);
  const previous = text.charCodeAt(index - 2);
  const pair = code >= 0xDC00 && code <= 0xDFFF && previous >= 0xD800 && previous <= 0xDBFF;
  return text.slice(index - (pair ? 2 : 1), index);
}
const characterAt = (text, index) => index < text.length ? String.fromCodePoint(text.codePointAt(index)) : '';
const lastCharacter = text => characterBefore(text, text.length);

function snapshotReplacements(replacements) {
  return replacements.map(replacement => {
    if (!replacement || Object.keys(replacement).length !== 2 || Object.keys(replacement).some(key => key !== 'from' && key !== 'to') ||
      typeof replacement.from !== 'string' || !replacement.from || typeof replacement.to !== 'string') {
      throw new TypeError('Text replacements must contain only nonempty from and string to fields.');
    }
    return { from: replacement.from, to: replacement.to };
  });
}

function quoteSubstitutions(text, before, after) {
  let doubleOpen = false;
  for (const character of before) {
    if (character === '"') doubleOpen = !doubleOpen;
    else if (character === '“') doubleOpen = true;
    else if (character === '”') doubleOpen = false;
  }
  return text.replace(/['"“”]/g, (quote, index) => {
    if (quote === '“' || quote === '”') {
      doubleOpen = quote === '“';
      return quote;
    }
    const previous = index ? characterBefore(text, index) : lastCharacter(before);
    const following = index + 1 < text.length ? characterAt(text, index + 1) : characterAt(after, 0);
    if (quote === "'" && letter.test(previous)) return '’';
    const startsContent = !!following && !/[\s\p{Pe}\p{Pf},.!?:;]/u.test(following);
    if (quote === '"') {
      const opening = !doubleOpen && (startsContent || (!following && (!previous || /\s|\p{Ps}/u.test(previous))));
      doubleOpen = opening;
      return opening ? '“' : '”';
    }
    const opening = !previous || /[\s\p{Ps}\p{Pi}—–]/u.test(previous);
    return opening && (startsContent || !following) ? '‘' : '’';
  });
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceTokens(text, replacements, before, after) {
  if (!replacements.length) return text;
  // Longest literal wins; equal/duplicate entries retain caller order. One pass, no cascades.
  const ordered = replacements.map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.from.length - a.from.length || a.index - b.index);
  const pattern = new RegExp(ordered.map(entry => escapeRegex(entry.from)).join('|'), 'gu');
  return text.replace(pattern, (match, index) => {
    const previous = index ? characterBefore(text, index) : lastCharacter(before);
    const end = index + match.length;
    const following = end < text.length ? characterAt(text, end) : characterAt(after, 0);
    if (tokenCharacter.test(previous) || tokenCharacter.test(following)) return match;
    return ordered.find(entry => entry.from === match).to;
  });
}

/**
 * Transform only the supplied existing text. Optional fourth argument {before, after}
 * supplies surrounding selection context without modifying it. Literal replacements
 * are case-sensitive, whole-token, longest-first and noncascading; smart typography
 * follows the replacement pass. No rich text, smart links, grammar, or AI is modeled.
 */
export function applyTextSubstitutions(text, { smartQuotes, smartDashes, textReplacement } = {}, replacements = [], { before = '', after = '' } = {}) {
  let result = textReplacement ? replaceTokens(text, snapshotReplacements(replacements), before, after) : text;
  if (smartDashes) result = result.replace(/--/g, '—');
  if (smartQuotes) result = quoteSubstitutions(result, before, after);
  return result;
}

function preserveCase(word, suggestion) {
  if (word === word.toLowerCase()) return suggestion.toLowerCase();
  if (word === word.toUpperCase()) return suggestion.toUpperCase();
  const [first, ...rest] = Array.from(word);
  if (first === first.toUpperCase() && rest.join('') === rest.join('').toLowerCase()) {
    const [initial, ...tail] = Array.from(suggestion);
    return initial.toUpperCase() + tail.join('').toLowerCase();
  }
  // Mixed-case identifiers have no unambiguous case-preserving correction.
  return word;
}

/**
 * loadDictionary resolves {aff:string,dic:string}; the default loads bundled raw data
 * lazily. Failures propagate and clear the promise so the next explicit action retries.
 * Each call snapshots input/options before awaiting; callers own revision/IME guards.
 * check caps issues at1000 and suggestions at8; suggestions:false avoids suggestion work.
 * Tokens over128 UTF16 units are reported as word_too_long without dictionary evaluation.
 */
export function createTextAssistance({ loadDictionary } = {}) {
  const getChecker = loadDictionary ? cachedChecker(loadDictionary) : bundledChecker;

  async function check(text, { learnedWords = [], ignoredWords = [], from = 0, maxIssues = 1000, suggestions = true } = {}) {
    if (!Number.isInteger(from) || from < 0 || from > text.length) throw new RangeError('Invalid spelling start offset.');
    if (!Number.isInteger(maxIssues) || maxIssues < 1) throw new RangeError('Spelling issue limit must be positive.');
    if (typeof suggestions !== 'boolean') throw new TypeError('Spelling suggestions must be a boolean.');
    const limit = Math.min(maxIssues, 1000);
    const known = personalWords([...learnedWords, ...ignoredWords]);
    const checker = await getChecker();
    const issues = [];
    // Scan whole words, never a partial word when from falls inside one. Continuation
    // points to an actual next issue, not merely to a remaining correct-text suffix.
    for (const match of text.matchAll(wordPattern)) {
      if (match.index < from) continue;
      const tooLong = match[0].length > maximumDictionaryWordLength;
      if (!tooLong && (known.has(canonicalWord(match[0])) || checker.correct(match[0]))) continue;
      if (issues.length === limit) return { issues, nextFrom: match.index };
      issues.push({
        word: match[0], start: match.index, end: match.index + match[0].length,
        suggestions: suggestions && !tooLong ? suggestionsFor(checker, match[0]) : [],
        reason: tooLong ? 'word_too_long' : 'misspelled',
      });
    }
    return { issues, nextFrom: null };
  }

  async function correctInput(text, cursor, preferences = {}, learnedWords = []) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) throw new RangeError('Invalid input cursor.');
    const { correctSpellingAutomatically, textReplacement, smartQuotes, smartDashes } = preferences;
    const replacements = textReplacement ? snapshotReplacements(preferences.replacements ?? []) : [];
    const known = personalWords(learnedWords);
    const prefix = text.slice(0, cursor);
    const boundary = lastCharacter(prefix);
    const boundaryStart = cursor - boundary.length;
    const edits = [];
    // Typography affects only the just-typed character/pair, never earlier content.
    if (smartDashes && prefix.endsWith('--')) {
      edits.push({ start: cursor - 2, end: cursor, value: '—' });
    } else if (smartQuotes && (boundary === '"' || boundary === "'")) {
      edits.push({ start: boundaryStart, end: cursor,
        value: quoteSubstitutions(boundary, text.slice(0, boundaryStart), text.slice(cursor)) });
    }
    // A letter, mark, digit, apostrophe or underscore is not a completed-word boundary.
    if (boundary && !tokenCharacter.test(boundary)) {
      const completed = text.slice(0, boundaryStart);
      let replacement;
      for (const entry of replacements.slice().sort((a, b) => b.from.length - a.from.length)) {
        if (completed.endsWith(entry.from) && !tokenCharacter.test(lastCharacter(completed.slice(0, -entry.from.length)))) {
          replacement = { start: boundaryStart - entry.from.length, end: boundaryStart, value: entry.to };
          break;
        }
      }
      if (replacement) {
        edits.push(replacement);
      } else if (correctSpellingAutomatically) {
        let word;
        for (const match of completed.matchAll(wordPattern)) {
          if (match.index + match[0].length === completed.length) word = match;
        }
        if (word && word[0].length <= maximumDictionaryWordLength && !tokenCharacter.test(lastCharacter(completed.slice(0, word.index))) && !known.has(canonicalWord(word[0]))) {
          const checker = await getChecker();
          if (!checker.correct(word[0])) {
            const suggestion = suggestionsFor(checker, word[0])[0];
            if (suggestion) edits.push({ start: word.index, end: boundaryStart, value: preserveCase(word[0], suggestion) });
          }
        }
      }
    }
    if (!edits.length) return { text, cursor, changed: false };
    edits.sort((a, b) => a.start - b.start);
    let result = '';
    let offset = 0;
    let nextCursor = cursor;
    for (const edit of edits) {
      result += text.slice(offset, edit.start) + edit.value;
      offset = edit.end;
      nextCursor += edit.value.length - (edit.end - edit.start);
    }
    result += text.slice(offset);
    return { text: result, cursor: nextCursor, changed: result !== text };
  }

  return { check, correctInput, ready: async () => { await getChecker(); return true; } };
}

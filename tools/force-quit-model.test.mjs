import { expect, test } from 'bun:test';
import { captureForceQuitLease, forceQuitLeaseCurrent } from '../frontend/src/force-quit-model.js';

const window = (id, appId, extra = {}) => ({ id, appId, minimized: false, title: id, ...extra });
const running = ['finder', 'notes'];

test('confirmation remains bound through presentation/document edits, reordering and unrelated windows', () => {
  const first = window('notes-first', 'notes'), second = window('notes-second', 'notes');
  const lease = captureForceQuitLease('notes', 'quit', [first, second], 'notes-first');
  first.hidden = true;
  second.minimized = true;
  first.title = 'Edited draft';
  first.fileId = 'retained-document';
  first.dirty = true;
  expect(forceQuitLeaseCurrent(lease, [second, window('mail-new', 'mail'), first], 'notes-first', running)).toBe(true);
});

for (const change of ['removed', 'added', 'replaced']) {
  test(`a ${change} target window invalidates the confirmation without changing its original handles`, () => {
    const first = window('notes-first', 'notes'), second = window('notes-second', 'notes');
    const lease = captureForceQuitLease('notes', 'quit', [first, second], 'notes-first');
    const windows = change === 'removed' ? [second]
      : change === 'added' ? [first, second, window('notes-new', 'notes')]
      : [{ ...first }, second];
    expect(forceQuitLeaseCurrent(lease, windows, 'notes-first', running)).toBe(false);
    expect(forceQuitLeaseCurrent(lease, [first, second], 'notes-first', running)).toBe(true);
  });
}

for (const hasWindows of [true, false]) {
  test(`a restarted application cannot reuse an old confirmation with ${hasWindows ? 'identical' : 'zero'} windows`, () => {
    const windows = hasWindows ? [window('notes-first', 'notes')] : [];
    const lease = captureForceQuitLease('notes', 'quit', windows, 'original-lifetime');
    expect(forceQuitLeaseCurrent(lease, windows, 'replacement-lifetime', running)).toBe(false);
    const fresh = captureForceQuitLease('notes', 'quit', windows, 'replacement-lifetime');
    expect(forceQuitLeaseCurrent(fresh, windows, 'replacement-lifetime', running)).toBe(true);
  });
}

test('a restored lifetime cannot lend its pending confirmation to a later process', () => {
  const windows = [window('notes-restored', 'notes')];
  const lease = captureForceQuitLease('notes', 'quit', windows, undefined);
  expect(forceQuitLeaseCurrent(lease, windows, undefined, running)).toBe(true);
  expect(forceQuitLeaseCurrent(lease, windows, 'notes-reopened', running)).toBe(false);
});

test('a stopped app invalidates its confirmation even when handles and lifetime still match', () => {
  const windows = [window('notes-first', 'notes')];
  const lease = captureForceQuitLease('notes', 'quit', windows, 'notes-first');
  expect(forceQuitLeaseCurrent(lease, windows, 'notes-first', ['finder'])).toBe(false);
});

test('Finder relaunch tolerates utility turnover but not replacement ordinary windows or lifetime', () => {
  const folder = window('folder', 'finder'), notes = window('notes', 'notes');
  const lease = captureForceQuitLease('finder', 'relaunch', [folder, notes,
    window('about', 'finder', { utilityKind: 'system-about' })], 'finder-first');
  const current = [window('chooser', 'finder', { utilityKind: 'system-force-quit' }), notes, folder];
  folder.minimized = true;
  expect(forceQuitLeaseCurrent(lease, current, 'finder-first', running)).toBe(true);
  expect(forceQuitLeaseCurrent(lease, [current[0], notes, { ...folder }], 'finder-first', running)).toBe(false);
  expect(forceQuitLeaseCurrent(lease, [...current, window('new-folder', 'finder')], 'finder-first', running)).toBe(false);
  expect(forceQuitLeaseCurrent(lease, [current[0], notes], 'finder-first', running)).toBe(false);
  expect(forceQuitLeaseCurrent(lease, current, 'finder-relaunched', running)).toBe(false);
});

test('ordinary force quit includes application utility windows in the confirmed target set', () => {
  const main = window('notes-first', 'notes');
  const about = window('notes-about', 'notes', { utilityKind: 'application-about' });
  const lease = captureForceQuitLease('notes', 'quit', [main, about], 'notes-first');
  expect(forceQuitLeaseCurrent(lease, [main, about], 'notes-first', running)).toBe(true);
  expect(forceQuitLeaseCurrent(lease, [main], 'notes-first', running)).toBe(false);
});

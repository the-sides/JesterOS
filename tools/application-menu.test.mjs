import { expect, test } from 'bun:test';
import { createApplicationMenuCommands } from '../frontend/src/application-menu.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
function consumer() {
  const notes = createDefaultSceneSeed(profile).notes;
  const handlers = createApplicationMenuCommands({ profile, notes, available: () => true });
  return { notes, settings: payload => handlers['app.settings.set']({ appId: 'notes' }, payload) };
}

test('partial settings retain document data/selection and validate the entire patch before mutation', () => {
  const c = consumer(), documents = structuredClone(c.notes.notes), selectedId = c.notes.selectedId;
  expect(c.settings({ sortBy: 'title' }).status).toBe('applied');
  expect(c.settings({ groupByDate: false, textSize: 24 }).status).toBe('applied');
  const preferences = structuredClone(c.notes.preferences);
  for (const invalid of [{ sortBy: 'date-created', textSize: 25 }, { groupByDate: true, textSize: 11 },
    { sortBy: undefined }, { textSize: NaN }, { textSize: 13.5 }, { groupByDate: 'yes' }, { unknown: true }, {}]) {
    expect(c.settings(invalid).error.code).toBe('invalid_arguments');
    expect(c.notes.preferences).toEqual(preferences);
  }
  expect(c.notes.notes).toEqual(documents); expect(c.notes.selectedId).toBe(selectedId);
  expect(c.settings({ sortBy: 'date-edited', textSize: 12 }).status).toBe('applied');
  expect(c.notes.preferences.groupByDate).toBe(false);
});


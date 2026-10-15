import { createMailState } from './mail-state.js';
import { createContactsState } from './contacts-state.js';
import { createCalendarState } from './calendar-state.js';
import { createCallsState } from './calls-state.js';
import { createRemindersState } from './reminders-state.js';
import { createNotesWorkspace } from './notes-workspace-state.js';
import { editingPreferencesDefaults } from './editing-state.js';
import { nativeDomainDefinitions } from './native-domain-registry.js';

// Each application graph is created once for its scene, independent of windows.
export function createApplicationSceneState(profile, options = {}) {
  const sceneTime = options.sceneTime ?? Date.parse(profile.defaults.sceneTime);
  const creationOptions = { ...options, sceneTime };
  const state = {
    notes: createNotesWorkspace(profile),
    editing: editingPreferencesDefaults(),
    mail: createMailState(profile),
    contacts: createContactsState(profile),
    calendar: createCalendarState(profile),
    calls: createCallsState(profile),
    reminders: createRemindersState(profile),
  };
  for (const definition of Object.values(nativeDomainDefinitions)) {
    state[definition.key] = definition.createState(profile, creationOptions);
  }
  return state;
}

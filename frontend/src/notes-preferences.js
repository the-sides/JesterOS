import { object, choice, flag } from './command-schema.js';

export function notesPreferencesDefaults() {
  return { sortBy: 'date-edited', groupByDate: true, textSize: 14 };
}

export const notesPreferencesSchema = object({
  sortBy: choice('date-edited', 'date-created', 'title'),
  groupByDate: flag,
  textSize: { type: 'integer', minimum: 12, maximum: 24 },
});

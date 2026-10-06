// Original definitions bundled with the simulation. No web/Siri/Wikipedia
// fallback: an absent word or phrase remains an absent local entry.
const entries = [
  ['attachment', 'noun', 'A file included with a message or document.'],
  ['clipboard', 'noun', 'A temporary store for information that has been copied or cut.'],
  ['contact', 'noun', 'A person whose identifying or communication details are recorded.'],
  ['draft', 'noun', 'An unfinished version of a written work or message.'],
  ['email', 'noun', 'A message addressed for delivery through an electronic mail system.'],
  ['file', 'noun', 'A named collection of information stored as one item.'],
  ['finder', 'noun', 'Someone or something that locates an item.'],
  ['folder', 'noun', 'A container used to organize related files or records.'],
  ['help', 'noun', 'Assistance that makes a task easier to understand or complete.'],
  ['history', 'noun', 'A record of events or changes that happened earlier.'],
  ['local', 'adjective', 'Limited to a particular place or system rather than a remote one.'],
  ['message', 'noun', 'Information communicated to a person or group.'],
  ['note', 'noun', 'A short written record, explanation, or reminder.'],
  ['offline', 'adjective', 'Operating without a connection to a remote network service.'],
  ['recipient', 'noun', 'A person or destination intended to receive something.'],
  ['record', 'noun', 'Information kept so that an event, person, or item can be consulted later.'],
  ['scene', 'noun', 'A setting in which an event or activity takes place.'],
  ['selection', 'noun', 'An item or range of information chosen from a larger set.'],
  ['service', 'noun', 'An operation offered for use by another person or application.'],
  ['snapshot', 'noun', 'A fixed record of something as it existed at a particular moment.'],
  ['text', 'noun', 'Written characters that convey information.'],
  ['window', 'noun', 'A bounded area of a display used to present information or controls.'],
];
const dictionary = new Map(entries.map(([term, partOfSpeech, definition]) => [term, Object.freeze({ term, partOfSpeech, definition })]));

export function lookupOfflineDefinition(query) {
  if (typeof query !== 'string' || query.length > 256) return null;
  return dictionary.get(query.trim().toLocaleLowerCase('en-US')) ?? null;
}

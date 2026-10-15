import { nativeAppMetadata, nativeDomainDefinitions } from './native-domain-registry.js';
import { documentDestinationCatalog } from './document-destination-commands.js';

const canonicalApplications = {
  safari: { coverage: 'browser.local', domainKey: 'browser' },
  edge: { coverage: 'browser.local', domainKey: 'browser' },
  mail: { coverage: 'mail.local', domainKey: 'mail' },
  contacts: { coverage: 'contacts.cards', domainKey: 'contacts' },
  calendar: { coverage: 'calendar.events', domainKey: 'calendar' },
  facetime: { coverage: 'calls.local', domainKey: 'calls' },
  reminders: { coverage: 'apps.reminders', domainKey: 'reminders' },
  notes: { coverage: 'notes.workspace', domainKey: 'notes' },
  messages: { coverage: 'messages.conversations', domainKey: 'messages' },
  teams: { coverage: 'messages.conversations', domainKey: 'messages' },
};

function addCatalogCapabilities(capabilities, catalog, profileId) {
  for (const command of Object.values(catalog)) {
    if (command.profiles.includes(profileId)) capabilities.add(command.capability);
  }
}

// Compose at the direct module export, before any adapter captures applications.
// Native descriptors own their geometry, launch options and domain registration;
// shell placement remains the installed profile's policy.
export function composeNativeProfile(profile) {
  const applications = { ...profile.applications };
  for (const [id, metadata] of Object.entries(canonicalApplications)) {
    if (applications[id]) applications[id] = { ...applications[id], launchOptions: {}, ...metadata,
      ...(id === 'contacts' && profile.family === 'macos' ? { multipleWindows: true } : {}) };
  }
  for (const [id, descriptor] of Object.entries(nativeAppMetadata(profile))) {
    applications[id] = { ...applications[id], ...descriptor };
  }
  const capabilities = new Set([...profile.capabilities, 'scene.seed', 'scene.saved-session', 'document.destinations', 'printing.local',
    'shell.notification-center', 'shell.notification-delivery']);
  for (const definition of Object.values(nativeDomainDefinitions)) {
    addCatalogCapabilities(capabilities, definition.catalog, profile.id);
  }
  addCatalogCapabilities(capabilities, documentDestinationCatalog, profile.id);
  return { ...profile, applications, capabilities: [...capabilities] };
}

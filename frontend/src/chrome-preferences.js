import { browserPreferenceOptions } from './browser-state.js';

export const chromePreferenceLabels = Object.freeze({
  homepage: 'Homepage address (authored local pages)',
  searchEngine: 'Search engine label for local search',
  openWith: 'On startup',
  newTabs: 'New tabs open',
  switchToNewTab: 'Switch to newly opened tabs',
  autofillContacts: 'Fill from the scene’s fictional contacts',
  autofillPasswords: 'Offer the saved fictional password',
  searchSuggestions: 'Suggest matching authored pages in the address bar',
  blockFraud: 'Warn about the authored fraudulent-site fixture',
  preventTracking: 'Prevent local tracking',
  blockCookies: 'Block all local cookies (also prevents sample login)',
  extensions: 'Studio Contrast — increase rendered article contrast',
  develop: 'Enable local developer tools',
  showFullAddress: 'Show the complete address',
});

export const chromePreferenceChoices = Object.freeze({
  searchEngine: [['Studio Search', 'Studio Search'], ['DuckDuckGo', 'DuckDuckGo (local results only)']],
  openWith: [['start', 'Open the local New Tab page'], ['last', 'Continue from the last retained local window']],
  newTabs: [['start', 'Local New Tab page'], ['homepage', 'Configured homepage']],
});

// These are presentation mappings onto the existing profile’s persisted slots,
// not Chrome state, new enum values, or a second preferences graph.
export function chromePreferenceSections(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  const slots = browserPreferenceOptions[id];
  if (!slots) return [];
  const windows = id.startsWith('windows11');
  const modern = windows || id.includes('sonoma') || id.includes('golden-gate');
  const hasProfiles = slots.includes('Profiles');
  const rows = [
    ['people', modern ? 'You and Google' : 'People', windows ? 'Profiles' : hasProfiles ? 'Profiles' : 'General', []],
    ['autofill', windows ? 'Autofill and Passwords' : 'Autofill', windows ? 'Passwords' : 'AutoFill', ['autofillContacts', 'autofillPasswords']],
    ['appearance', 'Appearance', windows ? 'Appearance' : 'Tabs', ['showFullAddress', 'newTabs', 'switchToNewTab']],
    ['search', 'Search engine', 'Search', ['searchEngine', 'searchSuggestions']],
    ['startup', 'On startup', windows ? 'Start, home, and new tabs' : hasProfiles ? 'General' : 'Passwords', ['openWith', 'homepage']],
    ['privacy', windows ? 'Privacy, security, and search' : 'Privacy and security', windows ? 'Privacy, search, and services' : 'Security', windows ? ['blockFraud', 'preventTracking', 'blockCookies', 'searchEngine', 'searchSuggestions'] : ['blockFraud', 'preventTracking', 'blockCookies']],
    ['sites', 'Site settings', windows ? 'Cookies and site permissions' : 'Websites', []],
    ['downloads', 'Downloads', windows ? 'Downloads' : 'Privacy', []],
    ['extensions', 'Extensions', 'Extensions', ['extensions']],
    ['about', 'About Chrome', windows ? 'About Microsoft Edge' : 'Advanced', ['develop']],
  ];
  if (windows) rows.splice(rows.findIndex(row => row[0] === 'search'), 1);
  if (id.includes('sonoma')) rows.splice(2, 0, ['passwords', 'Password Manager', 'Passwords', []]);
  return rows.map(([sectionId, label, canonicalTab, keys]) => ({ id: sectionId, label, canonicalTab, keys }));
}

export function chromeSelectedPreference(state, profile, windowId) {
  const tab = state.windows.find(row => row.id === windowId)?.preferencesTab;
  return chromePreferenceSections(profile).find(row => row.canonicalTab === tab) ?? null;
}

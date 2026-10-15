import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { STORE_PROFILES, storeIdSchema, storeSectionSchema, storeReviewDraftSchema } from './store-state.js';
import { STORE_CATEGORIES } from './store-fixtures.js';
const text = (maxLength, minLength = 0) => ({ type: 'string', maxLength, minLength });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
export const storeWindowTarget = object({ windowId: storeIdSchema });
export const storeCommandPayloads = {
  'store.navigate': object({ section: storeSectionSchema, category: choice(...STORE_CATEGORIES.map(([name]) => name)) }, ['section']),
  'store.search': object({ query: text(512) }),
  'store.details': object({ packageId: storeIdSchema }),
  'store.story': object({ storyId: storeIdSchema }),
  'store.back': empty,
  'store.forward': empty,
  'store.screenshot': object({ index: choice(0, 1) }),
  'store.get': object({ packageId: storeIdSchema }),
  'store.install': object({ packageId: storeIdSchema }),
  'store.update': object({ packageId: storeIdSchema }),
  'store.updateAll': empty,
  'store.process': object({ downloadId: storeIdSchema }),
  'store.pause': object({ downloadId: storeIdSchema }),
  'store.resume': object({ downloadId: storeIdSchema }),
  'store.cancel': object({ downloadId: storeIdSchema }),
  'store.openInstalled': object({ packageId: storeIdSchema }),
  'store.uninstall': object({ packageId: storeIdSchema, confirmed: { const: true } }),
  'store.sheet': object({ sheet: choice('none', 'signin', 'account', 'review', 'settings', 'help', 'uninstall', 'system-update') }),
  'store.signIn': object({ name: text(80, 1) }),
  'store.signOut': empty,
  'store.reviewDraft': object({ draft: storeReviewDraftSchema }),
  'store.reviewSubmit': empty,
  'store.preferences': object({ inAppRatings: flag }),
  'store.copyLink': object({ packageId: storeIdSchema }),
  'store.selectAll': empty,
  'store.focus': object({ controlId: text(256, 1) }),
  'store.scroll': object({ top: number(0, Number.MAX_SAFE_INTEGER), left: number(0, Number.MAX_SAFE_INTEGER) }),
  'store.window.new': empty,
  'store.window.close': empty,
};
export const storeCatalog = Object.fromEntries(Object.entries(storeCommandPayloads).map(([name, payload]) => defineCommand(
  STORE_PROFILES, name, 'store.local', storeWindowTarget, payload,
  ['Original canonical Store graph, record/array identities, actual Root window ID, and authored scene clock.', 'Installation publishes the real local application registry atomically; installed descriptors route distinct local app IDs to the working Calculator family. No host installers, network, Apple/Microsoft credentials, payments, or subscriptions.', 'High Sierra toolbar; Mojave exact seven-section sidebar; Sonoma era; Golden Gate qualified macOS 26 styling; Windows Microsoft Store-style local equivalent.'],
  ['Guarded full-scene signed-budget transition or observed original mounted native control. Local staging progress is not network traffic.'], ['store'], [], storeWindowTarget,
)));

import { tick } from 'svelte';
import { choice, object, empty } from './command-schema.js';
import { applied, stale, unavailable, uiState } from './windows11-app-helpers.js';
import { createMessagesState, selectedMessageConversation } from './messages-state.js';
import { getOSProfile } from './os-profiles.js';

const profileId = 'windows11-23h2-22631.2428';
export const menus = ['more'];
export const createState = () => ({
  messages: createMessagesState(getOSProfile(profileId)),
  ui: { ...uiState(), surface: 'mini', page: 'chat', searchMode: 'names' },
});
export const specs = {
  'win11.teams.surface.set': [empty, object({ surface: choice('mini', 'full') }),
    ['Maximize the actual existing Teams window, or restore compact mini-window bounds.'],
    ['Retain the shared conversation graph and account.']],
  'win11.teams.page.set': [empty, object({ page: choice('chat', 'people') }),
    ['Navigate between the era-documented Chat and People experiences.'],
    ['Reset the search query and selected history hit only when changing search presentation.']],
  'win11.teams.searchMode.set': [empty, object({ mode: choice('names', 'history') }),
    ['Search by name, or Find in chat in a full window with a selected live conversation.'],
    ['History search is selected-chat-only and bounded to the six months before the scene date.']],
};

export function createCommands(apps, context) {
  const state = apps.teams;
  const visibleWindow = () => {
    const window = context.getWindow();
    if (!window || window.minimized || window.fullScreen || !context.getApplicationView(window.id)) return null;
    if (context.windowInteractionsAvailable && !context.windowInteractionsAvailable()) return null;
    return window;
  };
  const originalWindow = window => context.getWindow() === window && window.appId === 'teams';
  const clearSearch = () => {
    state.messages.query = '';
    state.messages.selectedMessageId = null;
    state.ui.focused = null;
    state.ui.selection = null;
  };
  return {
    'win11.teams.surface.set': async (_target, { surface }) => {
      const window = visibleWindow();
      if (!window) return unavailable('Restore the existing mounted Teams window and dismiss global dialogs first.');
      const result = await context.invoke('window.setMaximized', { windowId: window.id }, { maximized: surface === 'full' });
      if (result.status !== 'applied') return result;
      if (!originalWindow(window)) return stale('The original Teams window is no longer available.');
      if (surface === 'mini') {
        const bounds = window.bounds;
        const app = context.getProfile().applications.teams;
        const resized = await context.invoke('window.resize', { windowId: window.id }, {
          edge: 'se', x: bounds.x + app.width * bounds.scale, y: bounds.y + app.height * bounds.scale,
        });
        if (resized.status !== 'applied') return resized;
        if (!originalWindow(window)) return stale('The original Teams window closed while restoring the mini experience.');
        if (state.ui.searchMode !== 'names') {
          state.ui.searchMode = 'names';
          clearSearch();
        }
      }
      if (!originalWindow(window)) return stale('The original Teams window is no longer available.');
      state.ui.surface = surface;
      state.ui.menu = null;
      await tick();
      if (!originalWindow(window)) return stale('The original Teams window is no longer available.');
      return applied({ windowId: window.id }, { surface });
    },
    'win11.teams.page.set': async (_target, { page }) => {
      const window = visibleWindow();
      if (!window) return unavailable('Teams navigation requires a visible mounted window.');
      if (state.ui.page !== page || state.ui.searchMode !== 'names') clearSearch();
      state.ui.page = page;
      state.ui.searchMode = 'names';
      state.ui.menu = null;
      await tick();
      if (!originalWindow(window)) return stale('The original Teams window is no longer available.');
      return applied({ windowId: window.id }, { page });
    },
    'win11.teams.searchMode.set': async (_target, { mode }) => {
      const window = visibleWindow();
      if (!window) return unavailable('Teams search requires a visible mounted window.');
      if (mode === 'history') {
        if (state.ui.surface !== 'full') return unavailable('Open the full Teams experience before using Find in chat.');
        if (!selectedMessageConversation(state.messages)) return stale('Select a live chat before searching its message history.');
      }
      if (state.ui.searchMode !== mode || mode === 'history' && state.ui.page !== 'chat') clearSearch();
      state.ui.searchMode = mode;
      if (mode === 'history') state.ui.page = 'chat';
      state.ui.menu = null;
      await tick();
      if (!originalWindow(window)) return stale('The original Teams window is no longer available.');
      return applied({ windowId: window.id }, { mode });
    },
  };
}

export function readTargets(apps) {
  const state = apps.teams, selected = selectedMessageConversation(state.messages);
  return {
    account: { ...state.messages.account, fictional: true },
    surface: state.ui.surface, page: state.ui.page, searchMode: state.ui.searchMode,
    pages: ['chat', 'people'], surfaces: ['mini', 'full'],
    selectedConversationId: selected?.id ?? null,
    selectedMessageId: state.messages.selectedMessageId, query: state.messages.query,
    unreadOnly: state.messages.unreadOnly,
    conversations: state.messages.conversations.map(row => ({
      id: row.id, name: row.name, participants: [...row.participants], unread: row.unread,
      messageIds: row.items.map(item => item.id),
    })),
    search: { names: { scope: 'contacts-and-chat-names' }, history: {
      scope: 'selected-chat', conversationId: selected?.id ?? null, maximumCalendarMonths: 6,
      available: state.ui.surface === 'full' && Boolean(selected),
    } },
    availability: { chat: true, people: true, meet: false, compose: false, calls: false,
      accountChanges: false, deviceLink: false, serviceSync: false },
    menuItems: [
      { menu: 'more', id: 'whats-new', control: 'teams-menu-whats-new', enabled: false },
      { menu: 'more', id: 'feedback', control: 'teams-menu-feedback', enabled: false },
      { menu: 'more', id: 'link-phone', control: 'teams-menu-link-phone', enabled: false },
    ],
  };
}

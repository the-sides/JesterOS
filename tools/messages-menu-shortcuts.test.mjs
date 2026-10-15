import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
import { messagesAppMenuProviders, messagesMenuShortcut } from '../frontend/src/messages-app-menus.js';

const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const chord = (key, modifiers = {}) => ({ key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });
for (const profileId of profiles) {
  test(`${profileId}: keyboard shortcuts use the same available native menu requests`, () => {
    const profile = getOSProfile(profileId), state = createMessagesState(profile);
    const menus = messagesAppMenuProviders({ state, profile, windowId: 'original-window', available: true });
    const modern = ['sonoma', 'golden-gate'].includes(profile.renderer);
    const requested = (event) => messagesMenuShortcut(event, menus);
    expect(requested(chord('4', { ctrlKey: true }))?.command ?? null).toBe(modern ? 'messages.filter.setUnreadOnly' : null);
    if (modern) {
      expect(requested(chord('4', { ctrlKey: true })).payload).toEqual({ enabled: true });
      expect(requested(chord('1', { ctrlKey: true })).payload).toEqual({ enabled: false });
      expect(requested(chord('U', { shiftKey: true })).command).toBe('messages.conversation.setUnread');
    }
    expect(requested(chord(','))?.command ?? null).toBe(profile.family === 'macos' ? 'messages.conversation.details' : null);
    expect(requested(chord('f', { shiftKey: true }))).toBeNull();
    expect(requested(chord(' ', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(requested(chord(',', { altKey: true }))).toBeNull();
    expect(requested(chord('f', { metaKey: false }))).toBeNull();
    const unavailable = messagesAppMenuProviders({ state, profile, windowId: 'original-window', available: false });
    expect(messagesMenuShortcut(chord(','), unavailable)).toBeNull();
  });
}

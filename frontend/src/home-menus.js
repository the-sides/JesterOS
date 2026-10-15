import { homeCapabilities } from './home-state.js';
export function homeMenus(state, profile, windowId) {
  const target = { windowId }, session = state.windows.find(w => w.windowId === windowId), current = state.users.find(u => u.id === state.currentUserId), editing = !!(current?.owner || current?.edit);
  const item = (id, label, command, payload = {}, enabled = true) => ({ id, label, command, target, payload, enabled });
  return [
    { id: 'home', label: homeCapabilities(profile).native ? 'Home' : 'Local Home', items: [item('about', 'About Home', 'home.sheet', { sheet: 'about' }), item('settings', 'Home Settings…', 'home.sheet', { sheet: 'settings' }), item('close', 'Close Window', 'home.window.close')] },
    { id: 'file', label: 'File', items: [item('scene', 'Add Scene…', 'home.scene.edit', { sceneId: null }, editing), item('automation', 'Add Automation…', 'home.automation.edit', { automationId: null }, editing && state.hubAvailable)] },
    { id: 'edit', label: 'Edit', items: [item('edit-home', 'Edit Home…', 'home.sheet', { sheet: 'settings' }), item('edit-room', 'Edit Room…', 'home.sheet', { sheet: 'room' }, editing && !!session)] },
    { id: 'view', label: 'View', items: [item('show-home', 'Home', 'home.navigate', { section: 'home' }), item('show-automations', 'Automation', 'home.navigate', { section: 'automation' }), ...state.rooms.map(room => item(`room:${room.id}`, room.name, 'home.navigate', { section: 'rooms', roomId: room.id }))] },
    { id: 'help', label: 'Help', items: [item('help-home', 'Home Help', 'home.sheet', { sheet: 'help' })] },
  ];
}

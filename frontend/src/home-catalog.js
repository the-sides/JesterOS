import { object, choice, flag, defineCommand } from './command-schema.js';
import { HOME_PROFILES, homeId, homeValueSchema, homeActionSchema, homeSceneSpec, homeAutomationSpec, homeRoomSpec, homeUserSpec } from './home-state.js';
export const homeTarget = object({ windowId: homeId });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const partial = schema => object(schema.properties, []);
export const homePayloads = {
  'home.navigate': object({ section: choice('home', 'rooms', 'automation'), roomId: homeId }, ['section']),
  'home.sheet': object({ sheet: choice('none', 'settings', 'room', 'help', 'about') }),
  'home.menu': object({ menu: choice('none', 'home', 'file', 'edit', 'view', 'help') }),
  'home.accessory.open': object({ accessoryId: homeId }),
  'home.accessory.toggle': object({ accessoryId: homeId }),
  'home.accessory.set': object({ accessoryId: homeId, values: partial(homeValueSchema) }),
  'home.accessory.settings': object({ accessoryId: homeId, name: { type: 'string', minLength: 1, maxLength: 160 }, roomId: homeId, favorite: flag }),
  'home.accessory.reorder': object({ accessoryId: homeId, beforeId: nullable(homeId) }),
  'home.scene.run': object({ sceneId: homeId }),
  'home.scene.edit': object({ sceneId: nullable(homeId) }),
  'home.scene.draft': partial(homeSceneSpec),
  'home.scene.save': object(),
  'home.scene.delete': object({ sceneId: homeId, confirm: { const: true } }),
  'home.automation.edit': object({ automationId: nullable(homeId) }),
  'home.automation.draft': partial(homeAutomationSpec),
  'home.automation.save': object(),
  'home.automation.delete': object({ automationId: homeId, confirm: { const: true } }),
  'home.automation.enabled': object({ automationId: homeId, enabled: flag }),
  'home.automation.test': object({ automationId: homeId }),
  'home.room.save': object({ roomId: nullable(homeId), ...homeRoomSpec.properties }),
  'home.room.delete': object({ roomId: homeId, confirm: { const: true } }),
  'home.settings': object({ name: { type: 'string', minLength: 1, maxLength: 160 }, notes: { type: 'string', maxLength: 8192 }, wallpaper: choice('blue', 'orange', 'green') }),
  'home.user.set': object({ userId: homeId, values: partial(homeUserSpec) }),
  'home.user.remove': object({ userId: homeId, confirm: { const: true } }),
  'home.invite': homeUserSpec,
  'home.invite.cancel': object({ invitationId: homeId }),
  'home.local.invitation.accept': object({ invitationId: homeId }),
  'home.local.user': object({ userId: homeId }),
  'home.local.hub': object({ available: flag }),
  'home.local.device': object({ accessoryId: homeId, available: flag }),
  'home.local.presence': object({ home: flag }),
  'home.local.sensor': object({ accessoryId: homeId, motion: flag }),
  'home.window.close': object(),
};
export const homeCatalog = Object.fromEntries(Object.entries(homePayloads).map(([name, payload]) => defineCommand(HOME_PROFILES, name, 'apps.home', homeTarget, payload, ['Original Home state/window/session/view available', 'Closed bounded payload and complete scene quota', 'Owner/edit permission for settings; fictional local simulation controls are disclosed'], ['Actual canonical Home tiles, sheets and controls', 'Mojave native tabs; Sonoma sidebar; Golden Gate closest26 qualification', 'High Sierra and Windows explicitly functional local equivalents'], ['Home rooms, accessories, scenes, automations, invitations and original window sessions'])));
export { homeActionSchema };

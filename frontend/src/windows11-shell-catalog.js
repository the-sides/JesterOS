import { defineCommand, text, identity, flag, offset, choice, object, empty } from './command-schema.js';
import { shellPanels, quickControls, shellScrollAreas } from './windows11-shell-state.js';
import { desktopItemContracts } from './desktop-item-catalog.js';
import { desktopContextContracts } from './desktop-context-catalog.js';
const profiles = ['windows11-23h2-22631.2428'];
const command = (name, target, payload, effects, requires = [], data = []) => defineCommand(profiles, name, 'windows.shell', target, payload, requires, effects, data);
const nullableId = { anyOf: [identity, { type: 'null' }] };
const quickTarget = object({ control: choice(...quickControls) });
const quickPayload = object({ value: { anyOf: [flag, { type: 'number', minimum: 0, maximum: 100 }] } });
export const windows11ShellCatalog = Object.fromEntries([
  command('win11.panel.open', object({ panelId: choice(...shellPanels) }), empty, ['exclusive shell panel', 'native focus']),
  command('win11.panel.close', empty, object({ restoreFocus: flag }, []), ['panel dismiss', 'optional trigger focus']),
  command('win11.start.page', empty, object({ page: choice('pinned', 'all-apps') }), ['Start page']),
  command('win11.search.set', empty, object({ query: text }), ['local app and file search']),
  command('win11.app.activate', object({ appId: identity }), empty, ['launch or focus represented app', 'dismiss shell panels']),
  command('win11.taskbar.activate', object({ appId: identity }), empty, ['launch, focus, restore or minimize represented app']),
  defineCommand(profiles, 'win11.quick.set', 'windows.shell', quickTarget, quickPayload, [], ['shared fictional Quick Settings preference'], ['native.shell.quick'], [
    { if: { properties: { target: { type: 'object', properties: { control: choice('wifi', 'bluetooth', 'airplane') } } } }, then: { properties: { payload: { type: 'object', properties: { value: flag } } } }, else: { properties: { payload: { type: 'object', properties: { value: { type: 'number', minimum: 0, maximum: 100 } } } } } },
  ]),
  ...desktopItemContracts(profiles, 'win11.desktop', 'native.shell', 'native.apps.files', 'windows.shell'),
  command('win11.desktop.open', object({ fileId: identity }), empty, ['native virtual file handler']),
  ...desktopContextContracts(profiles, 'win11.desktop', 'native.shell', 'native.apps.files', 'windows.shell', 'windows'),
  defineCommand(profiles, 'win11.desktop.personalize', 'windows.shell', empty, empty, [], ['open and focus native Settings Personalization'], [], [], object({ page: choice('personalization') })),
  command('win11.desktop.show', empty, empty, ['minimize all visible windows', 'desktop focus']),
  command('win11.dialog.close', object({ dialogId: choice('properties') }), empty, ['dismiss local properties dialog']),
  command('win11.notification.dismiss', object({ notificationId: identity }), empty, ['remove local notification']),
  command('win11.notification.clear', empty, empty, ['clear local notifications']),
  command('win11.notification.open', object({ notificationId: identity }), empty, ['activate notification application']),
  command('win11.notification.doNotDisturb', empty, object({ enabled: flag }), ['fictional do-not-disturb preference']),
  command('win11.calendar.move', empty, object({ direction: choice(-1, 1) }), ['previous or next calendar month'], ['years 2020 through 2030 only']),
  command('win11.calendar.select', empty, object({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }), ['local calendar date selection'], ['valid displayed month day']),
  command('win11.shell.focus', object({ controlId: nullableId }), empty, ['observed or requested shell focus'], ['live mounted semantic control ID, or null for observed focus outside shell controls']),
  command('win11.shell.scroll', object({ area: choice(...shellScrollAreas) }), object({ top: offset, left: offset }, ['top']), ['retained native shell scroll offsets'], ['corresponding scroll surface mounted']),
  command('win11.shell.dismiss', empty, object({ restoreFocus: flag }, []), ['dismiss panels, context menu and dialog', 'optional desktop focus']),
]);

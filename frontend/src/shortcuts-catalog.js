import {defineCommand,object,choice} from './command-schema.js';
import {automatorCommandPayloads,automatorWindowTarget} from './automator-catalog.js';
import {AUTOMATOR_PROFILES,autoArray,automatorIdSchema} from './automator-state.js';
export const shortcutsCommandPayloads={...Object.fromEntries(Object.entries(automatorCommandPayloads).map(([name,schema])=>[name.replace(/^automator\./u,'shortcuts.'),schema])),'shortcuts.collection':object({collection:choice('editor','library')}),'shortcuts.input':object({fileIds:autoArray(automatorIdSchema,64)})};
export const shortcutsTargetSchema=automatorWindowTarget;
export const shortcutsCatalog=Object.fromEntries(Object.entries(shortcutsCommandPayloads).map(([name,payload])=>defineCommand(AUTOMATOR_PROFILES,name,'shortcuts.local',shortcutsTargetSchema,payload,['Original canonical Shortcuts document, stable native facade, actual original Root window, Files and authored scene time.','The shared genuine Automator action engine; portable .jworkflow only, never Apple .shortcut.'],['Bounded action editor, actual Files effects, published result metadata and truthful run/stop logs.'],['shortcuts','files'],[],shortcutsTargetSchema)));

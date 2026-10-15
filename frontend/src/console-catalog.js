import { object, choice, empty, defineCommand, flag } from './command-schema.js';
import { CONSOLE_PROFILES, consoleIdSchema, consoleFilterSchema, consolePreferencesSchema } from './console-state.js';
const nullable=schema=>({anyOf:[{type:'null'},schema]});
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength});
export const consoleWindowTarget=object({windowId:consoleIdSchema});
export const consoleCommandPayloads={
 'console.device':object({deviceId:nullable(consoleIdSchema)}),
 'console.source':object({sourceId:nullable(consoleIdSchema)}),
 'console.stream':object({streaming:flag}),
 'console.filter':object({filter:consoleFilterSchema}),
 'console.select':object({eventId:consoleIdSchema}),
 'console.inspect':object({eventId:consoleIdSchema},[]),
 'console.clear':empty,
 'console.export':object({format:choice('text','json','report'),scope:choice('selected','visible'),name:text(256,1)},['format','scope']),
 'console.search.save':object({name:text(128,1)}),
 'console.search.apply':object({searchId:consoleIdSchema}),
 'console.search.delete':object({searchId:consoleIdSchema}),
 'console.preferences':object({values:consolePreferencesSchema}),
 'console.panel':object({panel:choice('none','save-search','export','preferences','help')}),
 'console.menu':object({menuId:nullable(choice('app','file','edit','view','action'))}),
 'console.focus':object({controlId:text(128,1)}),
 'console.scroll':object({areaId:choice('events','detail','sidebar'),top:{type:'number',minimum:0,maximum:1000000},left:{type:'number',minimum:0,maximum:1000000}})
};
export const consoleCatalog=Object.fromEntries(Object.entries(consoleCommandPayloads).map(([name,payload])=>defineCommand(CONSOLE_PROFILES,name,'console.local-events',consoleWindowTarget,payload,['Original bounded transient Root event feed, window and session identities.','Clear/pause use per-window monotonic cursors; never delete or persist the shared feed.'],[`${name.slice(8)} using original local scene events.`],['console'],[],consoleWindowTarget)));

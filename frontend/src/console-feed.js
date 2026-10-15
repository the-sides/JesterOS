import { object, choice } from './command-schema.js';
import { consoleSchemaValid, consoleIdSchema, consoleEventSequence } from './console-state.js';
import { canonicalStringUnits } from './canonical-data.js';
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1};
const nullable=schema=>({anyOf:[{type:'null'},schema]});
export const consoleEntrySchema=object({id:consoleIdSchema,sequence:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER-1},time:{type:'number',minimum:0,maximum:8640000000000000},sourceAppId:consoleIdSchema,sourceWindowId:nullable(consoleIdSchema),command:{type:'string',minLength:1,maxLength:128},status:choice('applied','rejected'),severity:choice('info','warning','error')});
export const consoleFeedSchema=object({entries:{type:'array',items:consoleEntrySchema,maxItems:2048},revision:integer});
export function validConsoleFeed(feed) {
 if(!consoleSchemaValid(feed,consoleFeedSchema)||canonicalStringUnits(feed)>1024*1024)return false;
 let previous=0;
 for(const row of feed.entries){const sequence=consoleEventSequence(row);if(sequence<=previous||row.id!==`event-${sequence}`)return false;previous=sequence;}
 return true;
}
// Every nested original record/array AND scalar is leased; same-ID replacement is stale.
export function pinConsoleGraph(value) {
 if(!value||typeof value!=='object')return ()=>true;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.some(key=>!Object.hasOwn(descriptors[key],'value')))return ()=>false;
 const rows=keys.map(key=>[key,descriptors[key],pinConsoleGraph(descriptors[key].value)]);
 return ()=>{const now=Object.getOwnPropertyDescriptors(value),actualKeys=Reflect.ownKeys(now);return actualKeys.length===keys.length&&rows.every(([key,original,guard])=>Object.hasOwn(now,key)&&Object.hasOwn(now[key],'value')&&now[key].value===original.value&&now[key].enumerable===original.enumerable&&now[key].configurable===original.configurable&&now[key].writable===original.writable&&guard());};
}
export const consoleFeedMaximum=feed=>feed.entries.length?consoleEventSequence(feed.entries.at(-1)):0;
export function consoleSources(inventory,feed) {
 const ids=new Set(feed.entries.map(e=>e.sourceAppId).filter(Boolean));
 return Object.values(inventory.profile.applications).filter(app=>ids.has(app.id));
}

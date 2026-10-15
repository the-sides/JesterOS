import { object,choice,empty,flag,defineCommand } from './command-schema.js';
import { DICTIONARY_PROFILES,dictionaryIdSchema,dictionaryText,dictionaryInteger,dictionaryPreferencesSchema } from './dictionary-state.js';
import { DICTIONARY_SOURCES } from './dictionary-corpus.js';
export const dictionaryWindowTarget=object({windowId:dictionaryIdSchema});
export const dictionaryCommandPayloads={
 'dictionary.search':object({query:dictionaryText()}),
 'dictionary.lookup':object({term:dictionaryText(256,1),linked:flag},['term']),
 'dictionary.source':object({source:choice('all',...DICTIONARY_SOURCES.map(s=>s.id))}),
 'dictionary.history':object({direction:choice('back','forward','snapBack','clear'),index:dictionaryInteger(0,63)},[]),
 'dictionary.preferences':object({values:dictionaryPreferencesSchema}),
 'dictionary.fontSize':object({size:dictionaryInteger(12,28)}),
 'dictionary.pronounce':object({entryId:dictionaryText(300,1)}),
 'dictionary.copy':object({entryId:dictionaryText(300,1)},[]),
 'dictionary.paste':empty,
 'dictionary.panel':object({panel:choice('none','preferences','history','help')}),
 'dictionary.menu':object({menu:choice('none','dictionary','file','edit','go','view','window','help')}),
 'dictionary.focus':object({controlId:dictionaryText(300,1)}),
 'dictionary.scroll':object({top:{type:'number',minimum:0,maximum:1e7}}),
 'dictionary.close':empty
};
export const dictionaryCatalog=Object.fromEntries(Object.entries(dictionaryCommandPayloads).map(([name,payload])=>defineCommand(DICTIONARY_PROFILES,name,'dictionary.local',dictionaryWindowTarget,payload,['Original canonical Dictionary/native window/view identities and authored scene time.','Bundled WordNet3 definitions/thesaurus, original CC0 Apple terminology and encyclopedia; no live Wikipedia, remote downloads or fabricated pronunciation.'],['Actual native Dictionary controls with qualified local-equivalent and era disclosure.'],['dictionary'],[],dictionaryWindowTarget)));

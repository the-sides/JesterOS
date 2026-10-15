import { WORDNET_ENTRIES } from './dictionary-wordnet.js';
import { DICTIONARY_PRONUNCIATIONS } from './dictionary-pronunciation.js';
export const DICTIONARY_CORPUS_VERSION='wordnet3-local-1';
export const DICTIONARY_SOURCES=Object.freeze([
 {id:'dictionary',label:'Dictionary',name:'WordNet 3.0 — local selection',license:'Princeton WordNet license',description:'1,843 bundled headwords with original WordNet senses. Not the proprietary Oxford dictionary.'},
 {id:'thesaurus',label:'Thesaurus',name:'WordNet 3.0 Thesaurus',license:'Princeton WordNet license',description:'Synonyms and lexical antonyms from the same original WordNet synsets.'},
 {id:'apple',label:'Apple',name:'Apple terminology — local summaries',license:'CC0-1.0',description:'Original summaries of documented Apple concepts; not Apple’s licensed dictionary database.'},
 {id:'encyclopedia',label:'Local Encyclopedia',name:'Local Encyclopedia',license:'CC0-1.0',description:'Original offline articles; no live Wikipedia, network service or fictional download.'}
].map(Object.freeze));
const apple=[
 ['finder','The macOS application for viewing, accessing and organizing files, folders, disks and applications.','https://support.apple.com/guide/mac-help/mchlp2605/mac'],
 ['dock','The macOS bar containing application icons, minimized windows and the Trash. Applications can be kept in the Dock for quick access.','https://support.apple.com/guide/mac-help/mh35859/mac'],
 ['spotlight','The macOS system search interface for finding applications, files and information. This scene searches only its local authored data.','https://support.apple.com/guide/mac-help/mchlp1008/mac'],
 ['mission control','A macOS overview of open windows, desktop spaces and full-screen applications.','https://support.apple.com/guide/mac-help/mh35798/mac'],
 ['launchpad','An application launcher supplied in High Sierra, Mojave and Sonoma. Later profiles do not receive a historical backport in this scene.','https://support.apple.com/guide/mac-help/mh35840/14.0/mac/14.0'],
 ['stickies','A separate macOS application that keeps editable notes in small independent desktop windows. It is not the Notes application.','https://support.apple.com/guide/stickies/welcome/mac'],
 ['dictionary','A macOS reference application that searches enabled sources and keeps navigation history. This scene bundles openly licensed WordNet instead of Apple’s proprietary dictionary sources.','https://support.apple.com/guide/dictionary/dic34880/mac'],
 ['airdrop','Apple’s nearby file-sharing feature. This local scene does not contact real devices or transmit data.','https://support.apple.com/guide/mac-help/mh35868/mac'],
 ['icloud','Apple’s cloud service for storing and synchronizing supported data. Accounts and files in this scene are local fiction; no cloud synchronization occurs.','https://support.apple.com/guide/mac-help/mh36832/mac'],
 ['time machine','Apple’s macOS backup feature. Any scene backup is local simulation rather than a host disk backup.','https://support.apple.com/guide/mac-help/mh35860/mac']
];
const encyclopedia=[
 ['computer','A programmable machine that processes data according to instructions. Digital computers represent information using discrete values. A program specifies operations, while an operating system coordinates resources and provides services to applications. Modern personal computers combine processors, working memory, persistent storage and input/output devices.',['operating system','program','memory']],
 ['operating system','System software that coordinates computer hardware and supplies services to applications. Common responsibilities include scheduling computation, managing memory, organizing files and controlling access to devices. Desktop operating systems also provide a windowing environment. This scene models a desktop in a browser and does not operate the host computer.',['computer','file','window']],
 ['ocean','A large connected body of salt water covering much of Earth. Winds and differences in water density drive circulation. Ocean water exchanges heat with the atmosphere and supports diverse ecosystems. Coastal harbors provide sheltered places for vessels. The maps and places in this scene are authored fiction.',['earth','water','harbor']],
 ['dictionary','A reference work describing words or phrases, usually organized by headword. Entries may supply meanings, parts of speech, examples and pronunciation information. A thesaurus groups related meanings rather than providing the same information as a dictionary. The local WordNet corpus represents meanings as synsets.',['word','thesaurus','language']],
 ['mathematics','The study of numbers, patterns, structures and quantitative relationships. Arithmetic concerns operations on numbers; algebra describes relationships using symbols. Operator precedence and parentheses determine how an expression is interpreted. Floating-point computer arithmetic approximates many real numbers.',['number','operator','calculator']],
 ['photograph','An image made by recording light. Digital cameras sample the image onto a sensor and encode its pixel data in a file. Resolution measures pixel dimensions; metadata may describe capture conditions. An image rendered from an authored canvas is real image data but is not a photograph taken by a host camera.',['image','camera','light']],
 ['music','The organization of sounds over time. Pitch, duration, loudness and timbre shape a musical work. Digital recordings encode sampled signals and can be played without a network connection. A recorded spoken word is pronunciation audio, whereas an oscillator tone is not speech.',['sound','time','recording']],
 ['earth','The third planet from the Sun. Its surface includes land and oceans, surrounded by an atmosphere. Earth rotates about its axis and travels around the Sun. Local encyclopedia articles in this scene are original educational summaries, not downloaded Wikipedia pages.',['sun','planet','ocean']]
];
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const lexicon=new Map(WORDNET_ENTRIES.map(row=>[row.term,row]));
const appleMap=new Map(apple.map(([term,definition,reference])=>[term,{term,definition,reference}]));
const encyclopediaMap=new Map(encyclopedia.map(([term,definition,related])=>[term,{term,definition,related}]));
for(const row of WORDNET_ENTRIES)freeze(row);
const headwords=Object.freeze([...new Set([...lexicon.keys(),...appleMap.keys(),...encyclopediaMap.keys()])].sort());
export function normalizeDictionaryQuery(query){return typeof query==='string'&&query.length<=256?query.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US'):null;}
export function searchDictionary(query,{sources=DICTIONARY_SOURCES.map(s=>s.id),limit=32}={}){
 const q=normalizeDictionaryQuery(query);if(!q||!Array.isArray(sources))return [];
 const enabled=new Set(sources);return headwords.filter(term=>term.startsWith(q)&&((enabled.has('dictionary')||enabled.has('thesaurus'))&&lexicon.has(term)||enabled.has('apple')&&appleMap.has(term)||enabled.has('encyclopedia')&&encyclopediaMap.has(term))).slice(0,Math.max(0,Math.min(64,Number.isSafeInteger(limit)?limit:32)));
}
export function lookupDictionary(query,{sources=DICTIONARY_SOURCES.map(s=>s.id),selectedSource='all',pronunciation='ipa'}={}){
 const q=normalizeDictionaryQuery(query),entries=[];if(q&&Array.isArray(sources))for(const source of sources){if(selectedSource!=='all'&&source!==selectedSource)continue;
  const row=lexicon.get(q),clip=DICTIONARY_PRONUNCIATIONS[q]??null;
  if(source==='dictionary'&&row)entries.push({id:`dictionary:${q}`,source,term:q,partOfSpeech:row.senses[0].partOfSpeech,definition:row.senses[0].definition,senses:row.senses,related:[...new Set(row.senses.flatMap(s=>s.synonyms))],pronunciation:pronunciation==='none'?null:clip?{display:pronunciation==='ipa'?clip.ipa:clip.respelling,clip}:null});
  if(source==='thesaurus'&&row){const senses=row.senses.filter(s=>s.synonyms.length||s.antonyms.length);if(senses.length)entries.push({id:`thesaurus:${q}`,source,term:q,partOfSpeech:senses[0].partOfSpeech,definition:senses[0].definition,senses,related:[...new Set(senses.flatMap(s=>[...s.synonyms,...s.antonyms]))],pronunciation:null});}
  if(source==='apple'&&appleMap.has(q)){const a=appleMap.get(q);entries.push({id:`apple:${q}`,source,term:q,partOfSpeech:'Apple terminology',definition:a.definition,senses:[],related:[],reference:a.reference,pronunciation:null});}
  if(source==='encyclopedia'&&encyclopediaMap.has(q)){const a=encyclopediaMap.get(q);entries.push({id:`encyclopedia:${q}`,source,term:q,partOfSpeech:'encyclopedia article',definition:a.definition,senses:[],related:a.related,pronunciation:null});}
 }
 const suggestions=entries.length?[]:searchDictionary(q??'',{sources,limit:12});return {query:q??'',entries,suggestions,corpusVersion:DICTIONARY_CORPUS_VERSION};
}
export function dictionaryEntryText(entry){return [entry.term,DICTIONARY_SOURCES.find(s=>s.id===entry.source)?.name??entry.source,...(entry.senses.length?entry.senses.map(s=>`${s.partOfSpeech}: ${s.definition}${s.examples.length?'\n'+s.examples.map(x=>'“'+x+'”').join('\n'):''}${entry.source==='thesaurus'?'\nSynonyms: '+s.synonyms.join(', ')+'\nAntonyms: '+s.antonyms.join(', '):''}`):[entry.definition])].join('\n\n');}

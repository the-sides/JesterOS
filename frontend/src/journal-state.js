import {object,choice,flag} from './command-schema.js';
import {canonicalStringUnits,copyCanonicalData} from './canonical-data.js';
import {keynoteSchemaValid} from './keynote-state.js';
import {inspectJournalAttachment} from './journal-attachments.js';
export const JOURNAL_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const journalText=(maxLength=4096,minLength=0)=>({type:'string',maxLength,minLength});
export const journalNumber=(minimum,maximum)=>({type:'number',minimum,maximum});
export const journalId={...journalText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum}),nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems)=>({type:'array',items,maxItems});
export const journalBlockSchema=object({id:journalId,kind:choice('paragraph','heading','quote','bullet'),text:journalText(32768),bold:flag,italic:flag,underline:flag,font:journalText(128,1),size:journalNumber(8,72),color:{...journalText(7,7),pattern:'^#[0-9a-fA-F]{6}$'}});
export const journalAttachmentSchema=object({id:journalId,name:journalText(256,1),mime:choice('image/png','image/jpeg','image/webp','audio/wav','video/webm','application/pdf','text/plain'),content:journalText(1048576,1),source:choice('file','photo'),sourceId:journalId,sourceRevision:nullable({anyOf:[integer(),journalText(256,1)]}),width:integer(0,8192),height:integer(0,8192)});
export const journalEntrySchema=object({id:journalId,title:journalText(256,1),date:journalText(10,10),createdAt:journalText(64,1),bookmark:flag,blocks:array(journalBlockSchema,128),attachments:array(journalAttachmentSchema,16)});
export const journalContentSchema=object({title:journalText(256,1),entries:array(journalEntrySchema,128)});
const documentSchema=object({id:journalId,content:journalContentSchema,fileId:nullable(journalId),fileRevision:nullable(integer()),dirty:flag,savedFingerprint:journalText(1048576),undo:array(journalContentSchema,12),redo:array(journalContentSchema,12)});
export const journalSessionSchema=object({windowId:journalId,documentId:nullable(journalId),entryId:nullable(journalId),blockId:nullable(journalId),search:journalText(),filter:choice('all','bookmarked','attachments'),month:journalText(7),panel:choice('none','save','export','preferences','help','close','lock','attachments'),menu:nullable(choice('app','file','edit','format','view','window','help')),locked:flag});
export const journalSchema=object({version:{const:1},profileId:choice(...JOURNAL_PROFILES),revision:integer(),nextId:integer(1),documents:array(documentSchema,16),sessions:array(journalSessionSchema,32),preferences:object({photoSuggestions:flag,fileSuggestions:flag,lockOnClose:flag,salt:journalText(64),passHash:journalText(64)})});
export const journalSchemaValid=keynoteSchemaValid,journalTextUnits=canonicalStringUnits;
export const journalSession=(state,id)=>state.sessions.find(w=>w.windowId===id)??null;
export const journalDocument=(state,id)=>state.documents.find(d=>d.id===id)??null;
export const journalEntry=(document,id)=>document?.content.entries.find(e=>e.id===id)??null;
export const journalFingerprint=content=>JSON.stringify(content);
export function createJournalState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,documents:[],sessions:[],preferences:{photoSuggestions:false,fileSuggestions:false,lockOnClose:true,salt:'',passHash:''}};}
export function createJournalSession(windowId){return {windowId,documentId:null,entryId:null,blockId:null,search:'',filter:'all',month:'',panel:'none',menu:null,locked:false};}
export function createJournalBlock(state,text=''){return {id:`journal-block-${state.nextId++}`,kind:'paragraph',text,bold:false,italic:false,underline:false,font:'system-ui',size:16,color:'#292733'};}
export function createJournalEntry(state,time,title='New Entry'){const stamp=new Date(time).toISOString();return {id:`journal-entry-${state.nextId++}`,title,date:stamp.slice(0,10),createdAt:stamp,bookmark:false,blocks:[createJournalBlock(state)],attachments:[]};}
export function journalVisibleEntries(document,session){const query=session.search.toLocaleLowerCase('en-US');return (document?.content.entries??[]).filter(e=>(session.filter!=='bookmarked'||e.bookmark)&&(session.filter!=='attachments'||e.attachments.length)&&(!session.month||e.date.startsWith(session.month))&&(!query||[e.title,...e.blocks.map(b=>b.text),...e.attachments.map(a=>a.name)].join('\n').toLocaleLowerCase('en-US').includes(query))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));}
export function validateJournalState(state,profile){
 const bad=message=>({ok:false,message});
 if(!journalSchemaValid(state,journalSchema)||profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Invalid closed Journal graph or profile.');
 if(journalTextUnits(state)>1048576)return bad('Journal retained text, attachments and history exceed 1 MiB.');
 const docIds=new Set(),ids=new Set();
 for(const d of state.documents){
  if(docIds.has(d.id)||d.dirty!==(journalFingerprint(d.content)!==d.savedFingerprint)||d.fileId===null&&d.fileRevision!==null)return bad('Invalid document identity, dirty baseline or File reference.');
  docIds.add(d.id);let saved;
  try{saved=d.savedFingerprint?JSON.parse(d.savedFingerprint):null;}catch{return bad('Invalid saved journal.');}
  if(saved&&(!d.fileId||!journalSchemaValid(saved,journalContentSchema)))return bad('Invalid saved content or original File baseline.');
  for(const content of [d.content,...d.undo,...d.redo,...(saved?[saved]:[])]){
   const unique=new Set();
   for(const e of content.entries){
    const date=new Date(`${e.date}T00:00:00.000Z`);
    if(unique.has(e.id)||!/^\d{4}-\d{2}-\d{2}$/u.test(e.date)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==e.date||!Number.isFinite(Date.parse(e.createdAt))||!e.blocks.length)return bad('Invalid date, entry identity or rich content.');
    unique.add(e.id);
    for(const row of [...e.blocks,...e.attachments]){if(unique.has(row.id))return bad('Duplicate retained content identity.');unique.add(row.id);}
    for(const a of e.attachments){
     try{const geometry=inspectJournalAttachment(a);if(geometry.width!==a.width||geometry.height!==a.height)return bad('Retained attachment geometry differs from original bytes.');}
     catch{return bad('Attachment is not a genuine supported byte container.');}
    }
   }
  }
  for(const e of d.content.entries){if(ids.has(e.id))return bad('Entry belongs to multiple journals.');ids.add(e.id);}
 }
const windows=new Set();for(const w of state.sessions){const d=journalDocument(state,w.documentId),e=journalEntry(d,w.entryId);if(windows.has(w.windowId)||w.documentId&&!d||w.entryId&&!e||w.blockId&&!e?.blocks.some(b=>b.id===w.blockId)||w.month&&!/^\d{4}-\d{2}$/u.test(w.month)||w.locked&&!state.preferences.passHash)return bad('Invalid window selection or lock.');windows.add(w.windowId);}if(Boolean(state.preferences.salt)!==Boolean(state.preferences.passHash)||state.preferences.passHash&&!/^[a-f0-9]{64}$/u.test(state.preferences.passHash))return bad('Invalid local lock verifier.');return {ok:true};}
export function journalPersistenceState(state){const c=copyCanonicalData(state);for(const w of c.sessions){w.menu=null;w.panel='none';w.locked=Boolean(c.preferences.passHash);}return c;}
export function rehydrateJournalState(saved,profile){const valid=validateJournalState(saved,profile);if(!valid.ok)throw Error(valid.message);return journalPersistenceState(saved);}
export function journalAvailability(profile){const id=typeof profile==='string'?profile:profile.id,golden=id.includes('golden-gate'),windows=id.startsWith('windows11');return {appId:'journal',label:golden?'Journal':'Journal Local Equivalent',windows,golden,legacy:/high-sierra|mojave/u.test(id),disclosure:(golden?'Journal came to Mac with macOS Tahoe 26. Golden Gate 27 appearance uses a qualified Tahoe 26 proxy, not verified 27 pixel parity.':'Journal is not native to this installed OS version; this is a local equivalent of the macOS Tahoe 26 app.')+' Local rich journals and actual scene attachments only. No iCloud, intelligent suggestions, host permissions or Touch ID. The passphrase lock controls this app’s views and commands, not encryption; scene state and exported .jjournal/HTML/PDF copies remain readable.'};}
export function journalWindowMetadata(profile){return {title:journalAvailability(profile).label,width:1040,height:740,minWidth:740,minHeight:480,utilityKind:'journal'};}

import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
import { previewSchemaValid } from './preview-state.js';
import { photoContentValid } from './photos-state.js';
import { photoGeometry } from './photos-geometry.js';
export const IMAGE_PLAYGROUND_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const imagePlaygroundText=(maxLength=4096,minLength=0)=>({type:'string',maxLength,minLength});
export const imagePlaygroundId={...imagePlaygroundText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const imagePlaygroundInt=(minimum=0,maximum=2147483647)=>({type:'integer',minimum,maximum});
const nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems)=>({type:'array',items,maxItems});
export const IMAGE_PLAYGROUND_CONCEPTS=['mountains','forest','ocean','city','flowers','cat','rabbit','robot','sunset','night','stars','rainbow','hat','glasses'];
export const imagePlaygroundRecipeSchema=object({title:imagePlaygroundText(128,1),prompt:imagePlaygroundText(1024),concepts:array(choice(...IMAGE_PLAYGROUND_CONCEPTS),6),style:choice('animation','illustration','sketch'),seed:imagePlaygroundInt(),person:nullable(object({photoId:imagePlaygroundId,photoRevision:imagePlaygroundInt(0,Number.MAX_SAFE_INTEGER-1),name:imagePlaygroundText(128,1)}))});
const documentSchema=object({id:imagePlaygroundId,recipe:imagePlaygroundRecipeSchema,png:imagePlaygroundText(786432),renderedFingerprint:imagePlaygroundText(8192),fileId:nullable(imagePlaygroundId),fileRevision:nullable(imagePlaygroundInt(0,Number.MAX_SAFE_INTEGER-1)),savedFingerprint:imagePlaygroundText(8192),dirty:flag,undo:array(imagePlaygroundRecipeSchema,12),redo:array(imagePlaygroundRecipeSchema,12),variations:array(imagePlaygroundRecipeSchema,12)});
export const imagePlaygroundSessionSchema=object({windowId:imagePlaygroundId,documentId:nullable(imagePlaygroundId),panel:choice('none','people','save','export','help','close'),menu:nullable(choice('app','file','edit','image','view','window','help'))});
export const imagePlaygroundStateSchema=object({version:{const:1},profileId:choice(...IMAGE_PLAYGROUND_PROFILES),revision:imagePlaygroundInt(0,Number.MAX_SAFE_INTEGER-1),nextId:imagePlaygroundInt(1,Number.MAX_SAFE_INTEGER-1),documents:array(documentSchema,16),sessions:array(imagePlaygroundSessionSchema,32)});
export const imagePlaygroundSchemaValid=previewSchemaValid,imagePlaygroundTextUnits=canonicalStringUnits,imagePlaygroundFingerprint=r=>JSON.stringify(r);
export const imagePlaygroundSession=(s,id)=>s.sessions.find(w=>w.windowId===id)??null;
export const imagePlaygroundDocument=(s,id)=>s.documents.find(d=>d.id===id)??null;
export const imagePlaygroundOutputCurrent=d=>Boolean(d?.png&&d.renderedFingerprint===imagePlaygroundFingerprint(d.recipe));
export const createImagePlaygroundRecipe=()=>({title:'Untitled Image',prompt:'mountains forest sunset',concepts:[],style:'illustration',seed:1,person:null});
export const createImagePlaygroundSession=windowId=>({windowId,documentId:null,panel:'none',menu:null});
export const createImagePlaygroundState=profile=>({version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,documents:[],sessions:[]});
export function validateImagePlaygroundState(s,profile){
 const bad=message=>({ok:false,message});if(!imagePlaygroundSchemaValid(s,imagePlaygroundStateSchema))return bad('Invalid closed Image Playground graph.');
 if(profile&&s.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Foreign Image Playground profile.');
 if(imagePlaygroundTextUnits(s)>1048576)return bad('Image Playground recipes, actual pixels and retained history exceed 1 MiB.');
 const ids=new Set();for(const d of s.documents){const n=Number(/^imageplayground-document-([1-9]\d*)$/u.exec(d.id)?.[1]);if(ids.has(d.id)||!Number.isSafeInteger(n)||n>=s.nextId)return bad('Invalid document identity.');ids.add(d.id);
 if((d.fileId===null)!==(d.fileRevision===null)||d.dirty!==(imagePlaygroundFingerprint(d.recipe)!==d.savedFingerprint))return bad('Invalid File baseline or dirty state.');
 for(const recipe of [d.recipe,...d.undo,...d.redo,...d.variations])if(new Set(recipe.concepts).size!==recipe.concepts.length||recipe.concepts.length+(recipe.prompt.trim()?1:0)+(recipe.person?1:0)>7)return bad('At most seven distinct input elements.');
 for(const fp of [d.savedFingerprint,d.renderedFingerprint].filter(Boolean)){let r;try{r=JSON.parse(fp);}catch{return bad('Invalid recipe fingerprint.');}if(!imagePlaygroundSchemaValid(r,imagePlaygroundRecipeSchema))return bad('Invalid recipe baseline.');}
 if(d.savedFingerprint&&!d.fileId||Boolean(d.png)!==Boolean(d.renderedFingerprint)||d.png&&!photoContentValid(d.png,'image/png'))return bad('Output must contain genuine PNG bytes and its actual recipe.');
 if(d.png){try{const geometry=photoGeometry(d.png,'image/png');if(geometry.width!==512||geometry.height!==512)return bad('Procedural PNG must contain actual 512 × 512 geometry.');}catch{return bad('PNG geometry is invalid.');}}
 }
 const windows=new Set();for(const w of s.sessions){if(windows.has(w.windowId)||w.documentId&&!ids.has(w.documentId))return bad('Invalid original window selection.');windows.add(w.windowId);}return {ok:true};
}
export function imagePlaygroundPersistenceState(s){const valid=validateImagePlaygroundState(s);if(!valid.ok)throw Error(valid.message);const c=copyCanonicalData(s);for(const w of c.sessions){w.menu=null;w.panel='none';}return c;}
export function rehydrateImagePlaygroundState(s,profile){const valid=validateImagePlaygroundState(s,profile);if(!valid.ok)throw Error(valid.message);return imagePlaygroundPersistenceState(s);}
export function imagePlaygroundAvailability(profile){const id=typeof profile==='string'?profile:profile.id,golden=id.includes('golden-gate'),windows=id.startsWith('windows11');return {appId:'imageplayground',label:golden?'Image Playground':'Image Playground · Local',golden,windows,legacy:/high-sierra|mojave/u.test(id),disclosure:'Authored local procedural illustration — no AI, Apple Intelligence, likeness inference or model service. '+(golden?'Appearance qualified against documented macOS Tahoe 26, not verified macOS 27.':'Image Playground was introduced with macOS 15.2; this profile uses a clearly labeled local equivalent.')};}
export function imagePlaygroundWindowMetadata(profile){return {appId:'imageplayground',title:imagePlaygroundAvailability(profile).label,width:1040,height:730,minWidth:760,minHeight:520,utilityKind:'imageplayground',capability:'imageplayground.local',component:'ImagePlaygroundApp.svelte'};}

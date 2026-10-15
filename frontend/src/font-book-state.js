import {object,choice,flag} from './command-schema.js';
import {canonicalStringUnits,copyCanonicalData} from './canonical-data.js';
import {previewSchemaValid} from './preview-state.js';
export const FONT_BOOK_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const fontText=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength}),fontInt=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum});
export const fontIdSchema={...fontText(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const arr=(items,maxItems)=>({type:'array',items,maxItems}),nullable=s=>({anyOf:[{type:'null'},s]});
export const fontRowSchema=object({id:fontIdSchema,family:fontText(1024,1),style:fontText(1024,1),postscript:fontText(1024,1),source:choice('bundled','user'),location:choice('bundled','user','computer'),enabled:flag,bundledPath:nullable(fontText(256,1)),fileId:nullable(fontIdSchema),revision:nullable({anyOf:[fontInt(),fontText(256,1)]}),signature:{...fontText(64,64),pattern:'^[a-f0-9]{64}$'},format:choice('ttf','otf','woff2'),license:fontText(1024)});
export const fontGraphSchema=object({version:{const:1},profileId:choice(...FONT_BOOK_PROFILES),nextId:fontInt(1),fonts:arr(fontRowSchema,128),collections:arr(object({id:fontIdSchema,name:fontText(128,1),fontIds:arr(fontIdSchema,128)}),32),preferences:object({installTarget:choice('user','computer'),automaticValidation:flag})});
export const fontBookWindowSchema=object({windowId:fontIdSchema,search:fontText(256),source:choice('all','user','bundled','collection'),collectionId:nullable(fontIdSchema),selectedId:nullable(fontIdSchema),view:choice('grid','sample','list'),preview:choice('sample','repertoire','custom','information'),sample:fontText(4096),size:fontInt(8,144),panel:choice('none','preferences','validation','duplicates','collection'),menu:nullable(choice('fontbook','file','edit','view','window','help')),status:fontText(1024),revision:fontInt()});
export const fontBookSchema=object({version:{const:1},profileId:choice(...FONT_BOOK_PROFILES),windows:arr(fontBookWindowSchema,32)});
export const fontBookWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
const bad=message=>({ok:false,message});
export function validateFontGraph(graph,profile){
 if(!previewSchemaValid(graph,fontGraphSchema)||profile&&graph.profileId!==(typeof profile==='string'?profile:profile.id)||canonicalStringUnits(graph)>512*1024)return bad('Invalid bounded shared font graph.');
 const ids=graph.fonts.map(f=>f.id),collections=graph.collections.map(c=>c.id);
 if(new Set([...ids,...collections]).size!==ids.length+collections.length||new Set(graph.collections.map(c=>c.name)).size!==graph.collections.length)return bad('Duplicate font or collection identity.');
 for(const f of graph.fonts){
  if(f.source==='bundled'){
   const original=BUNDLED_FONTS.find(seed=>seed.id===f.id);
   if(!original||Object.keys(original).some(key=>key!=='enabled'&&original[key]!==f[key]))return bad('Bundled font provenance cannot be invented or changed.');
  }else if(f.location==='bundled'||!f.fileId||f.revision===null||f.bundledPath!==null||f.format==='woff2')return bad('Invalid font source lease.');
 }
 if(graph.collections.some(c=>new Set(c.fontIds).size!==c.fontIds.length||c.fontIds.some(id=>!ids.includes(id))))return bad('Dangling collection member.');
 return {ok:true};
}
export function validateFontBookState(state,profile){return previewSchemaValid(state,fontBookSchema)&&(!profile||state.profileId===(typeof profile==='string'?profile:profile.id))&&new Set(state.windows.map(w=>w.windowId)).size===state.windows.length&&canonicalStringUnits(state)<=256*1024?{ok:true}:bad('Invalid Font Book session graph.');}
export const BUNDLED_FONTS=Object.freeze([
 Object.freeze({id:'bundled-liberation',family:'Liberation Sans',style:'Regular',postscript:'LiberationSans',source:'bundled',location:'bundled',enabled:true,bundledPath:'/fonts/LiberationSans-Regular.ttf',fileId:null,revision:null,signature:'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee',format:'ttf',license:'SIL OFL 1.1; Google 2010, Red Hat 2012; /fonts/Liberation-LICENSE.txt'}),
 Object.freeze({id:'bundled-inter',family:'Inter Variable',style:'Regular',postscript:'InterVariable',source:'bundled',location:'bundled',enabled:true,bundledPath:'/fonts/InterVariable.woff2',fileId:null,revision:null,signature:'693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',format:'woff2',license:'SIL OFL 1.1; The Inter Project Authors 2016; /fonts/LICENSE.txt'})
]);
export function createFontGraph(profile,{sceneTime=0}={}){return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:1,fonts:copyCanonicalData(BUNDLED_FONTS),collections:[],preferences:{installTarget:'user',automaticValidation:true}};}
export function createFontBookState(profile,{sceneTime=0}={}){return {version:1,profileId:typeof profile==='string'?profile:profile.id,windows:[]};}
export function createFontBookWindow(windowId){return {windowId,search:'',source:'all',collectionId:null,selectedId:'bundled-liberation',view:'grid',preview:'sample',sample:'The quick brown fox jumps over the lazy dog. 0123456789',size:36,panel:'none',menu:null,status:'',revision:0};}
export function fontBookCapabilities(profile){const id=typeof profile==='string'?profile:profile.id;return {classic:/high-sierra|mojave/u.test(id),windows:id.startsWith('windows11'),golden:id.includes('golden-gate'),availability:id.startsWith('windows11')?'Font Library — fictional local equivalent; Windows 11 has Fonts settings, not Apple Font Book.':id.includes('golden-gate')?'Font Book — qualified nearest macOS Tahoe 26 styling; no native 27 pixel certification.':'Font Book — native-era layout with genuine local bundled and installed font bytes.'};}
export function fontBookWindowMetadata(profile){return {appId:'fontbook',title:fontBookCapabilities(profile).windows?'Font Library':'Font Book',width:820,height:580,minWidth:650,minHeight:420,utilityKind:'fontbook',component:'FontBookApp.svelte'};}
export function fontBookPersistenceProjection(state){const next=copyCanonicalData(state);for(const w of next.windows){w.panel='none';w.menu=null;}return next;}

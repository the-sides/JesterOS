import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {createFontGraph,createFontBookState,validateFontGraph,validateFontBookState,FONT_BOOK_PROFILES} from '../frontend/src/font-book-state.js';
import {parseFont,fontSignature,fontCharacters} from '../frontend/src/font-book-parser.js';
import {createFontBookCommands} from '../frontend/src/font-book-commands.js';
import {availableFonts,fontCSSFamily,loadAvailableFonts} from '../frontend/src/font-book-fonts.js';
import {bytesDataURL} from '../frontend/src/keychain-certificates.js';
import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from '../frontend/src/canonical-data.js';
const bytes=new Uint8Array(await readFile(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf',import.meta.url)));
function scene(profile=FONT_BOOK_PROFILES[0]){
 const state=createFontBookState(profile),fonts=createFontGraph(profile),windows=[{id:'window-fontbook',appId:'fontbook'}],files={entries:[{id:'font-file',name:'LiberationSans-Regular.ttf',content:bytesDataURL(bytes,'font/ttf'),revision:1,deleted:false}]};
 let sharedGraph=fonts,allow=true,pending=0,refusePair=false,readGate=null;
 const ctx={profile,crypto:webcrypto,getState:()=>state,alive:()=>true,getSceneTime:()=>1720000000000,getWindow:id=>windows.find(w=>w.id===id),getView:()=>null,available:()=>true,getShared:name=>name==='fonts'?sharedGraph:null,getFilesStore:()=>files,getFile:id=>files.entries.find(f=>f.id===id&&!f.deleted),canCommit:delta=>allow&&canonicalStringUnits(state)+canonicalStringUnits(sharedGraph)+canonicalStringUnits(files)+pending+delta<=4*1024*1024,
 async readFile(id,ownership){if(readGate)await readGate;const file=ctx.getFile(id);return ownership.guard()?{status:'applied',file,text:file.content,mime:'font/ttf',name:file.name}:{status:'rejected',error:{code:'stale_target'}};},
 async mutateShared(name,mutator,ownership){if(name!=='fonts'||!ownership.guard())return {status:'rejected',error:{code:'stale_target'}};const candidate=copyCanonicalData(sharedGraph);if(mutator(candidate)!==true||!validateFontGraph(candidate,profile).ok)return {status:'rejected',error:{code:'invalid_state'}};pending=canonicalStringUnits(candidate)-canonicalStringUnits(sharedGraph);const accepted=!refusePair&&ctx.canCommit(ownership.reserveTextUnits)&&ownership.guard()&&ownership.onCommit()===true;pending=0;if(!accepted)return {status:'rejected',error:{code:'limit_exceeded'}};applyCanonicalData(sharedGraph,candidate);return {status:'applied'};}};
 const controller=createFontBookCommands(state,ctx);assert.equal(controller.windowOpened(windows[0]),true);
 return {state,fonts,windows,files,ctx,controller,run:(name,payload={})=>controller.handlers[`fontbook.${name}`]({windowId:windows[0].id},payload),setAllow:v=>allow=v,setRefuse:v=>refusePair=v,setReadGate:p=>readGate=p,replaceGraph:()=>sharedGraph=copyCanonicalData(sharedGraph)};
}
test('bundled TTF parser extracts actual names, glyph count, signature and Unicode repertoire',async()=>{
 const parsed=parseFont(bytes);assert.equal(parsed.family,'Liberation Sans');assert.equal(parsed.style,'Regular');assert.equal(parsed.postscript,'LiberationSans');assert.equal(parsed.format,'ttf');assert.ok(parsed.glyphs>1000);
 assert.equal(await fontSignature(bytes,webcrypto),'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee');const repertoire=fontCharacters(bytes);assert.ok(repertoire.includes(65));assert.ok(repertoire.includes(0x00e9));assert.ok(!repertoire.includes(0));assert.equal(new Set(repertoire).size,repertoire.length);
 const corrupt=bytes.slice(),v=new DataView(corrupt.buffer),offset=v.getUint32(20);corrupt[offset]^=1;assert.throws(()=>parseFont(corrupt),/checksum/);assert.throws(()=>parseFont(bytes.subarray(0,80)),/directory|range/);assert.throws(()=>parseFont(new TextEncoder().encode('{"font":"fake.ttf"}')),/signature/);
});
for(const profile of FONT_BOOK_PROFILES)test(`${profile}: shared enablement, source revision and collection CRUD reach available-font consumer`,async()=>{
 const s=scene(profile),originalFonts=s.fonts.fonts,original=s.fonts.fonts[0];
 await s.run('font',{operation:'disable',fontId:original.id});assert.equal(original.enabled,false);assert.equal(availableFonts(s.fonts,s.ctx.getFile).includes(original),false);
 await s.run('font',{operation:'enable',fontId:original.id});assert.equal(availableFonts(s.fonts,s.ctx.getFile)[0],original);
 const installed=await s.run('install',{fileId:'font-file',duplicates:'keep'});assert.equal(installed.status,'applied');const font=s.fonts.fonts.find(f=>f.id===installed.fontId);assert.equal(font.signature,original.signature);assert.equal(font.fileId,'font-file');assert.equal(font.location,'user');
 const c=await s.run('collection',{operation:'create',name:'Writing'});await s.run('collection',{operation:'add',collectionId:c.collectionId,fontId:font.id});assert.deepEqual(s.fonts.collections[0].fontIds,[font.id]);
 await s.run('collection',{operation:'rename',collectionId:c.collectionId,name:'Drafting'});assert.equal(s.fonts.collections[0].name,'Drafting');
 s.files.entries[0].revision++;assert.equal(availableFonts(s.fonts,s.ctx.getFile).includes(font),false);assert.equal((await s.run('font',{operation:'enable',fontId:font.id})).status,'rejected');
 await s.run('font',{operation:'remove',fontId:font.id});assert.deepEqual(s.fonts.collections[0].fontIds,[]);assert.equal(s.state.windows[0].selectedId,null);assert.equal(s.files.entries.length,1);
 assert.equal(s.fonts.fonts,originalFonts);assert.equal(s.fonts.fonts[0],original);assert.equal(validateFontGraph(s.fonts,profile).ok,true);assert.equal(validateFontBookState(s.state,profile).ok,true);
});
test('duplicates have explicit keep/skip/replace and active-copy resolution',async()=>{
 const s=scene();const before=JSON.stringify(s.fonts);assert.equal((await s.run('install',{fileId:'font-file'})).error.code,'duplicate');assert.equal(JSON.stringify(s.fonts),before);
 const added=await s.run('install',{fileId:'font-file',duplicates:'replace'});assert.equal(s.fonts.fonts[0].enabled,false);assert.equal(s.fonts.fonts.find(f=>f.id===added.fontId).enabled,true);
 await s.run('duplicates',{keepId:'bundled-liberation'});assert.equal(s.fonts.fonts[0].enabled,true);assert.equal(s.fonts.fonts.find(f=>f.id===added.fontId).enabled,false);
});
test('paired shared refusal and whole-scene budget refusal publish neither actor nor shared graph',async()=>{
 const s=scene(),beforeState=JSON.stringify(s.state),beforeFonts=JSON.stringify(s.fonts);s.setRefuse(true);assert.equal((await s.run('font',{operation:'disable',fontId:'bundled-liberation'})).status,'rejected');assert.equal(JSON.stringify(s.state),beforeState);assert.equal(JSON.stringify(s.fonts),beforeFonts);
 s.setRefuse(false);s.setAllow(false);assert.equal((await s.run('collection',{operation:'create',name:'Budget growth'})).status,'rejected');assert.equal(JSON.stringify(s.state),beforeState);assert.equal(JSON.stringify(s.fonts),beforeFonts);
});
test('install await rejects same-id File replacement, same-shape font graph replacement and disposal',async()=>{
 for(const change of ['file','graph','disposed']){const s=scene();let release;s.setReadGate(new Promise(resolve=>release=resolve));const before=JSON.stringify(s.state),promise=s.run('install',{fileId:'font-file',duplicates:'keep'});if(change==='file')s.files.entries[0]={...s.files.entries[0]};else if(change==='graph')s.replaceGraph();else s.controller.dispose();release();assert.equal((await promise).status,'rejected');assert.equal(JSON.stringify(s.state),before);assert.equal(s.fonts.fonts.length,2);}
});
test('install preferences give actual source location, safe validation and original panel selection',async()=>{
 const s=scene();await s.run('preferences',{installTarget:'computer',automaticValidation:false});const result=await s.run('install',{fileId:'font-file',duplicates:'keep'});assert.equal(s.fonts.fonts.find(f=>f.id===result.fontId).location,'computer');assert.equal(s.state.windows[0].selectedId,result.fontId);
});
test('original font loader verifies bytes before adding any face and tears down actual added faces',async()=>{
 const graph=createFontGraph(FONT_BOOK_PROFILES[0]);graph.fonts.splice(1);const added=new Set(),fontSet={add:face=>added.add(face),delete:face=>added.delete(face)};
 class Face{constructor(family,data){this.family=family;this.bytes=data;}async load(){return this;}}
 const loaded=await loadAvailableFonts(graph,{cryptoProvider:webcrypto,fontSet,FontFaceClass:Face,fetchBytes:async()=>bytes,getFile:()=>null});assert.equal(added.size,1);assert.equal(loaded.fonts[0],graph.fonts[0]);assert.ok(loaded.characters[graph.fonts[0].id].includes(65));assert.equal('"'+[...added][0].family+'"',fontCSSFamily(graph.fonts[0]));loaded.dispose();assert.equal(added.size,0);
 const changed=bytes.slice();changed[100]^=1;await assert.rejects(loadAvailableFonts(graph,{cryptoProvider:webcrypto,fontSet,FontFaceClass:Face,fetchBytes:async()=>changed}),/signature/);assert.equal(added.size,0);
});
test('trashed ancestors and unavailable parent graphs remove fonts from actual consumer choices',async()=>{
 const s=scene(),installed=await s.run('install',{fileId:'font-file',duplicates:'keep'}),font=s.fonts.fonts.find(f=>f.id===installed.fontId);
 const parent={id:'font-folder',parentId:null,revision:1,deleted:false};s.files.entries.push(parent);s.files.entries[0].parentId=parent.id;
 assert.ok(availableFonts(s.fonts,s.ctx.getFile).includes(font));
 parent.deleted=true;
 assert.ok(!availableFonts(s.fonts,s.ctx.getFile).includes(font));
 assert.equal((await s.run('font',{operation:'validate',fontId:font.id})).status,'rejected');
});
test('font loading cannot publish faces after original File replacement with identical id and revision',async()=>{
 const s=scene(),installed=await s.run('install',{fileId:'font-file',duplicates:'keep'}),graph=s.fonts;
 graph.fonts.splice(0,2);
 let release;const gate=new Promise(resolve=>release=resolve),added=[];
 class Face{constructor(family,data){this.family=family;this.data=data;}async load(){await gate;return this;}}
 const pending=loadAvailableFonts(graph,{cryptoProvider:webcrypto,getFile:s.ctx.getFile,fontSet:{add:face=>added.push(face),delete(){}},FontFaceClass:Face});
 s.files.entries[0]={...s.files.entries[0]};release();
 await assert.rejects(pending,/changed/);assert.deepEqual(added,[]);assert.ok(installed.fontId);
});
test('retired rendering owners and disabled original faces cannot publish after awaited font loading',async()=>{
 for(const reason of ['owner','disabled','removed','ancestor']){
  const s=scene(),installed=await s.run('install',{fileId:'font-file',duplicates:'keep'});
  s.fonts.fonts.splice(0,2);const font=s.fonts.fonts[0],added=new Set();
  const parent={id:'font-folder',parentId:null,deleted:false};s.files.entries.push(parent);s.files.entries[0].parentId=parent.id;
  let alive=true,release,started;const gate=new Promise(resolve=>release=resolve),loading=new Promise(resolve=>started=resolve);
  class Face{async load(){started();await gate;return this;}}
  const pending=loadAvailableFonts(s.fonts,{cryptoProvider:webcrypto,getFile:s.ctx.getFile,guard:()=>alive,fontSet:{add:face=>added.add(face),delete:face=>added.delete(face)},FontFaceClass:Face});
  await loading;if(reason==='owner')alive=false;else if(reason==='disabled')font.enabled=false;else if(reason==='removed')s.fonts.fonts.splice(0);else parent.deleted=true;
  release();await assert.rejects(pending,/changed/);assert.equal(added.size,0);assert.ok(installed.fontId);
 }
});
test('font-set publication failure rolls back every actual added face',async()=>{
 const graph=createFontGraph(FONT_BOOK_PROFILES[0]);graph.fonts.splice(1);graph.fonts.push({...graph.fonts[0],id:'another-original-face'});
 const added=new Set();let calls=0;
 class Face{async load(){return this;}}
 await assert.rejects(loadAvailableFonts(graph,{cryptoProvider:webcrypto,getFile:()=>null,FontFaceClass:Face,fetchBytes:async()=>bytes,fontSet:{add(face){added.add(face);if(++calls===2)throw new Error('Actual font set refused publication.');},delete:face=>added.delete(face)}}),/refused publication/);
 assert.equal(added.size,0);
});

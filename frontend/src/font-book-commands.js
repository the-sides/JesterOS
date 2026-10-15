import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
import {fontBookCommandSpecs,fontBookTargetSchema} from './font-book-catalog.js';
import {validateFontBookState,validateFontGraph,createFontBookWindow,fontBookWindow,fontBookCapabilities} from './font-book-state.js';
import {localController,readActualFile,rejected,applied} from './keychain-controller.js';
import {parseFont,fontSignature,bytesFromFile} from './font-book-parser.js';
import {bytesDataURL} from './keychain-certificates.js';
import {availableFonts,fontSourceAvailable} from './font-book-fonts.js';
export function createFontBookCommands(state,ctx){const core=localController(state,ctx,{appId:'fontbook',validate:validateFontBookState,createWindow:createFontBookWindow,shared:'fonts',validateShared:validateFontGraph}),handlers={};
 async function shared(owner,mutate,status){
  if(typeof ctx.mutateShared!=='function')return rejected('unavailable','Atomic shared-font mutation endpoint unavailable.');
  const graph=copyCanonicalData(owner.graph);
  let extra;
  try{extra=mutate(graph)??{};}catch(error){return rejected('invalid_arguments',error.message);}
  if(extra.status==='rejected')return extra;
  const valid=validateFontGraph(graph,ctx.profile);
  if(!valid.ok)return rejected('invalid_state',valid.message);
  const plan=core.plan(owner,(candidate,w)=>{
   for(const session of candidate.windows){
    if(session.selectedId&&!graph.fonts.some(f=>f.id===session.selectedId))session.selectedId=null;
    if(session.collectionId&&!graph.collections.some(c=>c.id===session.collectionId)){session.collectionId=null;session.source='all';}
   }
   if(extra.fontId){w.selectedId=extra.fontId;w.source='all';}
   if(extra.collectionId){w.collectionId=extra.collectionId;w.source='collection';}
   w.status=status;w.panel='none';
  });
  if(plan.error)return plan.error;
  const sharedDelta=canonicalStringUnits(graph)-canonicalStringUnits(owner.graph);
  if(ctx.canCommit(sharedDelta+plan.delta)!==true)return rejected('limit_exceeded','Combined shared fonts and session budget exceeded.');
  let ack=false;
  const plannedSignature=JSON.stringify(graph);
  const response=await ctx.mutateShared('fonts',candidate=>{
   if(!owner.guard()||JSON.stringify(candidate)!==JSON.stringify(owner.graph))return false;
   applyCanonicalData(candidate,graph);
   return JSON.stringify(candidate)===plannedSignature;
  },{windowId:owner.windowId,guard:owner.guard,reserveTextUnits:plan.delta,onCommit:()=>{
   if(ack||!owner.guard()||ctx.canCommit(plan.delta)!==true)return false;
   core.publish(plan.candidate);ack=true;return true;
  }});
  return ack?applied(owner.windowId,extra):response?.status==='rejected'?response:rejected('stale_target','Shared fonts and actor did not atomically commit.');
 }
 async function source(owner,row){if(!fontSourceAvailable(row,ctx.getFile))return {error:rejected('source_unavailable','Original font File is missing, trashed or revised. Remove and reinstall it.')};if(row.source==='user'){const read=await readActualFile(ctx,owner,row.fileId);return read.error?read:{...read,bytes:bytesFromFile(read.text)};}const fetchBytes=ctx.readBundledFont??(async path=>{const response=await fetch(path);if(!response.ok)throw new Error('Bundled font unavailable.');return new Uint8Array(await response.arrayBuffer());});const bytes=await fetchBytes(row.bundledPath);if(!owner.guard())return {error:rejected('stale_target','Original font graph changed.')};return {bytes,guard:owner.guard};}
 for(const [suffix,[schema]] of Object.entries(fontBookCommandSpecs))handlers[`fontbook.${suffix}`]=async(target,p={})=>{if(!previewSchemaValid(target,fontBookTargetSchema)||!previewSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Font Book command schema.');const owner=core.lease(target.windowId);if(!owner)return rejected('unavailable','Original Font Book window and shared font graph unavailable.');try{
 if(suffix==='focus'){const result=owner.view?.available?.()===true?await owner.view.focus(p.controlId,owner.guard):false;return owner.guard()&&result?applied(owner.windowId):rejected('unavailable','Original mounted native control unavailable.');}
 if(suffix==='window.close')return ctx.closeWindow?await ctx.closeWindow(owner.windowId,{windowId:owner.windowId,guard:owner.guard}):rejected('unavailable','Native shell close unavailable.');
 if(['navigate','preview','panel','menu'].includes(suffix))return core.commit(owner,(_,w)=>{if(p.selectedId&&!owner.graph.fonts.some(f=>f.id===p.selectedId))throw new Error('Font not installed.');if(p.collectionId&&!owner.graph.collections.some(c=>c.id===p.collectionId))throw new Error('Collection missing.');for(const key of Object.keys(p))w[key]=p[key];});
 if(suffix==='install'){
  let fileId=p.fileId;
  if(!fileId){
   if(!ctx.chooseFile)return rejected('unavailable','Actual native Open unavailable.');
   const chosen=await ctx.chooseFile({appId:'fontbook',title:'Add Fonts',extensions:['ttf','otf']},{windowId:owner.windowId,guard:owner.guard});
   if(!owner.guard())return rejected('stale_target','Original window changed.');
   fileId=chosen?.fileId;
   if(!fileId)return chosen?.status==='rejected'?chosen:rejected('cancelled','No font selected.');
  }
  const read=await readActualFile(ctx,owner,fileId);
  if(read.error)return read.error;
  const bytes=bytesFromFile(read.text),metadata=parseFont(bytes);
  const signature=await fontSignature(bytes,ctx.crypto??globalThis.crypto);
  if(!read.guard())return rejected('stale_target','Original font File changed.');
  return await shared({...owner,guard:read.guard},g=>{
   if(g.fonts.some(f=>f.fileId===fileId&&f.revision===read.file.revision))return rejected('already_installed','This original font File is already installed.');
   const duplicates=g.fonts.filter(f=>f.postscript===metadata.postscript);
   if(duplicates.length&&(p.duplicates??'skip')==='skip')return rejected('duplicate','Font already exists. Choose Keep Both or Replace explicitly.');
   if(p.duplicates==='replace')for(const f of duplicates)f.enabled=false;
   if(g.nextId>=Number.MAX_SAFE_INTEGER-1)throw new Error('Font identity capacity exceeded.');
   let id;
   do{id=`font-${g.nextId++}`;}while(g.fonts.some(f=>f.id===id)||g.collections.some(c=>c.id===id));
   g.fonts.push({id,family:metadata.family,style:metadata.style,postscript:metadata.postscript,source:'user',location:g.preferences.installTarget,enabled:true,bundledPath:null,fileId,revision:read.file.revision,signature,format:metadata.format,license:metadata.license.slice(0,1024)});
   return {fontId:id};
  },owner.graph.preferences.automaticValidation?'Installed original font; automatic validation passed: SFNT bounds, table checksums, names, glyph count and Unicode cmap. No host install.':'Installed original font into the local graph (mandatory safety parsing passed). No host install.');
 }
 if(suffix==='preferences')return await shared(owner,g=>{for(const key of Object.keys(p))g.preferences[key]=p[key];},'Font preferences retained locally.');
 if(suffix==='collection')return await shared(owner,g=>{let c=g.collections.find(c=>c.id===p.collectionId);if(p.operation==='create'){if(!p.name||g.collections.some(c=>c.name===p.name))throw new Error('Unique collection name required.');let id;do{id=`font-collection-${g.nextId++}`;}while(g.fonts.some(f=>f.id===id)||g.collections.some(c=>c.id===id));g.collections.push({id,name:p.name,fontIds:[]});return {collectionId:id};}if(!c)throw new Error('Collection missing.');if(p.operation==='rename'){if(!p.name||g.collections.some(other=>other!==c&&other.name===p.name))throw new Error('Unique name required.');c.name=p.name;}if(p.operation==='delete')g.collections.splice(g.collections.indexOf(c),1);if(['add','remove'].includes(p.operation)){if(!g.fonts.some(f=>f.id===p.fontId))throw new Error('Original font missing.');if(p.operation==='add'&&!c.fontIds.includes(p.fontId))c.fontIds.push(p.fontId);if(p.operation==='remove')c.fontIds.splice(0,c.fontIds.length,...c.fontIds.filter(id=>id!==p.fontId));}},'Shared font collection updated.');
 if(suffix==='duplicates')return await shared(owner,g=>{const groups=new Map();for(const f of g.fonts){const group=groups.get(f.postscript)??[];group.push(f);groups.set(f.postscript,group);}for(const rows of groups.values())if(rows.length>1){const keep=rows.find(f=>f.id===p.keepId)??rows.find(f=>f.enabled)??rows[0];for(const f of rows)f.enabled=f===keep;}},'Duplicate PostScript names resolved by deactivating extra copies.');
 if(suffix==='font'){const row=owner.graph.fonts.find(f=>f.id===p.fontId);if(!row)return rejected('stale_target','Original font missing.');if(['validate','export'].includes(p.operation)){const read=await source(owner,row);if(read.error)return read.error;const signature=await fontSignature(read.bytes,ctx.crypto??globalThis.crypto);if(!read.guard())return rejected('stale_target','Font source changed.');if(signature!==row.signature)return rejected('source_unavailable','Font byte signature changed. Reinstall this original File.');if(row.format!=='woff2')parseFont(read.bytes);else {const view=new DataView(read.bytes.buffer,read.bytes.byteOffset,read.bytes.byteLength);if(read.bytes.length<48||String.fromCharCode(...read.bytes.subarray(0,4))!=='wOF2'||view.getUint32(8)!==read.bytes.length)return rejected('invalid_font','Invalid bundled WOFF2 container.');}if(p.operation==='validate')return core.commit({...owner,guard:read.guard},(_,w)=>{w.status=`${row.family}: byte signature and ${row.format==='woff2'?'bundled container':'SFNT bounds, names, checksums and glyph count'} passed. Not full platform font sanitization.`;w.panel='validation';});if(!ctx.createFile)return rejected('unavailable','Atomic Files export unavailable.');const content=bytesDataURL(read.bytes,row.format==='ttf'?'font/ttf':row.format==='otf'?'font/otf':'font/woff2'),mime=`font/${row.format}`,plan=core.plan({...owner,guard:read.guard},(_,w)=>{w.status='Exported the original font bytes to Files.';});if(plan.error)return plan.error;let ack=false;const result=await ctx.createFile({name:`${row.postscript}.${row.format}`,mime,content,text:content,parentId:'documents',reserveTextUnits:plan.delta,onCommit:(id,file,metadata)=>{if(ack||!read.guard()||file?.id!==id||metadata?.content!==content||metadata?.mime!==mime||ctx.canCommit(plan.delta)!==true)return false;core.publish(plan.candidate);ack=true;return true;}},{windowId:owner.windowId,guard:read.guard});return ack?applied(owner.windowId):result?.status==='rejected'?result:rejected('stale_target','Font export not atomically acknowledged.');}if(p.operation==='enable'&&!fontSourceAvailable(row,ctx.getFile))return rejected('source_unavailable','Original font File unavailable.');return await shared(owner,g=>{const f=g.fonts.find(f=>f.id===row.id);if(p.operation==='remove'){g.fonts.splice(g.fonts.indexOf(f),1);for(const c of g.collections)c.fontIds.splice(0,c.fontIds.length,...c.fontIds.filter(id=>id!==f.id));}else f.enabled=p.operation==='enable';},p.operation==='remove'?'Removed font from local library; original File retained.':'Shared font availability changed for actual application font panels.');}
 }catch(error){return rejected('invalid_arguments',error.message);}};
 return {handlers,targets(windowId){const o=core.lease(windowId);return {windowId,available:!!o,session:copyCanonicalData(fontBookWindow(state,windowId)),fonts:copyCanonicalData(o?.graph.fonts??[]),collections:copyCanonicalData(o?.graph.collections??[]),availableFonts:copyCanonicalData(availableFonts(o?.graph,ctx.getFile)),capabilities:fontBookCapabilities(ctx.profile),native:o?.view?.describe?.()??null};},windowOpened:core.windowOpened,windowClosed:core.windowClosed,appQuit:core.appQuit,dispose:core.dispose};}

import {object,choice,flag} from './command-schema.js';
import {canonicalStringUnits,copyCanonicalData} from './canonical-data.js';
import {archivePath} from './archive-codec.js';
import {validateProject} from './xcode-codec.js';
export const XCODE_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength}),int=(minimum=0,maximum=Number.MAX_SAFE_INTEGER-1)=>({type:'integer',minimum,maximum}),array=(items,maxItems)=>({type:'array',items,maxItems}),nullable=s=>({anyOf:[{type:'null'},s]});
export const xcodeIdSchema={...text(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
export const xcodeProjectSchema=object({name:text(128,1),organization:text(128),bundleIdentifier:text(256,1),platform:choice('ios','macos'),template:choice('app','command-line'),language:choice('swift','objc'),deploymentTarget:text(32,1)});
export const xcodeSourceSchema=object({id:xcodeIdSchema,path:text(256,1),language:choice('swift','objc'),text:text(65536),revision:int(),fileId:nullable(xcodeIdSchema),fileRevision:{anyOf:[int(),text(256)]}});
const diagnostic=object({fileId:text(128),line:int(1,65536),column:int(1,65536),severity:choice('error','warning'),message:text(4096,1)});
const snapshot=object({sourceId:xcodeIdSchema,path:text(256,1),revision:int(),fileId:nullable(xcodeIdSchema),fileRevision:{anyOf:[int(),text(256)]},text:text(65536)});
const build=object({id:xcodeIdSchema,time:{type:'number',minimum:0},ok:flag,sources:array(snapshot,64),diagnostics:array(diagnostic,256),program:nullable({type:'object'})});
const history=object({id:xcodeIdSchema,sourceId:xcodeIdSchema,text:text(65536),time:{type:'number',minimum:0}});
export const xcodeSessionSchema=object({windowId:xcodeIdSchema,title:text(256,1),revision:int(),project:nullable(xcodeProjectSchema),sources:array(xcodeSourceSchema,64),expandedGroups:array(text(256,1),1024),openSourceIds:array(xcodeIdSchema,64),selectedSourceId:nullable(xcodeIdSchema),fileId:nullable(xcodeIdSchema),fileRevision:{anyOf:[int(),text(256)]},dirty:flag,panel:choice('chooser','options','none','save','scheme','settings','help','close'),chooser:xcodeProjectSchema,navigator:choice('project','search','issues','debug','breakpoints'),inspector:choice('file','project','history'),inspectorVisible:flag,debugVisible:flag,simulatorVisible:flag,query:text(512),selectionStart:int(0,65536),selectionEnd:int(0,65536),breakpoints:array(object({sourceId:xcodeIdSchema,line:int(1,65536),enabled:flag}),256),builds:array(build,16),activeBuildId:nullable(xcodeIdSchema),runtime:nullable({type:'object'}),history:array(history,64),redo:array(history,64),fontSize:int(10,24),wrap:flag});
export const xcodeSchema=object({version:{const:1},profileId:choice(...XCODE_PROFILES),revision:int(),nextId:int(1),sessions:array(xcodeSessionSchema,32)});
export function xcodeSchemaValid(v,s,ancestors=new Set()) {
 if(s.anyOf)return s.anyOf.some(x=>xcodeSchemaValid(v,x,ancestors));
 if(Object.hasOwn(s,'const')&&v!==s.const||s.enum&&!s.enum.includes(v)||s.not?.enum?.includes(v))return false;
 if(!s.type)return true;
 if(s.type==='null')return v===null;
 if(s.type==='string')return typeof v==='string'&&v.length>=(s.minLength??0)&&v.length<=(s.maxLength??Infinity)&&(!s.pattern||new RegExp(s.pattern,'u').test(v));
 if(s.type==='boolean')return typeof v==='boolean';
 if(s.type==='integer'||s.type==='number')return typeof v==='number'&&Number.isFinite(v)&&(s.type!=='integer'||Number.isSafeInteger(v))&&v>=(s.minimum??-Infinity)&&v<=(s.maximum??Infinity);
 if(!v||typeof v!=='object'||ancestors.has(v))return false;
 const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
 if(keys.some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k],'value')))return false;
 const next=new Set(ancestors);next.add(v);
 if(s.type==='array')return Array.isArray(v)&&v.length<=(s.maxItems??Infinity)&&keys.length===v.length+1&&Array.from({length:v.length},(_,i)=>descriptors[i]).every(d=>d&&xcodeSchemaValid(d.value,s.items,next));
 if(s.type==='object'){
  if(Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
  if(s.properties)return (s.required??[]).every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>Object.hasOwn(s.properties,k)&&xcodeSchemaValid(descriptors[k].value,s.properties[k],next));
  return safeData(v,ancestors,0);
 }
 return false;
}
function safeData(v,seen=new Set(),depth=0){
 if(depth>64)return false;
 if(v===null||typeof v==='boolean'||typeof v==='string')return typeof v!=='string'||v.length<=65536;
 if(typeof v==='number')return Number.isFinite(v);
 if(!v||typeof v!=='object'||seen.has(v))return false;
 const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors),next=new Set(seen);next.add(v);
 if(keys.some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k],'value')))return false;
 if(Array.isArray(v))return v.length<=4096&&keys.length===v.length+1&&Array.from({length:v.length},(_,i)=>descriptors[i]).every(d=>d&&safeData(d.value,next,depth+1));
 return [Object.prototype,null].includes(Object.getPrototypeOf(v))&&keys.length<=4096&&keys.every(k=>!['__proto__','constructor','prototype'].includes(k)&&safeData(descriptors[k].value,next,depth+1));
}
export const xcodeTextUnits=canonicalStringUnits;
export const xcodeSession=(state,id)=>state.sessions.find(w=>w.windowId===id)??null;
export const xcodeSelectedSource=w=>w?.sources.find(s=>s.id===w.selectedSourceId)??null;
export const xcodeActiveBuild=w=>w?.builds.find(b=>b.id===w.activeBuildId)??null;
export function createXcodeState(profile){return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,sessions:[]};}
export function validateXcodeState(state,profile){
 const bad=message=>({ok:false,message});
 if(!xcodeSchemaValid(state,xcodeSchema))return bad('Invalid canonical Xcode graph.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Xcode profile mismatch.');
 if(xcodeTextUnits(state)>4*1024*1024)return bad('Xcode exceeds its bounded retained text budget.');
 const windows=new Set();
 for(const w of state.sessions){
  if(windows.has(w.windowId))return bad('Duplicate Xcode window.');windows.add(w.windowId);
  if(w.project){try{validateProject(w.project);}catch(e){return bad(e.message);}}
  const ids=new Set(),paths=new Set();
  for(const s of w.sources){
   try{archivePath(s.path);}catch(e){return bad(e.message);}
   if(ids.has(s.id)||paths.has(s.path)||!(s.language==='swift'?/\.swift$/u:/\.m$/u).test(s.path))return bad('Duplicate source or mismatched native source language.');
   ids.add(s.id);paths.add(s.path);
  }
  for(const path of paths){const parts=path.split('/');for(let i=1;i<parts.length;i++)if(paths.has(parts.slice(0,i).join('/')))return bad('Native source file/directory collision.');}
  if(new Set(w.expandedGroups).size!==w.expandedGroups.length||w.expandedGroups.some(path=>!w.sources.some(s=>s.path.startsWith(path+'/'))))return bad('Dangling or duplicate project group.');
  if(w.project&&w.sources.length&&w.project.language!==(w.sources.some(s=>s.language==='swift')?'swift':'objc'))return bad('Target language disagrees with actual source membership.');
  if(w.selectedSourceId&&!ids.has(w.selectedSourceId)||w.activeBuildId&&!w.builds.some(b=>b.id===w.activeBuildId)||w.breakpoints.some(b=>!ids.has(b.sourceId)))return bad('Dangling editor, build or breakpoint reference.');
  if(new Set(w.openSourceIds).size!==w.openSourceIds.length||w.openSourceIds.some(id=>!ids.has(id))||w.selectedSourceId&&!w.openSourceIds.includes(w.selectedSourceId))return bad('Dangling or duplicate actual source editor tab.');
  const selected=xcodeSelectedSource(w);
  if(w.selectionStart>w.selectionEnd||w.selectionEnd>(selected?.text.length??0))return bad('Invalid native editor selection.');
 }
 return {ok:true};
}
export function xcodeAvailability(profile){const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),qualified=id.includes('golden-gate');return {appId:windows?'xcode-local':'xcode',label:windows?'Local Development — Xcode Equivalent':'Xcode',version:id.includes('high-sierra')?'9.0':id.includes('mojave')?'10.0':id.includes('sonoma')?'15.0':windows?'Local Development':'26.6 (26-era visual proxy)',native:!windows&&!qualified,qualified,disclosure:windows?'Clearly labeled Windows local development equivalent; not Apple Xcode for Windows.':qualified?'Xcode 26-era visual proxy for the qualified 26.6 branch; exact 26.6 and macOS 27 native pixels have not been captured.':id.includes('high-sierra')?'Xcode 9.0-era surface compatible with macOS 10.13.0; Xcode 10 requires 10.13.6.':'Period Xcode interface.',executionDisclosure:'Bounded local Swift / Objective-C interpreter only. No host compilation, SDK, debugger, deployment, network or real Simulator.'};}
export function createXcodeSession(windowId,profile='macos-mojave-10.14'){const id=typeof profile==='string'?profile:profile.id;return {windowId,title:'Welcome to Xcode',revision:0,project:null,sources:[],expandedGroups:[],openSourceIds:[],selectedSourceId:null,fileId:null,fileRevision:0,dirty:false,panel:'chooser',chooser:{name:'HelloWorld',organization:'Local Development',bundleIdentifier:'local.example.HelloWorld',platform:'ios',template:'app',language:'swift',deploymentTarget:id.includes('high-sierra')?'11.0':id.includes('sonoma')?'17.0':id.includes('golden-gate')?'26.0':'12.0'},navigator:'project',inspector:'file',inspectorVisible:true,debugVisible:true,simulatorVisible:false,query:'',selectionStart:0,selectionEnd:0,breakpoints:[],builds:[],activeBuildId:null,runtime:null,history:[],redo:[],fontSize:12,wrap:false};}
export function xcodePersistenceProjection(state){const saved=copyCanonicalData(state);for(const w of saved.sessions){w.runtime=null;w.builds=[];w.activeBuildId=null;w.simulatorVisible=false;}return saved;}
export function rehydrateXcodeState(saved,profile){const candidate=copyCanonicalData(saved);if(!validateXcodeState(candidate,profile).ok)throw new Error('Invalid saved Xcode state.');return xcodePersistenceProjection(candidate);}
export function xcodeSearchResults(w){if(!w?.query)return [];const q=w.query.toLowerCase(),rows=[];for(const s of w.sources){const lines=s.text.split('\n');for(let i=0;i<lines.length;i++){const column=lines[i].toLowerCase().indexOf(q);if(column>=0)rows.push({sourceId:s.id,path:s.path,line:i+1,column:column+1,text:lines[i]});if(rows.length>=256)return rows;}}return rows;}
export function xcodeTreeRows(session){if(!session)return [];const root={children:new Map()},rows=[];for(const source of session.sources){const parts=source.path.split('/');let node=root,path='';for(let i=0;i<parts.length-1;i++){path+=(path?'/':'')+parts[i];if(!node.children.has(parts[i]))node.children.set(parts[i],{kind:'group',label:parts[i],path,children:new Map()});node=node.children.get(parts[i]);}node.children.set(parts.at(-1),{kind:'source',label:parts.at(-1),path:source.path,sourceId:source.id,language:source.language,fileId:source.fileId});}function visit(node,depth){for(const child of node.children.values()){if(child.kind==='group'){const expanded=session.expandedGroups.includes(child.path);rows.push({kind:'group',label:child.label,path:child.path,depth,expanded});if(expanded)visit(child,depth+1);}else rows.push({...child,depth});}}visit(root,0);return rows;}

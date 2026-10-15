import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
export const AUTOMATOR_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const autoText = (maxLength, minLength = 0) => ({type:'string',maxLength,minLength});
export const autoInt = (minimum, maximum) => ({type:'integer',minimum,maximum});
export const autoArray = (items,maxItems) => ({type:'array',items,maxItems});
export const automatorIdSchema = {...autoText(256,1),pattern:'^[^\\u0000-\\u001f\\u007f]+$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const nullable = s => ({anyOf:[{type:'null'},s]}), revision = autoInt(0,Number.MAX_SAFE_INTEGER-1);
export const automatorTypes = ['workflow','application','quick-action','print-plugin','folder-action','calendar-alarm','image-capture-plugin','dictation-command'];
export const automatorTypeSchema = choice(...automatorTypes);
export const automatorVariableSchema = object({id:automatorIdSchema,name:{...autoText(64,1),pattern:'^[A-Za-z][A-Za-z0-9_ ]*$'},value:autoText(4096)});
export const automatorParameters = {
 'get-files':object({fileIds:autoArray(automatorIdSchema,64)}),
 'rename-files':object({mode:choice('prefix','replace','sequence'),text:autoText(128),find:autoText(128),start:autoInt(1,999999)}),
 'copy-files':object({parentId:automatorIdSchema,suffix:autoText(64)}),
 'scale-images':object({width:autoInt(1,4096),rotation:choice(0,90,180,270),format:choice('png','jpeg','webp'),parentId:automatorIdSchema,suffix:autoText(64)}),
 'convert-documents':object({format:choice('txt','rtf'),append:autoText(4096),parentId:automatorIdSchema,suffix:autoText(64)}),
 'set-variable':object({name:autoText(64,1)}), 'get-variable':object({name:autoText(64,1)}),
 'view-results':object(),
 'open-app':object({appId:automatorIdSchema}), 'quit-app':object({appId:automatorIdSchema})
};
export const automatorActionSchema = {anyOf:Object.entries(automatorParameters).map(([kind,params])=>object({id:automatorIdSchema,kind:{const:kind},enabled:flag,params}))};
export const automatorDocumentSchema = object({format:{const:'jesteros-workflow'},version:{const:1},type:automatorTypeSchema,actions:autoArray(automatorActionSchema,64),variables:autoArray(automatorVariableSchema,32)});
export const automatorPreferencesSchema = object({showLibrary:flag,showLog:flag,showVariables:flag,confirmRun:flag});
export const automatorSessionSchema = object({windowId:automatorIdSchema,title:autoText(256,1),type:automatorTypeSchema,actions:autoArray(automatorActionSchema,64),variables:autoArray(automatorVariableSchema,32),search:autoText(128),category:choice('All','Files & Folders','Photos','Text','Utilities'),selected:nullable(automatorIdSchema),panel:choice('none','new','save','preferences','help','close','run-confirm'),dirty:flag,fileId:nullable(automatorIdSchema),fileRevision:{anyOf:[revision,autoText(256)]},revision,status:choice('idle','running','completed','stopped','failed'),runId:revision,results:autoArray(object({id:automatorIdSchema,fileId:nullable(automatorIdSchema),name:autoText(256),mime:autoText(256),summary:autoText(1024)}),128),log:autoArray(object({id:automatorIdSchema,actionId:nullable(automatorIdSchema),time:{type:'number',minimum:0,maximum:Number.MAX_SAFE_INTEGER},level:choice('info','error'),message:autoText(1024)}),256)});
export const automatorSchema = object({version:{const:1},profileId:choice(...AUTOMATOR_PROFILES),revision,nextId:autoInt(1,Number.MAX_SAFE_INTEGER-1),sessions:autoArray(automatorSessionSchema,32),preferences:automatorPreferencesSchema});
// Validate descriptors before reading values; ownership rechecks must not invoke accessors.
export function automatorSchemaValid(value,schema,ancestors=new Set()) {
 if(schema.anyOf)return schema.anyOf.some(s=>automatorSchemaValid(value,s,ancestors));
 if(Object.hasOwn(schema,'const')&&value!==schema.const||schema.enum&&!schema.enum.includes(value)||schema.not?.enum?.includes(value))return false;
 if(!schema.type)return true;if(schema.type==='null')return value===null;
 if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='integer'||schema.type==='number')return Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
 if(!value||typeof value!=='object'||ancestors.has(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),next=new Set(ancestors);next.add(value);
 if(schema.type==='array')return Array.isArray(value)&&value.length<=schema.maxItems&&keys.every(k=>typeof k==='string'&&(k==='length'||/^(0|[1-9]\d*)$/u.test(k)&&Number(k)<value.length))&&Array.from({length:value.length},(_,i)=>descriptors[i]&&descriptors[i].enumerable&&Object.hasOwn(descriptors[i],'value')&&automatorSchemaValid(descriptors[i].value,schema.items,next)).every(Boolean);
 return !Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&schema.required.every(k=>Object.hasOwn(descriptors,k))&&keys.every(k=>typeof k==='string'&&Object.hasOwn(schema.properties,k)&&descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&automatorSchemaValid(descriptors[k].value,schema.properties[k],next));
}
export const automatorTextUnits = canonicalStringUnits;
export const automatorSession = (state,id) => state.sessions.find(w=>w.windowId===id)??null;
export function validateAutomatorDocument(d) {
 if(!automatorSchemaValid(d,automatorDocumentSchema)||canonicalStringUnits(d)>256*1024)return {ok:false,message:'Invalid or oversized local workflow document.'};
 const ids=[...d.actions,...d.variables].map(row=>row.id),names=d.variables.map(v=>v.name);
 if(new Set(ids).size!==ids.length||new Set(names).size!==names.length)return {ok:false,message:'Duplicate action, variable identity or variable name.'};
 return {ok:true};
}
export function validateAutomatorState(s,profile) {
 const bad=message=>({ok:false,message});
 if(!automatorSchemaValid(s,automatorSchema))return bad('Invalid closed Automator state.');
 if(profile&&s.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Automator belongs to another OS.');
 if(canonicalStringUnits(s)>1024*1024||new Set(s.sessions.map(w=>w.windowId)).size!==s.sessions.length)return bad('Automator quota or duplicate window.');
 for(const w of s.sessions){const valid=validateAutomatorDocument({format:'jesteros-workflow',version:1,type:w.type,actions:w.actions,variables:w.variables});if(!valid.ok)return valid;if(w.selected&&!w.actions.some(a=>a.id===w.selected))return bad('Selected action is unavailable.');if(new Set(w.log.map(r=>r.id)).size!==w.log.length||new Set(w.results.map(r=>r.id)).size!==w.results.length)return bad('Duplicate result or log identity.');}
 return {ok:true};
}
export function createAutomatorSession(windowId,{type='workflow',title='Untitled',document}={}) {return {windowId,title,type:document?.type??type,actions:document?.actions??[],variables:document?.variables??[],search:'',category:'All',selected:null,panel:'none',dirty:!!document,fileId:null,fileRevision:0,revision:0,status:'idle',runId:0,results:[],log:[]};}
export function createAutomatorState(profile,_options={}) {return {version:1,profileId:typeof profile==='string'?profile:profile.id,revision:0,nextId:1,sessions:[],preferences:{showLibrary:true,showLog:true,showVariables:false,confirmRun:false}};}
export function automatorAvailability(profile) {const id=typeof profile==='string'?profile:profile.id,windows=id.startsWith('windows11'),gold=id.includes('golden-gate');return {appId:windows?'automator-local':'automator',label:windows?'Automator — Local Equivalent':'Automator',native:!windows&&!gold,qualified:gold,disclosure:windows?'Automator is not bundled with Windows 11. This functional local equivalent runs only against simulated Files and registered apps.':gold?'Nearest documented macOS 26 styling; native macOS 27 pixels and availability are unverified.':'Local workflows only; not Apple .workflow bundles. No host automation, dictation, folder watchers, printing or calendar scheduling.'};}

export function automatorWindowMetadata(profile,options={}) {return {appId:automatorAvailability(profile).appId,title:options.title??'Untitled — Automator',width:960,height:680,minWidth:620,minHeight:420,multipleWindows:true};}
export function projectAutomatorState(state) {const copy=copyAutomatorState(state);for(const w of copy.sessions)if(w.status==='running'){w.status='stopped';w.panel='none';}return copy;}
function copyAutomatorState(state) {if(!validateAutomatorState(state).ok)throw new Error('Cannot persist invalid Automator state.');return copyCanonicalData(state);}
export function rehydrateAutomatorState(state,profile) {if(!validateAutomatorState(state,profile).ok)throw new Error('Cannot restore invalid Automator state.');return projectAutomatorState(state);}

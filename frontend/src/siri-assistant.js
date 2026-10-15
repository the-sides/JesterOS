import {copyCanonicalData, applyCanonicalData, canonicalStringUnits} from './canonical-data.js';
import {defineCommand, object, empty, choice} from './command-schema.js';
import {previewSchemaValid, previewIdSchema} from './preview-state.js';
import {identityLease} from './keychain-controller.js';
import {parsePreferencesSiri, PREFERENCES_SIRI_REQUESTS} from './preferences-effects.js';
import {visibleContacts, contactName} from './contacts-state.js';
import {visibleWorkspaceNotes, noteWorkspaceTitle, noteWorkspaceLocked} from './notes-workspace-state.js';

export const SIRI_ASSISTANT_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
const text = (maxLength, minLength = 0) => ({type:'string', maxLength, minLength});
const integer = (maximum = Number.MAX_SAFE_INTEGER - 1) => ({type:'integer', minimum:0, maximum});
const nullable = schema => ({anyOf:[{type:'null'},schema]});
const id = previewIdSchema;
const destinationSchema = object({kind:choice('contacts','calendar','notes'),windowId:id});
// No request, payload, transcript, personal result text, or credential is logged.
const historySchema = object({command:text(128,1),status:choice('applied','rejected'),message:text(512),at:integer(8639999999999999),destinationWindowId:nullable(id)});
export const siriAssistantWindowSchema = object({windowId:id,appId:{const:'siriai'},query:text(512),history:{type:'array',maxItems:32,items:historySchema},destination:nullable(destinationSchema),menu:nullable(choice('application','file','window','help')),sheet:nullable(choice('help','about')),revision:integer()});
export const siriAssistantSchema = object({version:{const:1},profileId:choice(...SIRI_ASSISTANT_PROFILES),windows:{type:'array',maxItems:32,items:siriAssistantWindowSchema}});
export const siriAssistantTargetSchema = object({windowId:id});
export const siriAssistantCommandSpecs = {
 query:[object({query:text(512)}),'Retain only this window’s bounded typed input.'],
 submit:[object({query:text(512,1)},[]),'Parse a typed local request and dispatch only actual registered Root commands. Acknowledged errors and actions alone enter local history.'],
 clear:[empty,'Clear this window’s query, acknowledgement history, and canonical destination pointer.'],
 menu:[object({menu:nullable(choice('application','file','window','help'))}),'Open or dismiss a rendered native menu.'],
 sheet:[object({sheet:nullable(choice('help','about'))}),'Open or dismiss the native help/about panel.'],
 focus:[object({controlId:text(128,1)}),'Focus an actual enabled mounted native control.'],
 close:[empty,'Close the actual original Siri window through the shell.'],
 'result.open':[object({recordId:id}),'Reveal an actual currently visible canonical Contacts, Calendar, or Notes result in its original destination window.'],
 speak:[empty,'Explicitly read the latest actual acknowledgement with optional browser speech synthesis; never Apple Siri speech or a microphone.'],
};
export const siriAssistantCatalog = Object.fromEntries(Object.entries(siriAssistantCommandSpecs).map(([suffix,[schema,description]]) => defineCommand(SIRI_ASSISTANT_PROFILES,`siriai.${suffix}`,'siriai.local',siriAssistantTargetSchema,schema,['Original available Siri actor window and canonical Preferences Siri configuration.','Local deterministic parser only; no OS Siri, Copilot, LLM, microphone, network request, or private request telemetry.'],[description],['siriai'],[],siriAssistantTargetSchema)));
export function createSiriAssistantState(profile) {return {version:1,profileId:typeof profile==='string'?profile:profile.id,windows:[]};}
export function createSiriAssistantWindow(windowId) {return {windowId,appId:'siriai',query:'',history:[],destination:null,menu:null,sheet:null,revision:0};}
export const siriAssistantWindow = (state,windowId) => state?.windows.find(row => row.windowId===windowId) ?? null;
export function validateSiriAssistantState(state,profile) {
 if(!previewSchemaValid(state,siriAssistantSchema)||profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return {ok:false,message:'Invalid closed Siri actor graph or installed profile.'};
 if(new Set(state.windows.map(row=>row.windowId)).size!==state.windows.length||canonicalStringUnits(state)>128*1024)return {ok:false,message:'Siri window identity or local retention quota exceeded.'};
 return {ok:true};
}
export function siriAssistantPersistentState(state) {
 const next=copyCanonicalData(state);
 for(const window of next.windows){window.query='';window.history.splice(0);window.destination=null;window.menu=null;window.sheet=null;}
 return next;
}
export function rehydrateSiriAssistantState(saved,profile) {return validateSiriAssistantState(saved,profile).ok?siriAssistantPersistentState(saved):null;}
export function siriAssistantCapabilities(profile) {
 const profileId=typeof profile==='string'?profile:profile.id,windows=profileId.startsWith('windows11'),classic=/high-sierra|mojave/.test(profileId),golden=profileId.includes('golden-gate');
 return {windows,classic,golden,label:windows?'Local Assistant':'Siri',disclosure:windows?'Apple Siri is unavailable on Windows. This typed local equivalent is neither Cortana nor Copilot.':'Native-era Siri panel recreation with a typed local equivalent. Apple’s online Siri service is unavailable here.',visualEvidence:golden?'Nearest macOS Tahoe 26 styling; not verified Golden Gate 27 pixel parity.':classic?'Archived Apple 10.13/10.14 panel layout; not certified base-release pixel parity.':'Apple Sonoma 14 guide panel layout; not certified binary pixel parity.'};
}
export function siriAssistantWindowMetadata(profile) {const cap=siriAssistantCapabilities(profile);return {appId:'siriai',utilityKind:'siriai',title:cap.label,component:'SiriAssistantApp.svelte',width:390,height:540,minWidth:340,minHeight:400,capability:'siriai.local'};}
export const SIRI_ASSISTANT_REQUESTS = Object.freeze([...PREFERENCES_SIRI_REQUESTS,'Find contacts <text>','Find events <text>','Find notes <text>','Create note <text>','Add event <title> on YYYY-MM-DD at HH:mm-HH:mm','Add event <title> on YYYY-MM-DD all day']);
const reject = (code,message) => ({status:'rejected',error:{code,message}});
const applied = (windowId,extra={}) => ({status:'applied',target:{windowId},...extra});
function canonicalWindow(graph,windowId) {return graph?.windows?.find(row=>row.windowId===windowId)??null;}
// These are live projections, not a Siri-owned copy of another app’s database.
export function siriAssistantResults(state,windowId,shared) {
 const destination=siriAssistantWindow(state,windowId)?.destination;
 if(!destination)return [];
 const graph=shared?.[destination.kind],window=canonicalWindow(graph,destination.windowId);
 if(!graph||!window)return [];
 if(destination.kind==='contacts')return visibleContacts(graph,window.windowId).slice(0,20).map(row=>({id:row.id,label:contactName(row,graph.preferences),kind:'contacts'}));
 if(destination.kind==='notes')return visibleWorkspaceNotes(graph,window).filter(row=>!noteWorkspaceLocked(row)).slice(0,20).map(row=>({id:row.id,label:noteWorkspaceTitle(row),kind:'notes'}));
 const query=window.query.trim().toLocaleLowerCase('en-US');
 return graph.events.filter(row=>graph.calendars.some(calendar=>calendar.id===row.calendarId&&calendar.visible)&&`${row.title} ${row.location} ${row.notes}`.toLocaleLowerCase('en-US').includes(query)).slice(0,20).map(row=>({id:row.id,label:row.title,kind:'calendar'}));
}
export function parseSiriAssistantRequest(preferences,request,{profile,commandAvailable}={}) {
 const parsed=parsePreferencesSiri(preferences,request,{profile,commandAvailable});
 if(parsed.status==='applied'||parsed.error?.code!=='unrecognized_request')return parsed;
 const match=/^(find contacts|find events|find notes|create note|add event)\s+([\s\S]+)$/i.exec(request.trim());
 if(!match)return parsed;
 const routes={'find contacts':['contacts','contacts.search','query'],'find events':['calendar','calendar.view.set','query'],'find notes':['notes','notes.search','query'],'create note':['notes','notes.create','text'],'add event':['calendar','calendar.quickEntry','text']};
 const [appId,command,field]=routes[match[1].toLowerCase()];
 if(!profile.applications[appId]||commandAvailable?.('app.open')!==true||commandAvailable?.(command)!==true)return reject('unavailable','That registered destination or Root command is unavailable in this profile.');
 return {status:'applied',destination:appId,packet:{command,payload:{[field]:match[2]}}};
}
export function siriAssistantMenus({state,profile,windowId}) {
 const window=siriAssistantWindow(state,windowId),cap=siriAssistantCapabilities(profile),item=(id,label,suffix,payload={},enabled=!!window)=>({id,label,enabled,request:{command:`siriai.${suffix}`,target:{windowId},payload}});
 return [{id:'application',label:cap.label,children:[item('about',`About ${cap.label}`,'sheet',{sheet:'about'}),item('close',`Close ${cap.label}`,'close')]},{id:'file',label:'File',children:[item('submit','Send Typed Request','submit',{},!!window?.query.trim()),item('clear','Clear Local History','clear')]},{id:'window',label:'Window',children:[item('input','Type a Request','focus',{controlId:'query'}),item('speak','Read Last Acknowledgement','speak',{},!!window?.history.length)]},{id:'help',label:'Help',children:[item('help','Supported Local Requests','sheet',{sheet:'help'})]}];
}

export function createSiriAssistantCommands(state,ctx) {
 let disposed=false,generation=0;
 const originals=new Map(),pending=new Set(),profile=ctx.profile;
 const alive=()=>!disposed&&ctx.profile===profile&&ctx.alive()===true&&ctx.getState()===state&&validateSiriAssistantState(state,profile).ok;
 const stale=()=>reject('stale_target','The original Siri window, canonical source, mounted facade, or authored time changed.');
 const commandAvailable=name=>ctx.getInventory?.()?.commands?.some(row=>row.name===name&&(!row.profiles||row.profiles.includes(ctx.profile.id)))===true;
 function lease(windowId) {
  if(!alive())return null;
  const window=ctx.getWindow(windowId),session=siriAssistantWindow(state,windowId),view=ctx.getView?.(windowId);
  const preferences=ctx.getShared?.('preferences'),configuration=preferences?.configuration,siri=configuration?.siri;
  if(!window||window.appId!=='siriai'||!session||ctx.available(window)!==true||originals.has(windowId)&&originals.get(windowId)!==window||!siri)return null;
  const stateSame=identityLease(state),shellSame=identityLease(window),settingsSame=identityLease(siri),time=ctx.getSceneTime(),version=generation;
  if(!Number.isSafeInteger(time)||time<0||time>=8640000000000000)return null;
  const retained=()=>alive()&&generation===version&&ctx.getSceneTime()===time&&ctx.getWindow(windowId)===window&&siriAssistantWindow(state,windowId)===session&&ctx.getView?.(windowId)===view&&stateSame()&&ctx.getShared('preferences')===preferences&&preferences.configuration===configuration&&configuration.siri===siri&&settingsSame();
  return {windowId,window,session,view,preferences,siri,time,retained,guard:()=>retained()&&shellSame()&&ctx.available(window)===true};
 }
 function prepare(owner,mutation) {
  if(!owner.guard())return {error:stale()};
  const candidate=copyCanonicalData(state),window=siriAssistantWindow(candidate,owner.windowId);
  const extra=mutation(window)??{};if(extra.status==='rejected')return {error:extra};
  if(window.revision>=Number.MAX_SAFE_INTEGER-1)return {error:reject('limit_exceeded','Siri revision capacity is exhausted.')};
  window.revision++;
  const valid=validateSiriAssistantState(candidate,ctx.profile),delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);
  if(!valid.ok)return {error:reject('invalid_state',valid.message)};
  if(ctx.canCommit(delta)!==true)return {error:reject('limit_exceeded','The full combined Root retention quota would be exceeded.')};
  if(!owner.guard())return {error:stale()};
  return {candidate,extra};
 }
 function commit(owner,mutation) {const plan=prepare(owner,mutation);if(plan.error)return plan.error;applyCanonicalData(state,plan.candidate);generation++;return applied(owner.windowId,plan.extra);}
 function sourceGuard(owner,name,windowId) {
  const graph=ctx.getShared?.(name),session=canonicalWindow(graph,windowId),window=ctx.getWindow(windowId),view=ctx.getView?.(windowId);
  if(!graph||!session||!window||window.appId!==name||ctx.available(window)!==true)return null;
  const graphSame=identityLease(graph),windowSame=identityLease(window);
  return ()=>owner.guard()&&ctx.getShared(name)===graph&&graphSame()&&ctx.getWindow(windowId)===window&&windowSame()&&canonicalWindow(graph,windowId)===session&&ctx.getView?.(windowId)===view&&ctx.available(window)===true;
 }
 // A successful Root command can intentionally change its target source. Never
 // reject that acknowledged publication by checking its old source fingerprint.
 async function dispatch(packet,guard,windowId) {
  if(typeof ctx.executeOwned!=='function'||!commandAvailable(packet.command))return reject('unavailable','The actual owned Root command dispatcher is unavailable.');
  if(!guard())return stale();
  let result;
  try{result=await ctx.executeOwned(packet,{guard,windowId});}catch{return reject('execution_failed','The actual Root command dispatcher failed.');}
  if(result?.status==='applied')return result;
  if(!guard())return stale();
  return result?.status==='rejected'?result:reject('unavailable','The actual Root command did not acknowledge an action or error.');
 }
 function remember(owner,command,result,destination=null) {
  // Retirement after a genuine acknowledgement must not reverse the action or
  // publish late history into a replacement window. History is best-effort UI.
  if(!owner.retained())return false;
  const fresh=lease(owner.windowId);if(!fresh||fresh.window!==owner.window||fresh.session!==owner.session||fresh.view!==owner.view)return false;
  const errorCode=result.error?.code??result.code;
  const message=result.status==='applied'?`Completed local command: ${command}.`:`Local command rejected (${typeof errorCode==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(errorCode)?errorCode:'rejected'}).`;
  const recorded=commit(fresh,window=>{window.query='';window.destination=destination;window.history.push({command,status:result.status,message,at:owner.time,destinationWindowId:destination?.windowId??null});if(window.history.length>32)window.history.shift();});
  return recorded.status==='applied';
 }
 async function submit(owner,query) {
  if(pending.has(owner.session))return reject('busy','A typed request is already awaiting its actual acknowledgement.');
  const inventory=ctx.getInventory?.(),inventoryCommands=inventory?.commands;
  if(!inventoryCommands)return reject('unavailable','The actual registered Root command inventory is unavailable.');
  const catalogSame=identityLease(inventoryCommands),guard=()=>owner.guard()&&ctx.getInventory()===inventory&&inventory.commands===inventoryCommands&&catalogSame();
  const parsed=parseSiriAssistantRequest(owner.preferences,query,{profile:ctx.profile,commandAvailable});
  if(parsed.status==='rejected'){remember(owner,'local.parse',parsed);return parsed;}
  // The dispatcher budgets its real canonical action. History has its own exact
  // signed delta after acknowledgement; never deny a valid action by estimating
  // fictional request/result text that will not actually be retained.
  if(ctx.canCommit(0)!==true)return reject('limit_exceeded','The full combined Root retention quota is unavailable.');
  if(!guard())return stale();
  pending.add(owner.session);
  try {
   let result,destination=null;
   if(parsed.destination){
    const opened=await dispatch({command:'app.open',target:{appId:parsed.destination}},guard,owner.windowId);
    if(opened.status!=='applied'){remember(owner,'app.open',opened);return opened;}
    // Rebase only the intentionally acknowledged shell effects. Never borrow a
    // replacement of the original Siri graph, window, session, view or settings.
    if(!owner.retained())return applied(owner.windowId,{acknowledgement:opened,historyRecorded:false});
    const next=lease(owner.windowId),destinationWindowId=opened.target?.windowId??opened.windowId;
    if(!next||next.window!==owner.window||next.session!==owner.session||next.view!==owner.view)return applied(owner.windowId,{acknowledgement:opened,historyRecorded:false});
    const targetGuard=sourceGuard(next,parsed.destination,destinationWindowId);
    if(!targetGuard){const unavailable=reject('unavailable','The acknowledged application has no actual original canonical destination window.');remember(next,parsed.packet.command,unavailable);return unavailable;}
    result=await dispatch({...parsed.packet,target:{windowId:destinationWindowId}},targetGuard,owner.windowId);
    if(result.status==='applied')destination={kind:parsed.destination,windowId:destinationWindowId};
    const historyRecorded=remember(next,parsed.packet.command,result,destination);
    return result.status==='applied'?applied(owner.windowId,{acknowledgement:result,destinationWindowId,historyRecorded}):result;
   }
   result=await dispatch(parsed.packet,guard,owner.windowId);
   const historyRecorded=remember(owner,parsed.packet.command,result);
   return result.status==='applied'?applied(owner.windowId,{acknowledgement:result,historyRecorded}):result;
  } finally {pending.delete(owner.session);}
 }
 const handlers={};
 for(const [suffix,[schema]] of Object.entries(siriAssistantCommandSpecs))handlers[`siriai.${suffix}`]=async(target,payload={})=>{
  if(!previewSchemaValid(target,siriAssistantTargetSchema)||!previewSchemaValid(payload,schema))return reject('invalid_arguments','Use the closed Siri target and typed command schema.');
  const owner=lease(target.windowId);if(!owner)return reject('unavailable','The original Siri window or canonical Preferences Siri configuration is unavailable.');
  if(suffix==='submit')return submit(owner,payload.query??owner.session.query);
  if(suffix==='focus'||suffix==='speak'){
   if(owner.view?.available?.()!==true)return reject('unavailable','The original mounted native Siri control is unavailable.');
   if(suffix==='speak'&&!owner.siri.feedback)return reject('disabled','Voice feedback is disabled in the canonical Siri preferences.');
   const last=owner.session.history.at(-1);
   if(suffix==='speak'&&!last)return reject('disabled','There is no actual acknowledgement to read.');
   const method=suffix==='focus'?'focus':'speak';
   if(typeof owner.view[method]!=='function')return reject('unavailable','The actual native control or browser speech synthesis is unavailable.');
   const ok=await owner.view[method](suffix==='focus'?payload.controlId:last.message,owner.guard,owner.siri);
   return owner.guard()?(ok===true?applied(owner.windowId):reject('unavailable','The enabled native control or optional browser voice was unavailable.')):stale();
  }
  if(suffix==='close')return dispatch({command:'window.close',target:{windowId:owner.windowId}},owner.guard,owner.windowId);
  if(suffix==='result.open'){
   const destination=owner.session.destination;
   if(!destination)return reject('unavailable','No canonical destination is selected.');
   const shared=Object.fromEntries(['contacts','calendar','notes'].map(name=>[name,ctx.getShared(name)]));
   if(!siriAssistantResults(state,owner.windowId,shared).some(row=>row.id===payload.recordId))return reject('stale_target','The actual result is no longer visible in its canonical destination.');
   const guard=sourceGuard(owner,destination.kind,destination.windowId);if(!guard)return stale();
   const packets={contacts:{command:'contacts.select',payload:{contactIds:[payload.recordId]}},calendar:{command:'calendar.event.select',payload:{eventId:payload.recordId}},notes:{command:'notes.select',payload:{noteId:payload.recordId}}};
   const packet={...packets[destination.kind],target:{windowId:destination.windowId}};
   const result=await dispatch(packet,guard,owner.windowId);remember(owner,packet.command,result,destination);return result;
  }
  if(pending.has(owner.session))return reject('busy','Wait for the original typed request acknowledgement before changing its window UI.');
  return commit(owner,window=>{
   if(suffix==='query')window.query=payload.query;
   if(suffix==='clear'){window.query='';window.history.splice(0);window.destination=null;}
   if(suffix==='menu')window.menu=payload.menu;
   if(suffix==='sheet'){window.sheet=payload.sheet;window.menu=null;}
  });
 };
 function lifecycle(mutation,guard=()=>true) {
  if(!alive()||guard()!==true)return false;
  const same=identityLease(state),version=generation,time=ctx.getSceneTime(),candidate=copyCanonicalData(state);mutation(candidate);
  if(!validateSiriAssistantState(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!alive()||version!==generation||time!==ctx.getSceneTime()||!same()||guard()!==true)return false;
  applyCanonicalData(state,candidate);generation++;return true;
 }
 const optionGuard=options=>(!options.isCurrent||options.isCurrent()===true)&&(!options.sourceGuard||options.sourceGuard()===true)&&(!options.ownership?.guard||options.ownership.guard()===true);
 function windowOpened(actual,options={}) {
  if(!alive()||!actual||actual.appId!=='siriai'||ctx.getWindow(actual.id)!==actual||!optionGuard(options))return false;
  const existing=siriAssistantWindow(state,actual.id),guard=()=>ctx.getWindow(actual.id)===actual&&optionGuard(options);
  if(existing){if(originals.has(actual.id)&&originals.get(actual.id)!==actual)return false;originals.set(actual.id,actual);return true;}
  if(!lifecycle(next=>next.windows.push(createSiriAssistantWindow(actual.id)),guard))return false;
  originals.set(actual.id,actual);return true;
 }
 function windowClosed(actual,ownership={}) {
  const windowId=typeof actual==='string'?actual:actual?.id,original=originals.get(windowId),session=siriAssistantWindow(state,windowId);
  if(!session||original&&typeof actual!=='string'&&actual!==original)return false;
  const guard=()=>ctx.getWindow(windowId)==null||ctx.getWindow(windowId)===(original??actual);
  if(!lifecycle(next=>next.windows.splice(next.windows.findIndex(row=>row.windowId===windowId),1),()=>guard()&&(!ownership.guard||ownership.guard()===true)))return false;
  originals.delete(windowId);pending.delete(session);return true;
 }
 function appQuit(appId) {if(appId!=='siriai'||!lifecycle(next=>next.windows.splice(0)))return false;originals.clear();pending.clear();return true;}
 function targets(windowId) {const owner=lease(windowId);return {windowId,available:!!owner,capabilities:siriAssistantCapabilities(ctx.profile),session:owner?copyCanonicalData(owner.session):null,configuration:owner?.siri??null,requests:SIRI_ASSISTANT_REQUESTS,results:owner?siriAssistantResults(state,windowId,Object.fromEntries(['contacts','calendar','notes'].map(name=>[name,ctx.getShared(name)]))):[],native:owner?.view?.describe?.()??null};}
 return {handlers,targets,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originals.clear();pending.clear();}};
}

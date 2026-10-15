import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { automatorCommandPayloads, automatorWindowTarget } from './automator-catalog.js';
import { automatorSchema, automatorSchemaValid, automatorTextUnits, validateAutomatorState, createAutomatorSession, automatorSession, automatorAvailability } from './automator-state.js';
import { automatorLibrary, AUTOMATOR_MIME, AUTOMATOR_EXTENSION, serializeAutomatorWorkflow, parseAutomatorWorkflow, planAutomatorFiles } from './automator-engine.js';
const reject=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
// Pin every descriptor, primitive and nested identity, including array order and keys.
function pinGraph(value,ancestors=new Set()) {
 if(!value||typeof value!=='object')return ()=>true;if(ancestors.has(value))return ()=>false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),proto=Object.getPrototypeOf(value),next=new Set(ancestors);next.add(value);
 if(keys.some(k=>!Object.hasOwn(descriptors[k],'value')))return ()=>false;
 const children=keys.map(k=>[k,descriptors[k],pinGraph(descriptors[k].value,next)]);
 return ()=>{if(Object.getPrototypeOf(value)!==proto)return false;const now=Object.getOwnPropertyDescriptors(value),current=Reflect.ownKeys(now);return current.length===keys.length&&children.every(([k,d,g])=>now[k]&&Object.hasOwn(now[k],'value')&&now[k].value===d.value&&now[k].enumerable===d.enumerable&&now[k].configurable===d.configurable&&now[k].writable===d.writable&&g());};
}
export function createAutomatorCommands(state,ctx,options={}) {
 const availability=options.availability??automatorAvailability;
 if(typeof availability!=='function')throw new TypeError('Workflow availability must be a profile capability function.');
 const capability=availability(ctx.profile),appId=options.appId??capability.appId,prefix=options.commandPrefix??'automator',label=capability.label??'Workflow Editor';
 if(typeof appId!=='string'||!appId||appId.length>256||typeof prefix!=='string'||!/^[a-z][a-z0-9-]{0,63}$/u.test(prefix)||['constructor','prototype'].includes(prefix))throw new TypeError('Use a registered workflow app ID and a bounded command namespace.');
 let generation=0,disposed=false;const running=new Map(),originalWindows=new Map();
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&automatorSchemaValid(state,automatorSchema)&&state.profileId===ctx.profile.id;
 const stale=()=>reject('stale_target','Original workflow, Files, scene time, window or native view changed.');
 const publish=c=>{applyCanonicalData(state,c);generation++;};
 function owner(windowId) {if(!alive()||!validateAutomatorState(state,ctx.profile).ok)return null;const window=ctx.getWindow(windowId),session=automatorSession(state,windowId),view=ctx.getView?.(windowId);if(!window||!session||originalWindows.get(windowId)!==window||window.appId!==appId)return null;const pinned=pinGraph(state),version=generation,time=ctx.getSceneTime();return {windowId,window,session,view,time,guard:()=>alive()&&generation===version&&ctx.getWindow(windowId)===window&&automatorSession(state,windowId)===session&&ctx.getView?.(windowId)===view&&ctx.getSceneTime()===time&&pinned()};}
 function prepare(lease,change) {if(!lease.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=automatorSession(candidate,lease.windowId),result=change(candidate,w);if(result?.status==='rejected')return {error:result};candidate.revision++;w.revision++;const valid=validateAutomatorState(candidate,ctx.profile),delta=automatorTextUnits(candidate)-automatorTextUnits(state);if(!valid.ok)return {error:reject('limit_exceeded',valid.message)};const allowed=ctx.canCommit(delta)===true;if(!lease.guard())return {error:stale()};if(!allowed)return {error:reject('limit_exceeded','Complete-scene workflow text budget exceeded.')};return {candidate,delta,result:result??{}};}
 const settle=(lease,p)=>{if(p.error)return p.error;if(!lease.guard())return stale();publish(p.candidate);return applied(lease.windowId,p.result);};
 const commit=(lease,change)=>settle(lease,prepare(lease,change));
 const log=(c,w,actionId,message,level='info')=>{w.log.push({id:'auto-log-'+c.nextId++,actionId,time:ctx.getSceneTime(),level,message:message.slice(0,1024)});if(w.log.length>256)w.log.splice(0,w.log.length-256);};
 const failRun=(w,message)=>{w.status='failed';const row=w.log.at(-1);if(row){const capacity=Math.max(0,row.message.length-(row.level==='info'?1:0));row.level='error';row.message=message.slice(0,capacity);}};
 function filesOwner(lease) {const store=ctx.getFilesStore?.();if(!store||!Array.isArray(store.files))return null;const pinned=pinGraph(store);return {...lease,guard:()=>lease.guard()&&ctx.getFilesStore()===store&&pinned()};}
 function liveFile(id) {const f=ctx.getFile?.(id);if(!f||f.deleted)return null;const seen=new Set([f.id]);let row=f;while(row.parentId!==null&&row.parentId!==undefined){if(seen.has(row.parentId))return null;seen.add(row.parentId);row=ctx.getFile(row.parentId);if(!row||row.deleted||row.mounted===false)return null;}return f.mounted===false?null:f;}
 async function open(lease,p) {if(lease.session.dirty)return reject('dirty_document','Save this workflow before opening another document.');let id=p.fileId;if(!id){if(!ctx.chooseFile)return reject('unavailable','Native shared file picker required.');const chosen=await ctx.chooseFile({appId:appId,accept:[AUTOMATOR_MIME],multiple:false},{windowId:lease.windowId,guard:lease.guard});if(!lease.guard())return stale();if(chosen?.status!=='applied'||!chosen.fileId)return chosen?.status==='rejected'?chosen:reject('cancelled','No workflow selected.');id=chosen.fileId;}lease=filesOwner(lease);const file=liveFile(id);if(!lease||!file||!ctx.readFile)return reject('not_found','Actual original workflow File unavailable.');const read=await ctx.readFile(id,{windowId:lease.windowId,guard:lease.guard});if(!lease.guard()||ctx.getFile(id)!==file)return stale();if(read?.status!=='applied'||read.file!==file)return read?.status==='rejected'?read:reject('unavailable','Actual workflow bytes required.');if(file.mime!==AUTOMATOR_MIME)return reject('unsupported_format','Open local .jworkflow documents, not Apple workflow bundles.');const doc=parseAutomatorWorkflow(read.text);return commit(lease,(_,w)=>{w.type=doc.type;w.actions=doc.actions;w.variables=doc.variables;w.title=file.name;w.fileId=file.id;w.fileRevision=file.revision;w.dirty=false;w.selected=null;w.status='idle';w.results=[];w.log=[];w.panel='none';});}
 async function save(lease,p) {if(!ctx.mutateFiles)return reject('unavailable','Shared staged Files writer required.');lease=filesOwner(lease);if(!lease)return reject('unavailable','Actual Files store required.');const w=lease.session,original=w.fileId&&!p.saveAs?liveFile(w.fileId):null;if(w.fileId&&!p.saveAs&&!original)return reject('not_found','Saved workflow File no longer exists.');if(original&&original.revision!==w.fileRevision)return reject('revision_conflict','Source workflow changed. Use Save As.');const raw=p.name??original?.name??w.title,name=raw.endsWith(AUTOMATOR_EXTENSION)?raw:raw+AUTOMATOR_EXTENSION,content=serializeAutomatorWorkflow(w);const planned=prepare(lease,(_,w)=>{w.dirty=false;w.panel='none';w.title=name;});if(planned.error)return planned.error;let committed=null;
 const response=await ctx.mutateFiles({operations:[{type:'write',...(original?{fileId:original.id,expectedRevision:original.revision}:{parentId:'documents'}),name,mime:AUTOMATOR_MIME,content}],reserveTextUnits:planned.delta,onCommit:(results,metadata)=>{if(!lease.guard()||results.length!==1)return false;const r=results[0],file=metadata.find(f=>f.id===r.fileId);if(!file||file.mime!==AUTOMATOR_MIME||file.content!==content||original&&r.file!==original)return false;const next=automatorSession(planned.candidate,lease.windowId);next.fileId=r.fileId;next.fileRevision=file.revision;next.title=file.name;const allowed=validateAutomatorState(planned.candidate,ctx.profile).ok&&ctx.canCommit(automatorTextUnits(planned.candidate)-automatorTextUnits(state))===true;if(!allowed||!lease.guard())return false;publish(planned.candidate);committed=r.fileId;return true;}},{windowId:lease.windowId,guard:lease.guard});
 if(committed)return applied(lease.windowId,{fileId:committed,presentationAvailable:ctx.getWindow(lease.windowId)===lease.window&&ctx.getView?.(lease.windowId)===lease.view});return lease.guard()?response?.status==='rejected'?response:reject('unavailable','Files did not commit the workflow.'):stale();}
 async function runFiles(lease,inputIds,actions=lease.session.actions,complete=true,runtimeVariables=new Map()) {
  lease=filesOwner(lease);if(!lease)return reject('unavailable','Actual Files store required.');
  const plan=await planAutomatorFiles({...lease.session,actions},{getFile:liveFile,readFile:id=>ctx.readFile(id,{windowId:lease.windowId,guard:lease.guard}),guard:lease.guard,inputIds,runtimeVariables});
  if(!lease.guard())return stale();
  const planned=prepare(lease,(c,w)=>{w.status=complete?'completed':'running';w.panel='none';w.results=plan.output.map(row=>({id:'auto-result-'+c.nextId++,fileId:row.fileId.startsWith('$')?null:row.fileId,name:row.name,mime:row.mime,summary:row.summary}));for(const row of plan.logs)log(c,w,row.actionId,row.message);log(c,w,null,complete?'Workflow completed. All file changes committed together.':'Files segment completed atomically. Earlier committed effects remain if a later app action fails.');});
  if(planned.error)return planned.error;
  if(!plan.operations.length){const r=settle(lease,planned);return r.status==='applied'?{...r,fileIds:automatorSession(state,lease.windowId).results.map(r=>r.fileId)}:r;}
  if(!ctx.mutateFiles)return reject('unavailable','Shared staged Files writer required.');let committed=false,ids=[];
 const response=await ctx.mutateFiles({operations:plan.operations,reserveTextUnits:planned.delta,onCommit:(results,metadata)=>{
  if(!lease.guard()||results.length!==plan.operations.length)return false;
  const aliases=new Map();for(let i=0;i<plan.operations.length;i++){const ref=plan.operations[i].ref;if(ref)aliases.set('$'+ref,results[i].fileId);}
  const next=automatorSession(planned.candidate,lease.windowId);
  for(let i=0;i<next.results.length;i++){const output=plan.output[i],id=aliases.get(output.fileId)??output.fileId,file=metadata.find(f=>f.id===id)??liveFile(id);if(!file||file.deleted)return false;const row=next.results[i];row.fileId=id;row.name=file.name;row.mime=file.mime??'';}
  const valid=validateAutomatorState(planned.candidate,ctx.profile).ok,allowed=valid&&ctx.canCommit(automatorTextUnits(planned.candidate)-automatorTextUnits(state))===true;
  if(!allowed||!lease.guard())return false;
  ids=next.results.map(r=>r.fileId);publish(planned.candidate);
  for(const [name,refs] of runtimeVariables)runtimeVariables.set(name,refs.map(id=>aliases.get(id)??id));
  committed=true;return true;
 }},{windowId:lease.windowId,guard:lease.guard});
 return committed?applied(lease.windowId,{fileIds:ids,presentationAvailable:ctx.getWindow(lease.windowId)===lease.window&&ctx.getView?.(lease.windowId)===lease.view}):lease.guard()?response?.status==='rejected'?response:reject('unavailable','Files did not publish the atomic workflow.'):stale();}
 function runOwner(id,token){const lease=owner(id);if(!lease)return null;const base=lease.guard;return {...lease,guard:()=>running.get(id)===token&&base()};}
 async function runApplication(lease,action,token) {
  if(!ctx.executeOwned||!ctx.getInventory)return reject('unavailable','Root registered owned command executor and actual application inventory required.');
  const inventory=ctx.getInventory(),command=action.kind==='open-app'?'app.open':'app.quit';
  if(!inventory?.applications?.some(a=>a.id===action.params.appId)||!inventory.commands?.some(c=>c.name===command))return reject('not_found','Choose an actual registered application and command.');
  if(!lease.guard())return stale();
  const applications=inventory.applications,commands=inventory.commands,appPin=pinGraph(applications),commandPin=pinGraph(commands);
  const inventoryGuard=()=>ctx.getInventory()===inventory&&inventory.profile===ctx.profile&&inventory.applications===applications&&inventory.commands===commands&&appPin()&&commandPin();
  let rowId;
  const requested=commit(lease,(c,w)=>{log(c,w,action.id,`${action.kind==='open-app'?'Launch':'Quit'} ${action.params.appId}: execution requested; awaiting the registered Root command.`);rowId=w.log.at(-1).id;});
  if(requested.status!=='applied')return requested;
  lease=runOwner(lease.windowId,token);if(lease)lease=filesOwner(lease);if(!lease||!inventoryGuard())return stale();
  const owned=lease.guard;lease={...lease,guard:()=>owned()&&inventoryGuard()};
  let result;try{result=await ctx.executeOwned({command,target:{appId:action.params.appId},payload:{}},{windowId:lease.windowId,guard:lease.guard});}catch(error){if(!lease.guard())return stale();result=reject(error.code??'application_failed',error.message);}
  if(!lease.guard())return result?.status==='applied'?applied(lease.windowId,{applicationResult:result,presentationAvailable:false,halted:true}):stale();
  const recorded=commit(lease,(_,w)=>{const row=w.log.find(r=>r.id===rowId),ok=result?.status==='applied',capacity=row.message.length-(ok?0:1);row.message=(ok?`${action.params.appId}: ${action.kind==='open-app'?'opened':'quit'}.`:`${action.params.appId}: ${result?.error?.message??'Root command unavailable.'}`).slice(0,capacity);row.level=ok?'info':'error';});
  if(result?.status!=='applied')return result?.status==='rejected'?result:reject('unavailable','Root did not execute the application command.');
  return recorded.status==='applied'?applied(lease.windowId,{applicationResult:result}):applied(lease.windowId,{applicationResult:result,logAvailable:false,halted:true});
 }
 async function run(lease,p) {
  if(lease.session.status==='running')return reject('busy','Workflow is already running.');
  if(state.preferences.confirmRun&&!p.confirmed)return commit(lease,(_,w)=>{w.panel='run-confirm';});
  const actions=copyCanonicalData(lease.session.actions.filter(a=>a.enabled));
  if(!actions.length)return reject('no_actions','Add at least one enabled action.');
  const hasApps=actions.some(a=>a.kind==='open-app'||a.kind==='quit-app');
  const started=commit(lease,(c,w)=>{w.status='running';w.runId++;w.results=[];w.log=[];w.panel='none';log(c,w,null,'Workflow started; running guarded actions against actual local Files and registered applications.');});
  if(started.status!=='applied')return started;
  const id=lease.windowId,token={},runtimeVariables=new Map();running.set(id,token);lease=runOwner(id,token);if(!lease)return stale();
  try {
   let result;
   if(!hasApps)result=await runFiles(lease,p.inputIds??[]);
   else {
    let inputIds=p.inputIds??[],index=0;
    while(index<actions.length){
     lease=runOwner(id,token);if(!lease)return stale();
     const action=actions[index];
     if(action.kind==='open-app'||action.kind==='quit-app'){result=await runApplication(lease,action,token);index++;}
     else {let end=index+1;while(end<actions.length&&!['open-app','quit-app'].includes(actions[end].kind))end++;result=await runFiles(lease,inputIds,actions.slice(index,end),false,runtimeVariables);if(result.status==='applied')inputIds=result.fileIds;index=end;}
     if(result?.status!=='applied'||result.halted||result.presentationAvailable===false)break;
    }
    if(result?.status==='applied'&&!result.halted&&result.presentationAvailable!==false){lease=runOwner(id,token);if(!lease)return applied(id,{presentationAvailable:false});result=commit(lease,(c,w)=>{w.status='completed';log(c,w,null,'Workflow completed. Files segments and registered app outcomes are recorded above.');});}
   }
   if(result?.status==='rejected'&&result.error?.code!=='stale_target'){const current=runOwner(id,token);if(current)commit(current,(_,w)=>failRun(w,result.error.message??'Workflow failed.'));}
   return result;
  }catch(error){if(!lease.guard())return stale();const failed=commit(lease,(_,w)=>failRun(w,error.message));return failed.status==='applied'?reject(error.code??'invalid_workflow',error.message):failed;}
  finally {if(running.get(id)===token)running.delete(id);}
 }
 const handlers={};for(const [name,schema]of Object.entries(automatorCommandPayloads))handlers[prefix+name.slice('automator'.length)]=async(t,p={})=>{if(!automatorSchemaValid(t,automatorWindowTarget)||!automatorSchemaValid(p,schema))return reject('invalid_arguments',`Use the closed ${label} workflow command schema.`);let lease=owner(t.windowId);if(!lease)return reject('unavailable',`Original canonical ${label} window unavailable.`);try{
  if(name==='automator.stop'){if(lease.session.status!=='running')return reject('disabled','No workflow is running.');const r=commit(lease,(_,w)=>{w.status='stopped';const row=w.log.at(-1);if(row){row.message='Workflow stopped. Pending Files effects discarded; earlier committed effects remain.'.slice(0,row.message.length);row.level='info';}});if(r.status==='applied')running.delete(t.windowId);return r;}
  if(name==='automator.run')return await run(lease,p);
  if(lease.session.status==='running'&&!['automator.focus','automator.scroll'].includes(name))return reject('busy','Stop the workflow before editing or saving.');
  if(name==='automator.open')return await open(lease,p);if(name==='automator.save')return await save(lease,p);
  if(name==='automator.new'){
   if(!ctx.createWindow)return reject('unavailable','Native Root window creator required.');let acknowledged=null;
   const response=await ctx.createWindow(appId,{type:p.type??'workflow',isCurrent:lease.guard,ownership:{windowId:lease.windowId,guard:lease.guard},onCommit:result=>{const window=ctx.getWindow(result.windowId),session=automatorSession(state,result.windowId);if(window&&session&&session.type===(p.type??'workflow'))acknowledged={windowId:window.id,session};}});
   return acknowledged?applied(lease.windowId,{createdWindowId:acknowledged.windowId}):response?.status==='rejected'?response:lease.guard()?reject('unavailable','Root did not acknowledge an actual new workflow session.'):stale();
  }
  if(name==='automator.search')return commit(lease,(_,w)=>{w.search=p.query;if(p.category)w.category=p.category;});
  if(name==='automator.addAction')return commit(lease,(c,w)=>{const entry=automatorLibrary.find(a=>a.kind===p.kind);if(p.index!==undefined&&p.index>w.actions.length)return reject('invalid_arguments','Insertion index is outside this workflow.');const action={id:'auto-action-'+c.nextId++,kind:p.kind,enabled:true,params:copyCanonicalData(entry.defaults)};w.actions.splice(p.index??w.actions.length,0,action);w.selected=action.id;w.dirty=true;return {actionId:action.id};});
  if(name==='automator.addFiles'){lease=filesOwner(lease);if(!lease)return reject('unavailable','Actual Files store required.');return commit(lease,(c,w)=>{if(!p.fileIds.length||p.fileIds.some(id=>!liveFile(id)))return reject('not_found','Drop actual live Files items.');const action={id:'auto-action-'+c.nextId++,kind:'get-files',enabled:true,params:{fileIds:[...new Set(p.fileIds)]}};w.actions.push(action);w.selected=action.id;w.dirty=true;return {actionId:action.id};});}
  if(name==='automator.editAction')return commit(lease,(_,w)=>{const row=w.actions.find(a=>a.id===p.action.id);if(!row||row.kind!==p.action.kind)return reject('not_found','Original action or kind unavailable.');applyCanonicalData(row,p.action);w.dirty=true;});
  if(name==='automator.selectAction')return commit(lease,(_,w)=>{if(!w.actions.some(a=>a.id===p.actionId))return reject('not_found','Action unavailable.');w.selected=p.actionId;});
  if(name==='automator.moveAction')return commit(lease,(_,w)=>{const index=w.actions.findIndex(a=>a.id===p.actionId);if(index<0||p.index>=w.actions.length)return reject('not_found','Action or reorder position unavailable.');const [row]=w.actions.splice(index,1);w.actions.splice(p.index,0,row);w.selected=row.id;w.dirty=true;});
  if(name==='automator.deleteAction')return commit(lease,(_,w)=>{const index=w.actions.findIndex(a=>a.id===p.actionId);if(index<0)return reject('not_found','Action unavailable.');w.actions.splice(index,1);if(w.selected===p.actionId)w.selected=null;w.dirty=true;});
  if(name==='automator.setVariable')return commit(lease,(c,w)=>{if(w.variables.some(v=>v.name===p.variable.name&&v.id!==p.variable.id))return reject('name_collision','Variable names must be unique.');const old=w.variables.find(v=>v.id===p.variable.id);if(old)applyCanonicalData(old,p.variable);else {w.variables.push(copyCanonicalData(p.variable));c.nextId++;}w.dirty=true;});
  if(name==='automator.deleteVariable')return commit(lease,(_,w)=>{const index=w.variables.findIndex(v=>v.id===p.variableId);if(index<0)return reject('not_found','Variable unavailable.');w.variables.splice(index,1);w.dirty=true;});
  if(name==='automator.clearLog')return commit(lease,(_,w)=>{w.log=[];w.results=[];});
  if(name==='automator.preferences')return commit(lease,c=>{applyCanonicalData(c.preferences,p.values);});
  if(name==='automator.panel')return commit(lease,(_,w)=>{w.panel=p.panel;});
  if(name==='automator.closeDecision'){if(p.decision==='cancel')return commit(lease,(_,w)=>{w.panel='none';});if(p.decision==='save'){const r=await save(lease,{});if(r.status!=='applied')return r;lease=owner(t.windowId);if(!lease)return applied(t.windowId,{presentationAvailable:false});}const r=await ctx.closeWindow?.(t.windowId,{windowId:t.windowId,guard:lease.guard,discard:true});return r?.status==='applied'||!ctx.getWindow(t.windowId)?applied(t.windowId):r?.status==='rejected'?r:reject('unavailable','Root window closer required.');}
  if(name==='automator.focus'||name==='automator.scroll'){if(!lease.view||ctx.available(lease.window)!==true||lease.view.available?.()!==true)return reject('unavailable','Mounted native workflow view required.');const ok=name==='automator.focus'?lease.view.focus?.(p.controlId,lease.guard):lease.view.scroll?.(p,lease.guard);return ok===true?applied(t.windowId):reject('unavailable','Actual native control unavailable.');}
  return reject('unavailable','Automator command unavailable.');
 }catch(error){return reject(error.code??'invalid_format',error.message);}};
 function lifecycle(change,guard=()=>true) {if(!alive()||!validateAutomatorState(state,ctx.profile).ok||!guard())return false;const pinned=pinGraph(state),version=generation,time=ctx.getSceneTime(),c=copyCanonicalData(state);if(change(c)===false)return false;c.revision++;const allowed=validateAutomatorState(c,ctx.profile).ok&&ctx.canCommit(automatorTextUnits(c)-automatorTextUnits(state))===true;if(!allowed||!alive()||generation!==version||ctx.getSceneTime()!==time||!pinned()||!guard())return false;publish(c);return true;}
 function windowOpened(window,options={}) {
  if(!alive()||!window||ctx.getWindow(window.id)!==window||window.appId!==appId)return false;
  const current=()=>ctx.getWindow(window.id)===window&&(!options.isCurrent||options.isCurrent()===true)&&(!options.ownership||options.ownership.guard?.()===true);
  if(automatorSession(state,window.id)){if(originalWindows.has(window.id)&&originalWindows.get(window.id)!==window||!current()||!validateAutomatorState(state,ctx.profile).ok)return false;originalWindows.set(window.id,window);options.onCommit?.({windowId:window.id,appId:window.appId});return true;}
  let committed=false;
  try {const document=options.document?parseAutomatorWorkflow(options.document):undefined;committed=lifecycle(c=>{c.sessions.push(createAutomatorSession(window.id,{type:options.type,title:options.title,document}));},current);}catch{return false;}
  if(committed){originalWindows.set(window.id,window);try{options.onCommit?.({windowId:window.id,appId:window.appId});}catch{/* Notification failure cannot undo an acknowledged actual session. */}}
  return committed;
 }
 function windowClosed(windowOrId,options={}) {const id=typeof windowOrId==='string'?windowOrId:windowOrId?.id;if(!alive())return false;const w=automatorSession(state,id);if(!w)return true;if(typeof windowOrId==='object'&&ctx.getWindow(id)!==windowOrId)return false;const lease=owner(id);if(!lease)return false;const current=()=>lease.guard()&&(!options.guard||options.guard()===true);if(!current())return false;if((w.dirty||w.status==='running')&&!options.discard){if(w.status==='running')return false;commit(lease,(_,w)=>{w.panel='close';});ctx.focusWindow?.(id);return false;}const ok=lifecycle(c=>{const i=c.sessions.findIndex(w=>w.windowId===id);c.sessions.splice(i,1);},current);if(ok){running.delete(id);originalWindows.delete(id);}return ok;}
 function appQuit(appId) {if(!alive())return false;const w=state.sessions.find(w=>(!appId||ctx.getWindow(w.windowId)?.appId===appId)&&(w.dirty||w.status==='running'));if(w){const lease=owner(w.windowId);if(lease&&w.status!=='running')commit(lease,(_,w)=>{w.panel='close';});ctx.focusWindow?.(w.windowId);return false;}return true;}
 return {handlers,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;running.clear();originalWindows.clear();},targets:()=>({[prefix]:alive()?state.sessions.map(w=>({windowId:w.windowId,title:w.title,type:w.type,status:w.status})):[]})};
}

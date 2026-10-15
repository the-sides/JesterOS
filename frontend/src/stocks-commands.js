import { copyCanonicalData,canonicalStringUnits } from './canonical-data.js';
import { stocksPayloads,stocksWindowTarget } from './stocks-catalog.js';
import { stocksSchemaValid,stocksIdSchema,validateStocksState,stocksQuote,stocksStory,stocksWindow,stocksEpoch,stocksCurrent,stocksCapabilities,commitStocksCandidate } from './stocks-state.js';
const reject=(code,message)=>({status:'rejected',error:{code,message}});
// Retain every original object, not just an equal-value clone of the root.
function originalGraph(state) {const refs=[];const visit=node=>{if(!node||typeof node!=='object')return;refs.push([node,Object.entries(node)]);for(const child of Object.values(node))visit(child);};visit(state);const signature=JSON.stringify(state);return()=>JSON.stringify(state)===signature&&refs.every(([node,rows])=>Object.keys(node).length===rows.length&&rows.every(([key,value])=>node[key]===value));}
export function createStocksCommands(state,ctx) {
 let disposed=false;
 const alive=()=>!disposed&&(!ctx.getState||ctx.getState()===state)&&(!ctx.alive||ctx.alive()===true)&&validateStocksState(state,ctx.profile).ok;
 const clock=()=>stocksEpoch(ctx.getSceneTime?.());
 function owner(windowId) {
  if(!alive())return null;const window=ctx.getWindow(windowId),view=ctx.getView(windowId),session=stocksWindow(state,windowId),at=clock(),graph=originalGraph(state);
  if(!window||window.appId!=='stocks'||!session||!view||ctx.available(window)!==true||view.available()!==true||at===null)return null;
  const guard=()=>alive()&&graph()&&ctx.getWindow(windowId)===window&&ctx.getView(windowId)===view&&stocksWindow(state,windowId)===session&&ctx.available(window)===true&&view.available()===true&&clock()===at;
  return {window,view,session,at,guard};
 }
 async function settle(result,lease,target) {if(result.status!=='applied')return result;if(ctx.tick)await ctx.tick();return {...result,target,presentationAvailable:alive()&&ctx.getWindow(target.windowId)===lease.window&&ctx.getView(target.windowId)===lease.view&&ctx.available(lease.window)===true&&lease.view.available()===true};}
 const commit=(lease,target,mutate)=>settle(commitStocksCandidate(state,mutate,ctx.canCommit,lease.guard),lease,target);
 function prepare(mutate,ownership={}) {
  if(!alive()||ownership.guard&&ownership.guard()!==true)return null;
  const graph=originalGraph(state),at=clock(),candidate=copyCanonicalData(state),result=commitStocksCandidate(candidate,mutate,()=>true);
  if(result.status!=='applied')return null;
  const current=()=>alive()&&graph()&&clock()===at&&(!ownership.guard||ownership.guard()===true);
  const delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);let used=false;
  return {current,delta,...result,commit:()=>{if(used||!current())return false;const applied=commitStocksCandidate(state,next=>{for(const key of Object.keys(next))next[key]=copyCanonicalData(candidate[key]);return result;},ctx.canCommit,current);used=applied.status==='applied';return used;}};
 }
 function prepareNotificationDismissals(actualIDs,ownership={}) {
  if(!Array.isArray(actualIDs)||actualIDs.some(id=>!stocksSchemaValid(id,stocksIdSchema))||new Set(actualIDs).size!==actualIDs.length)return null;
  return prepare(next=>{for(const row of next.alerts)if(row.active&&actualIDs.includes(row.notificationId))row.active=false;return {notificationIds:actualIDs};},ownership);
 }
 function prepareNotificationOpen(kind,recordId,ownership={}) {
  const record=kind==='stocks-price'?stocksQuote(state,recordId):kind==='stocks-story'?stocksStory(state,recordId):null;
  if(!record)return null;
  const session=stocksWindow(state,ownership.windowId);if(!session)return null;
  return prepare(next=>{const w=stocksWindow(next,ownership.windowId);w.query='';w.menu=null;w.sheet='none';w.editing=false;w.removeId=null;if(kind==='stocks-price'){w.selectedId=recordId;w.storyId=null;}else{w.storyId=recordId;w.selectedId=record.symbolIds[0]??null;}return {recordId,windowId:ownership.windowId};},ownership);
 }
 function cleanupCommit(lease,mutate) {
  const candidate=copyCanonicalData(state),prepared=commitStocksCandidate(candidate,mutate,()=>true);if(prepared.status!=='applied')return prepared;
  const ids=state.alerts.filter(a=>a.active&&!candidate.alerts.find(row=>row.id===a.id)?.active).map(a=>a.notificationId);
  if(!ids.length)return commitStocksCandidate(state,mutate,ctx.canCommit,lease.guard);
  if(typeof ctx.updateNotifications!=='function')return reject('unavailable','The actual shared alert retirement bridge is unavailable.');
  let applied=null;const result=ctx.updateNotifications(ids,{dismissed:true,reserveTextUnits:canonicalStringUnits(candidate)-canonicalStringUnits(state),onCommit:actual=>{if(!Array.isArray(actual)||actual.length!==ids.length||actual.some((id,i)=>id!==ids[i])||!lease.guard())return false;applied=commitStocksCandidate(state,mutate,ctx.canCommit,lease.guard);return applied.status==='applied';}},{guard:lease.guard,windowId:lease.window.id});
  return applied?.status==='applied'&&result?.status==='applied'?applied:result?.status==='rejected'?result:reject('unavailable','Actual alert retirement was not atomically acknowledged.');
 }
 function notify(lease,payload) {
  const record=payload.kind==='stocks-price'?stocksQuote(state,payload.recordId):stocksStory(state,payload.recordId);
  if(!record||!state.preferences.notifications||payload.kind==='stocks-price'&&!state.watchlist.includes(record.id)||payload.kind==='stocks-story'&&record.publishedAt>lease.at)return reject('unavailable','Choose an original followed quote or published local story with notifications enabled.');
  if(typeof ctx.notify!=='function'||typeof ctx.planNotification!=='function')return reject('unavailable','The actual canonical notification publisher/planner is unavailable.');
  const now=stocksCurrent(state,payload.kind==='stocks-price'?record:null),at=payload.kind==='stocks-price'?now.at:record.publishedAt;
  if(state.alerts.some(a=>a.kind===payload.kind&&a.recordId===record.id&&a.at===at&&a.sourceRevision===record.revision))return reject('already_delivered','This original authored quote observation or story has already been delivered.');
  if(state.alerts.length>=256||state.nextId>=Number.MAX_SAFE_INTEGER-1)return reject('limit_exceeded','The local Stocks delivery ledger is full.');
  const sourceId=`stocks-alert-${state.nextId}`,title=payload.kind==='stocks-price'?`${record.id} · ${now.price.toFixed(2)}`:record.title,body=payload.kind==='stocks-price'?`${now.change>=0?'+':''}${now.change.toFixed(2)} (${now.percent.toFixed(2)}%) · authored local quote`:record.paragraphs[0];
  const plan=ctx.planNotification({guard:lease.guard,windowId:lease.window.id});
  if(!plan||!stocksSchemaValid(plan.notificationId,stocksIdSchema)||typeof plan.current!=='function'||plan.current()!==true||!lease.guard())return reject('stale_target','The original shared notification identity plan is unavailable.');
  const guard=()=>lease.guard()&&plan.current()===true;
  const base=copyCanonicalData(state);base.nextId++;base.alerts.push({id:sourceId,kind:payload.kind,recordId:record.id,sourceRevision:record.revision,at,notificationId:plan.notificationId,active:true});
  const reserve=canonicalStringUnits(base)-canonicalStringUnits(state);let committed=null;
  const result=ctx.notify({id:sourceId,appId:'stocks',title:title.slice(0,256),body:body.slice(0,4096),source:{kind:payload.kind,recordId:record.id,windowId:lease.window.id},actions:['open'],sound:'none',reserveTextUnits:reserve,onCommit:notificationId=>{
   if(notificationId!==plan.notificationId||!guard())return false;
   committed=commitStocksCandidate(state,next=>{next.nextId++;next.alerts.push({id:sourceId,kind:payload.kind,recordId:record.id,sourceRevision:record.revision,at,notificationId,active:true});return {notificationId,recordId:record.id};},ctx.canCommit,guard);return committed.status==='applied';
  }},{guard,windowId:lease.window.id});
  if(result?.then)return reject('unavailable','The shared publisher must synchronously reserve and commit actual notification/domain state.');
  return result?.status==='applied'&&committed?.status==='applied'?committed:result?.status==='rejected'?result:committed?.status==='rejected'?committed:reject('unavailable','The actual shared alert did not acknowledge its original source ledger.');
 }
 const handlers=Object.fromEntries(Object.entries(stocksPayloads).map(([name,schema])=>[name,async(target,payload={})=>{
  if(!stocksSchemaValid(target,stocksWindowTarget)||!stocksSchemaValid(payload,schema))return reject('invalid_arguments','Use the exact bounded Stocks target/payload.');
  const lease=owner(target.windowId);if(!lease||!lease.guard())return reject('unavailable','The original native Stocks window/session/view and authored clock must be available.');
  if(name==='stocks.native.focus'){const ok=await lease.view.focus(payload.controlId,lease.guard);return ok===true&&lease.guard()?{status:'applied',target}:reject('unavailable','The actual visible native control could not be focused.');}
  if(name==='stocks.native.scroll'){const offsets=await lease.view.scroll(payload.areaId,payload,lease.guard);return offsets&&lease.guard()?{status:'applied',target,offsets}:reject('unavailable','The original rendered scroll area is unavailable.');}
  if(name==='stocks.window.close')return typeof ctx.closeWindow==='function'?ctx.closeWindow(target.windowId,{guard:lease.guard,windowId:target.windowId}):reject('unavailable','The actual window lifecycle bridge is unavailable.');
  if(name==='stocks.notify')return settle(notify(lease,payload),lease,target);
  if(name==='stocks.story.share'||name==='stocks.story.saveNews') {
   const story=stocksStory(state,lease.session.storyId);if(!story)return reject('unavailable','Open an original local business story first.');
   if(!stocksCapabilities(state.profileId,state.preferences.region).nativeReader)return reject('unsupported_region','Mojave supports its in-app story share/save only in US, UK and Australia.');
   if(name==='stocks.story.saveNews')return typeof ctx.saveNewsStory==='function'?ctx.saveNewsStory(story,{guard:lease.guard,windowId:target.windowId}):reject('unavailable','The actual canonical News save bridge is unavailable.');
   if(typeof ctx.share!=='function')return reject('unavailable','The actual native share destination is unavailable.');
   const content=`${story.title}\n${story.publisher} · ${story.author}\n\n${story.paragraphs.join('\n\n')}`;
   const result=await ctx.share({title:story.title,mime:'text/plain',content,text:content,source:{appId:'stocks',windowId:target.windowId,documentId:story.id}},{guard:lease.guard,windowId:target.windowId});return result;
  }
  if(name==='stocks.preferences')return settle(cleanupCommit(lease,next=>{next.preferences=copyCanonicalData(payload.values);if(!payload.values.notifications)for(const a of next.alerts)a.active=false;}),lease,target);
  if(name==='stocks.watchlist.remove'&&payload.confirm)return settle(cleanupCommit(lease,next=>{if(!next.watchlist.includes(payload.symbolId))return reject('stale_target','The original watchlist symbol is missing.');next.watchlist.splice(next.watchlist.indexOf(payload.symbolId),1);for(const w of next.windows)if(w.removeId===payload.symbolId)w.removeId=null;for(const a of next.alerts)if(a.recordId===payload.symbolId&&a.kind==='stocks-price')a.active=false;}),lease,target);
  return commit(lease,target,next=>{
   const w=stocksWindow(next,target.windowId);
   if(name==='stocks.search'){w.query=payload.query;w.storyId=null;}
   else if(name==='stocks.select'){if(!stocksQuote(next,payload.symbolId))return reject('stale_target','The original quote is unavailable.');w.selectedId=payload.symbolId;w.storyId=null;}
   else if(name==='stocks.business'){w.selectedId=null;w.storyId=null;w.query='';}
   else if(name==='stocks.watchlist.edit'){w.editing=payload.editing;w.removeId=null;}
   else if(name==='stocks.watchlist.add'){if(!stocksQuote(next,payload.symbolId)||next.watchlist.includes(payload.symbolId))return reject('invalid_arguments','Add an existing distinct original quote.');next.watchlist.push(payload.symbolId);}
   else if(name==='stocks.watchlist.remove'){if(!next.watchlist.includes(payload.symbolId))return reject('stale_target','The original watchlist symbol is missing.');w.removeId=payload.symbolId;}
   else if(name==='stocks.watchlist.reorder'){if(payload.symbolIds.length!==next.watchlist.length||new Set(payload.symbolIds).size!==payload.symbolIds.length||payload.symbolIds.some(id=>!next.watchlist.includes(id)))return reject('invalid_arguments','Reorder exactly the existing distinct watchlist symbols.');next.watchlist=[...payload.symbolIds];}
   else if(name==='stocks.range'){if(!stocksCapabilities(state.profileId).ranges.includes(payload.range))return reject('unsupported_profile','This chart range is not available in the researched installed era.');next.range=payload.range;}
   else if(name==='stocks.refresh'){if(lease.at<next.runtime.refreshedAt)return reject('stale_time','Refresh requires monotonic authored scene time.');next.runtime.refreshedAt=lease.at;}
   else if(name==='stocks.story.open'){const story=stocksStory(next,payload.storyId);if(!story||story.publishedAt>lease.at)return reject('stale_target','The authored original published story is unavailable.');w.storyId=story.id;}
   else if(name==='stocks.story.back')w.storyId=null;
   else if(name==='stocks.sheet'){w.sheet=payload.sheet;w.menu=null;}
   else if(name==='stocks.menu.open'){w.menu=payload.menuId;}
   else if(name==='stocks.menu.close')w.menu=null;
   return {windowId:target.windowId};
  });
 }]));
 function windowOpened(window,options={}) {
  if(!alive()||!window||ctx.getWindow(window.id)!==window||window.appId!=='stocks'||stocksWindow(state,window.id))return reject('unavailable','Register the actual original new Stocks window once.');
  return commitStocksCandidate(state,next=>{next.windows.push({windowId:window.id,selectedId:next.watchlist[0]??next.quotes[0]?.id??null,query:'',editing:false,removeId:null,storyId:null,sheet:'none',menu:null});return {windowId:window.id};},ctx.canCommit,()=>alive()&&ctx.getWindow(window.id)===window);
 }
 function windowClosed(windowOrId){const id=typeof windowOrId==='string'?windowOrId:windowOrId?.id;if(!stocksWindow(state,id))return {status:'applied'};return commitStocksCandidate(state,next=>{next.windows.splice(next.windows.findIndex(w=>w.windowId===id),1);},ctx.canCommit,alive);}
 function clockChanged(instant,ownership={}) {const at=stocksEpoch(instant);if(at===null)return reject('invalid_arguments','Use actual numeric authored scene time.');return commitStocksCandidate(state,next=>{if(at<next.runtime.refreshedAt)return reject('stale_time','Stocks timeline is monotonic.');next.runtime.refreshedAt=at;},ctx.canCommit,()=>alive()&&(!ownership.guard||ownership.guard()===true)&&clock()===at);}
 return {handlers,targets:()=>alive()?state.windows.filter(w=>{const v=ctx.getView(w.windowId),win=ctx.getWindow(w.windowId);return win&&v&&ctx.available(win)===true&&v.available()===true;}).map(w=>({windowId:w.windowId})):[],windowOpened,windowClosed,appQuit:appId=>appId==='stocks'?commitStocksCandidate(state,next=>{next.windows.splice(0);},ctx.canCommit,alive):{status:'applied'},dispose:()=>{disposed=true;},clockChanged,prepareNotificationDismissals,prepareNotificationOpen};
}

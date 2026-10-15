import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
import {chessSchemaValid,chessSession} from './chess-state.js';
import {gamesCommandSpecs,tipsCommandSpecs,gamesTipsTargetSchema} from './games-tips-catalog.js';
import {gamesWindow,tipsWindow,createGamesWindow,createTipsWindow,validateGamesState,validateTipsState} from './games-tips-state.js';
import {gamesProjection,gamesSources} from './games-library.js';
import {tipsTopic,visibleTips} from './tips-content.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=windowId=>({status:'applied',target:{windowId}});
function pin(value){if(!value||typeof value!=='object')return ()=>true;const signature=JSON.stringify(value),children=Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([key,v])=>[key,v,pin(v)]);return ()=>JSON.stringify(value)===signature&&children.every(([key,v,guard])=>value[key]===v&&guard());}
function createCommands(kind,state,ctx){
 const find=kind==='games'?gamesWindow:tipsWindow,create=kind==='games'?createGamesWindow:createTipsWindow,validate=kind==='games'?validateGamesState:validateTipsState,specs=kind==='games'?gamesCommandSpecs:tipsCommandSpecs,profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 let disposed=false,generation=0;const originals=new Map();
 const alive=()=>!disposed&&ctx.alive()===true&&state.profileId===profileId&&(!ctx.getState||ctx.getState()===state);
 const stale=()=>rejected('stale_target','Original actor, nested source graph, window, native facade or authored scene time changed.');
 function graphGuard(extra=()=>true){const version=generation,time=ctx.getSceneTime(),refs=pin(state);return ()=>alive()&&generation===version&&ctx.getSceneTime()===time&&refs()&&extra()===true;}
 function owner(id){
  if(!alive()||!validate(state,ctx.profile).ok)return null;
  const window=ctx.getWindow(id),session=find(state,id),view=ctx.getView?.(id);
  if(!window||window.appId!==kind||!session||originals.has(id)&&originals.get(id)!==window||ctx.available(window)!==true||!view||view.available()!==true)return null;
  const windowPin=pin(window),guard=graphGuard(()=>ctx.getWindow(id)===window&&windowPin()&&find(state,id)===session&&ctx.getView(id)===view&&ctx.available(window)===true&&view.available()===true);
  return {windowId:id,window,session,view,guard};
 }
 const publish=candidate=>{applyCanonicalData(state,candidate);generation++;};
 function commit(o,change){if(!o.guard())return stale();const candidate=copyCanonicalData(state),w=find(candidate,o.windowId);try{const result=change(w);if(result?.status==='rejected')return result;}catch(error){return rejected('invalid_arguments',error.message);}candidate.revision++;w.revision++;const validation=validate(candidate,ctx.profile);if(!validation.ok)return rejected('invalid_state',validation.message);if(ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true)return rejected('limit_exceeded','The signed complete Root quota would be exceeded.');if(!o.guard())return stale();publish(candidate);return applied(o.windowId);}
 function sources(o){const store=ctx.getShared?.('store'),chess=ctx.getShared?.('chess');if(!gamesSources(store,chess,ctx.profile))return null;const storePin=pin(store),chessPin=pin(chess);return {store,chess,guard:()=>o.guard()&&ctx.getShared('store')===store&&ctx.getShared('chess')===chess&&storePin()&&chessPin()};}
 async function dispatch(o,packet,guard,ack){
  if(typeof ctx.executeOwned!=='function')return rejected('unavailable','The actual owned Root command endpoint is required.');
  if(guard()!==true)return stale();
  const actorPin=pin(state),version=generation,time=ctx.getSceneTime();
  let result;try{result=await ctx.executeOwned(packet,{guard,windowId:o.windowId});}catch(error){return guard()?rejected('unavailable',String(error.message).slice(0,512)):stale();}
  if(result?.status!=='applied')return result?.status==='rejected'?result:rejected('unavailable','Root did not acknowledge the native action.');
  // An acknowledged app launch/focus or Chess mutation intentionally changes its
  // participant. Do not reapply the old source lease after that publication.
  if(!alive()||generation!==version||ctx.getSceneTime()!==time||!actorPin()||ctx.getWindow(o.windowId)!==o.window||ctx.getView(o.windowId)!==o.view||ack(result)!==true)return stale();
  return {...applied(o.windowId),destination:result.target};
 }
 const registered=id=>{const apps=ctx.getInventory?.().applications;return Array.isArray(apps)?apps.some(row=>(row.id??row.appId)===id):!!apps&&Object.hasOwn(apps,id);};
 function launch(o,appId,guard){if(!registered(appId))return rejected('unavailable','The actual application is not registered in this profile.');return dispatch(o,{command:'app.open',target:{appId},payload:{}},guard,result=>{const destination=ctx.getWindow(result.target?.windowId);return !!destination&&destination.appId===appId;});}
 async function gamesAction(o,suffix,p){const shared=sources(o);if(!shared)return rejected('unavailable','Original canonical Store and Chess sources are required.');
  if(suffix==='launch'){const projection=gamesProjection(shared.store,shared.chess,ctx.profile);if(p.appId!==projection.chessAppId&&!projection.installed.some(row=>row.appId===p.appId))return rejected('not_found','Only installed canonical games or the bundled local Chess may launch.');return launch(o,p.appId,shared.guard);}
  const session=chessSession(shared.chess,p.chessWindowId),window=ctx.getWindow(p.chessWindowId),view=ctx.getView?.(p.chessWindowId);
  if(!session||!window||window.appId!==gamesProjection(shared.store,shared.chess,ctx.profile).chessAppId||!view||view.available()!==true||ctx.available(window)!==true)return rejected('unavailable','The original mounted canonical Chess match is unavailable.');
  const windowPin=pin(window),guard=()=>shared.guard()&&ctx.getWindow(p.chessWindowId)===window&&windowPin()&&chessSession(shared.chess,p.chessWindowId)===session&&ctx.getView(p.chessWindowId)===view&&view.available()===true&&ctx.available(window)===true;
  const packet=suffix==='resume'?{command:'window.focus',target:{windowId:p.chessWindowId},payload:{keyboard:true}}:{command:`chess.${p.action}`,target:{windowId:p.chessWindowId},payload:{}};
  return dispatch(o,packet,guard,()=>ctx.getShared('store')===shared.store&&ctx.getShared('chess')===shared.chess&&ctx.getWindow(p.chessWindowId)===window&&chessSession(shared.chess,p.chessWindowId)===session&&ctx.getView(p.chessWindowId)===view);
 }
 const location=w=>({collection:w.collection,topicId:w.topicId,query:w.query});
 function navigate(w,change){w.back.push(location(w));if(w.back.length>32)w.back.shift();w.forward.splice(0);change();}
 const handlers={};for(const [suffix,schema]of Object.entries(specs))handlers[`${kind}.${suffix}`]=async(t,p={})=>{
  if(!chessSchemaValid(t,gamesTipsTargetSchema)||!chessSchemaValid(p,schema))return rejected('invalid_arguments','Use the exact closed native command fields.');const o=owner(t.windowId);if(!o)return stale();
  if(suffix==='focus'){const ok=await o.view.focus(p.controlId,o.guard);return o.guard()&&ok===true?applied(o.windowId):stale();}
  if(suffix==='window.close')return ctx.closeWindow(o.windowId,{guard:o.guard,windowId:o.windowId});
  if(kind==='games'&&['launch','resume','chess'].includes(suffix))return gamesAction(o,suffix,p);
  if(kind==='tips'&&suffix==='try'){if(o.session.topicId!==p.topicId)return rejected('disabled','Open this authored topic before trying its action.');const topic=tipsTopic(p.topicId),windows=profileId.startsWith('windows11'),appId=windows?({finder:'explorer',textedit:'notepad',chess:'chess-local'}[topic.appId]??topic.appId):topic.appId;return launch(o,appId,o.guard);}
  return commit(o,w=>{
   if(suffix==='sheet'){if(Object.hasOwn(p,'sheet'))w.sheet=p.sheet;if(Object.hasOwn(p,'menu'))w.menu=p.menu;return;}
   if(kind==='games'){if(suffix==='search')w.query=p.query;if(suffix==='navigate')w.section=p.section;if(suffix==='profile')w.playerName=p.name.trim();return;}
   if(suffix==='search')navigate(w,()=>{w.query=p.query;w.topicId=null;});
   if(suffix==='collection')navigate(w,()=>{w.collection=p.collection;w.query='';w.topicId=null;});
   if(suffix==='open'){if(!visibleTips(w).some(row=>row.id===p.topicId))return rejected('not_found','Topic is not in the current filtered guide collection.');navigate(w,()=>{w.topicId=p.topicId;});}
   if(suffix==='history'){const from=p.direction==='back'?w.back:w.forward,to=p.direction==='back'?w.forward:w.back;if(!from.length)return rejected('disabled','No guide history in that direction.');to.push(location(w));if(to.length>32)to.shift();Object.assign(w,from.pop());}
   if(suffix==='step'){const list=visibleTips(w),index=list.findIndex(row=>row.id===w.topicId),next=index+(p.direction==='next'?1:-1);if(index<0||next<0||next>=list.length)return rejected('disabled','No adjacent topic in this guide collection.');navigate(w,()=>{w.topicId=list[next].id;});}
   if(suffix==='read'){if(!w.topicId)return rejected('disabled','Open a topic before marking it read.');const index=w.readTopics.indexOf(w.topicId);if(p.read&&index<0)w.readTopics.push(w.topicId);if(!p.read&&index>=0)w.readTopics.splice(index,1);}
   if(suffix==='accessibility')Object.assign(w,p);
  });
 };
 function windowOpened(window,options={}){
  const source=()=>typeof options.sourceGuard!=='function'||options.sourceGuard()===true,owned=()=>source()&&(!options.isCurrent||options.isCurrent()===true)&&(!options.ownership?.guard||options.ownership.guard()===true);
  if(!alive()||!validate(state,ctx.profile).ok||window?.appId!==kind||!chessSchemaValid(window.id,gamesTipsTargetSchema.properties.windowId)||!owned())return false;
  const existing=find(state,window.id);if(existing){if(originals.has(window.id)&&originals.get(window.id)!==window)return false;originals.set(window.id,window);return true;}
  const original=pin(window),guard=graphGuard(()=>owned()&&original()),candidate=copyCanonicalData(state);candidate.windows.push(create(window.id));candidate.revision++;
  if(!validate(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;
  if(options.onCommit&&options.onCommit({windowId:window.id,appId:kind})!==true)return false;
  publish(candidate);originals.set(window.id,window);return true;
 }
 function remove(ids,ownership={}){const guard=graphGuard(()=>!ownership.guard||ownership.guard()===true),candidate=copyCanonicalData(state);candidate.windows.splice(0,candidate.windows.length,...candidate.windows.filter(w=>!ids.includes(w.windowId)));candidate.revision++;if(!alive()||!validate(state,ctx.profile).ok||!validate(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;publish(candidate);ids.forEach(id=>originals.delete(id));return true;}
 function windowClosed(actual,ownership={}){const id=typeof actual==='string'?actual:actual?.id,original=originals.get(id);if(!find(state,id)||typeof actual!=='string'&&original&&actual!==original||original&&ctx.getWindow(id)&&ctx.getWindow(id)!==original)return false;return remove([id],ownership);}
 function appQuit(id,ownership={}){return id===kind&&remove(state.windows.map(w=>w.windowId),ownership);}
 function targets(id){const o=owner(id),w=find(state,id);return {windowId:id,available:!!o,session:w?copyCanonicalData(w):null,native:ctx.getView?.(id)?.describe?.()??null,...kind==='games'?{library:gamesProjection(ctx.getShared?.('store'),ctx.getShared?.('chess'),ctx.profile,w?.query??'')}:{topics:w?visibleTips(w).map(row=>({id:row.id,title:row.title})):[]}};}
 return {handlers,targets,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originals.clear();}};
}
export const createGamesCommands=(state,ctx)=>createCommands('games',state,ctx);
export const createTipsCommands=(state,ctx)=>createCommands('tips',state,ctx);

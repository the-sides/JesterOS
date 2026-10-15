import {defineCommand,object,empty,choice,flag} from './command-schema.js';
import {copyCanonicalData,applyCanonicalData} from './canonical-data.js';
import {MAPS_PROFILES,mapsId,mapsSchemaValid,validateMapsState,mapsWindow,mapsTextUnits,createMapsWindow,mapsPreferencesSchema,mapPlace,mapRoutes,mapSearch,mapDocument} from './maps-state.js';
const targetSchema=object({windowId:mapsId}),text=(maxLength=4096)=>({type:'string',maxLength}),coordinate={type:'number',minimum:0,maximum:1000};
const commands={search:object({query:text()}),select:object({placeId:{anyOf:[{type:'null'},mapsId]}}),pan:object({x:coordinate,y:coordinate}),zoom:object({zoom:{type:'number',minimum:1,maximum:8}}),mode:object({mode:choice('map','satellite')}),overlay:object({overlay:choice('none','traffic','transit')}),location:empty,'pin.add':object({x:coordinate,y:coordinate,name:{...text(256),minLength:1}}),'pin.remove':object({placeId:mapsId}),'favorite.set':object({placeId:mapsId,enabled:flag}),'recents.clear':empty,directions:object({fromId:mapsId,toId:mapsId,transport:choice('drive','walk','transit')}),'route.select':object({routeKey:{...text(2048),minLength:1}}),'step.select':object({step:{type:'integer',minimum:0,maximum:63}}),'preferences.set':object({preferences:mapsPreferencesSchema}),panel:object({panel:choice('none','directions','favorites','recents','preferences','help')}),print:empty,share:empty,'menu.open':object({menuId:choice('maps','file','edit','view','window','help')}),'menu.close':empty,focus:object({controlId:{...text(128),minLength:1}}),scroll:object({areaId:choice('sidebar','steps'),top:{type:'number',minimum:0,maximum:Number.MAX_SAFE_INTEGER},left:{type:'number',minimum:0,maximum:Number.MAX_SAFE_INTEGER}})};
export const mapsCatalog=Object.fromEntries(Object.entries(commands).map(([suffix,schema])=>defineCommand(MAPS_PROFILES,`maps.${suffix}`,'maps.local',targetSchema,schema,['Actual original Maps window and native view; locally authored map data only.'],[`Operate ${suffix} on canonical bounded authored map state or genuine shared destination.`],['maps'],[],targetSchema)));
const reject=(code,message)=>({status:'rejected',code,message}),stale=()=>reject('stale_target','The original map/window/session/view changed.'),invalid=()=>reject('invalid_arguments','Use the documented bounded closed Maps request.');
export function createMapsCommands(ctx) {
  const state=ctx.getState();let sequence=0,disposed=false;
  const alive=()=>!disposed&&ctx.getState()===state&&MAPS_PROFILES.includes(ctx.profile.id)&&(ctx.alive?.()??true)===true;
  function snapshot(){
    const version=sequence,signature=JSON.stringify(state),sceneTime=ctx.getSceneTime?.()??0,edges=[];
    function capture(parent){for(const [key,value]of Object.entries(parent))if(value&&typeof value==='object'){edges.push([parent,key,value]);capture(value);}}
    capture(state);
    return ()=>alive()&&version===sequence&&validateMapsState(state,ctx.profile)&&Object.is(ctx.getSceneTime?.()??0,sceneTime)&&edges.every(([parent,key,value])=>Object.getOwnPropertyDescriptor(parent,key)?.value===value)&&JSON.stringify(state)===signature;
  }
  function owner(windowId){
    if(!alive()||!validateMapsState(state,ctx.profile))return null;
    const window=ctx.getWindow(windowId),view=ctx.getView(windowId),session=mapsWindow(state,windowId);
    if(!window||!view||!session||ctx.available(window)!==true||view.available()!==true)return null;
    const original=snapshot();
    const guard=()=>original()&&ctx.getWindow(windowId)===window&&ctx.getView(windowId)===view&&ctx.available(window)===true&&view.available()===true&&mapsWindow(state,windowId)===session;
    return {window,view,session,guard};
  }
  async function commit(lease,change,target){if(!lease.guard())return stale();const next=copyCanonicalData(state),win=mapsWindow(next,target.windowId),result=change(next,win);if(result?.status==='rejected')return result;if(!validateMapsState(next,ctx.profile))return reject('invalid_arguments','The change violates map bounds, references or route semantics.');const delta=mapsTextUnits(next)-mapsTextUnits(state);if(ctx.canCommit?.(delta)!==true)return reject('limit_exceeded','The complete scene text budget would be exceeded.');if(!lease.guard())return stale();applyCanonicalData(state,next);sequence++;await ctx.tick?.();return {status:'applied',target,...result,presentationAvailable:alive()&&ctx.getWindow(target.windowId)===lease.window&&ctx.getView(target.windowId)===lease.view&&ctx.available(lease.window)===true&&lease.view.available()===true};}
  const now=()=>{const value=ctx.getSceneTime?.()??0;return Number.isSafeInteger(value)&&value>=0&&value<8640000000000000?value:0;};
  function newId(next,prefix){if(next.nextId>=Number.MAX_SAFE_INTEGER)return null;let id;do{id=`${prefix}-${next.nextId++}`;}while([...next.places,...next.recents,...next.roads,...next.nodes,...next.areas].some(r=>r.id===id)&&next.nextId<Number.MAX_SAFE_INTEGER);return id;}
  const resetRoute=(next,win)=>{const routes=mapRoutes(next,win);win.routeKey=routes[0]?.key??null;win.step=0;return routes;};
  const handlers={};
  for(const [suffix,schema]of Object.entries(commands))handlers[`maps.${suffix}`]=async(rawTarget,rawPayload={})=>{
    if(!mapsSchemaValid(rawTarget,targetSchema)||!mapsSchemaValid(rawPayload,schema))return invalid();const target=copyCanonicalData(rawTarget),payload=copyCanonicalData(rawPayload),lease=owner(target.windowId);if(!lease)return stale();const session=lease.session;
    if(suffix==='search')return commit(lease,(_,w)=>{w.query=payload.query;w.panel='none';},target);
    if(suffix==='select'&&payload.placeId===null)return commit(lease,(_,w)=>{w.selectedId=null;},target);
    if(suffix==='select'){const place=mapPlace(state,payload.placeId);if(!place||payload.placeId==='current-location')return reject('not_found','The actual authored place is missing.');return commit(lease,(n,w)=>{w.selectedId=place.id;w.center={x:place.x,y:place.y};const old=n.recents.find(r=>r.placeId===place.id);if(old){old.time=now();n.recents=n.recents.filter(r=>r!==old);n.recents.unshift(old);}else{const id=newId(n,'map-recent');if(!id)return reject('limit_exceeded','Map identity bound reached.');n.recents.unshift({id,placeId:place.id,time:now()});}n.recents=n.recents.slice(0,64);},target);}
    if(suffix==='pan')return commit(lease,(_,w)=>{w.center={x:payload.x,y:payload.y};},target);
    if(suffix==='zoom')return commit(lease,(_,w)=>{w.zoom=payload.zoom;},target);
    if(suffix==='mode')return commit(lease,(_,w)=>{w.mode=payload.mode;},target);
    if(suffix==='overlay')return commit(lease,(n,w)=>{w.overlay=payload.overlay;resetRoute(n,w);},target);
    if(suffix==='location')return commit(lease,(_,w)=>{w.center={x:state.location.x,y:state.location.y};w.zoom=Math.max(2,w.zoom);},target);
    if(suffix==='panel')return commit(lease,(_,w)=>{w.panel=payload.panel;},target);
    if(suffix==='pin.add')return commit(lease,(n,w)=>{if(n.places.length>=256)return reject('limit_exceeded','Map place limit reached.');const id=newId(n,'map-pin');if(!id)return reject('limit_exceeded','Map identity bound reached.');const node=n.nodes.reduce((best,p)=>Math.hypot(p.x-payload.x,p.y-payload.y)<Math.hypot(best.x-payload.x,best.y-payload.y)?p:best);n.places.push({id,name:payload.name,category:'pin',address:'Dropped pin · authored local coordinates',description:'User pin on the fictional bundled map. Routes begin at the nearest road junction.',nodeId:node.id,x:payload.x,y:payload.y,user:true});w.selectedId=id;return {placeId:id};},target);
    if(suffix==='pin.remove')return commit(lease,(n)=>{const place=mapPlace(n,payload.placeId);if(!place?.user)return reject('disabled','Only user-dropped pins can be removed.');n.places=n.places.filter(p=>p.id!==place.id);n.favorites=n.favorites.filter(id=>id!==place.id);n.recents=n.recents.filter(r=>r.placeId!==place.id);for(const w of n.windows){if(w.selectedId===place.id)w.selectedId=null;if(w.fromId===place.id)w.fromId=null;if(w.toId===place.id)w.toId=null;resetRoute(n,w);}},target);
    if(suffix==='favorite.set')return commit(lease,n=>{if(!n.places.some(p=>p.id===payload.placeId))return reject('not_found','The source place is missing.');n.favorites=n.favorites.filter(id=>id!==payload.placeId);if(payload.enabled)n.favorites.push(payload.placeId);},target);
    if(suffix==='recents.clear')return commit(lease,n=>{n.recents=[];},target);
    if(suffix==='directions'){if(!mapPlace(state,payload.fromId)||!mapPlace(state,payload.toId))return reject('not_found','Choose actual authored places or current location.');return commit(lease,(n,w)=>{w.fromId=payload.fromId;w.toId=payload.toId;w.transport=payload.transport;w.panel='directions';const routes=resetRoute(n,w);w.status=routes.length?'':payload.fromId===payload.toId?'You are already at this destination.':'No connected local route for this transport and preferences.';},target);}
    if(suffix==='route.select')return commit(lease,(n,w)=>{if(!mapRoutes(n,w).some(r=>r.key===payload.routeKey))return reject('not_found','The requested route is not in the current genuine graph choices.');w.routeKey=payload.routeKey;w.step=0;},target);
    if(suffix==='step.select')return commit(lease,(n,w)=>{const route=mapRoutes(n,w).find(r=>r.key===w.routeKey),step=route?.steps[payload.step];if(!step)return reject('not_found','The actual route step is missing.');w.step=payload.step;const node=n.nodes.find(v=>v.id===step.nodeId);w.center={x:node.x,y:node.y};w.zoom=Math.max(2,w.zoom);},target);
    if(suffix==='preferences.set')return commit(lease,n=>{n.preferences=payload.preferences;for(const w of n.windows)resetRoute(n,w);},target);
    if(suffix==='print'||suffix==='share'){
      const endpoint=suffix==='print'?'printDocument':'share';
      if(typeof ctx[endpoint]!=='function')return reject('unavailable','The actual shared document destination is required.');
      const source=mapDocument(state,session);let doc;
      if(suffix==='print'&&session.routeKey)doc={mime:'text/plain',content:source.text};
      else{
        if(typeof lease.view.renderDocument!=='function')return reject('unavailable','The actual native map rasterizer is required.');
        try{doc=await lease.view.renderDocument(source,lease.guard);}catch(cause){return lease.guard()?reject('unsupported_content',cause.message??'The actual local map could not be rasterized.'):stale();}
        if(!lease.guard())return stale();
        if(!doc||doc.mime!=='image/png'||typeof doc.content!=='string'||doc.content.length>1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(doc.content))return reject('unsupported_content','The actual map rasterizer returned no bounded genuine PNG.');
      }
      const result=await ctx[endpoint]({...source,...doc,appId:'maps',documentId:session.routeKey??session.selectedId??'map-local'}, {windowId:target.windowId,guard:lease.guard});
      if(!lease.guard())return stale();
      return result?.status==='applied'?{...result,target}:result?.status==='rejected'?result:reject('unavailable','The real shared destination did not open.');
    }
    if(suffix==='menu.open'||suffix==='menu.close'){const method=suffix==='menu.open'?'openMenu':'closeMenu';const result=await lease.view[method]?.(payload.menuId,lease.guard);return result===true&&lease.guard()?{status:'applied',target}:stale();}
    if(suffix==='focus'){ctx.focusWindow?.(target.windowId);const result=await lease.view.focus?.(payload.controlId,lease.guard);return result===true&&lease.guard()?{status:'applied',target}:reject('unavailable','The actual visible enabled control is unavailable.');}
    if(suffix==='scroll'){const offsets=await lease.view.scroll?.(payload.areaId,payload,lease.guard);return offsets&&lease.guard()?{status:'applied',target,offsets}:reject('unavailable','The actual mounted scroll area is unavailable.');}
    return reject('unavailable','No local map operation dispatched.');
  };
  function windowOpened(window){
    if(!alive()||!mapsSchemaValid(window?.id,mapsId)||!validateMapsState(state,ctx.profile))return false;
    const actual=ctx.getWindow(window.id);
    if(actual&&actual!==window)return false;
    if(mapsWindow(state,window.id))return true;
    if(state.windows.length>=32)return false;
    const original=snapshot(),next=copyCanonicalData(state);
    next.windows.push(createMapsWindow(next,window.id));
    if(!validateMapsState(next,ctx.profile)||ctx.canCommit?.(mapsTextUnits(next)-mapsTextUnits(state))!==true||!original()||ctx.getWindow(window.id)!==actual)return false;
    applyCanonicalData(state,next);sequence++;return true;
  }
  function windowClosed(window){const id=typeof window==='string'?window:window?.id;if(!alive()||typeof window==='object'&&ctx.getWindow(id)!==window)return false;const index=state.windows.findIndex(w=>w.windowId===id);if(index<0)return false;state.windows.splice(index,1);sequence++;return true;}
  return {handlers,targets:()=>alive()?state.windows.filter(w=>{const win=ctx.getWindow(w.windowId),view=ctx.getView(w.windowId);return win&&view&&ctx.available(win)===true&&view.available()===true;}).map(w=>({windowId:w.windowId})):[],windowOpened,windowClosed,appQuit:()=>{if(!alive())return false;state.windows.splice(0);sequence++;return true;},dispose:()=>{disposed=true;sequence++;}};
}
export function mapsMenuProvider({state,profile,windowId,menuId}) {
  const w=mapsWindow(state,windowId),classic=/high-sierra|mojave/u.test(profile?.id??''),request=(name,payload={})=>({command:`maps.${name}`,target:{windowId},payload}),row=(id,label,name,payload={},enabled=!!w,extra={})=>({id,label,enabled,...enabled?{request:request(name,payload)}:{},...extra});
  if(menuId==='maps')return [row('about','About Maps','panel',{panel:'help'}),row('preferences',classic?'Driving Options… · local panel':'Settings…','panel',{panel:'preferences'})];
  if(menuId==='file')return [row('directions','Get Directions','panel',{panel:'directions'}),row('pin','Drop Pin at Map Center','pin.add',{...w?.center,name:'Dropped Pin'}),row('print','Print…','print'),row('share','Share…','share')];
  if(menuId==='edit')return [row('favorite',state.favorites.includes(w?.selectedId)?'Remove from Favorites':'Add to Favorites','favorite.set',{placeId:w?.selectedId??'',enabled:!state.favorites.includes(w?.selectedId)},!!w?.selectedId),row('remove','Remove Pin','pin.remove',{placeId:w?.selectedId??''},!!mapPlace(state,w?.selectedId)?.user),row('clear','Clear Recents','recents.clear',{},state.recents.length>0)];
  if(menuId==='view')return [...['map','satellite'].map(mode=>row(mode,mode==='map'?'Map':'Satellite · authored terrain','mode',{mode},!!w,{checked:w?.mode===mode})),...['none','traffic','transit'].map(overlay=>row(overlay,overlay==='none'?'Hide Overlays':`Show ${overlay[0].toUpperCase()+overlay.slice(1)} · local data`,'overlay',{overlay},!!w,{checked:w?.overlay===overlay})),...['miles','kilometers'].map(distance=>row(distance,`Distances — In ${distance==='miles'?'Miles':'Kilometers'}`,'preferences.set',{preferences:{...state.preferences,distance}},!!w,{checked:state.preferences.distance===distance})),row('location','Go to Current Location','location'),row('zoom-in','Zoom In','zoom',{zoom:Math.min(8,(w?.zoom??1)+.5)}),row('zoom-out','Zoom Out','zoom',{zoom:Math.max(1,(w?.zoom??1)-.5)})];
  if(menuId==='window')return [row('favorites','Favorites','panel',{panel:'favorites'}),row('recents','Recents','panel',{panel:'recents'})];
  if(menuId==='help')return [row('help','Maps Help','panel',{panel:'help'})];return [];
}

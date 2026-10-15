import { object } from './command-schema.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { newsCommandPayloads, newsWindowTarget } from './news-catalog.js';
import { newsSchemaValid, newsIdSchema, validateNewsState, newsWindow, newsStory, newsCapabilities, newsSectionValid, createNewsWindow, newsGraphLease, commitNewsCandidate, newsReject, newsFeedProjection } from './news-state.js';
const stockStorySchema=object({id:newsIdSchema,title:{type:'string',minLength:1,maxLength:512},publisher:{type:'string',minLength:1,maxLength:256},author:{type:'string',minLength:1,maxLength:256},symbolIds:{type:'array',items:newsIdSchema,maxItems:64},publishedAt:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1},paragraphs:{type:'array',items:{type:'string',minLength:1,maxLength:8192},minItems:1,maxItems:64},revision:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1}});
export function createNewsCommands(state,ctx) {
  let retired=false,generation=0;
  const stateCurrent=()=>!retired&&(!ctx.getState||ctx.getState()===state)&&ctx.alive?.()===true&&validateNewsState(state,ctx.profile).ok;
  const now=()=>{const value=ctx.getSceneTime?.();return Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER?value:null;};
  const stale=()=>newsReject('stale_target','The original News source, window, view, scene time or graph changed.');
  function sourceLease(ownership={}) {
    const graph=newsGraphLease(state),token=generation,time=now();
    return ()=>stateCurrent()&&token===generation&&graph()&&now()===time&&time!==null&&(typeof ownership==='function'?ownership():ownership.guard?.())===true;
  }
  function owner(windowId) {
    if(!stateCurrent())return null;
    const window=ctx.getWindow(windowId),view=ctx.getView(windowId),session=newsWindow(state,windowId);
    if(!window||window.appId!=='news'||!view||!session||ctx.available(window)!==true||view.available()!==true)return null;
    const guard=sourceLease({guard:()=>ctx.getWindow(windowId)===window&&ctx.getView(windowId)===view&&newsWindow(state,windowId)===session&&window.appId==='news'&&ctx.available(window)===true&&view.available()===true});
    return {window,view,session,guard};
  }
  const transact=(mutate,guard)=>commitNewsCandidate(state,mutate,{profile:ctx.profile,guard,canCommit:ctx.canCommit});
  async function settle(result,lease,target) {
    if(result.status!=='applied')return result;
    generation++;
    await ctx.tick?.();
    return {...result,target,presentationAvailable:stateCurrent()&&ctx.getWindow(target.windowId)===lease.window&&ctx.getView(target.windowId)===lease.view&&ctx.available(lease.window)===true&&lease.view.available()===true};
  }
  function openStory(candidate,windowId,storyId,time) {
    const row=newsStory(candidate,storyId),session=newsWindow(candidate,windowId);
    if(!row||!session||!row.regions.includes(candidate.preferences.region)||candidate.preferences.restrictExplicit&&row.explicit)return newsReject('unavailable','This story is not available in the selected local region.');
    session.storyId=storyId;session.query='';session.sheet=null;session.menu=null;
    candidate.history=candidate.history.filter(item=>item.id!==storyId);candidate.history.unshift({id:storyId,readAt:time});
    if(!candidate.recommendations.includes(storyId))candidate.recommendations.push(storyId);
    return {storyId};
  }
  const handlers=Object.fromEntries(Object.entries(newsCommandPayloads).map(([name,schema])=>[name,async(target,payload={})=>{
    if(!newsSchemaValid(target,newsWindowTarget)||!newsSchemaValid(payload,schema))return newsReject('invalid_arguments','Use the closed News target and payload.');
    const lease=owner(target.windowId);if(!lease||!lease.guard())return stale();
    const originalMenu=lease.session.menu;
    const story=payload.storyId?newsStory(state,payload.storyId):null;
    if(payload.storyId&&(!story||!story.regions.includes(state.preferences.region)||state.preferences.restrictExplicit&&story.explicit))return newsReject('unavailable','The selected original regional story is unavailable.');
    if(name==='news.story.share') {
      if(typeof ctx.share!=='function')return newsReject('unavailable','The actual native Share destination is unavailable.');
      const result=await ctx.share({title:story.title,mime:'text/plain',content:[story.title,state.channels.find(row=>row.id===story.channelId).name,`By ${story.author}`,...story.paragraphs].join('\n\n'),source:{appId:'news',windowId:target.windowId,documentId:story.id}}, {guard:lease.guard,windowId:target.windowId});
      if(result?.status==='applied')return {...result,target,presentationAvailable:stateCurrent()&&ctx.getView(target.windowId)===lease.view&&lease.view.available()===true};
      if(!lease.guard())return stale();return result?.status==='rejected'?result:newsReject('unavailable','The real Share sheet did not acknowledge a destination.');
    }
    if(name==='news.story.notify') {
      if(!state.preferences.notificationsEnabled)return newsReject('unavailable','Local News notifications are disabled in preferences.');
      if(typeof ctx.notify!=='function'||typeof ctx.planNotification!=='function')return newsReject('unavailable','The actual shared native notification allocation/transaction bridge is unavailable.');
      const plan=ctx.planNotification({guard:lease.guard,windowId:target.windowId});
      if(!plan||!newsSchemaValid(plan.notificationId,newsIdSchema)||typeof plan.current!=='function'||plan.current()!==true||!lease.guard())return stale();
      const notificationGuard=()=>lease.guard()&&plan.current()===true;
      let committed=null,called=false;
      const deliveredAt=now(),auditId=`news-delivery-${state.notifications.length}`;
      const prepared=copyCanonicalData(state);prepared.notifications.push({id:auditId,storyId:story.id,notificationId:plan.notificationId,deliveredAt,active:true});
      if(!validateNewsState(prepared,ctx.profile).ok)return newsReject('quota_exceeded','News alert retention is full.');
      const result=ctx.notify({id:auditId,appId:'news',title:story.title,body:story.summary.slice(0,512),source:{kind:'news-story',recordId:story.id,windowId:target.windowId},actions:['open'],reserveTextUnits:canonicalStringUnits(prepared)-canonicalStringUnits(state),onCommit:notificationId=>{
        if(called||notificationId!==plan.notificationId||!notificationGuard())return false;called=true;
        committed=transact(candidate=>{candidate.notifications.push({id:auditId,storyId:story.id,notificationId,deliveredAt,active:true});return {storyId:story.id,notificationId};},notificationGuard);
        return committed.status==='applied';
      }},{guard:notificationGuard,windowId:target.windowId});
      if(result?.then)return newsReject('unavailable','News notifications require a synchronous atomic bridge.');
      if(result?.status==='applied'&&committed?.status==='applied')return settle(committed,lease,target);
      return result?.status==='rejected'?result:committed??newsReject('unavailable','No actual notification/domain transaction committed.');
    }
    if(name.startsWith('news.native.')) {
      const method={'news.native.focus':'focus','news.native.selection':'selection','news.native.scroll':'scroll'}[name];
      if(typeof lease.view[method]!=='function')return newsReject('unavailable','The actual native control facade is unavailable.');
      const result=await lease.view[method](payload,lease.guard);
      return result?.status==='applied'?{...result,target}:result?.status==='rejected'?result:newsReject('unavailable','The native facade did not acknowledge the real control.');
    }
    if(name==='news.window.close') {
      if(typeof ctx.closeWindow!=='function')return newsReject('unavailable','The original native window close bridge is unavailable.');
      const result=await ctx.closeWindow(target.windowId,{guard:lease.guard,windowId:target.windowId});return result?.status==='applied'?{...result,target}:result??newsReject('unavailable','Native window close unavailable.');
    }
    const result=transact(candidate=>{
      const session=newsWindow(candidate,target.windowId);
      if(name==='news.navigate'){if(!newsSectionValid(candidate,payload.section))return newsReject('invalid_arguments','Unknown actual News section.');session.section=payload.section;session.storyId=null;session.query='';}
      if(name==='news.search'){session.query=payload.query;session.section='search';session.storyId=null;}
      if(name==='news.story.open')return openStory(candidate,target.windowId,payload.storyId,now());
      if(name==='news.story.close')session.storyId=null;
      if(name==='news.follow'){
        const source=payload.kind==='channel'?candidate.channels:candidate.topics,rows=payload.kind==='channel'?candidate.followingChannels:candidate.followingTopics;
        if(!source.some(row=>row.id===payload.id))return newsReject('stale_target','The original channel or topic is absent.');
        if(payload.following&&!rows.includes(payload.id))rows.push(payload.id);if(!payload.following&&rows.includes(payload.id))rows.splice(rows.indexOf(payload.id),1);
      }
      if(name==='news.story.save'){if(payload.saved&&!candidate.saved.includes(payload.storyId))candidate.saved.push(payload.storyId);if(!payload.saved&&candidate.saved.includes(payload.storyId))candidate.saved.splice(candidate.saved.indexOf(payload.storyId),1);return {storyId:payload.storyId,saved:payload.saved};}
      if(name==='news.history.clear'){if(payload.scope!=='recommendations')candidate.history=[];if(payload.scope!=='history')candidate.recommendations=[];session.sheet=null;}
      if(name==='news.preferences.set'){Object.assign(candidate.preferences,payload.values);for(const window of candidate.windows)if(window.storyId&&!newsStory(candidate,window.storyId).regions.includes(candidate.preferences.region))window.storyId=null;}
      if(name==='news.sidebar.set')session.sidebar=payload.visible;
      if(name==='news.sheet.open'){session.sheet=payload.sheet;session.menu=null;}
      if(name==='news.sheet.close')session.sheet=null;
      if(name==='news.menu.open')session.menu=payload.menuId;
      if(name==='news.menu.close')session.menu=null;
    },lease.guard);
    const settled=await settle(result,lease,target);
    if(settled.status==='applied'&&settled.presentationAvailable&&name==='news.menu.close'&&payload.restoreFocus&&typeof lease.view.focus==='function')await lease.view.focus({controlId:`menu:${originalMenu??'news'}`},()=>stateCurrent()&&ctx.getView(target.windowId)===lease.view);
    return settled;
  }]));
  function stage(mutate,ownership) {
    if(!stateCurrent())return null;
    const current=sourceLease(ownership);if(!current())return null;
    const candidate=copyCanonicalData(state),result=mutate(candidate);if(result?.status==='rejected'||!validateNewsState(candidate,ctx.profile).ok)return null;
    const delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);let used=false;
    return {current:()=>!used&&current(),delta,...result,commit:()=>{
      if(used||!current()||typeof ctx.canCommit!=='function'||ctx.canCommit(delta)!==true||!current())return false;
      used=true;applyCanonicalData(state,candidate);generation++;return true;
    }};
  }
  return {handlers,
    targets:()=>stateCurrent()?state.windows.filter(session=>owner(session.windowId)).map(session=>({windowId:session.windowId})):[],
    windowOpened(window,options={}) {
      if(!stateCurrent()||!window||window.appId!=='news'||ctx.getWindow(window.id)!==window)return false;
      if(newsWindow(state,window.id))return typeof options.isCurrent!=='function'||options.isCurrent()===true;
      const guard=sourceLease({guard:()=>ctx.getWindow(window.id)===window&&window.appId==='news'&&(!options.isCurrent||options.isCurrent()===true)});
      const result=transact(candidate=>{candidate.windows.push(createNewsWindow(window.id));},guard);if(result.status==='applied')generation++;return result.status==='applied';
    },
    windowClosed(original) {
      const id=typeof original==='string'?original:original?.id;if(!stateCurrent()||!newsWindow(state,id))return true;
      if(typeof original==='object'&&ctx.getWindow(id)&&ctx.getWindow(id)!==original)return false;
      const originalWindow=ctx.getWindow(id);
      const guard=sourceLease({guard:()=>ctx.getWindow(id)===originalWindow});
      const result=transact(candidate=>{candidate.windows=candidate.windows.filter(row=>row.windowId!==id);},guard);if(result.status==='applied')generation++;return result.status==='applied';
    },
    appQuit(appId){
      if(appId!=='news')return true;if(!stateCurrent())return false;
      const originals=state.windows.map(row=>({id:row.windowId,window:ctx.getWindow(row.windowId),view:ctx.getView(row.windowId)}));
      const guard=sourceLease({guard:()=>originals.every(row=>ctx.getWindow(row.id)===row.window&&ctx.getView(row.id)===row.view)});
      const result=transact(candidate=>{candidate.windows=[];},guard);if(result.status==='applied')generation++;return result.status==='applied';
    },
    dispose(){retired=true;generation++;},
    feedProjection:options=>newsFeedProjection(state,options),
    getStory:recordId=>stateCurrent()?newsStory(state,recordId):null,
    prepareNotificationDismissals(actualIDs,ownership) {
      if(!Array.isArray(actualIDs)||actualIDs.some(id=>!newsSchemaValid(id,newsIdSchema)))return null;
      return stage(candidate=>{for(const row of candidate.notifications)if(actualIDs.includes(row.notificationId))row.active=false;},ownership);
    },
    prepareNotificationOpen(kind,recordId,ownership) {
      const lease=owner(ownership?.windowId);
      if(kind!=='news-story'||!newsStory(state,recordId)||!lease)return null;
      const externalGuard=typeof ownership==='function'?ownership:ownership?.guard;
      return stage(candidate=>{const result=openStory(candidate,ownership.windowId,recordId,now());return result.status==='rejected'?result:{recordId,storyId:recordId};},{guard:()=>lease.guard()&&externalGuard?.()===true,windowId:ownership.windowId});
    },
    saveExternalStory(actualStory,ownership) {
      if(!stateCurrent()||!newsSchemaValid(actualStory,stockStorySchema))return newsReject('invalid_arguments','Use the actual closed authored Stocks story.');
      const originalParagraphs=actualStory.paragraphs,signature=JSON.stringify(actualStory),externalGuard=typeof ownership==='function'?ownership:ownership?.guard;
      const guard=sourceLease({guard:()=>externalGuard?.()===true&&actualStory.paragraphs===originalParagraphs&&JSON.stringify(actualStory)===signature});
      const result=transact(candidate=>{
        let story=newsStory(candidate,actualStory.id);
        if(story){if(story.title!==actualStory.title||story.author!==actualStory.author||JSON.stringify(story.paragraphs)!==JSON.stringify(actualStory.paragraphs))return newsReject('identity_collision','An unrelated original News story already owns this ID.');}
        else {
          let channel=candidate.channels.find(row=>row.name===actualStory.publisher);
          if(!channel){const channelId=`stocks-publisher-${candidate.channels.length}`;if(candidate.channels.some(row=>row.id===channelId))return newsReject('identity_collision','Publisher ID collision.');channel={id:channelId,name:actualStory.publisher,regions:['US','UK','AU','CA'],color:'#485e73'};candidate.channels.push(channel);}
          story={id:actualStory.id,channelId:channel.id,regions:['US','UK','AU','CA'],topicIds:['business'],title:actualStory.title,summary:actualStory.paragraphs[0],paragraphs:[...actualStory.paragraphs],author:actualStory.author,publishedAt:actualStory.publishedAt,revision:actualStory.revision,explicit:false};candidate.articles.push(story);
        }
        if(!candidate.saved.includes(story.id))candidate.saved.push(story.id);return {storyId:story.id,saved:true};
      },guard);if(result.status==='applied')generation++;return result;
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsState, NEWS_PROFILES, newsStory, newsWindow, newsVisibleStories, newsFeedProjection, newsCapabilities, validateNewsState, commitNewsCandidate } from '../frontend/src/news-state.js';
import { createNewsCommands } from '../frontend/src/news-commands.js';
function fixture(profile=NEWS_PROFILES[2]) {
  const state=createNewsState(profile,{sceneTime:1800000000000}),window={id:'news-native',appId:'news'},view={available:()=>true};
  const windows=new Map([[window.id,window]]),views=new Map([[window.id,view]]);let time=1800000000000;
  const ctx={profile:{id:profile},getState:()=>state,getSceneTime:()=>time,alive:()=>true,available:()=>true,getWindow:id=>windows.get(id),getView:id=>views.get(id),canCommit:()=>true,tick:async()=>{}};
  ctx.planNotification=ownership=>({notificationId:'notification-actual',current:()=>ownership.guard()===true});
  const controller=createNewsCommands(state,ctx);assert.equal(controller.windowOpened(window),true);
  return {state,window,view,windows,views,ctx,controller,setTime:value=>{time=value;},run:(name,payload={})=>controller.handlers[name]({windowId:window.id},payload)};
}
for(const profile of NEWS_PROFILES) {
  test(`${profile}: reader, search, saved and history are one canonical consumer flow`,async()=>{
    const f=fixture(profile),originalArticles=f.state.articles,originalStory=newsStory(f.state,'us-library');
    assert.equal((await f.run('news.search',{query:'Electrical appliances'})).status,'applied');assert.deepEqual(newsVisibleStories(f.state,newsWindow(f.state,f.window.id)).map(row=>row.id),['us-library']);
    await f.run('news.story.open',{storyId:'us-library'});assert.equal(newsWindow(f.state,f.window.id).storyId,'us-library');assert.equal(f.state.history[0].id,'us-library');assert.equal(f.state.history[0].readAt,1800000000000);
    await f.run('news.story.save',{storyId:'us-library',saved:true});await f.run('news.navigate',{section:'saved'});assert.deepEqual(newsVisibleStories(f.state,newsWindow(f.state,f.window.id)).map(row=>row.id),['us-library']);
    await f.run('news.history.clear',{scope:'all'});assert.deepEqual(f.state.history,[]);assert.deepEqual(f.state.saved,['us-library']);assert.equal(f.state.articles,originalArticles);assert.equal(newsStory(f.state,'us-library'),originalStory);assert.equal(validateNewsState(f.state,profile).ok,true);
  });
}
test('region changes preserve saved originals but do not leak another region into feed or reader',async()=>{
  const f=fixture();await f.run('news.story.open',{storyId:'us-library'});await f.run('news.story.save',{storyId:'us-library',saved:true});
  await f.run('news.preferences.set',{values:{region:'AU'}});assert.equal(newsWindow(f.state,f.window.id).storyId,null);assert.deepEqual(f.state.saved,['us-library']);
  assert.equal(newsVisibleStories(f.state).some(row=>row.id==='us-library'),false);assert.equal(newsVisibleStories(f.state).some(row=>row.id==='au-shade'),true);
  assert.equal((await f.run('news.story.open',{storyId:'uk-market'})).status,'rejected');
  assert.equal(newsCapabilities(NEWS_PROFILES[1],'CA').native,false);assert.equal(newsCapabilities(NEWS_PROFILES[1],'AU').native,true);assert.equal(newsCapabilities(NEWS_PROFILES[0],'US').native,false);assert.equal(newsCapabilities(NEWS_PROFILES[4],'US').native,false);
});
test('following and unfollowing controls restricted Today, not a separate widget store',async()=>{
  const f=fixture();await f.run('news.preferences.set',{values:{restrictToday:true}});assert.equal(newsVisibleStories(f.state).every(row=>row.channelId==='field-notes'),true);
  await f.run('news.follow',{kind:'channel',id:'harbor-ledger',following:true});assert.equal(newsFeedProjection(f.state).some(row=>row.id==='us-library'),true);
  await f.run('news.follow',{kind:'channel',id:'harbor-ledger',following:false});assert.equal(newsFeedProjection(f.state).some(row=>row.id==='us-library'),false);
  const projection=newsFeedProjection(f.state);assert.throws(()=>{projection[0].title='Replaced';},TypeError);assert.notEqual(newsStory(f.state,projection[0].id).title,'Replaced');
});
test('whole-scene rejection prevents saving, preferences and history growth',async()=>{
  const f=fixture(),before=structuredClone(f.state);f.ctx.canCommit=()=>false;
  assert.equal((await f.run('news.story.save',{storyId:'us-library',saved:true})).status,'rejected');assert.equal((await f.run('news.story.open',{storyId:'us-library'})).status,'rejected');assert.equal((await f.run('news.preferences.set',{values:{region:'UK'}})).status,'rejected');assert.deepEqual(f.state,before);
});
test('reentrant scene quota cannot borrow same-ID copied source or changed time',async()=>{
  for(const change of ['story','window','view','time']){
    const f=fixture();f.ctx.canCommit=()=>{if(change==='story')f.state.articles[0]={...f.state.articles[0]};if(change==='window')f.windows.set(f.window.id,{...f.window});if(change==='view')f.views.set(f.window.id,{...f.view});if(change==='time')f.setTime(1800000000001);return true;};
    assert.equal((await f.run('news.story.save',{storyId:'us-library',saved:true})).status,'rejected');assert.deepEqual(f.state.saved,[]);
  }
});
test('closed state rejects dangling saved identity and unknown session fields',()=>{
  const f=fixture();f.state.saved.push('missing-story');assert.equal(validateNewsState(f.state).ok,false);f.state.saved=[];newsWindow(f.state,f.window.id).shadowFeed=[];assert.equal(validateNewsState(f.state).ok,false);
});
test('retirement during DOM flush cannot turn committed save into a rejection',async()=>{
  const f=fixture();f.ctx.tick=async()=>{f.views.delete(f.window.id);};const result=await f.run('news.story.save',{storyId:'us-library',saved:true});assert.equal(result.status,'applied');assert.equal(result.presentationAvailable,false);assert.equal(result.storyId,'us-library');assert.deepEqual(f.state.saved,['us-library']);
});
test('share sends complete authored article bytes and original descriptor to a guarded destination',async()=>{
  const f=fixture(),story=newsStory(f.state,'us-library');let packet;
  f.ctx.share=async(spec,owner)=>{assert.equal(owner.guard(),true);packet=spec;return {status:'applied',destinationId:'actual-draft'};};
  const result=await f.run('news.story.share',{storyId:story.id});assert.equal(result.destinationId,'actual-draft');assert.deepEqual(packet.source,{appId:'news',windowId:f.window.id,documentId:story.id});for(const paragraph of story.paragraphs)assert.equal(packet.content.includes(paragraph),true);
  delete f.ctx.share;assert.equal((await f.run('news.story.share',{storyId:story.id})).status,'rejected');
});
test('a quota preflight replacing nested article arrays rejects without overwriting the replacement',()=>{
  const f=fixture();let replacement;
  const result=commitNewsCandidate(f.state,candidate=>{candidate.saved.push('us-library');},{guard:()=>true,profile:f.ctx.profile,canCommit:()=>{replacement=[...f.state.articles[0].paragraphs];f.state.articles[0].paragraphs=replacement;return true;}});
  assert.equal(result.status,'rejected');assert.equal(f.state.articles[0].paragraphs,replacement);assert.deepEqual(f.state.saved,[]);
});
test('notification and News delivery audit share one strict synchronous callback',async()=>{
  const f=fixture();let notification=null;
  f.ctx.notify=(spec,owner)=>{assert.equal(owner.guard(),true);assert.deepEqual(spec.source,{kind:'news-story',recordId:'us-library',windowId:f.window.id});assert.equal(spec.onCommit('notification-actual'),true);notification={id:'notification-actual'};return {status:'applied',notificationId:notification.id};};
  const result=await f.run('news.story.notify',{storyId:'us-library'});assert.equal(result.status,'applied');assert.equal(result.notificationId,notification.id);assert.equal(f.state.notifications[0].active,true);
  const stage=f.controller.prepareNotificationDismissals([notification.id],{guard:()=>true,windowId:f.window.id});assert.equal(stage.current(),true);assert.equal(stage.commit(),true);assert.equal(f.state.notifications[0].active,false);assert.equal(f.state.notifications[0].notificationId,notification.id);assert.equal(stage.commit(),false);
});
test('notification source replacement at preflight cannot create an orphan delivery audit',async()=>{
  const f=fixture();let callbackResult;
  f.ctx.notify=(spec)=>{f.state.articles[0]={...f.state.articles[0]};callbackResult=spec.onCommit('notification-stale');return {status:'rejected'};};
  assert.equal((await f.run('news.story.notify',{storyId:'us-library'})).status,'rejected');assert.equal(callbackResult,false);assert.deepEqual(f.state.notifications,[]);
});
test('notification-open preparation binds original mounted target and clears search only at commit',async()=>{
  const f=fixture();await f.run('news.search',{query:'tool'});
  const stage=f.controller.prepareNotificationOpen('news-story','us-library',{guard:()=>true,windowId:f.window.id});assert.equal(newsWindow(f.state,f.window.id).query,'tool');assert.equal(stage.commit(),true);assert.equal(newsWindow(f.state,f.window.id).storyId,'us-library');assert.equal(newsWindow(f.state,f.window.id).query,'');
});
test('Stocks save imports a complete genuine story and collision or stale source never replaces it',()=>{
  const f=fixture(),story={id:'stocks-story',title:'A complete business report',publisher:'Local Business Desk',author:'Morgan Bell',symbolIds:['fictional'],publishedAt:1800000000000,paragraphs:['The fictional co-operative opened a new workshop.','Its members voted to keep all wages unchanged.'],revision:1};
  const result=f.controller.saveExternalStory(story,{guard:()=>true});assert.equal(result.status,'applied');assert.deepEqual(newsStory(f.state,story.id).paragraphs,story.paragraphs);assert.deepEqual(f.state.saved,[story.id]);
  const original=newsStory(f.state,story.id);assert.equal(f.controller.saveExternalStory({...story,title:'Another report'},{guard:()=>true}).status,'rejected');assert.equal(newsStory(f.state,story.id),original);
  const other={...story,id:'stocks-other'};f.ctx.canCommit=()=>{other.paragraphs=[...other.paragraphs];return true;};assert.equal(f.controller.saveExternalStory(other,{guard:()=>true}).status,'rejected');assert.equal(newsStory(f.state,other.id),null);
});
test('notification reservation uses exact planned ID and exact signed News delta at a scene boundary',async()=>{
  const f=fixture(),actualId=`notification-${'x'.repeat(90)}`;
  const { canonicalStringUnits }=await import('../frontend/src/canonical-data.js');
  f.ctx.planNotification=ownership=>({notificationId:actualId,current:()=>ownership.guard()===true});
  let reserved;
  const oldUnits=canonicalStringUnits(f.state);
  f.ctx.notify=(spec,owner)=>{reserved=spec.reserveTextUnits;assert.equal(owner.guard(),true);assert.equal(spec.onCommit(actualId),true);assert.equal(canonicalStringUnits(f.state)-oldUnits,reserved);return {status:'applied',notificationId:actualId};};
  f.ctx.canCommit=delta=>delta===reserved;
  assert.equal((await f.run('news.story.notify',{storyId:'us-library'})).status,'applied');
  assert.equal(f.state.notifications[0].notificationId,actualId);
});
test('notification-open preparation cannot borrow a copied mounted target after quota reentry',()=>{
  const f=fixture(),stage=f.controller.prepareNotificationOpen('news-story','us-library',{guard:()=>true,windowId:f.window.id});
  f.ctx.canCommit=()=>{f.views.set(f.window.id,{...f.view});return true;};
  assert.equal(stage.commit(),false);assert.equal(newsWindow(f.state,f.window.id).storyId,null);assert.deepEqual(f.state.history,[]);
});
test('two original News windows retain independent readers and quit removes sessions but not saved stories',async()=>{
  const f=fixture(),second={id:'news-second',appId:'news'};f.windows.set(second.id,second);f.views.set(second.id,{available:()=>true});assert.equal(f.controller.windowOpened(second),true);
  await f.run('news.story.open',{storyId:'us-library'});await f.controller.handlers['news.story.open']({windowId:second.id},{storyId:'all-stream'});
  assert.equal(newsWindow(f.state,f.window.id).storyId,'us-library');assert.equal(newsWindow(f.state,second.id).storyId,'all-stream');
  await f.run('news.story.save',{storyId:'us-library',saved:true});assert.equal(f.controller.windowClosed(f.window),true);assert.equal(newsWindow(f.state,second.id).storyId,'all-stream');
  assert.equal(f.controller.appQuit('news'),true);assert.deepEqual(f.state.windows,[]);assert.deepEqual(f.state.saved,['us-library']);
});

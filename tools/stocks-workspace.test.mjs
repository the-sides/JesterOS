import test from 'node:test';
import assert from 'node:assert/strict';
import {listOSProfiles} from '../frontend/src/os-profiles.js';
import {canonicalStringUnits,copyCanonicalData} from '../frontend/src/canonical-data.js';
import {createDomainNotificationBridges} from '../frontend/src/notification-commands.js';
import {notificationsDefaults} from '../frontend/src/notification-model.js';
import {createStocksState,stocksQuote,stocksStory,stocksWindow,stocksCurrent,stocksChart,stocksPublicProjection,validateStocksState,commitStocksCandidate} from '../frontend/src/stocks-state.js';
import {createStocksCommands} from '../frontend/src/stocks-commands.js';
function fixture(base){
 const profile={...base,applications:{...base.applications,stocks:base.applications.stocks??{label:'Local Stocks — functional equivalent'}}};let time=Date.parse(profile.defaults.sceneTime),quota=Infinity,pending=0,hook=null;
 const state=createStocksState(profile,{sceneTime:time}),notifications=notificationsDefaults(),window={id:'stocks-window',appId:'stocks'},view={available:()=>true};let currentWindow=window,currentView=view;
 const budget=delta=>{if(hook){const fn=hook;hook=null;fn();}return canonicalStringUnits(state)+canonicalStringUnits(notifications)+pending+delta<=quota;};
 const bridges=createDomainNotificationBridges({profile,getState:()=>notifications,alive:()=>true,getSceneTime:()=>time,canCommit:budget,reserve(delta,commit){pending+=delta;try{return commit();}finally{pending-=delta;}},retainDestination(entry){const kind=entry.destination.kind,record=kind==='stocks-price'?stocksQuote(state,entry.destination.recordId):stocksStory(state,entry.destination.recordId);return record?{current:()=>(kind==='stocks-price'?stocksQuote(state,record.id):stocksStory(state,record.id))===record}:null;}});
 const ctx={profile,getState:()=>state,getWindow:id=>id===window.id?currentWindow:null,getView:id=>id===window.id?currentView:null,available:()=>true,alive:()=>true,getSceneTime:()=>time,canCommit:budget,tick:async()=>{},...bridges};
 const controller=createStocksCommands(state,ctx);assert.equal(controller.windowOpened(window).status,'applied');
 return {profile,state,notifications,ctx,controller,window,run:(name,payload={})=>controller.handlers[`stocks.${name}`]({windowId:window.id},payload),setTime:value=>{time=value;},setQuota:value=>{quota=value;},now:()=>time,reenter:fn=>{hook=fn;},replaceWindow:()=>{currentWindow={...window};},replaceView:()=>{currentView={...view};},total:()=>canonicalStringUnits(state)+canonicalStringUnits(notifications)};
}
for(const profile of listOSProfiles()){
 test(`${profile.id}: quote search, watchlist editing and real range selection retain original securities`,async()=>{
  const f=fixture(profile),q=stocksQuote(f.state,'MESA'),samples=q.samples;
  assert.equal((await f.run('search',{query:'Cooperative'})).status,'applied');assert.equal((await f.run('select',{symbolId:'MESA'})).status,'applied');assert.equal((await f.run('watchlist.add',{symbolId:'MESA'})).status,'applied');
  const order=['MESA','CED','HBR','NTH'];assert.equal((await f.run('watchlist.reorder',{symbolIds:order})).status,'applied');assert.deepEqual(stocksPublicProjection(f.state).quotes.map(q=>q.id),order);
  const day=stocksChart(f.state,q,'1D'),year=stocksChart(f.state,q,'1Y');assert.ok(year.length>day.length);assert.ok(year[0].at<day[0].at);assert.notDeepEqual(year.map(p=>p.price),day.map(p=>p.price));
  assert.equal((await f.run('range',{range:'1Y'})).status,'applied');assert.equal((await f.run('select',{symbolId:'HBR'})).status,'applied');assert.equal(f.state.range,'1Y');assert.equal(stocksQuote(f.state,'MESA'),q);assert.equal(q.samples,samples);
  assert.equal((await f.run('watchlist.remove',{symbolId:'MESA',confirm:true})).status,'applied');assert.ok(!stocksPublicProjection(f.state).quotes.some(row=>row.id==='MESA'));assert.equal(stocksQuote(f.state,'MESA'),q);
 });
 test(`${profile.id}: scene refresh reads the next original tape observation and widgets share the exact quote`,async()=>{
  const f=fixture(profile),q=stocksQuote(f.state,'HBR'),initial=stocksCurrent(f.state,q);
  await f.run('refresh');assert.deepEqual(stocksCurrent(f.state,q),initial);
  f.setTime(f.now()+3600000);assert.equal((await f.run('refresh')).status,'applied');const refreshed=stocksCurrent(f.state,q);assert.equal(refreshed.price,128.6);assert.equal(refreshed.at,initial.at+3600000);assert.deepEqual(stocksPublicProjection(f.state).quotes.find(row=>row.id==='HBR'),refreshed);await f.run('refresh');assert.deepEqual(stocksCurrent(f.state,q),refreshed);
  f.setTime(f.now()-7200000);assert.equal((await f.run('refresh')).status,'rejected');assert.equal(stocksCurrent(f.state,q).price,128.6);
 });
 test(`${profile.id}: original story opens complete reader and shares actual article bytes`,async()=>{
  const f=fixture(profile),story=stocksStory(f.state,'harbor-grid');let delivered;
  f.ctx.share=async(packet,ownership)=>{assert.equal(ownership.guard(),true);delivered=packet;return {status:'applied',destinationId:'actual-local-mail-draft'};};
  assert.equal((await f.run('story.open',{storyId:story.id})).status,'applied');assert.equal(stocksStory(f.state,stocksWindow(f.state,f.window.id).storyId),story);
  assert.equal((await f.run('story.share')).status,'applied');assert.equal(delivered.mime,'text/plain');for(const p of story.paragraphs)assert.ok(delivered.content.includes(p));assert.deepEqual(delivered.source,{appId:'stocks',windowId:f.window.id,documentId:story.id});
 });
 test(`${profile.id}: genuine shared alert atomic allocation, duplicate refusal and watchlist retirement`,async()=>{
  const f=fixture(profile),posted=await f.run('notify',{kind:'stocks-price',recordId:'HBR'});assert.equal(posted.status,'applied');assert.equal(f.notifications.entries.length,1);assert.equal(f.state.alerts[0].notificationId,f.notifications.entries[0].id);assert.equal(posted.notificationId,f.notifications.entries[0].id);
  assert.equal((await f.run('notify',{kind:'stocks-price',recordId:'HBR'})).status,'rejected');assert.equal(f.notifications.entries.length,1);
  assert.equal((await f.run('watchlist.remove',{symbolId:'HBR',confirm:true})).status,'applied');assert.equal(f.state.alerts[0].active,false);assert.equal(f.notifications.entries.length,0);assert.equal(validateStocksState(f.state,profile).ok,true);
 });
}
test('exact full-scene notification quota succeeds at actual growth and rejects one unit below atomically',async()=>{
 const profile=listOSProfiles().find(p=>p.id==='macos-mojave-10.14'),probe=fixture(profile),before=probe.total();assert.equal((await probe.run('notify',{kind:'stocks-story',recordId:'harbor-grid'})).status,'applied');const growth=probe.total()-before;
 const fits=fixture(profile);fits.setQuota(fits.total()+growth);assert.equal((await fits.run('notify',{kind:'stocks-story',recordId:'harbor-grid'})).status,'applied');
 const blocked=fixture(profile),snapshot=JSON.stringify(blocked.state);blocked.setQuota(blocked.total()+growth-1);assert.equal((await blocked.run('notify',{kind:'stocks-story',recordId:'harbor-grid'})).status,'rejected');assert.equal(JSON.stringify(blocked.state),snapshot);assert.equal(blocked.notifications.entries.length,0);
});
test('equal-value record, native window, view and authored time replacements cannot commit through preflight',async()=>{
 const profile=listOSProfiles()[0];
 for(const replace of [f=>{f.state.quotes[0]=copyCanonicalData(f.state.quotes[0]);},f=>f.replaceWindow(),f=>f.replaceView(),f=>f.setTime(f.now()+1)]){
  const f=fixture(profile),original=f.state.watchlist;f.reenter(()=>replace(f));assert.equal((await f.run('watchlist.add',{symbolId:'MESA'})).status,'rejected');assert.equal(f.state.watchlist,original);assert.ok(!original.includes('MESA'));
 }
});
test('staged actual destination open clears only selection/search and refuses original-source substitution',async()=>{
 const f=fixture(listOSProfiles()[1]);await f.run('search',{query:'Northline'});const saved=[...f.state.watchlist],plan=f.controller.prepareNotificationOpen('stocks-story','harbor-grid',{guard:()=>true,windowId:f.window.id});assert.equal(plan.current(),true);assert.equal(plan.commit(),true);assert.equal(stocksWindow(f.state,f.window.id).query,'');assert.equal(stocksWindow(f.state,f.window.id).storyId,'harbor-grid');assert.deepEqual(f.state.watchlist,saved);assert.equal(plan.commit(),false);
 const stale=f.controller.prepareNotificationOpen('stocks-price','HBR',{guard:()=>true,windowId:f.window.id});f.state.quotes[0]=copyCanonicalData(f.state.quotes[0]);assert.equal(stale.current(),false);assert.equal(stale.commit(),false);
});
test('stock scene candidate refuses an equal-value nested timeline replacement and frozen originals',()=>{
 const f=fixture(listOSProfiles()[1]),q=f.state.quotes[0],at=f.state.runtime.refreshedAt;
 assert.equal(commitStocksCandidate(f.state,next=>{next.runtime.refreshedAt=at+3600000;},()=>{q.samples=q.samples.map(p=>({...p}));return true;}).status,'rejected');assert.equal(f.state.runtime.refreshedAt,at);
 Object.freeze(q.samples);assert.equal(commitStocksCandidate(f.state,next=>{next.runtime.refreshedAt=at+3600000;},()=>true).status,'rejected');assert.equal(f.state.runtime.refreshedAt,at);
});

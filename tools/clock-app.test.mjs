import {test,expect} from 'bun:test';
import {CLOCK_APP_PROFILES,createClockAppState,validateClockAppState,nextClockAlarmDue,advanceClockApp,seedClockWidgetSources,retainClockAppGraph,migrateWindowsClockState,migrateWindowsClockWindow,formatClockDuration} from '../frontend/src/clock-app-state.js';
import {createClockAppCommands,clockAppCatalog,clockAppMenus} from '../frontend/src/clock-app-commands.js';
import {clockDefaults} from '../frontend/src/clock-model.js';
import {widgetsDefaults,validateWidgetsState} from '../frontend/src/notification-widget-model.js';
import {notificationsDefaults,dismissNotification} from '../frontend/src/notification-model.js';
import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from '../frontend/src/canonical-data.js';
import {createState as originalSDKClockState} from '../frontend/src/windows11-clock.js';
import {createDomainNotificationBridges,createNotificationCommands} from '../frontend/src/notification-commands.js';
import {retainNotificationDestination} from '../frontend/src/notification-destinations.js';
const at=Date.parse('2023-10-31T09:41:00Z');
function harness(profileId=CLOCK_APP_PROFILES[3]){
 const profile={id:profileId,defaults:{sceneTime:at},capabilities:['shell.notification-center','shell.notification-widgets'],applications:{clock:{name:'Clock'}}};
 const state=createClockAppState(profile),clock=clockDefaults(),widgets=seedClockWidgetSources(widgetsDefaults(profile)),notifications=notificationsDefaults(),window={id:'clock-window',appId:'clock'};
 let sceneTime=at,native=true,allow=true,notifyOverride,sharedOverride,view={available:()=>native,describe:()=>({controlIds:[]}),focus:async(_id,guard)=>guard(),scroll:async(_id,offsets,guard)=>guard()?offsets:null};
 let pending=0;
 const canCommit=delta=>allow&&Number.isSafeInteger(delta)&&canonicalStringUnits({state,widgets,notifications})+pending+delta<=4*1024*1024;
 const reserve=(delta,commit)=>{pending+=delta;try{return commit();}finally{pending-=delta;}};
 const bridges=createDomainNotificationBridges({profile,getState:()=>notifications,alive:()=>true,getSceneTime:()=>sceneTime,canCommit,reserve,
  retainDestination:entry=>retainNotificationDestination(entry,()=>({clockApp:state}),profile,()=>true)});
 const ctx={profile,getState:()=>state,getSceneTime:()=>sceneTime,getShared:name=>({clock,widgets,notifications})[name],getWindow:id=>id===window.id?window:null,getView:()=>view,alive:()=>true,available:()=>native,canCommit,
  planNotification:ownership=>bridges.planNotification(ownership),
  notify:(spec,ownership)=>notifyOverride?notifyOverride(spec,ownership):bridges.notify(spec,ownership),
  updateNotification:(id,spec,ownership)=>bridges.updateNotification(id,spec,ownership),
  mutateShared:async(name,mutator,options)=>{if(sharedOverride)return sharedOverride(name,mutator,options);const original=ctx.getShared(name),candidate=copyCanonicalData(original);if(!options.guard())return {status:'rejected'};mutator(candidate);if(name==='widgets'&&!validateWidgetsState(candidate,profile).ok)return {status:'rejected'};if(!canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(original)+options.reserveTextUnits)||!options.guard()||options.onCommit()!==true)return {status:'rejected'};applyCanonicalData(original,candidate);return {status:'applied'};},
  closeWindow:async(id,ownership)=>{if(!ownership.guard())return {status:'rejected'};const result=controller.windowClosed(window);return result?.status==='applied'?{status:'applied',target:{windowId:id}}:result;}
 };
 const controller=createClockAppCommands(ctx);controller.windowOpened(window,{});
 return {profile,state,clock,widgets,notifications,window,controller,ctx,reserve,send:(name,payload={},extra={})=>controller.handlers[`clockApp.${name}`]({windowId:window.id,...extra},payload),setTime:value=>{sceneTime=value;},setNative:value=>{native=value;},setAllow:value=>{allow=value;},setNotify:value=>{notifyOverride=value;},setShared:value=>{sharedOverride=value;},replaceView:()=>{view={...view};}};
}
test('all installed profiles retain distinct Clock actor and the one original widget world graph',()=>{
 for(const profileId of CLOCK_APP_PROFILES){const h=harness(profileId);expect(validateClockAppState(h.state,h.profile).ok).toBe(true);expect('worldCities' in h.state).toBe(false);expect(h.controller.targets().worldCities).toEqual(h.widgets.sources.clockCities);expect(h.widgets.sources.clockCities).toHaveLength(4);for(const spec of Object.values(clockAppCatalog()))expect(spec.profiles).toEqual(CLOCK_APP_PROFILES);}
});
test('precise stopwatch/laps use only scene time, pause resumes, and closing the app does not stop counters',async()=>{
 const h=harness();expect((await h.send('stopwatch',{action:'start'})).status).toBe('applied');const sw=h.state.stopwatch,laps=sw.laps;
 h.setTime(at+1505);expect((await h.send('stopwatch',{action:'lap'})).status).toBe('applied');expect(sw.elapsedMs).toBe(1505);expect(sw.laps[0].splitMs).toBe(1505);expect(formatClockDuration(sw.elapsedMs,true)).toBe('00:00:01.50');
 h.setTime(at+2000);await h.send('stopwatch',{action:'lap'});expect(sw.laps[0].splitMs).toBe(495);await h.send('stopwatch',{action:'pause'});h.setTime(at+4000);await h.controller.clockChanged();expect(sw.elapsedMs).toBe(2000);await h.send('stopwatch',{action:'start'});
 h.controller.windowClosed(h.window);h.setNative(false);h.setTime(at+4235);await h.controller.clockChanged();expect(sw.elapsedMs).toBe(2235);expect(h.state.windows).toHaveLength(0);expect(h.state.stopwatch).toBe(sw);expect(sw.laps).toBe(laps);
});
test('repeat timer accounts exact overshoot/cycles, reset and nonrepeat end preserve original rows',async()=>{
 const h=harness(),timer=h.state.timers[0];timer.durationMs=300;timer.remainingMs=300;timer.repeat=true;await h.send('timer',{action:'start'},{recordId:timer.id});h.setTime(at+1001);await h.controller.clockChanged();
 expect(timer.remainingMs).toBe(199);expect(timer.completedCycles).toBe(3);expect(timer.running).toBe(true);expect(h.state.timers[0]).toBe(timer);expect(h.state.alerts[0].cycles).toBe(3);expect(h.state.alerts[0].dueAt).toBe(at+300);expect(h.state.alerts[0].notificationId).toBe(h.notifications.entries[0].id);expect(h.state.history.some(e=>e.action==='repeat:3'&&e.at===at+300)).toBe(true);
 await h.send('timer',{action:'reset'},{recordId:timer.id});expect(timer.remainingMs).toBe(300);expect(timer.running).toBe(false);timer.repeat=false;await h.send('timer',{action:'start'},{recordId:timer.id});h.setTime(at+1400);await h.controller.clockChanged();expect(timer.remainingMs).toBe(0);expect(timer.running).toBe(false);expect((await h.send('timer',{action:'start'},{recordId:timer.id})).status).toBe('rejected');
});
test('zero timer immediately creates a genuine shared notification, repeat zero is invalid',async()=>{
 const h=harness();await h.send('dialog',{kind:'timer'});await h.send('draft',{field:'durationSeconds',value:'0'});expect((await h.send('save')).status).toBe('applied');const timer=h.state.timers.at(-1);expect((await h.send('timer',{action:'start'},{recordId:timer.id})).status).toBe('applied');expect(timer.completedCycles).toBe(1);expect(timer.running).toBe(false);expect(h.notifications.entries).toHaveLength(1);expect(h.state.alerts[0].status).toBe('delivered');
 await h.send('edit',{}, {recordId:timer.id});await h.send('draft',{field:'repeat',value:true});expect((await h.send('save')).status).toBe('rejected');
});
test('civil alarms skip DST gaps, fold once, and one-shot days empty disables after actual due occurrence',()=>{
 const alarm={...createClockAppState({defaults:{sceneTime:at}}).alarms[0],enabled:true,time:'02:30',timeZone:'America/Los_Angeles'};
 expect(nextClockAlarmDue(alarm,Date.parse('2024-03-10T08:00:00Z'))).toBe(Date.parse('2024-03-11T09:30:00Z'));
 alarm.time='01:30';expect(nextClockAlarmDue(alarm,Date.parse('2024-11-03T07:00:00Z'))).toBe(Date.parse('2024-11-03T08:30:00Z'));
 const state=createClockAppState({defaults:{sceneTime:Date.parse('2024-11-03T07:00:00Z')}});state.alarms=[alarm];const folded=advanceClockApp(state,Date.parse('2024-11-03T10:00:00Z'));expect(folded.candidate.alerts).toHaveLength(1);
 const once=createClockAppState({defaults:{sceneTime:at}});once.alarms[0].enabled=true;once.alarms[0].days=[];const advanced=advanceClockApp(once,at+2*3600000);expect(advanced.candidate.alerts).toHaveLength(1);expect(advanced.candidate.alarms[0].enabled).toBe(false);
});
test('delivered alarm snooze/dismiss atomically update actual shared notification and original ledger',async()=>{
 const h=harness(),alarm=h.state.alarms[0];alarm.enabled=true;h.setTime(Date.parse('2023-10-31T10:00:00Z'));await h.controller.clockChanged();const alert=h.state.alerts[0],firstId=alert.notificationId;expect(h.notifications.entries[0].id).toBe(firstId);
 expect((await h.send('alert',{action:'snooze'},{recordId:alert.id})).status).toBe('applied');expect(alert.status).toBe('snoozed');expect(h.notifications.entries).toHaveLength(0);h.setTime(alert.snoozeAt);await h.controller.clockChanged();expect(alert.status).toBe('delivered');expect(alert.notificationId).not.toBe(firstId);expect(h.notifications.entries[0].id).toBe(alert.notificationId);
 await h.send('alert',{action:'dismiss'},{recordId:alert.id});expect(alert.status).toBe('dismissed');expect(h.notifications.entries).toHaveLength(0);expect(h.state.alerts[0]).toBe(alert);
});
test('external Notification Center dismissal reconciles actual ledger, no fabricated delivery',async()=>{
 const h=harness();h.state.timers[0].running=true;h.setTime(at+300000);await h.controller.clockChanged();const alert=h.state.alerts[0];dismissNotification(h.notifications,alert.notificationId);await h.controller.notificationsChanged();expect(alert.status).toBe('dismissed');
});
test('false delivery callback, wrong prospective ID and nested equal-source replacement publish neither participant',async()=>{
 for(const change of ['refuse','wrong-id','replace-nested']){const h=harness();h.state.timers[0].running=true;h.setTime(at+300000);h.setNotify((spec,ownership)=>{if(change==='wrong-id')expect(spec.onCommit('notification-999')).toBe(false);if(change==='replace-nested'){h.state.preferences={...h.state.preferences};expect(ownership.guard()).toBe(false);expect(spec.onCommit('notification-1')).toBe(false);}return {status:'rejected',error:{code:'unavailable'}};});expect((await h.controller.clockChanged()).status).toBe('rejected');expect(h.notifications.entries).toHaveLength(0);expect(h.state.alerts[0].status).toBe('pending');expect(h.state.alerts[0].notificationId).toBe(null);}
});
test('world operations change one original master, preserve unchanged city refs and retarget widget configurations on removal',async()=>{
 const h=harness(),original=h.widgets.sources.clockCities[0],rows=h.widgets.sources.clockCities;h.widgets.instances.push({id:'widget-99',kind:'clock-city',size:'small',configuration:{cityId:original.id}});h.widgets.nextId=100;
 await h.send('worldReorder',{index:2},{recordId:original.id});expect(h.widgets.sources.clockCities).toBe(rows);expect(rows[2]).toBe(original);
 await h.send('worldSelect',{cityIds:[original.id]});expect(h.widgets.selected.clockCityIds).toEqual([original.id]);
 await h.send('delete',{}, {recordId:original.id});expect(rows.includes(original)).toBe(false);expect(h.widgets.selected.clockCityIds).toEqual([]);expect(h.widgets.instances.at(-1).configuration.cityId).toBe(null);expect(validateWidgetsState(h.widgets,h.profile).ok).toBe(true);
});
test('shared mutation refuses strict callback without consuming Clock identity/history or cities',async()=>{
 const h=harness(),before=copyCanonicalData(h.state),cities=copyCanonicalData(h.widgets);h.setShared(async()=>({status:'rejected',error:{code:'unavailable'}}));expect((await h.send('worldAdd',{name:'UTC',timeZone:'UTC'})).status).toBe('rejected');expect(h.state).toEqual(before);expect(h.widgets).toEqual(cities);
});
test('scene rewinds rebase running counters and do not replay acknowledged alarms',async()=>{
 const h=harness(),a=h.state.alarms[0];a.enabled=true;h.state.stopwatch.running=true;h.setTime(at+19*60000);await h.controller.clockChanged();expect(h.state.alerts).toHaveLength(1);const elapsed=h.state.stopwatch.elapsedMs;h.setTime(at);await h.controller.clockChanged();expect(h.state.stopwatch.elapsedMs).toBe(elapsed);h.setTime(at+19*60000);await h.controller.clockChanged();expect(h.state.alerts).toHaveLength(1);
});
test('SDK Clock migration preserves every actual workflow and edit draft/menu instead of fresh defaults',()=>{
 const original=originalSDKClockState();original.page='stopwatch';original.timer.remaining=27;original.timer.running=true;original.stopwatch={elapsed:15,running:true,laps:[{id:'lap-11',elapsed:15,split:15}]};original.nextId=12;original.notifications.push({id:'notification-9',label:'Actual original timer finished'});original.ui.menu='options';
 const state=migrateWindowsClockState(original,{id:CLOCK_APP_PROFILES[4]},at);expect(state.timers[0].remainingMs).toBe(27000);expect(state.timers[0].running).toBe(true);expect(state.stopwatch.elapsedMs).toBe(15000);expect(state.stopwatch.laps[0].splitMs).toBe(15000);expect(state.alerts[0].label).toBe(original.notifications[0].label);expect(migrateWindowsClockWindow(original,'clock-window').page).toBe('stopwatch');expect(migrateWindowsClockWindow(original,'clock-window').menu).toBe('Clock');expect(validateClockAppState(state,{id:CLOCK_APP_PROFILES[4]}).ok).toBe(true);
 original.ui.dialog='timer';original.draft={name:'Actual edited timer',duration:'127'};const window=migrateWindowsClockWindow(original,'clock-window');expect(window.draft.durationSeconds).toBe('127');expect(window.draft.id).toBe('timer-migrated');
});
test('saved descriptors/getters, quota refusal, nonexistent owners and stale native callbacks cannot publish',async()=>{
 const h=harness(),copy=copyCanonicalData(h.state);let reads=0;Object.defineProperty(copy,'lastSceneTime',{get(){reads++;return at;},enumerable:true});expect(validateClockAppState(copy,h.profile).ok).toBe(false);expect(reads).toBe(0);
 const retain=retainClockAppGraph(h.state);h.state.preferences={...h.state.preferences};expect(retain()).toBe(false);const snapshot=copyCanonicalData(h.state);h.setAllow(false);expect((await h.send('dialog',{kind:'alarm'})).status).toBe('rejected');expect(h.state).toEqual(snapshot);h.setAllow(true);h.setNative(false);expect((await h.send('stopwatch',{action:'start'})).status).toBe('rejected');expect(h.state.stopwatch.running).toBe(false);expect(clockAppMenus(h.state,h.window.id).flatMap(m=>m.items).every(item=>!item.enabled||item.request.command in h.controller.handlers)).toBe(true);
});
test('equal nested borrowed city replacement during an awaited shared bridge cannot acknowledge the actor',async()=>{
 const h=harness(),before=copyCanonicalData(h.state);let release,started;
 const reached=new Promise(resolve=>{started=resolve;});
 h.setShared((_name,_mutator,options)=>new Promise(resolve=>{release=()=>{expect(options.guard()).toBe(false);expect(options.onCommit()).toBe(false);resolve({status:'rejected',error:{code:'stale_target'}});};started();}));
 const pending=h.send('worldAdd',{name:'UTC',timeZone:'UTC'});await reached;
 h.widgets.sources.clockCities=h.widgets.sources.clockCities.map(row=>({...row}));release();
 expect((await pending).status).toBe('rejected');expect(h.state).toEqual(before);expect(h.widgets.sources.clockCities.some(c=>c.name==='UTC')).toBe(false);
});
test('retiring the actual native facade during awaited focus refuses the original action',async()=>{
 const h=harness();let release,started;const reached=new Promise(resolve=>{started=resolve;});
 h.ctx.getView(h.window.id).focus=(_id,guard)=>new Promise(resolve=>{release=()=>resolve(guard());started();});
 const pending=h.send('focus',{}, {control:'page:world'});await reached;h.replaceView();release();expect((await pending).status).toBe('rejected');
});
test('shared world identities cannot collide with imported widget rows and exhausted counters remain unchanged',async()=>{
 const h=harness();h.widgets.sources.clockCities.push({id:'world-3',name:'Original imported city',timeZone:'UTC'});const original=h.widgets.sources.clockCities.at(-1);
 expect((await h.send('worldAdd',{name:'Another UTC',timeZone:'UTC'})).status).toBe('applied');expect(h.widgets.sources.clockCities.find(c=>c.id==='world-3')).toBe(original);expect(new Set(h.widgets.sources.clockCities.map(c=>c.id)).size).toBe(h.widgets.sources.clockCities.length);
 h.state.nextId=Number.MAX_SAFE_INTEGER-1;const before=copyCanonicalData(h.state),cities=copyCanonicalData(h.widgets);expect((await h.send('worldAdd',{name:'Cannot allocate',timeZone:'UTC'})).status).toBe('rejected');expect(h.state).toEqual(before);expect(h.widgets).toEqual(cities);
});
test('modal Clock drafts block unrelated workflows while cancellation and settings remain genuine commands',async()=>{
 const h=harness();await h.send('dialog',{kind:'alarm'});const before=copyCanonicalData(h.state);expect((await h.send('alarmSet',{enabled:true},{recordId:h.state.alarms[0].id})).status).toBe('rejected');expect(h.state).toEqual(before);expect((await h.send('dialog',{kind:'none'})).status).toBe('applied');
 await h.send('dialog',{kind:'preferences'});expect((await h.send('preferences',{...h.state.preferences,notifications:false})).status).toBe('applied');expect(h.state.preferences.notifications).toBe(false);
});

test('native banner dismissal commits the real Clock ledger and notification atomically, including signed quota refusal',async()=>{
 const h=harness();h.state.timers[0].running=true;h.setTime(at+300000);await h.controller.clockChanged();
 const original=h.notifications.entries[0],alert=h.state.alerts[0],ui={banners:[],items:{}};
 const view={available:()=>true,describe:()=>({controlIds:['banner','dismiss',`open:${original.id}`],focusedControl:null,scroll:{top:0,left:0}}),
  prepare:async(_id,guard)=>guard(),focus:async(_id,guard)=>guard()};
 let commits=0;
 const commands=createNotificationCommands({profile:h.profile,namespace:'clock-ledger',getState:()=>h.notifications,
  getSceneTime:h.ctx.getSceneTime,getUi:()=>ui,getPane:()=>null,setPane(){},getView:()=>null,getBannerView:()=>view,
  alive:()=>true,available:()=>true,settle:async()=>{},actions:()=>['open'],canCommit:h.ctx.canCommit,reserve:h.reserve,
  retainDestination:entry=>retainNotificationDestination(entry,()=>({clockApp:h.state}),h.profile,()=>true),
  prepareNotificationDismissals(ids,ownership){
   const prepared=h.controller.prepareNotificationDismissals(ids,ownership);
   return {...prepared,commit(){commits++;return prepared.commit();}};
  }});
 commands.notificationPosted(original);
 const target={bannerId:ui.banners[0].bannerId};
 h.setAllow(false);
 expect((await commands.handlers['notifications.banner.dismiss'](target,{})).status).toBe('rejected');
 expect(h.notifications.entries[0]).toBe(original);expect(alert.status).toBe('delivered');expect(commits).toBe(0);
 h.setAllow(true);
 expect((await commands.handlers['notifications.banner.dismiss'](target,{})).status).toBe('applied');
 expect(commits).toBe(1);expect(h.notifications.entries).toEqual([]);expect(alert.status).toBe('dismissed');
 expect(h.state.alerts[0]).toBe(alert);expect(ui.banners).toEqual([]);
});

test('Clock notification snooze exposes configured nine minutes and reports the actual actor deadline instead of the removed entry',async()=>{
 const h=harness(),alarm=h.state.alarms[0];alarm.enabled=true;h.setTime(Date.parse('2023-10-31T10:00:00Z'));
 await h.controller.clockChanged();
 const original=h.notifications.entries[0],alert=h.state.alerts[0],ui={banners:[],items:{[original.id]:{expanded:false,optionsOpen:true,replyBody:null}}};
 const view={available:()=>true,describe:()=>({controlIds:['banner','dismiss',`open:${original.id}`,`snooze:${original.id}:9`,`snooze:${original.id}:5`],focusedControl:null,scroll:{top:0,left:0}}),
  prepare:async(_id,guard)=>guard(),focus:async(_id,guard)=>guard()};
 let invoked=0;
 const commands=createNotificationCommands({profile:h.profile,namespace:'clock-snooze',getState:()=>h.notifications,
  getSceneTime:h.ctx.getSceneTime,getUi:()=>ui,getPane:()=>null,setPane(){},getView:()=>null,getBannerView:()=>view,
  alive:()=>true,available:()=>true,settle:async()=>{},actions:()=>['open','snooze'],
  snoozeChoices:()=>[h.state.preferences.snoozeMinutes],
  retainDestination:entry=>retainNotificationDestination(entry,()=>({clockApp:h.state}),h.profile,()=>true),
  async snoozeDestination(source,minutes,guard){
   expect(source.source.record).toBe(alert);expect(minutes).toBe(h.state.preferences.snoozeMinutes);
   if(!guard())return {status:'rejected'};
   invoked++;
   const result=await h.send('alert',{action:'snooze'},{recordId:alert.id});
   return {...result,snoozedUntil:alert.snoozeAt};
  }});
 commands.notificationPosted(original);
 const target={bannerId:ui.banners[0].bannerId,notificationId:original.id};
 expect(commands.snoozeChoices(original)).toEqual([9]);
 expect((await commands.handlers['notifications.item.snooze'](target,{minutes:5})).status).toBe('rejected');
 expect(invoked).toBe(0);expect(alert.status).toBe('delivered');expect(h.notifications.entries[0]).toBe(original);
 const result=await commands.handlers['notifications.item.snooze'](target,{minutes:9});
 expect(result.status).toBe('applied');expect(invoked).toBe(1);
 expect(result.target.snoozedUntil).toBe(alert.snoozeAt);expect(result.target.snoozedUntil).toBe(h.ctx.getSceneTime()+9*60000);
 expect(original.snoozedUntil).toBe(null);expect(alert.status).toBe('snoozed');expect(h.notifications.entries).toEqual([]);
 expect(h.state.preferences.snoozeMinutes).toBe(9);
});

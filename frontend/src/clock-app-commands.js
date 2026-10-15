import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { rejected } from './feature-commands.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { calendarValueConforms } from './calendar-state.js';
import { remindersMutable } from './reminders-state.js';
import { CLOCK_APP_PROFILES, clockAppPages, clockAppZones, clockAppAllocate, validateClockAppState, advanceClockApp, retainClockAppGraph, migrateWindowsClockWindow } from './clock-app-state.js';
const id={type:'string',minLength:1,maxLength:128},integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const win=object({windowId:id}),record=object({windowId:id,recordId:id});
export const clockAppCommandSpecs={
 'clockApp.page':[win,object({page:choice(...clockAppPages)})],
 'clockApp.menu':[win,object({menu:{anyOf:[choice('Clock','File','Edit','View','Window','Help'),{type:'null'}]}})],
 'clockApp.dialog':[win,object({kind:choice('alarm','timer','world','preferences','about','help','none')})],
 'clockApp.edit':[record,empty],
 'clockApp.draft':[win,object({field:choice('name','time','timeZone','days','sound','snooze','durationSeconds','repeat'),value:{anyOf:[{type:'string',maxLength:80},flag,{type:'array',maxItems:7,items:integer(0,6)}]}})],
 'clockApp.save':[win,empty],
 'clockApp.alarmSet':[record,object({enabled:flag})],
 'clockApp.delete':[record,empty],
 'clockApp.timer':[record,object({action:choice('start','pause','reset')})],
 'clockApp.stopwatch':[win,object({action:choice('start','pause','reset','lap')})],
 'clockApp.alert':[record,object({action:choice('dismiss','snooze')})],
 'clockApp.preferences':[win,object({notifications:flag,snoozeMinutes:integer(1,60),stopwatchStyle:choice('digital','analog')})],
 'clockApp.worldAdd':[win,object({name:{type:'string',minLength:1,maxLength:80},timeZone:choice(...clockAppZones)})],
 'clockApp.worldReorder':[record,object({index:integer(0,63)})],
 'clockApp.worldSelect':[win,object({cityIds:{type:'array',maxItems:4,items:id,uniqueItems:true}})],
 'clockApp.query':[win,object({query:{type:'string',maxLength:80}})],
 'clockApp.clearHistory':[win,empty],
 'clockApp.clearCompleted':[win,empty],
 'clockApp.windowClose':[win,empty],
 'clockApp.focus':[object({windowId:id,control:id}),empty],
 'clockApp.scroll':[object({windowId:id,area:choice('content','laps','history')}),object({top:{type:'number',minimum:0},left:{type:'number',minimum:0}})],
};
export const clockAppCatalog=()=>Object.fromEntries(Object.entries(clockAppCommandSpecs).map(([name,[target,payload]])=>defineCommand(CLOCK_APP_PROFILES,name,'app.clock',target,payload,['Original Clock actor and available native window'],['Actual native Clock UI'],['Canonical alarms, timers, laps, world cities and notification ledger'])));
const reject=(code,message)=>rejected(code,message);
const applied=(windowId,extra={})=>({status:'applied',target:{windowId,...extra}});
export function clockAppMenus(state,windowId,profile){
 const w=state.windows.find(x=>x.windowId===windowId),ready=!!w&&w.sheet==='none';
 const item=(id,label,command,payload={},enabled=ready,extra={})=>({id,label,enabled,...extra,...(enabled?{request:{command,target:{windowId},payload}}:{})});
 return [{id:'clock',label:'Clock',items:[item('settings',/high-sierra|mojave/.test(profile?.id??'')?'Preferences…':'Settings…','clockApp.dialog',{kind:'preferences'}),item('about','About Clock','clockApp.dialog',{kind:'about'})]},
 {id:'file',label:'File',items:[item('alarm','New Alarm…','clockApp.dialog',{kind:'alarm'}),item('timer','New Timer…','clockApp.dialog',{kind:'timer'}),item('city','Add City…','clockApp.dialog',{kind:'world'}),item('close','Close Window','clockApp.windowClose',{},!!w)]},
 {id:'edit',label:'Edit',items:[item('history','Clear Operation History','clockApp.clearHistory'),item('completed','Clear Dismissed Alerts','clockApp.clearCompleted')]},
 {id:'view',label:'View',items:[...clockAppPages.map(page=>item(page,({world:'World Clock',alarms:'Alarms',stopwatch:'Stopwatch',timers:'Timers'})[page],'clockApp.page',{page},ready,{checked:w?.page===page})),...['digital','analog'].map(style=>item(style,`View ${style==='digital'?'Digital':'Analog'} Stopwatch`,'clockApp.preferences',{...state.preferences,stopwatchStyle:style},ready,{checked:state.preferences.stopwatchStyle===style}))]},
 {id:'window',label:'Window',items:[item('close','Close Window','clockApp.windowClose',{},!!w)]},{id:'help',label:'Help',items:[item('help','Clock Help','clockApp.dialog',{kind:'help'})]}];
}
export function createClockAppCommands(ctx){
 let retired=false,pumping=null;const state=ctx.getState(),originalWindows=new Map(state.windows.map(w=>[w.windowId,ctx.getWindow(w.windowId)]));
 const alive=()=>!retired&&ctx.alive?.()!==false&&ctx.getState()===state;
 const time=()=>ctx.getSceneTime();
 const session=id=>state.windows.find(w=>w.windowId===id);
 const check=(candidate,guard)=>{if(!alive()||guard()!==true||!remindersMutable(state))return reject('stale_target','Original writable Clock graph or native ownership retired.');const validation=validateClockAppState(candidate,ctx.profile);if(!validation.ok)return reject('invalid_arguments',validation.message);const delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);if(ctx.canCommit?.(delta)!==true||!guard())return reject('unavailable','Complete scene text budget or original ownership declined this Clock transition.');return {delta};};
 const publish=(candidate,guard)=>{const result=check(candidate,guard);if(result.status==='rejected')return result;applyCanonicalData(state,candidate);return {status:'applied'};};
 function lease(windowId){const window=ctx.getWindow(windowId),w=session(windowId),view=ctx.getView(windowId),unchanged=retainClockAppGraph(state),clock=ctx.getShared?.('clock'),clockUnchanged=retainClockAppGraph(clock),widgets=ctx.getShared?.('widgets'),widgetsUnchanged=retainClockAppGraph(widgets),instant=time();const present=()=>alive()&&ctx.getWindow(windowId)===window&&window?.appId==='clock'&&session(windowId)===w&&ctx.getView(windowId)===view&&view?.available()===true&&ctx.available(windowId)===true;const guard=()=>present()&&unchanged()&&time()===instant&&ctx.getShared?.('clock')===clock&&clockUnchanged()&&ctx.getShared?.('widgets')===widgets&&widgetsUnchanged();return guard()?{window,w,view,guard,present,widgets}:null;}
 function mutate(l,fn){if(!l?.guard())return reject('stale_target','The original native Clock window is unavailable.');const candidate=copyCanonicalData(state),w=candidate.windows.find(x=>x.windowId===l.w.windowId);const result=fn(candidate,w);if(result?.status==='rejected')return result;const commit=publish(candidate,l.guard);return commit.status==='rejected'?commit:applied(w.windowId,result?.target??{});}
 const history=(s,sourceId,action,elapsedMs=0)=>{s.history.push({id:clockAppAllocate(s,'clock-history'),sourceId,action,at:time(),elapsedMs});if(s.history.length>512)s.history.shift();};
 async function mutateWorld(l,operation){
  if(!l.guard()||!l.widgets?.sources?.clockCities||typeof ctx.mutateShared!=='function')return reject('unavailable','World Clock requires the original shared widget city graph and guarded mutation bridge.');
  const candidate=copyCanonicalData(state),w=candidate.windows.find(w=>w.windowId===l.w.windowId),shared=copyCanonicalData(l.widgets),result=operation(shared,candidate,w);
  if(result?.status==='rejected')return result;
  const checked=check(candidate,l.guard);if(checked.status==='rejected')return checked;let acknowledged=false,bridge;
  try{bridge=await ctx.mutateShared('widgets',actual=>{applyCanonicalData(actual,shared);return {status:'applied'};},{guard:l.guard,windowId:l.w.windowId,reserveTextUnits:checked.delta,onCommit:()=>{if(acknowledged||!l.guard()||check(candidate,l.guard).status==='rejected')return false;applyCanonicalData(state,candidate);acknowledged=true;return true;}});}catch(error){if(!acknowledged)return reject('unavailable',error?.message??'World Clock shared city mutation failed.');}
  return acknowledged?applied(l.w.windowId,result?.target??{}):bridge?.status==='rejected'?bridge:reject('unavailable','Original shared cities and Clock actor did not atomically acknowledge.');
 }
 async function deliver(alertId){
  const alert=state.alerts.find(a=>a.id===alertId);if(!alert||!state.preferences.notifications||!['pending','snoozed'].includes(alert.status)||alert.status==='snoozed'&&alert.snoozeAt>time())return {status:'applied',target:{}};
  const instant=time(),unchanged=retainClockAppGraph(state),clock=ctx.getShared?.('clock'),clockUnchanged=retainClockAppGraph(clock),guard=()=>alive()&&time()===instant&&state.alerts.find(a=>a.id===alertId)===alert&&unchanged()&&ctx.getShared?.('clock')===clock&&clockUnchanged();
  if(typeof ctx.notify!=='function'||typeof ctx.planNotification!=='function')return reject('unavailable','Clock requires the real shared notification allocation and paired delivery bridge.');
  const plan=ctx.planNotification({guard});if(plan?.status==='rejected')return plan;if(!plan?.notificationId||typeof plan.current!=='function')return reject('unavailable','Notification planner returned no actual original allocation lease.');
  const current=()=>guard()&&plan.current()===true;const candidate=copyCanonicalData(state),row=candidate.alerts.find(a=>a.id===alertId);row.notificationId=plan.notificationId;row.status='delivered';row.snoozeAt=null;
  const preliminary=check(candidate,current);if(preliminary.status==='rejected')return preliminary;let acknowledged=false,result;
  const title=`${alert.label} — ${alert.kind==='timer'?'timer finished':'alarm'}`.replace(/[\r\n\u2028\u2029]/g,' ').slice(0,256);
  try{result=await ctx.notify({id:`${alert.id}-delivery-${plan.notificationId}`,appId:'clock',title,body:`Authored scene time${alert.cycles>1?` · ${alert.cycles} completed repeat cycles`:''}. No host alarm or physical audio.`,source:{kind:'clock',recordId:alert.id},actions:['open','snooze','dismiss'],reserveTextUnits:preliminary.delta,onCommit:actualId=>{if(acknowledged||actualId!==plan.notificationId||!current())return false;const checked=check(candidate,current);if(checked.status==='rejected')return false;applyCanonicalData(state,candidate);acknowledged=true;return true;}},{guard:current});}catch(error){if(!acknowledged)return reject('unavailable',error?.message??'Clock notification delivery failed.');}
  return acknowledged?{status:'applied',target:{alertId,notificationId:plan.notificationId}}:result?.status==='rejected'?result:reject('unavailable','Notification delivery did not acknowledge its exact Clock ledger transaction.');
 }
 async function pump(){
  if(!alive())return reject('stale_target','Clock actor retired.');const instant=time(),unchanged=retainClockAppGraph(state),notificationGraph=ctx.getShared?.('notifications'),notificationsUnchanged=retainClockAppGraph(notificationGraph),guard=()=>alive()&&time()===instant&&unchanged()&&ctx.getShared?.('notifications')===notificationGraph&&notificationsUnchanged();
  const advanced=advanceClockApp(state,instant);if(!advanced.ok)return reject('unavailable',advanced.message);
  if(notificationGraph?.entries)for(const row of advanced.candidate.alerts)if(row.status==='delivered'&&!notificationGraph.entries.some(n=>n.id===row.notificationId))row.status='dismissed';
  const result=publish(advanced.candidate,guard);if(result.status==='rejected')return result;
  const ids=state.alerts.filter(a=>a.status==='pending'||a.status==='snoozed'&&a.snoozeAt<=instant).map(a=>a.id);const delivered=[];
  for(const id of ids){if(!alive()||time()!==instant)return reject('stale_target','Scene clock changed while its real notification delivery was pending.');const ack=await deliver(id);if(ack.status==='rejected')return ack;if(ack.target.notificationId)delivered.push(ack.target.notificationId);}
  return {status:'applied',target:{sceneTime:instant,notificationIds:delivered}};
 }
 const sceneTimeChanged=()=>{if(pumping)return pumping;pumping=(async()=>{let result,instant;do{instant=time();result=await pump();}while(alive()&&time()!==instant);return result;})().finally(()=>{pumping=null;});return pumping;};
 async function alertAction(l,recordId,action){
  const row=state.alerts.find(a=>a.id===recordId);if(!row||!['delivered','snoozed'].includes(row.status))return reject('stale_target','Only an actual delivered Clock notification can be acknowledged.');
  const alarm=state.alarms.find(a=>a.id===row.sourceId);if(action==='snooze'&&(row.kind!=='alarm'||!alarm?.snooze||row.status!=='delivered'))return reject('unavailable','Snooze is disabled for this original alarm.');
  if(typeof ctx.updateNotification!=='function')return reject('unavailable','The real shared notification dismissal bridge is required.');
  const candidate=copyCanonicalData(state),alert=candidate.alerts.find(a=>a.id===recordId);alert.status=action==='snooze'?'snoozed':'dismissed';alert.snoozeAt=action==='snooze'?time()+candidate.preferences.snoozeMinutes*60000:null;
  const checked=check(candidate,l.guard);if(checked.status==='rejected')return checked;let acknowledged=false,result;
  try{result=await ctx.updateNotification(row.notificationId,{dismissed:true,reserveTextUnits:checked.delta,onCommit:actualId=>{if(acknowledged||actualId!==row.notificationId||!l.guard()||check(candidate,l.guard).status==='rejected')return false;applyCanonicalData(state,candidate);acknowledged=true;return true;}},{guard:l.guard,windowId:l.w.windowId});}catch(error){if(!acknowledged)return reject('unavailable',error?.message??'Clock dismissal failed.');}
  return acknowledged?applied(l.w.windowId,{alertId:recordId,action}):result?.status==='rejected'?result:reject('unavailable','Shared notification and Clock ledger did not atomically acknowledge.');
 }
 const operations={
  'clockApp.page':(l,p)=>mutate(l,(s,w)=>{if(w.sheet!=='none')return reject('unavailable','Close the Clock sheet first.');w.page=p.page;w.menu=null;}),
  'clockApp.menu':(l,p)=>mutate(l,(s,w)=>{if(w.sheet!=='none')return reject('unavailable','Close the Clock sheet first.');w.menu=p.menu;}),
  'clockApp.dialog':(l,p)=>mutate(l,(s,w)=>{if(w.sheet!=='none'&&p.kind!=='none')return reject('unavailable','An original Clock sheet is already open.');w.sheet=p.kind;w.menu=null;w.draft=['alarm','timer'].includes(p.kind)?{kind:p.kind,id:null,name:p.kind==='alarm'?'Alarm':'Timer',time:'10:00',timeZone:ctx.getShared?.('clock')?.timeZone??'UTC',days:[0,1,2,3,4,5,6],sound:'Radar',snooze:true,durationSeconds:'300',repeat:false}:null;}),
  'clockApp.edit':(l,p,t)=>mutate(l,(s,w)=>{if(w.sheet!=='none')return reject('unavailable','Close the Clock sheet first.');const a=s.alarms.find(a=>a.id===t.recordId),timer=s.timers.find(a=>a.id===t.recordId);if(!a&&!timer)return reject('stale_target','Clock record no longer exists.');if(timer?.running)return reject('unavailable','Pause the timer before editing.');w.sheet=a?'alarm':'timer';w.menu=null;w.draft={kind:w.sheet,id:t.recordId,name:(a??timer).name,time:a?.time??'10:00',timeZone:a?.timeZone??'UTC',days:a?.days??[0,1,2,3,4,5,6],sound:(a??timer).sound,snooze:a?.snooze??true,durationSeconds:String((timer?.durationMs??300000)/1000),repeat:timer?.repeat??false};}),
  'clockApp.draft':(l,p)=>mutate(l,(s,w)=>{if(!w.draft)return reject('stale_target','No original Clock draft is open.');const allowed=w.draft.kind==='alarm'?['name','time','timeZone','days','sound','snooze']:['name','durationSeconds','repeat','sound'];if(!allowed.includes(p.field))return reject('invalid_arguments','Field does not belong to this Clock sheet.');w.draft[p.field]=copyCanonicalData(p.value);}),
  'clockApp.save':(l)=>mutate(l,(s,w)=>{const d=w.draft;if(!d||!d.name.trim())return reject('invalid_arguments','Enter a name of 1–80 characters.');if(d.kind==='alarm'){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))return reject('invalid_arguments','Enter a 24-hour HH:MM alarm time.');const old=s.alarms.find(a=>a.id===d.id);if(d.id&&!old)return reject('stale_target','Edited alarm was removed.');if(!old&&s.alarms.length>=64)return reject('unavailable','Clock supports 64 alarms.');const row={id:old?.id??clockAppAllocate(s,'alarm'),name:d.name.trim(),time:d.time,timeZone:d.timeZone,enabled:old?.enabled??true,days:d.days,sound:d.sound,snooze:d.snooze,lastOccurrenceAt:old?.lastOccurrenceAt??null};if(old)Object.assign(old,row);else s.alarms.push(row);history(s,row.id,'alarm-save');}else{if(!/^\d+(?:\.\d{1,3})?$/.test(d.durationSeconds))return reject('invalid_arguments','Enter 0–359999 seconds, up to three decimal places.');const durationMs=Number(d.durationSeconds)*1000;if(!Number.isSafeInteger(durationMs)||durationMs>359999000||d.repeat&&durationMs===0)return reject('invalid_arguments','Repeat requires a positive bounded duration.');const old=s.timers.find(t=>t.id===d.id);if(d.id&&!old||old?.running)return reject('stale_target','Edited timer retired or is running.');if(!old&&s.timers.length>=64)return reject('unavailable','Clock supports 64 timers.');const row={id:old?.id??clockAppAllocate(s,'timer'),name:d.name.trim(),durationMs,remainingMs:durationMs,running:false,repeat:d.repeat,sound:d.sound,completedCycles:old?.completedCycles??0};if(old)Object.assign(old,row);else s.timers.push(row);history(s,row.id,'timer-save');}w.draft=null;w.sheet='none';}),
  'clockApp.alarmSet':(l,p,t)=>mutate(l,(s)=>{const a=s.alarms.find(a=>a.id===t.recordId);if(!a)return reject('stale_target','Alarm no longer exists.');a.enabled=p.enabled;history(s,a.id,p.enabled?'alarm-enable':'alarm-disable');}),
  'clockApp.delete':(l,p,t)=>l.widgets?.sources.clockCities.some(c=>c.id===t.recordId)?mutateWorld(l,(widgets,s)=>{widgets.sources.clockCities=widgets.sources.clockCities.filter(c=>c.id!==t.recordId);widgets.selected.clockCityIds=widgets.selected.clockCityIds.filter(id=>id!==t.recordId);for(const widget of widgets.instances){if(widget.kind==='clock-city'&&widget.configuration.cityId===t.recordId)widget.configuration.cityId=null;if(widget.kind==='clock-world')widget.configuration.cityIds=widget.configuration.cityIds.filter(id=>id!==t.recordId);}history(s,t.recordId,'world-delete');}):mutate(l,(s,w)=>{const group=[s.alarms,s.timers].find(rows=>rows.some(x=>x.id===t.recordId));if(!group)return reject('stale_target','Clock record no longer exists.');if(s.alerts.some(a=>a.sourceId===t.recordId&&['pending','delivered','snoozed'].includes(a.status)))return reject('unavailable','Acknowledge active alerts before deleting their Clock source.');const index=group.findIndex(x=>x.id===t.recordId);group.splice(index,1);if(w.draft?.id===t.recordId){w.draft=null;w.sheet='none';}history(s,t.recordId,'delete');}),
  'clockApp.timer':(l,p,t)=>mutate(l,(s,w)=>{if(w.sheet!=='none')return reject('unavailable','Close the Clock sheet first.');const timer=s.timers.find(x=>x.id===t.recordId);if(!timer)return reject('stale_target','Timer no longer exists.');if(p.action==='start'){if(timer.running||timer.remainingMs===0&&timer.durationMs!==0)return reject('unavailable','Reset the completed timer before starting.');if(timer.durationMs===0){if(s.alerts.length>=8192)return reject('unavailable','Clock delivery ledger is full.');s.alerts.push({id:clockAppAllocate(s,'clock-alert'),sourceId:timer.id,kind:'timer',label:timer.name,dueAt:time(),cycles:1,status:'pending',notificationId:null,snoozeAt:null});timer.completedCycles++;}else timer.running=true;}else if(p.action==='pause'){if(!timer.running)return reject('stale_target','Timer is already paused.');timer.running=false;}else{timer.running=false;timer.remainingMs=timer.durationMs;}history(s,timer.id,p.action,timer.durationMs-timer.remainingMs);}),
  'clockApp.stopwatch':(l,p)=>mutate(l,(s,w)=>{if(w.sheet!=='none')return reject('unavailable','Close the Clock sheet first.');const sw=s.stopwatch;if(p.action==='start'){if(sw.running)return reject('stale_target','Stopwatch is already running.');sw.running=true;}else if(p.action==='pause'){if(!sw.running)return reject('stale_target','Stopwatch is already paused.');sw.running=false;}else if(p.action==='lap'){if(!sw.running)return reject('unavailable','Start the stopwatch before recording a lap.');if(sw.laps.length>=512)return reject('unavailable','Reset the stopwatch after 512 laps.');sw.laps.unshift({id:clockAppAllocate(s,'lap'),elapsedMs:sw.elapsedMs,splitMs:sw.elapsedMs-(sw.laps[0]?.elapsedMs??0)});}else{sw.running=false;sw.elapsedMs=0;sw.laps.splice(0);}history(s,'stopwatch',p.action,sw.elapsedMs);}),
  'clockApp.alert':(l,p,t)=>alertAction(l,t.recordId,p.action),
  'clockApp.preferences':(l,p)=>mutate(l,(s)=>{Object.assign(s.preferences,p);}),
  'clockApp.worldAdd':(l,p)=>mutateWorld(l,(widgets,s,w)=>{if(widgets.sources.clockCities.length>=64)return reject('unavailable','Clock supports 64 world clocks.');if(!p.name.trim())return reject('invalid_arguments','Enter a city name.');const id=clockAppAllocate(s,'world',widgets.sources.clockCities);widgets.sources.clockCities.push({id,name:p.name.trim(),timeZone:p.timeZone});w.sheet='none';w.query='';history(s,id,'world-add');return {target:{recordId:id}};}),
  'clockApp.worldReorder':(l,p,t)=>mutateWorld(l,(widgets,s)=>{const rows=widgets.sources.clockCities,index=rows.findIndex(x=>x.id===t.recordId);if(index<0||p.index>=rows.length)return reject('stale_target','Choose an existing world clock position.');rows.splice(p.index,0,rows.splice(index,1)[0]);history(s,t.recordId,'world-reorder');}),
  'clockApp.worldSelect':(l,p)=>mutateWorld(l,(widgets,s)=>{if(new Set(p.cityIds).size!==p.cityIds.length||p.cityIds.some(id=>!widgets.sources.clockCities.some(c=>c.id===id)))return reject('invalid_arguments','Choose up to four distinct original world city records.');widgets.selected.clockCityIds=p.cityIds;history(s,'world-selection','world-select');}),
  'clockApp.query':(l,p)=>mutate(l,(s,w)=>{w.query=p.query;}),
  'clockApp.clearHistory':l=>mutate(l,s=>{s.history.splice(0);}),
  'clockApp.clearCompleted':l=>mutate(l,s=>{s.alerts=s.alerts.filter(a=>a.status!=='dismissed');}),
  'clockApp.windowClose':l=>typeof ctx.closeWindow==='function'?ctx.closeWindow(l.w.windowId,{guard:l.guard,windowId:l.w.windowId}):reject('unavailable','The actual original window lifecycle bridge is required.'),
  'clockApp.focus':async(l,p,t)=>await l.view.focus(t.control,l.guard)===true?applied(t.windowId,{control:t.control}):reject('stale_target','Original Clock control could not receive focus.'),
  'clockApp.scroll':async(l,p,t)=>{const offsets=await l.view.scroll(t.area,p,l.guard);return offsets?applied(t.windowId,{area:t.area,...offsets}):reject('stale_target','Original Clock scroll area retired.');},
 };
 const elapsedCommands=new Set(['clockApp.timer','clockApp.stopwatch','clockApp.alarmSet','clockApp.edit','clockApp.save']);
 const handlers=Object.fromEntries(Object.entries(operations).map(([name,operation])=>[name,async(target,payload={})=>{
  const [targetSchema,payloadSchema]=clockAppCommandSpecs[name];
  if(!calendarValueConforms(target,targetSchema)||!calendarValueConforms(payload,payloadSchema))return reject('invalid_arguments','Use the closed typed Clock command target and payload.');
  const original=lease(target.windowId);
  if(!original)return reject('stale_target','Clock requires the actual original available native window.');
  if(original.w.sheet!=='none'){
   const allowed=['clockApp.focus','clockApp.scroll','clockApp.windowClose'].includes(name)
    ||name==='clockApp.dialog'&&payload.kind==='none'
    ||['clockApp.draft','clockApp.save'].includes(name)&&['alarm','timer'].includes(original.w.sheet)
    ||name==='clockApp.preferences'&&original.w.sheet==='preferences'
    ||['clockApp.query','clockApp.worldAdd'].includes(name)&&original.w.sheet==='world';
   if(!allowed)return reject('unavailable','The original Clock sheet owns this native window; close it before another workflow.');
  }
  if(elapsedCommands.has(name)){
   const pumpResult=await sceneTimeChanged();
   if(pumpResult.status==='rejected')return pumpResult;
   if(!original.present())return reject('stale_target','The original Clock window or native facade retired while time advanced.');
  }
  const l=lease(target.windowId);
  if(!l)return reject('stale_target','Clock requires the actual original available native window.');
  const result=await operation(l,payload,target);
  if(result.status==='applied'&&name==='clockApp.timer'&&payload.action==='start')await sceneTimeChanged();
  return result;
 } ]));
 function prepareNotificationDismissals(actualIDs,ownership){
  if(!Array.isArray(actualIDs)||actualIDs.length>256||new Set(actualIDs).size!==actualIDs.length
   ||actualIDs.some(id=>typeof id!=='string'||!/^notification-[1-9][0-9]*$/.test(id))
   ||typeof ownership?.guard!=='function'||!alive()||ownership.guard()!==true
   ||!validateClockAppState(state,ctx.profile).ok||!remindersMutable(state))return null;
  const unchanged=retainClockAppGraph(state),instant=time(),current=()=>alive()&&time()===instant&&unchanged()&&ownership.guard()===true;
  const candidate=copyCanonicalData(state),ids=new Set(actualIDs);
  for(const alert of candidate.alerts)if(alert.status==='delivered'&&ids.has(alert.notificationId)){alert.status='dismissed';alert.snoozeAt=null;}
  if(!validateClockAppState(candidate,ctx.profile).ok)return null;
  let committed=false;
  return {current,delta:canonicalStringUnits(candidate)-canonicalStringUnits(state),commit(){
   if(committed||!current()||check(candidate,current).status==='rejected')return false;
   applyCanonicalData(state,candidate);committed=true;return true;
  }};
 }
 return {handlers,targets:()=>({windows:state.windows.map(w=>({windowId:w.windowId,page:w.page,sheet:w.sheet,available:!!lease(w.windowId),controls:ctx.getView(w.windowId)?.describe?.(),menus:clockAppMenus(state,w.windowId)})),alarms:copyCanonicalData(state.alarms),timers:copyCanonicalData(state.timers),stopwatch:copyCanonicalData(state.stopwatch),worldCities:copyCanonicalData(ctx.getShared?.('widgets')?.sources.clockCities??[]),selectedClockCityIds:copyCanonicalData(ctx.getShared?.('widgets')?.selected.clockCityIds??[]),alerts:copyCanonicalData(state.alerts),sceneTime:time()}),
  windowOpened(window,options){
   if(!alive()||window?.appId!=='clock')return reject('stale_target','The original Clock window is unavailable.');
   const unchanged=retainClockAppGraph(state),source=options?.originalSDKClock,sourceCurrent=retainClockAppGraph(source);
   const guard=()=>alive()&&unchanged()&&sourceCurrent()&&ctx.getWindow(window.id)===window&&(!options?.isCurrent||options.isCurrent()===true)&&(!options?.ownership?.guard||options.ownership.guard()===true);
   if(!guard())return reject('stale_target','The original Clock opening source retired.');
   const existing=session(window.id),registered=originalWindows.get(window.id);
   if(existing){
    if(registered&&registered!==window)return reject('stale_target','An existing Clock session retains a different original root window.');
    originalWindows.set(window.id,window);return applied(window.id);
   }
   const candidate=copyCanonicalData(state);
   candidate.windows.push(source?migrateWindowsClockWindow(source,window.id):{windowId:window.id,page:'world',sheet:'none',draft:null,menu:null,query:''});
   const result=publish(candidate,guard);if(result.status==='applied')originalWindows.set(window.id,window);return result;
  },
  windowClosed(window,ownership){if(originalWindows.get(window.id)!==window)return reject('stale_target','The original Clock close owner retired.');const unchanged=retainClockAppGraph(state),guard=()=>alive()&&unchanged()&&(!ownership?.guard||ownership.guard()===true),c=copyCanonicalData(state);c.windows=c.windows.filter(w=>w.windowId!==window.id);const result=publish(c,guard);if(result.status==='applied')originalWindows.delete(window.id);return result;},
  appQuit(appId,ownership){if(appId!=='clock')return;const unchanged=retainClockAppGraph(state),guard=()=>alive()&&unchanged()&&(!ownership?.guard||ownership.guard()===true),c=copyCanonicalData(state);c.windows=[];const result=publish(c,guard);if(result.status==='applied')originalWindows.clear();return result;},
  clockChanged:sceneTimeChanged,sceneTimeChanged,notificationsChanged:sceneTimeChanged,prepareNotificationDismissals,dispose(){retired=true;originalWindows.clear();}
 };
}

import { object, choice, flag } from './command-schema.js';
import { reminderValueConforms } from './reminders-state.js';
import { clockParts, clockSchema } from './clock-model.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';

export const CLOCK_APP_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
const integer = (minimum, maximum) => ({type:'integer',minimum,maximum});
const text = maxLength => ({type:'string',maxLength});
const id = {...text(128),minLength:1,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const rows = (items,maxItems) => ({type:'array',items,maxItems});
export const clockAppTimeSchema = integer(0,8640000000000000-1);
export const clockAppPages = ['world','alarms','stopwatch','timers'];
export const clockAppSounds = ['Radar','Beacon','Chimes','None'];
export const clockAppZones = clockSchema.properties.timeZone.enum;
export const clockAppAlarmSchema = object({id,name:{...text(80),minLength:1},time:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'},timeZone:choice(...clockAppZones),enabled:flag,days:rows(integer(0,6),7),sound:choice(...clockAppSounds),snooze:flag,lastOccurrenceAt:nullable(clockAppTimeSchema)});
export const clockAppTimerSchema = object({id,name:{...text(80),minLength:1},durationMs:integer(0,359999000),remainingMs:integer(0,359999000),running:flag,repeat:flag,sound:choice(...clockAppSounds),completedCycles:integer(0,Number.MAX_SAFE_INTEGER-1)});
const draft = object({kind:choice('alarm','timer'),id:nullable(id),name:text(80),time:text(5),timeZone:choice(...clockAppZones),days:rows(integer(0,6),7),sound:choice(...clockAppSounds),snooze:flag,durationSeconds:text(16),repeat:flag});
export const clockAppSchema = object({nextId:integer(1,Number.MAX_SAFE_INTEGER-1),lastSceneTime:clockAppTimeSchema,alarms:rows(clockAppAlarmSchema,64),timers:rows(clockAppTimerSchema,64),stopwatch:object({elapsedMs:integer(0,8640000000000000-1),running:flag,laps:rows(object({id,elapsedMs:clockAppTimeSchema,splitMs:clockAppTimeSchema}),512)}),alerts:rows(object({id,sourceId:id,kind:choice('alarm','timer'),label:text(256),dueAt:clockAppTimeSchema,cycles:integer(1,Number.MAX_SAFE_INTEGER-1),status:choice('pending','delivered','snoozed','dismissed'),notificationId:nullable(id),snoozeAt:nullable(clockAppTimeSchema)}),8192),history:rows(object({id,sourceId:id,action:text(32),at:clockAppTimeSchema,elapsedMs:clockAppTimeSchema}),512),preferences:object({notifications:flag,snoozeMinutes:integer(1,60),stopwatchStyle:choice('digital','analog')}),windows:rows(object({windowId:id,page:choice(...clockAppPages),sheet:choice('none','alarm','timer','preferences','about','help','world'),draft:nullable(draft),menu:nullable(choice('Clock','File','Edit','View','Window','Help')),query:text(80)}),64)});
export function clockAppMeta(profile) {
 const localEquivalent = !['macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'].includes(profile?.id);
 return {appId:'clock',name:'Clock',window:{width:820,height:580},localEquivalent,disclosure:localEquivalent?'Local Clock equivalent — Apple Clock was introduced in macOS Ventura 13, not bundled in this release.':profile?.id==='macos-golden-gate-27.0.1'?'Clock — macOS 26 visual reference; unverified future 27 appearance.':'Clock — authored local scene time; no host alarms, sounds or system time changes.'};
}
export function clockAppAllocate(state,prefix,additional=[]){
 let id;
 do{if(!Number.isSafeInteger(state.nextId)||state.nextId>=Number.MAX_SAFE_INTEGER-1)return null;id=`${prefix}-${state.nextId++}`;}while([state.alarms,state.timers,state.alerts,state.history,state.stopwatch.laps,additional].some(rows=>rows.some(row=>row.id===id)));
 return id;
}
export function retainClockAppGraph(root) {
 const captures=[],seen=new Set();
 function visit(value){if(value===null||typeof value!=='object'||seen.has(value))return;seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value);captures.push({value,prototype:Object.getPrototypeOf(value),descriptors});for(const descriptor of Object.values(descriptors)){if(!Object.hasOwn(descriptor,'value'))throw new TypeError('Clock authority cannot contain accessors.');visit(descriptor.value);}}
 try{visit(root);}catch{return()=>false;}
 return()=>{try{return captures.every(({value,prototype,descriptors})=>Object.getPrototypeOf(value)===prototype&&Reflect.ownKeys(value).length===Reflect.ownKeys(descriptors).length&&Reflect.ownKeys(descriptors).every(key=>{const actual=Object.getOwnPropertyDescriptor(value,key),original=descriptors[key];return actual&&['value','enumerable','writable','configurable','get','set'].every(field=>actual[field]===original[field]);}));}catch{return false;}};
}
export function createClockAppState(profile,sceneTime=profile?.defaults?.sceneTime) {
 const time = typeof sceneTime==='number'?sceneTime:Date.parse(sceneTime);
 return {nextId:3,lastSceneTime:Number.isSafeInteger(time)&&time>=0?time:0,alarms:[{id:'alarm-1',name:'Morning call',time:'10:00',timeZone:'UTC',enabled:false,days:[0,1,2,3,4,5,6],sound:'Radar',snooze:true,lastOccurrenceAt:null}],timers:[{id:'timer-2',name:'Break',durationMs:300000,remainingMs:300000,running:false,repeat:false,sound:'Radar',completedCycles:0}],stopwatch:{elapsedMs:0,running:false,laps:[]},alerts:[],history:[],preferences:{notifications:true,snoozeMinutes:9,stopwatchStyle:'digital'},windows:[]};
}
export function validateClockAppState(state,profile) {
 const bad = message => ({ok:false,message});
 if (profile && !CLOCK_APP_PROFILES.includes(profile.id) || !reminderValueConforms(state,clockAppSchema)) return bad('Clock requires its closed bounded canonical graph.');
 const ids=new Set();for(const group of [state.alarms,state.timers,state.alerts,state.history,state.stopwatch.laps])for(const row of group){if(ids.has(row.id))return bad('Clock record IDs must be unique.');ids.add(row.id);}
 if(new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length||state.windows.some(w=>(w.draft!==null)!==['alarm','timer'].includes(w.sheet)||w.draft&&w.draft.kind!==w.sheet))return bad('Clock sheets and drafts must belong to one original native session.');
 if(state.alarms.some(a=>new Set(a.days).size!==a.days.length)||state.timers.some(t=>t.remainingMs>t.durationMs||t.running&&t.remainingMs===0||t.repeat&&t.durationMs===0))return bad('Clock timer duration, repeat and remaining state are inconsistent.');
 let previous=0;for(const lap of [...state.stopwatch.laps].reverse()){if(lap.elapsedMs<previous||lap.elapsedMs>state.stopwatch.elapsedMs||lap.splitMs!==lap.elapsedMs-previous)return bad('Stopwatch splits must match actual cumulative scene elapsed time.');previous=lap.elapsedMs;}
 if(state.alerts.some(a=>(a.status==='snoozed')!==(a.snoozeAt!==null)||(a.status==='pending')!==(a.notificationId===null)))return bad('Clock delivery and snooze ledger must match actual notification acknowledgement.');
 if(canonicalStringUnits(state)>4*1024*1024)return bad('Clock graph exceeds text quota.');return {ok:true};
}
export function formatClockDuration(ms,precise=false){const n=Math.floor(ms/1000);return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${precise?'.'+String(Math.floor(ms%1000/10)).padStart(2,'0'):''}`;}
export function clockWorldPresentation(row,time,systemClock){const p=clockParts(time,row.timeZone);return {...row,time:new Intl.DateTimeFormat('en-US',{timeZone:row.timeZone,hour:'numeric',minute:'2-digit',second:systemClock?.showSeconds?'2-digit':undefined,hour12:!systemClock?.use24Hour}).format(time),date:new Intl.DateTimeFormat('en-US',{timeZone:row.timeZone,weekday:'short',month:'short',day:'numeric'}).format(time),hour:p.hour,minute:p.minute,second:p.second,dayNumber:p.dayNumber};}
// Civil dates, not elapsed 24-hour buckets. DST gaps are skipped; a repeated
// minute fires once at the first occurrence in that civil day.
export function nextClockAlarmDue(alarm,after){
 const p=clockParts(after,alarm.timeZone),[h,m]=alarm.time.split(':').map(Number);
 for(let day=0;day<9;day++){
  const date=new Date(Date.UTC(p.year,p.month-1,p.day+day));if(!Number.isFinite(date.getTime()))return null;
  if(alarm.days.length&&!alarm.days.includes(date.getUTCDay()))continue;
  const naive=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),h,m),offsets=new Set(),matches=[];
  for(let step=-4;step<=4;step++){const sample=naive+step*6*3600000;if(sample<0||sample>=8640000000000000)continue;const q=clockParts(sample,alarm.timeZone);offsets.add(Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second)-sample);}
  for(const offset of offsets){const at=naive-offset;if(at<0||at>=8640000000000000)continue;const q=clockParts(at,alarm.timeZone);if(q.year===date.getUTCFullYear()&&q.month===date.getUTCMonth()+1&&q.day===date.getUTCDate()&&q.hour===h&&q.minute===m)matches.push(at);}
  const first=Math.min(...matches);if(Number.isFinite(first)&&first>after&&(alarm.lastOccurrenceAt===null||first>alarm.lastOccurrenceAt))return first;
 }
 return null;
}
export function advanceClockApp(state,time){
 const candidate=copyCanonicalData(state),before=candidate.lastSceneTime;
 if(!Number.isSafeInteger(time)||time<0||time>=8640000000000000)return {ok:false,message:'Use bounded authored scene time.'};
 // Rewinds rebase running counters; completed civil occurrences never replay.
 const elapsed=Math.max(0,time-before);candidate.lastSceneTime=time;
 if(candidate.stopwatch.running){if(candidate.stopwatch.elapsedMs+elapsed>=8640000000000000)return {ok:false,message:'Stopwatch elapsed time exceeds the bounded scene duration.'};candidate.stopwatch.elapsedMs+=elapsed;}
 const alert=(source,kind,dueAt,cycles=1)=>{if(candidate.alerts.length>=8192)return false;candidate.alerts.push({id:clockAppAllocate(candidate,'clock-alert'),sourceId:source.id,kind,label:source.name,dueAt,cycles,status:'pending',notificationId:null,snoozeAt:null});candidate.history.push({id:clockAppAllocate(candidate,'clock-history'),sourceId:source.id,action:kind==='timer'?(cycles>1?`repeat:${cycles}`:'timer-end'):'alarm-due',at:dueAt,elapsedMs:kind==='timer'?source.durationMs:0});if(candidate.history.length>512)candidate.history.shift();return true;};
 for(const timer of candidate.timers){if(!timer.running)continue;if(elapsed<timer.remainingMs){timer.remainingMs-=elapsed;continue;}const due=before+timer.remainingMs,cycles=timer.repeat?1+Math.floor((elapsed-timer.remainingMs)/timer.durationMs):1;if(!alert(timer,'timer',due,cycles))return {ok:false,message:'Clock delivery ledger is full.'};timer.completedCycles+=cycles;if(timer.repeat){timer.remainingMs=timer.durationMs-((elapsed-timer.remainingMs)%timer.durationMs);}else{timer.remainingMs=0;timer.running=false;}}
 for(const alarm of candidate.alarms){if(!alarm.enabled||!elapsed)continue;let due=nextClockAlarmDue(alarm,before),count=0;while(due!==null&&due<=time){if(++count>8192||!alert(alarm,'alarm',due))return {ok:false,message:'Clock alarm catch-up exceeds bounded ledger; shorten scene advance or clear completed alerts.'};alarm.lastOccurrenceAt=due;if(alarm.days.length===0){alarm.enabled=false;break;}due=nextClockAlarmDue(alarm,due);}}
 return {ok:true,candidate};
}
export function migrateWindowsClockState(original,profile,sceneTime){
 const state=createClockAppState(profile,sceneTime);if(!original)return state;
 state.alarms=(original.alarms??[]).map(a=>{const [hour,minute]=a.time.split(':').map(Number),originalDay=Math.floor((original.sceneSeconds??0)/86400),sceneDay=Math.floor(state.lastSceneTime/86400000);return {id:a.id,name:a.name,time:a.time,timeZone:'UTC',enabled:a.enabled,days:[0,1,2,3,4,5,6],sound:'Radar',snooze:true,lastOccurrenceAt:a.lastDay>=0?Math.max(0,(sceneDay+a.lastDay-originalDay)*86400000+hour*3600000+minute*60000):null};});
 if(original.timer)state.timers=[{id:'timer-migrated',name:original.timer.name,durationMs:original.timer.duration*1000,remainingMs:original.timer.remaining*1000,running:original.timer.running,repeat:false,sound:'Radar',completedCycles:0}];
 if(original.stopwatch)state.stopwatch={elapsedMs:original.stopwatch.elapsed*1000,running:original.stopwatch.running,laps:original.stopwatch.laps.map(l=>({id:l.id,elapsedMs:l.elapsed*1000,splitMs:l.split*1000}))};state.nextId=Math.max(original.nextId??1,3);
 for(const n of original.notifications??[])state.alerts.push({id:`clock-migrated-${n.id}`,sourceId:'legacy-clock',kind:'alarm',label:n.label,dueAt:state.lastSceneTime,cycles:1,status:'pending',notificationId:null,snoozeAt:null});
 return state;
}
export function migrateWindowsClockWindow(original,windowId){
 const page={alarms:'alarms',timer:'timers',stopwatch:'stopwatch'}[original?.page]??'world',kind=original?.ui?.dialog;
 const window={windowId,page,sheet:'none',draft:null,menu:original?.ui?.menu?'Clock':null,query:''};
 if(['alarm','timer'].includes(kind)&&original.draft){const d=original.draft;window.sheet=kind;window.draft={kind,id:kind==='timer'?'timer-migrated':d.id??null,name:d.name,time:d.time??'10:00',timeZone:'UTC',days:[0,1,2,3,4,5,6],sound:'Radar',snooze:true,durationSeconds:d.duration??'300',repeat:false};}
 return window;
}
export function seedClockWidgetSources(widgets){
 if(widgets.sources.clockCities.length)return widgets;
 widgets.sources.clockCities.push({id:'los-angeles',name:'Los Angeles',timeZone:'America/Los_Angeles'},{id:'new-york',name:'New York',timeZone:'America/New_York'},{id:'london',name:'London',timeZone:'Europe/London'},{id:'tokyo',name:'Tokyo',timeZone:'Asia/Tokyo'});
 if(!widgets.selected.clockCityIds.length)widgets.selected.clockCityIds.push(...widgets.sources.clockCities.map(c=>c.id));
 return widgets;
}

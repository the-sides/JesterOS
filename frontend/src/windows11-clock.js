import { identity, text, flag, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState } from './windows11-app-helpers.js';
export const menus=['options'];
export const pages=['alarms','timer','stopwatch'];
export const createState=()=>({ui:uiState(),page:'timer',sceneSeconds:9*3600+41*60,alarms:[{id:'alarm-1',name:'Morning call',time:'10:00',enabled:false,lastDay:-1}],nextId:2,timer:{duration:300,remaining:300,running:false,name:'Break'},stopwatch:{elapsed:0,running:false,laps:[]},draft:null,notifications:[]});
export const needsTicks=apps=>apps.clock.timer.running||apps.clock.stopwatch.running||apps.clock.alarms.some(a=>a.enabled);
export const specs={
 'win11.clock.page':[object({page:choice(...pages)}),empty],
 'win11.clock.tick':[empty,object({seconds:{type:'integer',minimum:1,maximum:60}}),['fictional time','timer','stopwatch'],['elapsed ticks']],
 'win11.clock.timer':[empty,object({action:choice('start','pause','reset')})],
 'win11.clock.stopwatch':[empty,object({action:choice('start','pause','reset','lap')})],
 'win11.clock.dialog':[empty,object({kind:choice('alarm','timer','none')})],
 'win11.clock.editAlarm':[object({alarmId:identity}),empty],
 'win11.clock.draft':[object({field:choice('name','time','duration')}),object({value:text})],
 'win11.clock.save':[empty,empty],
 'win11.clock.alarmSet':[object({alarmId:identity}),object({enabled:flag})],
 'win11.clock.alarmDelete':[object({alarmId:identity}),empty],
 'win11.clock.dismiss':[object({notificationId:identity}),empty],
};
export const formatDuration=seconds=>{const n=Math.floor(seconds);return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
export function createCommands(apps){const s=apps.clock;return {
 'win11.clock.page':({page})=>{s.page=page;s.ui.menu=null;return applied({page});},
 'win11.clock.tick':(_,{seconds})=>{if(!needsTicks(apps))return stale('No clock workflow is running.');const before=s.sceneSeconds;s.sceneSeconds+=seconds;if(s.timer.running){s.timer.remaining=Math.max(0,s.timer.remaining-seconds);if(!s.timer.remaining){s.timer.running=false;s.notifications.push({id:`notification-${s.nextId++}`,label:`${s.timer.name} — timer finished`});}}if(s.stopwatch.running)s.stopwatch.elapsed+=seconds;for(const a of s.alarms){if(!a.enabled)continue;const [h,m]=a.time.split(':').map(Number);for(let day=Math.floor(before/86400);day<=Math.floor(s.sceneSeconds/86400);day++){const at=day*86400+h*3600+m*60;if(before<at&&s.sceneSeconds>=at&&a.lastDay!==day){a.lastDay=day;s.notifications.push({id:`notification-${s.nextId++}`,label:`${a.name} — ${a.time}`});}}}return applied();},
 'win11.clock.timer':(_,{action})=>{if(action==='start'){if(s.timer.running||s.timer.remaining<=0)return stale('Reset the completed timer before starting.');s.timer.running=true;}else if(action==='pause'){if(!s.timer.running)return stale();s.timer.running=false;}else{s.timer.running=false;s.timer.remaining=s.timer.duration;}return applied();},
 'win11.clock.stopwatch':(_,{action})=>{const sw=s.stopwatch;if(action==='start'){if(sw.running)return stale();sw.running=true;}else if(action==='pause'){if(!sw.running)return stale();sw.running=false;}else if(action==='lap'){if(!sw.running)return stale('Start the stopwatch first.');sw.laps.unshift({id:`lap-${s.nextId++}`,elapsed:sw.elapsed,split:sw.elapsed-(sw.laps[0]?.elapsed||0)});}else{sw.running=false;sw.elapsed=0;sw.laps=[];}return applied();},
 'win11.clock.dialog':(_,{kind})=>{if(kind==='none'){s.ui.dialog=null;s.draft=null;return applied();}if(kind==='timer'){if(s.timer.running)return stale('Pause the timer before editing.');s.draft={name:s.timer.name,duration:String(s.timer.duration)};}else{s.draft={id:null,name:'Alarm',time:'10:00'};}s.ui.dialog=kind;s.ui.menu=null;return applied();},
 'win11.clock.editAlarm':({alarmId})=>{const alarm=s.alarms.find(a=>a.id===alarmId);if(!alarm)return stale();s.draft={id:alarm.id,name:alarm.name,time:alarm.time};s.ui.dialog='alarm';return applied({alarmId});},
 'win11.clock.draft':({field},{value})=>{if(!s.draft||!s.ui.dialog)return stale();if(!(field in s.draft)||field==='id')return invalid();s.draft[field]=value;return applied({field});},
 'win11.clock.save':()=>{if(!s.draft||!s.ui.dialog)return stale();const d=s.draft;if(!d.name.trim()||d.name.length>80)return invalid('Enter a name of 1–80 characters.');if(s.ui.dialog==='timer'){const duration=Number(d.duration);if(!/^\d+$/.test(d.duration)||!Number.isInteger(duration)||duration<1||duration>359999)return invalid('Duration must be 1–359999 seconds.');if(s.timer.running)return stale();s.timer={name:d.name.trim(),duration,remaining:duration,running:false};}else{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))return invalid('Use a 24-hour HH:MM time.');if(d.id){const a=s.alarms.find(a=>a.id===d.id);if(!a)return stale();a.name=d.name.trim();a.time=d.time;}else s.alarms.push({id:`alarm-${s.nextId++}`,name:d.name.trim(),time:d.time,enabled:true,lastDay:-1});}s.ui.dialog=null;s.draft=null;return applied();},
 'win11.clock.alarmSet':({alarmId},{enabled})=>{const a=s.alarms.find(a=>a.id===alarmId);if(!a)return stale();a.enabled=enabled;return applied({alarmId});},
 'win11.clock.alarmDelete':({alarmId})=>{if(!s.alarms.some(a=>a.id===alarmId))return stale();s.alarms=s.alarms.filter(a=>a.id!==alarmId);if(s.draft?.id===alarmId){s.draft=null;s.ui.dialog=null;}return applied({alarmId});},
 'win11.clock.dismiss':({notificationId})=>{if(!s.notifications.some(n=>n.id===notificationId))return stale();s.notifications=s.notifications.filter(n=>n.id!==notificationId);return applied({notificationId});},
};}
export const readTargets=apps=>({pages:[...pages],menus:[...menus],menu:apps.clock.ui.menu,page:apps.clock.page,sceneTime:formatDuration(apps.clock.sceneSeconds%86400),alarms:apps.clock.alarms.map(a=>({...a})),timer:{...apps.clock.timer},stopwatch:{...apps.clock.stopwatch,laps:apps.clock.stopwatch.laps.map(l=>({...l}))},dialog:apps.clock.ui.dialog,draft:apps.clock.draft?{...apps.clock.draft}:null,draftFields:apps.clock.ui.dialog==='timer'?['name','duration']:apps.clock.ui.dialog==='alarm'?['name','time']:[],notifications:apps.clock.notifications.map(n=>({...n})),availability:{timerStart:!apps.clock.timer.running&&apps.clock.timer.remaining>0,timerPause:apps.clock.timer.running,timerEdit:!apps.clock.timer.running,stopwatchStart:!apps.clock.stopwatch.running,stopwatchPause:apps.clock.stopwatch.running,lap:apps.clock.stopwatch.running,save:apps.clock.ui.dialog!==null},running:needsTicks(apps)});

import { object,choice,empty,flag,defineCommand } from './command-schema.js';
import { ACTIVITY_PROFILES,ACTIVITY_TABS,ACTIVITY_COLUMNS,activityId,activityText,activityNumber,activityPreferencesSchema } from './activity-state.js';
export const activityWindowTarget=object({windowId:activityId});
export const activityCommandPayloads={
 'activity.tab':object({tab:choice(...ACTIVITY_TABS)}),'activity.search':object({query:activityText(512)}),
 'activity.page':object({page:choice('processes','performance')}),
 'activity.sort':object({column:choice(...ACTIVITY_COLUMNS),descending:flag},['column']),
 'activity.select':object({processId:activityId}),'activity.refresh':empty,
 'activity.inspect':object({mode:choice('inspector','sample','statistics'),processId:activityId},['mode']),
 'activity.requestQuit':object({force:flag},[]),'activity.confirmQuit':object({confirm:flag}),
 'activity.preferences':object({values:activityPreferencesSchema}),
 'activity.panel':object({panel:choice('none','preferences','help','save')}),
 'activity.saveSample':object({name:activityText(256,1)},[]),
 'activity.focus':object({controlId:activityText(128,1)}),'activity.scroll':object({top:activityNumber(0,1000000)})
};
export const activityCatalog=Object.fromEntries(Object.entries(activityCommandPayloads).map(([name,payload])=>defineCommand(ACTIVITY_PROFILES,name,'activity.local',activityWindowTarget,payload,['Original Root process lifecycle, actual running app/window, mounted native view and authored scene time.','Actual guarded Root app quit/force quit; no host process operations or fictional stack traces.'],['Native Activity Monitor / Task Manager counterpart with explicitly qualified local diagnostics.'],['activity'],[],activityWindowTarget)));

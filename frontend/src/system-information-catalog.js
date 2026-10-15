import { object, choice, empty, flag, defineCommand } from './command-schema.js';
import { SYSTEM_INFORMATION_PROFILES,systemInformationId,systemInformationText,systemInformationInteger } from './system-information-state.js';
export const systemInformationWindowTarget=object({windowId:systemInformationId});
export const systemInformationCommandPayloads={
 'systeminformation.select':object({sectionId:systemInformationText(256,1),itemIndex:systemInformationInteger(0,511)},['sectionId']),
 'systeminformation.search':object({query:systemInformationText()}),
 'systeminformation.expand':object({group:choice('hardware','network','software'),expanded:flag}),
 'systeminformation.detail':object({detail:choice('more','less')}),
 'systeminformation.live':empty,
 'systeminformation.open':object({fileId:systemInformationId},[]),
 'systeminformation.save':object({name:systemInformationText(256,1),format:choice('spx','text'),saveAs:flag},[]),
 'systeminformation.print':empty,
 'systeminformation.panel':object({panel:choice('none','save','help')}),
 'systeminformation.menu':object({menu:choice('none','file','view','help')}),
 'systeminformation.focus':object({controlId:systemInformationText(256,1)}),
 'systeminformation.scroll':object({top:{type:'number',minimum:0,maximum:1e7},observe:flag},['top']),
 'systeminformation.close':empty,
};
export const systemInformationCatalog=Object.fromEntries(Object.entries(systemInformationCommandPayloads).map(([name,payload])=>defineCommand(SYSTEM_INFORMATION_PROFILES,name,'systeminformation.local',systemInformationWindowTarget,payload,['Original shared inventory/profile/system/Files graph, window, mounted view and authored scene time.','Apple XML system_profiler .spx or explicit supported text report. Genuine Windows NFO unsupported.'],['Native category tree, report details/search, actual shared Open/Print destination.'],['systeminformation'],[],systemInformationWindowTarget)));

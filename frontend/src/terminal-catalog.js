import { object, choice, empty, defineCommand } from './command-schema.js';
import { TERMINAL_PROFILES,terminalId,terminalText,terminalInt,terminalAppearanceSchema,terminalEndpointSchema } from './terminal-state.js';
export const terminalWindowTarget=object({windowId:terminalId});
const tab={tabId:terminalId};
export const terminalCommandPayloads={
 'terminal.input':object({...tab,input:terminalText(4096)}),
 'terminal.run':object(tab),'terminal.history':object({...tab,direction:choice('previous','next')}),
 'terminal.newTab':object({profile:terminalAppearanceSchema},[]),'terminal.activateTab':object(tab),'terminal.closeTab':object(tab),
 'terminal.clear':object(tab),'terminal.interrupt':object(tab),
 'terminal.selection':object({...tab,start:terminalInt(0,65536),end:terminalInt(0,65536)}),
 'terminal.copy':object({...tab,source:choice('input','scrollback'),start:terminalInt(0,65536),end:terminalInt(0,65536)},['tabId']),'terminal.paste':object({...tab,start:terminalInt(0,4096),end:terminalInt(0,4096)},['tabId']),
 'terminal.profile':object({...tab,values:terminalAppearanceSchema}),
 'terminal.panel':object({panel:choice('none','profiles','ssh','help')}),
 'terminal.endpoint':object({endpoint:terminalEndpointSchema}),
 'terminal.removeEndpoint':object({endpointId:terminalId}),
 'terminal.newWindow':empty,'terminal.closeWindow':empty,'terminal.quit':empty,
 'terminal.focus':object({controlId:terminalText(128,1)}),
 'terminal.scroll':object({top:terminalInt(0,1000000)})
};
export const terminalCatalog=Object.fromEntries(Object.entries(terminalCommandPayloads).map(([name,payload])=>defineCommand(TERMINAL_PROFILES,name,'terminal.local',terminalWindowTarget,payload,['Original complete canonical Terminal graph, Root window, mounted view, scene time and source Files identities.','Virtual shell only; Files batches and shell history publish atomically under the complete scene text budget.'],[name.slice(9)+' in a genuine per-window local terminal.'],['terminal'],[],terminalWindowTarget)));

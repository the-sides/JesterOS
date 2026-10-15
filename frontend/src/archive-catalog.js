import {object,choice,empty,defineCommand} from './command-schema.js';
import {ARCHIVE_PROFILES,archiveIdSchema,archivePreferencesSchema} from './archive-state.js';
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength});
export const archiveWindowTarget=object({windowId:archiveIdSchema});
export const archiveCommandPayloads={
 'archive.select':object({fileIds:{type:'array',items:archiveIdSchema,maxItems:128},mode:choice('compress','expand')}),
 'archive.open':object({mode:choice('compress','expand')},[]),
 'archive.configure':object({mode:choice('compress','expand'),format:choice('zip','tar','gzip'),destination:choice('default','same','documents','desktop','downloads'),outputName:text(240)},[]),
 'archive.run':empty,'archive.cancel':empty,'archive.preferences':object({values:archivePreferencesSchema}),
 'archive.panel':object({panel:choice('none','preferences','help')}),'archive.reveal':object({fileId:archiveIdSchema}),
 'archive.focus':object({controlId:text(128,1)}),'archive.scroll':object({top:{type:'number',minimum:0,maximum:1000000}})
};
export const archiveCatalog=Object.fromEntries(Object.entries(archiveCommandPayloads).map(([name,payload])=>defineCommand(ARCHIVE_PROFILES,name,'archive.local',archiveWindowTarget,payload,['Original canonical Archive Utility window, native view, authored clock and shared source Files.','Bounded genuine ZIP DEFLATE, USTAR or single-member Gzip; no host/network effects.'],['Native progress, cancellable cooperative codec, destinations and preferences.'],['archive'],[],archiveWindowTarget)));

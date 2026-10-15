import { copyCanonicalData } from './canonical-data.js';
export const consoleExportFormats={text:{mime:'text/plain',extension:'log'},json:{mime:'application/json',extension:'json'},report:{mime:'text/plain',extension:'event-report.txt'}};
const stamp=time=>new Date(time).toISOString();
export function formatConsoleEvents(entries,format,{profileId,sceneTime}) {
 if(!Object.hasOwn(consoleExportFormats,format))throw new Error('Unsupported event export format.');
 // Detached snapshot is only generated output, never retained app event state.
 if(format==='json')return JSON.stringify({format:'jesteros-scene-events',version:1,profileId,exportedAt:sceneTime,entries:copyCanonicalData(entries)},null,2)+'\n';
 if(format==='text')return entries.map(e=>`${stamp(e.time)}\t${e.severity}\t${e.sourceAppId??'scene'}\t${e.command}\t${e.status}`).join('\n')+'\n';
 return ['JesterOS Local Scene Event Report',`Profile: ${profileId}`,`Generated: ${stamp(sceneTime)}`,`Events: ${entries.length}`,'Source: actual transient scene actions; not a host OS diagnostic archive.','',...entries.flatMap(e=>[`Event: ${e.id}`,`Time: ${stamp(e.time)}`,`Application: ${e.sourceAppId??'scene operation'}`,`Window: ${e.sourceWindowId??'none'}`,`Command: ${e.command}`,`Status: ${e.status}`,`Severity: ${e.severity}`,''])].join('\n')+'\n';
}

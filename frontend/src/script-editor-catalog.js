import { object, choice, empty, defineCommand } from './command-schema.js';
import { SCRIPT_EDITOR_PROFILES,scriptEditorIdSchema,scriptEditorPreferencesSchema } from './script-editor-state.js';
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength}),position={type:'integer',minimum:0,maximum:65536};
export const scriptEditorWindowTarget=object({windowId:scriptEditorIdSchema});
export const scriptEditorCommandPayloads={
 'scriptEditor.edit':object({source:text(65536),selectionStart:position,selectionEnd:position},['source']),
 'scriptEditor.compile':empty,'scriptEditor.run':empty,'scriptEditor.stop':empty,'scriptEditor.new':empty,
 'scriptEditor.open':object({fileId:scriptEditorIdSchema},[]),
 'scriptEditor.save':object({name:text(256,1),saveAs:{type:'boolean'}},[]),
 'scriptEditor.preferences':object({values:scriptEditorPreferencesSchema}),
 'scriptEditor.properties':object({description:text(2048)}),
 'scriptEditor.dictionary':object({query:text(256),suite:choice('standard','files','commands'),command:text(256)},[]),
 'scriptEditor.panel':object({panel:choice('none','dictionary','properties','preferences','save','help')}),
 'scriptEditor.tab':object({tab:choice('result','log','history')}),
 'scriptEditor.clear':object({panel:choice('log','history')}),
 'scriptEditor.restore':object({entryId:scriptEditorIdSchema}),
 'scriptEditor.closeDecision':object({decision:choice('save','discard','cancel')}),
 'scriptEditor.focus':object({controlId:text(128,1)}),
 'scriptEditor.scroll':object({top:{type:'number',minimum:0,maximum:1000000}})
};
export const scriptEditorCatalog=Object.fromEntries(Object.entries(scriptEditorCommandPayloads).map(([name,payload])=>defineCommand(SCRIPT_EDITOR_PROFILES,name,'script-editor.local',scriptEditorWindowTarget,payload,['Original Script Editor graph, Root window, view and authored scene time.','Bounded real simulated-language parsing; registered Root commands and virtual Files only.'],['Native guarded Script Editor control.'],['scriptEditor'],[],scriptEditorWindowTarget)));

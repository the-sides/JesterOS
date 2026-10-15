import { object, choice, empty, defineCommand, flag } from './command-schema.js';
import { AUTOMATOR_PROFILES, automatorIdSchema, autoText, autoInt, autoArray, automatorTypeSchema, automatorActionSchema, automatorParameters, automatorVariableSchema, automatorPreferencesSchema } from './automator-state.js';
export const automatorWindowTarget=object({windowId:automatorIdSchema});
export const automatorCommandPayloads={
 'automator.new':object({type:automatorTypeSchema},[]),
 'automator.open':object({fileId:automatorIdSchema},[]),
 'automator.save':object({name:autoText(256,1),saveAs:flag},[]),
 'automator.search':object({query:autoText(128),category:choice('All','Files & Folders','Photos','Text','Utilities')},['query']),
 'automator.addAction':object({kind:choice(...Object.keys(automatorParameters)),index:autoInt(0,64)},['kind']),
 'automator.addFiles':object({fileIds:autoArray(automatorIdSchema,64)}),
 'automator.editAction':object({action:automatorActionSchema}),
 'automator.selectAction':object({actionId:automatorIdSchema}),
 'automator.moveAction':object({actionId:automatorIdSchema,index:autoInt(0,63)}),
 'automator.deleteAction':object({actionId:automatorIdSchema}),
 'automator.setVariable':object({variable:automatorVariableSchema}),
 'automator.deleteVariable':object({variableId:automatorIdSchema}),
 'automator.run':object({inputIds:autoArray(automatorIdSchema,64),confirmed:flag},[]),
 'automator.stop':empty,'automator.clearLog':empty,
 'automator.preferences':object({values:automatorPreferencesSchema}),
 'automator.panel':object({panel:choice('none','new','save','preferences','help')}),
 'automator.closeDecision':object({decision:choice('save','discard','cancel')}),
 'automator.focus':object({controlId:autoText(128,1)}),
 'automator.scroll':object({top:{type:'number',minimum:0,maximum:1000000}})
};
export const automatorCatalog=Object.fromEntries(Object.entries(automatorCommandPayloads).map(([name,payload])=>defineCommand(AUTOMATOR_PROFILES,name,'automator.local',automatorWindowTarget,payload,['Original canonical workflow, Root window, native view and scene time; actual original Files and registered apps only.','Local .jworkflow JSON; file-changing runs publish all Files operations, results and bounded logs together.'],[`${name.slice(10)} in the actual native workflow editor.`],['automator','files'],[],automatorWindowTarget)));

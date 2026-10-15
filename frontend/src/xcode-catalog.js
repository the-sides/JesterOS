import {object,choice,empty,defineCommand} from './command-schema.js';
import {XCODE_PROFILES,xcodeIdSchema,xcodeProjectSchema} from './xcode-state.js';
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength}),integer=(minimum=0,maximum=65536)=>({type:'integer',minimum,maximum});
export const xcodeWindowTarget=object({windowId:xcodeIdSchema});
export const xcodeCommandPayloads={
 'xcode.new':empty,'xcode.chooser':object({options:xcodeProjectSchema}), 'xcode.createProject':object({options:xcodeProjectSchema},[]),
 'xcode.open':object({fileId:xcodeIdSchema},[]),'xcode.save':object({name:text(256,1),saveAs:{type:'boolean'}},[]),
 'xcode.addFile':object({fileId:xcodeIdSchema,path:text(256,1)},[]),'xcode.newSource':object({path:text(256,1),language:choice('swift','objc')}),
 'xcode.removeSource':object({sourceId:xcodeIdSchema}),'xcode.selectSource':object({sourceId:xcodeIdSchema,line:integer(1)},['sourceId']),
 'xcode.closeSource':object({sourceId:xcodeIdSchema}),
 'xcode.edit':object({source:text(65536),selectionStart:integer(),selectionEnd:integer()},['source']),
 'xcode.undo':empty,'xcode.redo':empty,'xcode.restoreHistory':object({entryId:xcodeIdSchema}),
 'xcode.search':object({query:text(512)}),'xcode.navigator':object({navigator:choice('project','search','issues','debug','breakpoints')}),
 'xcode.group':object({path:text(256,1),expanded:{type:'boolean'}}),
 'xcode.inspector':object({inspector:choice('file','project','history'),visible:{type:'boolean'}},[]),
 'xcode.build':empty,'xcode.clean':empty,'xcode.run':empty,'xcode.stop':empty,'xcode.step':empty,'xcode.continue':empty,
 'xcode.breakpoint':object({sourceId:xcodeIdSchema,line:integer(1),enabled:{type:'boolean'}},['sourceId','line']),
 'xcode.simulator':object({visible:{type:'boolean'}}),'xcode.debug':object({visible:{type:'boolean'}}),
 'xcode.projectOptions':object({options:xcodeProjectSchema}),
 'xcode.panel':object({panel:choice('chooser','options','none','save','scheme','settings','help')}),
 'xcode.settings':object({fontSize:integer(10,24),wrap:{type:'boolean'}},[]),
 'xcode.closeDecision':object({decision:choice('save','discard','cancel')}),
 'xcode.focus':object({controlId:text(128,1)}),'xcode.scroll':object({top:{type:'number',minimum:0,maximum:1000000}}),
 'xcode.print':empty,'xcode.share':empty
};
export const xcodeCatalog=Object.fromEntries(Object.entries(xcodeCommandPayloads).map(([name,payload])=>defineCommand(XCODE_PROFILES,name,'xcode.local-development',xcodeWindowTarget,payload,['Original Xcode canonical graph, live Root Window, original source Files and authored scene time.','Only the explicitly supported bounded Swift / Objective-C subset is interpreted locally.'],['Native period Xcode control or explicitly labeled Windows local equivalent.'],['xcode'],[],xcodeWindowTarget)));

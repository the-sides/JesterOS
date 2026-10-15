import { object,choice,empty,flag,defineCommand } from './command-schema.js';
import { IMAGE_PLAYGROUND_PROFILES,IMAGE_PLAYGROUND_CONCEPTS,imagePlaygroundId,imagePlaygroundText,imagePlaygroundInt,imagePlaygroundRecipeSchema } from './image-playground-state.js';
export const imagePlaygroundWindowTarget=object({windowId:imagePlaygroundId});
export const imagePlaygroundCommandPayloads={
 'imageplayground.new':empty,'imageplayground.open':object({fileId:imagePlaygroundId},[]),'imageplayground.window.new':object({documentId:imagePlaygroundId},[]),
 'imageplayground.document.select':object({documentId:imagePlaygroundId}),'imageplayground.document.delete':empty,
 'imageplayground.recipe.update':object(Object.fromEntries(Object.entries(imagePlaygroundRecipeSchema.properties).filter(([k])=>k!=='person')),[]),
 'imageplayground.concept.toggle':object({concept:choice(...IMAGE_PLAYGROUND_CONCEPTS)}),
 'imageplayground.people.select':object({photoId:imagePlaygroundId,name:imagePlaygroundText(128,1)}),'imageplayground.people.clear':empty,
 'imageplayground.generate':empty,'imageplayground.variation':object({direction:choice('next','previous')}),'imageplayground.history.restore':object({index:imagePlaygroundInt(0,11)}),
 'imageplayground.undo':empty,'imageplayground.redo':empty,
 'imageplayground.save':object({name:imagePlaygroundText(240,1),saveAs:flag},[]),'imageplayground.export':object({name:imagePlaygroundText(240,1)},[]),
 'imageplayground.copy':empty,'imageplayground.share':empty,
 'imageplayground.panel':object({panel:choice('none','people','save','export','help','close')}),
 'imageplayground.menu':object({menuId:{anyOf:[{type:'null'},choice('app','file','edit','image','view','window','help')]}}),
 'imageplayground.close':object({decision:choice('save','discard','cancel')},[]),'imageplayground.focus':object({controlId:imagePlaygroundText(128,1)}),
 'imageplayground.scroll':object({areaId:choice('gallery','editor','concepts'),top:{type:'number',minimum:0,maximum:1000000},left:{type:'number',minimum:0,maximum:1000000}})
};
export const imagePlaygroundCatalog=Object.fromEntries(Object.entries(imagePlaygroundCommandPayloads).map(([name,payload])=>defineCommand(IMAGE_PLAYGROUND_PROFILES,name,'imageplayground.local',imagePlaygroundWindowTarget,payload,['Original bounded actor, nested recipes/history, actual window/view/profile/sceneTime and source Files/Photos/permission rows.','Explicit authored procedural renderer; unsupported prompt words reject. No AI/model/likeness or proprietary Apple format.'],['Actual local canvas pixels and custom editable recipes; atomic Root files, canonical Photos permission, share and image clipboard.'],['imageplayground'],[],imagePlaygroundWindowTarget)));

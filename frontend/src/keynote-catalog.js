import { object,choice,empty,flag,defineCommand } from './command-schema.js';
import { KEYNOTE_PROFILES,keynoteId,keynoteText,keynoteNumber,keynoteColor,keynoteObjectSchema } from './keynote-state.js';
export const keynoteWindowTarget=object({windowId:keynoteId});
const patch=object(Object.fromEntries(Object.entries(keynoteObjectSchema.properties).filter(([k])=>!['id','type','content','mime','fileId','fileRevision','duration'].includes(k))),[]);
export const keynoteCommandPayloads={
 'keynote.new':object({theme:choice('white','black','gradient','showcase'),title:keynoteText(256,1)},['theme']),
 'keynote.open':object({fileId:keynoteId},[]),
 'keynote.document.select':object({documentId:keynoteId}),
 'keynote.document.rename':object({title:keynoteText(256,1)}),
 'keynote.save':object({name:keynoteText(256,1),saveAs:flag},[]),
 'keynote.export':object({format:choice('pptx','pdf','png','svg'),name:keynoteText(256,1)},['format']),
 'keynote.print':empty,'keynote.share':empty,
 'keynote.slide.select':object({slideId:keynoteId}),
 'keynote.slide.add':empty,'keynote.slide.duplicate':empty,'keynote.slide.delete':empty,
 'keynote.slide.move':object({index:{type:'integer',minimum:0,maximum:127}}),
 'keynote.slide.update':object({name:keynoteText(256,1),background:keynoteColor,notes:keynoteText(32768),transition:choice('none','fade','push','wipe'),transitionDuration:keynoteNumber(.1,10)},[]),
 'keynote.object.select':object({objectId:{anyOf:[{type:'null'},keynoteId]}}),
 'keynote.object.add':object({type:choice('text','shape','chart'),shape:choice('rect','ellipse','triangle','line')},['type']),
 'keynote.object.update':object({values:patch}),
 'keynote.object.delete':empty,'keynote.object.duplicate':empty,
 'keynote.object.order':object({direction:choice('front','back','forward','backward')}),
 'keynote.media.insert':object({fileId:keynoteId},[]),
 'keynote.media.play':object({playing:flag}),
 'keynote.undo':empty,'keynote.redo':empty,
 'keynote.copy':empty,'keynote.paste':empty,
 'keynote.present':object({playing:flag}),
 'keynote.present.step':object({direction:choice('next','previous','first','last')}),
 'keynote.view':object({inspector:choice('format','animate','document'),navigator:flag,notes:flag,zoom:keynoteNumber(.25,2)},[]),
 'keynote.panel':object({panel:choice('none','themes','save','export','help','close')}),
 'keynote.menu':object({menuId:{anyOf:[{type:'null'},choice('app','file','edit','insert','slide','format','arrange','view','play','window','help')]}}),
 'keynote.close':object({decision:choice('save','discard','cancel')},[]),
 'keynote.focus':object({controlId:keynoteText(128,1)}),
 'keynote.scroll':object({areaId:choice('slides','canvas','inspector'),top:keynoteNumber(0,1000000),left:keynoteNumber(0,1000000)})
};
export const keynoteCatalog=Object.fromEntries(Object.entries(keynoteCommandPayloads).map(([name,payload])=>defineCommand(KEYNOTE_PROFILES,name,'keynote.documents',keynoteWindowTarget,payload,['Original canonical actor, document/slides/media/history, scene time, window, native view and source Files.','Genuine PPTX codec. Proprietary .key/IWA and embedded audiovisual PPTX export are unavailable.'],['Edit or present actual authored local slides; Root owns all file/print/share/clipboard destinations.'],['keynote'],[],keynoteWindowTarget)));

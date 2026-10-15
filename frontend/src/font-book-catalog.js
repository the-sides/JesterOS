import {object,choice,flag,empty,defineCommand} from './command-schema.js';
import {FONT_BOOK_PROFILES,fontText as str,fontInt as int,fontIdSchema as id} from './font-book-state.js';
export const fontBookTargetSchema=object({windowId:id});
const partial=fields=>object(fields,[]),nullable=s=>({anyOf:[{type:'null'},s]});
export const fontBookCommandSpecs={
 navigate:[partial({search:str(256),source:choice('all','user','bundled','collection'),collectionId:nullable(id),selectedId:nullable(id)}),'Filter sources, collections and actual font names.'],
 preview:[partial({view:choice('grid','sample','list'),preview:choice('sample','repertoire','custom','information'),sample:str(4096),size:int(8,144)}),'Render actual loaded font bytes, custom text and Unicode cmap repertoire; native modern Grid/Sample/List views.'],
 panel:[object({panel:choice('none','preferences','validation','duplicates','collection')}),'Open actual local sheets.'],
 menu:[object({menu:nullable(choice('fontbook','file','edit','view','window','help'))}),'Open native menus.'],
 install:[partial({fileId:id,duplicates:choice('keep','skip','replace')}),'Parse TTF/OTF original Files; genuine byte signature and bounds/checksum validation.'],
 font:[object({operation:choice('enable','disable','remove','validate','export'),fontId:id}),'Enable, disable, remove, validate or export real font sources.'],
 duplicates:[partial({keepId:id}),'Deactivate duplicated PostScript names, retaining selected or first active source.'],
 collection:[object({operation:choice('create','rename','delete','add','remove'),collectionId:id,name:str(128,1),fontId:id},['operation']),'Manage original authoritative shared collections and memberships.'],
 preferences:[partial({installTarget:choice('user','computer'),automaticValidation:flag}),'Retain actual local installation preferences (no host install).'],
 focus:[object({controlId:str(128,1)}),'Focus actual mounted original controls.'],
 'window.close':[empty,'Close actual original native window.']
};
export const fontBookCatalog=Object.fromEntries(Object.entries(fontBookCommandSpecs).map(([suffix,[payload,description]])=>defineCommand(FONT_BOOK_PROFILES,`fontbook.${suffix}`,'fontbook.local',fontBookTargetSchema,payload,['Actual original native window and SAME shared fonts graph.'],[description],['fontbook','fonts'],[],fontBookTargetSchema)));

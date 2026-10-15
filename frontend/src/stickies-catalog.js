import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { STICKIES_PROFILES,STICKIES_COLORS,STICKIES_MENUS,stickiesIdSchema as id,stickiesString as str,stickiesInt as int } from './stickies-state.js';
export const stickiesTargetSchema=object({windowId:id});
export const stickiesFormatSchema=object({font:str(256,1),size:{type:'number',minimum:1,maximum:144},bold:flag,italic:flag,underline:flag,strike:flag,color:{...str(7,7),pattern:'^#[0-9a-fA-F]{6}$'},align:choice('left','center','right','justify'),list:choice('none','bullet','number')},[]);
export const stickiesCommandSpecs={
 'note.new':[empty,'Create an independent note and actual native window.'],
 'note.reopen':[object({noteId:id}),'Reopen the original retained independent note.'],
 edit:[object({start:int(0,1048576),end:int(0,1048576),text:str(1048576),revision:int()}),'Replace a Unicode-safe original note range, preserving rich styles.'],
 selection:[object({start:int(0,1048576),end:int(0,1048576),revision:int()}),'Retain original native selection offsets.'],
 format:[stickiesFormatSchema,'Format selected original rich text.'],undo:[empty,'Undo actual retained rich edits.'],redo:[empty,'Redo actual retained rich edits.'],
 color:[object({color:choice(...STICKIES_COLORS)}),'Set note paper color.'],
 options:[object({collapsed:flag,floating:flag,translucent:flag},[]),'Set actual note window collapse, floating and translucency presentation.'],
 arrange:[object({by:choice('color','date','content','position')}),'Arrange independent actual note windows by paper color, creation time, content or existing position.'],
 find:[object({query:str(4096),allNotes:flag,ignoreCase:flag,replacement:str(4096)},[]),'Find actual current or retained note text.'],
 geometry:[empty,'Retain actual original shell note geometry after native movement or resize.'],
 'find.next':[object({backwards:flag}),'Select the next or previous actual matching range.'],
 replace:[object({all:flag}),'Replace actual matching text with rich range preservation.'],
 import:[object({fileId:id},[]),'Import actual original shared plain text or supported paragraph RTF into an independent note.'],
 export:[object({name:str(256,1),format:choice('txt','rtf')}),'Atomically export genuine UTF-8 text or supported rich RTF bytes into shared Files.'],
 clipboard:[object({operation:choice('copy','cut','paste','selectAll')}),'Use the single shared scene clipboard and original native note selection; cuts are atomic.'],
 close:[object({decision:choice('keep','delete','cancel')},[]),'Confirm original note deletion or retain its rich text before guarded actual window close.'],
 sheet:[object({sheet:choice('none','close','fonts','find','export','retained','help')}),'Open original note sheet.'],
 menu:[object({menu:{anyOf:[{type:'null'},choice(...STICKIES_MENUS)]}}),'Open actual native application menu.'],
 focus:[object({controlId:str(256,1)}),'Focus original enabled native control.']
};
export const stickiesCatalog=Object.fromEntries(Object.entries(stickiesCommandSpecs).map(([suffix,[schema,description]])=>defineCommand(STICKIES_PROFILES,`stickies.${suffix}`,'stickies.local',stickiesTargetSchema,schema,['Independent original canonical Stickies graph; actual native window, view, clipboard and Files ownership.','Windows is a disclosed local equivalent. RTFD, attachments and unsupported rich controls are rejected without flattening.'],[description],['stickies'],[],stickiesTargetSchema)));

import { copyCanonicalData,applyCanonicalData } from './canonical-data.js';
import { textEditPlainText,replaceTextEditRange,formatTextEditRange } from './textedit-content.js';
import { decodeTextEditFile,serializeTextEditRtf } from './textedit-codec.js';
import { stickiesCommandSpecs,stickiesTargetSchema } from './stickies-catalog.js';
import { stickiesSchemaValid,stickiesContentSchema,stickiesSchema,validateStickiesState,stickiesTextUnits,stickiesWindow,stickiesNote,stickiesSelected,createStickiesNote,createStickiesWindow,stickiesSearch,STICKIES_COLORS } from './stickies-state.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createStickiesCommands(state,ctx) {
 let disposed=false,generation=0;
 const profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&state.profileId===profileId;
 const stale=()=>rejected('stale_target','Original Stickies graph, authored time, note, native window/view or source changed.');
 const unavailable=message=>rejected('unavailable',message);
 function owner(windowId,native=false){
  const window=ctx.getWindow(windowId),session=stickiesWindow(state,windowId),note=stickiesSelected(state,session),view=ctx.getView?.(windowId);
  if(!alive()||!validateStickiesState(state,ctx.profile).ok||!window||!session||!note||ctx.available(window)!==true||native&&(!view||view.available()!==true))return null;
  const version=generation,signature=JSON.stringify(state),windowSignature=JSON.stringify(window),instant=ctx.getSceneTime(),identities=[];
  function retain(value,path=[]){if(value&&typeof value==='object'){identities.push({value,path});for(const key of Object.keys(value))retain(value[key],[...path,key]);}}
  retain(state);
  const originals=()=>identities.every(({value,path})=>path.reduce((current,key)=>current?.[key],state)===value);
  const guard=()=>alive()&&generation===version&&ctx.getSceneTime()===instant&&originals()&&JSON.stringify(state)===signature&&ctx.getWindow(windowId)===window&&JSON.stringify(window)===windowSignature&&stickiesWindow(state,windowId)===session&&stickiesSelected(state,session)===note&&ctx.getView?.(windowId)===view&&ctx.available(window)===true&&(!native||view.available()===true);
  return {windowId,window,session,note,view,guard,instant};
 }
 function prepare(lease,mutate){if(!lease.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=stickiesWindow(candidate,lease.windowId),n=stickiesSelected(candidate,w),result=mutate(candidate,w,n);if(result?.status==='rejected')return {error:result};const valid=validateStickiesState(candidate,ctx.profile),delta=stickiesTextUnits(candidate)-stickiesTextUnits(state);if(!valid.ok||ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded',valid.message??'Complete scene budget exceeded.')};return {candidate,result:result??{},delta};}
 function publish(prepared){applyCanonicalData(state,prepared.candidate);generation++;}
 function settle(lease,prepared){if(prepared.error)return prepared.error;if(!lease.guard()||ctx.canCommit(prepared.delta)!==true)return stale();publish(prepared);return applied(lease.windowId,prepared.result);}
 const commit=(lease,mutate)=>settle(lease,prepare(lease,mutate));
 function change(note,content,time){note.undo.push(copyCanonicalData(note.content));if(note.undo.length>16)note.undo.shift();note.redo.splice(0);applyCanonicalData(note.content,content);note.revision++;note.modifiedAt=time;}
 function capture(lease){const selection=lease.view?.captureSelection?.();if(!selection||selection.noteId!==lease.note.id||selection.revision!==lease.note.revision||!Number.isSafeInteger(selection.start)||!Number.isSafeInteger(selection.end)||selection.start<0||selection.end<selection.start||selection.end>textEditPlainText(lease.note.content).length)return null;return selection;}
 async function newWindow(lease,options={}){if(typeof ctx.createWindow!=='function')return unavailable('Actual native window creator unavailable.');const windowId=await ctx.createWindow('stickies',{...options,isCurrent:lease.guard,guard:lease.guard});const actual=ctx.getWindow(windowId),w=stickiesWindow(state,windowId);return actual&&w&&actual.appId==='stickies'?applied(lease.windowId,{windowId,noteId:w.noteId}):lease.guard()?unavailable('Shell did not acknowledge the actual independent note window.'):stale();}
 async function importFile(lease,fileId){
  if(typeof ctx.readFile!=='function'||typeof ctx.getFile!=='function')return unavailable('Actual canonical Files reader unavailable.');
  const file=ctx.getFile(fileId),revision=file?.revision,source=JSON.stringify(file);
  if(!file||file.id!==fileId)return unavailable('Original shared file unavailable.');
  const guard=()=>lease.guard()&&ctx.getFile(fileId)===file&&file.revision===revision&&JSON.stringify(file)===source;
  const result=await ctx.readFile(fileId,{guard,windowId:lease.windowId});
  if(!guard())return stale();if(result?.status!=='applied'||result.file!==file)return result?.status==='rejected'?result:unavailable('Files did not return the original canonical source.');
  const content=decodeTextEditFile({text:result.text,mime:result.mime}).content;content.kind='rich';
  if(content.blocks.some(b=>b.type!=='paragraph'||b.tabs.length))return rejected('unsupported_content','Stickies supports paragraph RTF without custom tab stops; tables, attachments, custom tab stops and RTFD are not flattened.');
  // Publish content only when the real shell accepts the independent note window.
  return await newWindow({...lease,guard},{importContent:content});
 }
 async function close(lease,decision){
  if(decision==='cancel')return commit(lease,(_,w)=>{w.sheet='none';});
  if(!decision&&textEditPlainText(lease.note.content))return commit(lease,(_,w,n)=>{w.sheet='close';n.collapsed=false;});
  if(typeof ctx.closeWindow!=='function')return unavailable('Guarded actual shell close unavailable.');
  const result=await ctx.closeWindow(lease.windowId,{guard:lease.guard,isCurrent:lease.guard,windowId:lease.windowId,stickiesDecision:decision??'delete'});
  if(result?.status==='rejected')return result;
  return !ctx.getWindow(lease.windowId)&&!stickiesWindow(state,lease.windowId)?applied(lease.windowId):lease.guard()?unavailable('Actual shell did not close and release the original note session.'):stale();
 }
 async function presentMatch(windowId,match,instant){const window=ctx.getWindow(windowId),session=stickiesWindow(state,windowId),note=stickiesNote(state,match.noteId),revision=note?.revision;ctx.focusWindow(windowId);if(ctx.tick)await ctx.tick();if(!alive()||ctx.getSceneTime()!==instant||ctx.getWindow(windowId)!==window||stickiesWindow(state,windowId)!==session||stickiesNote(state,match.noteId)!==note||note.revision!==revision)return false;const lease=owner(windowId,true);return !!lease&&lease.view.selectRange(match.start,match.end,lease.guard)===true;}
 const handlers={};
 for(const [suffix,[schema]]of Object.entries(stickiesCommandSpecs))handlers[`stickies.${suffix}`]=async(t,p={})=>{
  if(!stickiesSchemaValid(t,stickiesTargetSchema)||!stickiesSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Stickies command schema.');
  const lease=owner(t.windowId,['clipboard','focus'].includes(suffix));if(!lease)return unavailable('Original enabled Stickies window/view unavailable.');
  try {
   if(suffix==='note.new')return await newWindow(lease,{newNote:true});
   if(suffix==='note.reopen'){const n=stickiesNote(state,p.noteId);if(!n)return stale();const opened=state.windows.find(w=>w.noteId===n.id);if(opened){ctx.focusWindow(opened.windowId);return applied(t.windowId,{windowId:opened.windowId,noteId:n.id});}return await newWindow(lease,{noteId:n.id});}
   if(suffix==='close')return await close(lease,p.decision);
   if(suffix==='sheet'||suffix==='menu')return commit(lease,(_,w,n)=>{const value=p[suffix==='sheet'?'sheet':'menu'];w[suffix==='sheet'?'sheet':'menu']=value;if(value&&value!=='none')n.collapsed=false;});
   if(suffix==='color')return commit(lease,(_,w,n)=>{n.color=p.color;n.modifiedAt=lease.instant;});
   if(suffix==='options')return commit(lease,(_,w,n)=>{for(const key of Object.keys(p))n[key]=p[key];n.modifiedAt=lease.instant;});
   if(suffix==='geometry')return commit(lease,(_,w,n)=>{if(lease.window.zoomed||lease.window.maximized||n.collapsed)return rejected('disabled','Retain geometry only from an expanded normal note window.');n.geometry={x:lease.window.x,y:lease.window.y,width:lease.window.width,height:lease.window.height};});
   if(suffix==='arrange')return commit(lease,c=>{const rows=c.windows.map(w=>stickiesSelected(c,w));rows.sort((a,b)=>p.by==='color'?STICKIES_COLORS.indexOf(a.color)-STICKIES_COLORS.indexOf(b.color):p.by==='date'?a.createdAt-b.createdAt:p.by==='content'?textEditPlainText(a.content).localeCompare(textEditPlainText(b.content),'en'):a.geometry.y-b.geometry.y||a.geometry.x-b.geometry.x);rows.forEach((n,i)=>{n.geometry.x=40+(i%4)*32;n.geometry.y=60+Math.floor(i/4)*42+(i%4)*24;});return {positions:c.windows.map(w=>({windowId:w.windowId,...stickiesSelected(c,w).geometry}))};});
   if(suffix==='selection'||suffix==='edit'){if(p.revision!==lease.note.revision)return stale();return commit(lease,(_,w,n)=>{if(p.start>p.end||p.end>textEditPlainText(n.content).length)return rejected('invalid_range','Selection exceeds actual note.');if(suffix==='edit'){change(n,replaceTextEditRange(n.content,p.start,p.end,p.text),lease.instant);const at=p.start+p.text.replace(/\r\n?/g,'\n').length;w.selection={start:at,end:at};}else w.selection={start:p.start,end:p.end};return {noteId:n.id,revision:n.revision};});}
   if(suffix==='format')return commit(lease,(_,w,n)=>{if(w.selection.start===w.selection.end)return rejected('no_selection','Select text to format.');change(n,formatTextEditRange(n.content,w.selection.start,w.selection.end,p),lease.instant);});
   if(suffix==='undo'||suffix==='redo')return commit(lease,(_,w,n)=>{const from=suffix==='undo'?n.undo:n.redo,to=suffix==='undo'?n.redo:n.undo;if(!from.length)return rejected('disabled','No retained rich edit history.');to.push(copyCanonicalData(n.content));if(to.length>16)to.shift();applyCanonicalData(n.content,from.pop());n.revision++;n.modifiedAt=lease.instant;w.selection={start:0,end:0};});
   if(suffix==='find')return commit(lease,(_,w,n)=>{for(const key of ['query','replacement','allNotes','ignoreCase'])if(p[key]!==undefined)w[key]=p[key];w.match=0;w.sheet='find';n.collapsed=false;});
   if(suffix==='find.next'){const matches=stickiesSearch(state,lease.session);if(!matches.length)return rejected('no_match','No matching actual note text.');const previous=matches[lease.session.match],selected=previous&&state.windows.some(w=>w.noteId===previous.noteId&&w.selection.start===previous.start&&w.selection.end===previous.end),index=selected?(lease.session.match+(p.backwards?-1:1)+matches.length)%matches.length:p.backwards?matches.length-1:0,m=matches[index],other=state.windows.find(w=>w.noteId===m.noteId);let result,destinationId;if(!other){result=await newWindow(lease,{noteId:m.noteId,selection:{start:m.start,end:m.end}});destinationId=result.windowId;}else{destinationId=other.windowId;result=commit(lease,(c,w)=>{w.match=index;const destination=stickiesWindow(c,other.windowId);destination.selection={start:m.start,end:m.end};stickiesNote(c,m.noteId).collapsed=false;});}if(result.status!=='applied')return result;return await presentMatch(destinationId,m,lease.instant)?applied(t.windowId,{...result,matchedWindowId:destinationId,match:m,target:t}):unavailable('The match was retained, but its original native text selection became unavailable.');}
   if(suffix==='replace')return commit(lease,(c,w)=>{let matches=stickiesSearch(c,w);if(p.all&&matches.length===65536)return rejected('limit_exceeded','Narrow the search before Replace All; the bounded match list may be incomplete.');if(!p.all)matches=matches.slice(w.match,w.match+1);if(!matches.length)return rejected('no_match','No text to replace.');for(const n of c.notes){const found=matches.filter(m=>m.noteId===n.id).reverse();if(!found.length)continue;let content=n.content;for(const m of found)content=replaceTextEditRange(content,m.start,m.end,w.replacement);change(n,content,lease.instant);for(const win of c.windows.filter(win=>win.noteId===n.id))win.selection={start:0,end:0};}w.match=0;});
   if(suffix==='import'){let fileId=p.fileId;if(!fileId){if(typeof ctx.chooseFile!=='function')return unavailable('Shared Files picker unavailable.');const r=await ctx.chooseFile({appId:'stickies',accept:['text/plain','application/rtf','text/rtf'],multiple:false},{guard:lease.guard,windowId:lease.windowId});if(!lease.guard())return stale();if(r?.status!=='applied')return r?.status==='rejected'?r:unavailable('Picker did not acknowledge an actual file.');fileId=r.fileId;}return await importFile(lease,fileId);}
   if(suffix==='export'){
    if(typeof ctx.createFile!=='function')return unavailable('Atomic shared Files writer unavailable.');const text=p.format==='rtf'?serializeTextEditRtf(lease.note.content):textEditPlainText(lease.note.content),mime=p.format==='rtf'?'application/rtf':'text/plain;charset=utf-8';if(text.length>1048576)return rejected('limit_exceeded','File export exceeds 1 MiB text budget.');
    const prepared=prepare(lease,(_,w)=>{w.sheet='none';});if(prepared.error)return prepared.error;let acknowledged=null;
    const r=await ctx.createFile({name:p.name,mime,content:text,text,parentId:'documents',reserveTextUnits:prepared.delta,onCommit:(id,original)=>{if(!lease.guard()||typeof id!=='string'||original?.id!==id||ctx.canCommit(prepared.delta)!==true)return false;publish(prepared);acknowledged=id;return true;}},{guard:lease.guard,windowId:lease.windowId});
    return acknowledged&&r?.status==='applied'&&r.fileId===acknowledged?applied(t.windowId,{fileId:acknowledged}):r?.status==='rejected'?r:stale();
   }
   if(suffix==='focus')return lease.view.focus(p.controlId,lease.guard)===true?applied(t.windowId):unavailable('Original native control unavailable.');
   if(suffix==='clipboard'){
    if(p.operation==='selectAll')return lease.view.selectRange(0,textEditPlainText(lease.note.content).length,lease.guard)===true?applied(t.windowId):unavailable('Original native note selection unavailable.');
    const s=capture(lease);if(!s)return unavailable('Select original native note text first.');
    if(p.operation==='paste'){const clipboard=ctx.getClipboard?.(),signature=JSON.stringify(clipboard),text=clipboard?.text;if(typeof text!=='string')return unavailable('Shared clipboard contains no text.');const pinned={...lease,guard:()=>lease.guard()&&ctx.getClipboard()===clipboard&&JSON.stringify(clipboard)===signature};return commit(pinned,(_,w,n)=>{change(n,replaceTextEditRange(n.content,s.start,s.end,text),lease.instant);const at=s.start+text.replace(/\r\n?/g,'\n').length;w.selection={start:at,end:at};});}
    if(s.start===s.end)return rejected('no_selection','Select actual text to copy or cut.');if(typeof ctx.setClipboard!=='function')return unavailable('Atomic scene clipboard writer unavailable.');
    const source=textEditPlainText(lease.note.content).slice(s.start,s.end),prepared=prepare(lease,(_,w,n)=>{if(p.operation==='cut'){change(n,replaceTextEditRange(n.content,s.start,s.end,''),lease.instant);w.selection={start:s.start,end:s.start};}});if(prepared.error)return prepared.error;let acknowledged=false;
    const clipboard=ctx.getClipboard?.(),clipboardSignature=JSON.stringify(clipboard);
    const guard=()=>lease.guard()&&ctx.getClipboard?.()===clipboard&&JSON.stringify(clipboard)===clipboardSignature&&JSON.stringify(lease.view.captureSelection())===JSON.stringify(s);
    const r=await ctx.setClipboard({text:source,reserveTextUnits:prepared.delta,onCommit:()=>{if(!guard()||ctx.canCommit(prepared.delta)!==true)return false;if(p.operation==='cut')publish(prepared);acknowledged=true;return true;}},{guard,windowId:lease.windowId});return r?.status==='applied'&&acknowledged?applied(t.windowId):r?.status==='rejected'?r:stale();
   }
   return rejected('unsupported_command','Stickies command unavailable.');
  }catch(error){return rejected(error.code??'unsupported_content',error.message??'Stickies operation failed.');}
 };
 function windowOpened(window,options={}){
  if(!alive()||!validateStickiesState(state,ctx.profile).ok||ctx.getWindow(window.id)!==window||window.appId!=='stickies'||stickiesWindow(state,window.id)||options.isCurrent&&options.isCurrent()!==true)return false;
  if(options.importContent&&!stickiesSchemaValid(options.importContent,stickiesContentSchema)||options.selection&&!stickiesSchemaValid(options.selection,stickiesSchema.properties.windows.items.properties.selection))return false;
  const candidate=copyCanonicalData(state),used=new Set(candidate.windows.map(w=>w.noteId));let note;
  if(options.noteId){note=stickiesNote(candidate,options.noteId);if(!note||used.has(note.id))return false;}
  else if(!options.newNote&&!options.importContent)note=candidate.notes.find(n=>!used.has(n.id));
  if(!note){note=createStickiesNote(`stickies-note-${candidate.nextId++}`,ctx.getSceneTime());if(options.importContent)note.content=copyCanonicalData(options.importContent);candidate.notes.push(note);}
  const session=createStickiesWindow(window.id,note.id);if(options.selection)session.selection=copyCanonicalData(options.selection);candidate.windows.push(session);
  const delta=stickiesTextUnits(candidate)-stickiesTextUnits(state);if(!validateStickiesState(candidate,ctx.profile).ok||ctx.canCommit(delta)!==true||options.isCurrent&&options.isCurrent()!==true)return false;applyCanonicalData(state,candidate);generation++;return true;
 }
 function windowClosed(windowOrId,options={}){
  if(!alive()||!validateStickiesState(state,ctx.profile).ok||options.guard&&options.guard()!==true||options.stickiesDecision!==undefined&&!['keep','delete'].includes(options.stickiesDecision))return false;
  const id=typeof windowOrId==='string'?windowOrId:windowOrId.id,w=stickiesWindow(state,id);if(!w)return true;
  if(typeof windowOrId!=='string'&&ctx.getWindow(id)&&ctx.getWindow(id)!==windowOrId)return false;
  const n=stickiesSelected(state,w),decision=options.stickiesDecision;
  if(!decision&&textEditPlainText(n.content)){const lease=owner(id);if(lease)commit(lease,(_,win,note)=>{win.sheet='close';note.collapsed=false;});return false;}
  const candidate=copyCanonicalData(state);candidate.windows.splice(candidate.windows.findIndex(win=>win.windowId===id),1);if(decision==='delete')candidate.notes.splice(candidate.notes.findIndex(note=>note.id===n.id),1);
  const delta=stickiesTextUnits(candidate)-stickiesTextUnits(state);if(!validateStickiesState(candidate,ctx.profile).ok||ctx.canCommit(delta)!==true)return false;applyCanonicalData(state,candidate);generation++;return true;
 }
 function appQuit(appId){if(appId!=='stickies'||!alive()||!validateStickiesState(state,ctx.profile).ok)return false;state.windows.splice(0);generation++;return true;}
 return {handlers,targets:()=>state.windows.map(w=>({windowId:w.windowId})),windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;},requestClose:windowId=>handlers['stickies.close']({windowId},{})};
}

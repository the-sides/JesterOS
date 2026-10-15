import {copyCanonicalData,applyCanonicalData} from './canonical-data.js';
import {availableFonts,fontCSSFamily,loadAvailableFonts} from './font-book-fonts.js';
import {decodePhoto} from './photos-codec.js';
import {journalCommandPayloads,journalWindowTarget} from './journal-catalog.js';
import {createJournalSession,createJournalEntry,createJournalBlock,journalSession,journalDocument,journalEntry,journalSchemaValid,validateJournalState,journalTextUnits,journalFingerprint,journalAvailability} from './journal-state.js';
import {JOURNAL_MIME,journalPinGraph,encodeJournal,decodeJournal,journalHTML,journalPDF,inspectJournalAttachment} from './journal-codec.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
export function createJournalCommands(state,ctx){if(!ctx){ctx=state;state=ctx.getState();}let disposed=false,generation=0;const sourceFiles=new Map();
let renderedFonts=null;
function retireFonts(){renderedFonts?.handle.dispose();renderedFonts=null;}
async function prepareFont(l,name){
 if(name==='system-ui')return {l};
 const graph=ctx.getShared?.('fonts');
 if(!graph||!availableFonts(graph,ctx.getFile).some(f=>f.family===name||fontCSSFamily(f)===name))return {error:rejected('not_found','Typeface must come from the original active scene FontGraph.')};
 if(renderedFonts&&!renderedFonts.current())retireFonts();
 const pin=journalPinGraph(graph),original=l.guard,rows=availableFonts(graph,ctx.getFile),files=rows.filter(f=>f.fileId).map(f=>fileLease(liveFile(f.fileId)));
 const current=()=>ctx.getShared('fonts')===graph&&pin()&&files.every(lease=>lease());
 l={...l,guard:()=>original()&&current()};
 if(!renderedFonts){
  const handle=await loadAvailableFonts(graph,{getFile:ctx.getFile,guard:l.guard});
  if(!l.guard()){handle.dispose();return {error:stale()};}
  if(renderedFonts?.current())handle.dispose();
  else {retireFonts();renderedFonts={handle,current};}
 }
 return {l};
}
const alive=()=>!disposed&&ctx.alive()===true&&ctx.getState()===state;
const stale=()=>rejected('stale_target','Original Journal actor, nested content, source graph, window, view or scene time changed.');
function liveFile(id){const file=ctx.getFile?.(id);if(!file||file.deleted||file.trashed||file.inTrash||file.mounted===false||['trash','recycle-bin'].includes(file.parentId))return null;let parent=file.parentId;const seen=new Set([id]);while(parent){if(seen.has(parent))return null;seen.add(parent);const row=ctx.getFile(parent);if(!row||row.deleted||row.trashed||row.inTrash||row.mounted===false||['trash','recycle-bin'].includes(row.id))return null;parent=row.parentId;}return file;}
function owner(id){if(!alive())return null;const window=ctx.getWindow(id),w=journalSession(state,id),view=ctx.getView?.(id);if(!window||window.appId!==journalAvailability(ctx.profile).appId||!w)return null;const pin=journalPinGraph(state),profile=ctx.profile,profilePin=journalPinGraph(profile),time=ctx.getSceneTime(),v=generation;return {windowId:id,window,w,view,time,d:journalDocument(state,w.documentId),e:journalEntry(journalDocument(state,w.documentId),w.entryId),guard:()=>alive()&&generation===v&&ctx.profile===profile&&profilePin()&&pin()&&ctx.getSceneTime()===time&&ctx.getWindow(id)===window&&journalSession(state,id)===w&&ctx.getView?.(id)===view};}
function prepare(l,change){if(!l.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=journalSession(candidate,l.windowId),d=journalDocument(candidate,w.documentId),e=journalEntry(d,w.entryId),result=change(candidate,w,d,e);if(result?.status==='rejected')return {error:result};candidate.revision++;const valid=validateJournalState(candidate,ctx.profile),delta=journalTextUnits(candidate)-journalTextUnits(state);if(!valid.ok)return {error:rejected('invalid_state',valid.message)};const permitted=ctx.canCommit(delta)===true;if(!l.guard())return {error:stale()};if(!permitted)return {error:rejected('limit_exceeded','Complete Root scene quota exceeded.')};return {candidate,delta,result:result??{}};}
const publish=c=>{applyCanonicalData(state,c);generation++;};
function commit(l,change){const p=prepare(l,change);if(p.error)return p.error;if(!l.guard())return stale();publish(p.candidate);return applied(l.windowId,p.result);}
function select(w,d){w.documentId=d.id;w.entryId=d.content.entries[0]?.id??null;w.blockId=d.content.entries[0]?.blocks[0]?.id??null;w.panel='none';w.menu=null;}
function edit(l,change){if(!l.d)return rejected('not_found','Create a journal first.');return commit(l,(c,w,d,e)=>{const before=copyCanonicalData(d.content),result=change(c,w,d,e);if(result?.status==='rejected')return result;if(journalFingerprint(before)!==journalFingerprint(d.content)){d.undo.push(before);if(d.undo.length>12)d.undo.shift();d.redo=[];d.dirty=journalFingerprint(d.content)!==d.savedFingerprint;}return result;});}
function addDocument(c,w,title,time,content=null,file=null){const d={id:`journal-document-${c.nextId++}`,content:content??{title,entries:[createJournalEntry(c,time)]},fileId:file?.id??null,fileRevision:file?.revision??null,dirty:!file,savedFingerprint:file?journalFingerprint(content):'',undo:[],redo:[]};c.documents.push(d);select(w,d);return d;}
function fileLease(file){
 if(!file||liveFile(file.id)!==file)return ()=>false;
 const rows=[];let row=file;
 while(row){rows.push([row.id,row,journalPinGraph(row)]);row=row.parentId?ctx.getFile(row.parentId):null;}
 return ()=>liveFile(file.id)===file&&rows.every(([id,original,pin])=>ctx.getFile(id)===original&&pin());
}
function pinFile(l,file){const current=fileLease(file);return {...l,guard:()=>l.guard()&&current()};}
function permission(category){const prefs=ctx.getShared?.('preferences'),rows=prefs?.configuration?.security?.permissions,row=rows?.find(r=>r.appId==='journal'&&r.category===category);return {prefs,rows,row,allowed:row?.allowed===true};}
function privacyLease(l,category){const p=permission(category);if(!p.allowed)return {error:rejected('permission_denied',`Allow Journal ${category} in the scene Privacy settings first. No host permission is requested.`)};const pin=journalPinGraph(p.prefs);return {l:{...l,guard:()=>l.guard()&&ctx.getShared('preferences')===p.prefs&&p.prefs.configuration.security.permissions===p.rows&&p.rows.includes(p.row)&&p.row.allowed===true&&pin()}};}
async function read(l,id){
 const file=liveFile(id);if(!file||!ctx.readFile)return {error:rejected('not_found','Original live source File unavailable.')};
 l=pinFile(l,file);const result=await ctx.readFile(id,{windowId:l.windowId,guard:l.guard});
 if(!l.guard())return {error:stale()};
 if(result?.status!=='applied'||result.file!==file||result.text!==file.content||typeof result.mime!=='string'||file.mime!==undefined&&result.mime!==file.mime||result.name!==file.name)return {error:result?.status==='rejected'?result:rejected('unavailable','Reader did not acknowledge exact original File bytes and MIME.')};
 return {l,file,mime:result.mime};
}
async function choose(l,p,attachment=false){let id=p.fileId;if(!id){if(!ctx.chooseFile)return {error:rejected('unavailable','Root scene Files picker unavailable.')};const picked=await ctx.chooseFile({appId:'journal',title:attachment?'Add Attachment':'Open Journal',accept:attachment?['image/png','image/jpeg','image/webp','audio/wav','video/webm','application/pdf','text/plain']:[JOURNAL_MIME],multiple:false},{windowId:l.windowId,guard:l.guard});if(!l.guard())return {error:stale()};if(picked?.status!=='applied'||!picked.fileId)return {error:picked?.status==='rejected'?picked:rejected('cancelled','No original File chosen.')};id=picked.fileId;}return read(l,id);}
function imported(c,content){const copy=copyCanonicalData(content);for(const e of copy.entries){e.id=`journal-entry-${c.nextId++}`;for(const b of e.blocks)b.id=`journal-block-${c.nextId++}`;for(const a of e.attachments)a.id=`journal-attachment-${c.nextId++}`;}return copy;}
async function open(l,p){
 const result=await choose(l,p);if(result.error)return result.error;l=result.l;const file=result.file;
 if(result.mime!==JOURNAL_MIME||!file.name.endsWith('.jjournal'))return rejected('unsupported_content','Open requires disclosed custom .jjournal, not native Apple Journal archives.');
 const existing=state.documents.find(d=>d.fileId===file.id);
 if(existing)return commit(l,(c,w)=>{const d=journalDocument(c,existing.id);if(d.fileRevision!==(file.revision??null))return rejected('conflict','Original Journal File changed; save current edits as a new copy.');select(w,d);return {documentId:d.id};});
 const content=decodeJournal(file.content);
 for(const entry of content.entries)for(const attachment of entry.attachments){
  const geometry=await attachmentGeometry(l,attachment);if(geometry.status==='rejected')return geometry;if(!l.guard())return stale();
  if(attachment.width!==geometry.width||attachment.height!==geometry.height)return rejected('invalid_format','Portable attachment dimensions differ from actual native pixels.');
 }
 const ack=commit(l,(c,w)=>{const d=addDocument(c,w,content.title,l.time,imported(c,content),file);return {documentId:d.id};});
 if(ack.status==='applied')sourceFiles.set(file.id,file);
 return ack;
}
async function output(l,format){
 if(!l.d)return {error:rejected('not_found','No journal selected.')};
 if(format==='jjournal')return {content:encodeJournal(l.d.content),mime:JOURNAL_MIME};
 if(format==='html')return {content:journalHTML(l.d.content),mime:'text/html'};
 const fonts=ctx.getShared?.('fonts');
 if(!fonts)return {error:rejected('unavailable','Original scene FontGraph unavailable.')};
 const pin=journalPinGraph(fonts),source=l.guard;
 l={...l,guard:()=>source()&&ctx.getShared('fonts')===fonts&&pin()};
 for(const font of availableFonts(fonts,ctx.getFile))if(font.fileId){const file=liveFile(font.fileId);if(!file)return {error:stale()};l=pinFile(l,file);}
 const content=await journalPDF(l.d.content,l.time,{guard:l.guard,fonts,getFile:ctx.getFile});
 if(!l.guard())return {error:stale()};
 return {content,mime:'application/pdf',l};
}
async function write(l,p={},save=false,attachment=null){
 if(!ctx.planFile||!ctx.createFile)return rejected('unavailable','Root atomic File planner/writer unavailable.');
 const format=save?'jjournal':p.format,bytes=attachment?{content:attachment.content,mime:attachment.mime}:await output(l,format);
 if(bytes.error)return bytes.error;l=bytes.l??l;if(!l.guard())return stale();
 if(bytes.content.length>1048576)return rejected('limit_exceeded','Exported File exceeds 1 MiB.');
 let original=null;
 if(save&&l.d.fileId&&!p.saveAs){
  original=liveFile(l.d.fileId);
  if(!original||sourceFiles.has(original.id)&&sourceFiles.get(original.id)!==original)return rejected('not_found','Original saved File unavailable.');
  if((original.revision??null)!==l.d.fileRevision)return rejected('conflict','Saved File revision changed. Use Save As.');
  l=pinFile(l,original);
 }
 let name=attachment?attachment.name:p.name??original?.name??`${l.d.content.title}.${format}`;
 if(!attachment&&!name.endsWith(`.${format}`))name+=`.${format}`;
 if(!name.trim()||name!==name.trim()||name.length>256||/[\u0000-\u001f/\\]/u.test(name))return rejected('invalid_arguments','Use a local filename without path separators.');
 const spec={name,mime:bytes.mime,content:bytes.content,parentId:'documents',...(original?{existingFileId:original.id,...(original.revision===undefined?{}:{expectedRevision:original.revision})}:{})};
 const filePlan=ctx.planFile(spec,{windowId:l.windowId,guard:l.guard});
 if(!l.guard())return stale();
 if(filePlan?.status!=='applied'||typeof filePlan.current!=='function'||filePlan.current()!==true)return filePlan?.status==='rejected'?filePlan:rejected('unavailable','Root did not supply an actual private File plan.');
 const metadata=filePlan.metadata;
 if(!metadata||!Object.isFrozen(metadata)||metadata.id!==filePlan.fileId||metadata.name!==name||metadata.mime!==bytes.mime||metadata.content!==bytes.content||!Number.isSafeInteger(metadata.revision)||metadata.revision<0)return rejected('invalid_state','Root immutable File metadata differs.');
 const source=l.guard;l={...l,guard:()=>source()&&filePlan.current()===true&&filePlan.metadata===metadata};
 const plan=prepare(l,(_c,w,d)=>{w.panel='none';if(save){d.fileId=filePlan.fileId;d.fileRevision=metadata.revision;d.savedFingerprint=journalFingerprint(d.content);d.dirty=false;}});
 if(plan.error)return plan.error;let acknowledged=null;
 const result=await ctx.createFile({...spec,plan:filePlan,reserveTextUnits:plan.delta,onCommit:(id,file,planned)=>{
  if(!l.guard()||id!==filePlan.fileId||file?.id!==id||original&&file!==original||planned!==metadata||planned.id!==metadata.id||planned.revision!==metadata.revision||planned.name!==name||planned.content!==bytes.content||planned.mime!==bytes.mime)return false;
  const delta=journalTextUnits(plan.candidate)-journalTextUnits(state);
  if(delta!==plan.delta||!validateJournalState(plan.candidate,ctx.profile).ok||ctx.canCommit(delta)!==true||!l.guard())return false;
  publish(plan.candidate);sourceFiles.set(id,file);acknowledged=id;return true;
 }},{windowId:l.windowId,guard:l.guard});
 return acknowledged?applied(l.windowId,{fileId:acknowledged,format:attachment?'attachment':format}):l.guard()?result?.status==='rejected'?result:rejected('unavailable','Root did not atomically publish actual output.'):stale();
}
async function bridge(l,name){
 if(typeof ctx[name]!=='function')return rejected('unavailable',`Root ${name} destination unavailable.`);
 const bytes=await output(l,name==='print'?'pdf':'html');if(bytes.error)return bytes.error;l=bytes.l??l;
 const ack=await ctx[name]({appId:'journal',documentId:l.d.id,title:l.d.content.title,text:l.d.content.entries.map(e=>[e.title,...e.blocks.map(b=>b.text)].join('\n')).join('\n\n'),content:bytes.content,mime:bytes.mime},{windowId:l.windowId,guard:l.guard});
 if(ack?.status==='applied'&&(name==='share'?ack.shareId:ack.printDialogId||ack.jobId||ack.panelId))return {...ack,target:{windowId:l.windowId}};
 return l.guard()?ack?.status==='rejected'?ack:rejected('unavailable',`Root did not acknowledge ${name}.`):stale();
}
function explicitAttachmentLease(l,p){
 if(!p.fileId)return {l};
 return privacyLease(l,'files');
}
async function attachmentGeometry(l,spec){
 const geometry=inspectJournalAttachment(spec);
 if(spec.mime.startsWith('image/')){
  if(geometry.width*geometry.height>4*1024*1024)return rejected('limit_exceeded','Journal images are bounded to 4 Mi raster pixels.');
  const decoded=await decodePhoto(spec.content,spec.mime,{guard:l.guard});
  if(!l.guard())return stale();
  if(decoded.width!==geometry.width||decoded.height!==geometry.height)return rejected('invalid_format','Native decoded pixels differ from the encoded image axes.');
 }else if(spec.mime==='application/pdf'){
  const lib=await import('pdf-lib');if(!l.guard())return stale();
  const raw=atob(spec.content.split(',')[1]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const pdf=await lib.PDFDocument.load(bytes,{ignoreEncryption:false});if(!l.guard())return stale();
  if(pdf.getPageCount()<1||pdf.getPageCount()>128)return rejected('unsupported_content','PDF attachments require 1–128 genuine readable pages.');
 }
 return geometry;
}
async function attach(l,p){
 if(!l.e)return rejected('not_found','Select an entry first.');
 if(p.fileId&&p.photoId)return rejected('invalid_arguments','Choose one original File or Photos item, not both.');
 let spec;
 if(p.photoId){
  if(!state.preferences.photoSuggestions)return rejected('permission_denied','Enable local Photos suggestions in Journal preferences first.');
  const privacy=privacyLease(l,'photos');if(privacy.error)return privacy.error;l=privacy.l;
  const photos=ctx.getShared?.('photos'),photo=photos?.items.find(i=>i.id===p.photoId&&i.inLibrary&&!i.hidden&&!i.deletedAt&&i.mime.startsWith('image/'));
  if(!photo)return rejected('not_found','Original visible canonical Photos image unavailable.');
  const pin=journalPinGraph(photos),source=l.guard;
  l={...l,guard:()=>source()&&ctx.getShared('photos')===photos&&photos.items.includes(photo)&&!photo.hidden&&!photo.deletedAt&&pin()};
  spec={name:photo.title,mime:photo.editedMime??photo.mime,content:photo.editedContent??photo.content,source:'photo',sourceId:photo.id,sourceRevision:photo.revision};
  if(photo.sourceFileId){const f=liveFile(photo.sourceFileId);if(!f||f.revision!==photo.sourceFileRevision)return rejected('stale_target','Photos original source File changed.');l=pinFile(l,f);}
 }else {
  const privacy=explicitAttachmentLease(l,p);if(privacy.error)return privacy.error;l=privacy.l;
  const result=await choose(l,p,true);if(result.error)return result.error;l=result.l;const file=result.file;
  spec={name:file.name,mime:result.mime,content:file.content,source:'file',sourceId:file.id,sourceRevision:file.revision??null};
 }
 const geometry=await attachmentGeometry(l,spec);
 if(geometry.status==='rejected')return geometry;
 if(!l.guard())return stale();
 return edit(l,(c,_w,_d,e)=>{e.attachments.push({id:`journal-attachment-${c.nextId++}`,...spec,width:geometry.width,height:geometry.height});return {attachmentId:e.attachments.at(-1).id};});
}
async function hash(passphrase,salt,l){if(!globalThis.crypto?.subtle)return {error:rejected('unavailable','Actual local WebCrypto unavailable.')};const bytes=new TextEncoder().encode(`${salt}:${passphrase}`),digest=await crypto.subtle.digest('SHA-256',bytes);if(!l.guard())return {error:stale()};return {hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};}
const handlers={};for(const [name,schema] of Object.entries(journalCommandPayloads))handlers[name]=async(target,p={})=>{if(!journalSchemaValid(target,journalWindowTarget)||!journalSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Journal command schema.');let l=owner(target.windowId);if(!l)return rejected('unavailable','Original Journal window/session unavailable.');if(l.w.locked&&!['journal.unlock','journal.close','journal.focus','journal.scroll','journal.panel','journal.menu'].includes(name))return rejected('locked','Unlock Journal before viewing, editing or exporting content.');try{
if(name==='journal.block.update'&&p.values.font){const fonts=await prepareFont(l,p.values.font);if(fonts.error)return fonts.error;l=fonts.l;if(!l.guard())return stale();}
if(name==='journal.window.new'){
 if(!ctx.createWindow||!l.d)return rejected('unavailable','Root original Journal window creation unavailable.');
 const originalDocument=l.d,priorWindows=new Set(ctx.getWindows?.().map(w=>w.id)??state.sessions.map(w=>w.windowId));
 const documentPin=journalPinGraph(originalDocument),sessionPin=journalPinGraph(l.w),profilePin=journalPinGraph(ctx.profile),originalProfile=ctx.profile;
 const sourceCurrent=()=>alive()&&ctx.profile===originalProfile&&profilePin()&&documentPin()&&sessionPin()&&ctx.getSceneTime()===l.time&&ctx.getWindow(l.windowId)===l.window&&ctx.getView?.(l.windowId)===l.view&&journalDocument(state,originalDocument.id)===originalDocument&&journalSession(state,l.windowId)===l.w;
 const options={documentId:originalDocument.id,isCurrent:l.guard,ownership:{windowId:l.windowId,guard:l.guard}};
 const result=await ctx.createWindow('journal',options);
 const actual=typeof result==='string'?ctx.getWindow(result):result?.window??ctx.getWindow(result?.windowId??result?.id);
 const session=actual?journalSession(state,actual.id):null;
 if(sourceCurrent()&&actual&&actual.appId==='journal'&&!priorWindows.has(actual.id)&&ctx.getWindow(actual.id)===actual&&session?.documentId===originalDocument.id)return applied(actual.id,{documentId:originalDocument.id});
 return l.guard()?result?.status==='rejected'?result:rejected('unavailable','Root did not publish an actual original new Journal window/session.'):stale();
}
if(name==='journal.open')return await open(l,p);
if(name==='journal.save'||name==='journal.export')return await write(l,p,name==='journal.save');
if(name==='journal.print'||name==='journal.share')return await bridge(l,name.slice(8));
if(name==='journal.attachment.add')return await attach(l,p);
if(name==='journal.attachment.export'){const a=l.e?.attachments.find(a=>a.id===p.attachmentId);if(!a)return rejected('not_found','Original retained attachment unavailable.');return await write(l,{},false,a);}
if(name==='journal.attachment.play'){
 const attachment=l.e?.attachments.find(a=>a.id===p.attachmentId);
 if(!attachment||!['audio/wav','video/webm'].includes(attachment.mime))return rejected('not_found','Select a retained real audio or video attachment.');
 if(!l.view?.mediaPlay||ctx.available(l.window)!==true||l.view.available()!==true)return rejected('unavailable','Original mounted media control unavailable.');
 const played=await l.view.mediaPlay(attachment,p.playing,l.guard);
 if(!l.guard())return stale();
 return played===true?applied(l.windowId,{attachmentId:attachment.id,playing:p.playing}):rejected('unavailable','Actual media control did not acknowledge playback.');
}
if(name==='journal.lock.configure'&&!globalThis.crypto?.getRandomValues)return rejected('unavailable','Actual local WebCrypto unavailable.');
if(name==='journal.lock.configure'||name==='journal.unlock'){if(name.endsWith('configure')&&state.preferences.passHash)return rejected('disabled','Unlock uses the existing local verifier; changing a configured lock is not supported.');const salt=name.endsWith('configure')?Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''):state.preferences.salt;if(!salt)return rejected('disabled','Configure a local passphrase lock first.');const result=await hash(p.passphrase,salt,l);if(result.error)return result.error;if(name==='journal.unlock'&&result.hash!==state.preferences.passHash)return rejected('authentication_failed','Passphrase did not match the local Journal verifier.');return commit(l,(c,w)=>{if(name.endsWith('configure')){c.preferences.salt=salt;c.preferences.passHash=result.hash;}w.locked=false;w.panel='none';});}
if(name==='journal.focus'||name==='journal.scroll'){if(!l.view||ctx.available(l.window)!==true||l.view.available()!==true)return rejected('unavailable','Original mounted native control unavailable.');const ack=name==='journal.focus'?await l.view.focus(p.controlId,l.guard):await l.view.scroll(p.areaId,p,l.guard);if(!l.guard())return stale();return ack?applied(l.windowId,name==='journal.scroll'?{offsets:ack}:{}):rejected('unavailable','Native control did not acknowledge operation.');}
if(name==='journal.copy'){if(!l.e||!ctx.setClipboard)return rejected('not_found','Select an actual entry.');const ack=await ctx.setClipboard({kind:'text',text:l.e.blocks.map(b=>b.text).join('\n'),fileIds:[]},{windowId:l.windowId,guard:l.guard});if(ack?.status==='applied')return {...ack,target:{windowId:l.windowId}};return l.guard()?ack??rejected('unavailable','Clipboard unavailable.'):stale();}
if(name==='journal.paste'){const clip=ctx.getClipboard?.();if(!clip||clip.kind!=='text')return rejected('unsupported_content','Paste requires the scene text clipboard.');const pin=journalPinGraph(clip),source=l.guard;l={...l,guard:()=>source()&&ctx.getClipboard()===clip&&pin()};return edit(l,(c,w,_d,e)=>{if(!e)return rejected('not_found','Select an entry.');const block=createJournalBlock(c,clip.text);e.blocks.push(block);w.blockId=block.id;});}
if(name==='journal.close'&&l.w.locked&&['save','discard'].includes(p.decision))return rejected('locked','Unlock before saving or discarding retained journal content.');
if(name==='journal.close'){if(p.decision==='cancel')return commit(l,(_c,w)=>{w.panel='none';});if(l.d?.dirty&&!p.decision&&!l.w.locked)return commit(l,(_c,w)=>{w.panel='close';});if(l.d?.dirty&&!p.decision&&l.w.locked)return rejected('locked','Unlock to save or discard the dirty journal before closing.');if(p.decision==='save'){if(l.w.locked)return rejected('locked','Unlock before saving.');const result=await write(l,{},true);if(result.status!=='applied')return result;l=owner(target.windowId);if(!l)return stale();}if(p.decision==='discard'&&l.d?.dirty){const result=commit(l,(c,_w,d)=>{if(d.savedFingerprint){d.content=JSON.parse(d.savedFingerprint);d.dirty=false;d.undo=[];d.redo=[];for(const w of c.sessions.filter(w=>w.documentId===d.id))select(w,d);}else {c.documents.splice(c.documents.indexOf(d),1);for(const w of c.sessions.filter(w=>w.documentId===d.id))Object.assign(w,createJournalSession(w.windowId));}});if(result.status!=='applied')return result;l=owner(target.windowId);if(!l)return stale();}if(!ctx.closeWindow)return rejected('unavailable','Root close unavailable.');const ack=await ctx.closeWindow(l.windowId,{windowId:l.windowId,guard:l.guard});return ack===true||ack?.status==='applied'?applied(l.windowId):l.guard()?rejected('unavailable','Root did not close original window.'):stale();}
if(name==='journal.new')return commit(l,(c,w)=>{const d=addDocument(c,w,p.title??'My Journal',l.time);return {documentId:d.id};});
if(name==='journal.undo'||name==='journal.redo')return commit(l,(c,_w,d)=>{if(!d)return rejected('not_found','No journal.');const from=name==='journal.undo'?d.undo:d.redo,to=name==='journal.undo'?d.redo:d.undo;if(!from.length)return rejected('disabled','No retained edit in that direction.');to.push(copyCanonicalData(d.content));if(to.length>12)to.shift();d.content=from.pop();d.dirty=journalFingerprint(d.content)!==d.savedFingerprint;for(const w of c.sessions.filter(w=>w.documentId===d.id))select(w,d);});
if(['journal.document.rename','journal.entry.add','journal.entry.update','journal.entry.delete','journal.block.add','journal.block.update','journal.block.delete','journal.attachment.remove'].includes(name))return edit(l,(c,w,d,e)=>{if(name==='journal.document.rename')d.content.title=p.title;else if(name==='journal.entry.add'){const added=createJournalEntry(c,l.time,p.title??'New Entry');d.content.entries.unshift(added);w.entryId=added.id;w.blockId=added.blocks[0].id;}else {if(!e)return rejected('not_found','Select an entry first.');if(name==='journal.entry.update')Object.assign(e,p);else if(name==='journal.entry.delete'){d.content.entries.splice(d.content.entries.indexOf(e),1);for(const s of c.sessions.filter(s=>s.documentId===d.id&&s.entryId===e.id)){s.entryId=d.content.entries[0]?.id??null;s.blockId=d.content.entries[0]?.blocks[0]?.id??null;}}else if(name==='journal.block.add'){const b=createJournalBlock(c);b.kind=p.kind??'paragraph';if(b.kind==='heading')b.size=24;e.blocks.push(b);w.blockId=b.id;}else if(name==='journal.attachment.remove'){const i=e.attachments.findIndex(a=>a.id===p.attachmentId);if(i<0)return rejected('not_found','Attachment unavailable.');e.attachments.splice(i,1);}else {const b=e.blocks.find(b=>b.id===w.blockId);if(!b)return rejected('not_found','Select a rich text block.');if(name==='journal.block.update'){if(p.values.font){const fonts=ctx.getShared?.('fonts');if(p.values.font!=='system-ui'&&!availableFonts(fonts,ctx.getFile).some(f=>f.family===p.values.font||fontCSSFamily(f)===p.values.font))return rejected('not_found','Typeface must come from original active scene FontGraph.');}Object.assign(b,p.values);}else {if(e.blocks.length===1)return rejected('disabled','An entry needs at least one editable text block.');e.blocks.splice(e.blocks.indexOf(b),1);for(const s of c.sessions.filter(s=>s.blockId===b.id))s.blockId=e.blocks[0].id;}}}});
return commit(l,(c,w,d)=>{if(name==='journal.document.select'){const selected=journalDocument(c,p.documentId);if(!selected)return rejected('not_found','Journal unavailable.');select(w,selected);}else if(name==='journal.entry.select'){const e=journalEntry(d,p.entryId);if(!e)return rejected('not_found','Entry unavailable.');w.entryId=e.id;w.blockId=e.blocks[0].id;}else if(name==='journal.block.select'){const e=journalEntry(d,w.entryId);if(!e?.blocks.some(b=>b.id===p.blockId))return rejected('not_found','Block unavailable.');w.blockId=p.blockId;}else if(name==='journal.preferences')Object.assign(c.preferences,p);else if(name==='journal.lock'){if(!c.preferences.passHash)return rejected('disabled','Configure a local passphrase lock in preferences first.');for(const s of c.sessions){s.locked=true;s.panel='none';s.menu=null;}}else if(name==='journal.view')Object.assign(w,p);else if(name==='journal.panel'){if(w.locked&&!['none','lock','help','close'].includes(p.panel))return rejected('locked','Unlock before opening content panels.');w.panel=p.panel;w.menu=null;}else if(name==='journal.menu')w.menu=p.menuId;else return rejected('unavailable','Journal command unavailable.');});
}catch(error){return rejected(error.code??'invalid_state',error.message??'Journal operation failed.');}};
function lifecycle(change,guard){if(!alive()||guard()!==true)return false;const pin=journalPinGraph(state),time=ctx.getSceneTime(),v=generation,c=copyCanonicalData(state);if(change(c)===false)return false;c.revision++;const allowed=validateJournalState(c,ctx.profile).ok&&ctx.canCommit(journalTextUnits(c)-journalTextUnits(state))===true;if(!allowed||!alive()||!pin()||generation!==v||ctx.getSceneTime()!==time||guard()!==true)return false;publish(c);return true;}
function windowOpened(window,options={}){if(!window||ctx.getWindow(window.id)!==window||window.appId!=='journal'||journalSession(state,window.id))return false;return lifecycle(c=>{const w=createJournalSession(window.id);let d=options.documentId?journalDocument(c,options.documentId):c.documents[0];if(options.documentId&&!d)return false;if(!d)d=addDocument(c,w,'My Journal',ctx.getSceneTime());else select(w,d);w.locked=Boolean(c.preferences.passHash);c.sessions.push(w);},()=>ctx.getWindow(window.id)===window&&(!options.isCurrent||options.isCurrent()===true)&&(!options.ownership?.guard||options.ownership.guard()===true));}
function windowClosed(window,ownership={}){const actual=typeof window==='string'?ctx.getWindow(window):window;if(!actual||ctx.getWindow(actual.id)!==actual)return false;return lifecycle(c=>{const i=c.sessions.findIndex(w=>w.windowId===actual.id);if(i<0)return false;c.sessions.splice(i,1);if(c.preferences.lockOnClose&&c.preferences.passHash)for(const w of c.sessions){w.locked=true;w.panel='none';w.menu=null;}},()=>ctx.getWindow(actual.id)===actual&&(!ownership.guard||ownership.guard()===true));}
function appQuit(appId,ownership={}){if(appId!=='journal'||state.documents.some(d=>d.dirty)&&!ownership.discard)return false;return lifecycle(c=>{c.sessions=[];},()=>!ownership.guard||ownership.guard()===true);}
function sources(windowId){
 if(renderedFonts&&!renderedFonts.current())retireFonts();
 const l=owner(windowId);if(!l||l.w.locked)return {photos:[],files:[],fonts:[]};
 const photos=state.preferences.photoSuggestions&&permission('photos').allowed?(ctx.getShared('photos')?.items??[]).filter(i=>i.inLibrary&&!i.hidden&&!i.deletedAt&&i.mime.startsWith('image/')):[];
 const files=state.preferences.fileSuggestions&&permission('files').allowed?(ctx.listFiles?.()??[]).filter(f=>liveFile(f.id)===f&&!f.isDirectory&&['image/png','image/jpeg','image/webp','audio/wav','video/webm','application/pdf','text/plain'].includes(f.mime)):[];
 return {photos,files,fonts:availableFonts(ctx.getShared?.('fonts'),ctx.getFile)};
}
async function ensureFonts(windowId){
 if(!alive())return {ok:false,error:{message:'Original Journal font owner unavailable.'}};
 if(renderedFonts?.current())return {ok:true};
 const l=owner(windowId);if(!l||l.w.locked)return {ok:true};
 const rows=availableFonts(ctx.getShared?.('fonts'),ctx.getFile),name=l.d?.content.entries.flatMap(e=>e.blocks).find(b=>b.font!=='system-ui'&&rows.some(f=>f.family===b.font||fontCSSFamily(f)===b.font))?.font;
 if(!name)return {ok:true};
 try{const result=await prepareFont(l,name);return result.error?{ok:false,error:result.error.error}:{ok:true};}
 catch(error){return {ok:false,error:{message:error.message??'Original scene typefaces unavailable; System fallback is displayed.'}};}
}
return {handlers,windowOpened,windowClosed,appQuit,sources,ensureFonts,dispose(){disposed=true;generation++;sourceFiles.clear();retireFonts();},targets:()=>({journal:alive()?state.sessions.map(w=>({windowId:w.windowId,locked:w.locked,documentIds:w.locked?[]:state.documents.map(d=>d.id),entryIds:w.locked?[]:journalDocument(state,w.documentId)?.content.entries.map(e=>e.id)??[],blockIds:w.locked?[]:journalEntry(journalDocument(state,w.documentId),w.entryId)?.blocks.map(b=>b.id)??[]})):[]})};
}

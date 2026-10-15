import {PDFDocument} from 'pdf-lib';
import {createJournalState,createJournalEntry} from './journal-state.js';
import {journalPDF,journalHTML,encodeJournal,decodeJournal} from './journal-codec.js';
import {PREVIEW_IMAGE_CONTENT} from './preview-image-fixture.js';
const assert=(condition,message)=>{if(!condition)throw Error(message);};
/** Main-owned actual browser verification. Supply the real scene FontGraph and
 * original File reader; this exercises real canvas/image/PDF decoding, not mocks. */
export async function runJournalRenderTests({profile,fonts,getFile,sceneTime=1700000000000}){
 assert(typeof document!=='undefined'&&document.createElement('canvas').getContext('2d'),'Requires actual browser canvas.');
 assert(fonts&&typeof getFile==='function','Supply original canonical scene FontGraph and File reader.');
 const state=createJournalState(profile),entry=createJournalEntry(state,sceneTime,'An authored moment');
 entry.blocks[0].text='Rich text with actual pixels and original image bytes.';entry.blocks[0].bold=true;entry.blocks[0].color='#663399';
 entry.attachments.push({id:'journal-render-attachment',name:'Authored fixture image',mime:'image/png',content:PREVIEW_IMAGE_CONTENT,source:'file',sourceId:'authored-render-fixture',sourceRevision:0,width:960,height:640});
 const content={title:'Journal render assertion',entries:[entry]},encoded=await journalPDF(content,sceneTime,{guard:()=>true,fonts,getFile});
 assert(encoded.startsWith('data:application/pdf;base64,'),'Must return actual PDF MIME data URL.');
 const bytes=Uint8Array.from(atob(encoded.split(',')[1]),c=>c.charCodeAt(0));
 assert(new TextDecoder().decode(bytes.slice(0,8)).startsWith('%PDF-1.'),'Requires genuine PDF signature.');
 const decoded=await PDFDocument.load(bytes);assert(decoded.getPageCount()>=1&&decoded.getPageCount()<=128,'Real PDF page count is bounded.');
 const {width,height}=decoded.getPage(0).getSize();assert(Math.abs(width-595.28)<.01&&Math.abs(height-841.89)<.01,'Expected genuine A4 dimensions.');
 const html=journalHTML(content),dom=new DOMParser().parseFromString(html,'text/html'),image=dom.querySelector('img');assert(image?.getAttribute('src')===PREVIEW_IMAGE_CONTENT,'Portable HTML must retain actual original image bytes.');assert(dom.querySelector('p')?.textContent===entry.blocks[0].text,'Portable HTML must retain actual rich text.');
 assert(decodeJournal(encodeJournal(content)).entries[0].attachments[0].content===PREVIEW_IMAGE_CONTENT,'Editable portable format must retain exact bytes.');
 entry.blocks[0].font='";background-image:url(data:image/png;base64,AAAA);font-family:"';
 const isolated=new DOMParser().parseFromString(journalHTML(content),'text/html');assert(isolated.querySelector('p').style.backgroundImage==='','Imported typeface text must never become executable CSS or resource requests.');
 let live=true;const pending=journalPDF(content,sceneTime,{guard:()=>live,fonts,getFile});live=false;let rejected=false;try{await pending;}catch(error){rejected=error.code==='stale_target';}assert(rejected,'Every awaited PDF path must reject a stale original lease.');
 return {pages:decoded.getPageCount(),mime:'application/pdf'};
}

/** Actual Root integration seam; Main supplies the real typed command executor,
 * canonical Journal/Photos/Privacy/File readers and an original bounded image File.
 * Privacy grants must be authored through actual native Settings before this call. */
export async function runJournalNativeAttachmentTests({execute,getState,getShared,getFile,windowId,photo,imageFile}){
 assert(typeof createImageBitmap==='function','Requires the genuine browser bitmap decoder.');
 assert(typeof execute==='function'&&typeof getState==='function'&&typeof getShared==='function'&&typeof getFile==='function','Supply actual Root native interfaces.');
 const state=getState(),photos=getShared('photos'),preferences=getShared('preferences');
 assert(photos?.items.includes(photo)&&photo.inLibrary&&!photo.hidden&&!photo.deletedAt,'Supply an original visible canonical Photos row.');
 assert(getFile(imageFile?.id)===imageFile&&!imageFile.isDirectory,'Supply an original live bounded image File.');
 for(const category of ['photos','files'])assert(preferences.configuration.security.permissions.some(p=>p.appId==='journal'&&p.category===category&&p.allowed===true),`Actual native Privacy must grant Journal ${category}.`);
 const originalPhotos=JSON.stringify(photos),originalFile=JSON.stringify(imageFile);
 const call=(command,payload)=>execute({command:`journal.${command}`,target:{windowId},payload});
 assert((await call('preferences',{photoSuggestions:true})).status==='applied','Actual Journal preference must commit.');
 for(const [source,row,payload] of [['photo',photo,{photoId:photo.id}],['file',imageFile,{fileId:imageFile.id}]]){
  const content=source==='photo'?row.editedContent??row.content:row.content;
  const mime=source==='photo'?row.editedMime??row.mime:row.mime??/^data:(image\/(?:png|jpeg|webp));base64,/.exec(content)?.[1];
  assert(['image/png','image/jpeg','image/webp'].includes(mime)&&content.length<=65536,'Use a genuine small native raster source, not synthetic decoder output.');
  const bytes=Uint8Array.from(atob(content.split(',')[1]),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:mime}),{imageOrientation:'none'});
  try{
   const result=await call('attachment.add',payload);assert(result.status==='applied',`Actual ${source} attachment must commit: ${JSON.stringify(result)}`);
   assert(getState()===state,'Root Journal must preserve the original actor reference.');
   const session=state.sessions.find(w=>w.windowId===windowId),entry=state.documents.find(d=>d.id===session.documentId).content.entries.find(e=>e.id===session.entryId);
   const attachment=entry.attachments.find(a=>a.id===result.attachmentId);
   assert(attachment?.content===content&&attachment.mime===mime,'Committed attachment must contain exact genuine source bytes and MIME.');
   assert(attachment.width===bitmap.width&&attachment.height===bitmap.height,'Committed axes must match independently decoded native pixels.');
   assert(attachment.source===source&&attachment.sourceId===row.id&&attachment.sourceRevision===(row.revision??null),'Committed provenance must preserve actual original source metadata.');
  }finally{bitmap.close();}
 }
 assert(getShared('photos')===photos&&photos.items.includes(photo)&&JSON.stringify(photos)===originalPhotos,'Journal must not mutate or replace canonical Photos.');
 assert(getFile(imageFile.id)===imageFile&&JSON.stringify(imageFile)===originalFile,'Journal must not mutate or enrich original source File.');
 return {photoId:photo.id,fileId:imageFile.id,windowId};
}

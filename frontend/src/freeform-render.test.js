import { PDFDocument } from 'pdf-lib';
import { createFreeformObject,createFreeformState,freeformDocument,freeformSession,validateFreeformState } from './freeform-state.js';
import { freeformRender,freeformPNG,freeformPDF,freeformInspectMedia,encodeFreeformBoard,decodeFreeformBoard } from './freeform-engine.js';
import { createFreeformCommands } from './freeform-commands.js';
const assert=(condition,message)=>{if(!condition)throw Error(message);};
/** Run from the real browser test harness; no mocked Canvas, decoder, font or media output. */
export async function runFreeformRenderTests(){
 if(!globalThis.document?.createElement)throw Error('These assertions require a real browser with native Canvas and media decoders.');
 const content={title:'Actual pixels',background:'#ffffff',objects:[createFreeformObject('shape-real','shape',{x:20,y:20,width:100,height:80,fill:'#ff0000',stroke:'#ff0000',text:''})]},options={guard:()=>true,fonts:null,getFile:()=>null};
 const before=await freeformRender(content,options),ctx=before.canvas.getContext('2d'),sample=ctx.getImageData(80,80,1,1).data;
 assert(sample[0]>240&&sample[1]<20&&sample[2]<20,'Authored red shape must generate actual red pixels.');
 const png=await freeformPNG(content,options);assert(png.content.startsWith('data:image/png;base64,'),'PNG envelope must be genuine.');assert(atob(png.content.split(',')[1]).startsWith('\x89PNG\r\n\x1a\n'),'PNG must have a binary PNG signature.');
 const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=png.content;});assert(image.naturalWidth===png.width&&image.naturalHeight===png.height,'Native decoder must read actual PNG dimensions.');
 content.objects[0].fill='#0000ff';content.objects[0].stroke='#0000ff';const after=await freeformPNG(content,options);assert(after.content!==png.content,'Changing actual vector style must change PNG bytes.');
 const pdf=await freeformPDF(content,options),bytes=Uint8Array.from(atob(pdf.content.split(',')[1]),c=>c.charCodeAt(0)),document=await PDFDocument.load(bytes);assert(document.getPageCount()===1,'Real PDF parser must accept the generated one-page document.');assert(document.getPage(0).getWidth()===after.width,'PDF MediaBox must match the real renderer.');
 const media=await freeformInspectMedia({mime:'image/png'},png.content,()=>true);assert(media.type==='image'&&media.width>0&&media.height>0,'Real File media import must use decoded PNG geometry.');
 content.objects.push(createFreeformObject('image-real','image',{x:160,y:20,width:100,height:80,mime:'image/png',content:png.content}));const portable=decodeFreeformBoard(encodeFreeformBoard(content)),embedded=await freeformPNG(portable,options);assert(embedded.content!==after.content,'Portable board must retain genuinely renderable image bytes.');
 let stale=false;try{await freeformPNG(content,{...options,guard:()=>false});}catch{stale=true;}assert(stale,'A stale original source must never generate acknowledged output.');
 const profile={id:'macos-sonoma-14.0'},state=createFreeformState(profile),window={id:'original-window',appId:'freeform'},file={id:'original-image',name:'Real image.png',content:png.content};
 const actor=createFreeformCommands(state,{profile,getState:()=>state,alive:()=>true,getSceneTime:()=>1,getWindow:id=>id===window.id?window:null,getView:()=>null,getShared:()=>null,canCommit:()=>true,getFile:id=>id===file.id?file:null,readFile:async(id,ownership)=>{assert(id===file.id&&ownership.guard(),'Original File read guard must remain current.');return {status:'applied',file,text:file.content,name:file.name,mime:'image/png'};}});
 assert(actor.windowOpened(window),'Actual canonical window must register.');await actor.handlers['freeform.new']({windowId:window.id},{});
 const imported=await actor.handlers['freeform.media.insert']({windowId:window.id},{fileId:file.id}),board=freeformDocument(state,freeformSession(state,window.id).documentId),attachment=board.content.objects[0];
 assert(imported.status==='applied'&&attachment.mime==='image/png'&&attachment.fileRevision===null,'Acknowledged reader MIME must import actual bytes while absent source revision remains null.');
 assert(!Object.hasOwn(file,'mime')&&!Object.hasOwn(file,'revision')&&validateFreeformState(state,profile).ok,'Import must not enrich or mutate the original File metadata.');actor.dispose();
 return {cases:10,pngWidth:png.width,pngHeight:png.height,pdfPages:document.getPageCount()};
}

import {journalContentSchema,journalSchemaValid} from './journal-state.js';
export {inspectJournalAttachment} from './journal-attachments.js';
import {availableFonts,loadAvailableFonts,fontCSSFamily} from './font-book-fonts.js';
export const JOURNAL_MIME='application/vnd.jesteros.journal+json';
export const journalError=(code,message)=>{const error=Error(message);error.code=code;throw error;};
export function journalPinGraph(root){const rows=[],seen=new Set();function visit(value){if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);if(keys.some(k=>!Object.hasOwn(descriptors[k],'value')))journalError('invalid_state','Journal requires original plain data, not accessors.');rows.push([value,keys,descriptors]);for(const k of keys)visit(descriptors[k].value);}visit(root);return()=>rows.every(([value,keys,descriptors])=>{const current=Object.getOwnPropertyDescriptors(value),now=Reflect.ownKeys(current);return now.length===keys.length&&keys.every(k=>Object.hasOwn(current,k)&&Object.hasOwn(current[k],'value')&&Object.is(current[k].value,descriptors[k].value));});}
export function encodeJournal(content){return JSON.stringify({format:'JesterOS Journal',version:1,content});}
export function decodeJournal(text){if(typeof text!=='string'||text.length>1048576)journalError('limit_exceeded','Journal input exceeds 1 MiB.');let value;try{value=JSON.parse(text);}catch{journalError('invalid_format','Not a custom .jjournal JSON document.');}if(!value||Object.keys(value).length!==3||value.format!=='JesterOS Journal'||value.version!==1||!journalSchemaValid(value.content,journalContentSchema))journalError('unsupported_content','Only the disclosed JesterOS Journal .jjournal format is supported, not native Apple archives.');return value.content;}
const escape=text=>String(text).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const portableFont=font=>`"${font.replace(/^"(.*)"$/u,'$1').replace(/["\\\r\n\f]/gu,c=>`\\${c.codePointAt(0).toString(16)} `)}",system-ui`;
export function journalHTML(content){
 const entries=content.entries.map(e=>{
  const blocks=e.blocks.map(b=>{
   const tag=b.kind==='heading'?'h3':b.kind==='quote'?'blockquote':'p';
   return `<${tag} style="white-space:pre-wrap;font-size:${b.size}px;color:${b.color};font-family:${escape(portableFont(b.font))};font-weight:${b.bold?'bold':'normal'};font-style:${b.italic?'italic':'normal'};text-decoration:${b.underline?'underline':'none'}">${b.kind==='bullet'?'• ':''}${escape(b.text)}</${tag}>`;
  }).join('');
  const attachments=e.attachments.map(a=>{
   const name=escape(a.name),url=a.mime==='text/plain'?'data:text/plain;charset=utf-8,'+encodeURIComponent(a.content):a.content;
   if(a.mime.startsWith('image/'))return `<figure><img src="${escape(url)}" alt="${name}"><figcaption>${name}</figcaption></figure>`;
   if(a.mime.startsWith('audio/'))return `<figure><audio controls src="${escape(url)}"></audio><figcaption>${name}</figcaption></figure>`;
   if(a.mime.startsWith('video/'))return `<figure><video controls src="${escape(url)}"></video><figcaption>${name}</figcaption></figure>`;
   return `<a download="${name}" href="${escape(url)}">${name}</a>`;
  }).join('');
  return '<article><h2>'+escape(e.title)+'</h2><time>'+escape(e.date)+'</time>'+blocks+'<section class="attachments">'+attachments+'</section></article>';
 }).join('');
 return '<!doctype html><html><head><meta charset="utf-8"><title>'+escape(content.title)+'</title><style>body{max-width:760px;margin:48px auto;color:#292733;font-family:system-ui}article{break-after:page;margin-bottom:48px}img,video{max-width:100%}blockquote{border-left:3px solid #8b6aae;padding-left:16px}.attachments{display:grid;gap:16px}</style></head><body><h1>'+escape(content.title)+'</h1>'+entries+'</body></html>';
}
export async function journalPDF(content,time,{guard,fonts,getFile}){
 const owned=()=>{if(guard()!==true)journalError('stale_target','Journal, source Files, font graph or scene time changed.');};
 owned();if(typeof document==='undefined')journalError('unavailable','Actual local canvas unavailable.');
 const lib=await import('pdf-lib');owned();let loaded;
 try{
  if(fonts){loaded=await loadAvailableFonts(fonts,{getFile,guard});owned();}
  const pdf=await lib.PDFDocument.create();owned();
  pdf.setTitle(content.title);pdf.setProducer('JesterOS Journal local static raster export');pdf.setCreationDate(new Date(time));pdf.setModificationDate(new Date(time));
  let canvas,context,y;
  const page=()=>{
   owned();if(pdf.getPageCount()>=128)journalError('limit_exceeded','Journal PDF is bounded to 128 rendered pages.');
   canvas=document.createElement('canvas');canvas.width=900;canvas.height=1273;context=canvas.getContext('2d');
   if(!context)journalError('unavailable','Actual local canvas unavailable.');
   context.fillStyle='#ffffff';context.fillRect(0,0,900,1273);y=64;
  };
  const flush=async()=>{owned();const embedded=await pdf.embedPng(canvas.toDataURL('image/png'));owned();const p=pdf.addPage([595.28,841.89]);p.drawImage(embedded,{x:0,y:0,width:595.28,height:841.89});};
  const rows=availableFonts(fonts,getFile),family=name=>{const found=rows.find(f=>f.family===name||fontCSSFamily(f)===name);return found?fontCSSFamily(found):'system-ui';};
  async function text(value,style={}){
   owned();const size=style.size??22,font=`${style.italic?'italic ':''}${style.bold?'bold ':''}${size}px ${family(style.font)}`;context.font=font;
   const lines=[];
   for(const paragraph of value.split('\n')){let line='';for(const c of paragraph){if(line&&context.measureText(line+c).width>772){lines.push(line);line='';}line+=c;}lines.push(line);}
   for(const line of lines){
    if(y+size*1.5>1209){await flush();owned();page();context.font=font;}
    context.fillStyle=style.color??'#292733';context.fillText(line,64,y+size);
    if(style.underline)context.fillRect(64,y+size+3,context.measureText(line).width,1);
    y+=size*1.5;
   }
   y+=12;owned();
  }
page();await text(content.title,{size:32,bold:true});for(const entry of content.entries){await text(entry.title,{size:28,bold:true});await text(entry.date,{size:18,color:'#777777'});for(const b of entry.blocks)await text((b.kind==='bullet'?'• ':'')+b.text,{...b,size:b.size*1.5});for(const a of entry.attachments){if(a.mime.startsWith('image/')){const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Object.assign(Error('Original attachment image could not decode.'),{code:'invalid_format'}));image.src=a.content;});owned();const width=Math.min(772,image.naturalWidth),height=image.naturalHeight*width/image.naturalWidth;if(height>1040)journalError('unsupported_content','Tall image attachment does not fit a PDF page; export HTML or .jjournal to preserve it.');if(y+height>1209){await flush();page();}context.drawImage(image,64,y,width,height);y+=height+8;}await text(`${a.name}${a.mime.startsWith('audio/')||a.mime.startsWith('video/')?' (static PDF label; original media is retained only in HTML/.jjournal)':''}`,{size:16,color:'#666666'});}y+=24;}await flush();const encoded=await pdf.saveAsBase64({useObjectStreams:false});owned();if(encoded.length>1048576)journalError('limit_exceeded','Actual PDF exceeds Root File quota.');return `data:application/pdf;base64,${encoded}`;}finally{loaded?.dispose();}}

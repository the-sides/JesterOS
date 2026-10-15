import {bytesFromFile,parseFont,fontSignature,fontCharacters} from './font-book-parser.js';
import {fileSourceAvailable,identityLease} from './keychain-controller.js';
export const fontCSSFamily=font=>`"JesterFont-${font.id}-${font.signature}"`;
export function fontSourceAvailable(font,getFile){if(font.source==='bundled')return true;const file=getFile?.(font.fileId);return fileSourceAvailable(file,getFile)&&file.revision===font.revision;}
export function availableFonts(graph,getFile){return (graph?.fonts??[]).filter(font=>font.enabled&&fontSourceAvailable(font,getFile));}
// Font Book and native document surfaces share this exact-byte rendering loader.
export async function loadAvailableFonts(graph,{getFile,guard=()=>true,cryptoProvider=globalThis.crypto,fontSet=globalThis.document?.fonts,FontFaceClass=globalThis.FontFace,fetchBytes=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Bundled font unavailable.');return new Uint8Array(await r.arrayBuffer());}}={}){
 if(!fontSet||!FontFaceClass)throw new Error('Native font rendering unavailable.');
 const sameGraph=identityLease(graph),signature=JSON.stringify(graph),rows=availableFonts(graph,getFile),leases=rows.map(row=>{const file=row.fileId?getFile(row.fileId):null;return {row,file,sameFile:file?identityLease(file):()=>true};});
 const current=()=>guard()===true&&sameGraph()&&JSON.stringify(graph)===signature&&leases.every(({row,file,sameFile})=>graph.fonts.includes(row)&&(!file||getFile(row.fileId)===file&&sameFile()&&file.revision===row.revision&&fileSourceAvailable(file,getFile)));
 const faces=[],characters={};
 for(const {row,file} of leases){
  if(!current())throw new Error('Font graph changed.');
  const bytes=file?bytesFromFile(file.content??file.text):await fetchBytes(row.bundledPath);
  if(!current())throw new Error('Font source changed.');
  if(await fontSignature(bytes,cryptoProvider)!==row.signature)throw new Error('Font byte signature changed; reinstall the original File.');
  if(!current())throw new Error('Font source changed.');
  if(row.format!=='woff2'){
   const metadata=parseFont(bytes);
   if(['family','style','postscript','format'].some(key=>metadata[key]!==row[key]))throw new Error('Retained metadata does not describe the original font bytes; reinstall the File.');
   characters[row.id]=fontCharacters(bytes);
  }
  const face=new FontFaceClass(`JesterFont-${row.id}-${row.signature}`,bytes,{style:/italic|oblique/i.test(row.style)?'italic':'normal',weight:/bold|black|heavy/i.test(row.style)?'700':'400'});
  await face.load();
  if(!current())throw new Error('Font rendering lease changed.');
  faces.push(face);
 }
 if(!current())throw new Error('Font graph changed.');
 try{for(const face of faces){if(!current())throw new Error('Font graph changed.');fontSet.add(face);}if(!current())throw new Error('Font graph changed.');}catch(error){for(const face of faces)fontSet.delete(face);throw error;}
 return {fonts:rows,characters,dispose(){for(const face of faces)fontSet.delete(face);}};
}

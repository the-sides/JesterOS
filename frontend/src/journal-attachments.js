import {photoContentValid} from './photos-state.js';
import {photoGeometry} from './photos-geometry.js';
const fail=(code,message)=>{const error=Error(message);error.code=code;throw error;};
export function inspectJournalAttachment(file){
 const {mime,content}=file;
 if(['image/png','image/jpeg','image/webp'].includes(mime)){
  if(!photoContentValid(content,mime))fail('invalid_format','Image bytes do not match MIME.');
  return photoGeometry(content,mime);
 }
 if(['audio/wav','video/webm'].includes(mime)){
  if(mime==='audio/wav'){
   if(!/^data:audio\/wav;base64,[A-Za-z0-9+/]*={0,2}$/u.test(content))fail('invalid_format','WAV requires actual base64 bytes.');
   const raw=atob(content.split(',')[1]);
   if(raw.length<44||!raw.startsWith('RIFF')||raw.slice(8,12)!=='WAVE'||!raw.includes('fmt ')||!raw.includes('data'))fail('invalid_format','WAV lacks a genuine RIFF/WAVE container.');
  }else if(!photoContentValid(content,mime))fail('invalid_format','Video bytes do not match a genuine WebM container.');
  return {width:0,height:0};
 }
 if(mime==='application/pdf'){
  if(!/^data:application\/pdf;base64,[A-Za-z0-9+/]*={0,2}$/u.test(content))fail('invalid_format','PDF requires actual base64 bytes.');
  const raw=atob(content.split(',')[1]);
  if(!/^%PDF-1\.[0-9]/u.test(raw)||!raw.includes('startxref')||!raw.trimEnd().endsWith('%%EOF'))fail('invalid_format','PDF attachment lacks an actual complete PDF container.');
  return {width:0,height:0};
 }
 if(mime==='text/plain'&&typeof content==='string')return {width:0,height:0};
 fail('unsupported_content','Attachments support genuine PNG/JPEG/WebP, WAV, WebM, PDF and plain text Files.');
}

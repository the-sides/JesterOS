import {bytesFromFile} from './keychain-certificates.js';
export {bytesFromFile};
const fail=message=>{throw new Error(message);};
export function parseFont(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>1048576)fail('Font bytes exceed local parser bounds.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=p=>String.fromCharCode(...bytes.subarray(p,p+4)),signature=tag(0);
 if(signature==='wOF2'||signature==='wOFF')fail('Compressed web fonts may be previewed when bundled, but user installation requires uncompressed TTF or OTF.');
 const format=v.getUint32(0)===0x10000?'ttf':signature==='OTTO'?'otf':null;
 if(!format)fail('Unsupported font signature; use TTF or OTF, not renamed JSON.');
 const count=v.getUint16(4);
 if(count<3||count>128||12+16*count>bytes.length)fail('Invalid SFNT directory.');
 const tables=new Map(),ranges=[];
 for(let i=0;i<count;i++){
  const p=12+i*16,name=tag(p),offset=v.getUint32(p+8),length=v.getUint32(p+12);
  if(tables.has(name)||offset<12+16*count||offset%4||offset+length>bytes.length)fail('Invalid table range.');
  if(length&&ranges.some(r=>offset<r[1]&&offset+length>r[0]))fail('Overlapping tables.');
  ranges.push([offset,offset+length]);tables.set(name,{offset,length,checksum:v.getUint32(p+4)});
 }
 for(const required of ['name','head','maxp','cmap','hhea','hmtx','OS/2'])if(!tables.has(required))fail(`Missing ${required} table.`);
 if(!tables.has(format==='ttf'?'glyf':'CFF ')&&!tables.has('CFF2'))fail('Missing glyph outlines.');
 for(const [name,t] of tables){
  let sum=0;
  for(let p=0;p<t.length;p+=4){
   let word=0;
   for(let j=0;j<4;j++)word=word*256+(p+j<t.length&&!(name==='head'&&p+j>=8&&p+j<12)?bytes[t.offset+p+j]:0);
   sum=(sum+word)>>>0;
  }
  if(sum!==t.checksum)fail(`Table checksum failed: ${name}.`);
 }
 const head=tables.get('head');
 if(head.length<54||v.getUint32(head.offset+12)!==0x5f0f3cf5)fail('Invalid head magic.');
 const maxp=tables.get('maxp');
 if(maxp.length<6)fail('Invalid glyph count.');
 const glyphs=v.getUint16(maxp.offset+4);
 if(!glyphs)fail('Empty font.');
 const n=tables.get('name'),base=n.offset;
 if(n.length<6)fail('Invalid name table.');
 const records=v.getUint16(base+2),storage=v.getUint16(base+4);
 if(records>2048||6+records*12>n.length||storage>n.length)fail('Invalid name directory.');
 const values=new Map();
 for(let i=0;i<records;i++){
  const p=base+6+i*12,platform=v.getUint16(p),language=v.getUint16(p+4),id=v.getUint16(p+6),length=v.getUint16(p+8),offset=v.getUint16(p+10);
  if(storage+offset+length>n.length)fail('Name string out of bounds.');
  if(![0,1,3].includes(platform)||![1,2,4,6,13,16,17].includes(id))continue;
  const raw=bytes.subarray(base+storage+offset,base+storage+offset+length);
  let text='';
  if(platform===0||platform===3){
   if(length%2)fail('Odd UTF-16 name length.');
   for(let j=0;j<length;j+=2)text+=String.fromCharCode(raw[j]*256+raw[j+1]);
  }else text=new TextDecoder('macintosh').decode(raw);
  text=text.replace(/\0/gu,'').trim();
  if(id===13)text=text.slice(0,1024); // Bounded license excerpt; exports retain complete original bytes.
  else if(text.length>1024)fail('Font metadata too long.');
  const priority=platform===3&&language===0x409?3:platform===0?2:1;
  if(text&&(!values.has(id)||values.get(id).priority<priority))values.set(id,{text,priority});
 }
 const get=id=>values.get(id)?.text??'',family=get(16)||get(1),style=get(17)||get(2)||'Regular',postscript=get(6);
 if(!family||!postscript||/[\s\[\](){}<>/%]/u.test(postscript))fail('Missing or invalid font names.');
 fontCharacters(bytes);
 return {family,style,postscript,format,glyphs,license:get(13),warnings:[]};
}
export async function fontSignature(bytes,cryptoProvider=globalThis.crypto){if(!cryptoProvider?.subtle)fail('SHA-256 unavailable.');return Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
// Unicode repertoire from actual cmap mappings, bounded for browser rendering.
export function fontCharacters(bytes,limit=4096){
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>1048576||!Number.isInteger(limit)||limit<1||limit>4096)fail('Invalid repertoire input or bound.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint16(4);
 if(count>128||12+count*16>bytes.length)fail('Invalid repertoire directory.');
 let base=0,length=0,glyphs=0;
 for(let i=0;i<count;i++){
  const p=12+i*16,tag=String.fromCharCode(...bytes.subarray(p,p+4)),offset=view.getUint32(p+8),size=view.getUint32(p+12);
  if(offset+size>bytes.length)fail('Invalid repertoire table range.');
  if(tag==='cmap'){base=offset;length=size;}
  if(tag==='maxp'){if(size<6)fail('Invalid repertoire glyph count.');glyphs=view.getUint16(offset+4);}
 }
 if(!glyphs)fail('Missing repertoire glyph count.');
 if(!base||length<4||base+length>bytes.length)fail('Missing character map.');
 const records=view.getUint16(base+2);if(records>256||4+records*8>length)fail('Invalid cmap records.');
 let chosen=null;
 for(let i=0;i<records;i++){
  const p=base+4+i*8,platform=view.getUint16(p),encoding=view.getUint16(p+2),offset=view.getUint32(p+4);
  if(offset+2>length)fail('Invalid cmap offset.');
  if(platform!==0&&!(platform===3&&[1,10].includes(encoding)))continue;
  const format=view.getUint16(base+offset);
  if([4,12].includes(format)&&(!chosen||format>chosen.format))chosen={offset:base+offset,format};
 }
 if(!chosen)fail('No supported Unicode cmap (4 or 12).');
 const out=[],add=(code,glyph)=>{if(glyph>=glyphs)fail('Character map references a nonexistent glyph.');if(glyph&&code>=32&&code<=0x10ffff&&(code<0xd800||code>0xdfff)&&out.length<limit)out.push(code);};
 const p=chosen.offset;
 if(chosen.format===12){
  if(p+16>base+length)fail('Truncated cmap12.');
  const size=view.getUint32(p+4),groups=view.getUint32(p+12);
  if(groups>65536||size<16+groups*12||p+size>base+length)fail('Invalid cmap12 bounds.');
  let previous=-1;
  for(let i=0;i<groups;i++){
   const q=p+16+i*12,start=view.getUint32(q),end=view.getUint32(q+4),glyph=view.getUint32(q+8);
   if(start>end||end>0x10ffff||start<=previous||glyph+end-start>=glyphs)fail('Invalid cmap12 group.');
   previous=end;
   for(let code=start;code<=end&&out.length<limit;code++)add(code,glyph+code-start);
  }
 }else{
  if(p+14>base+length)fail('Truncated cmap4.');
  const size=view.getUint16(p+2),segments=view.getUint16(p+6)/2;
  if(!Number.isInteger(segments)||segments<1||segments>8192||size<16+segments*8||p+size>base+length)fail('Invalid cmap4 bounds.');
  const endBase=p+14,startBase=endBase+segments*2+2,deltaBase=startBase+segments*2,rangeBase=deltaBase+segments*2;
  let previous=-1;
  for(let i=0;i<segments;i++){
   const start=view.getUint16(startBase+i*2),end=view.getUint16(endBase+i*2),delta=view.getInt16(deltaBase+i*2),range=view.getUint16(rangeBase+i*2);
   if(start>end||end<=previous)fail('Invalid cmap4 segment.');
   previous=end;
   for(let code=start;code<=end;code++){
    if(code===65535)continue;
    let glyph=(code+delta)&65535;
    if(range){const address=rangeBase+i*2+range+(code-start)*2;if(address+2>p+size)fail('Glyph mapping out of bounds.');glyph=view.getUint16(address);if(glyph)glyph=(glyph+delta)&65535;}
    add(code,glyph);
   }
  }
 }
 return out;
}

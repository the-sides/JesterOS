// DER X.509 structure parsing, not chain verification or host trust changes.
const fail=message=>{throw new Error(message);};
export function bytesFromFile(text){if(typeof text!=='string')fail('Files must contain text or a base64 data URL.');const m=/^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/u.exec(text);if(m){let raw;try{raw=atob(m[1].replace(/\s/gu,''));}catch{fail('Invalid base64 bytes.');}return Uint8Array.from(raw,c=>c.charCodeAt(0));}return new TextEncoder().encode(text);}
export function bytesDataURL(bytes,mime='application/octet-stream'){let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return `data:${mime};base64,${btoa(raw)}`;}
export function certificateDER(text){const pem=/^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)\s*-----END CERTIFICATE-----\s*$/u.exec(text);return pem?bytesFromFile(`data:application/pkix-cert;base64,${pem[1]}`):bytesFromFile(text);}
export function certificatePEM(bytes){const encoded=bytesDataURL(bytes).split(',')[1];return `-----BEGIN CERTIFICATE-----\n${encoded.match(/.{1,64}/gu).join('\n')}\n-----END CERTIFICATE-----\n`;}
function node(bytes,start,end=bytes.length){if(start+2>end)fail('Truncated DER.');const tag=bytes[start++],first=bytes[start++];let length=first;if(first&128){const n=first&127;if(!n||n>4||start+n>end||bytes[start]===0)fail('Invalid DER length.');length=0;for(let i=0;i<n;i++)length=length*256+bytes[start++];if(length<128)fail('Noncanonical DER length.');}if(start+length>end)fail('DER length exceeds input.');return {tag,start,end:start+length,next:start+length};}
function children(bytes,n){const list=[];let p=n.start;while(p<n.end){const c=node(bytes,p,n.end);list.push(c);p=c.next;if(list.length>256)fail('Too many DER elements.');}return list;}
function oid(bytes,n){if(n.tag!==6||n.start===n.end)fail('Expected object identifier.');const values=[];let value=0;for(let i=n.start;i<n.end;i++){value=value*128+(bytes[i]&127);if(value>Number.MAX_SAFE_INTEGER)fail('OID component overflow.');if(!(bytes[i]&128)){values.push(value);value=0;}}if(bytes[n.end-1]&128)fail('Incomplete OID.');const first=values.shift();return [first<40?0:first<80?1:2,first<80?first%40:first-80,...values].join('.');}
const names={'2.5.4.3':'CN','2.5.4.6':'C','2.5.4.7':'L','2.5.4.8':'ST','2.5.4.10':'O','2.5.4.11':'OU','1.2.840.113549.1.9.1':'emailAddress'};
function string(bytes,n){if(!n||![12,18,19,20,22,23,24,26,30].includes(n.tag))fail('Unsupported ASN.1 string.');const b=bytes.subarray(n.start,n.end);if(n.tag===30){if(b.length%2)fail('Invalid BMP string.');let s='';for(let i=0;i<b.length;i+=2)s+=String.fromCharCode(b[i]*256+b[i+1]);return s;}return new TextDecoder(n.tag===20?'iso-8859-1':'utf-8',{fatal:true}).decode(b);}
function name(bytes,n){if(n.tag!==48)fail('Expected distinguished name.');return children(bytes,n).map(set=>{if(set.tag!==49)fail('Expected name set.');return children(bytes,set).map(pair=>{if(pair.tag!==48)fail('Expected name pair.');const p=children(bytes,pair);if(p.length!==2)fail('Invalid name pair.');const id=oid(bytes,p[0]);return `${names[id]??id}=${string(bytes,p[1])}`;}).join('+');}).join(', ');}
function time(bytes,n){const s=string(bytes,n);let match;if(n.tag===23&&(match=/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/u.exec(s))){match[1]=String(Number(match[1])<50?2000+Number(match[1]):1900+Number(match[1]));}else if(n.tag!==24||!(match=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/u.exec(s)))fail('Unsupported certificate time.');const iso=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,instant=Date.parse(iso);if(!Number.isFinite(instant)||new Date(instant).toISOString()!==iso.replace('Z','.000Z'))fail('Invalid certificate date.');return iso;}
export function parseCertificate(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<32||bytes.length>262144)fail('Certificate must be bounded DER bytes.');
 const root=node(bytes,0);
 if(root.tag!==48||root.next!==bytes.length)fail('Expected one X.509 DER sequence.');
 const parts=children(bytes,root);
 if(parts.length!==3||parts[0].tag!==48||parts[1].tag!==48||parts[2].tag!==3)fail('Invalid X.509 envelope.');
 const t=children(bytes,parts[0]);
 let i=0,version=1;
 if(t[0]?.tag===160){
  const v=children(bytes,t[i++]);
  if(v.length!==1||v[0].tag!==2||v[0].end-v[0].start!==1||bytes[v[0].start]>2)fail('Invalid X.509 version.');
  version=bytes[v[0].start]+1;
 }
 const serial=t[i++];
 if(serial?.tag!==2||serial.end===serial.start||serial.end-serial.start>21||bytes[serial.start]&128||serial.end-serial.start>1&&bytes[serial.start]===0&&!(bytes[serial.start+1]&128))fail('Invalid certificate serial.');
 const algorithm=t[i++];
 if(algorithm?.tag!==48)fail('Missing signature algorithm.');
 const signatureAlgorithm=oid(bytes,children(bytes,algorithm)[0]);
 if(signatureAlgorithm!==oid(bytes,children(bytes,parts[1])[0])||!bytes.subarray(algorithm.start,algorithm.end).every((b,index)=>b===bytes[parts[1].start+index])||algorithm.end-algorithm.start!==parts[1].end-parts[1].start)fail('Signature algorithm mismatch.');
 const issuer=name(bytes,t[i++]),validity=t[i++];
 if(validity?.tag!==48)fail('Missing validity.');
 const dates=children(bytes,validity);
 if(dates.length!==2)fail('Invalid validity.');
 const notBefore=time(bytes,dates[0]),notAfter=time(bytes,dates[1]);
 if(Date.parse(notAfter)<Date.parse(notBefore))fail('Reversed validity.');
 const subject=name(bytes,t[i++]),spki=t[i++];
 if(spki?.tag!==48)fail('Missing public key.');
 const key=children(bytes,spki);
 if(key.length!==2||key[0].tag!==48||key[1].tag!==3||key[1].end-key[1].start<2||bytes[key[1].start]!==0)fail('Invalid public key.');
 const publicKeyAlgorithm=oid(bytes,children(bytes,key[0])[0]);
 let lastOptional=0;
 for(const optional of t.slice(i)){
  const order=optional.tag===129?1:optional.tag===130?2:optional.tag===163?3:0;
  if(order<=lastOptional||version<2||order===3&&version!==3)fail('Invalid optional certificate fields.');
  lastOptional=order;
  if(order<3){if(optional.end===optional.start||bytes[optional.start]>7)fail('Invalid unique identifier.');continue;}
  const explicit=children(bytes,optional);
  if(explicit.length!==1||explicit[0].tag!==48)fail('Invalid extension sequence.');
  const extensions=children(bytes,explicit[0]),ids=new Set();
  if(!extensions.length)fail('Empty extension sequence.');
  for(const extension of extensions){
   if(extension.tag!==48)fail('Invalid extension.');
   const fields=children(bytes,extension),id=oid(bytes,fields[0]);
   if(ids.has(id))fail('Duplicate extension OID.');
   ids.add(id);
   if(fields.length===3&&(fields[1].tag!==1||fields[1].end-fields[1].start!==1||bytes[fields[1].start]!==255))fail('Invalid critical extension flag.');
   if(![2,3].includes(fields.length)||fields.at(-1).tag!==4)fail('Invalid extension value.');
  }
 }
 if(parts[2].end-parts[2].start<2||bytes[parts[2].start]!==0)fail('Invalid signature bit string.');
 return {version,serial:Array.from(bytes.subarray(serial.start,serial.end),b=>b.toString(16).padStart(2,'0')).join(''),subject,issuer,notBefore,notAfter,signatureAlgorithm,publicKeyAlgorithm};
}
export async function certificateFingerprint(bytes,cryptoProvider=globalThis.crypto){if(!cryptoProvider?.subtle)fail('SHA-256 unavailable.');return Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(':');}
export function generatePassword(length=20,{alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*',cryptoProvider=globalThis.crypto}={}){if(!Number.isInteger(length)||length<8||length>128||typeof alphabet!=='string'||alphabet.length<2||alphabet.length>128||new Set(alphabet).size!==alphabet.length||!cryptoProvider?.getRandomValues)fail('Use a unique bounded alphabet and secure randomness.');const ceiling=256-256%alphabet.length,buffer=new Uint8Array(128);let result='';while(result.length<length){cryptoProvider.getRandomValues(buffer);for(const b of buffer)if(b<ceiling&&result.length<length)result+=alphabet[b%alphabet.length];}return result;}

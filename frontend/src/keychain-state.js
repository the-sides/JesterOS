import {object,choice,flag} from './command-schema.js';
import {canonicalStringUnits,copyCanonicalData} from './canonical-data.js';
import {previewSchemaValid} from './preview-state.js';
import {FONT_BOOK_PROFILES,fontText as str,fontInt as int,fontIdSchema as id} from './font-book-state.js';
import {certificateDER,parseCertificate} from './keychain-certificates.js';
export const KEYCHAIN_PROFILES=FONT_BOOK_PROFILES;
const arr=(items,maxItems)=>({type:'array',items,maxItems}),nullable=s=>({anyOf:[{type:'null'},s]});
export const keychainCertificateSchema=object({version:int(1,3),serial:str(42,1),subject:str(4096),issuer:str(4096),notBefore:str(24,20),notAfter:str(24,20),signatureAlgorithm:str(256,1),publicKeyAlgorithm:str(256,1)});
export const keychainPasswordDetailsSchema=object({type:choice('password','wifi','passkey'),deletedAt:nullable(int(-8640000000000000,8640000000000000)),groupId:nullable(id),passkey:nullable(object({credentialId:str(128,1),publicJwk:str(2048,1),signCount:int()}))});
export function createPasswordDetails(type='password'){return {type,deletedAt:null,groupId:null,passkey:null};}
export const keychainItemSchema=object({id,keychainId:id,kind:choice('password','secure-note','certificate'),name:str(256,1),account:str(256),service:str(256),secret:str(16384),comment:str(4096),passwordDetails:nullable(keychainPasswordDetailsSchema),access:object({confirm:flag,allowedApps:arr(str(128,1),32)}),certificate:nullable(keychainCertificateSchema),der:nullable(str(400000,1)),fingerprint:str(95),trust:object({ssl:choice('system','always','never'),email:choice('system','always','never'),codeSigning:choice('system','always','never')}),createdAt:int(-8640000000000000,8640000000000000),modifiedAt:int(-8640000000000000,8640000000000000)});
export const keychainWindowSchema=object({windowId:id,keychainId:id,category:choice('all','password','secure-note','identity','key','certificate'),search:str(256),selectedId:nullable(id),revealed:flag,panel:choice('none','inspect','new','edit','unlock','reveal','generator','preferences','new-keychain'),menu:nullable(choice('keychain','file','edit','view','window','help')),generated:str(128),status:str(1024),revision:int()});
export const keychainSchema=object({version:{const:1},profileId:choice(...KEYCHAIN_PROFILES),nextId:int(1),keychains:arr(object({id,name:str(128,1),locked:flag,password:str(256,1)}),32),items:arr(keychainItemSchema,256),sharedGroups:arr(object({id,name:str(128,1),memberUserIds:arr(id,32)}),32),preferences:object({showStatus:flag,lockOnQuit:flag,generatorLength:int(8,128)}),windows:arr(keychainWindowSchema,32)});
export const keychainWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
export function validateKeychainState(state,profile){
 const bad=message=>({ok:false,message});
 if(!previewSchemaValid(state,keychainSchema)||profile&&state.profileId!==(typeof profile==='string'?profile:profile.id)||canonicalStringUnits(state)>1024*1024)return bad('Invalid bounded Keychain graph.');
 const ids=[...state.keychains.map(k=>k.id),...state.items.map(i=>i.id),...state.sharedGroups.map(g=>g.id)];
 if(new Set(ids).size!==ids.length||new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length||new Set(state.keychains.map(k=>k.name)).size!==state.keychains.length)return bad('Duplicate Keychain identity or name.');
 if(!['login','system'].every(id=>state.keychains.some(k=>k.id===id)))return bad('Built-in local keychains are required.');
 if(new Set(state.sharedGroups.map(g=>g.id)).size!==state.sharedGroups.length||state.sharedGroups.some(g=>new Set(g.memberUserIds).size!==g.memberUserIds.length))return bad('Invalid local password group identity.');
 for(const item of state.items){
  if(!state.keychains.some(k=>k.id===item.keychainId)||new Set(item.access.allowedApps).size!==item.access.allowedApps.length)return bad('Invalid Keychain relationship.');
  const details=item.passwordDetails;
  if((item.kind==='password')!==(details!==null)||details?.groupId!==null&&details?.groupId!==undefined&&!state.sharedGroups.some(g=>g.id===details.groupId))return bad('Invalid canonical password metadata relationship.');
  if(details?.type==='passkey'){
   try{const pub=JSON.parse(details.passkey.publicJwk),priv=JSON.parse(item.secret);if(pub.kty!=='EC'||pub.crv!=='P-256'||priv.kty!=='EC'||priv.crv!=='P-256'||pub.x!==priv.x||pub.y!==priv.y||typeof priv.d!=='string'||priv.d.length!==43||Object.hasOwn(pub,'d')||!/^[A-Za-z0-9_-]{43}$/u.test(pub.x)||!/^[A-Za-z0-9_-]{43}$/u.test(pub.y))return bad('Invalid local P-256 passkey material.');}catch{return bad('Invalid local passkey material.');}
  }else if(details?.passkey)return bad('Non-passkey contains key material.');
  if(item.kind==='certificate'){
   try{
    if(!item.der||item.secret||JSON.stringify(parseCertificate(certificateDER(item.der)))!==JSON.stringify(item.certificate)||!/^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/u.test(item.fingerprint))return bad('Invalid parsed certificate.');
   }catch{return bad('Invalid certificate bytes.');}
  }else if(item.der!==null||item.certificate!==null||item.fingerprint!=='')return bad('Non-certificate contains certificate data.');
 }
 if(state.windows.some(w=>!state.keychains.some(k=>k.id===w.keychainId)||w.selectedId!==null&&!state.items.some(i=>i.id===w.selectedId&&i.keychainId===w.keychainId&&(!i.passwordDetails||i.passwordDetails.deletedAt===null))))return bad('Dangling or deleted Keychain selection.');
 return {ok:true};
}
export function createKeychainState(profile,{sceneTime=0}={}){return {version:1,profileId:typeof profile==='string'?profile:profile.id,nextId:2,keychains:[{id:'login',name:'login',locked:false,password:'trail-demo'},{id:'system',name:'System',locked:true,password:'system-demo'}],items:[{id:'keychain-item-1',keychainId:'login',kind:'password',name:'Trail Journal (invented)',account:'alex',service:'journal.invalid',secret:'fictional-trail-password',comment:'Invented scene secret. Never enter real credentials.',passwordDetails:createPasswordDetails(),access:{confirm:true,allowedApps:['textedit']},certificate:null,der:null,fingerprint:'',trust:{ssl:'system',email:'system',codeSigning:'system'},createdAt:Number.isSafeInteger(sceneTime)?sceneTime:0,modifiedAt:Number.isSafeInteger(sceneTime)?sceneTime:0}],sharedGroups:[],preferences:{showStatus:true,lockOnQuit:true,generatorLength:20},windows:[]};}
export function createKeychainWindow(windowId){return {windowId,keychainId:'login',category:'all',search:'',selectedId:'keychain-item-1',revealed:false,panel:'none',menu:null,generated:'',status:'',revision:0};}
export function keychainCapabilities(profile){const id=typeof profile==='string'?profile:profile.id;return {classic:/high-sierra|mojave/u.test(id),windows:id.startsWith('windows11'),golden:id.includes('golden-gate'),availability:`${id.startsWith('windows11')?'Local Keychain — fictional local equivalent, not Windows Credential Manager.':id.includes('golden-gate')?'Keychain Access — nearest macOS Tahoe 26 styling; no native 27 pixel certification. Invented password/note management is a local extension; current macOS directs passwords to the separate Passwords app.':'Keychain Access — native-era local recreation.'} All secrets are invented plaintext scene data; locking controls local access, not encryption. Certificate trust is local metadata, not host trust or chain verification. PEM/DER certificates supported; PKCS#12/private keys unsupported.`};}
export function keychainWindowMetadata(profile){return {appId:'keychain',title:keychainCapabilities(profile).windows?'Local Keychain':'Keychain Access',width:820,height:540,minWidth:650,minHeight:420,utilityKind:'keychain',component:'KeychainApp.svelte'};}
// Persistent invented data is retained; native reveals/sheets never restore.
export function keychainPersistenceProjection(state){const next=copyCanonicalData(state);for(const w of next.windows){w.revealed=false;w.generated='';w.panel='none';w.menu=null;}return next;}

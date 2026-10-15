import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData} from './canonical-data.js';
import {keychainCommandSpecs,keychainTargetSchema} from './keychain-catalog.js';
import {keychainWindow,createKeychainWindow,validateKeychainState,keychainCapabilities,createPasswordDetails} from './keychain-state.js';
import {localController,readActualFile,rejected,applied} from './keychain-controller.js';
import {certificateDER,certificatePEM,parseCertificate,certificateFingerprint,bytesDataURL,generatePassword} from './keychain-certificates.js';
export function createKeychainCommands(state,ctx){const core=localController(state,ctx,{appId:'keychain',validate:validateKeychainState,createWindow:windowId=>{const w=createKeychainWindow(windowId);w.selectedId=state.items.find(i=>i.keychainId==='login'&&(!i.passwordDetails||i.passwordDetails.deletedAt===null))?.id??null;return w;}}),handlers={};
 const unlocked=(c,w)=>{const k=c.keychains.find(k=>k.id===w.keychainId);if(!k||k.locked)throw new Error('Unlock the selected local keychain first.');return k;};
 const newId=(c,prefix)=>{if(c.nextId>=Number.MAX_SAFE_INTEGER-1)throw new Error('Identity capacity exceeded.');let id;do{id=`${prefix}-${c.nextId++}`;}while(c.keychains.some(k=>k.id===id)||c.items.some(i=>i.id===id)||c.sharedGroups.some(g=>g.id===id));return id;};
 const item=(c,w,id)=>{const row=c.items.find(i=>i.id===(id??w.selectedId));if(!row||row.keychainId!==w.keychainId||row.passwordDetails&&row.passwordDetails.deletedAt!==null)throw new Error('Select an actual current item in the current keychain.');return row;};
 async function atomicFile(owner,p){const row=state.items.find(i=>i.id===p.itemId);if(!row||row.kind!=='certificate'||state.keychains.find(k=>k.id===row.keychainId)?.locked)return rejected('disabled','Only unlocked certificates export; passwords/private keys do not.');const bytes=certificateDER(row.der),content=p.format==='pem'?certificatePEM(bytes):bytesDataURL(bytes,'application/pkix-cert'),name=`${row.name.replace(/[^A-Za-z0-9._-]/gu,'_')}.${p.format==='pem'?'pem':'cer'}`,mime=p.format==='pem'?'application/x-pem-file':'application/pkix-cert';const planned=core.plan(owner,(_,w)=>{w.status=`Exported real ${p.format.toUpperCase()} certificate to Files.`;});if(planned.error)return planned.error;if(!ctx.createFile)return rejected('unavailable','Atomic Files writer unavailable.');let ack=false;const result=await ctx.createFile({name,mime,content,text:content,parentId:'documents',reserveTextUnits:planned.delta,onCommit:(id,file,metadata)=>{if(ack||!owner.guard()||!id||file?.id!==id||metadata?.content!==content||metadata?.mime!==mime||ctx.canCommit(planned.delta)!==true)return false;core.publish(planned.candidate);ack=true;return true;}},{windowId:owner.windowId,guard:owner.guard});return ack?applied(owner.windowId):result?.status==='rejected'?result:rejected('stale_target','Certificate export was not atomically committed.');}
 for(const [suffix,[schema]] of Object.entries(keychainCommandSpecs))handlers[`keychain.${suffix}`]=async(target,p={})=>{if(!previewSchemaValid(target,keychainTargetSchema)||!previewSchemaValid(p,schema))return rejected('invalid_arguments','Use the closed Keychain command schema.');let owner=core.lease(target.windowId);if(!owner)return rejected('unavailable','Original Keychain window unavailable.');try{
 if(suffix==='focus'){if(!owner.view?.available?.()||!owner.view.focus)return rejected('unavailable','Original mounted control unavailable.');const done=await owner.view.focus(p.controlId,owner.guard);return owner.guard()&&done?applied(owner.windowId):rejected('stale_target','Native focus lease changed.');}
 if(suffix==='window.close'){if(!ctx.closeWindow)return rejected('unavailable','Native shell close unavailable.');return await ctx.closeWindow(owner.windowId,{windowId:owner.windowId,guard:owner.guard});}
 if(suffix==='export')return await atomicFile(owner,p);
 if(suffix==='import'){
  unlocked(state,owner.session); // Reject before opening a native chooser.
  let fileId=p.fileId;
  if(!fileId){
   if(!ctx.chooseFile)return rejected('unavailable','Native Open unavailable.');
   const choice=await ctx.chooseFile({appId:'keychain',title:'Import Certificate',extensions:['pem','cer','crt','der']},{windowId:owner.windowId,guard:owner.guard});
   if(!owner.guard())return rejected('stale_target','Original import source changed.');
   fileId=choice?.fileId;
   if(!fileId)return choice?.status==='rejected'?choice:rejected('cancelled','No certificate selected.');
  }
  const read=await readActualFile(ctx,owner,fileId);
  if(read.error)return read.error;
  const bytes=certificateDER(read.text),certificate=parseCertificate(bytes);
  const fingerprint=await certificateFingerprint(bytes,ctx.crypto??globalThis.crypto);
  if(!read.guard())return rejected('stale_target','Original certificate changed.');
  return core.commit({...owner,guard:read.guard},(c,w)=>{
   unlocked(c,w);
   if(c.items.some(i=>i.keychainId===w.keychainId&&i.fingerprint===fingerprint))return rejected('duplicate','Certificate already imported into this keychain.');
   const id=newId(c,'keychain-item');
   c.items.push({id,keychainId:w.keychainId,kind:'certificate',name:(certificate.subject||read.file.name).slice(0,256),account:'',service:'',secret:'',comment:'Parsed X.509; signature and chain not verified.',passwordDetails:null,access:{confirm:true,allowedApps:[]},certificate,der:bytesDataURL(bytes,'application/pkix-cert'),fingerprint,trust:{ssl:'system',email:'system',codeSigning:'system'},createdAt:owner.time,modifiedAt:owner.time});
   w.selectedId=id;w.panel='inspect';w.revealed=false;
   return {itemId:id};
  });
 }
 if(suffix==='copy'){const row=item(state,owner.session,p.itemId);unlocked(state,owner.session);if(!owner.session.revealed||row.kind==='certificate'||row.passwordDetails?.type==='passkey'||owner.session.selectedId!==row.id)return rejected('disabled','Only explicitly revealed invented text secrets may be copied; passkey private material is not a password.');if(!ctx.setClipboard)return rejected('unavailable','Actual atomic clipboard unavailable.');const text=row.secret,planned=core.plan(owner,(_,w)=>{w.status='Invented secret copied to scene clipboard.';});if(planned.error)return planned.error;let ack=false;const result=await ctx.setClipboard({text,reserveTextUnits:planned.delta,onCommit:()=>{if(ack||!owner.guard()||ctx.canCommit(planned.delta)!==true)return false;core.publish(planned.candidate);ack=true;return true;}},{windowId:owner.windowId,guard:owner.guard});return ack?applied(owner.windowId):result?.status==='rejected'?result:rejected('stale_target','Clipboard did not commit.');}
 return core.commit(owner,(c,w)=>{
 if(suffix==='navigate'){if(p.keychainId&&!c.keychains.some(k=>k.id===p.keychainId))throw new Error('Missing keychain.');for(const key of ['keychainId','category','search','selectedId'])if(Object.hasOwn(p,key))w[key]=p[key];if(p.keychainId&&c.items.find(i=>i.id===w.selectedId)?.keychainId!==p.keychainId)w.selectedId=null;w.revealed=false;return;}
 if(suffix==='panel'){
  if(p.panel==='edit'){
   unlocked(c,w);
   const row=item(c,w);
   if(row.kind!=='certificate'&&row.passwordDetails?.type!=='passkey'&&row.access.confirm&&!w.revealed)throw new Error('Show the invented secret and confirm local access before editing it.');
  }
  w.panel=p.panel;
  if(p.panel!=='edit')w.revealed=false;
  return;
 }
 if(suffix==='menu'){w.menu=p.menu;return;}
 if(suffix==='preferences'){for(const key of Object.keys(p))c.preferences[key]=p[key];return;}
 if(suffix==='generate'){w.generated=generatePassword(p.length??c.preferences.generatorLength,{cryptoProvider:ctx.crypto??globalThis.crypto});w.panel='generator';return;}
 if(suffix==='keychain'){const k=c.keychains.find(k=>k.id===(p.keychainId??w.keychainId));if(p.operation==='create'){if(!p.name||!p.password)throw new Error('Name and invented password required.');if(c.keychains.some(k=>k.name===p.name))throw new Error('Keychain name already used.');const id=newId(c,'keychain');c.keychains.push({id,name:p.name,locked:false,password:p.password});w.keychainId=id;w.selectedId=null;w.panel='none';return {keychainId:id};}if(!k)throw new Error('Missing keychain.');if(p.operation==='lock'){k.locked=true;for(const s of c.windows)if(s.keychainId===k.id){s.revealed=false;s.generated='';}return;}if(p.operation==='unlock'){if(p.password!==k.password)throw new Error('Incorrect invented keychain password.');k.locked=false;w.panel='none';return;}if(k.locked)throw new Error('Unlock before editing keychain.');if(p.operation==='password'){if(p.password!==k.password||!p.newPassword)throw new Error('Current and new invented passwords required.');k.password=p.newPassword;return;}if(p.operation==='rename'){if(!p.name||c.keychains.some(other=>other!==k&&other.name===p.name))throw new Error('Unique name required.');k.name=p.name;return;}if(p.operation==='delete'){if(['login','system'].includes(k.id))throw new Error('Built-in scene keychains cannot be deleted.');c.items.splice(0,c.items.length,...c.items.filter(i=>i.keychainId!==k.id));c.keychains.splice(c.keychains.indexOf(k),1);for(const s of c.windows)if(s.keychainId===k.id){s.keychainId='login';s.selectedId=null;s.revealed=false;}return;}}
 if(suffix==='item'){
  const chain=unlocked(c,w);
  if(p.operation==='create'){
   if(!p.name||!p.kind)throw new Error('Name and kind required.');
   const id=newId(c,'keychain-item');
   c.items.push({id,keychainId:w.keychainId,kind:p.kind,name:p.name,account:p.account??'',service:p.service??'',secret:p.secret??'',comment:p.comment??'',passwordDetails:p.kind==='password'?createPasswordDetails():null,access:{confirm:true,allowedApps:[]},certificate:null,der:null,fingerprint:'',trust:{ssl:'system',email:'system',codeSigning:'system'},createdAt:owner.time,modifiedAt:owner.time});
   w.selectedId=id;w.panel='inspect';w.revealed=false;return {itemId:id};
  }
  const row=item(c,w,p.itemId);
  if(p.operation==='delete'){
   c.items.splice(c.items.indexOf(row),1);
   for(const s of c.windows)if(s.selectedId===row.id){s.selectedId=null;s.revealed=false;s.panel='none';}
   return;
  }
  if(p.operation==='reveal'){
   if(row.kind==='certificate')throw new Error('Certificate is public data.');
   if(row.passwordDetails?.type==='passkey')throw new Error('Passkey private material is not a text password; use the local Passwords signing workflow.');
   if(row.access.confirm&&p.password!==chain.password)throw new Error('Enter the invented keychain password to confirm local access.');
   w.selectedId=row.id;w.revealed=true;w.panel='inspect';return;
  }
  if(p.operation==='hide'){w.revealed=false;return;}
  if(p.operation==='update'){
   if(row.kind==='certificate'&&Object.hasOwn(p,'secret'))throw new Error('Certificate has no password.');
   if(row.passwordDetails?.type==='passkey'&&Object.hasOwn(p,'secret'))throw new Error('Passkey material can only be generated through the local passkey lifecycle.');
   for(const key of ['name','account','service','secret','comment'])if(Object.hasOwn(p,key))row[key]=p[key];
  }
  if(p.operation==='access'){
   if(Object.hasOwn(p,'confirm'))row.access.confirm=p.confirm;
   if(p.allowedApps)row.access.allowedApps=p.allowedApps;
   for(const session of c.windows)if(session.selectedId===row.id)session.revealed=false;
  }
  if(p.operation==='trust'){
   if(row.kind!=='certificate')throw new Error('Trust applies to certificates only.');
   for(const key of ['ssl','email','codeSigning'])if(Object.hasOwn(p,key))row.trust[key]=p[key];
  }
  row.modifiedAt=owner.time;return;
 }
 });}catch(error){return rejected('invalid_arguments',error.message);}};
 return {handlers,targets(windowId){const o=core.lease(windowId),w=keychainWindow(state,windowId),locked=state.keychains.find(k=>k.id===w?.keychainId)?.locked;return {windowId,available:!!o,session:w?copyCanonicalData(w):null,keychains:state.keychains.map(({password,...k})=>copyCanonicalData(k)),items:state.items.filter(i=>i.keychainId===w?.keychainId&&(!i.passwordDetails||i.passwordDetails.deletedAt===null)).map(i=>{const {secret,der,...row}=i;return {...copyCanonicalData(row),secret:o&&!locked&&w?.revealed&&w.selectedId===i.id&&i.passwordDetails?.type!=='passkey'?secret:null};}),capabilities:keychainCapabilities(ctx.profile),native:o?.view?.describe?.()??null};},windowOpened:core.windowOpened,windowClosed:core.windowClosed,appQuit:core.appQuit,dispose:core.dispose};}

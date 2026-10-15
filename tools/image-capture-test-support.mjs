import {createRequire} from 'node:module';
import {canonicalStringUnits,copyCanonicalData,applyCanonicalData} from '../frontend/src/canonical-data.js';
import {createFilesystemTransactions} from '../frontend/src/filesystem-transactions.js';
import {captureGraphLease} from '../frontend/src/image-capture-ownership.js';
import {createImageCaptureState} from '../frontend/src/image-capture-state.js';
import {createImageCaptureCommands} from '../frontend/src/image-capture-commands.js';
import {createBluetoothExchangeState} from '../frontend/src/bluetooth-exchange-state.js';
import {createBluetoothExchangeCommands} from '../frontend/src/bluetooth-exchange-commands.js';
import {bluetoothDefaults,validateBluetoothState} from '../frontend/src/bluetooth-model.js';
import {soundDefaults} from '../frontend/src/sound-model.js';
import {PREVIEW_IMAGE_CONTENT} from '../frontend/src/preview-image-fixture.js';
const require=createRequire(new URL('../frontend/package.json',import.meta.url)),pdfRequire=createRequire(require.resolve('pdfjs-dist/package.json'));
export const {createCanvas,loadImage}=pdfRequire('@napi-rs/canvas');
export const rasterEngine=()=>({decode:bytes=>loadImage(Buffer.from(bytes)),createCanvas,encodeBlob:async(canvas,mime)=>new Blob([canvas.toBuffer(mime,92)],{type:mime})});
export const rasterBytes=content=>Buffer.from(content.slice(content.indexOf(',')+1),'base64');
export async function rasterPixels(content){const image=await loadImage(rasterBytes(content)),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return {width:image.width,height:image.height,data:canvas.getContext('2d').getImageData(0,0,image.width,image.height).data};}
export function utilityFixture(profileId='macos-mojave-10.14'){
 const profile={id:profileId,family:profileId.startsWith('windows11')?'windows':'macos'},capture=createImageCaptureState(profile,{sceneTime:1000000}),exchange=createBluetoothExchangeState(profile,{sceneTime:1000000}),bluetooth=bluetoothDefaults(),sound=soundDefaults(),windows=new Map(),views=new Map();
 const folder=(id,parentId,name)=>({id,parentId,name,kind:'folder',content:'',deleted:false,revision:1});
 const store={files:[folder('disk',null,profile.family==='windows'?'C:':'Macintosh HD'),folder('documents','disk','Documents'),folder('desktop','disk','Desktop'),folder('downloads','disk','Downloads'),{id:'source-image',parentId:'documents',name:'Original.png',kind:'image',content:PREVIEW_IMAGE_CONTENT,mime:'image/png',encoding:'base64',deleted:false,revision:7},{id:'source-text',parentId:'documents',name:'Letter.txt',kind:'document',content:'A real locally authored letter.\n',mime:'text/plain',deleted:false,revision:2}],nextFileId:10,sceneTime:1000000};
 let currentStore=store,time=1000000,limit=Infinity,pendingUnits=0,alive=true;
 const units=()=>canonicalStringUnits({store:currentStore,capture,exchange,bluetooth,sound});
 const common={profile,alive:()=>alive,getSceneTime:()=>time,canCommit:delta=>units()+pendingUnits+delta<=limit,getWindow:id=>windows.get(id),getView:id=>views.get(id),available:window=>windows.get(window.id)===window,tick:async()=>{},getFilesStore:()=>currentStore,getShared:name=>name==='bluetooth'?bluetooth:name==='sound'?sound:undefined,imageCaptureEngine:rasterEngine()};
 const files=createFilesystemTransactions({...common,getStore:()=>currentStore,reserve:(delta,commit)=>{pendingUnits+=delta;try{return commit();}finally{pendingUnits-=delta;}},makeRecord:row=>row});
 common.getFile=files.getFile;common.mutateFiles=files.mutateFiles;common.readFile=async(id,ownership)=>{const file=files.getFile(id);return ownership.guard()&&file?{status:'applied',file,text:file.content,mime:file.mime,name:file.name}:{status:'rejected',error:{code:'stale_target',message:'Original file is unavailable.'}};};
 common.mutateShared=async(name,mutate,ownership)=>{if(name!=='bluetooth'||ownership.guard()!==true)return {status:'rejected',error:{code:'stale_target'}};const original=captureGraphLease(()=>bluetooth),soundLease=captureGraphLease(()=>sound),candidate=copyCanonicalData(bluetooth),at=time;if(mutate(candidate)!==true||!validateBluetoothState(candidate,sound).ok)return {status:'rejected',error:{code:'invalid_state'}};const delta=canonicalStringUnits(candidate)-canonicalStringUnits(bluetooth);if(!common.canCommit(delta+(ownership.reserveTextUnits??0))||!ownership.guard()||!original()||!soundLease()||time!==at)return {status:'rejected',error:{code:'limit_exceeded'}};pendingUnits+=delta;let accepted;try{accepted=ownership.onCommit()===true;}finally{pendingUnits-=delta;}if(!accepted)return {status:'rejected',error:{code:'stale_target'}};applyCanonicalData(bluetooth,candidate);return {status:'applied'};};
 const captureCtx={...common,getState:()=>capture},exchangeCtx={...common,getState:()=>exchange},captureController=createImageCaptureCommands(capture,captureCtx),exchangeController=createBluetoothExchangeCommands(exchange,exchangeCtx);
 const camera={id:'capture-window',appId:'imagecapture'},radio={id:'exchange-window',appId:'bluetoothfileexchange'};windows.set(camera.id,camera);windows.set(radio.id,radio);captureController.windowOpened(camera);exchangeController.windowOpened(radio);
 return {profile,capture,exchange,bluetooth,sound,store,files,windows,views,captureCtx,exchangeCtx,captureController,exchangeController,camera,radio,units,cap:(suffix,payload={})=>captureController.handlers[`imagecapture.${suffix}`]({windowId:camera.id},payload),bt:(suffix,payload={})=>exchangeController.handlers[`bluetoothfileexchange.${suffix}`]({windowId:radio.id},payload),setLimit:value=>{limit=value;},setTime:value=>{time=value;},replaceStore:value=>{currentStore=value;},setAlive:value=>{alive=value;}};
}

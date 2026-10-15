import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { MEDIA_PROFILES, mediaIdSchema as id, mediaPreferencesSchema } from './media-state.js';
const text=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength}),num=(minimum,maximum)=>({type:'number',minimum,maximum}),int=(minimum,maximum)=>({type:'integer',minimum,maximum}),arr=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
export const mediaWindowTarget=object({windowId:id});
export const mediaCommandPayloads={
 'media.open':object({fileId:id},[]),'media.select':object({assetId:id}),
 'media.play':empty,'media.pause':empty,'media.observe':object({position:num(0,3600),volume:num(0,1),rate:num(.25,3),playing:flag,ended:flag},['position','volume','rate','playing']),
 'media.seek':object({position:num(0,3600)}),'media.volume':object({volume:num(0,1)}),'media.rate':object({rate:num(.25,3)}),'media.loop':object({enabled:flag}),
 'media.selection':object({start:num(0,3600),end:num(0,3600)}),'media.trim':object({start:num(0,3600),end:num(.001,3600)}),
 'media.split':object({position:num(.001,3600)}),'media.reorder':object({from:int(0,63),to:int(0,63)}),
 'media.transform':object({index:int(0,63),rotation:choice(0,90,180,270),flipH:flag,flipV:flag},['index']),
 'media.replace':object({assetId:id,start:num(0,3600),end:num(.001,3600)}),
 'media.save':object({name:text(256,1)},[]),'media.export':object({name:text(256,1),quality:choice('low','high','maximum')},['name']),
 'media.recordStart':object({kind:choice('audio','movie','screen'),source:choice('harbor','studio','desktop'),quality:choice('low','high','maximum')},['kind']),
 'media.recordStop':object({duration:num(.1,60),name:text(256,1)},[]),
 'media.search':object({query:text(4096)}),'media.section':object({section:choice('songs','albums','artists','music','movie','tv','podcast','audiobook','recording','playlists','store','forYou','browse','radio','history','device','deleted'),playlistId:id},['section']),
 'media.queue':object({operation:choice('add','remove','move','clear','next','previous'),assetId:id,index:int(0,255),to:int(0,255)},['operation']),
 'media.shuffle':object({enabled:flag}),'media.repeat':object({mode:choice('off','one','all')}),
 'media.playlist':object({operation:choice('create','rename','delete','add','remove'),playlistId:id,name:text(256,1),assetId:id,smart:flag,match:choice('all','any'),rules:arr(object({field:choice('artist','album','title','kind','rating','favorite','playCount'),operator:choice('contains','is','greaterThan'),value:text(256)}),16)},['operation']),
 'media.info':object({title:text(256,1),artist:text(),album:text(),artwork:text(65536),kind:choice('music','movie','tv','podcast','audiobook','recording')},[]),
 'media.import':object({fileId:id},[]),'media.rating':object({rating:int(0,5)}),'media.favorite':object({enabled:flag}),
 'media.equalizer':object({enabled:flag,gains:arr(num(-24,24),10,10)}),'media.visualizer':object({enabled:flag}),
 'media.preferences':object({values:mediaPreferencesSchema}),
 'media.download':object({catalogId:id}),'media.sync':object({deviceId:id,assetIds:arr(id,128)}),
 'media.library':object({libraryId:id}),'media.account':object({signedIn:flag,name:text(256,1)},['signedIn']),
 'media.rename':object({title:text(256,1)}),'media.delete':empty,'media.recover':object({versionId:id,assetId:id},[]),'media.share':empty,
 'media.panel':object({panel:choice('none','inspector','preferences','info','equalizer','store','device','visualizer','export','record','close','help')}),
 'media.mini':object({enabled:flag}),'media.fullWindow':object({enabled:flag}),
 'media.closeDecision':object({decision:choice('save','discard','cancel')},[]),
 'media.focus':object({controlId:text(256,1)}),'media.scroll':object({top:num(0,Number.MAX_SAFE_INTEGER),left:num(0,Number.MAX_SAFE_INTEGER)})
};
export const mediaCatalog=Object.fromEntries(Object.entries(mediaCommandPayloads).map(([name,payload])=>defineCommand(MEDIA_PROFILES,name,'media.local',mediaWindowTarget,payload,['Original canonical media/session/native view/File identities and actual authored offline media bytes.','HTMLMedia/AudioContext playback; recordings use fictional bundled inputs or original simulated desktop renderer only. No host devices, network, purchases or remote sync.','Absent native functions are explicitly local extensions; Golden Gate uses a qualified macOS26 proxy.'],[`${name.slice(6)} on genuine local media; guarded complete-scene transaction and observed native playback.`],['media'],[],mediaWindowTarget)));

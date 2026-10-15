import {createAutomatorCommands} from './automator-commands.js';
import {shortcutsAvailability,shortcutsSession,validateShortcutsState} from './shortcuts-state.js';
import {automatorSchemaValid} from './automator-state.js';
import {shortcutsCommandPayloads,shortcutsTargetSchema} from './shortcuts-catalog.js';

// One bounded execution implementation, separate canonical document ownership.
export function createShortcutsCommands(state,ctx){
 const controller=createAutomatorCommands(state,ctx,{appId:'shortcuts',commandPrefix:'shortcuts',availability:shortcutsAvailability});
 let disposed=false;
 const reject=(code,message)=>({status:'rejected',error:{code,message}});
 function references(node,path=[],out=[]){if(node&&typeof node==='object'){out.push([path,node]);for(const key of Object.keys(node))references(node[key],[...path,key],out);}return out;}
 for(const command of ['shortcuts.collection','shortcuts.input'])controller.handlers[command]=(target,payload={})=>{
  if(!automatorSchemaValid(target,shortcutsTargetSchema)||!automatorSchemaValid(payload,shortcutsCommandPayloads[command]))return reject('invalid_arguments','Use the bounded native Shortcuts view command.');
  const id=target.windowId,window=ctx.getWindow(id),session=shortcutsSession(state,id),view=ctx.getView(id);
  if(disposed||ctx.alive()!==true||ctx.getState()!==state||!validateShortcutsState(state,ctx.profile).ok||!window||window.appId!=='shortcuts'||!session||!view||view.available()!==true||ctx.available(window)!==true)return reject('unavailable','The original native Shortcuts view is unavailable.');
  const time=ctx.getSceneTime(),signature=JSON.stringify(state),windowSignature=JSON.stringify(window),refs=references(state),windowRefs=references(window);
  const files=command==='shortcuts.input'?payload.fileIds.map(id=>ctx.getFile(id)):[];
  if(files.some(f=>!f||f.deleted||f.kind==='application'))return reject('not_found','Select actual live Files for Run input.');
  const filePins=files.map(f=>[f,JSON.stringify(f),references(f)]);
  const guard=()=>!disposed&&ctx.alive()===true&&ctx.getState()===state&&ctx.getSceneTime()===time&&ctx.getWindow(id)===window&&JSON.stringify(window)===windowSignature&&windowRefs.every(([path,ref])=>path.reduce((n,key)=>n?.[key],window)===ref)&&shortcutsSession(state,id)===session&&ctx.getView(id)===view&&view.available()===true&&ctx.available(window)===true&&JSON.stringify(state)===signature&&refs.every(([path,ref])=>path.reduce((n,key)=>n?.[key],state)===ref)&&filePins.every(([file,pin,fileRefs])=>ctx.getFile(file.id)===file&&JSON.stringify(file)===pin&&fileRefs.every(([path,ref])=>path.reduce((n,key)=>n?.[key],file)===ref));
  if(command==='shortcuts.input'&&session.status==='running')return reject('busy','Stop the shortcut before changing input.');
  const ok=command==='shortcuts.collection'?view.setCollection?.(payload.collection,guard):view.setInput?.(payload.fileIds,guard);
  return ok===true&&guard()?{status:'applied',target:{windowId:id}}:reject('stale_target','The original native view did not acknowledge this transition.');
 };
 const dispose=controller.dispose;controller.dispose=()=>{disposed=true;dispose();};
 return controller;
}

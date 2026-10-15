import {colorSyncWindow} from './colorsync-state.js';
export function createColorGraphNativeView({getRoot,getState,getProfile,windowId,available,tick,session,attribute}){
 const root=getRoot(),state=getState(),profile=getProfile(),windows=state.windows,row=session(state,windowId);let destroyed=false;
 const current=()=>!destroyed&&!!row&&getRoot()===root&&root?.isConnected===true&&getState()===state&&state.windows===windows&&getProfile()===profile&&session(state,windowId)===row;
 const ready=()=>current()&&available()===true;
 const controls=()=>[...root.querySelectorAll(`[${attribute}]`)].filter(node=>{if(node.disabled||node.hidden||node.closest('[inert]'))return false;const closed=node.closest('details:not([open])');if(closed&&node.tagName!=='SUMMARY')return false;const style=node.ownerDocument.defaultView?.getComputedStyle?.(node);return style?.display!=='none'&&style?.visibility!=='hidden';});
 async function focus(controlId,guard){if(!ready()||guard()!==true)return false;const node=controls().find(n=>n.getAttribute(attribute)===controlId);if(!node)return false;node.focus();await tick();return ready()&&guard()===true&&controls().includes(node)&&node.ownerDocument.activeElement===node;}
 function describe(){return ready()?{windowId,available:true,controls:controls().map(node=>({id:node.getAttribute(attribute),label:node.getAttribute('aria-label')??node.textContent?.trim()??'',kind:node.tagName.toLowerCase()}))}:{windowId,available:false,controls:[]};}
 return {available:ready,describe,focus,destroy(){destroyed=true;}};
}
export function createColorSyncNativeView(options){return createColorGraphNativeView({...options,session:colorSyncWindow,attribute:'data-colorsync-control'});}

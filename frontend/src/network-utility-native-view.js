import {networkUtilityWindow} from './network-utility-state.js';
export function createNetworkNativeView({getRoot,getState,windowId,findWindow,available,tick,prefix}){
 const root=getRoot(),state=getState(),windows=state.windows,session=findWindow(state,windowId);let destroyed=false;
 const ready=()=>!destroyed&&root?.isConnected===true&&getRoot()===root&&getState()===state&&state.windows===windows&&findWindow(state,windowId)===session&&available()===true;
 function controls(){
  if(!ready())return [];const scope=root.querySelector('[role="dialog"][aria-modal="true"]')??root;
  return [...scope.querySelectorAll(`[data-${prefix}-control]`)].filter(node=>{
   if(node.disabled||node.hidden||node.closest('[inert]'))return false;
   const collapsed=node.closest('details:not([open])');if(collapsed&&node.tagName!=='SUMMARY')return false;
   for(let ancestor=node;ancestor&&ancestor!==root.parentElement;ancestor=ancestor.parentElement){const style=node.ownerDocument.defaultView?.getComputedStyle?.(ancestor);if(style?.display==='none'||style?.visibility==='hidden')return false;}
   return true;
  });
 }
 function describe(){return {windowId,available:ready(),controls:controls().map(node=>({id:node.getAttribute(`data-${prefix}-control`),label:node.getAttribute('aria-label')??node.textContent?.trim()??'',kind:node.tagName.toLowerCase(),value:'value' in node?String(node.value):null})),results:ready()?root.querySelector(`[data-${prefix}-results]`)?.textContent??'':null};}
 async function focus(id,guard){if(!ready()||guard()!==true)return false;const node=controls().find(n=>n.getAttribute(`data-${prefix}-control`)===id);if(!node)return false;node.focus();await tick();return ready()&&guard()===true&&controls().includes(node)&&node.ownerDocument.activeElement===node;}
 return {available:ready,describe,focus,destroy(){destroyed=true;}};
}
export function createNetworkUtilityNativeView(options){return createNetworkNativeView({...options,findWindow:networkUtilityWindow,prefix:'networkutility'});}

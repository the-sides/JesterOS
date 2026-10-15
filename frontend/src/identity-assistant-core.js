import {canonicalStringUnits,copyCanonicalData} from './canonical-data.js';
import {localController,identityLease,rejected,applied} from './keychain-controller.js';
export {rejected,applied};
// Window state is transient; the shared graph remains Root's original authority.
export function createIdentityCore(state,ctx,options){
 const core=localController(state,ctx,options);
 function lease(windowId,names=[]){const owner=core.lease(windowId);if(!owner)return null;const sources={};const checks=[];for(const name of names){const source=ctx.getShared?.(name);if(!source)return null;sources[name]=source;const same=identityLease(source);checks.push(()=>ctx.getShared(name)===source&&same());}const base=owner.guard;return {...owner,sources,guard:()=>base()&&checks.every(check=>check())};}
 async function paired(owner,name,mutate,actor=()=>{}){
  if(!owner.guard()||!ctx.mutateShared)return rejected('unavailable','Original shared mutation endpoint unavailable.');
  const plan=core.plan(owner,actor);if(plan.error)return plan.error;
  let acknowledged=false;const result=await ctx.mutateShared(name,mutate,{windowId:owner.windowId,guard:owner.guard,reserveTextUnits:plan.delta,onCommit:()=>{if(acknowledged||!owner.guard()||canonicalStringUnits(plan.candidate)-canonicalStringUnits(state)!==plan.delta||ctx.canCommit(plan.delta)!==true||!owner.guard())return false;core.publish(plan.candidate);acknowledged=true;return true;}});
  return acknowledged&&result?.status==='applied'?applied(owner.windowId,plan.extra):result?.status==='rejected'?result:rejected('unavailable','Original shared operation was not acknowledged.');
 }
 async function file(owner,spec,actor){
  if(!ctx.createFile||!ctx.planFile)return rejected('unavailable','Original prospective Files writer unavailable.');
  const plan=core.plan(owner,actor);if(plan.error)return plan.error;
  const filePlan=ctx.planFile(spec,{windowId:owner.windowId,guard:owner.guard});
  if(!owner.guard())return rejected('stale_target','Original File source changed.');
  if(filePlan?.status!=='applied'||typeof filePlan.current!=='function'||filePlan.current()!==true)return filePlan?.status==='rejected'?filePlan:rejected('unavailable','Private original Files planning failed.');
  const metadata=filePlan.metadata;
  if(!metadata||!Object.isFrozen(metadata)||metadata.id!==filePlan.fileId||metadata.name!==spec.name||metadata.mime!==spec.mime||metadata.content!==spec.content||!Number.isSafeInteger(metadata.revision))return rejected('invalid_state','Original immutable File plan does not match export bytes.');
  const guard=()=>owner.guard()&&filePlan.current()===true;let ack=false,actualId=null;
  const result=await ctx.createFile({...spec,plan:filePlan,reserveTextUnits:plan.delta,onCommit:(id,actual,planned)=>{
   if(ack||!guard()||id!==filePlan.fileId||!actual||actual.id!==id||planned!==metadata||planned.name!==spec.name||planned.mime!==spec.mime||planned.content!==spec.content||canonicalStringUnits(plan.candidate)-canonicalStringUnits(state)!==plan.delta||ctx.canCommit(plan.delta)!==true||!guard())return false;
   core.publish(plan.candidate);actualId=id;ack=true;return true;
  }},{windowId:owner.windowId,guard});
  return ack&&result?.status==='applied'?applied(owner.windowId,{fileId:actualId}):result?.status==='rejected'?result:rejected('unavailable','Files publication was not acknowledged.');
 }
 async function clipboard(owner,text,actor){if(!ctx.setClipboard)return rejected('unavailable','Scene clipboard unavailable.');const plan=core.plan(owner,actor);if(plan.error)return plan.error;let ack=false;const result=await ctx.setClipboard({text,reserveTextUnits:plan.delta,onCommit:()=>{if(ack||!owner.guard()||canonicalStringUnits(plan.candidate)-canonicalStringUnits(state)!==plan.delta||ctx.canCommit(plan.delta)!==true||!owner.guard())return false;core.publish(plan.candidate);ack=true;return true;}},{windowId:owner.windowId,guard:owner.guard});return ack&&result?.status==='applied'?applied(owner.windowId):result?.status==='rejected'?result:rejected('unavailable','Clipboard publication was not acknowledged.');}
 return {...core,lease,paired,file,clipboard};
}
export const identityTextUnits=canonicalStringUnits;
export const identityCopy=copyCanonicalData;
export function createIdentityView({root,getRoot,getSession,available}){
 let retired=false;const original=getSession();
 const current=()=>!retired&&root?.isConnected===true&&getRoot()===root&&getSession()===original&&available()===true;
 function visible(node){
  if(!current()||node.disabled||node.hidden||node.closest?.('[hidden],[inert]'))return false;
  const dialog=root.querySelector('[aria-modal="true"]');if(dialog&&!dialog.contains(node))return false;
  for(let parent=node;parent;parent=parent.parentElement){const style=parent.ownerDocument?.defaultView?.getComputedStyle(parent);if(parent.hidden||parent.inert||style?.display==='none'||style?.visibility==='hidden'||style?.opacity==='0')return false;if(parent===root)break;}
  return typeof node.getClientRects!=='function'||[...node.getClientRects()].some(rect=>rect.width>0&&rect.height>0);
 }
 const nodes=()=>current()?[...root.querySelectorAll('[data-identity-control]')].filter(visible):[];
 return {available:current,describe:()=>current()?{controls:nodes().map(n=>({id:n.dataset.identityControl,role:n.tagName.toLowerCase(),label:n.getAttribute('aria-label')??n.textContent?.trim().slice(0,128)}))}:null,focus(id,guard){if(!current()||guard()!==true)return false;const node=nodes().find(n=>n.dataset.identityControl===id);if(!node)return false;node.focus();return current()&&guard()===true&&visible(node)&&root.ownerDocument.activeElement===node;},dispose(){retired=true;}};
}

import { automatorSession } from '../frontend/src/automator-state.js';
import { parseAutomatorWorkflow, AUTOMATOR_MIME } from '../frontend/src/automator-engine.js';
import { inspectPreviewImage, previewImageGeometry, decodePreviewData } from '../frontend/src/preview-codec.js';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
// Integrated browser only: actual mounted facade, actual original Root Files and codecs.
export async function runAutomatorNativeBrowserRegression({root,facade,controller,state,windowId,getFile,imageFileId,flush}) {
 assert(root?.isConnected&&facade?.available?.()===true,'Original mounted Automator facade required.');
 assert(typeof flush==='function'&&typeof getFile==='function','Root flush and actual File getter required.');
 const session=automatorSession(state,windowId),sessions=state.sessions,actions=session?.actions,source=getFile(imageFileId);
 assert(session&&source&&!source.deleted&&source.mime?.startsWith('image/'),'Actual shared raster-image source required.');
 const geometry=previewImageGeometry(source.content),sourceBytes=source.content;
 const run=async(name,payload={})=>{const result=await controller.handlers['automator.'+name]({windowId},payload);assert(result?.status==='applied',name+': '+JSON.stringify(result));await flush();return result;};
 for(const action of [...session.actions])await run('deleteAction',{actionId:action.id});
 const search=root.querySelector('[data-control="search"]');assert(search,'Actual Library search input required.');search.value='Scale';search.dispatchEvent(new Event('input',{bubbles:true}));await flush();
 assert(root.querySelector('.auto-action-list')?.textContent.includes('Scale and Rotate Images'),'Native Library must display matching real image action.');
 assert(!root.querySelector('.auto-action-list')?.textContent.includes('Rename Finder Items'),'Search must exclude nonmatching library actions.');
 await run('addFiles',{fileIds:[source.id]});const added=await run('addAction',{kind:'scale-images'}),imageAction=session.actions.find(a=>a.id===added.actionId);
 await run('editAction',{action:{...imageAction,params:{...imageAction.params,width:37,rotation:90,format:'png',suffix:' workflow pixels'}}});
 await run('addAction',{kind:'view-results'});
 const result=await run('run'),output=getFile(result.fileIds[0]);
 assert(output&&output!==source&&output.mime==='image/png','Workflow must create an actual original PNG result, not a fake extension.');
 const decoded=decodePreviewData(output.content),inspected=await inspectPreviewImage(output.content);
 assert(decoded.mime==='image/png'&&decoded.bytes[0]===137&&decoded.bytes[1]===80,'Output must have genuine PNG signature bytes.');
 assert(inspected.height===37&&inspected.width===Math.max(1,Math.round(geometry.height*37/geometry.width)),'Actual decoded pixels must resize and rotate in the supported order.');
 assert(source.content===sourceBytes&&getFile(source.id)===source,'Image conversion must preserve actual source record and original bytes.');
 assert(session.results[0].fileId===output.id&&root.querySelector('.auto-output')?.textContent.includes(output.name),'Native Results must display actual destination metadata.');
 assert(session.log.some(l=>l.actionId===imageAction.id&&l.message.includes('completed')),'Real image action must publish completed result/log together.');
 const saved=await run('save',{name:'Raster Workflow Browser',saveAs:true}),workflow=getFile(saved.fileId);
 assert(workflow?.mime===AUTOMATOR_MIME&&parseAutomatorWorkflow(workflow.content).actions[1].params.width===37,'Native workflow save must serialize actual editable parameters.');
 const pending=controller.handlers['automator.run']({windowId},{});
 assert(session.status==='running','Rerun must own a real cancellable running session.');
 await run('stop');const stopped=await pending;
 assert(stopped.status==='rejected'&&session.status==='stopped','Native Stop must retire pending image decoder ownership.');
 assert(getFile(output.id)===output&&source.content===sourceBytes,'Stopping must preserve earlier actual outputs and never mutate source bytes.');
 assert(automatorSession(state,windowId)===session&&state.sessions===sessions&&session.actions===actions,'Native edits, codec awaits and paired Files commits must retain original canonical references.');
 return {status:'applied',windowId,profileId:state.profileId,imageFileId:output.id,workflowFileId:workflow.id,behaviors:['library-search','actual-files-input','real-raster-resize-rotate-encode','paired-results-log','genuine-local-workflow-save','native-stop-original-guards']};
}

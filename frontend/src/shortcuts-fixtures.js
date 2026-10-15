import {serializeAutomatorWorkflow,AUTOMATOR_MIME} from './automator-engine.js';

// Run input supplies actual original Files; these examples contain no invented IDs.
export const shortcutsExampleFiles=Object.freeze([
 {id:'shortcuts-review-example',parentId:'documents',name:'Prepare Review Copy.jworkflow',mime:AUTOMATOR_MIME,content:serializeAutomatorWorkflow({type:'workflow',variables:[],actions:[
  {id:'review-copy',kind:'copy-files',enabled:true,params:{parentId:'documents',suffix:' review'}},
  {id:'review-results',kind:'view-results',enabled:true,params:{}}
 ]})},
 {id:'shortcuts-text-example',parentId:'documents',name:'Make Plain Text Copy.jworkflow',mime:AUTOMATOR_MIME,content:serializeAutomatorWorkflow({type:'workflow',variables:[],actions:[
  {id:'text-convert',kind:'convert-documents',enabled:true,params:{format:'txt',append:'',parentId:'documents',suffix:' plain'}},
  {id:'text-results',kind:'view-results',enabled:true,params:{}}
 ]})}
]);

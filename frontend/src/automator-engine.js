import { copyCanonicalData } from './canonical-data.js';
import { automatorSchemaValid, automatorDocumentSchema, validateAutomatorDocument } from './automator-state.js';
import { editPreviewImage } from './preview-codec.js';
import { decodeTextEditFile, encodeTextEditFile } from './textedit-codec.js';
import { createTextEditContent, textEditPlainText } from './textedit-content.js';
export const AUTOMATOR_MIME = 'application/x-jesteros-workflow+json';
export const AUTOMATOR_EXTENSION = '.jworkflow';
export const automatorLibrary = Object.freeze([
 {kind:'get-files',name:'Get Specified Finder Items',category:'Files & Folders',description:'Pass actual selected Files to the next action.',defaults:{fileIds:[]}},
 {kind:'rename-files',name:'Rename Finder Items',category:'Files & Folders',description:'Add text, replace text, or make names sequential. Changes commit together.',defaults:{mode:'prefix',text:'Renamed-',find:'',start:1}},
 {kind:'copy-files',name:'Copy Finder Items',category:'Files & Folders',description:'Copy real file contents and folder subtrees to a destination.',defaults:{parentId:'documents',suffix:' copy'}},
 {kind:'scale-images',name:'Scale and Rotate Images',category:'Photos',description:'Decode and resample real raster pixels, then encode PNG, JPEG or WebP.',defaults:{width:640,rotation:0,format:'png',parentId:'documents',suffix:' scaled'}},
 {kind:'convert-documents',name:'Convert Text Documents',category:'Text',description:'Decode plain text or RTF, append text, and write genuine TXT or RTF.',defaults:{format:'rtf',append:'',parentId:'documents',suffix:' converted'}},
 {kind:'set-variable',name:'Set Value of Variable',category:'Utilities',description:'Store current file input for later steps in this run.',defaults:{name:'Files'}},
 {kind:'get-variable',name:'Get Value of Variable',category:'Utilities',description:'Restore file input stored during this run.',defaults:{name:'Files'}},
 {kind:'view-results',name:'View Results',category:'Utilities',description:'Show names and MIME metadata of actual workflow output.',defaults:{}},
 {kind:'open-app',name:'Launch Application',category:'Utilities',description:'Invoke the registered simulated app.open command between atomic Files segments.',defaults:{appId:'finder'}},
 {kind:'quit-app',name:'Quit Application',category:'Utilities',description:'Invoke registered app.quit, retaining native unsaved-document confirmation.',defaults:{appId:'finder'}}
]);
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
export function automatorDocument(session){return {format:'jesteros-workflow',version:1,type:session.type,actions:copyCanonicalData(session.actions),variables:copyCanonicalData(session.variables)};}
export function serializeAutomatorWorkflow(session){const doc=automatorDocument(session),valid=validateAutomatorDocument(doc);if(!valid.ok)fail('invalid_format',valid.message);const text=JSON.stringify(doc,null,2)+'\n';if(text.length>256*1024)fail('limit_exceeded','Serialized workflow exceeds 256 Ki units.');return text;}
export function parseAutomatorWorkflow(text){if(typeof text!=='string'||text.length>256*1024)fail('limit_exceeded','Workflow text exceeds 256 Ki units.');let doc;try{doc=JSON.parse(text);}catch{fail('invalid_format','Expected a JSON .jworkflow document.');}if(!automatorSchemaValid(doc,automatorDocumentSchema))fail('invalid_format','Unknown workflow format, version, action or parameter.');const valid=validateAutomatorDocument(doc);if(!valid.ok)fail('invalid_format',valid.message);return doc;}
export function expandAutomatorText(text,variables){return text.replace(/\$\{([^}]+)\}/gu,(_,name)=>{const v=variables.find(v=>v.name===name);if(!v)fail('missing_variable',`Variable “${name}” is not defined.`);return v.value;});}
const splitName=name=>{const i=name.lastIndexOf('.');return i>0?[name.slice(0,i),name.slice(i)]:[name,''];};
export function automatorRenamedName(name,params,index,variables=[]){const text=expandAutomatorText(params.text,variables),find=expandAutomatorText(params.find,variables);if(params.mode==='replace'&&!find)fail('invalid_arguments','Replace Text requires nonempty Find text.');const [base,extension]=splitName(name);const result=params.mode==='prefix'?text+name:params.mode==='replace'?name.split(find).join(text):text+String(params.start+index).padStart(3,'0')+extension;if(!result||result.length>256||/[\x00-\x1f/\\]/u.test(result)||result==='.'||result==='..')fail('invalid_name','Resulting file name is invalid.');return result;}
/** Contents and shadow rows live only for the run, never in retained canonical state. */
export async function planAutomatorFiles(session,{getFile,readFile,guard,inputIds=[],runtimeVariables=new Map()}) {
 const operations=[],logs=[],variables=runtimeVariables,shadow=new Map();let input=[];let serial=0;
 const current=()=>{if(guard()!==true)fail('stale_target','Original workflow, Files, window, view or authored time changed.');};
 const load=id=>{current();if(shadow.has(id))return shadow.get(id);const original=getFile(id);if(!original||original.deleted||original.kind==='application')fail('not_found',`File ${id} is unavailable.`);const row={id:original.id,name:original.name,mime:original.mime??'',parentId:original.parentId,kind:original.kind,revision:original.revision,original,content:null};shadow.set(id,row);return row;};
 const sourceText=async row=>{current();if(row.content!==null)return row.content;const r=await readFile(row.original.id);current();if(r?.status!=='applied'||r.file!==row.original||typeof r.text!=='string')fail(r?.error?.code??'unavailable',r?.error?.message??'Actual original source bytes are unavailable.');row.content=r.text;row.mime=r.mime??row.mime;return row.content;};
 input=inputIds.map(load);
 const destination=id=>{const d=getFile(id);if(!d||d.deleted||d.kind!=='folder')fail('invalid_destination','Choose an actual live destination folder.');return d;};
 const reference=row=>row.id;
 const expected=row=>({expectedRevision:row.revision});
 const newRow=(row,op,name,mime,content)=>{const ref=`auto-${++serial}`;op.ref=ref;operations.push(op);const next={...row,id:'$'+ref,name,mime,content,revision:1};shadow.set(next.id,next);return next;};
 for(const action of session.actions){current();if(!action.enabled)continue;const p=action.params;
  if(action.kind==='get-files')input=p.fileIds.map(load);
  else if(action.kind==='rename-files'){if(!input.length)fail('no_input','Rename Finder Items needs Files input.');input=input.map((row,i)=>{const name=automatorRenamedName(row.name,p,i,session.variables);operations.push({type:'rename',fileId:reference(row),name,...expected(row)});const next={...row,name,revision:row.revision+1};shadow.set(row.id,next);return next;});}
  else if(action.kind==='copy-files'){destination(p.parentId);if(!input.length)fail('no_input','Copy Finder Items needs Files input.');input=input.map(row=>{const [base,ext]=splitName(row.name),name=base+expandAutomatorText(p.suffix,session.variables)+ext;return newRow(row,{type:'copy',fileId:reference(row),parentId:p.parentId,name,recursive:true,...expected(row)},name,row.mime,row.content);});}
  else if(action.kind==='scale-images'||action.kind==='convert-documents'){destination(p.parentId);if(!input.length)fail('no_input','Conversion needs Files input.');const next=[];for(const row of input){if(row.kind==='folder')fail('unsupported_content','Conversion requires documents, not folders.');const content=await sourceText(row),base=splitName(row.name)[0],suffix=expandAutomatorText(p.suffix,session.variables);let output,extension;
   if(action.kind==='scale-images'){output=await editPreviewImage(content,{width:p.width,rotation:p.rotation,mime:'image/'+p.format},guard);extension=p.format==='jpeg'?'jpg':p.format;}
   else {const decoded=decodeTextEditFile({text:content,mime:row.mime}),text=textEditPlainText(decoded.content)+expandAutomatorText(p.append,session.variables);output=encodeTextEditFile(createTextEditContent(text,p.format==='rtf'?'rich':'plain'));extension=p.format;}
   current();const name=base+suffix+'.'+extension,mime=output.mime.split(';')[0];next.push(newRow(row,{type:'write',parentId:p.parentId,name,mime,content:output.text},name,mime,output.text));}input=next;}
  else if(action.kind==='set-variable'){if(!session.variables.some(v=>v.name===p.name))fail('missing_variable','Declare this variable in the Variables panel first.');variables.set(p.name,input.map(row=>row.id));}
  else if(action.kind==='get-variable'){if(!variables.has(p.name))fail('missing_variable','Set this file variable earlier in the workflow.');input=variables.get(p.name).map(load);}
  else if(action.kind==='view-results')logs.push({actionId:action.id,message:input.length?input.map(row=>`${row.name} (${row.mime||row.kind})`).join('; ').slice(0,1024):'View Results: no Files were passed to this action.'});
  else fail('invalid_workflow','Unknown Files workflow action.');
  if(operations.length>512)fail('limit_exceeded','Workflow exceeds 512 staged Files operations.');logs.push({actionId:action.id,message:`${automatorLibrary.find(a=>a.kind===action.kind).name} completed · ${input.length} item${input.length===1?'':'s'}.`});
 }
 current();return {operations,logs,output:input.map(row=>({fileId:row.id,name:row.name,mime:row.mime,summary:row.kind==='folder'?'Folder':'File'}))};
}

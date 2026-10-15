import {object,choice,flag,empty,defineCommand} from './command-schema.js';
import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData,applyCanonicalData,canonicalStringUnits} from './canonical-data.js';
import {createMicrosoftOfficePDF} from './microsoft-office-pdf.js';
import {encodePreviewData,previewImageGeometry} from './preview-codec.js';
import {parseRange,columnName} from './office-spreadsheet-kernel.js';
export const MICROSOFT_OFFICE_PROFILES=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const microsoftOfficeIdSchema={type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const str=maxLength=>({type:'string',maxLength}),nullable=s=>({anyOf:[{type:'null'},s]});
export const microsoftOfficeTargetSchema=object({windowId:microsoftOfficeIdSchema});
export const microsoftOfficeCommonCommandSpecs={
 'window.new':[object({template:str(64)},[]),'Create a real application document window.'],
 'window.close':[object({discard:flag},[]),'Close clean document; dirty document opens save/discard dialog.'],
 open:[object({fileId:microsoftOfficeIdSchema},[]),'Read and import genuine Office Open XML from the original local File.'],
 save:[object({name:str(128),saveAs:flag},[]),'Save genuine Office Open XML with an atomic original File/document commit.'],
 'saveAs':[object({name:str(128)},[]),'Save to a new actual File.'],
 export:[object({format:choice('pdf'),name:str(128)},['format']),'Export actual document rendering as a genuine PDF.'],
 print:[empty,'Open the actual native print destination with genuine PDF bytes.'],
 share:[empty,'Share the actual original document through the common native destination.'],
 undo:[empty,'Undo an authored document operation.'],redo:[empty,'Redo an authored document operation.'],
 copy:[empty,'Copy selected plain text or cell input TSV to the single Root clipboard.'],
 cut:[empty,'Atomically cut actual selected text/cells/text-bearing slide objects to the single Root clipboard.'],
 paste:[empty,'Paste original Root text; Word/PowerPoint also embed original genuine PNG/JPEG image clipboard bytes.'],
 menu:[object({menu:nullable(str(64))}),'Open an actual native application menu.'],
 dialog:[object({dialog:nullable(str(64))}),'Show a retained native document dialog.'],
 tab:[object({tab:str(64)}),'Select an application ribbon tab.'],
 focus:[object({controlId:str(128)}),'Focus a real mounted enabled native control.']
};
export const microsoftOfficeImageCommandSpecs={'image.open':[object({fileId:microsoftOfficeIdSchema},[]),'Embed genuine PNG/JPEG bytes read from an original File through the native image picker.']};
const commonSpecs=appId=>({...microsoftOfficeCommonCommandSpecs,...(appId==='word'||appId==='powerpoint'?microsoftOfficeImageCommandSpecs:{})});
export function createMicrosoftOfficeCatalog(appId,specs){return Object.fromEntries(Object.entries({...commonSpecs(appId),...specs}).map(([suffix,[payload,description]])=>defineCommand(MICROSOFT_OFFICE_PROFILES,`${appId}.${suffix}`,`${appId}.local`,microsoftOfficeTargetSchema,payload,['Original canonical application graph and original actual mounted window.','Bounded supported genuine Office Open XML; unsupported features are rejected.'],[description],[appId],[],microsoftOfficeTargetSchema)));}
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
const identities=(value,path=[],out=[])=>{if(value&&typeof value==='object'){out.push([path,value]);for(const key of Object.keys(value))identities(value[key],[...path,key],out);}return out;};
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
export function createMicrosoftOfficeCommands(state,ctx,config){
 const {appId,validate,session,createWindow,metadata,capabilities,createDocument,validateDocument,commandSpecs,mutate,encode,decode,resetSelection}=config;
 const originals=new Map();let disposed=false,generation=0;
 const profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&state.profileId===profileId;
 const time=()=>ctx.getSceneTime?.()??0;
 const stale=()=>rejected('stale_target','The original application graph, source File, native window/view or authored time changed.');
 const unavailable=message=>rejected('unavailable',message);
 function snapshot(){const signature=JSON.stringify(state),refs=identities(state),version=generation,instant=time();return ()=>alive()&&generation===version&&time()===instant&&JSON.stringify(state)===signature&&refs.every(([path,value])=>path.reduce((node,key)=>node?.[key],state)===value)&&validate(state,ctx.profile).ok===true;}
 function lease(windowId,native=false){if(!alive()||!validate(state,ctx.profile).ok)return null;const window=ctx.getWindow(windowId),row=session(state,windowId),view=ctx.getView?.(windowId);if(!window||window.appId!==appId||!row||row.appId!==appId||originals.get(windowId)!==window||ctx.available(window)!==true||native&&view?.available?.()!==true)return null;const graph=snapshot(),signature=JSON.stringify(window);return {windowId,window,row,view,time:time(),guard:()=>graph()&&ctx.getWindow(windowId)===window&&session(state,windowId)===row&&ctx.getView?.(windowId)===view&&JSON.stringify(window)===signature&&ctx.available(window)===true&&(!native||view.available()===true)};}
 function prepare(owner,mutation){if(!owner.guard())return {error:stale()};const candidate=copyCanonicalData(state),row=session(candidate,owner.windowId);try{mutation(candidate,row);row.revision++;}catch(error){return {error:rejected(error.code??'invalid_arguments',String(error.message).slice(0,512))};}const result=validate(candidate,ctx.profile),delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);if(!result.ok)return {error:rejected('invalid_state',result.message)};if(ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded','Combined original scene retention budget exceeded.')};return owner.guard()?{candidate,delta}:{error:stale()};}
 const publish=candidate=>{applyCanonicalData(state,candidate);generation++;};
 function commit(owner,mutation,extra={}){const plan=prepare(owner,mutation);if(plan.error)return plan.error;if(!owner.guard())return stale();publish(plan.candidate);return applied(owner.windowId,extra);}
 function pin(owner,fileId,expectedRevision){
  if(typeof ctx.getFile!=='function')return {error:unavailable('Actual File identity reader is unavailable.')};
  const file=ctx.getFile(fileId),revision=file?.revision;
  if(!file||file.id!==fileId||expectedRevision!==undefined&&revision!==expectedRevision)return {error:rejected('conflict','The original File is missing or its saved revision changed.')};
  const getRoot=()=>ctx.getFilesStore?.()??ctx.getInventory?.().files,root=getRoot(),signature=JSON.stringify(file),refs=identities(file),rootSignature=root?JSON.stringify(root):null,rootRefs=root?identities(root):[];
  return {...owner,file,guard:()=>owner.guard()&&ctx.getFile(fileId)===file&&file.revision===revision&&JSON.stringify(file)===signature&&refs.every(([path,value])=>path.reduce((node,key)=>node?.[key],file)===value)&&(!root||getRoot()===root&&JSON.stringify(root)===rootSignature&&rootRefs.every(([path,value])=>path.reduce((node,key)=>node?.[key],root)===value))};
 }
 async function read(owner,fileId,expectedRevision){const source=pin(owner,fileId,expectedRevision);if(source.error)return source;if(typeof ctx.readFile!=='function')return {error:unavailable('Actual File bytes reader is unavailable.')};const result=await ctx.readFile(fileId,{guard:source.guard,windowId:owner.windowId});if(!source.guard())return {error:stale()};if(result?.status!=='applied'||result.file!==source.file||typeof result.text!=='string')return {error:result?.status==='rejected'?result:unavailable('Reader did not acknowledge exact original File bytes.')};return {...source,text:result.text,mime:result.mime,name:result.name};}
 const normalizeDocument=document=>config.normalizeDocument?config.normalizeDocument(document):document;
 function replaceDocument(row,document){const valid=validateDocument(document);if(valid!==true&&valid?.ok!==true)fail('unsupported_content',valid?.message??'Invalid supported Office document.');row.document=copyCanonicalData(document);resetSelection?.(row);row.status='';}
 function recordHistory(row,before){row.history.undo.push(before);if(row.history.undo.length>32)row.history.undo.shift();row.history.redo=[];row.dirty=true;}
 async function open(owner,payload){
  if(owner.row.dirty)return commit(owner,(_,row)=>{row.dialog='close';row.status='Save or discard changes before opening another document.';});
  let fileId=payload.fileId;
  if(!fileId){
   if(typeof ctx.chooseFile!=='function')return unavailable('Native Open destination is unavailable.');
   const chosen=await ctx.chooseFile({appId,title:`Open ${capabilities(ctx.profile).label} document`,mimes:config.mimes??[config.mime],windowId:owner.windowId},{guard:owner.guard,windowId:owner.windowId});
   if(!owner.guard())return stale();fileId=chosen?.fileId??chosen?.target?.fileId;
   if(chosen?.status!=='applied'||!previewSchemaValid(fileId,microsoftOfficeIdSchema))return chosen?.status==='rejected'?chosen:unavailable('No original File was chosen.');
  }
  const source=await read(owner,fileId);if(source.error)return source.error;
  if(!(config.mimes??[config.mime]).includes(source.mime))return rejected('unsupported_content','File MIME does not match a genuine supported application format.');
  const document=normalizeDocument(await decode(source.text,source.mime));if(!source.guard())return stale();
  return commit(source,(_,row)=>{replaceDocument(row,document);row.history={undo:[],redo:[]};row.fileId=fileId;row.fileRevision=source.file.revision;row.dirty=false;row.dialog=null;row.status=`Opened ${source.name}.`;});
 }
 async function write(owner,output,{save=false,existingFileId=null,expectedRevision}={}){
  if(typeof ctx.createFile!=='function'||typeof ctx.planFile!=='function')return unavailable('Atomic original Files planner/writer is unavailable.');
  if(typeof output.content!=='string'||output.content.length>1048576)return rejected('limit_exceeded','Encoded document exceeds the one Mi text File limit.');
  const spec={name:output.name,mime:output.mime,content:output.content,parentId:'documents',...(existingFileId?{existingFileId,expectedRevision}:{})};
  const filePlan=await ctx.planFile(spec,{guard:owner.guard,windowId:owner.windowId});
  if(!owner.guard())return stale();
  if(filePlan?.status!=='applied'||typeof filePlan.current!=='function'||filePlan.current()!==true)return filePlan?.status==='rejected'?filePlan:unavailable('Files did not provide an actual private write plan.');
  const metadata=filePlan.metadata,fileId=filePlan.fileId;
  if(!previewSchemaValid(fileId,microsoftOfficeIdSchema)||!metadata||!Object.isFrozen(metadata)||metadata.id!==fileId||metadata.name!==output.name||metadata.mime!==output.mime||metadata.content!==output.content||metadata.revision===undefined||existingFileId&&fileId!==existingFileId)return rejected('stale_target','Original File plan does not match the requested output.');
  const plan=prepare(owner,(_,row)=>{row.dialog=null;row.status=`Saved ${output.name}.`;if(save){row.fileId=fileId;row.fileRevision=metadata.revision;row.dirty=false;}});
  if(plan.error)return plan.error;let committedId=null;
  const guard=()=>owner.guard()&&filePlan.current()===true;
  const result=await ctx.createFile({...spec,plan:filePlan,reserveTextUnits:plan.delta,onCommit:(actualId,file,planned)=>{
   if(committedId!==null||!guard()||actualId!==fileId||file?.id!==fileId||planned!==metadata||!Object.isFrozen(planned)||existingFileId&&file!==owner.file)return false;
   if(!validate(plan.candidate,ctx.profile).ok||ctx.canCommit(plan.delta)!==true||!guard())return false;
   publish(plan.candidate);committedId=fileId;return true;
  }},{guard,windowId:owner.windowId});
  if(committedId!==null)return applied(owner.windowId,{fileId:committedId,presentationAvailable:alive()&&ctx.getWindow(owner.windowId)===owner.window});
  return owner.guard()?result?.status==='rejected'?result:unavailable('Files did not strictly atomically commit document bytes.'):stale();
 }
 async function save(owner,payload){const existingFileId=payload.saveAs?null:owner.row.fileId;if(existingFileId){const source=await read(owner,existingFileId,owner.row.fileRevision);if(source.error)return source.error;owner=source;}const output=await encode(copyCanonicalData(owner.row.document));if(!owner.guard())return stale();return write(owner,{...output,name:payload.name??`${owner.row.document.title||'Untitled'}.${output.extension}`},{save:true,existingFileId,expectedRevision:owner.row.fileRevision});}
 async function output(owner,payload,kind){
  if(kind==='export'&&payload.format!=='pdf'){
   const encoder=config.extraFormats?.[payload.format];if(typeof encoder!=='function')return rejected('unsupported_content','No genuine encoder is installed for that format.');
   const output=await encoder(copyCanonicalData(owner.row.document));if(!owner.guard())return stale();
   return write(owner,{...output,name:payload.name??`${owner.row.document.title||'Untitled'}.${output.extension}`});
  }
  const bytes=await createMicrosoftOfficePDF(appId,owner.row.document,owner.time,{guard:owner.guard});if(!owner.guard())return stale();
  const content=encodePreviewData(bytes,'application/pdf'),name=payload.name??`${owner.row.document.title||'Untitled'}.pdf`;
  if(kind==='export')return write(owner,{content,mime:'application/pdf',name});
  const hook=kind==='print'?(ctx.print??ctx.printDocument):(ctx.share??ctx.shareDocument);if(typeof hook!=='function')return unavailable(`Actual native ${kind} destination is unavailable.`);
  const result=await hook({title:owner.row.document.title,name,mime:'application/pdf',content,text:content,source:{appId,windowId:owner.windowId}},{guard:owner.guard,windowId:owner.windowId});if(!owner.guard())return stale();return result?.status==='applied'?applied(owner.windowId,{destination:result}):result?.status==='rejected'?result:unavailable(`Native ${kind} destination did not acknowledge actual PDF bytes.`);
 }
 function selectionText(row){
  if(appId==='word'){const p=row.document.paragraphs.find(p=>p.id===row.selection.paragraphId);return p.text.slice(row.selection.start,row.selection.end);}
  if(appId==='excel'){
   const range=parseRange(row.selection.anchor+':'+row.selection.focus),sheet=row.document.sheets.find(s=>s.id===row.document.activeSheetId),rows=[];
   for(let r=range.minRow;r<=range.maxRow;r++){const cells=[];for(let c=range.minColumn;c<=range.maxColumn;c++)cells.push(sheet.cells[columnName(c)+r]?.input??'');rows.push(cells.map(value=>/[\t\r\n"]/.test(value)?`"${value.replaceAll('"','""')}"`:value).join('\t'));}
   return rows.join('\n');
  }
  const slide=row.document.slides.find(s=>s.id===row.selection.slideId),selected=slide.objects.filter(item=>row.selection.objectIds.includes(item.id));
  if(!selected.length||selected.some(item=>item.type==='image'||!item.text))fail('unsupported_content','The supported single clipboard is plain text; select text-bearing objects. Use Duplicate for shapes/images.');
  return selected.map(item=>item.text).join('\n');
 }
 function editClipboard(candidate,row,kind,text,instant){
  const before=copyCanonicalData(row.document);let result;
  if(appId==='word')result=mutate(candidate,row,'text.insert',{text:kind==='cut'?'':text},instant);
  else if(appId==='excel')result=mutate(candidate,row,kind==='cut'?'range.clear':'range.paste',{range:row.selection.anchor+':'+row.selection.focus,...(kind==='cut'?{}:{text})},instant);
  else result=mutate(candidate,row,kind==='cut'?'object.delete':'object.insert',kind==='cut'?{}:{type:'text',text},instant);
  if(result?.documentChanged===true)recordHistory(row,before);
 }
 function insertImage(candidate,row,content,mime,instant){
  if(!['image/png','image/jpeg'].includes(mime))fail('unsupported_content','Pictures require genuine PNG/JPEG bytes.');
  const geometry=previewImageGeometry(content),x=appId==='powerpoint'?Math.min(72,row.document.width*.1):0,y=appId==='powerpoint'?Math.min(72,row.document.height*.1):0,scale=appId==='word'?Math.min(1,(row.document.page.width-2*row.document.page.margin)/geometry.width,(row.document.page.height-2*row.document.page.margin)/geometry.height):Math.min(1,(row.document.width-2*x)/geometry.width,(row.document.height-2*y)/geometry.height);
  const before=copyCanonicalData(row.document),size={width:Math.max(1,geometry.width*scale),height:Math.max(1,geometry.height*scale)},result=mutate(candidate,row,appId==='word'?'image.insert':'object.insert',{content,mime,...size,...(appId==='powerpoint'?{type:'image',x,y}:{})},instant);
  if(result?.documentChanged===true)recordHistory(row,before);row.dialog=null;
 }
 async function clipboard(owner,kind){
  if(typeof ctx.getClipboard!=='function')return unavailable('Single original Root clipboard is unavailable.');
  const original=ctx.getClipboard(),signature=JSON.stringify(original),refs=identities(original),guard=()=>owner.guard()&&ctx.getClipboard()===original&&JSON.stringify(original)===signature&&refs.every(([path,value])=>path.reduce((node,key)=>node?.[key],original)===value);
  if(kind==='paste'){
   if(original?.kind==='image'&&['word','powerpoint'].includes(appId))return commit({...owner,guard},(candidate,row)=>insertImage(candidate,row,original.content,original.mime,owner.time));
   if(original?.kind!=='text'||typeof original.text!=='string')return rejected('unsupported_content','This Office paste operation requires the actual Root plain-text clipboard.');
   return commit({...owner,guard},(candidate,row)=>editClipboard(candidate,row,kind,original.text,owner.time));
  }
  const text=selectionText(owner.row);if(!text)return rejected('disabled','Select nonempty text or cell input to copy or cut.');
  if(typeof ctx.setClipboard!=='function')return unavailable('Strict atomic Root clipboard writer is unavailable.');
  const source={...owner,guard},plan=prepare(source,(candidate,row)=>{if(kind==='cut')editClipboard(candidate,row,kind,text,owner.time);row.status=kind==='copy'?'Copied plain text to the shared clipboard.':'Cut content to the shared clipboard.';});
  if(plan.error)return plan.error;let committed=false;
  const result=await ctx.setClipboard({kind:'text',text,fileIds:[],reserveTextUnits:plan.delta,onCommit:()=>{
   if(committed||!guard()||ctx.canCommit(plan.delta)!==true||!guard())return false;publish(plan.candidate);committed=true;return true;
  }},{guard,windowId:owner.windowId});
  if(committed)return applied(owner.windowId,{presentationAvailable:alive()&&ctx.getWindow(owner.windowId)===owner.window});
  return guard()?result?.status==='rejected'?result:unavailable('Clipboard did not strictly acknowledge the paired actor transition.'):stale();
 }
 async function imageOpen(owner,payload){
  let fileId=payload.fileId;
  if(!fileId){
   if(typeof ctx.chooseFile!=='function')return unavailable('Native picture picker is unavailable.');
   const choice=await ctx.chooseFile({appId,title:'Insert Picture',mimes:['image/png','image/jpeg'],windowId:owner.windowId},{guard:owner.guard,windowId:owner.windowId});
   if(!owner.guard())return stale();fileId=choice?.fileId??choice?.target?.fileId;
   if(choice?.status!=='applied'||!previewSchemaValid(fileId,microsoftOfficeIdSchema))return choice?.status==='rejected'?choice:unavailable('No original picture File was selected.');
  }
  const source=await read(owner,fileId);if(source.error)return source.error;
  if(!['image/png','image/jpeg'].includes(source.mime))return rejected('unsupported_content','Pictures require genuine PNG/JPEG original File bytes.');
  return commit(source,(candidate,row)=>insertImage(candidate,row,source.text,source.mime,owner.time));
 }
 async function close(owner,payload){if(owner.row.dirty&&!payload.discard)return commit(owner,(_,row)=>{row.dialog='close';});if(typeof ctx.closeWindow!=='function')return unavailable('Original shell close is unavailable.');const result=await ctx.closeWindow(owner.windowId,{guard:owner.guard,windowId:owner.windowId});if(!ctx.getWindow(owner.windowId)&&!session(state,owner.windowId))return applied(owner.windowId);return owner.guard()?result?.status==='rejected'?result:unavailable('Original window was not closed.'):stale();}
 async function newWindow(owner,payload){if(typeof ctx.createWindow!=='function')return unavailable('Original shell window creation is unavailable.');const options={...metadata(ctx.profile),...payload,isCurrent:owner.guard,ownership:{guard:owner.guard,windowId:owner.windowId}},result=await ctx.createWindow(appId,options),id=typeof result==='string'?result:result?.windowId??result?.target?.windowId,actual=id?ctx.getWindow(id):null;if(!actual||actual.appId!==appId||!session(state,id)||originals.get(id)!==actual)return owner.guard()?result?.status==='rejected'?result:unavailable('Shell did not publish an original application window.'):stale();return applied(id);}
 const handlers={};for(const [suffix,[schema]] of Object.entries({...commonSpecs(appId),...commandSpecs}))handlers[`${appId}.${suffix}`]=async(target,payload={})=>{
  if(!previewSchemaValid(target,microsoftOfficeTargetSchema)||!previewSchemaValid(payload,schema))return rejected('invalid_arguments','Use the closed application command target and payload schema.');const owner=lease(target.windowId,suffix==='focus');if(!owner)return unavailable('Original application window/canonical graph/native control is unavailable.');
  try{if(['copy','cut','paste'].includes(suffix))return await clipboard(owner,suffix);if(suffix==='image.open')return await imageOpen(owner,payload);if(suffix==='open')return await open(owner,payload);if(suffix==='save'||suffix==='saveAs')return await save(owner,{...payload,saveAs:suffix==='saveAs'||payload.saveAs});if(['export','print','share'].includes(suffix))return await output(owner,payload,suffix);if(suffix==='window.close')return await close(owner,payload);if(suffix==='window.new')return await newWindow(owner,payload);if(suffix==='focus'){const result=await owner.view.focus(payload.controlId,owner.guard);return owner.guard()?result===true?applied(owner.windowId):unavailable('Actual enabled native control could not receive focus.'):stale();}
   return commit(owner,(candidate,row)=>{if(suffix==='menu'){row.menu=payload.menu;return;}if(suffix==='dialog'){row.dialog=payload.dialog;return;}if(suffix==='tab'){row.tab=payload.tab;return;}if(suffix==='undo'||suffix==='redo'){const from=row.history[suffix==='undo'?'undo':'redo'],to=row.history[suffix==='undo'?'redo':'undo'];if(!from.length)fail('unavailable','No document history operation is available.');to.push(copyCanonicalData(row.document));if(to.length>32)to.shift();replaceDocument(row,from.pop());row.dirty=true;return;}const before=copyCanonicalData(row.document);if(suffix==='template'){replaceDocument(row,createDocument(payload.template,owner.time));row.fileId=null;row.fileRevision=null;row.dialog=null;recordHistory(row,before);return;}const result=mutate(candidate,row,suffix,payload,owner.time);if(result?.documentChanged===true)recordHistory(row,before);});
  }catch(error){return rejected(error.code??'unsupported_content',String(error.message).slice(0,512));}
 };
 function windowOpened(actual,options={}){if(!alive()||!validate(state,ctx.profile).ok||!actual||actual.appId!==appId||!previewSchemaValid(actual.id,microsoftOfficeIdSchema)||ctx.getWindow(actual.id)!==actual||options.isCurrent&&options.isCurrent()!==true||options.ownership?.guard&&options.ownership.guard()!==true)return false;const row=session(state,actual.id);if(row){if(originals.has(actual.id)&&originals.get(actual.id)!==actual)return false;originals.set(actual.id,actual);return true;}const guard=snapshot(),signature=JSON.stringify(actual),candidate=copyCanonicalData(state);try{candidate.windows.push(createWindow(actual.id,{...options,sceneTime:time()}));}catch{return false;}if(!validate(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard()||ctx.getWindow(actual.id)!==actual||JSON.stringify(actual)!==signature)return false;publish(candidate);originals.set(actual.id,actual);return true;}
 function remove(ids){const guard=snapshot(),candidate=copyCanonicalData(state);candidate.windows.splice(0,candidate.windows.length,...candidate.windows.filter(row=>!ids.includes(row.windowId)));if(!validate(candidate,ctx.profile).ok||ctx.canCommit(canonicalStringUnits(candidate)-canonicalStringUnits(state))!==true||!guard())return false;publish(candidate);for(const id of ids)originals.delete(id);return true;}
 function windowClosed(actual,ownership={}){const id=typeof actual==='string'?actual:actual?.id,original=originals.get(id);if(!alive()||!session(state,id)||!original||typeof actual!=='string'&&actual!==original||ctx.getWindow(id)&&ctx.getWindow(id)!==original||ownership.guard&&ownership.guard()!==true)return false;return remove([id]);}
 function appQuit(id,ownership={}){if(id!==appId||!alive()||ownership.guard&&ownership.guard()!==true)return false;const rows=state.windows;if(rows.some(row=>ctx.getWindow(row.windowId)&&ctx.getWindow(row.windowId)!==originals.get(row.windowId)))return false;return remove(rows.map(row=>row.windowId));}
 return {handlers,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originals.clear();},targets(windowId){const owner=lease(windowId);return {windowId,appId,available:!!owner,capabilities:capabilities(ctx.profile),session:owner?copyCanonicalData(owner.row):null,native:owner?.view?.describe?.()??null};}};
}

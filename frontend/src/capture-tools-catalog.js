import {object,choice,flag,empty,defineCommand} from './command-schema.js';
import {CAPTURE_TOOL_PROFILES,captureToolId,captureCoordinate,captureRectSchema,screenshotStrokeSchema} from './capture-tools-state.js';
export const captureToolTargetSchema=object({windowId:captureToolId});
const nullable=s=>({anyOf:[{type:'null'},s]}),sheet=object({sheet:nullable(choice('help','preferences','save')),menu:nullable(choice('app','file','capture','view','window','help'))},[]);
export const screenshotCommandSpecs={
 settings:[object({mode:choice('screen','window','region'),destination:choice('file','clipboard'),parentId:captureToolId,dateFormat:choice('native','iso'),delay:choice(0,5,10),tool:choice('pen','highlight','crop'),color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$',minLength:7,maxLength:7},saveName:{type:'string',maxLength:256}},[]),'Choose native capture mode, scene destination, authored date naming, timer, annotation tool and Save As name.'],
 select:[object({region:nullable(captureRectSchema),selectedWindowId:nullable(captureToolId)},[]),'Select actual desktop client-coordinate region or original mounted window identity.'],
 preview:[empty,'Rasterize the original simulated desktop and preview the exact selected crop.'],
 capture:[empty,'Capture genuine selected pixels to an atomic PNG File or scene image clipboard.'],
 annotate:[object({stroke:screenshotStrokeSchema}),'Add a complete pointer-authored pen or highlighter stroke to the actual captured PNG; no snapshot fabrication.'],
 crop:[object({rect:captureRectSchema}),'Crop the actual captured PNG in image pixel coordinates with undo.'],
 undo:[empty,'Undo the latest genuine crop or completed annotation.'],
 save:[empty,'Save the actual edited captured PNG with strict paired File and actor publication.'],
 copy:[empty,'Copy the actual edited PNG to the atomic scene image clipboard.'],
 share:[empty,'Share the actual edited PNG through the guarded Root scene destination.'],
 sheet:[sheet,'Open capture menus, preferences or genuine help.'],
 focus:[object({controlId:{type:'string',minLength:1,maxLength:128}}),'Focus an original available capture control.'],
 'window.close':[empty,'Close the actual original Screenshot window.']
};
export const magnifierCommandSpecs={
 settings:[object({mode:choice('lens','window','docked'),followPointer:flag},[]),'Choose native-style loupe, window or docked pixel presentation and pointer following.'],
 zoom:[object({enabled:flag,scale:{type:'number',minimum:1,maximum:5}},[]),'Atomically update the actual shared Accessibility zoom and zoomScale; never duplicate Preferences flags.'],
 sample:[object({x:captureCoordinate,y:captureCoordinate}),'Capture and enlarge the actual simulated desktop pixels under client coordinates.'],
 refresh:[empty,'Refresh the actual retained loupe position from genuine desktop DOM.'],
 sheet:[object({sheet:nullable(choice('help','preferences')),menu:nullable(choice('app','file','capture','view','window','help'))},[]),'Open zoom menus, preferences and shortcut help.'],
 focus:[object({controlId:{type:'string',minLength:1,maxLength:128}}),'Focus an original available magnifier control.'],
 'window.close':[empty,'Close the actual original Magnifier window.']
};
const catalog=(appId,key,specs)=>Object.fromEntries(Object.entries(specs).map(([suffix,[payload,description]])=>defineCommand(CAPTURE_TOOL_PROFILES,`${appId}.${suffix}`,`${appId}.local`,captureToolTargetSchema,payload,['Original canonical window, native view, nested references and authored scene time.','Only genuine original simulated desktop raster; no host screen or synthetic fallback.'],[description],[key],[],captureToolTargetSchema)));
export const screenshotCatalog=catalog('screenshot','screenshot',screenshotCommandSpecs),magnifierCatalog=catalog('magnifier','magnifier',magnifierCommandSpecs);

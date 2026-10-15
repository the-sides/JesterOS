import {colorMeterWindow} from '../frontend/src/color-meter-state.js';
import {meterReadout} from '../frontend/src/color-meter-pixels.js';
const assert=(value,message)=>{if(!value)throw new Error(message);};
// Execute only against original mounted Root/native objects. sampleTarget must be
// an existing solid-color scene element, not a test-created capture substitute.
export async function runColorMeterNativeBrowserRegression({root,facade,controller,state,windowId,sampleTarget,flush,getClipboard}){
 assert(root?.isConnected&&facade?.available?.()===true,'Original meter DOM/facade must be mounted.');assert(sampleTarget?.isConnected&&typeof flush==='function','Original solid scene element and Root flush are required.');
 const session=colorMeterWindow(state,windowId),windows=state.windows,original=session;assert(original,'Original canonical meter session required.');
 const run=async(suffix,payload={})=>{const result=await controller.handlers['colormeter.'+suffix]({windowId},payload);assert(result?.status==='applied',suffix+': '+JSON.stringify(result));await flush();return result;};
 const bounds=sampleTarget.getBoundingClientRect(),point={x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2},css=sampleTarget.ownerDocument.defaultView.getComputedStyle(sampleTarget),color=css.backgroundColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
 assert(bounds.width>4&&bounds.height>4&&color&&css.backgroundImage==='none','Actual original target must have a solid opaque RGB background.');
 await run('settings',{space:'srgb',format:'decimal',aperture:1,magnification:4});await run('sample',point);
 const rgb=color.slice(1).map(Number);assert(session.sample.rgb.every((v,i)=>Math.abs(v-rgb[i])<=2),'Meter must sample actual original target background pixels, not synthetic wallpaper coordinates.');
 const preview=root.querySelector('[data-color-meter-preview]'),pixels=preview?.getContext('2d').getImageData(0,0,preview.width,preview.height);assert(pixels?.data.some((v,i)=>i%4!==3&&v>0),'Real magnifier canvas must retain genuine captured pixels.');
 await run('settings',{format:'hexadecimal'});const readout=meterReadout(session.sample.rgb,session.space,session.format);assert(root.textContent.includes(readout.values[0]),'Native output must show real hex channel values.');
 const measured=JSON.stringify(session.sample);await run('freeze',{frozen:true});const frozenAttempt=await controller.handlers['colormeter.sample']({windowId},{x:point.x+1,y:point.y+1});assert(frozenAttempt.status==='rejected'&&JSON.stringify(session.sample)===measured,'Frozen capture must not change the actual retained measurement.');
 await run('copy',{kind:'text'});if(getClipboard){const clip=getClipboard();assert(clip.text===readout.text,'Original Root clipboard must receive real measured color text.');}
 await run('freeze',{frozen:false});await run('lock',{axis:'both',locked:true});await run('sample',{x:point.x+2,y:point.y+2});assert(session.point.x===point.x&&session.point.y===point.y,'Both locks must hold original actual pointer coordinates.');
 await run('settings',{space:'lab'});assert(session.sample.rgb.every((v,i)=>Math.abs(v-rgb[i])<=2),'Color conversion must not overwrite original measured raster channels.');assert(root.textContent.includes('L*:'),'Native Lab channel output must be present.');
 assert(colorMeterWindow(state,windowId)===original&&state.windows===windows,'All native sampling/settings/clipboard retain original meter session and collection identities.');
 return {status:'applied',windowId,profileId:state.profileId,behaviors:['original-dom-to-canvas-sampling','real-magnifier-pixels','hex-and-lab-readout','freeze-and-position-locks','actual-scene-text-clipboard','original-session-identities']};
}

// Destructive only to the test's real original meter window; use a fresh scene.
export async function runColorMeterOriginalLifetimeRegression({root,facade,controller,state,windowId,sampleTarget,flush}){
 assert(root?.isConnected&&facade?.available?.()===true&&sampleTarget?.isConnected,'Actual original meter and sample source must be mounted.');
 const session=colorMeterWindow(state,windowId),oldSample=JSON.stringify(session.sample),windows=state.windows,bounds=sampleTarget.getBoundingClientRect();
 const pending=controller.handlers['colormeter.sample']({windowId},{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2});
 const closed=await controller.handlers['colormeter.window.close']({windowId},{});
 assert(closed.status==='applied','Actual Root close must remove the original window while real DOM capture is awaiting.');
 const result=await pending;await flush();
 assert(result.status==='rejected'&&result.error.code==='stale_target','In-flight real capture must reject the retired original window, not apply to an ID replacement.');
 assert(colorMeterWindow(state,windowId)===null&&state.windows===windows&&JSON.stringify(session.sample)===oldSample,'Retired original measurement must remain untouched after Root window removal.');
 return {status:'applied',windowId,behaviors:['original-window-capture-lifetime-rejection','no-retired-sample-publish']};
}

export async function runColorMeterGenuineSwatchRegression({root,facade,state,windowId}){
 const session=colorMeterWindow(state,windowId);assert(root?.isConnected&&facade?.available?.()===true&&session?.sample,'Original measured meter surface is required.');
 const packet=facade.colorImage(session.sample.rgb,()=>facade.available()===true);assert(packet?.mime==='image/png'&&packet.content.startsWith('data:image/png;base64,'),'Original native canvas must encode a genuine PNG swatch, not a fake extension/text payload.');
 const image=new root.ownerDocument.defaultView.Image();image.src=packet.content;await image.decode();
 assert(image.naturalWidth===32&&image.naturalHeight===32,'PNG decoder must recognize actual swatch dimensions.');
 const canvas=root.ownerDocument.createElement('canvas');canvas.width=canvas.height=32;const context=canvas.getContext('2d');context.drawImage(image,0,0);const actual=context.getImageData(16,16,1,1).data;canvas.width=canvas.height=0;
 assert(session.sample.rgb.every((v,i)=>actual[i]===Math.round(v))&&actual[3]===255,'Decoded genuine PNG must contain the measured original desktop RGB color.');
 return {status:'applied',windowId,behaviors:['genuine-png-swatch-decoder','measured-pixel-color-preservation']};
}

export async function runColorMeterImageClipboardRegression({root,controller,state,windowId,getClipboard,flush}){
 const session=colorMeterWindow(state,windowId);assert(root?.isConnected&&session?.sample&&typeof getClipboard==='function','Original measured meter and actual Root clipboard getter are required.');
 const result=await controller.handlers['colormeter.copy']({windowId},{kind:'image'});assert(result.status==='applied','Actual Root image clipboard paired commit must succeed.');await flush();
 const packet=getClipboard();assert(packet.kind==='image'&&packet.mime==='image/png'&&packet.content.startsWith('data:image/png;base64,')&&packet.width===32&&packet.height===32,'Actual original Root clipboard must contain encoded PNG bytes and true dimensions.');
 const image=new root.ownerDocument.defaultView.Image();image.src=packet.content;await image.decode();const canvas=root.ownerDocument.createElement('canvas');canvas.width=canvas.height=32;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixel=context.getImageData(16,16,1,1).data;canvas.width=canvas.height=0;
 assert(session.sample.rgb.every((v,i)=>pixel[i]===Math.round(v)),'Actual scene clipboard PNG must decode to original measured desktop color.');
 return {status:'applied',windowId,behaviors:['actual-image-clipboard','genuine-png-bytes','original-measured-color']};
}

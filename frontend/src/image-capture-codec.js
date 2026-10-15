import {renderPhoto,exportPhoto,PHOTO_DEFAULT_EDITS} from './photos-codec.js';
import {decodePreviewData,encodePreviewData} from './preview-codec.js';
import {IMAGE_CAPTURE_SCAN_SOURCE,imageCaptureScanOptionsSchema,imageCaptureSchemaValid} from './image-capture-state.js';
const current=guard=>{if(guard()!==true)throw Object.assign(new Error('The original scan operation changed.'),{code:'stale_target'});};
async function monochromeThreshold(image,{guard,engine}){
 const native=engine??{decode:(bytes,mime)=>createImageBitmap(new Blob([bytes],{type:mime})),createCanvas:(width,height)=>{const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;},encodeBlob:(canvas,mime)=>typeof canvas.convertToBlob==='function'?canvas.convertToBlob({type:mime}):new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No scan raster bytes.')),mime))};
 let bitmap,canvas;
 try{current(guard);bitmap=await native.decode(decodePreviewData(image.content).bytes,image.mime);current(guard);canvas=native.createCanvas(image.width,image.height);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height);for(let index=0;index<pixels.data.length;index+=4){const value=pixels.data[index]>=128?255:0;pixels.data[index]=pixels.data[index+1]=pixels.data[index+2]=value;}ctx.putImageData(pixels,0,0);current(guard);const blob=await native.encodeBlob(canvas,'image/png');current(guard);if(blob?.type!=='image/png')throw new Error('The scanner could not encode genuine PNG bytes.');const bytes=new Uint8Array(await blob.arrayBuffer());current(guard);return {...image,content:encodePreviewData(bytes,'image/png')};}
 finally{bitmap?.close?.();if(canvas){canvas.width=0;canvas.height=0;}}
}
// Resolution is relative to the authored 150dpi flatbed image, not a hardware claim.
export async function renderImageCaptureScan(options,{guard=()=>true,engine}={}){
 if(!imageCaptureSchemaValid(options,imageCaptureScanOptionsSchema)||options.crop.x+options.crop.width>1.0000001||options.crop.y+options.crop.height>1.0000001)throw Object.assign(new Error('Invalid scan options.'),{code:'invalid_arguments'});
 const crop=options.crop,scale=options.resolution/150,turned=options.rotate%2,naturalWidth=(turned?640*crop.height:960*crop.width)*scale,naturalHeight=(turned?960*crop.width:640*crop.height)*scale,bound=Math.min(1,2048/naturalWidth,2048/naturalHeight),width=Math.max(1,Math.round(naturalWidth*bound)),height=Math.max(1,Math.round(naturalHeight*bound));
 let image=await renderPhoto(IMAGE_CAPTURE_SCAN_SOURCE,'image/png',{...PHOTO_DEFAULT_EDITS,crop:{...crop},rotate:options.rotate,resize:{width,height},filter:options.kind==='color'?'none':'mono',exposure:options.correction==='manual'?options.exposure:0,contrast:options.correction==='manual'?options.contrast:1},{guard,engine});current(guard);
 if(options.kind==='text')image=await monochromeThreshold(image,{guard,engine});current(guard);
 if(options.format!=='image/png')image=await exportPhoto(image.content,image.mime,{mime:options.format,guard,engine});current(guard);return image;
}

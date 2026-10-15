// The raster is the original simulated desktop's SDR sRGB canvas, never host pixels.
export const COLOR_METER_SPACES=['native','srgb','display-p3','adobe-rgb','generic-rgb','lab'];
export const COLOR_METER_FORMATS=['decimal','hexadecimal','percentage'];
export const COLOR_METER_APERTURES=[1,3,5,9,17,33];
const multiply=(matrix,v)=>matrix.map(row=>row.reduce((sum,c,i)=>sum+c*v[i],0));
const clamp=x=>Math.min(1,Math.max(0,x));
const linear=x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;
const gamma=x=>x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055;
export function meterColorCoordinates(rgb,space='srgb'){
 if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(x=>!Number.isFinite(x)||x<0||x>255)||!COLOR_METER_SPACES.includes(space))throw new Error('Use actual bounded sRGB pixel values and a supported color space.');
 const encoded=rgb.map(x=>x/255),v=encoded.map(linear);
 if(space==='native'||space==='srgb')return encoded;
 const xyz=multiply([[0.4123907992659595,0.357584339383878,0.1804807884018343],[0.2126390058715104,0.715168678767756,0.0721923153607337],[0.0193308187155918,0.1191947797946259,0.9505321522496607]],v);
 if(space==='lab'){
  // Bradford adaptation D65 -> D50, followed by CIE 1976 Lab.
  const d50=multiply([[1.0479297925449969,0.022946870601609652,-0.05019226628920524],[0.02962780877005599,0.9904344267538799,-0.017073799063418826],[-0.009243040646204504,0.015055191490298152,0.7518742814281371]],xyz);
  const f=x=>x>216/24389?Math.cbrt(x):(24389/27*x+16)/116;
  const [x,y,z]=d50.map((x,i)=>f(x/[0.3457/0.3585,1,(1-0.3457-0.3585)/0.3585][i]));return [116*y-16,500*(x-y),200*(y-z)];
 }
 if(space==='display-p3')return multiply([[2.493496911941425,-0.9313836179191239,-0.4027107844507168],[-0.8294889695615747,1.7626640603183463,0.0236246858419436],[0.0358458302437845,-0.0761723892680418,0.9568845240076872]],xyz).map(x=>gamma(clamp(x)));
 if(space==='adobe-rgb')return multiply([[1829569/896150,-506331/896150,-308931/896150],[-851781/878810,1648619/878810,36519/878810],[16779/1248040,-147721/1248040,1266979/1248040]],xyz).map(x=>clamp(x)**(256/563));
 // Explicit local Generic RGB equivalent: sRGB primaries and gamma 1.8.
 return v.map(x=>x**(1/1.8));
}
export function meterReadout(rgb,space,format){
 const coords=meterColorCoordinates(rgb,space);if(!COLOR_METER_FORMATS.includes(format))throw new Error('Unsupported value format.');
 if(space==='lab')return {labels:['L*','a*','b*'],values:coords.map(v=>v.toFixed(2)),text:`Lab D50 (${coords.map(v=>v.toFixed(2)).join(', ')})`};
 const values=coords.map(x=>format==='hexadecimal'?Math.round(clamp(x)*255).toString(16).toUpperCase().padStart(2,'0'):format==='percentage'?`${(clamp(x)*100).toFixed(1)}%`:String(Math.round(clamp(x)*255)));
 return {labels:['R','G','B'],values,text:format==='hexadecimal'?`#${values.join('')}`:`${space}: ${values.join(', ')}`};
}
export function sampleMeterPixels(image,x,y,aperture){
 if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>3840||image.height>2160||!image.data||image.data.length!==image.width*image.height*4||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height||!COLOR_METER_APERTURES.includes(aperture))throw new Error('Use a real bounded RGBA raster and an in-frame aperture.');
 const radius=(aperture-1)/2,left=Math.max(0,x-radius),right=Math.min(image.width-1,x+radius),top=Math.max(0,y-radius),bottom=Math.min(image.height-1,y+radius),rgb=[0,0,0];let count=0;
 for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++){const i=(py*image.width+px)*4;for(let c=0;c<3;c++)rgb[c]+=image.data[i+c];count++;}
 return {rgb:rgb.map(sum=>sum/count),pixelCount:count,rect:{left,top,width:right-left+1,height:bottom-top+1}};
}
export function meterPixelCoordinate(point,bounds,width,height){
 if(!bounds||!['left','top','width','height'].every(k=>Number.isFinite(bounds[k]))||bounds.width<=0||bounds.height<=0||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isInteger(width)||!Number.isInteger(height))throw new Error('Actual desktop geometry is unavailable.');
 const x=Math.floor((point.x-bounds.left)*width/bounds.width),y=Math.floor((point.y-bounds.top)*height/bounds.height);
 if(x<0||y<0||x>=width||y>=height)throw new Error('The pointer is outside the simulated desktop.');return {x,y};
}

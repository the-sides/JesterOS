import {object,choice,flag,empty,defineCommand} from './command-schema.js';
import {COLOR_METER_PROFILES,colorMeterIdSchema} from './color-meter-state.js';
import {COLOR_METER_SPACES,COLOR_METER_FORMATS,COLOR_METER_APERTURES} from './color-meter-pixels.js';
const coordinate={type:'number',minimum:-100000,maximum:100000};
export const colorMeterTargetSchema=object({windowId:colorMeterIdSchema});
export const colorMeterCommandSpecs={
 sample:[object({x:coordinate,y:coordinate}), 'Rasterize and sample actual original simulated desktop pixels at client coordinates; aperture averages real RGBA bytes.'],
 refresh:[empty,'Resample actual retained pointer position from a new original DOM raster.'],
 settings:[object({space:choice(...COLOR_METER_SPACES),format:choice(...COLOR_METER_FORMATS),aperture:choice(...COLOR_METER_APERTURES),magnification:choice(1,2,4,8,16)},[]),'Choose actual supported color conversion, numeric format, aperture and magnification.'],
 lock:[object({axis:choice('x','y','both'),locked:flag},['axis']),'Lock actual horizontal/vertical aperture location.'],
 freeze:[object({frozen:flag},[]),'Freeze or resume an actual measured color.'],
 copy:[object({kind:choice('text','image')}),'Copy actual color text or genuine PNG swatch to the scene clipboard; never host clipboard.'],
 sheet:[object({sheet:{anyOf:[{type:'null'},choice('help','preferences')]},menu:{anyOf:[{type:'null'},choice('meter','view','color','window','help')]}},[]),'Open native meter menus/help/preferences.'],
 focus:[object({controlId:{type:'string',minLength:1,maxLength:128}}),'Focus an original enabled mounted native meter control.'],
 'window.close':[empty,'Close the actual original meter window.']
};
export const colorMeterCatalog=Object.fromEntries(Object.entries(colorMeterCommandSpecs).map(([suffix,[payload,description]])=>defineCommand(COLOR_METER_PROFILES,`colormeter.${suffix}`,'colormeter.local',colorMeterTargetSchema,payload,['Original canonical meter window and original mounted native surface.','Only actual simulated desktop DOM pixels; SDR sRGB raster, no host ICC/EDR.'],[description],['colorMeter'],[],colorMeterTargetSchema)));

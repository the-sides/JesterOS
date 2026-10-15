import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleMeterPixels,meterColorCoordinates,meterReadout,meterPixelCoordinate} from '../frontend/src/color-meter-pixels.js';
const near=(actual,expected,tolerance=0.003)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
test('single-pixel and clipped multi-pixel apertures average authored RGBA channel bytes',()=>{
 const image={width:3,height:2,data:Uint8ClampedArray.from([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255,255,255,255,255,120,60,30,255])};
 assert.deepEqual(sampleMeterPixels(image,1,0,1).rgb,[0,255,0]);
 const corner=sampleMeterPixels(image,0,0,3);assert.equal(corner.pixelCount,4);assert.deepEqual(corner.rgb,[127.5,127.5,63.75]);assert.deepEqual(corner.rect,{left:0,top:0,width:2,height:2});
 const all=sampleMeterPixels(image,1,1,33);assert.equal(all.pixelCount,6);assert.deepEqual(all.rgb,[105,95,90]);
 assert.throws(()=>sampleMeterPixels(image,3,0,1));assert.throws(()=>sampleMeterPixels(image,1,0,2));assert.throws(()=>sampleMeterPixels({...image,data:[]},1,0,1));
});
test('sRGB reference primaries convert to D50 Lab and Display P3, not relabeled RGB',()=>{
 const red=meterColorCoordinates([255,0,0],'lab');near(red[0],54.29,0.05);near(red[1],80.81,0.05);near(red[2],69.89,0.05);
 const white=meterColorCoordinates([255,255,255],'lab');near(white[0],100);near(white[1],0,0.04);near(white[2],0,0.04);
 const p3=meterColorCoordinates([255,0,0],'display-p3');near(p3[0],0.91749);near(p3[1],0.200286);near(p3[2],0.13856);
 assert.deepEqual(meterColorCoordinates([0,0,0],'adobe-rgb'),[0,0,0]);assert.deepEqual(meterColorCoordinates([0,0,0],'generic-rgb'),[0,0,0]);
 assert.throws(()=>meterColorCoordinates([255,0,0],'unimplemented-cmyk'));assert.throws(()=>meterColorCoordinates([256,0,0],'srgb'));
});
test('numeric display and genuine pointer geometry preserve measured values',()=>{
 assert.equal(meterReadout([12,128,255],'srgb','hexadecimal').text,'#0C80FF');assert.deepEqual(meterReadout([0,127.5,255],'srgb','percentage').values,['0.0%','50.0%','100.0%']);
 assert.deepEqual(meterPixelCoordinate({x:220,y:110},{left:20,top:10,width:400,height:200},800,400),{x:400,y:200});
 assert.throws(()=>meterPixelCoordinate({x:420,y:110},{left:20,top:10,width:400,height:200},800,400));
});

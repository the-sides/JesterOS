import test from 'node:test';
import assert from 'node:assert/strict';
import {createDictionaryNativeView} from '../frontend/src/dictionary-native-view.js';
import {DICTIONARY_PRONUNCIATIONS} from '../frontend/src/dictionary-pronunciation.js';
function surface(){
 let live=true,guarded=true,pending=null;
 const document={activeElement:null,defaultView:{innerWidth:900,innerHeight:700,getComputedStyle:n=>n.style}};
 const make=(id,rect)=>({isConnected:true,disabled:false,hidden:false,inert:false,dataset:{dictionaryControl:id},ownerDocument:document,parentElement:null,style:{display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible'},rect,clientLeft:0,clientTop:0,clientWidth:rect.width,clientHeight:rect.height,hasAttribute:()=>false,matches:()=>false,getClientRects(){return this.isConnected?[this.rect]:[];},getBoundingClientRect(){return this.rect;},focus(){document.activeElement=this;}});
 const root=make(null,{left:100,top:100,right:700,bottom:600,width:600,height:500});root.style.overflowX='hidden';root.style.overflowY='hidden';
 const search=make('search',{left:350,top:110,right:600,bottom:140,width:250,height:30}),reader=make('reader',{left:300,top:160,right:680,bottom:570,width:380,height:410}),offscreen=make('hidden-item',{left:110,top:650,right:200,bottom:680,width:90,height:30});for(const n of [search,reader,offscreen])n.parentElement=root;reader.scrollTop=0;reader.scrollHeight=1200;Object.defineProperty(reader,'scrollTop',{get(){return this.top??0;},set(v){this.top=Math.min(790,Math.max(0,v));}});root.contains=n=>[root,search,reader,offscreen].includes(n);root.querySelectorAll=()=>[search,reader,offscreen];
 const audio={paused:true,currentTime:0,readyState:4,src:'',pause(){this.paused=true;},async play(){if(pending)await pending;this.paused=false;},removeAttribute(){this.src='';},load(){}};
 const facade=createDictionaryNativeView({root,audio,owns:()=>live});return {root,search,reader,offscreen,audio,facade,guard:()=>guarded,retire:()=>{live=false;},invalidate:()=>{guarded=false;},defer:()=>{let resolve;pending=new Promise(r=>{resolve=r;});return resolve;}};
}
test('actual facade excludes clipped controls and acknowledges observed focus/scroll only while originals live',()=>{
 const f=surface();assert.deepEqual(f.facade.describe().controls,['search','reader']);assert.equal(f.facade.focus('hidden-item',f.guard),false);assert.equal(f.facade.focus('search',f.guard),true);assert.equal(f.facade.describe().focusedControl,'search');assert.equal(f.facade.scroll({top:1e6},f.guard),true);assert.equal(f.reader.scrollTop,790);f.search.disabled=true;assert.equal(f.facade.focus('search',f.guard),false);f.invalidate();assert.equal(f.facade.scroll({top:10},f.guard),false);assert.equal(f.reader.scrollTop,790);f.retire();assert.equal(f.facade.available(),false);assert.deepEqual(f.facade.describe().controls,[]);
});
test('local speech await cannot acknowledge or continue after its original window/time guard retires',async()=>{
 const f=surface(),release=f.defer(),operation=f.facade.pronounce(DICTIONARY_PRONUNCIATIONS.dictionary,f.guard);f.invalidate();release();assert.equal(await operation,false);assert.equal(f.audio.paused,true);assert.match(f.audio.src,/^data:audio\/ogg;base64,/u);
});
test('overlapping pronunciation attempts only allow the latest original audio lease, and teardown stops real playback',async()=>{
 const f=surface(),release=f.defer(),first=f.facade.pronounce(DICTIONARY_PRONUNCIATIONS.dictionary,f.guard),second=f.facade.pronounce(DICTIONARY_PRONUNCIATIONS.dictionary,f.guard);release();assert.equal(await first,false);assert.equal(await second,true);assert.equal(f.audio.paused,false);f.facade.destroy();assert.equal(f.audio.paused,true);assert.equal(f.audio.src,'');assert.equal(f.facade.available(),false);
});

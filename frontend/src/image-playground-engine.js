import { IMAGE_PLAYGROUND_CONCEPTS, imagePlaygroundRecipeSchema, imagePlaygroundSchemaValid } from './image-playground-state.js';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
export function imagePlaygroundPinGraph(value){
 const rows=[],seen=new Set();let safe=true;
 function visit(v){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);if(keys.some(k=>!Object.hasOwn(d[k],'value'))){safe=false;return;}rows.push([v,keys,keys.map(k=>d[k])]);for(const k of keys)visit(d[k].value);}
 visit(value);return()=>safe&&rows.every(([v,keys,old])=>{const d=Object.getOwnPropertyDescriptors(v),now=Reflect.ownKeys(d);return now.length===keys.length&&now.every((k,i)=>k===keys[i]&&Object.hasOwn(d[k],'value')&&d[k].value===old[i].value&&d[k].writable===old[i].writable&&d[k].enumerable===old[i].enumerable&&d[k].configurable===old[i].configurable);});
}
const COLORS={red:'#d65750',orange:'#df9452',yellow:'#eccd68',green:'#5a966c',blue:'#567fbb',purple:'#916daf',pink:'#dc9cb5',white:'#eeeae1',black:'#343841'};
const aliases={mountain:'mountains',tree:'forest',trees:'forest',flower:'flowers',cats:'cat',bunny:'rabbit',bunnies:'rabbit',sea:'ocean',beach:'ocean',sun:'sunset',star:'stars',sunglasses:'glasses'};
const fillers=new Set('a an the and with in on at of by for wearing under above beside near image picture illustration draw create make colorful colour colorful local procedural landscape scene cute happy small large little big'.split(' '));
export function parseImagePlaygroundPrompt(recipe){
 if(!imagePlaygroundSchemaValid(recipe,imagePlaygroundRecipeSchema))fail('invalid_arguments','Invalid closed procedural recipe.');
 const tokens=recipe.prompt.toLowerCase().match(/[a-z]+/gu)??[];if(/[^a-zA-Z\s,.;!\-]/u.test(recipe.prompt))fail('unsupported_prompt','Only the documented English concept and color words are supported.');
 const concepts=new Set(recipe.concepts),colors=[],unsupported=[];
 for(const word of tokens){const token=aliases[word]??word;if(IMAGE_PLAYGROUND_CONCEPTS.includes(token))concepts.add(token);else if(COLORS[token])colors.push(COLORS[token]);else if(!fillers.has(token))unsupported.push(word);}
 if(unsupported.length)fail('unsupported_prompt',`Unsupported procedural words: ${[...new Set(unsupported)].join(', ')}. Use mountains, forest, ocean, city, flowers, cat, rabbit, robot, sunset, night, stars, rainbow, hat, glasses and color names.`);
 if(!concepts.size&&!recipe.person)fail('unsupported_prompt','Describe at least one supported subject or choose a permission-authorized Photos source.');
 if(concepts.size>7)fail('unsupported_prompt','The local renderer supports at most seven combined concepts.');
 if(['cat','rabbit','robot'].filter(t=>concepts.has(t)).length+(recipe.person?1:0)>1)fail('unsupported_prompt','Choose one foreground subject: cat, rabbit, robot or a selected photo collage. Multiple foreground subjects are not supported.');
 if(new Set(colors).size>2)fail('unsupported_prompt','Use at most two named colors for the foreground and foliage palette.');
 if((concepts.has('hat')||concepts.has('glasses'))&&!['cat','rabbit','robot'].some(t=>concepts.has(t))&&!recipe.person)fail('unsupported_prompt','Hat and glasses require one foreground subject.');
 return {concepts:[...concepts],colors};
}
export const IMAGE_PLAYGROUND_MIME='application/vnd.jester.image-playground+json';
export function encodeImagePlaygroundRecipe(recipe){parseImagePlaygroundPrompt(recipe);return JSON.stringify({format:'Jester procedural image recipe',version:1,recipe});}
export function decodeImagePlaygroundRecipe(text){if(typeof text!=='string'||text.length>16384)fail('invalid_format','Custom recipe exceeds 16 KiB.');let data;try{data=JSON.parse(text);}catch{fail('invalid_format','This is not a JSON procedural recipe.');}if(!data||Object.keys(data).sort().join(',')!=='format,recipe,version'||data.format!=='Jester procedural image recipe'||data.version!==1)fail('invalid_format','Only the clearly custom Jester procedural recipe format is supported.');parseImagePlaygroundPrompt(data.recipe);return data.recipe;}
export async function renderImagePlayground(recipe,{guard=()=>true,photo=null,createCanvas=()=>globalThis.document?.createElement('canvas'),loadImage=null}={}){
 const current=()=>{if(guard()!==true)fail('stale_target','Original recipe, Photos permission/source, File, window, view, profile or authored scene time changed.');};
 current();const parsed=parseImagePlaygroundPrompt(recipe);let image=null;
 if(recipe.person){if(!photo||photo.id!==recipe.person.photoId||photo.revision!==recipe.person.photoRevision||!photo.people.includes(recipe.person.name)||photo.deletedAt||photo.hidden||!photo.inLibrary||!photo.mime.startsWith('image/'))fail('unavailable','The selected named person requires the exact visible canonical Photos image.');
 const content=photo.editedContent??photo.content;if(loadImage)image=await loadImage(content);else{if(typeof Image==='undefined')fail('unavailable','Native image decoder unavailable.');image=new Image();image.src=content;await image.decode();}current();}
 const canvas=createCanvas();if(!canvas)fail('unavailable','Actual canvas unavailable.');canvas.width=512;canvas.height=512;const c=canvas.getContext('2d');if(!c)fail('unavailable','Actual 2D canvas unavailable.');
 let seed=recipe.seed>>>0;for(const ch of recipe.prompt+recipe.concepts.join(','))seed=(Math.imul(seed^ch.charCodeAt(0),16777619))>>>0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const has=t=>parsed.concepts.includes(t),sketch=recipe.style==='sketch',animation=recipe.style==='animation',ink=sketch?'#4a4b53':'#34465e',accent=parsed.colors[0]??'#dd9774',leaf=parsed.colors[1]??'#587d6a';
 function ellipse(x,y,rx,ry,fill){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();if(sketch){c.strokeStyle=ink;c.lineWidth=2;c.stroke();}}
 function polygon(points,fill){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(sketch){c.strokeStyle=ink;c.stroke();}}
 function rect(x,y,w,h,fill){c.fillStyle=fill;c.fillRect(x,y,w,h);if(sketch){c.strokeStyle=ink;c.strokeRect(x,y,w,h);}}
 if(animation){const g=c.createLinearGradient(0,0,512,512);g.addColorStop(0,has('night')?'#182e51':'#b5cfda');g.addColorStop(1,has('sunset')?'#f4b48b':'#e9e5d4');c.fillStyle=g;c.fillRect(0,0,512,512);}else rect(0,0,512,512,sketch?'#f3eee2':has('night')?'#263651':has('sunset')?'#f1c1a0':'#d4e2e5');
 if(parsed.colors.length){c.fillStyle=parsed.colors[0]+'18';c.fillRect(0,0,512,512);}
 for(let i=0;i<3;i++){const x=40+random()*430,y=35+random()*100,r=17+random()*18;ellipse(x,y,r*1.8,r*.55,(parsed.colors[1]??(has('night')?'#647a95':'#ffffff'))+'66');}
 if(has('sunset'))ellipse(370,135,64,64,'#f0cf76');if(has('night')){ellipse(390,103,36,36,'#efe6b7');ellipse(404,89,32,32,'#263651');}
 if(has('stars')||has('night'))for(let i=0;i<30;i++){const x=random()*512,y=random()*240;ellipse(x,y,1+random()*2,1+random()*2,'#fff5cf');}
 if(has('rainbow'))for(let i=0;i<6;i++){c.beginPath();c.arc(256,330,210-i*14,Math.PI,0);c.lineWidth=14;c.strokeStyle=['#d57673','#dea46e','#e5cf79','#83b58a','#789ec1','#9b8db5'][i];c.stroke();}
 if(has('mountains'))for(let i=0;i<5;i++){const x=i*130-40,y=180+random()*90;polygon([[x-120,380],[x,y],[x+150,380]],i%2?'#879f9c':'#627e85');polygon([[x-26,y+45],[x,y],[x+35,y+45]],'#e4e6df');}
 rect(0,365,512,147,has('ocean')?'#598a9e':'#9eaf87');
 if(has('ocean'))for(let i=0;i<15;i++){c.strokeStyle='#bbdce2';c.lineWidth=2;c.beginPath();const x=random()*512,y=380+random()*110;c.moveTo(x,y);c.bezierCurveTo(x+12,y-6,x+20,y+6,x+38,y);c.stroke();}
 if(has('city'))for(let i=0;i<9;i++){const x=i*64-20,h=80+random()*170;rect(x,366-h,52,h,i%2?'#8493a5':'#677b90');for(let row=0;row<h/25-1;row++)for(let col=0;col<3;col++)rect(x+7+col*14,375-h+row*25,7,11,'#e9d7a4');}
 if(has('forest'))for(let i=0;i<8;i++){const x=30+i*65,y=285+random()*65;rect(x-5,y,10,98,'#776256');for(let j=0;j<3;j++)polygon([[x-35,y+30+j*24],[x,y-40+j*24],[x+35,y+30+j*24]],leaf);}
 if(has('flowers'))for(let i=0;i<20;i++){const x=random()*512,y=390+random()*90;c.strokeStyle=leaf;c.beginPath();c.moveTo(x,y+22);c.lineTo(x,y);c.stroke();for(let j=0;j<5;j++)ellipse(x+Math.cos(j*1.256)*7,y+Math.sin(j*1.256)*7,6,6,accent);ellipse(x,y,4,4,'#eed076');}
 if(has('cat')||has('rabbit')){const rabbit=has('rabbit'),x=256,y=280;ellipse(x,y+90,74,98,accent);if(rabbit){ellipse(x-32,y-65,18,68,accent);ellipse(x+32,y-65,18,68,accent);}else{polygon([[x-60,y-23],[x-55,y-94],[x-10,y-42]],accent);polygon([[x+60,y-23],[x+55,y-94],[x+10,y-42]],accent);}ellipse(x,y,77,64,accent);ellipse(x-28,y-8,7,9,ink);ellipse(x+28,y-8,7,9,ink);polygon([[x-7,y+14],[x+7,y+14],[x,y+22]],'#6e505b');c.strokeStyle=ink;c.beginPath();c.moveTo(x,y+22);c.lineTo(x,y+35);c.stroke();if(has('glasses')){c.lineWidth=4;c.strokeRect(x-50,y-24,42,29);c.strokeRect(x+8,y-24,42,29);c.beginPath();c.moveTo(x-8,y-10);c.lineTo(x+8,y-10);c.stroke();}if(has('hat')){rect(x-72,y-59,144,12,ink);rect(x-42,y-100,84,45,ink);}}
 else if(has('robot')){rect(198,238,116,138,accent);rect(186,145,140,96,'#a0aeb5');ellipse(222,187,13,13,ink);ellipse(290,187,13,13,ink);rect(231,216,50,6,ink);rect(174,255,20,94,ink);rect(318,255,20,94,ink);rect(208,376,28,55,ink);rect(278,376,28,55,ink);if(has('glasses')){c.strokeStyle=ink;c.lineWidth=4;c.strokeRect(200,170,45,31);c.strokeRect(268,170,45,31);c.beginPath();c.moveTo(245,183);c.lineTo(268,183);c.stroke();}if(has('hat')){rect(180,135,152,12,ink);rect(216,91,80,44,ink);}}
 if(image){c.save();c.beginPath();c.arc(256,260,100,0,Math.PI*2);c.clip();const w=image.naturalWidth??image.width,h=image.naturalHeight??image.height,scale=Math.max(200/w,200/h);if(!(w>0&&h>0))fail('invalid_format','Photos decoder has no real dimensions.');c.drawImage(image,256-w*scale/2,260-h*scale/2,w*scale,h*scale);c.restore();c.strokeStyle='#fff7e8';c.lineWidth=8;c.beginPath();c.arc(256,260,102,0,Math.PI*2);c.stroke();if(has('hat')){rect(190,157,132,12,ink);rect(217,111,78,46,ink);}if(has('glasses')){c.strokeStyle=ink;c.lineWidth=4;c.strokeRect(200,238,48,32);c.strokeRect(264,238,48,32);c.beginPath();c.moveTo(248,254);c.lineTo(264,254);c.stroke();}}
 if(sketch)for(let i=0;i<75;i++){c.strokeStyle='#5f616626';c.lineWidth=1;const x=random()*512,y=random()*512;c.beginPath();c.moveTo(x,y);c.lineTo(x+12,y-9);c.stroke();}
 current();const png=canvas.toDataURL('image/png');if(!png.startsWith('data:image/png;base64,'))fail('unavailable','Canvas did not produce real PNG bytes.');current();return {png,width:512,height:512};
}

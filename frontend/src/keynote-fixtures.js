import { encodePPTX } from './createoffice-xml-codec.js';
import { encodeWave,encodeMediaContent } from './media-codec.js';
export function keynoteDefaultFiles(){
 const slides=[{id:'welcome',name:'Local Presentations',background:'#ffffff',transition:{type:'none',duration:1},notes:'Open the Format inspector to edit the title. Add another slide, then play with arrow keys.',objects:[{id:'title',type:'text',x:80,y:150,width:800,height:100,text:'Create. Arrange. Present.',font:'Helvetica Neue',size:54,color:'#222222',bold:true,align:'center'},{id:'subtitle',type:'text',x:120,y:280,width:720,height:70,text:'An editable PowerPoint document in your local Files.',font:'Helvetica Neue',size:25,color:'#666666',align:'center'}]},{id:'workflow',name:'Your Workflow',background:'#17191c',transition:{type:'fade',duration:1},notes:'This chart contains actual authored values, not a screenshot.',objects:[{id:'steps',type:'chart',x:200,y:120,width:560,height:300,kind:'bar',title:'Presentation steps',labels:['Edit','Arrange','Present'],values:[3,2,4]},{id:'label',type:'text',x:140,y:450,width:680,height:50,text:'Save as PPTX • Export PDF or slide images',font:'Helvetica Neue',size:23,color:'#ffffff',align:'center'}]}];
 const deck=encodePPTX({title:'Local Presentation',width:960,height:540,slides});
 const samples=new Float32Array(8000);for(let i=0;i<samples.length;i++)samples[i]=.15*Math.sin(2*Math.PI*440*i/8000);
 const wav=encodeMediaContent(encodeWave({sampleRate:8000,channels:1,samples}),'audio/wav');
 return [{name:'Local Presentation.pptx',mime:deck.mime,content:deck.content,parentId:'documents'},{name:'Presentation Tone.wav',mime:'audio/wav',content:wav,parentId:'documents'}];
}

import { createFreeformObject } from './freeform-state.js';
import { encodeFreeformBoard,FREEFORM_MIME } from './freeform-engine.js';
export const FREEFORM_SAMPLE_BOARD={title:'A space for ideas',background:'#ffffff',objects:[
 createFreeformObject('sample-title','text',{x:60,y:40,width:620,height:70,text:'A space for ideas',size:38,bold:true,stroke:'#232323'}),
 createFreeformObject('sample-note-one','sticky',{x:60,y:150,width:210,height:180,text:'Start with a question.\n\nWhat should we make?',fill:'#fff2a6',stroke:'#665628'}),
 createFreeformObject('sample-note-two','sticky',{x:380,y:150,width:210,height:180,text:'Collect possibilities.\n\nMove ideas around.',fill:'#ddf4d6',stroke:'#365e36'}),
 createFreeformObject('sample-shape','shape',{x:220,y:410,width:210,height:100,text:'Make a plan',shape:'ellipse',fill:'#d9eaff'}),
 createFreeformObject('sample-connection','connector',{from:'sample-note-one',to:'sample-note-two',stroke:'#737373'}),
 createFreeformObject('sample-stroke','stroke',{x:600,y:410,width:130,height:55,points:[{x:0,y:35},{x:20,y:10},{x:45,y:50},{x:70,y:5},{x:105,y:40},{x:130,y:15}],stroke:'#ed9752',lineWidth:4})
]};
export const freeformFixtures=[{id:'freeform-sample-board',name:'A space for ideas.jboard',mime:FREEFORM_MIME,parentId:'documents',content:encodeFreeformBoard(FREEFORM_SAMPLE_BOARD)}];

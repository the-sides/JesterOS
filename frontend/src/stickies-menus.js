import { stickiesWindow,stickiesSelected,stickiesCapabilities,STICKIES_COLORS } from './stickies-state.js';
import { textEditPlainText } from './textedit-content.js';
export const STICKIES_COMPONENT='StickiesApp.svelte';
export const STICKIES_STYLESHEET='stickies.css';
export function stickiesMenus({state,profile,windowId}){
 const w=stickiesWindow(state,windowId),n=stickiesSelected(state,w),cap=stickiesCapabilities(profile),target={windowId};
 const leaf=(id,label,suffix,payload={},enabled=true,extra={})=>({id,label,enabled:!!n&&enabled,...extra,...(n&&enabled?{request:{command:`stickies.${suffix}`,target,payload}}:{})});
 const sheet=(id,label)=>leaf(id,label,'sheet',{sheet:id});
 return [
  {id:'stickies',label:cap.label,children:[sheet('help','About Stickies'),{id:'quit',label:'Quit Stickies',enabled:!!w,request:{command:'app.quit',target:{appId:'stickies'},payload:{}}}]},
  {id:'file',label:'File',children:[leaf('new','New Note','note.new',{},true,{shortcut:cap.windows?'Ctrl+N':'⌘N'}),leaf('import','Import Text…','import'),sheet('export','Export Text…'),sheet('retained','Retained Notes… · local extension'),leaf('close','Close Note','close',{},true,{shortcut:cap.windows?'Ctrl+W':'⌘W'})]},
  {id:'edit',label:'Edit',children:[leaf('undo','Undo','undo',{},!!n?.undo.length),leaf('redo','Redo','redo',{},!!n?.redo.length),...['cut','copy','paste','selectAll'].map(operation=>leaf(operation,{cut:'Cut',copy:'Copy',paste:'Paste',selectAll:'Select All'}[operation],'clipboard',{operation})),sheet('find','Find…')]},
  {id:'font',label:'Font',children:[sheet('fonts','Show Fonts'),...['bold','italic','underline','strike'].map(style=>leaf(style,{bold:'Bold',italic:'Italic',underline:'Underline',strike:'Strikethrough'}[style],'format',{[style]:true},w?.selection.start!==w?.selection.end)),leaf('plainStyle','Remove Styles','format',{bold:false,italic:false,underline:false,strike:false},w?.selection.start!==w?.selection.end)]},
  {id:'color',label:'Color',children:STICKIES_COLORS.map(color=>leaf(color,color[0].toUpperCase()+color.slice(1),'color',{color},true,{checked:n?.color===color}))},
  {id:'window',label:'Window',children:[leaf('collapse',n?.collapsed?'Expand':'Collapse','options',{collapsed:!n?.collapsed}),leaf('float','Float on Top','options',{floating:!n?.floating},true,{checked:!!n?.floating}),leaf('translucent','Translucent','options',{translucent:!n?.translucent},true,{checked:!!n?.translucent}),{id:'arrange',label:'Arrange By',children:['color','date','content','position'].map(by=>leaf(`arrange-${by}`,by[0].toUpperCase()+by.slice(1),'arrange',{by}))},...state.windows.map(win=>({id:`note-${win.windowId}`,label:textEditPlainText(stickiesSelected(state,win).content).split('\n')[0]||'Untitled Note',enabled:true,checked:win.windowId===windowId,request:{command:'window.focus',target:{windowId:win.windowId},payload:{}}}))]},
  {id:'help',label:'Help',children:[sheet('help','Stickies Help and Supported Formats')]}
 ].map(menu=>({...menu,enabled:!!w}));
}

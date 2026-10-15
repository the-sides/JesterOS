import {shortcutsSession,shortcutsAvailability} from './shortcuts-state.js';
export function shortcutsMenus(state,windowId){
 const w=shortcutsSession(state,windowId),busy=w?.status==='running',item=(id,label,command,payload={},enabled=true)=>({id,label,command:'shortcuts.'+command,target:{windowId},payload,enabled});
 return [
 {id:'shortcuts-app',label:shortcutsAvailability(state.profileId).label,items:[item('settings',/sonoma|golden-gate/u.test(state.profileId)?'Settings…':'Preferences…','panel',{panel:'preferences'},!busy),item('help','Shortcuts Help','panel',{panel:'help'},!busy)]},
 {id:'shortcuts-file',label:'File',items:[item('new','New Shortcut','new',{type:'workflow'},!busy),item('open','Import Portable Workflow…','open',{},!busy),item('save','Save Portable Workflow','save',{},!busy),item('save-as','Save As…','panel',{panel:'save'},!busy)]},
 {id:'shortcuts-edit',label:'Edit',items:[item('delete','Delete Action','deleteAction',{actionId:w?.selected??'none'},!!w?.selected&&!busy),item('up','Move Action Up','moveAction',{actionId:w?.selected??'none',index:Math.max(0,(w?.actions.findIndex(a=>a.id===w.selected)??0)-1)},!!w?.selected&&!busy)]},
 {id:'shortcuts-view',label:'View',items:['showLibrary','showVariables','showLog'].map((key,i)=>item(key,(state.preferences[key]?'Hide ':'Show ')+['Action Library','Variables','Results'][i],'preferences',{values:{...state.preferences,[key]:!state.preferences[key]}},!busy))},
 {id:'shortcuts-run',label:'Shortcut',items:[item('run','Run','run',{},!!w?.actions.length&&!busy),item('stop','Stop','stop',{},busy),item('clear','Clear Results','clearLog',{},!busy)]}
 ];
}

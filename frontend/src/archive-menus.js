import {archiveSession} from './archive-state.js';
export function archiveMenuItems(state,windowId){const w=archiveSession(state,windowId),idle=!!w&&w.status!=='running',item=(id,label,command,payload={},enabled=true)=>({id,label,command,payload,target:{windowId},enabled});return [
 {id:'archive-app',label:'Archive Utility',items:[item('archive-preferences',/sonoma|golden-gate/u.test(state.profileId)?'Settings…':'Preferences…','archive.panel',{panel:'preferences'},idle)]},
 {id:'archive-file',label:'File',items:[item('archive-create','Create Archive…','archive.open',{mode:'compress'},idle),item('archive-expand','Expand Archive…','archive.open',{mode:'expand'},idle),item('archive-start',w?.mode==='expand'?'Expand':'Create Archive','archive.run',{},idle&&!!w.fileIds.length),item('archive-cancel','Cancel','archive.cancel',{},w?.status==='running')]},
 {id:'archive-help',label:'Help',items:[item('archive-help','Archive Utility Help','archive.panel',{panel:'help'},idle)]}
 ];}

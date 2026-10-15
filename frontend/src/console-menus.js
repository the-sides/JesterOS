import { consoleSession, consoleAvailability, consoleRows } from './console-state.js';
export function consoleMenus(profile,state,windowId,feed=null) {
 const w=consoleSession(state,windowId),cap=consoleAvailability(profile),hasSelection=!!w&&!!feed&&consoleRows(feed,w).some(e=>e.id===w.selectedId),hasRows=!!w&&!!feed&&consoleRows(feed,w).length>0;
 const item=(id,label,command,payload={},enabled=true,checked=false)=>({id,label,enabled,checked,command,target:{windowId},payload,request:{command,target:{windowId},payload}});
 const filter=(category)=>({...w?.filter,query:w?.filter.query??'',severity:w?.filter.severity??'all',category});
 const menus=[
 {id:'app',label:cap.label,items:[item('preferences',cap.legacy?'Preferences…':'Settings…','console.panel',{panel:'preferences'}),item('help',`${cap.label} Help`,'console.panel',{panel:'help'})]},
 {id:'file',label:'File',items:[item('export','Export Events…','console.panel',{panel:'export'},hasRows),item('export-selected','Save Selected Event Report','console.export',{format:'report',scope:'selected'},hasSelection),item('archive','Open Historical Log Archive (Unavailable)','console.panel',{panel:'help'},false)]},
 {id:'edit',label:cap.windows?'Action':'Edit',items:[item('inspect',cap.windows?'Event Properties':'Show Info','console.inspect',{},hasSelection),item('clear',cap.windows?'Clear This View':'Clear Display','console.clear',{},hasRows),item('save-search',cap.windows?'Create Custom View…':'Save Search…','console.panel',{panel:'save-search'})]},
 {id:'view',label:'View',items:[item('stream',w?.streaming?'Pause':'Start Streaming','console.stream',{streaming:!w?.streaming},!!w,!!w?.streaming),item('all',cap.windows?'All Local Events':'All Messages','console.filter',{filter:filter('all')},!!w,w?.filter.category==='all'),item('reports','Action Failure Reports','console.filter',{filter:filter('reports')},!!w,w?.filter.category==='reports'),item('crashes','Crash Reports','console.filter',{filter:filter('crashes')},!!w,w?.filter.category==='crashes'),item('sidebar','Show Sidebar','console.preferences',{values:{...state.preferences,sidebar:!state.preferences.sidebar}},true,state.preferences.sidebar),item('info','Show Info Pane','console.preferences',{values:{...state.preferences,showInfo:!state.preferences.showInfo}},true,state.preferences.showInfo)]},
 {id:'action',label:cap.windows?'Custom Views':'Saved Searches',items:state.savedSearches.flatMap(search=>[item(`search-${search.id}`,search.name,'console.search.apply',{searchId:search.id}),item(`delete-${search.id}`,`Delete “${search.name}”`,'console.search.delete',{searchId:search.id})])}
 ];
 if(!cap.windows)return menus;
 const byId=new Map(menus.map(menu=>[menu.id,menu]));
 byId.get('edit').items.push(...byId.get('action').items);
 byId.get('view').items.push(item('settings','Local View Settings…','console.panel',{panel:'preferences'}));
 byId.get('app').label='Help';
 byId.get('app').items=byId.get('app').items.filter(entry=>entry.id==='help');
 return ['file','edit','view','app'].map(id=>byId.get(id));
}

import { dictionarySession,dictionaryResults,dictionaryNativeCapability } from './dictionary-state.js';
import { DICTIONARY_SOURCES } from './dictionary-corpus.js';
export function dictionaryMenus(profile,state,windowId){
 const w=dictionarySession(state,windowId),results=dictionaryResults(state,w),cap=dictionaryNativeCapability(profile);
 const leaf=(id,label,command,payload={},enabled=!!w,extra={})=>({id,label,enabled:!!enabled,...extra,...(enabled?{request:{command,target:{windowId},payload}}:{})});
 return [{id:'dictionary',label:cap.label,items:[leaf('preferences',cap.preferencesLabel,'dictionary.panel',{panel:'preferences'}),leaf('about','About the Local Corpus','dictionary.panel',{panel:'help'})]},
 {id:'file',label:'File',items:[leaf('close','Close Window','dictionary.close')]},
 {id:'edit',label:'Edit',items:[leaf('copy','Copy Definition','dictionary.copy',{},!!results.entries.length),leaf('paste','Paste and Look Up','dictionary.paste'),leaf('find','Search Dictionary','dictionary.focus',{controlId:'search'})]},
 {id:'go',label:'Go',items:[leaf('back','Back','dictionary.history',{direction:'back'},w?.historyIndex>0),leaf('forward','Forward','dictionary.history',{direction:'forward'},w?.historyIndex>=0&&w.historyIndex<w.history.length-1),leaf('snapback','SnapBack','dictionary.history',{direction:'snapBack'},!!w?.snapBack),leaf('history','History','dictionary.panel',{panel:'history'}),leaf('clear','Clear History','dictionary.history',{direction:'clear'},!!w?.history.length)]},
 {id:'view',label:'View',items:[leaf('smaller','Make Text Smaller','dictionary.fontSize',{size:Math.max(12,state.preferences.fontSize-1)},state.preferences.fontSize>12),leaf('bigger','Make Text Bigger','dictionary.fontSize',{size:Math.min(28,state.preferences.fontSize+1)},state.preferences.fontSize<28),leaf('all','All','dictionary.source',{source:'all'},!!w,{checked:w?.selectedSource==='all'}),...DICTIONARY_SOURCES.filter(s=>state.preferences.sources.includes(s.id)).map(s=>leaf(s.id,s.label,'dictionary.source',{source:s.id},!!w,{checked:w?.selectedSource===s.id}))]},
 {id:'window',label:'Window',items:[leaf('search','Search Field','dictionary.focus',{controlId:'search'}),leaf('reader','Definition','dictionary.focus',{controlId:'reader'})]},
 {id:'help',label:'Help',items:[leaf('help','Dictionary Help','dictionary.panel',{panel:'help'})]}];
}

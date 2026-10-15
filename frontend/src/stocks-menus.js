import {stocksWindow,stocksCapabilities,stocksQuote,stocksStory} from './stocks-state.js';
export function stocksMenus(profile,state,windowId){
 const w=stocksWindow(state,windowId),q=stocksQuote(state,w?.selectedId),story=stocksStory(state,w?.storyId),cap=stocksCapabilities(profile,state.preferences.region),target={windowId};
 const leaf=(id,label,command,payload={},enabled=!!w,extra={})=>({id,label,enabled,...extra,...(enabled?{request:{command,target,payload}}:{})});
 return [{id:'stocks',label:cap.native?'Stocks':'Local Stocks',items:[leaf('preferences',cap.mojave||cap.high?'Preferences…':'Settings…','stocks.sheet',{sheet:'preferences'}),leaf('about','About Local Market','stocks.sheet',{sheet:'help'})]},
 {id:'file',label:'File',items:[leaf('add','Add Symbol…','stocks.native.focus',{controlId:'search'}),leaf('save','Save Story to Apple News','stocks.story.saveNews',{},!!story&&cap.nativeReader),leaf('share','Share Story…','stocks.story.share',{},!!story&&cap.nativeReader),leaf('close','Close Window','stocks.window.close')]},
 {id:'edit',label:'Edit',items:[leaf('watchlist',w?.editing?'Done Editing Watchlist':'Edit Watchlist','stocks.watchlist.edit',{editing:!w?.editing},!!w),leaf('remove','Remove Symbol…','stocks.watchlist.remove',{symbolId:q?.id??'',confirm:false},!!q&&state.watchlist.includes(q.id))]},
 {id:'view',label:'View',items:[leaf('business','Business News','stocks.business'),leaf('refresh','Refresh Authored Quotes','stocks.refresh'),...['change','percent','market-cap'].map(display=>leaf(display,display==='change'?'Price Change':display==='percent'?'Percentage Change':'Market Capitalization','stocks.preferences',{values:{...state.preferences,display}},!!w,{checked:state.preferences.display===display}))]},
 {id:'window',label:'Window',items:[leaf('close','Close Window','stocks.window.close')]},{id:'help',label:'Help',items:[leaf('help','Stocks Help','stocks.sheet',{sheet:'help'})]}];
}

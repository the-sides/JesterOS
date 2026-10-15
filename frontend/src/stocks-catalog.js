import { object,choice,flag,empty,defineCommand } from './command-schema.js';
import { STOCKS_PROFILES,STOCKS_RANGES,stocksIdSchema as id,stocksPreferencesSchema } from './stocks-state.js';
const str=maxLength=>({type:'string',maxLength});
export const stocksWindowTarget=object({windowId:id});
export const stocksPayloads={
 'stocks.search':object({query:str(4096)}),'stocks.select':object({symbolId:id}),'stocks.business':empty,
 'stocks.watchlist.edit':object({editing:flag}),'stocks.watchlist.add':object({symbolId:id}),'stocks.watchlist.remove':object({symbolId:id,confirm:flag}),
 'stocks.watchlist.reorder':object({symbolIds:{type:'array',items:id,maxItems:64}}),'stocks.range':object({range:choice(...STOCKS_RANGES)}),
 'stocks.refresh':empty,'stocks.story.open':object({storyId:id}),'stocks.story.back':empty,'stocks.story.share':empty,'stocks.story.saveNews':empty,
 'stocks.preferences':object({values:stocksPreferencesSchema}),'stocks.sheet':object({sheet:choice('none','preferences','help')}),
 'stocks.notify':object({kind:choice('stocks-price','stocks-story'),recordId:id}),
 'stocks.menu.open':object({menuId:choice('stocks','file','edit','view','window','help')}),'stocks.menu.close':empty,
 'stocks.native.focus':object({controlId:{type:'string',minLength:1,maxLength:256}}),
 'stocks.native.scroll':object({areaId:choice('watchlist','detail','reader'),top:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},left:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}}),
 'stocks.window.close':empty
};
export const stocksCatalog=Object.fromEntries(Object.entries(stocksPayloads).map(([name,payload])=>defineCommand(STOCKS_PROFILES,name,'stocks.local',stocksWindowTarget,payload,['Actual original mounted Stocks or explicitly disclosed functional-equivalent window, canonical graph and authored clock.','No random refresh, remote markets, subscription or host clipboard.'],['Apply the canonical Stocks transition and present the real retained native controls.'],['stocks'],[],stocksWindowTarget)));

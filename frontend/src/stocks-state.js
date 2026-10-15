import { object, choice, flag } from './command-schema.js';
import { previewSchemaValid } from './preview-state.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { stocksSecurities, stocksSampleOffsets, stocksBusinessStories } from './stocks-fixtures.js';
export const STOCKS_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
const str=(maxLength=256,minLength=0)=>({type:'string',maxLength,minLength}), int=(minimum,maximum)=>({type:'integer',minimum,maximum}), num=(minimum,maximum)=>({type:'number',minimum,maximum}), arr=(items,maxItems)=>({type:'array',items,maxItems}), nullable=s=>({anyOf:[{type:'null'},s]});
export const stocksIdSchema={...str(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const id=stocksIdSchema, time=int(0,8639999999999999);
export const STOCKS_RANGES=['1D','1W','1M','3M','6M','YTD','1Y','2Y','5Y','10Y','ALL'];
export const stocksQuoteSchema=object({id,name:str(256,1),exchange:str(128,1),currency:choice('USD'),sector:str(128,1),shares:int(1,1000000000000),pe:num(0,10000),dividend:num(0,10000),volume:int(0,1000000000000),previousClose:num(.01,1000000),samples:arr(object({at:time,price:num(.01,1000000)}),512),revision:int(1,Number.MAX_SAFE_INTEGER-1)});
export const stocksStorySchema=object({id,title:str(512,1),publisher:str(256,1),author:str(256,1),symbolIds:arr(id,64),publishedAt:time,paragraphs:arr(str(8192,1),128),revision:int(1,Number.MAX_SAFE_INTEGER-1)});
export const stocksPreferencesSchema=object({display:choice('change','percent','market-cap'),notifications:flag,region:choice('US','GB','AU','CA','OTHER')});
export const stocksWindowSchema=object({windowId:id,selectedId:nullable(id),query:str(4096),editing:flag,removeId:nullable(id),storyId:nullable(id),sheet:choice('none','preferences','help'),menu:nullable(choice('stocks','file','edit','view','window','help'))});
export const stocksSchema=object({version:choice(1),profileId:choice(...STOCKS_PROFILES),quotes:arr(stocksQuoteSchema,64),stories:arr(stocksStorySchema,256),watchlist:arr(id,64),windows:arr(stocksWindowSchema,32),range:choice(...STOCKS_RANGES),preferences:stocksPreferencesSchema,runtime:object({refreshedAt:time}),alerts:arr(object({id,kind:choice('stocks-price','stocks-story'),recordId:id,sourceRevision:int(1,Number.MAX_SAFE_INTEGER-1),at:time,notificationId:id,active:flag}),256),nextId:int(1,Number.MAX_SAFE_INTEGER-1)});
export const stocksSchemaValid=previewSchemaValid;
export const stocksQuote=(state,id)=>state.quotes.find(q=>q.id===id)??null;
export const stocksStory=(state,id)=>state.stories.find(s=>s.id===id)??null;
export const stocksWindow=(state,id)=>state.windows.find(w=>w.windowId===id)??null;
export function stocksCapabilities(profile,region='US') {
 const id=typeof profile==='string'?profile:profile.id,high=id==='macos-high-sierra-10.13',windows=id.startsWith('windows11'),mojave=id==='macos-mojave-10.14',golden=id==='macos-golden-gate-27.0.1';
 return {high,windows,mojave,golden,native:!high&&!windows,appId:'stocks',label:high?'Local Stocks — High Sierra widget companion':windows?'Local Stocks — Windows functional equivalent':'Stocks',disclosure:high?'High Sierra has Stocks widgets, not the Mojave Stocks application. This local quote reader complements the original Dashboard/Today source.':windows?'Apple Stocks is not a Windows 11 application. This is an offline functional local equivalent.':golden?'Golden Gate presentation uses the researched macOS Tahoe 26 Stocks reference; exact 27 pixels are not certified.':'Authored offline market, securities and reporting — no live prices.',ranges:STOCKS_RANGES.filter(r=>r!=='YTD'||!mojave),nativeReader:!mojave||['US','GB','AU'].includes(region),multipleWatchlists:!high&&!windows&&!mojave};
}
export function validateStocksState(state,profile) {
 const bad=message=>({ok:false,message});
 if(!stocksSchemaValid(state,stocksSchema))return bad('Stocks requires its bounded closed data graph.');
 if(profile&&state.profileId!==(typeof profile==='string'?profile:profile.id))return bad('Stocks profile differs.');
 const distinct=rows=>new Set(rows.map(r=>typeof r==='string'?r:r.id??r.windowId)).size===rows.length;
 if(!distinct(state.quotes)||!distinct(state.stories)||!distinct(state.watchlist)||!distinct(state.windows)||!distinct(state.alerts)||new Set(state.alerts.map(a=>a.notificationId)).size!==state.alerts.length)return bad('Stocks original identities must be unique.');
 if(state.watchlist.some(id=>!stocksQuote(state,id))||!stocksCapabilities(state.profileId).ranges.includes(state.range))return bad('Stocks watchlist/range unavailable.');
 for(const q of state.quotes)if(!q.samples.length||q.samples.some((p,i)=>i&&p.at<=q.samples[i-1].at)||!q.samples.some(p=>p.at<=state.runtime.refreshedAt)||!q.name.trim())return bad('Stocks timeline must contain ordered original observations at the authored cursor.');
 for(const s of state.stories)if(!s.title.trim()||!s.paragraphs.length||s.symbolIds.some(id=>!stocksQuote(state,id))||!distinct(s.symbolIds))return bad('Stocks stories require full local text and actual securities.');
 for(const w of state.windows)if(w.selectedId!==null&&!stocksQuote(state,w.selectedId)||w.removeId!==null&&!state.watchlist.includes(w.removeId)||w.storyId!==null&&!stocksStory(state,w.storyId))return bad('Stocks session references missing originals.');
 for(const a of state.alerts)if(!(a.kind==='stocks-price'?stocksQuote(state,a.recordId):stocksStory(state,a.recordId))||a.at>state.runtime.refreshedAt)return bad('Stocks source alert is not an original canonical record.');
 if(canonicalStringUnits(state)>4194304)return bad('Stocks full graph retention exceeds scene maximum.');
 return {ok:true};
}
export function stocksEpoch(value) {const n=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(n)&&n>=0&&n<=8639999999999999?n:null;}
export function createStocksState(profile,{sceneTime}={}) {
 const profileId=typeof profile==='string'?profile:profile.id;
 if(!STOCKS_PROFILES.includes(profileId))throw new TypeError('Unsupported Stocks profile.');
 const at=stocksEpoch(sceneTime??profile?.defaults?.sceneTime);if(at===null)throw new TypeError('Stocks requires the original authored scene clock.');
 const quotes=stocksSecurities.map(q=>{const observed=new Map();for(let i=0;i<stocksSampleOffsets.length;i++){const timestamp=Math.min(8639999999999999,Math.max(0,at+Math.round(stocksSampleOffsets[i]*86400000)));observed.set(timestamp,{at:timestamp,price:q.prices[i]});}return {id:q.id,name:q.name,exchange:q.exchange,currency:q.currency,sector:q.sector,shares:q.shares,pe:q.pe,dividend:q.dividend,volume:q.volume,previousClose:q.previousClose,samples:[...observed.values()],revision:1};});
 const stories=stocksBusinessStories.map(s=>({id:s.id,title:s.title,publisher:s.publisher,author:s.author,symbolIds:[...s.symbolIds],publishedAt:Math.max(0,at-s.minutesAgo*60000),paragraphs:[...s.paragraphs],revision:1}));
 return {version:1,profileId,quotes,stories,watchlist:['HBR','NTH','CED'],windows:[],range:'1D',preferences:{display:'change',notifications:true,region:'US'},runtime:{refreshedAt:at},alerts:[],nextId:1};
}
export function stocksCurrent(state,quote) {
 if(!quote)return null;const samples=quote.samples.filter(p=>p.at<=state.runtime.refreshedAt),latest=samples.at(-1);if(!latest)return null;
 const day=86400000,cutoff=state.runtime.refreshedAt-day,daily=samples.filter(p=>p.at>cutoff),before=samples.filter(p=>p.at<=cutoff).at(-1),close=before?.price??quote.previousClose,change=latest.price-close;
 return {id:quote.id,name:quote.name,price:latest.price,at:latest.at,change,percent:change/close*100,marketCap:latest.price*quote.shares,open:daily[0]?.price??latest.price,high:Math.max(...daily.map(p=>p.price),latest.price),low:Math.min(...daily.map(p=>p.price),latest.price),volume:quote.volume};
}
export function stocksChart(state,quote,range=state.range) {
 if(!quote)return [];const end=state.runtime.refreshedAt,days={'1D':1,'1W':7,'1M':30,'3M':90,'6M':180,'1Y':365,'2Y':730,'5Y':1826,'10Y':3652};
 const cutoff=range==='ALL'?0:range==='YTD'?Date.UTC(new Date(end).getUTCFullYear(),0,1):Math.max(0,end-(days[range]??1)*86400000);
 const all=quote.samples.filter(p=>p.at<=end),previous=all.filter(p=>p.at<cutoff).at(-1),points=all.filter(p=>p.at>=cutoff);
 return previous?[previous,...points]:points;
}
export function stocksSearch(state,query) {const q=query.trim().toLocaleLowerCase();return state.quotes.filter(row=>!q||`${row.id} ${row.name} ${row.sector}`.toLocaleLowerCase().includes(q));}
// Readonly computed rows are never persisted: Dashboard and all widget hosts share this cursor.
export function stocksPublicProjection(state) {return {version:state.version,profileId:state.profileId,refreshedAt:state.runtime.refreshedAt,quotes:state.watchlist.map(id=>stocksCurrent(state,stocksQuote(state,id))),stories:state.stories.filter(s=>s.publishedAt<=state.runtime.refreshedAt).map(s=>({id:s.id,title:s.title,publisher:s.publisher,publishedAt:s.publishedAt})),availability:stocksCapabilities(state.profileId,state.preferences.region)};}
function graphLease(root) {const refs=[];const visit=value=>{if(!value||typeof value!=='object')return;refs.push([value,Object.getOwnPropertyDescriptors(value)]);for(const child of Object.values(value))visit(child);};visit(root);return()=>refs.every(([node,descriptors])=>Object.isExtensible(node)&&Reflect.ownKeys(node).length===Reflect.ownKeys(descriptors).length&&Reflect.ownKeys(descriptors).every(key=>{const before=descriptors[key],after=Object.getOwnPropertyDescriptor(node,key);return after&&Object.hasOwn(after,'value')&&after.writable===true&&(key==='length'||after.configurable===true)&&after.value===before.value&&after.configurable===before.configurable&&after.enumerable===before.enumerable;}));}
export function commitStocksCandidate(state,mutate,canCommit,guard=()=>true) {
 const reject=(code,message)=>({status:'rejected',error:{code,message}});
 if(!validateStocksState(state).ok||guard()!==true)return reject('stale_target','Stocks original graph is unavailable.');
 const current=graphLease(state),signature=JSON.stringify(state),candidate=copyCanonicalData(state);let result;
 try{result=mutate(candidate);}catch{return reject('invalid_arguments','Stocks mutation requires valid bounded arguments.');}
 if(result?.status==='rejected')return result;
 const valid=validateStocksState(candidate);if(!valid.ok)return reject('invalid_arguments',valid.message);
 let allowed=false;try{allowed=canCommit?.(canonicalStringUnits(candidate)-canonicalStringUnits(state))===true;}catch{}
 if(!allowed)return reject('limit_exceeded','Complete scene quota rejected Stocks mutation.');
 if(guard()!==true||!current()||!validateStocksState(state).ok||JSON.stringify(state)!==signature)return reject('stale_target','Stocks original graph changed during preflight.');
 applyCanonicalData(state,candidate);return {status:'applied',...(result??{})};
}

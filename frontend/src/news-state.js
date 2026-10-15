import { object, choice, flag } from './command-schema.js';
import { previewSchemaValid } from './preview-state.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { NEWS_CHANNELS, NEWS_TOPICS, createNewsArticles } from './news-fixtures.js';
export const NEWS_PROFILES = ['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export const NEWS_LIMITS = Object.freeze({ articles: 128, channels: 64, windows: 32, history: 128, textUnits: 1048576 });
const text = (maxLength=256,minLength=0) => ({type:'string',maxLength,minLength});
export const newsIdSchema = {...text(128,1),pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$',not:{enum:[...Object.getOwnPropertyNames(Object.prototype),'prototype']}};
const id = newsIdSchema, integer = {type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1}, array = (items,maxItems) => ({type:'array',items,maxItems}), nullable = schema => ({anyOf:[{type:'null'},schema]});
export const newsRegionSchema = choice('US','UK','AU','CA');
export const newsArticleSchema = object({id,channelId:id,regions:array(newsRegionSchema,4),topicIds:array(id,16),title:text(512,1),summary:text(8192,1),paragraphs:{...array(text(8192,1),64),minItems:1},author:text(256,1),publishedAt:integer,revision:integer,explicit:flag});
export const newsPreferencesSchema = object({region:newsRegionSchema,restrictToday:flag,restrictExplicit:flag,textSize:choice('small','medium','large'),notificationsEnabled:flag},[]);
export const newsWindowSchema = object({windowId:id,section:text(256,1),storyId:nullable(id),query:text(1024),sidebar:flag,sheet:nullable(choice('preferences','help','clear-history')),menu:nullable(choice('news','file','edit','view','window','help')),status:text(1024)});
export const newsSchemaValid = previewSchemaValid;
export const newsSchema = object({version:{const:1},profileId:choice(...NEWS_PROFILES),articles:array(newsArticleSchema,128),channels:array(object({id,name:text(256,1),regions:array(newsRegionSchema,4),color:{...text(7,7),pattern:'^#[0-9a-fA-F]{6}$'}}),64),topics:array(object({id,name:text(128,1)}),16),followingChannels:array(id,64),followingTopics:array(id,16),saved:array(id,128),history:array(object({id,readAt:integer}),128),recommendations:array(id,128),notifications:array(object({id,storyId:id,notificationId:id,deliveredAt:integer,active:flag}),128),preferences:object(newsPreferencesSchema.properties),windows:array(newsWindowSchema,32)});
export const newsWindow = (state,windowId) => state.windows.find(row=>row.windowId===windowId)??null;
export const newsStory = (state,storyId) => state.articles.find(row=>row.id===storyId)??null;
export function newsCapabilities(profile,region='US') {
  const id = typeof profile==='string'?profile:profile?.id;
  const absent = id?.includes('high-sierra')||id?.startsWith('windows11');
  const unavailableRegion = id?.includes('mojave')&&region==='CA';
  const golden = id?.includes('golden-gate');
  return {native:!absent&&!unavailableRegion,classic:id?.includes('mojave'),windows:id?.startsWith('windows11'),golden,appId:'news',label:absent||unavailableRegion?'Local News — functional equivalent':'News',disclosure:absent?'Apple News is absent on this OS. This is an authored offline functional equivalent, not a native backport.':unavailableRegion?'News was not available in Canada in Mojave 10.14.0. This regional feed is a disclosed local equivalent, not a later backport.':golden?'Golden Gate 27.0.1: closest macOS Tahoe 26 researched interface; exact 27 pixels are not certified.':'Native-era News recreation. All publishers and stories are authored offline fiction; no subscription or live service.'};
}
export function newsSectionValid(state,section) {return ['today','saved','history','following','search'].includes(section)||section.startsWith('channel:')&&state.channels.some(row=>row.id===section.slice(8))||section.startsWith('topic:')&&state.topics.some(row=>row.id===section.slice(6));}
export function validateNewsState(state,profile) {
  const bad = message=>({ok:false,message});
  if (!newsSchemaValid(state,newsSchema)) return bad('Invalid closed bounded News graph.');
  if (profile&&state.profileId!==(typeof profile==='string'?profile:profile.id)) return bad('News profile mismatch.');
  if (canonicalStringUnits(state)>NEWS_LIMITS.textUnits) return bad('News retention quota exceeded.');
  const unique = rows=>new Set(rows).size===rows.length;
  for (const rows of [state.articles,state.channels,state.topics,state.history,state.notifications]) if (!unique(rows.map(row=>row.id))) return bad('Duplicate News identity.');
  if (!unique(state.windows.map(row=>row.windowId))) return bad('Duplicate News window.');
  for (const [rows,exists] of [[state.followingChannels,id=>state.channels.some(row=>row.id===id)],[state.followingTopics,id=>state.topics.some(row=>row.id===id)],[state.saved,id=>!!newsStory(state,id)],[state.recommendations,id=>!!newsStory(state,id)]]) if (!unique(rows)||rows.some(id=>!exists(id))) return bad('Dangling News reference.');
  if (state.history.some(row=>!newsStory(state,row.id))||!unique(state.notifications.map(row=>row.notificationId))||state.notifications.some(row=>!newsStory(state,row.storyId))) return bad('Dangling history or alert.');
  for (const article of state.articles) if (!state.channels.some(row=>row.id===article.channelId)||!unique(article.regions)||!article.regions.length||!unique(article.topicIds)||article.topicIds.some(id=>!state.topics.some(row=>row.id===id))) return bad('Invalid story publisher, region or topic.');
  for (const channel of state.channels) if (!unique(channel.regions)||!channel.regions.length) return bad('Invalid publisher regions.');
  for (const window of state.windows) if (!newsSectionValid(state,window.section)||window.storyId&&!newsStory(state,window.storyId)) return bad('Dangling News window selection.');
  return {ok:true};
}
export function createNewsState(profile,{sceneTime=0}={}) {
  const time = typeof sceneTime==='string'?Date.parse(sceneTime):sceneTime;
  if (!Number.isSafeInteger(time)||time<0||time>=Number.MAX_SAFE_INTEGER) throw new TypeError('News requires an authored numeric scene instant.');
  return {version:1,profileId:typeof profile==='string'?profile:profile.id,articles:createNewsArticles(time),channels:copyCanonicalData(NEWS_CHANNELS),topics:copyCanonicalData(NEWS_TOPICS),followingChannels:['field-notes'],followingTopics:['community'],saved:[],history:[],recommendations:[],notifications:[],preferences:{region:'US',restrictToday:false,restrictExplicit:true,textSize:'medium',notificationsEnabled:true},windows:[]};
}
export const createNewsWindow = windowId=>({windowId,section:'today',storyId:null,query:'',sidebar:true,sheet:null,menu:null,status:''});
// Retain every original container and record, not merely its ID or serialized value.
export function newsGraphLease(state) {
  const records=[];
  const visit=(value,path)=>{if(value&&typeof value==='object'){records.push([path,value]);for(const key of Object.keys(value))visit(value[key],[...path,key]);}};
  visit(state,[]);const signature=JSON.stringify(state);
  return ()=>JSON.stringify(state)===signature&&records.every(([path,original])=>path.reduce((value,key)=>value?.[key],state)===original);
}
export const newsReject = (code,message)=>({status:'rejected',code,message,error:{code,message}});
export function commitNewsCandidate(state,mutate,{profile,guard=()=>true,canCommit}={}) {
  if (!validateNewsState(state,profile).ok||guard()!==true) return newsReject('stale_target','The original News graph is unavailable.');
  const current=newsGraphLease(state),candidate=copyCanonicalData(state),result=mutate(candidate);
  if (result?.status==='rejected') return result;
  const valid=validateNewsState(candidate,profile);if(!valid.ok)return newsReject('quota_exceeded',valid.message);
  const delta=canonicalStringUnits(candidate)-canonicalStringUnits(state);
  if(typeof canCommit!=='function'||canCommit(delta)!==true)return newsReject('quota_exceeded','The complete scene cannot retain this News transaction.');
  if(!current()||guard()!==true||!validateNewsState(state,profile).ok)return newsReject('stale_target','News changed during scene quota preflight.');
  applyCanonicalData(state,candidate);return {status:'applied',...(result??{})};
}
export function newsVisibleStories(state,session={section:'today',query:''}) {
  const section=session.section,region=state.preferences.region,query=session.query.toLocaleLowerCase('en-US');
  const eligible=state.articles.filter(story=>story.regions.includes(region)&&(!state.preferences.restrictExplicit||!story.explicit));
  if(section==='history')return state.history.map(row=>eligible.find(story=>story.id===row.id)).filter(Boolean).filter(story=>!query||story.title.toLocaleLowerCase('en-US').includes(query));
  const readTopics=new Set(state.recommendations.flatMap(id=>newsStory(state,id)?.topicIds??[]));
  const rank=story=>2*Number(state.followingChannels.includes(story.channelId)||story.topicIds.some(id=>state.followingTopics.includes(id)))+Number(story.topicIds.some(id=>readTopics.has(id)));
  return eligible.filter(story=>{
    if(section==='saved'&&!state.saved.includes(story.id)||section.startsWith('channel:')&&story.channelId!==section.slice(8)||section.startsWith('topic:')&&!story.topicIds.includes(section.slice(6)))return false;
    if(section==='today'&&state.preferences.restrictToday&&!state.followingChannels.includes(story.channelId))return false;
    return !query||[story.title,story.author,story.summary,...story.paragraphs,state.channels.find(row=>row.id===story.channelId)?.name,...story.topicIds.map(id=>state.topics.find(row=>row.id===id)?.name)].join('\n').toLocaleLowerCase('en-US').includes(query);
  }).sort((a,b)=>rank(b)-rank(a)||b.publishedAt-a.publishedAt);
}
export function newsFeedProjection(state,{limit=6}={}) {
  return Object.freeze(newsVisibleStories(state).slice(0,Math.max(0,Math.min(128,limit))).map(story=>Object.freeze({id:story.id,title:story.title,publisher:state.channels.find(row=>row.id===story.channelId)?.name,publishedAt:story.publishedAt,saved:state.saved.includes(story.id),region:state.preferences.region})));
}

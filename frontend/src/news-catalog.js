import { defineCommand, object, choice, empty, flag } from './command-schema.js';
import { NEWS_PROFILES, newsIdSchema as id, newsPreferencesSchema } from './news-state.js';
export const newsWindowTarget = object({windowId:id});
const text = maxLength=>({type:'string',maxLength}), offset={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
export const newsCommandPayloads = {
  'news.navigate': object({section:text(256)}),
  'news.search': object({query:text(1024)}),
  'news.story.open': object({storyId:id}),
  'news.story.close': empty,
  'news.follow': object({kind:choice('channel','topic'),id,following:flag}),
  'news.story.save': object({storyId:id,saved:flag}),
  'news.story.share': object({storyId:id}),
  'news.story.notify': object({storyId:id}),
  'news.history.clear': object({scope:choice('history','recommendations','all')}),
  'news.preferences.set': object({values:newsPreferencesSchema}),
  'news.sidebar.set': object({visible:flag}),
  'news.sheet.open': object({sheet:choice('preferences','help','clear-history')}),
  'news.sheet.close': empty,
  'news.menu.open': object({menuId:choice('news','file','edit','view','window','help')}),
  'news.menu.close': object({restoreFocus:flag}),
  'news.native.focus': object({controlId:text(256)}),
  'news.native.selection': object({controlId:text(256),start:offset,end:offset}),
  'news.native.scroll': object({areaId:choice('sidebar','feed','reader','dialog'),top:offset,left:offset}),
  'news.window.close': empty,
};
export const newsCatalog = Object.fromEntries(Object.entries(newsCommandPayloads).map(([name,payload])=>defineCommand(NEWS_PROFILES,name,'news.local',newsWindowTarget,payload,['Actual original mounted News window/session/view, authored scene clock and complete-scene quota.','Apple News absent OS/unsupported Mojave region uses a disclosed offline equivalent; no News+ backport or network.'],['Read/filter/follow/save genuine authored local stories or invoke actual native destination/control.'],['news'],[],newsWindowTarget)));
export function newsWindowMetadata(profile) {return {appId:'news',title:profile.id?.includes('high-sierra')||profile.id?.startsWith('windows11')?'Local News — functional equivalent':'News',width:1040,height:740,minWidth:680,minHeight:420,capability:'news.local',component:'NewsApp.svelte'};}

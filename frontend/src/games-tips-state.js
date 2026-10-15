import {object,choice,flag} from './command-schema.js';
import {chessIdSchema,chessSchemaValid,CHESS_PROFILES} from './chess-state.js';
import {canonicalStringUnits} from './canonical-data.js';
import {TIPS_COLLECTIONS,tipsTopic} from './tips-content.js';
export const GAMES_TIPS_PROFILES=CHESS_PROFILES;
export const gamesTipsIdSchema=chessIdSchema;
const text=maxLength=>({type:'string',maxLength}),revision={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1},nullable=s=>({anyOf:[{type:'null'},s]}),array=(items,maxItems)=>({type:'array',items,maxItems});
const base={windowId:chessIdSchema,query:text(256),sheet:choice('none','help'),menu:nullable(choice('application','view','window','help')),revision};
export const gamesWindowSchema=object({...base,section:choice('home','library','recents','profile'),playerName:{type:'string',minLength:1,maxLength:80}});
const location=object({collection:choice('all',...TIPS_COLLECTIONS),topicId:nullable(chessIdSchema),query:text(256)});
export const tipsWindowSchema=object({...base,collection:choice('all',...TIPS_COLLECTIONS),topicId:nullable(chessIdSchema),back:array(location,32),forward:array(location,32),textSize:choice('standard','large'),readTopics:array(chessIdSchema,32),reduceMotion:flag});
const schema=window=>object({version:{const:1},profileId:choice(...GAMES_TIPS_PROFILES),revision,windows:array(window,32)});
export const gamesSchema=schema(gamesWindowSchema),tipsSchema=schema(tipsWindowSchema);
export const gamesWindow=(state,id)=>state.windows.find(row=>row.windowId===id)??null;
export const tipsWindow=gamesWindow;
export const createGamesWindow=windowId=>({windowId,query:'',sheet:'none',menu:null,revision:0,section:'home',playerName:'Local Player'});
export const createTipsWindow=windowId=>({windowId,query:'',sheet:'none',menu:null,revision:0,collection:'all',topicId:null,back:[],forward:[],textSize:'standard',readTopics:[],reduceMotion:false});
const profileId=profile=>typeof profile==='string'?profile:profile.id;
function create(profile){const id=profileId(profile);if(!GAMES_TIPS_PROFILES.includes(id))throw new Error('Installed native-qualified profile required.');return {version:1,profileId:id,revision:0,windows:[]};}
export const createGamesState=create,createTipsState=create;
function validate(state,profile,kind){if(!chessSchemaValid(state,kind==='games'?gamesSchema:tipsSchema))return {ok:false,message:'Invalid bounded closed '+kind+' state.'};if(profile&&state.profileId!==profileId(profile))return {ok:false,message:'Actor belongs to another installed profile.'};if(canonicalStringUnits(state)>128*1024||new Set(state.windows.map(w=>w.windowId)).size!==state.windows.length)return {ok:false,message:'Actor quota or duplicate window identity.'};for(const w of state.windows){if(kind==='games'&&!w.playerName.trim())return {ok:false,message:'Local player name must not be blank.'};if(kind==='tips'){const valid=row=>!row.topicId||!!tipsTopic(row.topicId);if(!valid(w)||!w.back.every(valid)||!w.forward.every(valid)||new Set(w.readTopics).size!==w.readTopics.length||w.readTopics.some(id=>!tipsTopic(id)))return {ok:false,message:'Guide navigation references an unknown authored topic.'};}}return {ok:true};}
export const validateGamesState=(state,profile)=>validate(state,profile,'games');
export const validateTipsState=(state,profile)=>validate(state,profile,'tips');
function capabilities(profile,kind){const id=profileId(profile),windows=id.startsWith('windows11'),classic=id.includes('high-sierra')||id.includes('mojave'),golden=id.includes('golden-gate');const label=kind==='games'?'Games':id.includes('high-sierra')?'Mac Help':classic||id.includes('sonoma')?'Mac User Guide':'Tips';return {appId:kind,label,windows,classic,golden,era:windows?'windows11':id.includes('high-sierra')?'high-sierra':id.includes('mojave')?'mojave':golden?'golden':'sonoma',disclosure:golden?'Qualified nearest-macOS-26 local counterpart. Golden Gate 27 availability and pixel parity are unverified.':kind==='games'?windows?'Functional local games hub, not the Xbox app or an online service.':'Functional local games hub. Apple Games was introduced with macOS 26; it was not bundled in this historical profile.':windows?'Offline local Tips counterpart for Windows 11 Pro 23H2. Content is authored for this scene; no remote Microsoft service.':'Period Mac Help / User Guide local counterpart, not a separately bundled historical Tips app.'};}
export const gamesCapabilities=profile=>capabilities(profile,'games'),tipsCapabilities=profile=>capabilities(profile,'tips');
function metadata(profile,kind){const cap=capabilities(profile,kind);return {appId:kind,title:cap.label,utilityKind:kind,component:kind==='games'?'GamesApp.svelte':'TipsApp.svelte',capability:kind+'.local',width:kind==='games'?980:900,height:660,minWidth:360,minHeight:300};}
export const gamesWindowMetadata=profile=>metadata(profile,'games'),tipsWindowMetadata=profile=>metadata(profile,'tips');

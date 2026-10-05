import { text, flag, choice, object, empty, match } from './command-schema.js';
import { applied, invalid, stale, uiState, conforms } from './windows11-app-helpers.js';
export const pages=['home','system','display','sound','network','personalization','background','colors','about'];
export const menus=['options'];
export const preferences={theme:choice('light','dark'),accent:choice('#0078d4','#8764b8','#107c10','#d83b01'),wallpaper:choice('bloom','glow','flow'),scale:choice(100,125,150,175),resolution:choice('1920 × 1080','1600 × 900','1280 × 720'),nightLight:flag,output:choice('Speakers','Headphones'),monoAudio:flag,notificationSounds:flag,transparency:flag,animation:flag,networkProfile:choice('Private','Public'),metered:flag};
export const createState=()=>({ui:uiState(),page:'home',search:'',theme:'light',accent:'#0078d4',wallpaper:'bloom',scale:100,resolution:'1920 × 1080',nightLight:false,output:'Speakers',monoAudio:false,notificationSounds:true,transparency:true,animation:true,networkProfile:'Private',metered:false,deviceName:'STUDIO-PC',draftName:'',message:''});
export const specs={
 'win11.settings.navigate':[object({page:choice(...pages)}),empty,['settings page'],[]],
 'win11.settings.search':[empty,object({value:text})],
 'win11.settings.preference':[object({control:choice(...Object.keys(preferences))}),object({value:{anyOf:[text,flag,{type:'number'}]}}),['preference controls','shell appearance'],['fictional preferences'],Object.entries(preferences).map(([control,schema])=>({if:match({target:match({control:{const:control}})}),then:match({payload:match({value:schema})})}))],
 'win11.settings.dialog':[empty,object({dialog:choice('rename','network','none')})],
 'win11.settings.renameDraft':[empty,object({value:text})],
 'win11.settings.renameSave':[empty,empty],
};
export function createCommands(apps,context){const s=apps.settings;return {
 'win11.settings.navigate':async({page})=>{if(!pages.includes(page))return invalid('This page is not represented.');const result=await context.invoke('app.open',{appId:'settings'},{});if(result.status!=='applied')return result;s.page=page;s.search='';s.ui.menu=null;s.ui.dialog=null;s.message='';return applied({page});},
 'win11.settings.search':(_,{value})=>{s.search=value;return applied();},
 'win11.settings.preference':({control},{value})=>{if(!preferences[control]||!conforms(value,preferences[control]))return invalid('Unsupported preference value.');s[control]=value;s.message='Preference saved for this fictional scene.';return applied({control});},
 'win11.settings.dialog':(_,{dialog})=>{s.ui.dialog=dialog==='none'?null:dialog;if(dialog==='rename')s.draftName=s.deviceName;return applied();},
 'win11.settings.renameDraft':(_,{value})=>{if(s.ui.dialog!=='rename')return stale();s.draftName=value;return applied();},
 'win11.settings.renameSave':()=>{if(s.ui.dialog!=='rename')return stale();if(!/^(?=.*[A-Za-z])[A-Za-z0-9-]{1,15}$/.test(s.draftName))return invalid('Use 1–15 letters, digits or hyphens, including a letter.');s.deviceName=s.draftName;s.ui.dialog=null;s.message='Device renamed in this fictional scene. No host device changes or restart.';return applied();},
};}
export const readTargets=apps=>({pages:[...pages],page:apps.settings.page,menus:[...menus],menu:apps.settings.ui.menu,preferences:Object.fromEntries(Object.keys(preferences).map(key=>[key,{value:apps.settings[key],schema:JSON.parse(JSON.stringify(preferences[key]))}])),quickControls:['wifi','bluetooth','airplane','volume','brightness'],quickOwner:'native.shell.quick',quickCommand:'win11.quick.set',dialog:apps.settings.ui.dialog,draftName:apps.settings.ui.dialog==='rename'?apps.settings.draftName:null,availability:{renameSave:apps.settings.ui.dialog==='rename',renameDraft:apps.settings.ui.dialog==='rename'},deviceName:apps.settings.deviceName,search:apps.settings.search});

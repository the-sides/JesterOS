import {previewSchemaValid} from './preview-state.js';
import {copyCanonicalData} from './canonical-data.js';
import {keyboardRows} from './input-model.js';
import {voiceOverCommandSpecs,voiceOverTargetSchema} from './voiceover-catalog.js';
import {createVoiceOverWindow,validateVoiceOverState,voiceOverCapabilities,VOICEOVER_LESSONS} from './voiceover-state.js';
import {createAudioUtilityController,avRejected,avApplied} from './audio-midi-controller.js';
import {voiceOverAnnouncement} from './voiceover-announcement.js';
export function createVoiceOverCommands(state,ctx){
 const core=createAudioUtilityController(state,ctx,{appId:'voiceover',validate:validateVoiceOverState,createWindow:createVoiceOverWindow,sharedNames:['preferences','input','sound']});
 const handlers={};for(const [suffix,schema] of Object.entries(voiceOverCommandSpecs))handlers[`voiceover.${suffix}`]=async(target,p={})=>{
 if(!previewSchemaValid(target,voiceOverTargetSchema)||!previewSchemaValid(p,schema))return avRejected('invalid_arguments','Use the closed VoiceOver command schema.');const owner=core.lease(target.windowId,['settings','read','navigate','focus','training','key'].includes(suffix));if(!owner)return avRejected('unavailable','Original VoiceOver window, shared graph or mounted view unavailable.');
 try{
 if(suffix==='app.quit'){if(!ctx.appQuit)return avRejected('unavailable','Guarded application quit unavailable.');return await ctx.appQuit('voiceover',{windowId:owner.windowId,guard:owner.guard});}
 if(suffix==='settings'){if(p.voiceOverVoice&&p.voiceOverVoice!=='browser-default'&&!owner.view.voices().some(v=>v.id===p.voiceOverVoice))return avRejected('unavailable','Requested browser-local voice is unavailable.');return core.shared(owner,'preferences',s=>{const a=s.configuration.accessibility;for(const [key,value] of Object.entries(p))a[key]=value;},(_,w)=>{w.status='Local accessibility preferences updated. Host settings unchanged.';});}
 if(suffix==='window.close'){if(!ctx.closeWindow)return avRejected('unavailable','Guarded shell close unavailable.');return await ctx.closeWindow(owner.windowId,{windowId:owner.windowId,guard:owner.guard});}
 if(suffix==='focus'){const ok=await owner.view.focus(p.controlId,owner.guard);return owner.guard()?ok?avApplied(owner.windowId):avRejected('unavailable','Enabled control unavailable.'):core.stale();}
 if(suffix==='read'||suffix==='navigate'){
 if(suffix==='read'&&p.operation==='stop'){owner.view.stop();return core.commit(owner,(_,w)=>{w.status='Local reading stopped.';});}
 if(suffix==='navigate'&&p.operation!=='read'){const result=owner.view.navigate(p.operation,owner.guard);return owner.guard()?result?avApplied(owner.windowId,{focusedControl:result}):avRejected('unavailable','No mounted enabled practice control.'):core.stale();}
 const text=suffix==='navigate'?owner.view.focusedText():owner.session.readingText;if(!text)return avRejected('unavailable','Enter text or focus a readable local control.');const settings=copyCanonicalData(ctx.getShared('preferences').configuration.accessibility),sound=ctx.getShared('sound'),output=sound.outputs.find(d=>d.id===sound.outputDeviceId);settings.previewVolume=output?.muted?0:(output?.volume??0)/100;
 const prepared=core.prepare(owner,(_,w)=>{w.caption=settings.captions?text:'';w.status='Browser-local reading completed.';});if(prepared.error)return prepared.error;
 const announced=voiceOverAnnouncement(text,settings,suffix==='navigate'?owner.view.focusedDescription?.()??{}:{});const result=await owner.view.read(announced,settings,owner.guard);if(!owner.guard())return core.stale();if(result?.status!=='applied')return result??avRejected('unavailable','Browser-local speech unavailable.');core.publish(prepared.candidate);return avApplied(owner.windowId,{browserSpeech:true,voiceId:result.voiceId});
 }
 if(suffix==='training'&&p.operation==='practice'){
 if(!p.action)return avRejected('invalid_arguments','A practice action is required.');const result=await owner.view.practice(p.action,owner.guard);if(!owner.guard())return core.stale();if(result!==true)return avRejected('unavailable','The practice action did not occur in the mounted lesson.');return core.commit(owner,(_,w)=>{if(VOICEOVER_LESSONS[w.lesson].goal===p.action&&!w.completed.includes(w.lesson))w.completed.push(w.lesson);w.status='Practice action completed on the local controls.';});
 }
 if(suffix==='key'){
 const input=ctx.getShared('input'),key=keyboardRows(input.activeSourceId,{shift:owner.session.shift,option:owner.session.option}).flat().find(k=>k.keyId===p.keyId);if(!key)return avRejected('invalid_arguments','Key is unavailable in the original input layout.');
 if(key.action==='modifier')return core.commit(owner,(_,w)=>{if(key.keyId==='Shift')w.shift=!w.shift;if(key.keyId==='Option')w.option=!w.option;});
 const insertion=owner.view.keyboardEdit(key,owner.guard);if(!owner.guard())return core.stale();if(!insertion)return avRejected('unavailable','Focus the mounted Reading Preview editor first.');return core.commit(owner,(_,w)=>{w.readingText=insertion.text;});
 }
 return core.commit(owner,(_,w)=>{
 if(suffix==='category')w.category=p.category;
 if(suffix==='search')w.search=p.text;
 if(suffix==='sheet')for(const key of Object.keys(p))w[key]=p[key];
 if(suffix==='text')w.readingText=p.text;
 if(suffix==='auxiliary')for(const key of Object.keys(p))w[key]=p[key];
 if(suffix==='training'){w.sheet='training';if(p.operation==='restart'){w.lesson=0;w.completed=[];}if(p.operation==='next')w.lesson=Math.min(2,w.lesson+1);if(p.operation==='previous')w.lesson=Math.max(0,w.lesson-1);}
 });
 }catch(e){return avRejected('invalid_arguments',e.message);}
 };
 return {...core,handlers,targets:id=>({...core.targets(id),capabilities:voiceOverCapabilities(ctx.profile),accessibility:copyCanonicalData(ctx.getShared('preferences')?.configuration.accessibility),input:copyCanonicalData(ctx.getShared('input')),voices:ctx.getView?.(id)?.voices?.()??[]})};
}

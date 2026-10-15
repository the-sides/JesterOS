import {object,choice,flag,defineCommand} from './command-schema.js';
import {AUDIO_VOICE_PROFILES,avId,avText,avInt,avNullable} from './audio-midi-state.js';
import {VOICEOVER_CATEGORIES,voiceOverSettingsSchema} from './voiceover-state.js';
export const voiceOverTargetSchema=object({windowId:avId});
export const voiceOverCommandSpecs={
 'app.quit':object(),
 category:object({category:choice(...VOICEOVER_CATEGORIES)}),settings:voiceOverSettingsSchema,search:object({text:avText(128)}),sheet:object({sheet:choice('none','training','help'),menu:avNullable(avText(64))},[]),text:object({text:avText(4096)}),auxiliary:object({keyboard:flag,viewer:flag,shift:flag,option:flag},[]),key:object({keyId:avText(64,1)}),read:object({operation:choice('read','stop')}),training:object({operation:choice('next','previous','restart','practice'),action:choice('next','read','activate')},['operation']),navigate:object({operation:choice('next','previous','activate','read')}),focus:object({controlId:avText(128,1)}),'window.close':object()
};
export const voiceOverCatalog=Object.fromEntries(Object.entries(voiceOverCommandSpecs).map(([suffix,schema])=>defineCommand(AUDIO_VOICE_PROFILES,`voiceover.${suffix}`,'voiceover.local',voiceOverTargetSchema,schema,['Original mounted VoiceOver utility','Original shared accessibility and input'],['Actual local controls, keyboard, captions, zoom and browser-local speech'],['Utility sessions or authoritative accessibility preferences'])));

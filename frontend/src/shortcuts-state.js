import {createAutomatorState,automatorSchema,validateAutomatorState,automatorSession,projectAutomatorState,rehydrateAutomatorState} from './automator-state.js';

// Documents belong to Shortcuts, while the portable action language is shared.
export const shortcutsSchema=automatorSchema;
export const shortcutsSession=automatorSession;
export const validateShortcutsState=validateAutomatorState;
export const projectShortcutsState=projectAutomatorState;
export const rehydrateShortcutsState=rehydrateAutomatorState;
export function createShortcutsState(profile,options={}){return createAutomatorState(profile,options);}
export function shortcutsAvailability(profile){
 const id=typeof profile==='string'?profile:profile.id,old=/high-sierra|mojave/u.test(id),windows=id.startsWith('windows11'),gold=id.includes('golden-gate');
 return {appId:'shortcuts',label:old||windows?'Shortcuts — Local Equivalent':'Shortcuts',native:!old&&!windows&&!gold,qualified:gold,disclosure:old?'Shortcuts arrived on Mac with macOS Monterey, not this release. This local editor uses the existing bounded Automator action engine.':windows?'Apple Shortcuts is not bundled with Windows 11. This local equivalent operates only on scene Files and registered apps.':gold?'Nearest documented macOS 26 interface; macOS 27 native pixels are unverified.':'Local portable workflows; not Apple signed .shortcut files or iCloud automation.'};
}
export function shortcutsWindowMetadata(profile,options={}){return {appId:'shortcuts',title:options.title??shortcutsAvailability(profile).label,width:1000,height:700,minWidth:680,minHeight:440,multipleWindows:true};}

const assert=(value,message)=>{if(!value)throw new Error(message);};
const SETTINGS=['automaticCheck','automaticDownload','installSystem','installApps','securityUpdates'];
// Integration-only consumer regression: actual original Store DOM/controller and
// shared Preferences authority. No mock DOM, substitute host or fabricated policy.
export async function runStorePolicyNativeBrowserRegression({root,facade,storeController,storeState,preferencesState,windowId,flush}){
 assert(root?.isConnected&&facade?.available?.()===true,'Original mounted native Store required.');
 assert(typeof flush==='function'&&storeController?.handlers,'Actual Root flush and Store controller required.');
 const originalSession=storeState.sessions.find(w=>w.windowId===windowId),originalUpdates=preferencesState.configuration.updates,installed=storeState.installedApps,originalInstalled=JSON.stringify(installed);
 assert(originalSession&&originalUpdates,'Original Store session and shared Preferences update authority required.');
 const run=async(sheet)=>{const r=await storeController.handlers['store.sheet']({windowId},{sheet});assert(r?.status==='applied','Actual Store sheet command failed: '+JSON.stringify(r));await flush();};
 const checkbox=setting=>root.querySelector(`[data-store-control="system-update-policy-${setting}"]`);
 await run('settings');
 if(storeState.profileId!=='macos-high-sierra-10.13'){
  assert(SETTINGS.every(setting=>!checkbox(setting)),'HS native automatic-update controls must not be backported.');
  assert(storeController.getSystemUpdateSettingsHost(windowId)===null,'Non-HS scene must not expose a native App Store update-policy host.');
  await run('none');return {status:'applied',profileId:storeState.profileId,windowId,nativePolicyApplicable:false};
 }
 const host=storeController.getSystemUpdateSettingsHost(windowId),baseline=Object.fromEntries(SETTINGS.map(setting=>[setting,originalUpdates[setting]]));
 assert(host?.session===originalSession&&host.view===facade&&host.guard()===true,'Actual original settings host required, not a shadow Preferences window.');
 assert(SETTINGS.every(setting=>typeof baseline[setting]==='boolean'),'Original policy flags must be genuine booleans.');
 const storeSnapshot=JSON.stringify(storeState),sessions=storeState.sessions,preferencesSessions=preferencesState.sessions,originalPreferencesSessionCount=preferencesSessions.length;
 for(const setting of SETTINGS){
  const element=checkbox(setting);assert(element&&element.type==='checkbox'&&!element.disabled,'Actual enabled HS checkbox '+setting+' required.');
  assert(element.checked===baseline[setting],'Native '+setting+' must initially render the original shared flag.');
  assert(facade.describe()?.controls.includes('system-update-policy-'+setting),'Original native facade must expose '+setting+'.');
  element.click();await flush();
  assert(originalUpdates[setting]===!baseline[setting],'Native '+setting+' click must change actual shared Preferences policy.');
  assert(checkbox(setting)?.checked===originalUpdates[setting],'Actual '+setting+' checkbox must observe its acknowledged policy.');
  assert(preferencesState.configuration.updates===originalUpdates,'Policy commit must retain original update authority.');
  assert(storeState.sessions===sessions&&storeState.sessions.find(w=>w.windowId===windowId)===originalSession&&JSON.stringify(storeState)===storeSnapshot,'Policy must not duplicate or mutate Store state.');
  assert(preferencesState.sessions===preferencesSessions&&preferencesSessions.length===originalPreferencesSessionCount,'Policy must not create a shadow Settings session.');
  assert(storeController.getSystemUpdateSettingsHost(windowId)===host&&host.guard()===true,'Preferences policy changes must not retire the original Store-only host.');
  checkbox(setting).click();await flush();assert(originalUpdates[setting]===baseline[setting],'Native checkbox must restore original '+setting+' policy.');
 }
 assert(storeState.installedApps===installed&&JSON.stringify(installed)===originalInstalled,'System policy must preserve actual installed local app registry.');
 await run('none');assert(storeController.getSystemUpdateSettingsHost(windowId)===null,'Closing actual Preferences sheet must retire its settings host.');
 return {status:'applied',profileId:storeState.profileId,windowId,nativePolicyApplicable:true,behaviors:['five-native-shared-policy-checkboxes','real-preferences-authority','original-store-host','no-shadow-settings-session','no-store-policy-copy','registry-preservation']};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { canonicalStringUnits, copyCanonicalData } from '../frontend/src/canonical-data.js';
import { createStoreState, validateStoreState, storeSchema, storeSchemaValid, STORE_PROFILES, storeSession, storeInstalled, storeInstalledDescriptors, storeCapabilities, storeVisiblePackages } from '../frontend/src/store-state.js';
import { createStoreCommands } from '../frontend/src/store-commands.js';
import { storeMenus } from '../frontend/src/store-menus.js';
import { createStoreScreenshotState } from '../frontend/src/store-screenshots.js';
import { createCalculatorState, calculatorWindow, calculatorDisplay, calculatorWindowMetadata, validateCalculatorState } from '../frontend/src/calculator-state.js';
import { createCalculatorCommands } from '../frontend/src/calculator-commands.js';
import { storeSystemUpdatePresentation, storeSystemUpdateRequest, storeSystemUpdateValue, STORE_SYSTEM_UPDATE_POLICIES, storeSystemUpdatePolicyPresentation, storeSystemUpdatePolicyRequest } from '../frontend/src/store-system-update.js';
import { createPreferencesState, validatePreferencesState } from '../frontend/src/preferences-state.js';
import { createPreferencesCommands } from '../frontend/src/preferences-commands.js';
import { preferencesUpdateManifests, decodeSceneUpdate } from '../frontend/src/preferences-effects.js';

function fixture(profileId = STORE_PROFILES[1]) {
  const profile = getOSProfile(profileId), state = createStoreState(profile, { sceneTime: 1698742800000 }), calculator = createCalculatorState(profile, { sceneTime: 1698742800000 });
  const windows = new Map(), views = new Map(), clipboard = { text: '' };
  let clock = 1698742800000, maxUnits = 4 * 1024 * 1024, nextWindow = 1, retained = state;
  const scene = () => ({ store: state, calculator, clipboard, windows: [...windows.values()] });
  const units = () => canonicalStringUnits(scene());
  const canCommit = delta => Number.isSafeInteger(delta) && units() + delta <= maxUnits;
  const registry = () => [...Object.values(profile.applications), ...storeInstalledDescriptors(state, profile)];
  const common = { profile, alive: () => true, getWindow: id => windows.get(id) ?? null, getView: id => views.get(id) ?? null, available: original => windows.get(original.id) === original, getSceneTime: () => clock, canCommit };
  const calcContext = { ...common, getState: () => calculator, ownsApp: (original, domain) => domain === 'calculator' && windows.get(original.id) === original && (original.appId === 'calculator' || registry().some(row => row.id === original.appId && row.domainAppId === domain)) };
  const calcController = createCalculatorCommands(calculator, calcContext);
  const context = { ...common, namespace: 'store', getState: () => retained,
    createWindow: (appId, options) => {
      if (options.isCurrent?.() !== true) return null;
      const registration = registry().find(row => row.id === appId);
      if (!registration || registration.domainAppId !== 'calculator' && appId !== 'calculator') return null;
      const original = { id: `root-window-${nextWindow++}`, ...calculatorWindowMetadata(profile, { appId, mode: options.mode }) };
      windows.set(original.id, original);
      if (!calcController.windowOpened(original, options)) { windows.delete(original.id); return null; }
      if (options.onCommit && options.onCommit({ windowId: original.id }) !== true) throw new Error('Root acknowledgement rejected after a real window commit.');
      return original.id;
    },
    setClipboard: async (spec, ownership) => { if (ownership.guard() !== true) return { status: 'rejected', error: { code: 'stale_target', message: 'retired' } }; clipboard.text = spec.text; return { status: 'applied' }; },
  };
  const controller = createStoreCommands(state, context), originalWindow = { id: 'store-window', appId: storeCapabilities(profile).appId };
  windows.set(originalWindow.id, originalWindow);
  assert.equal(controller.windowOpened(originalWindow, {}), true);
  const originalView = { available: () => windows.get(originalWindow.id) === originalWindow && views.get(originalWindow.id) === originalView };
  views.set(originalWindow.id, originalView);
  const run = (name, payload = {}, windowId = originalWindow.id) => controller.handlers[`store.${name}`]({ windowId }, payload);
  const finish = async id => { const results = []; for (let i = 0; i < 4; i++) results.push(await run('process', { downloadId: id })); return results; };
  const install = async (packageId = 'trail-calculator') => { assert.equal((await run('signIn', { name: 'Local Consumer' })).status, 'applied'); assert.equal((await run('get', { packageId })).status, 'applied'); const queued = await run('install', { packageId }); assert.equal(queued.status, 'applied'); const stages = await finish(queued.downloadId); stages.forEach(result => assert.equal(result.status, 'applied')); return queued; };
  return { profile, state, calculator, controller, calcController, calcContext, context, windows, views, originalWindow, originalView, clipboard, registry, run, finish, install, units, setCap: value => maxUnits = value, setClock: value => clock = value, replaceState: value => retained = value };
}

for (const profileId of STORE_PROFILES) {
  test(`${profileId}: Get requires fictional sign-in; completion registers a distinct actual app whose Calculator controller computes`, async () => {
    const f = fixture(profileId), arrays = [f.state.installedApps, f.state.purchased, f.state.downloads, f.state.sessions, f.state.reviews], session = storeSession(f.state, 'store-window');
    const get = await f.run('get', { packageId: 'trail-calculator' });
    assert.equal(get.requiresSignIn, true); assert.equal(session.sheet, 'signin');
    assert.equal((await f.run('install', { packageId: 'trail-calculator' })).error.code, 'signed_out');
    assert.deepEqual(f.registry().filter(row => row.source === 'store'), []);
    await f.run('signIn', { name: 'Mira Local' }); await f.run('get', { packageId: 'trail-calculator' }); assert.equal(session.sheet, 'install');
    const queued = await f.run('install', { packageId: 'trail-calculator' }), download = f.state.downloads[0];
    assert.equal(queued.status, 'applied'); assert.equal(f.state.installedApps.length, 0); assert.equal(f.state.purchased.length, 0);
    for (const progress of [25, 65, 90]) { const result = await f.run('process', { downloadId: queued.downloadId }); assert.equal(result.progress, progress); assert.equal(f.state.installedApps.length, 0); assert.equal(f.state.purchased.length, 0); assert.equal(f.state.downloads[0], download); }
    const complete = await f.run('process', { downloadId: queued.downloadId });
    assert.equal(complete.installedAppId, 'local-calculator'); assert.equal(download.status, 'complete'); assert.equal(f.state.purchased.length, 1);
    arrays.forEach((array, i) => assert.equal(array, [f.state.installedApps, f.state.purchased, f.state.downloads, f.state.sessions, f.state.reviews][i])); assert.equal(storeSession(f.state,'store-window'),session);
    const registration = f.registry().find(row => row.id === 'local-calculator');
    assert.equal(registration.appId, 'local-calculator'); assert.equal(registration.domainAppId, 'calculator'); assert.equal(registration.launchOptions.mode, 'basic');
    assert.equal(f.profile.applications['local-calculator'], undefined);
    const opened = await f.run('openInstalled', { packageId: 'trail-calculator' }), root = f.windows.get(opened.windowId), actual = calculatorWindow(f.calculator, opened.windowId);
    assert.equal(opened.status, 'applied'); assert.equal(root.appId, 'local-calculator'); assert.equal(root.title, 'Trail Calculator'); assert.equal(actual.appId, root.appId); assert.equal(actual.mode, 'basic');
    await f.calcController.handlers['calculator.expression']({windowId:root.id},{text:'125+37'}); await f.calcController.handlers['calculator.evaluate']({windowId:root.id},{});
    assert.equal(calculatorDisplay(actual), '162'); assert.equal(actual.tape.at(-1).expression, '125+37'); assert.equal(validateCalculatorState(f.calculator,f.profile).ok,true);
  });
  test(`${profileId}: updating actual metadata changes new window behavior, cancellation preserves the original installed release`, async () => {
    const f = fixture(profileId); await f.install(); const original = storeInstalled(f.state,'trail-calculator'), collection = f.state.installedApps;
    const basic = await f.run('openInstalled',{packageId:'trail-calculator'}), existing = calculatorWindow(f.calculator,basic.windowId);
    const queued = await f.run('update',{packageId:'trail-calculator'}); await f.run('process',{downloadId:queued.downloadId});
    assert.equal((await f.run('cancel',{downloadId:queued.downloadId})).status,'applied'); assert.equal(original.version,'1.0.0'); assert.equal(f.registry().find(row=>row.id==='local-calculator').launchOptions.mode,'basic');
    assert.equal((await f.run('process',{downloadId:queued.downloadId})).error.code,'disabled');
    const update = await f.run('update',{packageId:'trail-calculator'}); const result = await f.finish(update.downloadId);
    assert.equal(result.at(-1).registryChanged,true); assert.equal(f.state.installedApps,collection); assert.equal(storeInstalled(f.state,'trail-calculator'),original); assert.equal(original.version,'1.1.0'); assert.equal(f.state.purchased.length,1); assert.equal(existing.mode,'basic');
    const opened = await f.run('openInstalled',{packageId:'trail-calculator'}), actual = calculatorWindow(f.calculator,opened.windowId);
    assert.equal(actual.mode,'scientific'); assert.equal(f.windows.get(opened.windowId).appId,'local-calculator');
    await f.calcController.handlers['calculator.expression']({windowId:opened.windowId},{text:'sqrt(81)'}); await f.calcController.handlers['calculator.evaluate']({windowId:opened.windowId},{}); assert.equal(calculatorDisplay(actual),'9');
    assert.equal((await f.run('update',{packageId:'trail-calculator'})).error.code,'up_to_date');
  });
}

test('paused/cancelled starter installation never creates registry or purchased rows; retry has a new exact identity', async () => {
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); const first=await f.run('install',{packageId:'radix-lab'}),original=f.state.downloads[0];
  await f.run('process',{downloadId:first.downloadId}); assert.equal((await f.run('pause',{downloadId:first.downloadId})).status,'applied');
  assert.equal((await f.run('process',{downloadId:first.downloadId})).error.code,'disabled'); assert.equal(original.progress,25);
  await f.run('resume',{downloadId:first.downloadId}); await f.run('process',{downloadId:first.downloadId}); await f.run('cancel',{downloadId:first.downloadId});
  assert.equal(original.status,'cancelled'); assert.equal(f.state.installedApps.length,0); assert.equal(f.state.purchased.length,0);
  const retry=await f.run('install',{packageId:'radix-lab'}); assert.notEqual(retry.downloadId,first.downloadId); await f.finish(retry.downloadId); assert.equal(f.state.downloads[0],original);
  const opened=await f.run('openInstalled',{packageId:'radix-lab'}),session=calculatorWindow(f.calculator,opened.windowId); assert.equal(session.appId,'local-radix-lab'); assert.equal(session.mode,'programmer');
  await f.calcController.handlers['calculator.expression']({windowId:opened.windowId},{text:'255'}); await f.calcController.handlers['calculator.evaluate']({windowId:opened.windowId},{}); await f.calcController.handlers['calculator.settings']({windowId:opened.windowId},{base:16}); assert.equal(calculatorDisplay(session),'FF');
});

test('final installation quota rejection is atomic across registry, acquisition, progress, counters, and stable collection identities', async () => {
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); const queued=await f.run('install',{packageId:'trail-calculator'});
  for(let i=0;i<3;i++)await f.run('process',{downloadId:queued.downloadId});
  const original=f.state.downloads[0],downloadArray=f.state.downloads,installedArray=f.state.installedApps,purchasedArray=f.state.purchased,before=JSON.stringify(f.state);
  f.setCap(f.units()); assert.equal((await f.run('process',{downloadId:queued.downloadId})).error.code,'limit_exceeded');
  assert.equal(JSON.stringify(f.state),before); assert.equal(original.phase,3); assert.equal(f.state.downloads,downloadArray); assert.equal(f.state.installedApps,installedArray); assert.equal(f.state.purchased,purchasedArray); assert.equal(f.registry().some(row=>row.id==='local-calculator'),false);
  f.setCap(4*1024*1024); assert.equal((await f.run('process',{downloadId:queued.downloadId})).status,'applied'); assert.equal(f.state.installedApps.length,1);
});

test('signed full-scene accounting permits cancellation shrinkage but rejects review growth without changing its original draft', async () => {
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); const queued=await f.run('install',{packageId:'radix-lab'}); await f.run('process',{downloadId:queued.downloadId});
  const before=f.units(),deltas=[],base=f.context.canCommit; f.context.canCommit=delta=>{deltas.push(delta);return base(delta);}; f.setCap(before-1);
  assert.equal((await f.run('cancel',{downloadId:queued.downloadId})).status,'applied'); assert(deltas.at(-1)<0); assert(f.units()<before);
  f.setCap(4*1024*1024); await f.install(); await f.run('details',{packageId:'trail-calculator'}); await f.run('sheet',{sheet:'review'}); const draft=storeSession(f.state,'store-window').reviewDraft,signature=JSON.stringify(f.state);
  f.setCap(f.units()+8); assert.equal((await f.run('reviewDraft',{draft:{rating:5,title:'A useful local calculator',body:'A'.repeat(1024)}})).error.code,'limit_exceeded'); assert.equal(JSON.stringify(f.state),signature); assert.equal(storeSession(f.state,'store-window').reviewDraft,draft);
});

test('reentrant cancellation at the final signed-budget boundary wins; original download remains cancelled with no fake completed install', async () => {
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); const queued=await f.run('install',{packageId:'trail-calculator'}); for(let i=0;i<3;i++)await f.run('process',{downloadId:queued.downloadId});
  const original=f.state.downloads[0],base=f.context.canCommit; let cancellation;
  f.context.canCommit=delta=>{f.context.canCommit=base;cancellation=f.run('cancel',{downloadId:queued.downloadId});return base(delta);};
  const result=await f.run('process',{downloadId:queued.downloadId}); assert.equal((await cancellation).status,'applied'); assert.equal(result.error.code,'stale_target'); assert.equal(f.state.downloads[0],original); assert.equal(original.status,'cancelled'); assert.equal(original.phase,3); assert.equal(f.state.installedApps.length,0); assert.equal(f.state.purchased.length,0);
});

for(const mutation of ['sibling-review','installed-array','window','view','clock','whole-state'])test(`complete original identity guard rejects reentrant ${mutation} replacement despite equal IDs/values`,async()=>{
  const f=fixture(),base=f.context.canCommit,downloads=f.state.downloads; await f.run('signIn',{name:'Local Consumer'});
  f.context.canCommit=delta=>{f.context.canCommit=base;if(mutation==='sibling-review')f.state.reviews[0]={...f.state.reviews[0]};if(mutation==='installed-array')f.state.installedApps=[...f.state.installedApps];if(mutation==='window')f.windows.set('store-window',{...f.originalWindow});if(mutation==='view')f.views.set('store-window',{...f.originalView});if(mutation==='clock')f.setClock(1698742800001);if(mutation==='whole-state')f.replaceState(copyCanonicalData(f.state));return base(delta);};
  const result=await f.run('install',{packageId:'trail-calculator'}); assert.equal(result.error.code,'stale_target'); assert.equal(f.state.downloads,downloads); assert.equal(downloads.length,0); assert.equal(f.state.installedApps.length,0); assert.equal(f.state.purchased.length,0);
});

test('review ownership, edits, menus, sign-out, and reinstall operate on real acquired registry records',async()=>{
  const f=fixture(); assert.equal((await f.run('details',{packageId:'trail-calculator'})).status,'applied'); assert.equal((await f.run('sheet',{sheet:'review'})).error.code,'not_acquired'); await f.install(); await f.run('details',{packageId:'trail-calculator'});
  const open=storeMenus(f.profile,f.state,'store-window').find(group=>group.id==='store').items.find(item=>item.id==='open-installed'); const launched=await f.controller.handlers[open.request.command](open.request.target,open.request.payload); assert.equal(f.windows.get(launched.windowId).appId,'local-calculator');
  await f.run('sheet',{sheet:'review'}); await f.run('reviewDraft',{draft:{rating:4,title:'Real arithmetic',body:'I calculated 125 + 37 in the installed local app and retained the tape.'}}); const submitted=await f.run('reviewSubmit'),original=f.state.reviews.find(row=>row.id===submitted.reviewId),reviews=f.state.reviews;
  await f.run('sheet',{sheet:'review'}); await f.run('reviewDraft',{draft:{rating:5,title:'Still useful',body:'The actual local calculation is saved in the Calculator tape.'}}); await f.run('reviewSubmit'); assert.equal(f.state.reviews,reviews); assert.equal(f.state.reviews.find(row=>row.id===original.id),original); assert.equal(original.rating,5);
  const acquired=f.state.purchased[0]; await f.run('uninstall',{packageId:'trail-calculator',confirmed:true}); assert.equal(f.registry().some(row=>row.id==='local-calculator'),false); assert.equal(f.state.purchased[0],acquired); assert.equal(f.state.reviews.find(row=>row.id===original.id),original);
  const queued=await f.run('install',{packageId:'trail-calculator'}); assert.equal(queued.targetVersion,'1.1.0'); await f.finish(queued.downloadId); assert.equal(f.registry().find(row=>row.id==='local-calculator').launchOptions.mode,'scientific');
  const updating=await f.run('install',{packageId:'radix-lab'}); await f.run('signOut'); assert.equal(f.state.downloads.find(row=>row.id===updating.downloadId).status,'cancelled'); assert.equal(storeInstalled(f.state,'trail-calculator').version,'1.1.0');
  assert.equal((await f.run('sheet',{sheet:'account'})).status,'applied'); assert.equal(storeSession(f.state,'store-window').sheet,'signin');
  assert.equal((await f.run('navigate',{section:'purchased'})).error.code,'unsupported_era');
  await f.run('signIn',{name:'Different Local Label'}); assert.equal(original.author,'Different Local Label · local review'); assert.equal(f.state.purchased[0],acquired);
});

test('search, category, detail/story history and native-era menus are functional without introducing modern backports',async()=>{
  const f=fixture(); await f.run('search',{query:'radix programmer'}); assert.deepEqual(storeVisiblePackages(f.state,'store-window').map(row=>row.id),['radix-lab']); await f.run('details',{packageId:'radix-lab'}); await f.run('screenshot',{index:1}); assert.equal(storeSession(f.state,'store-window').screenshotIndex,1); await f.run('back'); assert.equal(storeSession(f.state,'store-window').query,'radix programmer'); await f.run('forward'); assert.equal(storeSession(f.state,'store-window').packageId,'radix-lab');
  await f.run('navigate',{section:'categories',category:'Games'}); assert.deepEqual(storeVisiblePackages(f.state,'store-window'),[]); await f.run('story',{storyId:'create-scale'}); assert.equal(storeSession(f.state,'store-window').screen,'story'); await f.run('back'); assert.equal(storeSession(f.state,'store-window').category,'Games');
  assert.equal((await f.run('navigate',{section:'arcade'})).error.code,'unsupported_era'); assert.equal((await f.run('navigate',{section:'featured'})).error.code,'unsupported_era');
  const hs=fixture(STORE_PROFILES[0]); await hs.run('navigate',{section:'topcharts'}); const rows=storeVisiblePackages(hs.state,'store-window'); assert.equal(rows[0].id,'trail-calculator'); assert.equal((await hs.run('navigate',{section:'discover'})).error.code,'unsupported_era');
});

test('closed saved JSON and command schemas prevent accessor execution, injected executable identities, corrupted phases, and counter collisions',async()=>{
  let reads=0; const getter=createStoreState(STORE_PROFILES[0]); Object.defineProperty(getter.account,'name',{enumerable:true,get(){reads++;return 'credential';}}); assert.equal(storeSchemaValid(getter,storeSchema),false); assert.equal(reads,0);
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); assert.equal((await f.run('install',{packageId:'trail-calculator',appId:'host-installer'})).error.code,'invalid_arguments'); assert.equal((await f.run('install',{packageId:'trail-calculator',targetVersion:'9.9.9'})).error.code,'invalid_arguments'); assert.equal(f.state.installedApps.length,0);
  const queued=await f.run('install',{packageId:'trail-calculator'}),corrupt=copyCanonicalData(f.state); corrupt.downloads[0].progress=100; assert.equal(validateStoreState(corrupt,f.profile).ok,false); corrupt.downloads[0].progress=0; corrupt.nextId=1; assert.equal(validateStoreState(corrupt,f.profile).ok,false); assert.equal(f.state.downloads[0].id,queued.downloadId);
  const injected=copyCanonicalData(f.state); injected.sessions[0].query='X'.repeat(513); assert.equal(validateStoreState(injected,f.profile).ok,false); const foreign=copyCanonicalData(f.state); Object.setPrototypeOf(foreign.account,{signedIn:true}); assert.equal(validateStoreState(foreign,f.profile).ok,false);
  const foreignArray=copyCanonicalData(f.state); Object.setPrototypeOf(foreignArray.downloads,{}); assert.equal(validateStoreState(foreignArray,f.profile).ok,false);
  const wrongStarter=copyCanonicalData(f.state); wrongStarter.downloads[0].targetVersion='1.1.0'; assert.equal(validateStoreState(wrongStarter,f.profile).ok,false);
  await f.finish(queued.downloadId); const orphanHistory=copyCanonicalData(f.state); orphanHistory.installedApps.splice(0); orphanHistory.purchased.splice(0); assert.equal(validateStoreState(orphanHistory,f.profile).ok,false);
});

test('committed registration stays applied when presentation retires; acknowledged native launch preserves real target identity after source closure',async()=>{
  const f=fixture(); await f.run('signIn',{name:'Local Consumer'}); const queued=await f.run('install',{packageId:'trail-calculator'}); for(let i=0;i<3;i++)await f.run('process',{downloadId:queued.downloadId});
  f.context.available=original=>{if(original===f.originalWindow){f.windows.delete(original.id);return false;}return f.windows.get(original.id)===original;}; const completed=await f.run('process',{downloadId:queued.downloadId}); assert.equal(completed.status,'applied'); assert.equal(completed.presentationAvailable,false); assert.equal(storeInstalled(f.state,'trail-calculator').id,'local-calculator');
  const g=fixture(); await g.install(); const create=g.context.createWindow; g.context.createWindow=(...args)=>{const id=create(...args);g.windows.delete(g.originalWindow.id);return id;}; const opened=await g.run('openInstalled',{packageId:'trail-calculator'}); assert.equal(opened.status,'applied'); assert.equal(g.windows.get(opened.windowId).appId,'local-calculator'); assert.equal(calculatorWindow(g.calculator,opened.windowId).mode,'basic');
});

test('authored screenshot source uses actual shared calculator arithmetic and the actual Store Root ID, never invented numerical results',()=>{
  for(const profileId of STORE_PROFILES){const profile=getOSProfile(profileId);for(const [packageId,index,display]of [['trail-calculator',0,'162'],['trail-calculator',1,'81'],['radix-lab',0,'FF'],['radix-lab',1,'F']]){const source=createStoreScreenshotState(packageId,index,profile,'actual-store-root-id',1698742800000),session=calculatorWindow(source.state,'actual-store-root-id');assert.equal(calculatorDisplay(session),display);assert.equal(validateCalculatorState(source.state,profile).ok,true);assert.equal(session.appId,packageId==='radix-lab'?'local-radix-lab':'local-calculator');}}
});

test('independent actual Store windows retain their own navigation and original sessions while sharing the real registry; close/quit/dispose cannot resurrect sessions',async()=>{
  const f=fixture(),second={id:'second-store-root',appId:storeCapabilities(f.profile).appId},options={packageId:'radix-lab'};
  f.windows.set(second.id,second); assert.equal(f.controller.windowOpened(second,options),true); const firstSession=storeSession(f.state,f.originalWindow.id),secondSession=storeSession(f.state,second.id),sessions=f.state.sessions;
  await f.run('search',{query:'Trail'},f.originalWindow.id); assert.equal(secondSession.packageId,'radix-lab'); assert.equal(secondSession.query,''); assert.equal(firstSession.query,'Trail');
  await f.install(); assert.equal(storeInstalledDescriptors(f.state,f.profile)[0].appId,'local-calculator'); assert.equal(storeSession(f.state,second.id),secondSession);
  assert.equal(f.controller.windowClosed({...second}),false); assert.equal(storeSession(f.state,second.id),secondSession);
  assert.equal(f.controller.windowClosed(second),true); assert.equal(f.state.sessions,sessions); assert.equal(storeSession(f.state,second.id),null); assert.equal(storeSession(f.state,f.originalWindow.id),firstSession); assert.equal(f.state.installedApps.length,1);
  assert.equal(f.controller.appQuit(storeCapabilities(f.profile).appId),true); assert.equal(f.state.sessions,sessions); assert.equal(sessions.length,0); assert.equal(f.state.installedApps.length,1);
  f.controller.dispose(); assert.equal(f.controller.windowOpened(second,options),false); assert.equal((await f.run('signIn',{name:'Retired owner'})).status,'rejected'); assert.equal(f.state.installedApps.length,1);
});

// Actual Store owner -> actual shared Preferences handler -> genuine prepared
// JSON Files record -> paired canonical settings/restart publication.
function systemUpdateFixture() {
  const f = fixture(STORE_PROFILES[0]), preferences = createPreferencesState(f.profile, { sceneTime: f.context.getSceneTime() });
  const files = [], power = { restartCount: 0 }, progress = [];
  let pending = 0, fileId = 1, limit = 4 * 1024 * 1024;
  const scene = () => ({ store: f.state, calculator: f.calculator, preferences, files, power, windows: [...f.windows.values()], clipboard: f.clipboard, sceneTime: f.context.getSceneTime() });
  const canCommit = delta => Number.isSafeInteger(delta) && canonicalStringUnits(scene()) + pending + delta <= limit;
  f.context.canCommit = canCommit;
  const context = { ...f.context, getState: () => preferences, getPreferencesUpdateHost: id => f.controller.getSystemUpdateHost(id), getPreferencesUpdateSettingsHost: id => f.controller.getSystemUpdateSettingsHost(id), canCommit, getInventory: () => ({ hardware: {} }),
    getFile: id => files.find(file => file.id === id) ?? null,
    tick: async () => { progress.push({ original: preferences.configuration.updates, value: preferences.configuration.updates.progress }); },
    createFile: async (spec, ownership) => {
      if (ownership.guard() !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      const before = JSON.stringify(files), originals = [...files];
      const file = { id: `shared-update-${fileId++}`, revision: 1, name: spec.name, mime: spec.mime, content: spec.content, parentId: spec.parentId };
      const delta = canonicalStringUnits([...files, file]) - canonicalStringUnits(files), allowed = context.canCommit(delta + spec.reserveTextUnits) === true;
      if (ownership.guard() !== true || JSON.stringify(files) !== before || !originals.every((original, i) => files[i] === original)) return { status: 'rejected', error: { code: 'stale_target' } };
      if (!allowed) return { status: 'rejected', error: { code: 'limit_exceeded' } };
      let committed;
      pending = delta;
      try { committed = spec.onCommit(file.id, file, { content: file.content, mime: file.mime, revision: file.revision }) === true; }
      finally { pending = 0; }
      if (!committed) return { status: 'rejected', error: { code: 'atomic_rejected' } };
      files.push(file);
      return { status: 'applied', fileId: file.id };
    },
    readFile: async (spec, ownership) => {
      const file = files.find(row => row.id === spec.fileId);
      return file && spec.guard() === true && ownership.guard() === true ? { status: 'applied', file, text: file.content } : { status: 'rejected', error: { code: 'stale_target' } };
    },
    effectPreferences: async (spec, ownership) => {
      if (spec.actionId !== 'update.install' || spec.source.appId !== 'appstore' || spec.source.windowId !== f.originalWindow.id || ownership.guard() !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      const oldPower = JSON.stringify(power), candidate = { restartCount: power.restartCount + 1 };
      const delta = canonicalStringUnits(candidate) - canonicalStringUnits(power) + canonicalStringUnits([...f.windows.values()].filter(window => window !== f.originalWindow)) - canonicalStringUnits([...f.windows.values()]);
      const allowed = context.canCommit(delta + ownership.reserveTextUnits) === true;
      if (ownership.guard() !== true || JSON.stringify(power) !== oldPower) return { status: 'rejected', error: { code: 'stale_target' } };
      if (!allowed) return { status: 'rejected', error: { code: 'limit_exceeded' } };
      let committed;
      pending = delta;
      try { committed = ownership.onCommit() === true; }
      finally { pending = 0; }
      if (!committed) return { status: 'rejected', error: { code: 'atomic_rejected' } };
      assert.equal(f.controller.windowClosed(f.originalWindow), true);
      f.windows.delete(f.originalWindow.id); f.views.delete(f.originalWindow.id);
      power.restartCount = candidate.restartCount;
      return { status: 'applied' };
    },
  };
  const controller = createPreferencesCommands(preferences, context);
  const manifest = preferencesUpdateManifests(f.profile)[0];
  const actions = ['check', 'download', 'install'].map(operation => ({ id: operation, label: operation, enabled: true, request: { command: 'preferences.systemUpdate', target: { windowId: f.originalWindow.id }, payload: { operation } } }));
  const presentation = () => storeSystemUpdatePresentation({ profile: f.profile, windowId: f.originalWindow.id, session: storeSession(f.state, f.originalWindow.id), systemUpdate: preferences.configuration.updates, systemUpdateManifest: manifest, systemUpdateActions: actions });
  const execute = action => controller.handlers[action.request.command](action.request.target, action.request.payload);
  return { ...f, preferences, files, power, progress, preferencesContext: context, preferencesController: controller, manifest, actions, presentation, execute, setSystemCap: value => limit = value };
}

test('HS Updates forwards exact shared requests, preserves original progress, confirms typed settings and commits Files/settings/restart without a shadow Settings session', async () => {
  const f = systemUpdateFixture(), source = storeSession(f.state, f.originalWindow.id), updates = f.preferences.configuration.updates, profileId = f.profile.id;
  assert.equal(f.controller.getSystemUpdateHost(f.originalWindow.id), null);
  await f.run('navigate', { section: 'updates' });
  const host = f.controller.getSystemUpdateHost(f.originalWindow.id);
  assert(Object.isFrozen(host)); assert.equal(host, f.controller.getSystemUpdateHost(f.originalWindow.id)); assert.equal(host.session, source); assert.equal(host.window, f.originalWindow); assert.equal(host.view, f.originalView);
  assert.equal(f.presentation().updates, updates); assert.equal(f.presentation().manifest, f.manifest); assert.equal(f.presentation().actions[0], f.actions[0]); assert.equal(storeSystemUpdateRequest(f.presentation(), f.actions[0]), f.actions[0].request);
  assert.equal((await f.execute(f.actions[0])).status, 'applied'); assert.equal(updates.status, 'available'); assert.equal(f.preferences.sessions.length, 0); assert.equal(f.state.account.signedIn, false); assert.equal(host.guard(), true);
  assert.equal((await f.execute(f.actions[1])).status, 'applied'); assert.equal(updates.status, 'ready'); assert.equal(updates.progress, 100); assert(f.progress.length > 1); assert(f.progress.some(row => row.value > 0 && row.value < 100)); assert(f.progress.every(row => row.original === updates));
  const file = f.files[0], decoded = decodeSceneUpdate(file.content, f.profile);
  assert.equal(decoded.ok, true); assert.deepEqual(decoded.document.patch, f.manifest.patch); assert.equal(updates.packageFileId, file.id); assert.equal(updates.packageRevision, file.revision);
  assert.equal(storeSystemUpdateRequest(f.presentation(), f.actions[2]), null); assert.equal((await f.execute(f.actions[2])).error.code, 'confirmation_required');
  assert.equal((await f.run('sheet', { sheet: 'system-update' })).status, 'applied'); assert.equal(source.sheet, 'system-update'); assert.equal(host.guard(), false);
  assert.equal(storeSystemUpdateRequest(f.presentation(), f.actions[2], true), f.actions[2].request);
  const result = await f.execute(f.actions[2]);
  assert.equal(result.status, 'applied'); assert.equal(f.power.restartCount, 1); assert.equal(f.preferences.configuration.updates, updates); assert.equal(updates.status, 'current'); assert.deepEqual(updates.installedIds, [f.manifest.id]); assert.equal(f.preferences.configuration.accessibility.reduceMotion, true); assert.equal(f.preferences.configuration.general.scrollbars, 'always'); assert.equal(f.profile.id, profileId); assert.equal(f.files[0], file);
  assert.equal(f.state.account.signedIn, false); assert.equal(f.state.installedApps.length, 0); assert.equal(f.state.purchased.length, 0); assert.equal(f.preferences.sessions.length, 0); assert.equal(f.windows.has(f.originalWindow.id), false); assert.equal(f.controller.getSystemUpdateHost(f.originalWindow.id), null); assert.equal(validatePreferencesState(f.preferences, f.profile).ok, true);
});

test('HS shared update budget reentrancy rejects a same-value sibling Store replacement without publishing Preferences status', async () => {
  const f = systemUpdateFixture(); await f.run('navigate', { section: 'updates' });
  const host = f.controller.getSystemUpdateHost(f.originalWindow.id), before = JSON.stringify(f.preferences), budget = f.preferencesContext.canCommit;
  f.preferencesContext.canCommit = delta => { f.preferencesContext.canCommit = budget; f.state.reviews[0] = { ...f.state.reviews[0] }; return budget(delta); };
  const result = await f.execute(f.actions[0]);
  assert.equal(result.error.code, 'stale_target'); assert.equal(JSON.stringify(f.preferences), before); assert.equal(host.guard(), false); assert.equal(f.files.length, 0); assert.equal(f.preferences.sessions.length, 0);
});

test('system update confirmation and shared host are High Sierra Updates-only while Update All remains a local package command', async () => {
  for (const profileId of STORE_PROFILES) {
    const f = fixture(profileId);
    await f.run('navigate', { section: storeCapabilities(f.profile).windows ? 'library' : 'updates' });
    const confirmation = await f.run('sheet', { sheet: 'system-update' });
    if (storeCapabilities(f.profile).highSierra) { assert.equal(confirmation.status, 'applied'); assert.equal(f.controller.getSystemUpdateHost(f.originalWindow.id).session.sheet, 'system-update'); }
    else { assert.equal(confirmation.error.code, 'unsupported'); assert.equal(f.controller.getSystemUpdateHost(f.originalWindow.id), null); }
    const action = storeMenus(f.profile, f.state, f.originalWindow.id).find(group => group.id === 'store').items.find(item => item.id === 'update-all');
    assert.equal(action.enabled, false);
    if (storeCapabilities(f.profile).highSierra) assert.equal(action.label, 'Update All Local Apps');
    const view = storeSystemUpdatePresentation({ profile: f.profile, windowId: f.originalWindow.id, session: storeSession(f.state, f.originalWindow.id), systemUpdate: null, systemUpdateManifest: null, systemUpdateActions: [] });
    assert.equal(view.available, false); assert.equal(view.visible, storeCapabilities(f.profile).highSierra); assert.deepEqual(view.actions, []);
  }
});

test('Store shared-update consumer refuses foreign targets, injected fields, disabled requests and unconfirmed Apply without synthesizing fallback packets', async () => {
  const f = systemUpdateFixture(); await f.run('navigate', { section: 'updates' });
  const props = { profile: f.profile, windowId: f.originalWindow.id, session: storeSession(f.state, f.originalWindow.id), systemUpdate: f.preferences.configuration.updates, systemUpdateManifest: f.manifest, systemUpdateActions: f.actions };
  assert.equal(storeSystemUpdatePresentation(props).available, true); assert.equal(storeSystemUpdateValue(true), 'On'); assert.equal(storeSystemUpdateValue(false), 'Off'); assert.equal(storeSystemUpdateValue('always'), 'always');
  for (const mutation of ['target', 'command', 'payload']) {
    const actions = copyCanonicalData(f.actions);
    if (mutation === 'target') actions[0].request.target.windowId = 'foreign-window';
    if (mutation === 'command') actions[0].request.command = 'preferences.action';
    if (mutation === 'payload') actions[0].request.payload.status = 'current';
    const view = storeSystemUpdatePresentation({ ...props, systemUpdateActions: actions });
    assert.equal(view.available, false); assert.equal(storeSystemUpdateRequest(view, actions[0]), null);
  }
  f.actions[0].enabled = false;
  assert.equal(storeSystemUpdateRequest(f.presentation(), f.actions[0]), null);
  assert.equal(storeSystemUpdateRequest(f.presentation(), f.actions[2], true), null);
  assert.equal(f.preferences.configuration.updates.status, 'idle'); assert.equal(f.power.restartCount, 0);
});

const policyActions = f => STORE_SYSTEM_UPDATE_POLICIES.map(({ setting, label }) => ({ id: setting, label, enabled: true, request: { command: 'preferences.systemUpdatePolicy', target: { windowId: f.originalWindow.id }, payload: { setting, value: !f.preferences.configuration.updates[setting] } } }));
const policyPresentation = (f, actions) => storeSystemUpdatePolicyPresentation({ profile: f.profile, windowId: f.originalWindow.id, session: storeSession(f.state, f.originalWindow.id), systemUpdate: f.preferences.configuration.updates, systemUpdatePolicyActions: actions });

test('HS Preferences native labels toggle all five SAME original shared policies through the actual original Store settings host without changing local registry', async () => {
  const f = systemUpdateFixture(), updates = f.preferences.configuration.updates, session = storeSession(f.state, f.originalWindow.id);
  assert.equal(f.controller.getSystemUpdateSettingsHost(f.originalWindow.id), null);
  const menu = storeMenus(f.profile, f.state, f.originalWindow.id).find(group => group.id === 'appstore').items.find(item => item.id === 'settings');
  assert.equal(menu.request.command, 'store.sheet'); assert.deepEqual(menu.request.payload, { sheet: 'settings' });
  assert.equal((await f.controller.handlers[menu.request.command](menu.request.target, menu.request.payload)).status, 'applied');
  const host = f.controller.getSystemUpdateSettingsHost(f.originalWindow.id), storeBefore = JSON.stringify(f.state);
  assert(Object.isFrozen(host)); assert.equal(host, f.controller.getSystemUpdateSettingsHost(f.originalWindow.id)); assert.equal(host.session, session); assert.equal(session.section, 'featured'); assert.equal(host.view, f.originalView); assert.equal(f.controller.getSystemUpdateHost(f.originalWindow.id), null);
  assert.deepEqual(STORE_SYSTEM_UPDATE_POLICIES.map(row => row.label), ['Automatically check for updates', 'Download newly available updates in the background', 'Install app updates', 'Install macOS updates', 'Install system data files and security updates']);
  for (const { setting } of STORE_SYSTEM_UPDATE_POLICIES) {
    const actions = policyActions(f), view = policyPresentation(f, actions), action = actions.find(row => row.request.payload.setting === setting), oldValue = updates[setting];
    assert.equal(view.available, true); assert.equal(view.updates, updates); assert.equal(view.actions.find(row => row.id === setting), action);
    const request = storeSystemUpdatePolicyRequest(view, action, !oldValue);
    assert.equal(request, action.request);
    assert.equal((await f.preferencesController.handlers[request.command](request.target, request.payload)).status, 'applied');
    assert.equal(updates[setting], !oldValue); assert.equal(f.preferences.configuration.updates, updates); assert.equal(host.guard(), true); assert.equal(JSON.stringify(f.state), storeBefore); assert.equal(f.preferences.sessions.length, 0);
  }
  assert.deepEqual(Object.keys(f.state.preferences), ['inAppRatings']); assert.equal(f.state.account.signedIn, false); assert.equal(f.state.installedApps.length, 0); assert.equal(f.state.purchased.length, 0); assert.equal(f.power.restartCount, 0); assert.equal(f.files.length, 0);
  await f.run('sheet', { sheet: 'none' }); assert.equal(host.guard(), false); assert.equal(f.controller.getSystemUpdateSettingsHost(f.originalWindow.id), null);
});

test('HS shared policy zero-delta commits still honor complete-scene quota and reentrant same-value Store session identity replacement', async () => {
  const f = systemUpdateFixture(); await f.run('sheet', { sheet: 'settings' });
  const fullUnits = () => canonicalStringUnits({ store: f.state, calculator: f.calculator, preferences: f.preferences, files: f.files, power: f.power, windows: [...f.windows.values()], clipboard: f.clipboard, sceneTime: f.context.getSceneTime() });
  f.setSystemCap(fullUnits());
  let action = policyActions(f).find(row => row.id === 'automaticDownload'), request = action.request;
  assert.equal((await f.preferencesController.handlers[request.command](request.target, request.payload)).status, 'applied'); assert.equal(f.preferences.configuration.updates.automaticDownload, true);
  f.setSystemCap(fullUnits() - 1); const before = JSON.stringify(f.preferences);
  action = policyActions(f).find(row => row.id === 'automaticDownload'); request = action.request;
  assert.equal((await f.preferencesController.handlers[request.command](request.target, request.payload)).error.code, 'limit_exceeded'); assert.equal(JSON.stringify(f.preferences), before);
  f.setSystemCap(4 * 1024 * 1024);
  const host = f.controller.getSystemUpdateSettingsHost(f.originalWindow.id), budget = f.preferencesContext.canCommit;
  f.preferencesContext.canCommit = delta => { f.preferencesContext.canCommit = budget; f.state.sessions[0] = { ...f.state.sessions[0] }; return budget(delta); };
  assert.equal((await f.preferencesController.handlers[request.command](request.target, request.payload)).error.code, 'stale_target'); assert.equal(host.guard(), false); assert.equal(JSON.stringify(f.preferences), before);
});

test('shared policy consumer rejects stale/foreign/injected/disabled checkbox packets without optimistic flag copies or non-HS hosts', async () => {
  const f = systemUpdateFixture(); await f.run('sheet', { sheet: 'settings' });
  const actions = policyActions(f), before = JSON.stringify(f.preferences), original = actions[0];
  assert.equal(storeSystemUpdatePolicyRequest(policyPresentation(f, actions), original, !original.request.payload.value), null);
  original.enabled = false; assert.equal(storeSystemUpdatePolicyRequest(policyPresentation(f, actions), original, original.request.payload.value), null);
  for (const field of ['target', 'setting', 'value', 'extra']) {
    const changed = copyCanonicalData(actions); changed[0].enabled = true;
    if (field === 'target') changed[0].request.target.windowId = 'foreign-window';
    if (field === 'setting') changed[0].request.payload.setting = 'arbitraryPolicy';
    if (field === 'value') changed[0].request.payload.value = String(changed[0].request.payload.value);
    if (field === 'extra') changed[0].request.payload.profileId = f.profile.id;
    assert.equal(policyPresentation(f, changed).available, false); assert.equal(storeSystemUpdatePolicyRequest(policyPresentation(f, changed), changed[0], true), null);
  }
  const invalid = await f.preferencesController.handlers['preferences.systemUpdatePolicy']({ windowId: f.originalWindow.id }, { setting: 'automaticCheck', value: 'false' });
  assert.equal(invalid.error.code, 'invalid_arguments'); assert.equal(JSON.stringify(f.preferences), before);
  for (const profileId of STORE_PROFILES.slice(1)) {
    const other = fixture(profileId); await other.run('sheet', { sheet: 'settings' });
    assert.equal(other.controller.getSystemUpdateSettingsHost(other.originalWindow.id), null);
    assert.equal(storeSystemUpdatePolicyPresentation({ profile: other.profile, windowId: other.originalWindow.id, session: storeSession(other.state, other.originalWindow.id), systemUpdate: f.preferences.configuration.updates, systemUpdatePolicyActions: actions }).visible, false);
  }
});

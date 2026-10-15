<script>
  import { browserActiveTab } from './browser-state.js';
  import { browserSiteURLs } from './browser-pages.js';
  import { chromeProfileMetadata } from './chrome-profile-metadata.js';
  import { chromePreferenceSections, chromeSelectedPreference, chromePreferenceLabels, chromePreferenceChoices } from './chrome-preferences.js';

  let { state: chromePreferencesState, profile, windowId, execute, available = true } = $props();
  const win = $derived(chromePreferencesState.windows.find(row => row.id === windowId));
  const tab = $derived(browserActiveTab(chromePreferencesState, windowId));
  const sections = $derived(chromePreferenceSections(profile));
  const selected = $derived(chromeSelectedPreference(chromePreferencesState, profile, windowId));
  const metadata = $derived(chromeProfileMetadata(profile));
  const classic = $derived(profile.id.includes('high-sierra') || profile.id.includes('mojave'));
  const enabled = $derived(available && !!win && !win.closed);
  const entry = $derived(tab?.entries[tab.index]);
  const permissions = $derived(win?.private ? win.privatePermissions : chromePreferencesState.permissions);
  const currentPermission = $derived(permissions.find(row => row.origin === entry?.url));
  const defaults = { camera: 'ask', microphone: 'ask', location: 'ask', notifications: 'ask', popups: 'deny', reader: false, zoom: 100 };
  const permissionKeys = ['camera', 'microphone', 'location', 'notifications', 'popups', 'reader', 'zoom'];
  const zoomLevels = Array.from({ length: 26 }, (_, index) => 50 + index * 10);
  let error = $state('');
  let requestSequence = 0;

  async function ask(suffix, payload = {}, extraTarget = {}, control = null) {
    if (!enabled) return;
    const owner = chromePreferencesState, ownerWindow = win, sequence = ++requestSequence;
    error = '';
    try {
      const result = await execute(`browser.${suffix}`, { windowId, ...extraTarget }, payload);
      if (owner !== chromePreferencesState || ownerWindow !== win || sequence !== requestSequence) return;
      if (result?.status !== 'applied') {
        error = result?.error?.message ?? 'The canonical browser did not acknowledge this change.';
        if (control && suffix === 'preference.set') {
          if (control.type === 'checkbox') control.checked = chromePreferencesState.settings[payload.key];
          else control.value = chromePreferencesState.settings[payload.key];
        } else if (control && suffix === 'permission') {
          control.value = String(currentPermission?.[payload.key] ?? defaults[payload.key]);
        }
      }
    } catch (failure) {
      if (owner === chromePreferencesState && ownerWindow === win && sequence === requestSequence) error = failure instanceof Error ? failure.message : String(failure);
    }
  }
</script>

<div class="chrome-settings" class:classic data-browser-area="preferences">
  <header class="settings-header"><span class="chrome-mark" aria-hidden="true">●</span><strong>Settings</strong><span class="local-badge">Local browser</span></header>
  <nav aria-label="Chrome settings sections" data-browser-area="sidebar">
    {#each sections as section (section.id)}
      <button type="button" class:selected={selected?.id === section.id} aria-current={selected?.id === section.id ? 'page' : undefined}
        data-browser-control={`prefs-tab:${section.canonicalTab}`} disabled={!enabled}
        onclick={() => ask('preference.tab', { tab: section.canonicalTab })}>{section.label}</button>
    {/each}
  </nav>
  <main data-browser-area="panel">
    {#if error}<p class="commit-error" role="alert">{error}</p>{/if}
    {#if selected}
      <h1>{selected.label}</h1>
      <section class="settings-card" data-browser-area="preferences-pane">
        {#if selected.id === 'people'}
          <h2>{win?.private ? 'Incognito window' : 'This scene’s browsing profile'}</h2>
          <p>One local browser profile shares its settings, bookmarks and ordinary history across Chrome and the scene’s other browser windows. Incognito history is not retained.</p>
          <p>{chromePreferencesState.bookmarks.filter(row => row.kind === 'bookmark').length} bookmarks · {chromePreferencesState.history.length} history visits · {chromePreferencesState.permissions.length} saved site policies</p>
          <p class="note">No Google account is signed in. This local browser does not connect to Google, sync data or manage online accounts.</p>
        {/if}
        {#each selected.keys as key (key)}
          <label class="setting-row">
            <span>{chromePreferenceLabels[key]}</span>
            {#if key === 'homepage'}
              <input type="text" data-browser-control="prefs-homepage" value={chromePreferencesState.settings[key]} maxlength="2048" disabled={!enabled}
                onchange={event => ask('preference.set', { key, value: event.currentTarget.value }, {}, event.currentTarget)} />
            {:else if chromePreferenceChoices[key]}
              <select data-browser-control={`prefs-choice:${key}`} value={chromePreferencesState.settings[key]} disabled={!enabled}
                onchange={event => ask('preference.set', { key, value: event.currentTarget.value }, {}, event.currentTarget)}>
                {#each chromePreferenceChoices[key] as [value, label] (value)}<option {value}>{label}</option>{/each}
              </select>
            {:else}
              <input type="checkbox" class="toggle" role="switch" data-browser-control={`prefs-set:${key}`} checked={chromePreferencesState.settings[key]} disabled={!enabled}
                onchange={event => ask('preference.set', { key, value: event.currentTarget.checked }, {}, event.currentTarget)} />
            {/if}
          </label>
        {/each}
        {#if selected.id === 'autofill' || selected.id === 'passwords'}
          <h2>Saved fictional passwords</h2>
          {#each chromePreferencesState.passwords as row (row.id)}
            <dl class="credential"><dt>Site</dt><dd>{row.origin}</dd><dt>Username</dt><dd>{row.username}</dd><dt>Password</dt><dd><code>{row.password}</code></dd></dl>
          {/each}
          <p class="note">These are actual saved sample credentials in the canonical browser, not real accounts. Contact autofill uses the scene’s contacts; it does not invent a contact when none exists.</p>
        {:else if selected.id === 'search'}
          <p class="note">Both engine labels search the authored local page index. No external search request is made.</p>
        {:else if selected.id === 'startup'}
          <p class="note">Continue uses the last retained ordinary local browser window. Homepage and new-tab choices resolve through the authored local browser; arbitrary internet pages are not fetched.</p>
        {:else if selected.id === 'privacy'}
          <p class="note">These are local browser policies, not internet protection services. The fraudulent-site switch controls the authored warning fixture. Cookie blocking refuses the sample login. Tracking prevention records the local policy; these authored pages contain no external trackers.</p>
          {#if profile.id.startsWith('windows11')}<p class="note">Search engine and suggestions are grouped here to use the existing canonical settings slot. Both engine labels search authored pages only.</p>{/if}
          <button type="button" data-browser-control="prefs-history" disabled={!enabled} onclick={() => ask('panel', { panel: 'history' })}>Open browsing history and clearing controls</button>
        {:else if selected.id === 'sites'}
          <h2>Current tab · {entry?.url ?? 'No open page'}</h2>
          <p class="note">Permissions below apply to the actual current tab’s authored site. Camera, microphone, location and notifications are simulated local decisions; no host device access is requested.</p>
          {#each permissionKeys as key (key)}
            <label class="setting-row"><span>{key === 'reader' ? 'Automatic local Reader' : key === 'zoom' ? 'Page zoom' : key[0].toUpperCase() + key.slice(1)}</span>
              <select value={String(currentPermission?.[key] ?? defaults[key])} data-browser-control={`permission-select:${key}`}
                disabled={!enabled || !tab || !browserSiteURLs.includes(entry?.url)}
                onchange={event => ask('permission', { key, value: key === 'zoom' ? Number(event.currentTarget.value) : key === 'reader' ? event.currentTarget.value === 'true' : event.currentTarget.value }, { tabId: tab?.id }, event.currentTarget)}>
                {#if key === 'zoom'}
                  {#each zoomLevels as level (level)}<option value={String(level)}>{level}%</option>{/each}
                {:else if key === 'reader'}
                  <option value="false">Off</option><option value="true">On for supported articles</option>
                {:else}
                  {#if key !== 'popups'}<option value="ask">Ask</option>{/if}<option value="allow">Allow</option><option value="deny">Block</option>
                {/if}
              </select>
            </label>
          {/each}
          <h2>{win?.private ? 'Incognito site policies' : 'Saved site policies'}</h2>
          {#each permissions as row (row.origin)}
            <div class="site-policy"><strong>{row.origin}</strong><dl>
              {#each permissionKeys as key (key)}<dt>{key}</dt><dd>{String(row[key])}{key === 'zoom' ? '%' : ''}</dd>{/each}
            </dl><button type="button" data-browser-control={`prefs-site:${row.origin}`} disabled={!enabled || !tab}
              onclick={() => ask('navigate', { address: row.origin }, { tabId: tab?.id })}>Open this site</button></div>
          {:else}<p class="note">No saved policies in this window’s permission scope. Unstored sites use Ask, blocked pop-ups, Reader off and 100% zoom.</p>{/each}
        {:else if selected.id === 'downloads'}
          <h2>Local Downloads</h2>
          <p>Completed authored downloads become real files in this scene’s Downloads folder. Open and Reveal use those actual file records.</p>
          <p class="note">There is no host download-folder chooser or external download service.</p>
          <button type="button" data-browser-control="prefs-downloads" disabled={!enabled} onclick={() => ask('panel', { panel: 'downloads' })}>Open downloads</button>
        {:else if selected.id === 'extensions'}
          <p class="note">Studio Contrast is the built-in local extension. The switch changes the contrast of rendered articles immediately. No extension store, downloaded code or online installation is provided.</p>
        {:else if selected.id === 'about'}
          <div class="about-brand"><span class="chrome-mark" aria-hidden="true">●</span><h2>Google Chrome</h2></div>
          <p><strong>{metadata.label}</strong></p><p>Version {metadata.version} · {metadata.era}</p>
          <p class="note">{metadata.qualifier}</p>
          <p class="note">This is a local, independently updated Chrome-era presentation over the scene’s shared browser data. It does not contact an updater or claim to be up to date.</p>
          <button type="button" data-browser-control="prefs-inspector" disabled={!enabled || !chromePreferencesState.settings.develop} onclick={() => ask('panel', { panel: 'inspector' })}>Open local developer tools</button>
          {#if metadata.sources?.length}<details><summary>Version reference sources</summary><ul>{#each metadata.sources as source}<li>{typeof source === 'string' ? source : source.url ?? source.title}</li>{/each}</ul></details>{/if}
        {/if}
      </section>
      <p class="adaptation">Chrome-named local sections map to this installed profile’s existing canonical preference slots. No separate Chrome account or settings database is stored.</p>
    {:else}<p role="status">No canonical settings section is selected.</p>{/if}
  </main>
</div>

<style>
  .chrome-settings { height: 100%; min-height: 0; display: grid; grid-template-columns: 204px minmax(0, 1fr); grid-template-rows: 56px minmax(0, 1fr); background: #f8fafd; color: #202124; font: 13px Arial, sans-serif; }
  .settings-header { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 0 24px; border-bottom: 1px solid #e1e5eb; background: #fff; font-size: 18px; }
  .chrome-mark { color: #4285f4; border: 7px solid #ea4335; border-right-color: #34a853; border-bottom-color: #fbbc05; border-radius: 50%; width: 25px; height: 25px; box-sizing: content-box; display: inline-flex; align-items: center; justify-content: center; font-size: 30px; line-height: 1; }
  .local-badge { margin-left: auto; color: #697077; font-size: 11px; font-weight: normal; }
  nav { padding: 20px 8px 20px 0; overflow: auto; }
  nav button { display: block; width: 100%; text-align: left; border: 0; border-radius: 0 24px 24px 0; background: transparent; padding: 13px 15px 13px 26px; font-size: 12px; color: #444746; }
  nav button.selected { background: #d3e3fd; color: #041e49; font-weight: bold; }
  main { min-width: 0; overflow: auto; padding: 24px 30px 32px; }
  h1 { font-size: 16px; font-weight: 500; margin: 0 0 18px; }
  h2 { font-size: 14px; font-weight: 500; margin: 20px 0 12px; }
  h2:first-child { margin-top: 0; }
  p { line-height: 1.6; }
  .settings-card { background: #fff; border-radius: 12px; padding: 8px 22px 22px; max-width: 780px; }
  .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 22px; min-height: 62px; border-bottom: 1px solid #eceff3; padding: 10px 0; }
  .setting-row span { flex: 1; line-height: 1.5; }
  input[type='text'], select { width: min(260px, 48%); border: 1px solid #dadce0; border-radius: 4px; background: white; color: inherit; padding: 8px; font: inherit; }
  .toggle { appearance: none; width: 30px; height: 16px; border-radius: 12px; background: #9aa0a6; flex: 0 0 30px; position: relative; cursor: pointer; }
  .toggle::after { content: ''; position: absolute; width: 12px; height: 12px; top: 2px; left: 2px; background: white; border-radius: 50%; }
  .toggle:checked { background: #1a73e8; }.toggle:checked::after { left: 16px; }
  button { cursor: pointer; font: inherit; }button:disabled, input:disabled, select:disabled { opacity: .55; cursor: default; }
  button:not(nav button) { border: 1px solid #dadce0; border-radius: 4px; background: #fff; color: #1967d2; padding: 9px 14px; }
  :is(button, input, select):focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
  .note, .adaptation { font-size: 12px; color: #5f6368; line-height: 1.6; }.adaptation { max-width: 780px; }
  dl { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 8px; }dt { color: #5f6368; }dd { margin: 0; overflow-wrap: anywhere; }
  .credential, .site-policy { border-bottom: 1px solid #e8eaed; padding: 12px 0; }
  .about-brand { display: flex; align-items: center; gap: 18px; margin-top: 20px; }.about-brand h2 { font-size: 22px; margin: 0; }
  .commit-error { padding: 12px; border: 1px solid #d93025; color: #b3261e; background: #fce8e6; border-radius: 4px; }
  details { margin-top: 22px; color: #5f6368; font-size: 12px; }li { overflow-wrap: anywhere; margin: 6px 0; }
  .classic { background: #f1f1f1; }.classic .settings-header { background: #3367d6; color: #fff; }.classic .local-badge { color: #e4ecff; }.classic .settings-card { border-radius: 2px; box-shadow: 0 1px 3px #0003; }.classic nav button { border-radius: 0; }.classic nav button.selected { background: transparent; color: #3367d6; border-left: 3px solid #3367d6; padding-left: 23px; }
  @media (max-width: 620px) { .chrome-settings { grid-template-columns: 150px minmax(0, 1fr); }main { padding: 20px 12px; }.settings-card { padding: 8px 12px 18px; }.setting-row { flex-wrap: wrap; gap: 8px; }input[type='text'], select { width: 100%; }.setting-row span { flex-basis: 75%; }nav button { padding-left: 16px; }.classic nav button.selected { padding-left: 13px; } }
</style>

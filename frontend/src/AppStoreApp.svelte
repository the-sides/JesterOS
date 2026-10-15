<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import CalculatorApp from './CalculatorApp.svelte';
  import { storeSession, storeCapabilities, storeVisiblePackages, storeInstalled, storeActiveDownload, storeRating } from './store-state.js';
  import { STORE_PACKAGES, STORE_STORIES, STORE_CATEGORIES, storePackage, storeRelease } from './store-fixtures.js';
  import { storeMenus } from './store-menus.js';
  import { createStoreNativeView } from './store-native-view.js';
  import { createStoreScreenshotState, captureStoreScreenshot } from './store-screenshots.js';
  import { storeSystemUpdatePresentation, storeSystemUpdateRequest, storeSystemUpdateValue, STORE_SYSTEM_UPDATE_POLICIES, storeSystemUpdatePolicyPresentation, storeSystemUpdatePolicyRequest } from './store-system-update.js';
  import './store.css';
  let { state: storeData, profile, windowId, execute, registerView, available = true, active = true, controls = {}, appearance = 'light', systemUpdate = null, systemUpdateManifest = null, systemUpdateActions = [], systemUpdatePolicyActions = [] } = $props();
  let root = $state(null), mounted = $state(false), error = $state(''), menu = $state(''), localName = $state('Harbor Local'), screenshots = $state({});
  let originalRoot, originalState, originalProfile, originalWindowId;
  const cap = $derived(storeCapabilities(profile));
  const session = $derived(storeSession(storeData, windowId));
  const systemUpdateView = $derived(storeSystemUpdatePresentation({ profile, windowId, session, systemUpdate, systemUpdateManifest, systemUpdateActions }));
  const systemInstallAction = $derived(systemUpdateView.actions.find(action => action.request.payload.operation === 'install'));
  const systemUpdatePolicyView = $derived(storeSystemUpdatePolicyPresentation({ profile, windowId, session, systemUpdate, systemUpdatePolicyActions }));
  const packages = $derived(storeVisiblePackages(storeData, windowId));
  const selected = $derived(storePackage(session?.packageId));
  const selectedInstalled = $derived(selected && storeInstalled(storeData, selected.id));
  const story = $derived(STORE_STORIES.find(row => row.id === session?.storyId));
  const menus = $derived(storeMenus(profile, storeData, windowId));
  const updateCount = $derived(storeData.installedApps.filter(row => storePackage(row.packageId)?.latestVersion !== row.version).length);
  const jobs = $derived(storeData.downloads.filter(row => ['queued','downloading','paused'].includes(row.status)));
  const previewStates = $derived(selected ? selected.screenshots.map((_, index) => createStoreScreenshotState(selected.id, index, profile, windowId, storeData.createdAt)) : []);
  const pageStories = $derived(STORE_STORIES.filter(row => session?.section === 'featured' || ['discover','home','apps'].includes(session?.section) ? ['small-adventures','develop-bases'].includes(row.id) : row.section === session?.section));
  const title = $derived(session?.query ? `Results for “${session.query}”` : session?.category ?? sectionLabel(session?.section));
  const sectionIcons = { featured:'★', topcharts:'▤', categories:'▦', purchased:'◆', updates:'⇩', discover:'★', create:'⚒', work:'➤', play:'♧', develop:'⚒', arcade:'♜', home:'⌂', apps:'▦', gaming:'♧', movies:'▣', library:'▥' };
  const phaseLabels = ['Queued local manifest', 'Resolved bundled Calculator runtime', 'Prepared actual application descriptor', 'Ready for atomic registry publication', 'Registered local application'];
  function sectionLabel(section) { return { topcharts:'Top Charts', home:'Home', apps:'Apps', gaming:'Gaming', movies:'Movies & TV', library:'Library', purchased:'Purchased' }[section] ?? (section ? section.charAt(0).toUpperCase() + section.slice(1) : cap.label); }
  function owns() { return mounted && available && storeData === originalState && profile === originalProfile && windowId === originalWindowId && root === originalRoot && root?.isConnected && !root.closest('[hidden],[inert]'); }
  async function command(name, payload = {}) {
    if (!owns()) return null;
    const owner = root, previousSheet = session?.sheet;
    try {
      const result = await execute(`store.${name}`, { windowId }, payload);
      if (owns() && root === owner) {
        error = result?.status === 'rejected' ? result.error?.message ?? 'The local Store operation is unavailable.' : '';
        if (result?.status === 'applied' && previousSheet !== session?.sheet) { await tick(); if (owns()) root.querySelector('.store-sheet input,.store-sheet textarea,.store-sheet button')?.focus({ preventScroll:true }); }
      }
      return result;
    } catch (cause) { if (owns()) error = cause?.message ?? 'The actual local Store operation failed.'; return null; }
  }
  async function systemUpdateAction(action, confirmed = false) {
    if (!owns() || !systemUpdateView.available || !systemUpdateView.actions.includes(action) || action.enabled !== true) return null;
    if (action.request.payload.operation === 'install' && !confirmed) {
      if (systemUpdate.status !== 'ready' || !systemUpdate.packageFileId) return null;
      return command('sheet', { sheet: 'system-update' });
    }
    const request = storeSystemUpdateRequest(systemUpdateView, action, confirmed);
    if (!request) return null;
    const owner = root, sourceSession = session;
    try {
      const result = await execute(request.command, request.target, request.payload);
      if (owns() && root === owner) {
        error = result?.status === 'rejected' ? result.error?.message ?? 'The original shared system-update operation is unavailable.' : '';
        if (result?.status === 'applied' && confirmed && session === sourceSession && session.sheet === 'system-update') await command('sheet', { sheet: 'none' });
      }
      return result;
    } catch (cause) { if (owns() && root === owner) error = cause?.message ?? 'The actual shared system-update operation failed.'; return null; }
  }
  async function systemUpdatePolicyAction(action, node) {
    if (!owns() || !node?.isConnected || !root.contains(node)) return null;
    const owner = root, setting = action.request.payload.setting;
    const request = storeSystemUpdatePolicyRequest(systemUpdatePolicyView, action, node.checked);
    try {
      if (!request) { error = 'The original shared update-policy request is unavailable or changed.'; return null; }
      const result = await execute(request.command, request.target, request.payload);
      if (owns() && root === owner) error = result?.status === 'rejected' ? result.error?.message ?? 'The shared update policy could not be committed.' : '';
      return result;
    } catch (cause) { if (owns() && root === owner) error = cause?.message ?? 'The actual shared update policy failed.'; return null; }
    finally {
      if (owns() && root === owner && node.isConnected && root.contains(node) && typeof systemUpdate?.[setting] === 'boolean') node.checked = systemUpdate[setting];
    }
  }
  async function menuAction(item) { menu = ''; if (!item.enabled || !item.request) return; const { command: name, target, payload } = item.request; try { const result = await execute(name, target, payload); if (owns()) error = result?.status === 'rejected' ? result.error.message : ''; } catch (cause) { if (owns()) error = cause.message; } }
  const dateText = value => new Date(value).toISOString().slice(0,10);
  const reviewField = (key, value) => command('reviewDraft', { draft: { ...session.reviewDraft, [key]: value } });
  const previewExecute = async () => ({ status:'rejected', error:{ code:'preview_readonly', message:'This authored screenshot source is read-only; open the actual installed application to calculate.' } });
  function keydown(event) {
    if (!owns()) return;
    if (session?.sheet !== 'none' && event.key === 'Tab') {
      const sheet = root.querySelector('.store-sheet'), nodes = [...(sheet?.querySelectorAll('button,input,select,textarea,[tabindex="0"]') ?? [])].filter(node => !node.disabled);
      if (nodes.length && (event.shiftKey && event.target === nodes[0] || !event.shiftKey && event.target === nodes.at(-1) || !sheet.contains(event.target))) { event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0]).focus(); }
    }
    if (event.key === 'Escape') { event.preventDefault(); menu = ''; if (session?.sheet !== 'none') command('sheet',{sheet:'none'}); return; }
    if ((cap.windows ? event.ctrlKey : event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase(), action = key === 'f' ? ['focus',{controlId:'search'}] : key === 'n' ? ['window.new',{}] : key === 'w' ? ['window.close',{}] : key === ',' ? ['sheet',{sheet:'settings'}] : key === '[' ? ['back',{}] : key === ']' ? ['forward',{}] : null;
      if (action) { event.preventDefault(); event.stopPropagation(); command(action[0],action[1]); }
    }
  }
  $effect(() => {
    if (!mounted || !available || !session) return;
    const job = storeData.downloads.find(row => ['queued','downloading'].includes(row.status));
    if (!job) return;
    const phase = job.phase, revision = job.revision;
    const timer = setTimeout(() => { if (owns() && storeData.downloads.find(row => row.id === job.id) === job && job.phase === phase && job.revision === revision) command('process',{downloadId:job.id}); }, 420);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    if (!mounted || !selected || session?.screen !== 'details') return;
    const pkg = selected, sources = previewStates, owner = root, signature = `${profile.id}:${pkg.id}`;
    let retired = false;
    tick().then(() => {
      if (retired || !owns() || root !== owner || selected !== pkg) return;
      const captured = {};
      for (const source of sources) {
        const node = root.querySelector(`[data-store-shot-source="${source.id}"] .calculator-app`);
        const shot = captureStoreScreenshot(node, () => !retired && owns() && root === owner && selected === pkg && node?.isConnected === true);
        if (shot) captured[source.id] = { ...shot, signature };
      }
      if (!retired && owns() && selected === pkg) screenshots = { ...screenshots, ...captured };
    });
    return () => { retired = true; };
  });
  onMount(() => { originalRoot = root; originalState = storeData; originalProfile = profile; originalWindowId = windowId; mounted = true; const view = createStoreNativeView({root,owns}); registerView(windowId,view); return () => { mounted = false; registerView(originalWindowId,null,view); }; });
</script>

{#snippet packageIcon(pkg, large = false)}
  <span class="store-package-icon" class:large class:radix={pkg.id === 'radix-lab'} aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="13" y="9" width="38" height="46" rx="5" fill="currentColor"/><rect x="18" y="14" width="28" height="11" rx="2" fill="#eef4ed"/>{#each [0,1,2] as row}{#each [0,1,2] as column}<rect x={18+column*10} y={30+row*8} width="7" height="5" rx="1" fill={column===2?'#ffb95b':'#eef4ed'}/>{/each}{/each}</svg>{#if pkg.id==='radix-lab'}<b>16</b>{/if}</span>
{/snippet}
{#snippet packageAction(pkg)}
  {@const download = storeActiveDownload(storeData,pkg.id)}
  {@const installed = storeInstalled(storeData,pkg.id)}
  {#if download}<div class="store-package-download"><button class="store-progress-button" data-store-control={`download:${download.id}`} aria-label={`${download.status==='paused'?'Resume':'Pause'} ${pkg.name} local installation`} onclick={()=>command(download.status==='paused'?'resume':'pause',{downloadId:download.id})}><span class="store-progress-ring" style:--progress={`${download.progress*3.6}deg`}>{download.status==='paused'?'▶':'Ⅱ'}</span><span>{download.status==='paused'?'Paused':`${download.progress}%`}</span></button><button class="store-cancel-link" data-store-control={`cancel:${download.id}`} onclick={()=>command('cancel',{downloadId:download.id})}>Cancel</button></div>
  {:else if installed}<div class="store-package-buttons"><button class="store-get" data-store-control={`open:${pkg.id}`} onclick={()=>command('openInstalled',{packageId:pkg.id})}>Open</button>{#if installed.version!==pkg.latestVersion}<button class="store-get" data-store-control={`update:${pkg.id}`} onclick={()=>command('update',{packageId:pkg.id})}>Update</button>{/if}</div>
  {:else}<div class="store-acquire"><button class="store-get" data-store-control={`get:${pkg.id}`} onclick={()=>command('get',{packageId:pkg.id})}>{storeData.purchased.some(row=>row.packageId===pkg.id)?'Install':'Get'}</button><small>Free · local fiction</small></div>{/if}
{/snippet}
{#snippet packageRow(pkg, rank = null)}
  <article class="store-package-row">
    <button class="store-package-identity" data-store-control={`details:${pkg.id}`} onclick={()=>command('details',{packageId:pkg.id})}>{@render packageIcon(pkg)}<span>{#if rank}<b class="store-rank">{rank}</b>{/if}<strong>{pkg.name}</strong><small>{pkg.subtitle}</small>{#if cap.highSierra}<span class="store-stars">{'★'.repeat(Math.round(storeRating(storeData,pkg.id).average))}<small>{storeRating(storeData,pkg.id).count} local ratings</small></span>{/if}</span></button>
    {@render packageAction(pkg)}
  </article>
{/snippet}
{#snippet systemUpdatePatch(manifest)}
  <dl class="store-system-update-patch">{#each manifest.patch as patch (patch.path)}<dt>{patch.path}</dt><dd>{storeSystemUpdateValue(patch.value)} <small>({typeof patch.value})</small></dd>{/each}</dl>
{/snippet}

<div bind:this={root} class="store-app era-{cap.era}" class:dark={appearance==='dark'} class:inactive={!active} data-store-window={windowId} role="application" aria-label={`${cap.label} · fictional local packages`} tabindex="-1" onkeydown={keydown}>
  <header class="store-chrome" data-window-drag>
    {#if !cap.windows}<div class="store-window-controls"><WindowControls {...controls} {active} onclose={()=>command('window.close')} /></div>{:else}<span class="store-windows-title"><span aria-hidden="true">▦</span> Microsoft Store</span>{/if}
    {#if cap.highSierra}<nav class="store-classic-tabs" aria-label="App Store sections" data-window-no-drag>{#each cap.sections as section}<button class:selected={session?.section===section&&session.screen==='browse'} data-store-control={`section:${section}`} onclick={()=>command('navigate',{section})}><span>{sectionIcons[section]}</span>{sectionLabel(section)}{#if section==='updates'&&updateCount}<b>{updateCount}</b>{/if}</button>{/each}</nav>{/if}
    {#if cap.windows||cap.highSierra}<label class="store-search" data-window-no-drag><span aria-hidden="true">⌕</span><input data-store-control="search" aria-label="Search fictional local packages" placeholder={cap.windows?'Search apps, games, movies and more':'Search'} value={session?.query??''} maxlength="512" onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();command('search',{query:event.currentTarget.value});}}}/></label>{/if}
    {#if cap.windows}<button class="store-account-circle" data-window-no-drag data-store-control="account" aria-label="Local account" onclick={()=>command('sheet',{sheet:'account'})}>{storeData.account.signedIn?storeData.account.name.slice(0,1).toUpperCase():'♙'}</button>{/if}
    <div class="store-toolbar-menu" data-window-no-drag><button data-store-control="menu" aria-label="Store menus" aria-haspopup="menu" aria-expanded={!!menu} onclick={()=>menu=menu?'':'all'}>···</button>{#if menu}<div class="store-menu-popup" role="menu" aria-label="Store commands">{#each menus as group}<strong>{group.label}</strong>{#each group.items as item}<button role={item.checked!==undefined?'menuitemcheckbox':'menuitem'} aria-checked={item.checked} disabled={!item.enabled} data-store-control={`menu:${group.id}:${item.id}`} onclick={()=>menuAction(item)}><span>{item.checked?'✓ ':''}{item.label}</span><kbd>{cap.windows?(item.shortcut??'').replaceAll('⌘','Ctrl+'):(item.shortcut??'')}</kbd></button>{/each}{/each}</div>{/if}</div>
  </header>
  {#if session}<div class="store-layout" inert={session.sheet!=='none'}>
    {#if !cap.highSierra}<aside class="store-sidebar">
      {#if !cap.windows}<label class="store-search"><span aria-hidden="true">⌕</span><input data-store-control="search" aria-label="Search fictional local packages" placeholder="Search" value={session.query} maxlength="512" onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();command('search',{query:event.currentTarget.value});}}}/></label>{/if}
      <nav aria-label={`${cap.label} sections`}>{#each cap.sections as section}<button class:selected={session.section===section&&session.screen==='browse'&&!session.query} class:bottom={cap.windows&&section==='library'} data-store-control={`section:${section}`} onclick={()=>command('navigate',{section})}><span class="store-nav-icon" aria-hidden="true">{sectionIcons[section]}</span><span>{sectionLabel(section)}</span>{#if (section==='updates'||section==='library')&&updateCount}<b>{updateCount}</b>{/if}</button>{/each}{#if cap.windows}<button data-store-control="help" onclick={()=>command('sheet',{sheet:'help'})}><span class="store-nav-icon">?</span><span>Help</span></button>{/if}</nav>
      {#if !cap.windows}<button class="store-account" data-store-control="account" onclick={()=>command('sheet',{sheet:'account'})}><span class="store-avatar">{storeData.account.signedIn?storeData.account.name.slice(0,1).toUpperCase():'♙'}</span><span><strong>{storeData.account.signedIn?storeData.account.name:'Sign In'}</strong><small>Fictional local account</small></span></button>{/if}
    </aside>{/if}
    <main class="store-main">
      <div class="store-page-toolbar"><div><button aria-label="Back" data-store-control="back" disabled={!session.back.length} onclick={()=>command('back')}>‹</button><button aria-label="Forward" data-store-control="forward" disabled={!session.forward.length} onclick={()=>command('forward')}>›</button></div><strong>{session.screen==='details'?selected?.name:session.screen==='story'?'From the Local Editors':title}</strong>{#if selected}<button data-store-control="copy-link" aria-label="Copy local package link" onclick={()=>command('copyLink',{packageId:selected.id})}>↥</button>{:else}<span></span>{/if}</div>
      <div class="store-content" data-store-scroll>
        {#if session.screen==='details'&&selected}
          {@const rating = storeRating(storeData,selected.id)}
            {@const source = previewStates[session.screenshotIndex]}
            {@const screenshot = screenshots[source?.id]}
          <section class="store-detail-heading">{@render packageIcon(selected,true)}<div><h1>{selected.name}</h1><p>{selected.subtitle}</p><small>{selected.developer}</small><div class="store-detail-actions">{@render packageAction(selected)}{#if selectedInstalled}<button class="store-remove-link" data-store-control="remove-installation" onclick={()=>command('sheet',{sheet:'uninstall'})}>Remove Local Installation…</button>{/if}</div></div></section>
          <div class="store-detail-stats"><span><strong>{rating.average.toFixed(1)}</strong><small>{'★'.repeat(Math.round(rating.average))} · {rating.count} local ratings</small></span><span><strong>{selected.age}</strong><small>Authored age rating</small></span><span><strong>{selected.category}</strong><small>Category</small></span><span><strong>{selectedInstalled?.version??selected.initialVersion}</strong><small>{selectedInstalled?'Installed release':'Starter release'}</small></span></div>
          <section class="store-screenshots" aria-label="Genuine authored local app screenshots"><h2>Screenshots</h2><div class="store-shot-frame">
            {#if screenshot&&screenshot.signature===`${profile.id}:${selected.id}`}<img src={screenshot.src} width={screenshot.width} height={screenshot.height} alt={source.shot.caption}/>{:else}<div class="store-preview-fallback" inert><CalculatorApp state={source.state} {profile} {windowId} execute={previewExecute} available={false}/></div>{/if}
            <button class="store-shot-prev" aria-label="Previous screenshot" disabled={session.screenshotIndex===0} data-store-control="screenshot-prev" onclick={()=>command('screenshot',{index:0})}>‹</button><button class="store-shot-next" aria-label="Next screenshot" disabled={session.screenshotIndex===1} data-store-control="screenshot-next" onclick={()=>command('screenshot',{index:1})}>›</button>
          </div><p>{source?.shot.caption} · {screenshot?'Captured from the actual rendered local Calculator component.':'Actual rendered read-only preview; screenshot capture awaits this mounted view.'}</p><div class="store-shot-dots">{#each selected.screenshots as shot,index}<button class:selected={session.screenshotIndex===index} aria-label={`Screenshot ${index+1}: ${shot.title}`} aria-pressed={session.screenshotIndex===index} data-store-control={`screenshot:${index}`} onclick={()=>command('screenshot',{index})}></button>{/each}</div></section>
          <section class="store-description"><h2>Description</h2><p>{selected.description}</p></section>
          <section class="store-whats-new"><h2>What’s New</h2><span>Version {selected.latestVersion}</span><p>{storeRelease(selected.id,selected.latestVersion).notes}</p>{#if selected.initialVersion!==selected.latestVersion&&!selectedInstalled}<p class="store-local-note">First Get installs the authored starter release {selected.initialVersion}. Updates then offers {selected.latestVersion}; its launch mode actually changes.</p>{/if}</section>
          {#if selectedInstalled&&storeData.account.signedIn&&storeData.preferences.inAppRatings&&!storeData.reviews.some(row=>row.packageId===selected.id&&row.authorId===storeData.account.id)}<p class="store-local-note">How is your local package working? <button class="store-text-link" data-store-control="review-prompt" onclick={()=>command('sheet',{sheet:'review'})}>Write a Local Review</button></p>{/if}
          <section class="store-reviews"><header><h2>Ratings and Reviews</h2><button class="store-text-link" data-store-control="write-review" disabled={!storeData.account.signedIn||!storeData.purchased.some(row=>row.packageId===selected.id)} onclick={()=>command('sheet',{sheet:'review'})}>{storeData.reviews.some(row=>row.packageId===selected.id&&row.authorId===storeData.account.id)?'Edit Local Review':'Write a Review'}</button></header><p class="store-local-note">All reviews below are authored local fiction. No ratings are fetched from a real store.</p><div class="store-review-grid">{#each storeData.reviews.filter(row=>row.packageId===selected.id) as review (review.id)}<article><span class="store-stars">{'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)}</span><small>{dateText(review.authoredAt)}</small><h3>{review.title}</h3><p>{review.body}</p><footer>{review.author}</footer></article>{/each}</div></section>
          <section class="store-information"><h2>Information</h2><dl><dt>Seller</dt><dd>{selected.developer}</dd><dt>Size</dt><dd>{selected.size}</dd><dt>Language</dt><dd>{selected.language}</dd><dt>Compatibility</dt><dd>Working local Calculator family · {profile.id}</dd><dt>Installation</dt><dd>Actual scene registry · distinct {selected.installedId} application identity</dd><dt>Privacy</dt><dd>{selected.privacy}</dd><dt>Price</dt><dd>Free local fiction · no payments</dd></dl></section>
        {:else if session.screen==='story'&&story}<article class="store-editorial-story color-{story.color}"><small>{story.eyebrow}</small><h1>{story.title}</h1><p class="store-story-summary">{story.summary}</p><div class="store-story-art" aria-hidden="true"><span>125</span><span>+</span><span>37</span><strong>162</strong></div><p class="store-story-body">{story.body}</p>{@render packageRow(storePackage(story.packageId))}</article>
        {:else}
          <div class="store-section-heading"><h1>{title}</h1>{#if session.section==='updates'||session.section==='library'}<button class="store-get" disabled={!updateCount||!storeData.account.signedIn} data-store-control="update-all" onclick={()=>command('updateAll')}>{cap.windows?'Get Updates':cap.highSierra?'Update All Local Apps':'Update All'}</button>{/if}</div>
          {#if systemUpdateView.visible}
            <section class="store-system-update" aria-label="High Sierra shared system update">
              <header><span class="store-system-update-icon" aria-hidden="true">X</span><div><h2>Software Update</h2><p>High Sierra’s App Store Updates entry point · original shared Preferences record</p></div></header>
              {#if systemUpdateView.available}
                <h3>{systemUpdateView.manifest.title}</h3>
                <p>{systemUpdateView.manifest.detail}</p>
                <p class="store-local-note">{systemUpdateView.manifest.release.qualification} Installed OS identity remains {profile.id}. No Apple ID or fictional Store sign-in is required.</p>
                <div class="store-system-update-status" aria-live="polite"><strong>{systemUpdateView.updates.status}</strong>{#if ['downloading','ready'].includes(systemUpdateView.updates.status)}<progress max="100" value={systemUpdateView.updates.progress} aria-label="Actual shared local scene-package preparation"></progress><span>{systemUpdateView.updates.progress}%</span>{/if}{#if systemUpdateView.updates.lastCheck>0}<small>Last authored check: {dateText(systemUpdateView.updates.lastCheck)}</small>{/if}</div>
                {#if systemUpdateView.updates.packageFileId}<p class="store-local-note">Original prepared Files package: <code>{systemUpdateView.updates.packageFileId}</code> · revision {systemUpdateView.updates.packageRevision}</p>{/if}
                <details><summary>Disclosed scene-only settings</summary>{@render systemUpdatePatch(systemUpdateView.manifest)}</details>
                <div class="store-system-update-actions">{#each systemUpdateView.actions as action (action.id)}<button class="store-get" data-store-control={`system-update:${action.request.payload.operation}`} disabled={!available||!action.enabled} onclick={()=>systemUpdateAction(action)}>{action.label}</button>{/each}</div>
              {:else}<p class="store-local-note" role="status">The original shared Preferences update bridge is unavailable. No system-update action or progress has been simulated.</p>{/if}
            </section>
          {/if}
          {#if session.section==='arcade'}<div class="store-service-unavailable"><span aria-hidden="true">♜</span><h2>Arcade is not available in this local scene.</h2><p>This sidebar item belongs to the researched Sonoma and qualified macOS 26 layouts. No subscription, account service, remote games, or backport is simulated.</p><button class="store-get" onclick={()=>command('navigate',{section:'play'})}>Browse Local Play Collection</button></div>
          {:else if session.section==='gaming'||session.section==='movies'}<div class="store-service-unavailable"><span aria-hidden="true">{sectionIcons[session.section]}</span><h2>No authored {session.section==='gaming'?'game':'movie or TV'} packages.</h2><p>This Microsoft Store-style local equivalent offers only the working fictional packages listed under Apps. There are no payments, subscriptions, or remote catalog results.</p><button class="store-get" onclick={()=>command('navigate',{section:'apps'})}>Browse Local Apps</button></div>
          {:else if (session.section==='purchased'||session.section==='library')&&!storeData.account.signedIn}<div class="store-service-unavailable"><span aria-hidden="true">♙</span><h2>Sign in to see your local packages.</h2><p>Use a fictional local display name. Never enter an Apple ID, Microsoft account, password, or payment information.</p><button class="store-get" data-store-control="sign-in" onclick={()=>command('sheet',{sheet:'signin'})}>Sign In</button></div>
          {:else}
            {#if !session.query&&session.section==='categories'&&!session.category}<div class="store-category-grid">{#each STORE_CATEGORIES as [name,icon]}<button data-store-control={`category:${name}`} onclick={()=>command('navigate',{section:'categories',category:name})}><span aria-hidden="true">{icon}</span>{name}</button>{/each}</div>{/if}
            {#if cap.windows&&session.section==='apps'&&!session.query}<div class="store-filter-chips">{#each ['Utilities','Developer Tools','Productivity','Education'] as category}<button data-store-control={`category:${category}`} onclick={()=>command('navigate',{section:'categories',category})}>{category}</button>{/each}</div>{/if}
            {#if pageStories.length&&!session.query&&!session.category&&['discover','featured','create','work','play','develop','home','apps'].includes(session.section)}<div class="store-editorial-grid" class:featured={cap.highSierra}>{#each pageStories as feature}<button class="store-editorial-card color-{feature.color}" data-store-control={`story:${feature.id}`} onclick={()=>command('story',{storyId:feature.id})}><small>{feature.eyebrow}</small><h2>{feature.title}</h2><p>{feature.summary}</p><div class="store-feature-art" aria-hidden="true">{#if feature.packageId==='radix-lab'}<span>01</span><span>FF</span><strong>16</strong>{:else}<span>125</span><span>+ 37</span><strong>162</strong>{/if}</div></button>{/each}</div>{/if}
            <div class="store-browse-columns"><section class="store-package-section"><header><h2>{session.query?'Local Results':session.section==='updates'?'Available Local Updates':session.section==='purchased'||session.section==='library'?'Acquired Local Packages':session.category??(session.section==='topcharts'?'Top Free Local Apps':'Apps for a Local Desktop')}</h2><span>{packages.length} {packages.length===1?'package':'packages'}</span></header><div class="store-package-grid">{#each packages as pkg,index (pkg.id)}{@render packageRow(pkg,session.section==='topcharts'?index+1:null)}{/each}</div>{#if !packages.length}<p class="store-empty">{session.query?'No authored local packages match your search.':session.section==='updates'?'All installed local packages are up to date. Get a starter release to see its available update.':session.section==='purchased'||session.section==='library'?'No local packages acquired yet. Install an authored package to add it here.':'No authored local packages in this category. The catalog is deliberately local, not a fabricated remote store.'}</p>{/if}</section>
              {#if cap.highSierra}<aside class="store-quick-links"><h2>Quick Links</h2><button onclick={()=>command('sheet',{sheet:storeData.account.signedIn?'account':'signin'})}>{storeData.account.signedIn?'Account':'Sign In'}</button><button onclick={()=>command('navigate',{section:'purchased'})}>Purchased</button><button onclick={()=>command('navigate',{section:'updates'})}>Updates</button><button onclick={()=>command('sheet',{sheet:'help'})}>Local Store Help</button><hr/><button onclick={()=>command('navigate',{section:'categories',category:'Utilities'})}>Invaluable Utilities</button><button onclick={()=>command('navigate',{section:'categories',category:'Developer Tools'})}>Apps for Developers</button></aside>{/if}
            </div>
            {#if ['updates','library'].includes(session.section)&&storeData.downloads.length}<section class="store-install-history"><h2>Local Installation History</h2>{#each storeData.downloads.slice().reverse() as download (download.id)}<article><div><strong>{storePackage(download.packageId).name}</strong><small>{download.kind==='update'?'Update':'Install'} {download.targetVersion} · {download.status} · {phaseLabels[download.phase]}</small></div><span>{download.progress}%</span>{#if download.status==='cancelled'}<button class="store-text-link" data-store-control={`retry:${download.id}`} disabled={!!storeActiveDownload(storeData,download.packageId)} onclick={()=>command(storeInstalled(storeData,download.packageId)?'update':'get',{packageId:download.packageId})}>Try Again</button>{/if}</article>{/each}</section>{/if}
          {/if}
        {/if}
        <footer class="store-disclosure">{cap.disclosure}</footer>
      </div>
      {#if jobs.length}<section class="store-download-tray" aria-label="Active local installations">{#each jobs as download (download.id)}<div><span><strong>{storePackage(download.packageId).name}</strong><small>{download.status==='paused'?'Paused · ':''}{phaseLabels[download.phase]} · no network transfer</small></span><progress max="100" value={download.progress} aria-label={`${storePackage(download.packageId).name} local staging progress`}></progress><button data-store-control={`tray-pause:${download.id}`} onclick={()=>command(download.status==='paused'?'resume':'pause',{downloadId:download.id})}>{download.status==='paused'?'Resume':'Pause'}</button><button data-store-control={`tray-cancel:${download.id}`} onclick={()=>command('cancel',{downloadId:download.id})}>Cancel</button><button data-store-control={`tray-advance:${download.id}`} disabled={download.status==='paused'} onclick={()=>command('process',{downloadId:download.id})}>Continue</button></div>{/each}</section>{/if}
    </main>
  </div>{:else}<p class="store-missing" role="alert">The original canonical Store session is unavailable.</p>{/if}
  {#if error}<div class="store-error" role="alert">{error}<button aria-label="Dismiss error" onclick={()=>error=''}>×</button></div>{/if}
  {#if session&&session.sheet!=='none'}<div class="store-sheet-backdrop"><section class="store-sheet sheet-{session.sheet}" role="dialog" aria-modal="true" aria-label={session.sheet==='signin'?'Fictional local sign-in':session.sheet==='install'?'Install local package':session.sheet}>
    {#if session.sheet==='signin'}<div class="store-sheet-icon">▦</div><h2>Sign In to the Local Store</h2><p>This is a fictional account surface. Enter only a local display name. Never enter an Apple ID, Microsoft account, email address, or password.</p><label>Local display name<input data-store-control="local-name" bind:value={localName} maxlength="80" autocomplete="off"/></label><footer><button data-store-control="sheet-cancel" onclick={()=>command('sheet',{sheet:'none'})}>Cancel</button><button class="primary" data-store-control="local-sign-in" onclick={()=>command('signIn',{name:localName})}>Use Local Account</button></footer>
    {:else if session.sheet==='account'}<h2>{storeData.account.name}</h2><p>Fictional local account · no Apple or Microsoft connection.</p><h3>{cap.highSierra?'Purchased':'Acquired Local Packages'}</h3>{#if storeData.purchased.length}<div class="store-account-purchases">{#each storeData.purchased as row}<div><strong>{storePackage(row.packageId).name}</strong><small>Acquired locally {dateText(row.acquiredAt)}</small><button class="store-text-link" data-store-control={`account-package:${row.packageId}`} onclick={()=>command('details',{packageId:row.packageId})}>View</button></div>{/each}</div>{:else}<p>No packages acquired. A completed local installation adds a real application registration and an acquisition record together.</p>{/if}<footer><button data-store-control="sign-out" onclick={()=>command('signOut')}>Sign Out</button><button class="primary" data-store-control="sheet-done" onclick={()=>command('sheet',{sheet:'none'})}>Done</button></footer>
    {:else if session.sheet==='install'&&selected}<h2>Install {selected.name}?</h2><p>This fictional local package registers a distinct working application in this scene. It opens the actual Calculator family, not a mock window or an external executable.</p><p><strong>Release {storeData.purchased.some(row=>row.packageId===selected.id)?selected.latestVersion:selected.initialVersion}</strong> · {selected.size}</p><p>Local staging progress represents manifest preparation and atomic registry publication. No network transfer or host installation occurs.</p><footer><button data-store-control="sheet-cancel" onclick={()=>command('sheet',{sheet:'none'})}>Cancel</button><button class="primary" data-store-control="confirm-install" onclick={()=>command('install',{packageId:selected.id})}>Install Local Package</button></footer>
    {:else if session.sheet==='system-update'}<h2>Apply disclosed local scene package?</h2>
      {#if systemUpdateView.available}<h3>{systemUpdateView.manifest.title}</h3><p>{systemUpdateView.manifest.detail}</p>{@render systemUpdatePatch(systemUpdateView.manifest)}<p>{systemUpdateView.manifest.release.qualification}</p><p>Uses the actual original Files package <code>{systemUpdateView.updates.packageFileId}</code>, revision {systemUpdateView.updates.packageRevision}. Applying requires the guarded scene restart endpoint. Installed OS identity remains {profile.id}; no host installation, network transfer, or Store sign-in occurs.</p>
      {:else}<p role="alert">The original shared update source is unavailable. No package will be applied.</p>{/if}
      <footer><button data-store-control="sheet-cancel" onclick={()=>command('sheet',{sheet:'none'})}>Cancel</button><button class="primary" data-store-control="system-update:confirm" disabled={!available||!systemUpdateView.available||!systemInstallAction?.enabled||systemUpdateView.updates?.status!=='ready'} onclick={()=>systemUpdateAction(systemInstallAction,true)}>Apply Disclosed Scene Settings and Restart</button></footer>
    {:else if session.sheet==='review'&&session.reviewDraft}<h2>Review {selected?.name}</h2><p>Your review is retained only in this fictional local scene.</p><fieldset class="store-review-rating"><legend>Rating</legend>{#each [1,2,3,4,5] as rating}<button aria-label={`${rating} stars`} aria-pressed={session.reviewDraft.rating===rating} data-store-control={`rating:${rating}`} onclick={()=>reviewField('rating',rating)}>{rating<=session.reviewDraft.rating?'★':'☆'}</button>{/each}</fieldset><label>Title<input data-store-control="review-title" value={session.reviewDraft.title} maxlength="128" oninput={event=>reviewField('title',event.currentTarget.value)}/></label><label>Review<textarea data-store-control="review-body" value={session.reviewDraft.body} maxlength="2048" rows="5" oninput={event=>reviewField('body',event.currentTarget.value)}></textarea></label><footer><button data-store-control="sheet-cancel" onclick={()=>command('sheet',{sheet:'none'})}>Cancel</button><button class="primary" data-store-control="review-submit" onclick={()=>command('reviewSubmit')}>Submit Local Review</button></footer>
    {:else if session.sheet==='settings'}<h2>{cap.highSierra||cap.era==='mojave'?'Preferences':'Settings'}</h2>
      {#if cap.highSierra}<fieldset class="store-system-update-policies"><legend>Software Update · Local Scene Policy</legend>
        {#if systemUpdatePolicyView.available}{#each STORE_SYSTEM_UPDATE_POLICIES as policy (policy.setting)}
          {@const action = systemUpdatePolicyView.actions.find(row => row.request.payload.setting === policy.setting)}
          <label class="store-check" class:store-policy-subordinate={policy.setting!=='automaticCheck'}><input data-store-control={`system-update-policy-${policy.setting}`} type="checkbox" checked={systemUpdatePolicyView.updates[policy.setting]} disabled={!available||!action.enabled} onchange={event=>systemUpdatePolicyAction(action,event.currentTarget)}/>{action.label}</label>
        {/each}<p class="store-local-note">These are the original shared scene-policy values, not host update settings. Automatic local behavior requires Root’s actual guarded update protocol and mounted source. No Apple system files or binary installers are downloaded.</p>
        {:else}<p class="store-local-note" role="status">The original shared Preferences update-policy bridge is unavailable. No policy values or requests have been substituted.</p>{/if}
      </fieldset>{/if}
      <label class="store-check"><input data-store-control="ratings-setting" type="checkbox" checked={storeData.preferences.inAppRatings} onchange={event=>command('preferences',{inAppRatings:event.currentTarget.checked})}/>In-App Ratings & Reviews · local prompts</label><p>This setting controls local review prompts only. Local package acquisitions remain explicit scene-local actions. Automatic purchases, cross-computer downloads, Apple IDs, Microsoft accounts, and subscriptions are not simulated.</p><footer><button class="primary" data-store-control="sheet-done" onclick={()=>command('sheet',{sheet:'none'})}>Done</button></footer>
    {:else if session.sheet==='uninstall'&&selected}<h2>Remove {selected.name}?</h2><p>This removes its actual local application registration from the scene’s installed-app projection. Your acquisition and local reviews remain, so you can reinstall it from Purchased or Library. It does not uninstall host software.</p><footer><button data-store-control="sheet-cancel" onclick={()=>command('sheet',{sheet:'none'})}>Cancel</button><button class="primary" data-store-control="confirm-remove" onclick={()=>command('uninstall',{packageId:selected.id,confirmed:true})}>Remove Local Installation</button></footer>
    {:else if session.sheet==='help'}<h2>{cap.label} Local Help</h2><p>{cap.disclosure}</p><p>Search the authored packages, open an editorial story, inspect the real local-component screenshots, or browse native-era categories. Get opens a confirmation surface after fictional sign-in. Installation stages a local manifest and then atomically publishes the distinct local app registration plus its acquisition record.</p><p>Open launches the actual working Calculator controller with the installed release’s mode. Trail Calculator’s 1.0 starter opens Basic; its 1.1 update opens Scientific. Radix Lab opens Programmer. Pause and Cancel act before final publication; cancelling an update preserves the original installed version. Existing open Calculator work is never silently rewritten by an update.</p><p>Reviews require an acquired package and fictional local sign-in. Signing out cancels active local staging but retains installed apps and acquired packages. No network, payments, subscriptions, remote ratings, real credentials, or host installations are involved.</p><footer><button class="primary" data-store-control="sheet-done" onclick={()=>command('sheet',{sheet:'none'})}>Done</button></footer>{/if}
  </section></div>{/if}
  {#if selected&&session?.screen==='details'}<div class="store-shot-sources" aria-hidden="true" inert>{#each previewStates as source (source.id)}<div data-store-shot-source={source.id} style:width={`${source.width}px`} style:height={`${source.height}px`}><CalculatorApp state={source.state} {profile} {windowId} execute={previewExecute} available={false}/></div>{/each}</div>{/if}
</div>

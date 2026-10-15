<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import ChromePreferences from './ChromePreferences.svelte';
  import ChromeIcon from './ChromeIcon.svelte';
  import { browserPages, browserPage, browserSearchResults, pageSource, browserCertificate } from './browser-pages.js';
  import { createBrowserNativeView } from './browser-native-view.js';
  import { chromeMenuProvider } from './chrome-family-adapter.js';
  import { chromeProfileMetadata } from './chrome-profile-metadata.js';
  import './chrome-native.css';

  let { state: nativeChromeState, profile, windowId, window: nativeWindow, execute, registerView, available = true, active = true,
    controls = null, fullScreen = false, revealedTop = true, modernGreenMenu = false, zoomed = false } = $props();
  let root = $state(null), facade = $state(null), error = $state(''), observedFind = $state(null), inspected = $state(null), nodes = $state([]);
  const win = $derived(nativeChromeState.windows.find(row => row.id === windowId));
  const tab = $derived(win?.tabs.find(row => row.id === win.activeTabId));
  const entry = $derived(tab?.pending ?? tab?.entries[tab.index]);
  const page = $derived(entry ? browserPage(entry) : null);
  const metadata = $derived(chromeProfileMetadata(profile));
  const isMac = $derived(!profile.id.startsWith('windows11'));
  const menus = $derived(chromeMenuProvider({ state: nativeChromeState, profile, windowId, view: facade }));
  const popup = $derived(menus.find(group => group.id === win?.menu));
  const downloads = $derived(nativeChromeState.downloads.filter(row => !row.private || row.windowId === windowId));
  const history = $derived(nativeChromeState.history.filter(row => `${row.title} ${row.url}`.toLocaleLowerCase().includes(win?.historyQuery.toLocaleLowerCase() ?? '')));
  const permission = $derived((win?.private ? win.privatePermissions : nativeChromeState.permissions).find(row => row.origin === entry?.url));
  const certificate = $derived(entry ? browserCertificate(entry.url) : null);
  const bookmarkBar = $derived(nativeChromeState.bookmarks.filter(row => row.kind === 'bookmark' && (row.parentId === 'browser-favorites' || row.parentId === null)));
  const suggestions = $derived(nativeChromeState.settings.searchSuggestions && tab?.address ? browserPages.filter(row => row.id !== 'error' && `${row.title} ${row.address}`.toLowerCase().includes(tab.address.toLowerCase())).slice(0, 6) : []);
  const draft = $derived(win?.bookmarkDraft);
  const owned = () => ({ state: nativeChromeState, root, facade, win, tab, entries: tab?.entries, entry: tab?.entries[tab.index], token: tab?.loadToken });
  const same = owner => available && root?.isConnected && Object.entries(owner).every(([key, value]) => owned()[key] === value);
  const samePresentation = owner => available && root?.isConnected && ['state', 'root', 'facade', 'win', 'tab'].every(key => owned()[key] === owner[key]);
  const fieldRequests = new Map();
  let requestSequence = 0;

  async function ask(name, payload = {}, tabId = null) {
    if (!available || !root?.isConnected || !win || win.closed) return { status: 'rejected', error: { code: 'unavailable', message: 'This original Chrome view is unavailable.' } };
    const owner = owned();
    const result = await execute(`browser.${name}`, { windowId, ...(tabId ? { tabId } : {}) }, payload);
    if (samePresentation(owner)) error = result?.status === 'rejected' ? result.error?.message ?? 'The command was rejected.' : '';
    return result;
  }
  const act = (name, payload = {}) => ask(name, payload, tab?.id);
  const open = address => act('navigate', { address });
  async function menuAction(item) {
    if (!item.enabled || !item.request || !available) return;
    const owner = owned(), request = item.request;
    const result = await execute(request.command, request.target, request.payload);
    if (!samePresentation(owner)) return;
    error = result?.status === 'rejected' ? result.error?.message ?? 'The menu command was rejected.' : '';
    if (result?.status === 'applied' && win.menu !== null) await ask('menu', { menu: null });
  }
  function mirror(control) {
    if (control === 'address' || control === 'address-search') return tab?.address;
    if (control === 'history-search') return win?.historyQuery;
    if (control === 'bookmark-title') return draft?.title;
    if (control === 'bookmark-url') return draft?.url;
    if (control === 'prefs-homepage') return nativeChromeState.settings.homepage;
    if (control.startsWith('form-')) return tab?.form[control.slice(5)];
    if (control === 'find') return tab?.find.query;
    return null;
  }
  async function edit(event, name, payload, tabId = null) {
    const node = event.currentTarget, owner = owned(), control = node.dataset.browserControl;
    const sequence = ++requestSequence;
    fieldRequests.set(control, sequence);
    const result = await ask(name, payload, tabId);
    if (result.status !== 'applied' && same(owner) && fieldRequests.get(control) === sequence && node.isConnected && root.contains(node)) {
      const value = mirror(control); if (typeof value === 'string') node.value = value;
    }
  }
  async function find(name, payload) {
    const owner = owned(), result = await act(name, payload);
    if (same(owner) && result.status === 'applied') observedFind = { tabId: tab.id, token: tab.loadToken, count: result.count, index: result.index };
  }
  async function inspect() {
    const owner = owned(), result = await ask('inspector.nodes');
    if (same(owner) && result.status === 'applied') nodes = result.nodes ?? [];
  }
  async function inspectNode(nodeId) {
    const owner = owned(), result = await ask('inspector.select', { nodeId });
    if (same(owner) && result.status === 'applied') inspected = result.node ?? result.snapshot ?? result;
  }
  function key(event) {
    if (!available || event.isComposing) return;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod) return;
    const value = event.key.toLowerCase();
    if (value === 'l') { event.preventDefault(); void ask('focus', { controlId: 'address' }); }
    else if (value === 't') { event.preventDefault(); void ask(event.shiftKey ? 'tab.reopen' : 'tab.new'); }
    else if (value === 'n') { event.preventDefault(); void ask('window.new', { private: event.shiftKey }); }
    else if (value === 'w') { event.preventDefault(); void act('tab.close'); }
    else if (value === 'r') { event.preventDefault(); void act('reload'); }
    else if (value === 'f') { event.preventDefault(); void act('find.open'); }
    else if (value === 'p') { event.preventDefault(); void act('print'); }
    else if (value === 'd') { event.preventDefault(); void ask('bookmark.begin'); }
    else if (['c', 'x', 'v', 'a', 'z', 'y'].includes(value)) {
      event.preventDefault();
      const operation = { c: 'copy', x: 'cut', v: 'paste', a: 'selectAll', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[value];
      void ask('clipboard', { operation });
    }
  }
  function drop(event) {
    event.preventDefault();
    const value = event.dataTransfer?.getData('text/uri-list')?.split('\n').find(row => row.trim() && !row.startsWith('#')) || event.dataTransfer?.getData('text/plain');
    if (typeof value === 'string' && value.trim() && value.length <= 2048) void open(value.trim());
    else error = 'Drop an authored page address or text to search the local page index. Host files are not imported into Chrome.';
  }
  onMount(() => {
    const original = createBrowserNativeView({ getRoot: () => root, getState: () => nativeChromeState, windowId, available: () => available && win?.closed === false && win.nativeAppId === 'chrome', tick });
    facade = original; registerView(windowId, original);
    return () => { registerView(windowId, null, original); if (facade === original) facade = null; };
  });
</script>

{#snippet menuRows(items)}
  {#each items as item (item.id)}
    {#if item.children}
      <details class="chrome-submenu"><summary>{item.label}</summary>{@render menuRows(item.children)}</details>
    {:else}
      <button data-browser-control={`menu:${item.id}`} disabled={!available || !item.enabled} onpointerdown={event => event.preventDefault()} onclick={() => menuAction(item)}><span>{item.checked ? '✓ ' : ''}{item.label}</span></button>
    {/if}
  {/each}
{/snippet}

{#snippet bookmarkRows(parentId, depth = 0)}
  {#each nativeChromeState.bookmarks.filter(row => row.parentId === parentId) as row (row.id)}
    <div class="chrome-library-row" style:padding-left={`${18 + depth * 18}px`}>
      <button data-browser-control={`bookmark:${row.id}`} onclick={() => row.kind === 'bookmark' ? open(row.url) : ask('bookmark.begin', { id: row.id })}><span>{row.kind === 'folder' ? '▱' : '☆'}</span><strong>{row.title}</strong><small>{row.url}</small></button>
      <button data-browser-control={`bookmark-edit:${row.id}`} aria-label={`Edit ${row.title}`} onclick={() => ask('bookmark.begin', { id: row.id })}>Edit</button>
      <button data-browser-control={`bookmark-delete:${row.id}`} disabled={row.id === 'browser-favorites'} onclick={() => ask('bookmark.delete', { id: row.id })}>Delete</button>
    </div>
    {#if row.kind === 'folder'}{@render bookmarkRows(row.id, depth + 1)}{/if}
  {/each}
{/snippet}

{#snippet downloadRow(row)}
  <div class="chrome-download-row">
    <span class="chrome-download-file">⇩</span><section><strong>{row.name}</strong><small>{row.url}</small>
      {#if row.status === 'downloading'}<progress max="100" value={row.progress}></progress>{/if}
      <p>{row.status === 'complete' ? 'Completed — saved to virtual Downloads' : `${row.status} ${row.progress}%`}{row.error ? ` · ${row.error}` : ''}</p>
      {#if row.status === 'complete'}<button data-browser-control={`download-open:${row.id}`} onclick={() => ask('download.open', { id: row.id })}>Open file</button><button data-browser-control={`download-reveal:${row.id}`} onclick={() => ask('download.reveal', { id: row.id })}>Show in {isMac ? 'Finder' : 'folder'}</button>
      {:else if row.status === 'downloading'}<button data-browser-control={`download-cancel:${row.id}`} onclick={() => ask('download.cancel', { id: row.id })}>Cancel</button>
      {:else}<button data-browser-control={`download-retry:${row.id}`} onclick={() => ask('download.retry', { id: row.id })}>Retry</button>{/if}
    </section>
  </div>
{/snippet}

{#snippet article()}
  {#if win.private && entry?.pageId === 'home'}
    <section class="chrome-incognito-page" data-browser-page-text data-browser-node="incognito"><div class="chrome-incognito-glyph"><ChromeIcon name="incognito" size={72}/></div><h1>You've gone incognito</h1><p>Now you can browse privately in this scene. Other people who use this scene won't see your activity after this window closes.</p><div class="chrome-incognito-columns"><p>Chrome won't save this private window's browsing history, fictional form information, or per-site permission choices.</p><p>Downloaded virtual files and bookmarks you create will be kept. This local scene does not connect to websites, your employer, or an internet service provider.</p></div></section>
  {:else if page.kind === 'start'}
    <div class="chrome-new-tab" data-browser-page-text data-browser-node="new-tab"><h1 class="chrome-wordmark" aria-label="Google">G<span>o</span><i>o</i>g<b>l</b><span>e</span></h1><form onsubmit={event => { event.preventDefault(); void open(tab.address); }}><span>⌕</span><input data-browser-control="address-search" aria-label="Search authored local pages" placeholder="Search local pages or type an authored URL" value={tab.address === 'jester://start' ? '' : tab.address} oninput={event => edit(event, 'address', { value: event.currentTarget.value }, tab.id)} maxlength="2048"/><button type="submit">Search</button></form><div class="chrome-shortcuts">{#each browserPages.filter(row => ['guide', 'journal', 'studio', 'downloads'].includes(row.id)) as row}<button data-browser-control={`start:${row.id}`} onclick={() => open(row.address)}><span>{row.title.slice(0, 1)}</span>{row.title}</button>{/each}</div><p>Authored offline pages only · no Google search request</p></div>
  {:else}
    <article class="chrome-authored-page" class:contrast={nativeChromeState.settings.extensions} style:font-size={`${tab.zoom}%`} data-browser-page-text data-browser-node="article">
      <h1 data-browser-node="heading">{page.heading}</h1><p class="chrome-lede" data-browser-node="description">{page.description}</p>
      {#each page.sections ?? [] as section, index}<section data-browser-node={`section-${index}`}><h2>{section.title}</h2><p>{section.body}</p></section>{/each}
      {#if page.kind === 'search'}<ul>{#each browserSearchResults(entry.query) as result}<li><button data-browser-control={`search:${result.id}`} onclick={() => open(result.address)}>{result.title}</button><p>{result.description}</p></li>{/each}</ul>{/if}
      {#if page.kind === 'form'}
        <form class="chrome-local-form" data-browser-node="form" onsubmit={event => { event.preventDefault(); void act('form.submit'); }}>
          {#each ['name', 'email', 'password', 'message'] as field}<label>{field}<input type={field === 'password' ? 'password' : 'text'} data-browser-control={`form-${field}`} maxlength={field === 'message' ? 2048 : 256} value={tab.form[field]} oninput={event => edit(event, 'form.edit', { field, value: event.currentTarget.value }, tab.id)}/></label>{/each}
          <p>Fictional sample only: .invalid email and FICTIONAL-SAMPLE-ONLY password.</p><button data-browser-control="form-submit" type="submit">Sign in to the fictional studio</button><button data-browser-control="autofill-open" type="button" onclick={() => act('autofill.open')}>Use saved fictional login</button>
          {#if tab.autofillOpen}<button type="button" data-browser-control="autofill-apply" onclick={() => act('autofill.apply')}>Fill from canonical contacts / sample password</button>{/if}
          <button type="button" data-browser-control="popup" onclick={() => act('popup')}>Open local pop-up sample</button>{#if tab.popupBlocked}<p>Pop-up blocked. <button type="button" data-browser-control="popup-allow" onclick={() => act('permission', { key: 'popups', value: 'allow' })}>Always allow this local site</button></p>{/if}
        </form>
      {/if}
      {#if page.downloads?.length}<ul>{#each page.downloads as asset}<li><button data-browser-control={`asset:${asset.name}`} onclick={() => act('download.start', { name: asset.name })}>Download {asset.name}</button> · {asset.mime}</li>{/each}</ul>{/if}
      {#if page.links?.length}<ul>{#each page.links as link}<li><button data-browser-control={`link:${link.url}`} draggable="true" ondragstart={event => event.dataTransfer.setData('text/uri-list', link.url)} onclick={() => open(link.url)}>{link.title}</button></li>{/each}</ul>{/if}
      {#if entry.error}<div class="chrome-page-error" role="alert"><h2>{entry.error === 'security' ? 'Deceptive site ahead · fictional warning' : 'This site can’t be reached offline'}</h2><p>{entry.url}</p><button data-browser-control="error-reload" onclick={() => act('reload')}>Reload</button>{#if entry.error === 'security'}<button data-browser-control="security" onclick={() => ask('panel', { panel: 'security' })}>Details</button>{/if}</div>{/if}
    </article>
  {/if}
{/snippet}

<section bind:this={root} class="native-chrome chrome-era-{metadata.era}" class:chrome-incognito={win?.private} class:chrome-windows={!isMac} class:inactive={!active} data-browser-window-id={windowId} data-native-app="chrome" inert={!available} onkeydown={key} ondragover={event => event.preventDefault()} ondrop={drop} aria-label="Google Chrome offline browser" role="region">
  <header class="chrome-tabstrip" data-window-drag>
    {#if isMac && controls}<div class="chrome-traffic" data-window-no-drag><WindowControls onclose={controls.onclose} onminimize={controls.onminimize} onzoom={controls.onzoom} onfullscreen={controls.onfullscreen} onsplitbegin={controls.onsplitbegin} onsplitside={controls.onsplitside} ongreenmenu={controls.ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} {zoomed}/></div>{/if}
    <div class="chrome-tabs" role="tablist" aria-label="Chrome tabs" data-window-no-drag>{#each win?.tabs ?? [] as row (row.id)}<div class="chrome-tab" class:selected={row.id === win.activeTabId} class:pinned={row.pinned}><button role="tab" aria-selected={row.id === win.activeTabId} data-browser-control={`tab:${row.id}`} onclick={() => ask('tab.select', {}, row.id)}><span class="chrome-favicon">{row.phase === 'loading' ? '◌' : '◉'}</span>{#if !row.pinned}<span>{row.entries[row.index].title}</span>{/if}</button>{#if !row.pinned}<button class="chrome-tab-close" data-browser-control={`tab-close:${row.id}`} aria-label={`Close ${row.entries[row.index].title}`} onclick={() => ask('tab.close', {}, row.id)}>×</button>{/if}</div>{/each}</div>
    <button class="chrome-new-tab-button" data-browser-control="tab-new" aria-label="New tab" onclick={() => ask('tab.new')}>+</button>
    {#if !isMac && controls}<div class="chrome-caption-buttons"><button aria-label="Minimize" onclick={controls.onminimize}>─</button><button aria-label="Maximize" onclick={controls.onzoom}>□</button><button class="chrome-close-window" aria-label="Close window" onclick={controls.onclose}>×</button></div>{/if}
  </header>
  <nav class="chrome-toolbar" aria-label="Chrome navigation" data-window-no-drag>
    <button data-browser-control="back" aria-label="Back" disabled={!available || !tab || tab.index === 0} onclick={() => act('back')}><ChromeIcon name="back"/></button><button data-browser-control="forward" aria-label="Forward" disabled={!available || !tab || tab.index + 1 >= tab.entries.length} onclick={() => act('forward')}><ChromeIcon name="forward"/></button><button data-browser-control="reload" aria-label={tab?.phase === 'loading' ? 'Stop loading' : 'Reload'} disabled={!available || !tab} onclick={() => act(tab.phase === 'loading' ? 'stop' : 'reload')}><ChromeIcon name={tab?.phase === 'loading' ? 'close' : 'reload'}/></button>
    <form class="chrome-omnibox" onsubmit={event => { event.preventDefault(); void open(tab.address); }}><button type="button" data-browser-control="site-info" aria-label="Site information" onclick={() => ask('panel', { panel: 'security' })}><ChromeIcon name={metadata.era === 'refresh' ? 'tune' : entry?.url.startsWith('https:') ? 'lock' : 'info'} size={16}/></button><input data-browser-control="address" aria-label="Address and search bar" value={tab?.address ?? ''} maxlength="2048" disabled={!available || !tab} oninput={event => edit(event, 'address', { value: event.currentTarget.value }, tab.id)} onkeydown={event => { if (event.key === 'Escape') void act('stop'); }}/><button type="button" data-browser-control="bookmark-page" aria-label="Bookmark this tab" onclick={() => ask('bookmark.begin')}><ChromeIcon name="star"/></button>
      {#if suggestions.length}<div class="chrome-address-suggestions">{#each suggestions as row}<button type="button" data-browser-control={`suggestion:${row.id}`} onclick={() => open(row.address)}>{row.title}<small>{row.address}</small></button>{/each}</div>{/if}
    </form>
    {#if metadata.era === 'refresh'}<button data-browser-control="toolbar-downloads" aria-label="Downloads" onclick={() => ask('panel', { panel: 'downloads' })}><ChromeIcon name="download"/></button>{/if}
    {#if win?.private}<span class="chrome-incognito-chip" aria-label="Incognito"><ChromeIcon name="incognito" size={17}/> Incognito</span>{:else}<button data-browser-control="profile-settings" class="chrome-profile" aria-label="Local scene profile" onclick={() => ask('panel', { panel: 'preferences' })}><ChromeIcon name="profile" size={21}/></button>{/if}
    <button data-browser-control="menu" aria-label="Customize and control Google Chrome" aria-expanded={win?.menu === 'chrome'} onpointerdown={event => event.preventDefault()} onclick={() => ask('menu', { menu: win.menu === 'chrome' ? null : 'chrome' })}><ChromeIcon name="menu"/></button>
  </nav>
  {#if win?.bookmarksBar}<nav class="chrome-bookmarks-bar" aria-label="Bookmarks bar">{#each bookmarkBar as row}<button data-browser-control={`bookmark-bar:${row.id}`} onclick={() => open(row.url)}>◉ {row.title}</button>{/each}<button data-browser-control="bookmark-manager" onclick={() => ask('panel', { panel: 'bookmarks' })}>Other bookmarks</button></nav>{/if}
  {#if popup}<aside class="chrome-popup" data-browser-area="menu-popup" aria-label={popup.label}>{@render menuRows(popup.items)}</aside>{/if}
  {#if tab?.find.open}<div class="chrome-find"><input data-browser-control="find" aria-label="Find in page" value={tab.find.query} maxlength="256" oninput={event => find('find.query', { query: event.currentTarget.value })}/><span role="status">{observedFind?.tabId === tab.id && observedFind.token === tab.loadToken ? `${observedFind.count ? observedFind.index + 1 : 0}/${observedFind.count ?? 0}` : ''}</span><button data-browser-control="find-previous" aria-label="Previous match" onclick={() => find('find.next', { backward: true })}>↑</button><button data-browser-control="find-next" aria-label="Next match" onclick={() => find('find.next', { backward: false })}>↓</button><button data-browser-control="find-close" aria-label="Close find" onclick={() => act('find.close')}>×</button></div>{/if}
  <main class="chrome-content" data-browser-area={win?.panel === 'none' ? 'page' : win?.panel ?? 'page'}>
    {#if !win || !tab}<p class="chrome-unavailable">The canonical browser window must be opened before mounting Chrome.</p>
    {:else if win.panel === 'preferences'}<ChromePreferences state={nativeChromeState} {profile} {windowId} {execute} {available}/>
    {:else if win.panel === 'history'}
      <header class="chrome-internal-header"><h1>History</h1><input data-browser-control="history-search" aria-label="Search history" placeholder="Search history" maxlength="256" value={win.historyQuery} oninput={event => edit(event, 'history.search', { query: event.currentTarget.value })}/><button data-browser-control="history-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></header>
      <div class="chrome-internal-layout"><aside><h2>History</h2><p>From your scene</p><h3>Clear browsing history</h3>{#each [['hour','Last hour'],['day','Last 24 hours'],['all','All time']] as [range,label]}<button data-browser-control={`history-clear:${range}`} onclick={() => ask('history.clear', { range })}>{label}</button>{/each}</aside><section>{#each history as row}<div class="chrome-history-row"><time>{new Date(row.at).toISOString().slice(0,16).replace('T',' ')}</time><button data-browser-control={`visit:${row.id}`} onclick={() => open(row.url)}>{row.title}<small>{row.url}</small></button></div>{/each}{#if !history.length}<p>No browsing history matches.</p>{/if}</section></div>
    {:else if win.panel === 'bookmarks'}
      <header class="chrome-internal-header"><h1>Bookmarks</h1><button data-browser-control="bookmark-add" onclick={() => ask('bookmark.begin')}>Add bookmark</button><button data-browser-control="bookmark-folder" onclick={() => ask('bookmark.begin', { kind: 'folder' })}>Add folder</button><button data-browser-control="bookmarks-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></header>
      <div class="chrome-bookmark-manager">{@render bookmarkRows(null)}
      <form class="chrome-bookmark-editor" onsubmit={event => { event.preventDefault(); void ask('bookmark.save', { ...(draft.id ? { id: draft.id } : {}), parentId: draft.parentId, title: draft.title, url: draft.url, kind: draft.kind }); }}><h2>{draft.id ? 'Edit bookmark or folder' : 'Add bookmark or folder'}</h2><label>Name<input data-browser-control="bookmark-title" maxlength="256" value={draft.title} oninput={event => edit(event, 'bookmark.edit', { field: 'title', value: event.currentTarget.value })}/></label>{#if draft.kind === 'bookmark'}<label>URL<input data-browser-control="bookmark-url" maxlength="2048" value={draft.url} oninput={event => edit(event, 'bookmark.edit', { field: 'url', value: event.currentTarget.value })}/></label>{/if}<label>Folder<select data-browser-control="bookmark-parent" value={draft.parentId ?? ''} onchange={event => ask('bookmark.edit', { field: 'parentId', value: event.currentTarget.value || null })}><option value="">Top level</option>{#each nativeChromeState.bookmarks.filter(row => row.kind === 'folder') as folder}<option value={folder.id}>{folder.title}</option>{/each}</select></label><button data-browser-control="bookmark-save" type="submit">Save</button></form></div>
    {:else if win.panel === 'downloads'}
      <header class="chrome-internal-header"><h1>Downloads</h1><button data-browser-control="downloads-clear" onclick={() => ask('download.clear')}>Clear finished metadata</button><button data-browser-control="downloads-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></header><div class="chrome-downloads">{#each downloads as row}{@render downloadRow(row)}{/each}{#if !downloads.length}<p>Your downloaded virtual files appear here.</p>{/if}</div>
    {:else if win.panel === 'overview'}<header class="chrome-internal-header"><h1>Search tabs · local overview</h1><button data-browser-control="overview-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></header>{#each win.tabs as row}<div class="chrome-library-row"><button data-browser-control={`overview:${row.id}`} onclick={() => ask('tab.select', {}, row.id)}>{row.entries[row.index].title}</button><button data-browser-control={`pin:${row.id}`} onclick={() => ask('tab.pin', {}, row.id)}>{row.pinned ? 'Unpin' : 'Pin'}</button></div>{/each}
    {:else if win.panel === 'source'}<header class="chrome-internal-header"><h1>Page source</h1><button data-browser-control="source-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></header><pre class="chrome-source" data-browser-page-text>{pageSource(entry)}</pre>
    {:else if ['security', 'website'].includes(win.panel)}<section class="chrome-site-info"><h1>Site information</h1><p>{entry.url}</p><p>{certificate?.explanation ?? 'Authored offline content. No external TLS connection is made.'}</p>{#if certificate?.subject}<dl><dt>Subject</dt><dd>{certificate.subject}</dd><dt>Issuer</dt><dd>{certificate.issuer}</dd><dt>Serial</dt><dd>{certificate.serial}</dd><dt>Validity</dt><dd>{certificate.validFrom} – {certificate.validTo}</dd></dl>{/if}<p>Certificate examples use reserved .invalid hosts; they are not trusted live certificates.</p>{#each ['camera','microphone','location','notifications','popups'] as permissionKey}<label>{permissionKey}<select data-browser-control={`permission-select:${permissionKey}`} value={permission?.[permissionKey] ?? (permissionKey === 'popups' ? 'deny' : 'ask')} onchange={event => act('permission', { key: permissionKey, value: event.currentTarget.value })}>{#if permissionKey !== 'popups'}<option value="ask">Ask</option>{/if}<option value="allow">Allow</option><option value="deny">Block</option></select></label>{/each}<button data-browser-control="security-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></section>
    {:else if win.panel === 'share'}<section class="chrome-site-info"><h1>Save and share</h1>{#each ['mail','messages','copy'] as destination}<button data-browser-control={`share:${destination}`} onclick={() => act('share', { destination })}>{destination === 'copy' ? 'Copy link' : `Create a real local ${destination} draft`}</button>{/each}<button data-browser-control="print" onclick={() => act('print')}>Print…</button><button data-browser-control="pdf" onclick={() => act('pdf')}>Save as PDF…</button><button data-browser-control="share-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></section>
    {:else if win.panel === 'help'}<section class="chrome-about"><h1>Google Chrome</h1><p>{metadata.label}</p><p>{metadata.qualifier}</p><p>Installed additional application, not an OS-bundled browser. The native-era facade uses the same scene browser engine as Safari or Edge; all pages, search, permissions and downloads are locally serviced. No Google account, remote browsing, or browser update is performed.</p><button data-browser-control="help-start" onclick={() => open('jester://start')}>Open local new tab page</button><button data-browser-control="help-close" onclick={() => ask('panel', { panel: 'none' })}>Done</button></section>
    {:else}{@render article()}{/if}
    {#if win?.panel === 'inspector'}<aside class="chrome-devtools"><header><strong>Developer Tools · actual rendered nodes</strong><button data-browser-control="inspector-refresh" onclick={inspect}>Inspect DOM</button><button data-browser-control="inspector-close" onclick={() => ask('panel', { panel: 'none' })}>×</button></header>{#each nodes as node}<button data-browser-control={`inspect:${node.id}`} onclick={() => inspectNode(node.id)}>{node.tagName ?? node.tag} {node.id}</button>{/each}{#if inspected}<pre>{JSON.stringify(inspected,null,2)}</pre>{/if}</aside>{/if}
  </main>
  {#if tab?.phase === 'loading'}<div class="chrome-loading" role="progressbar" aria-label="Loading local page"></div>{/if}
  {#if metadata.era !== 'refresh' && downloads.length}
    <footer class="chrome-download-shelf">{#each downloads.slice(-3) as row}<button data-browser-control={`shelf:${row.id}`} onclick={() => ask(row.status === 'complete' ? 'download.open' : 'panel', row.status === 'complete' ? { id: row.id } : { panel: 'downloads' })}>⇩ {row.name} · {row.progress}%</button>{/each}<button data-browser-control="downloads-all" onclick={() => ask('panel', { panel: 'downloads' })}>Show all</button></footer>
  {/if}
  {#if error}<div class="chrome-operation-error" role="status">{error}</div>{/if}
</section>

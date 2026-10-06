<script>
  import { pages } from './windows11-edge.js';
  let { native, execute } = $props();
  const state = $derived(native.apps.edge);
  const tab = $derived(state.tabs.find(t => t.id === state.activeTabId));
  const page = $derived(pages.find(p => p.id === tab.entries[tab.index]));
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const go = address => send('win11.edge.navigate', { tabId: tab.id }, { address });
  const menu = () => send('win11.apps.menu', { appId: 'edge' }, { menu: state.ui.menu ? null : 'browser' });
</script>
<div class="edge-app">
  <div class="edge-workspace" inert={!!state.ui.dialog}>
  <div class="tabs" aria-label="Browser tabs" data-area="edge-tabs" onscroll={e => send('win11.apps.scroll.observe', { appId: 'edge', area: 'edge-tabs' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
    {#each state.tabs as item (item.id)}
      <div class:active={item.id === tab.id} class="tab">
        <button data-control={`edge-tab-${item.id}`} onclick={() => send('win11.edge.tab.select', { tabId: item.id })}>{pages.find(p => p.id === item.entries[item.index]).title}</button>
        <button data-control={`edge-close-${item.id}`} aria-label="Close tab" disabled={state.tabs.length === 1} onclick={() => send('win11.edge.tab.close', { tabId: item.id })}>×</button>
      </div>
    {/each}
    <button class="new-tab" data-control="edge-new-tab" aria-label="New tab" onclick={() => send('win11.edge.tab.new')}>+</button>
  </div>
  <form class="w11-app-toolbar address-bar" onsubmit={e => { e.preventDefault(); go(tab.draft); }}>
    <button type="button" data-control="edge-back" aria-label="Back" disabled={tab.index === 0} onclick={() => send('win11.edge.back', { tabId: tab.id })}>←</button>
    <button type="button" data-control="edge-forward" aria-label="Forward" disabled={tab.index + 1 >= tab.entries.length} onclick={() => send('win11.edge.forward', { tabId: tab.id })}>→</button>
    <button type="button" data-control="edge-home" aria-label="Local start page" onclick={() => go('jester://start')}>⌂</button>
    <input class="w11-app-input" data-control="edge-address" aria-label="Local address" value={tab.draft} oninput={e => send('win11.edge.address', { tabId: tab.id }, { value: e.currentTarget.value })}/>
    <button type="submit" data-control="edge-go">Go</button>
    <button type="button" data-control="edge-menu" aria-label="Browser menu" onclick={menu}>···</button>
  </form>
  {#if state.ui.menu === 'browser'}
    <div class="w11-app-menu">
      <button data-control="edge-menu-new" onclick={() => send('win11.edge.tab.new')}>New tab</button>
      <button data-control="edge-menu-new-window" onclick={() => send('window.create', { appId: 'edge' })}>New window <span>Ctrl+N</span></button>
      <button data-control="edge-menu-exit" onclick={() => send('app.quit', { appId: 'edge' })}>Exit</button>
      <button data-control="edge-menu-history" onclick={() => send('win11.edge.history.show')}>History</button>
      <button data-control="edge-menu-about" onclick={() => go('jester://about')}>About this local browser</button>
    </div>
  {/if}
  <nav class="local-links" aria-label="Local pages">{#each pages as p}<button data-control={`edge-page-${p.id}`} onclick={() => go(p.address)}>{p.title}</button>{/each}<span>OFFLINE · AUTHORED PAGES</span></nav>
  <main class="w11-app-content local-page" data-area="edge-page" onscroll={e => send('win11.apps.scroll.observe', { appId: 'edge', area: 'edge-page' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
    <div class="page-eyebrow">JESTER STUDIO / LOCAL DESK</div>
    <h1>{page.heading}</h1><p class="lede">{page.description}</p>
    <div class="cards">{#each page.sections as section}<section><h2>{section.title}</h2><p>{section.body}</p></section>{/each}</div>
    <p class="local-note">Available addresses: {pages.map(p => p.address).join(' · ')}</p>
  </main>
  </div>
  {#if state.ui.dialog === 'history'}
    <div class="dialog-shade">
    <div class="w11-app-dialog history-dialog" role="dialog" aria-modal="true" aria-label="Browsing history">
      <h2>History</h2><p>Local pages visited in this session.</p>
      <div class="history-list" data-area="edge-history" onscroll={e => send('win11.apps.scroll.observe', { appId: 'edge', area: 'edge-history' }, { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
        {#each state.history as entry (entry.id)}<button data-control={`edge-history-${entry.id}`} onclick={() => send('win11.edge.history.open', { historyId: entry.id })}>{pages.find(p => p.id === entry.pageId).title}<small>{pages.find(p => p.id === entry.pageId).address}</small></button>{:else}<p>No local browsing history.</p>{/each}
      </div>
      <div class="dialog-actions"><button data-control="edge-history-clear" onclick={() => send('win11.edge.history.clear')}>Clear history</button><button data-control="edge-history-close" onclick={() => send('win11.edge.dialog.close')}>Close</button></div>
    </div>
    </div>
  {/if}
  <div class="w11-app-status">{page.address} · No Internet connection is used</div>
</div>
<style>
  .edge-app{height:100%;display:flex;flex-direction:column;position:relative;background:var(--w11-theme-card,#fff);color:var(--w11-theme-text,#242424);min-width:0}.tabs{display:flex;align-items:center;gap:4px;background:var(--w11-theme-chrome,#e4eaf0);padding:6px 8px 0;overflow-x:auto;flex-shrink:0}.tab{display:flex;min-width:115px;max-width:210px;border-radius:8px 8px 0 0}.tab.active{background:var(--w11-theme-surface,#f9fafb)}.tab button{background:transparent;border:0;padding:9px;white-space:nowrap}.tab button:first-child{flex:1;overflow:hidden;text-overflow:ellipsis;text-align:left}.new-tab{border:0;background:transparent;font-size:22px;padding:4px 10px}.address-bar{gap:7px;padding:8px;flex-wrap:nowrap}.address-bar button{border:0;border-radius:5px;background:transparent;padding:6px 9px;font-size:17px}.address-bar input{flex:1;min-width:50px;border-radius:18px;background:var(--w11-theme-card,#edf0f3);padding:7px 15px}.local-links{display:flex;align-items:center;gap:5px;padding:5px 12px;border-bottom:1px solid var(--w11-theme-border,#ddd);flex-wrap:wrap;font-size:11px}.local-links button{background:none;border:0;padding:5px}.local-links span{margin-left:auto;color:#687b8b;font-size:9px;letter-spacing:.08em}.local-page{padding:42px clamp(18px,5vw,60px);background:linear-gradient(145deg,#f7fafb,#e8f1f4);flex:1;overflow:auto;color:#242424}.page-eyebrow{font-size:10px;letter-spacing:.18em;color:#56747a}h1{font-size:clamp(24px,3vw,38px);font-weight:600;letter-spacing:-.035em;max-width:600px;margin:15px 0}.lede{color:#53656b;line-height:1.6;max-width:540px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-top:28px}.cards section{background:#ffffffd9;border:1px solid #d9e4e9;border-radius:9px;padding:22px}.cards h2{font-size:17px;font-weight:600;margin:0 0 12px}.cards p{font-size:13px;line-height:1.7;margin:0;color:#536069}.local-note{font-size:11px;color:#65767c;line-height:1.8;margin-top:28px}.history-dialog{max-width:420px}.history-list{max-height:240px;overflow:auto}.history-list button{display:block;width:100%;text-align:left;padding:10px;border:0;border-bottom:1px solid var(--w11-theme-border,#ddd);background:transparent}.history-list small{display:block;color:var(--w11-theme-muted,#666);margin-top:3px}.dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
  .edge-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}.dialog-shade{position:absolute;inset:0;display:grid;place-items:center;background:#0003;padding:14px;z-index:20}.dialog-shade .history-dialog{position:relative;inset:auto;transform:none;width:min(420px,100%);margin:0}
</style>

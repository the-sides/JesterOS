<script>
  import { liveFile, isTrashed, pathOf } from './windows11-app-helpers.js';
  let { native, execute } = $props();
  const apps = $derived(native.apps);
  const state = $derived(apps.notepad);
  const tab = $derived(state.tabs.find(item => item.id === state.activeTabId));
  const dialog = $derived(state.ui.dialog);
  const files = $derived(apps.files.filter(file => file.kind === 'text' && !isTrashed(apps, file)));
  const folders = $derived(apps.files.filter(file => file.kind === 'folder' && !isTrashed(apps, file)));
  const position = $derived(tab ? tab.content.slice(0, tab.selectionStart).split('\n') : ['']);
  const send = (command, target = {}, payload = {}) => execute({ command, target, payload });
  const menu = id => send('win11.apps.menu', { appId: 'notepad' }, { menu: state.ui.menu === id ? null : id });
  function selection(event) {
    // Native select events can arrive after the editor's component is removed.
    if (!event.currentTarget.isConnected) return;
    const current = tab;
    if (current) return send('win11.notepad.selection', { tabId: current.id }, { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
  }
  function keys(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (['s', 'n', 'o', 'f'].includes(key)) {
      event.preventDefault();
      if (dialog) return;
      if (key === 's') event.shiftKey ? send('win11.notepad.dialog.open', {}, { kind: 'save-as' }) : send('win11.notepad.save', { tabId: tab.id });
      if (key === 'n') send('win11.notepad.new');
      if (key === 'o') send('win11.notepad.dialog.open', {}, { kind: 'open' });
      if (key === 'f') send('win11.notepad.dialog.open', {}, { kind: 'find' });
    }
  }
</script>
<div class="notepad">
  <div class="tab-strip" inert={!!dialog}>
    {#each state.tabs as item (item.id)}<div class="tab" class:active={item.id === state.activeTabId}>
      <button class="tab-title" data-control={`notepad-tab-${item.id}`} onclick={() => send('win11.notepad.activate', { tabId: item.id })}>{liveFile(apps, item.fileId)?.name || item.title}{item.content !== item.savedContent ? ' •' : ''}</button>
      <button class="tab-close" data-control={`notepad-close-${item.id}`} aria-label={`Close ${item.title}`} onclick={() => send('win11.notepad.closeTab', { tabId: item.id })}>×</button>
    </div>{/each}
    <button class="new-tab" data-control="notepad-new-tab" aria-label="New tab" onclick={() => send('win11.notepad.new')}>＋</button>
  </div>
  <div class="w11-app-toolbar menus" inert={!!dialog}>{#each ['file', 'edit', 'view'] as id}<button data-control={`notepad-menu-${id}`} onclick={() => menu(id)}>{id[0].toUpperCase() + id.slice(1)}</button>{/each}</div>
  {#if state.ui.menu && !dialog}<div class="w11-app-menu dropdown">
    {#if state.ui.menu === 'file'}
      <button data-control="notepad-file-new" onclick={() => send('win11.notepad.new')}>New tab <span>Ctrl+N</span></button>
      <button data-control="notepad-file-open" onclick={() => send('win11.notepad.dialog.open', {}, { kind: 'open' })}>Open… <span>Ctrl+O</span></button>
      <button data-control="notepad-file-save" onclick={() => send('win11.notepad.save', { tabId: tab.id })}>Save <span>Ctrl+S</span></button>
      <button data-control="notepad-file-save-as" onclick={() => send('win11.notepad.dialog.open', {}, { kind: 'save-as' })}>Save as… <span>Ctrl+Shift+S</span></button>
      <hr/><button data-control="notepad-file-close-tab" onclick={() => send('win11.notepad.closeTab', { tabId: tab.id })}>Close tab</button>
      <button data-control="notepad-file-exit" onclick={() => send('win11.notepad.requestWindowClose')}>Exit</button>
    {:else if state.ui.menu === 'edit'}
      <button data-control="notepad-edit-find" onclick={() => send('win11.notepad.dialog.open', {}, { kind: 'find' })}>Find… <span>Ctrl+F</span></button>
      <p class="limitation">Text selection and editing use the native local editor. No system clipboard access.</p>
    {:else}
      <button data-control="notepad-view-wrap" onclick={() => send('win11.notepad.wrap', {}, { enabled: !state.wordWrap })}>Word wrap {state.wordWrap ? '✓' : ''}</button>
      <p class="limitation">Session restore disabled: open a new session. Unsaved changes prompt on close.</p>
    {/if}
  </div>{/if}
  {#if tab}<textarea class="editor" class:nowrap={!state.wordWrap} data-control="notepad-editor" data-area="notepad-editor" aria-label="Document text" spellcheck="false" value={tab.content} wrap={state.wordWrap ? 'soft' : 'off'} inert={!!dialog} oninput={event => send('win11.notepad.edit', { tabId: tab.id }, { content: event.currentTarget.value })} onselect={selection} onkeyup={selection} onclick={selection} onkeydown={keys} onscroll={event => send('win11.apps.scroll.observe', { appId: 'notepad', area: 'notepad-editor' }, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}></textarea>{/if}
  <div class="w11-app-status"><span>Ln {position.length}, Col {position.at(-1).length + 1}</span><span>Session restore off</span><span>{tab?.content.includes('\r\n') ? 'Windows (CRLF)' : 'Unix (LF)'}</span><span>UTF-8</span></div>
  {#if dialog}<div class="dialog-shade" role="dialog" aria-modal="true" aria-label={dialog.kind === 'close' ? 'Save changes' : dialog.kind}><section class="w11-app-dialog">{#if dialog.kind === 'close'}
    <h3>Do you want to save changes to {state.tabs.find(item => item.id === dialog.tabId)?.title}?</h3><p>Your changes will be lost if you don't save them.</p>
    <div class="dialog-actions"><button class="w11-app-button primary" data-control="notepad-close-save" onclick={() => send('win11.notepad.close.resolve', {}, { action: 'save' })}>Save</button><button class="w11-app-button" data-control="notepad-close-discard" onclick={() => send('win11.notepad.close.resolve', {}, { action: 'discard' })}>Don't save</button><button class="w11-app-button" data-control="notepad-close-cancel" onclick={() => send('win11.notepad.close.resolve', {}, { action: 'cancel' })}>Cancel</button></div>
  {:else if dialog.kind === 'open'}
    <h3>Open</h3><label>Text file<select data-control="notepad-open-file" value={dialog.fileId} onchange={event => send('win11.notepad.dialog.change', {}, { field: 'fileId', value: event.currentTarget.value })}><option value="">Choose a file</option>{#each files as file}<option value={file.id}>{pathOf(apps, file.id)}</option>{/each}</select></label>
    <p>Files are stored in this scene, not on your computer.</p><div class="dialog-actions"><button class="w11-app-button primary" data-control="notepad-open-commit" disabled={!dialog.fileId} onclick={() => send('win11.notepad.dialog.commit')}>Open</button><button class="w11-app-button" data-control="notepad-open-cancel" onclick={() => send('win11.notepad.dialog.cancel')}>Cancel</button></div>
  {:else if dialog.kind === 'save-as'}
    <h3>Save as</h3><label>Folder<select data-control="notepad-save-folder" value={dialog.folderId} onchange={event => send('win11.notepad.dialog.change', {}, { field: 'folderId', value: event.currentTarget.value })}>{#each folders as file}<option value={file.id}>{pathOf(apps, file.id)}</option>{/each}</select></label>
    <label>File name<input class="w11-app-input" data-control="notepad-save-name" value={dialog.name} oninput={event => send('win11.notepad.dialog.change', {}, { field: 'name', value: event.currentTarget.value })}/></label><p>UTF-8 · Existing names are not overwritten.</p>
    <div class="dialog-actions"><button class="w11-app-button primary" data-control="notepad-save-commit" onclick={() => send('win11.notepad.dialog.commit')}>Save</button><button class="w11-app-button" data-control="notepad-save-cancel" onclick={() => send('win11.notepad.dialog.cancel')}>Cancel</button></div>
  {:else if dialog.kind === 'find'}
    <h3>Find</h3><label>Find what<input class="w11-app-input" data-control="notepad-find-query" value={dialog.query} oninput={event => send('win11.notepad.dialog.change', {}, { field: 'query', value: event.currentTarget.value })}/></label>
    <p aria-live="polite">{state.findMessage}</p><div class="dialog-actions"><button class="w11-app-button" data-control="notepad-find-previous" onclick={() => send('win11.notepad.find', { tabId: dialog.tabId }, { query: dialog.query, matchCase: state.matchCase, direction: 'previous' })}>Previous</button><button class="w11-app-button primary" data-control="notepad-find-next" onclick={() => send('win11.notepad.dialog.commit')}>Find next</button><button class="w11-app-button" data-control="notepad-find-match" aria-pressed={state.matchCase} onclick={() => send('win11.notepad.find', { tabId: dialog.tabId }, { query: dialog.query, matchCase: !state.matchCase, direction: 'next' })}>Match case {state.matchCase ? '✓' : ''}</button><button class="w11-app-button" data-control="notepad-find-close" onclick={() => send('win11.notepad.dialog.cancel')}>Close</button></div>
  {/if}</section></div>{/if}
</div>
<style>
  .notepad{display:flex;flex-direction:column;height:100%;min-width:0;position:relative;background:#fff;color:#222;font:13px 'Segoe UI',sans-serif}.tab-strip{display:flex;align-items:center;gap:3px;background:#f3f3f3;padding:5px 8px 0;overflow-x:auto;min-height:38px}.tab{display:flex;min-width:130px;max-width:200px;border-radius:7px 7px 0 0;background:#ececec}.tab.active{background:#fff}.tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;padding:8px 12px}.tab button,.new-tab,.menus button{background:none;border:0;color:inherit;font:inherit}.tab-close{padding:5px 9px}.new-tab{font-size:20px;padding:5px 12px}.menus{padding:3px 8px;gap:3px;border-bottom:1px solid #eee;min-height:34px}.menus button{padding:6px 12px;border-radius:4px}.menus button:hover{background:#eee}.editor{flex:1;min-height:0;resize:none;outline:none;border:0;padding:14px 16px;background:#fff;color:#202020;font:15px/1.5 Consolas,'Courier New',monospace;tab-size:4;overflow:auto;white-space:pre-wrap}.editor.nowrap{white-space:pre}.w11-app-status{display:flex;gap:24px;background:#f6f6f6;border-top:1px solid #e8e8e8;padding:6px 14px;font-size:12px}.w11-app-status span:first-child{flex:1}.dropdown{position:absolute;top:72px;left:8px;z-index:3;width:265px}.dropdown button{display:flex;justify-content:space-between;width:100%;text-align:left;padding:8px}.dropdown button span{color:#777}.limitation{padding:7px 10px;font-size:12px;color:#666}.dialog-shade{position:absolute;inset:0;background:#0003;display:grid;place-items:center;z-index:5}.w11-app-dialog{width:min(460px,90%);background:#f9f9f9;padding:22px;border-radius:8px;border:1px solid #ccc;box-shadow:0 12px 35px #0003}.w11-app-dialog h3{font-size:18px;font-weight:600;margin:0 0 18px}.w11-app-dialog label{display:grid;gap:7px;margin:15px 0}.w11-app-dialog input,.w11-app-dialog select{width:100%;box-sizing:border-box;padding:8px}.w11-app-dialog p{color:#666}.dialog-actions{display:flex;justify-content:flex-end;gap:7px;flex-wrap:wrap;margin-top:22px}.primary{background:#0067c0;color:#fff}@media(max-width:500px){.w11-app-status{gap:10px}.w11-app-status span:nth-child(3){display:none}.tab{min-width:115px}.w11-app-dialog{padding:16px}}
</style>

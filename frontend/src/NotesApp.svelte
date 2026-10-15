<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import NotesAttachmentPreview from './notes-workspace-attachment-preview.svelte';
  import { notesWorkspaceWindow, visibleWorkspaceNotes, noteWorkspaceTitle, noteWorkspacePreview, noteWorkspaceLocked, notesWorkspaceGroupLabel } from './notes-workspace-state.js';
  import { runsText, selectionRuns, fontSelection } from './notes-workspace-document.js';
  import { createNotesWorkspaceNativeView } from './notes-workspace-native-view.js';
  import { notesWorkspaceMenuProvider } from './notes-workspace-menus.js';
  import { copyCanonicalData } from './canonical-data.js';
  import './notes-workspace.css';
  import { createDocumentFonts } from './document-fonts.svelte.js';
  let { state: notesData, profile, windowId, execute, registerView, available = true, active = true, controls = {}, getShared = name => controls.getShared?.(name), getFile = id => controls.getFile?.(id) } = $props();
  let root = $state(null), editor, list, facade = $state(null);
  let editorEpoch = $state(0);
  let retired = false, mountedState, mountedProfile, mountedWindowId;
  let message = $state(''), folderName = $state(''), accountName = $state(''), accountKind = $state('icloud'), sourceId = $state('local'), secret = $state(''), hint = $state(''), participantName = $state(''), attachmentFileId = $state(''), exportName = $state('Note.html'), exportFormat = $state('html');
  const session = $derived(notesWorkspaceWindow(notesData, windowId));
  const notes = $derived(visibleWorkspaceNotes(notesData, session));
  const selected = $derived(notesData.notes.find(note => note.id === session?.selectedId));
  const sheetNote = $derived(notesData.notes.find(note => note.id === session?.sheetNoteId) ?? selected);
  const windows = $derived(profile.id.startsWith('windows11'));
  const classic = $derived(/high-sierra|mojave/.test(profile.id));
  const sierra = $derived(profile.id.includes('high-sierra'));
  const golden = $derived(profile.id.includes('golden-gate'));
  const locked = $derived(noteWorkspaceLocked(selected));
  const readonly = $derived(!selected || locked || selected.deletedAt !== null || selected.collaboration.enabled && selected.collaboration.permission === 'view');
  const menus = $derived(notesWorkspaceMenuProvider({ state: notesData, profile, windowId }));
  const currentMenu = $derived(menus.find(menu => menu.id === session?.menu));
  const currentTable = $derived(selected?.document.blocks.find(block => block.id === session?.selection?.blockId && block.type === 'table'));
  const contextNote = $derived(notesData.notes.find(note => note.id === session?.contextNoteId));
  const formatDate = value => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(value);
  const toolbarItems = $derived(windows ? session?.standalone ? ['new', 'spacer', 'more'] : ['new', 'spacer', 'search', 'settings', 'more'] : classic ? ['sidebar', 'browser', 'trash', 'new', 'spacer', 'lock', 'table', 'check', 'format', ...(!sierra ? ['attachment'] : []), 'collaboration', 'share', 'search'] : ['sidebar', 'list', 'gallery', 'trash', 'new', 'spacer', 'format', 'check', 'table', 'attachment', 'lock', 'collaboration', 'share', 'search']);
  const toolLabel = kind => ({ sidebar: 'Show or hide folders', browser: 'Attachments Browser', trash: selected?.deletedAt !== null ? 'Restore note' : 'Delete note', new: 'New note', lock: locked ? 'Unlock note' : selected?.lock ? 'Close locked note' : 'Lock note', table: 'Table', check: 'Checklist', format: 'Formatting', attachment: 'Add attachment', collaboration: 'Add People · fictional local collaboration', share: 'Share note', list: 'List view', gallery: 'Gallery view', settings: 'Settings', more: 'More local actions' })[kind];
  const toolDisabled = kind => ['format', 'check', 'table', 'attachment'].includes(kind) ? readonly : kind === 'trash' ? !selected : kind === 'lock' ? !selected || selected.deletedAt !== null : kind === 'collaboration' ? !selected || locked || !!selected.lock || selected.deletedAt !== null : kind === 'share' ? !selected || locked : false;
  const documentFonts = createDocumentFonts({ getShared: name => getShared(name), getFile: id => getFile(id), getRoot: () => root, getOwner: () => [notesData, profile, windowId, session] });
  const selectedFont = $derived.by(() => { const runs = selected && selectionRuns(selected.document, session.selection); let offset = 0; for (const run of runs ?? []) { offset += run.text.length; if (session.selection.start < offset || run === runs.at(-1)) return run.font ?? (selected.document.blocks.find(block => block.id === session.selection.blockId)?.style === 'monospaced' ? 'Liberation Mono' : 'Liberation Sans'); } return 'Liberation Sans'; });
  function setFont(font) { if (readonly || !selected || !documentFonts.has(font)) return; const selection = facade?.captureSelection(); if (!selection) return; const document = copyCanonicalData(selected.document); if (fontSelection(document, selection, font)) command('document.set', { noteId: selected.id, revision: selected.revision, document, selection }); }
  function toolbarAction(kind) {
    if (kind === 'new') return command('create');
    if (kind === 'sidebar') return command('view.set', { sidebarVisible: session.standalone ? true : !session.sidebarVisible, standalone: false });
    if (kind === 'browser') return command('folder.select', { folderId: 'attachments' });
    if (kind === 'trash') return command(selected.deletedAt !== null ? 'restore' : 'trash', { noteId: selected.id });
    if (kind === 'lock') return selected.lock?.unlocked ? command('relock', { noteId: selected.id }) : openSheet(locked ? 'unlock' : 'lock', selected.id);
    if (kind === 'table') return tableAction('insert');
    if (kind === 'check') return command('format', { kind: 'list', value: 'check' });
    if (kind === 'format' || kind === 'more') return command('menu.set', { menu: session.menu === (kind === 'format' ? 'format' : 'file') ? null : kind === 'format' ? 'format' : 'file' });
    if (kind === 'attachment' || kind === 'collaboration') return openSheet(kind === 'attachment' ? 'attachments' : 'collaboration', selected.id);
    if (kind === 'share') return command('share', { noteId: selected.id });
    if (kind === 'list' || kind === 'gallery') return command('view.set', { mode: kind, standalone: false });
    if (kind === 'settings') return openSheet('preferences');
  }
  async function command(suffix, payload = {}) {
    if (retired || mountedState && (notesData !== mountedState || profile !== mountedProfile || windowId !== mountedWindowId)) return { status: 'rejected', error: { code: 'stale_target', message: 'The original Notes surface has retired.' } };
    const result = await execute({ command: `notes.${suffix}`, target: { windowId }, payload });
    if (!retired) message = result?.status === 'applied' ? '' : result?.error?.message ?? 'The actual local action is unavailable.';
    return result;
  }
  async function menuAction(item) {
    if (!item.enabled || !item.request) return;
    const originalState = notesData, originalSession = session, result = await command('menu.set', { menu: null });
    if (retired || result.status !== 'applied' || notesData !== originalState || session?.windowId !== originalSession?.windowId) return;
    const action = await execute(item.request); if (!retired) message = action?.status === 'applied' ? '' : action?.error?.message ?? 'The local action is unavailable.';
  }
  function observeSelection() { const selection = facade?.captureSelection(); if (selection && selected && !readonly) command('selection.set', { noteId: selected.id, revision: selected.revision, selection }); }
  async function editInput() {
    const original = selected, originalFacade = facade, revision = original?.revision, capture = facade?.captureDocument(); if (!capture || !original || readonly) return;
    const result = await command('document.set', { noteId: original.id, revision, ...capture });
    const expectedRevision = result?.status === 'applied' ? revision + 1 : revision;
    if (!retired && selected === original && original.revision === expectedRevision && facade === originalFacade && facade.available()) {
      // Native contenteditable input can replace Svelte-owned run spans. Rebuild
      // from the acknowledged rich document before subsequent mark updates.
      editorEpoch++; await tick();
      if (!retired && selected === original && original.revision === expectedRevision && facade === originalFacade && facade.available()) facade.restoreSelection(session.selection);
    }
  }
  function beforeInput(event) {
    if (readonly) { event.preventDefault(); return; }
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); command(event.inputType === 'historyUndo' ? 'undo' : 'redo'); }
    if (['insertParagraph', 'insertLineBreak'].includes(event.inputType)) { event.preventDefault(); command('insert', { text: '\n' }); }
    if (['insertFromPaste', 'insertFromDrop', 'deleteByCut'].includes(event.inputType)) event.preventDefault();
  }
  function editorKey(event) {
    if (event.key === 'Tab' && event.target.closest('td')) { event.preventDefault(); command('table.navigate', { backwards: event.shiftKey }); }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !readonly) {
      const range = facade.captureSelection(); if (!range || range.row !== -1 || range.start !== range.end) return;
      const at = selected.document.blocks.findIndex(block => block.id === range.blockId), block = selected.document.blocks[at], previous = selected.document.blocks[at - 1], next = selected.document.blocks[at + 1];
      if (event.key === 'Backspace' && range.start === 0 && previous?.type === 'paragraph' || event.key === 'Delete' && range.start === runsText(block.runs).length && next?.type === 'paragraph') {
        event.preventDefault(); const document = copyCanonicalData(selected.document), from = event.key === 'Backspace' ? at - 1 : at, left = document.blocks[from], right = document.blocks[from + 1], offset = runsText(left.runs).length; left.runs.push(...right.runs); document.blocks.splice(from + 1, 1);
        command('document.set', { noteId: selected.id, revision: selected.revision, document, selection: { blockId: left.id, row: -1, column: -1, start: offset, end: offset, direction: 'none' } });
      }
    }
  }
  function keyboard(event) {
    if (!active || !root?.contains(document.activeElement)) return;
    if (event.key === 'Escape') { if (session?.sheet !== 'none') command('sheet.close'); else if (session?.contextNoteId) command('context.set', { noteId: null }); else command('menu.set', { menu: null }); return; }
    if (!(windows ? event.ctrlKey : event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); command('create'); }
    if (key === 'f') { event.preventDefault(); command('focus', { controlId: 'search' }); }
    if (key === 'z') { event.preventDefault(); command(event.shiftKey ? 'redo' : 'undo'); }
    if (key === 'y' && windows) { event.preventDefault(); command('redo'); }
    if (['b', 'i', 'u'].includes(key)) { event.preventDefault(); command('format', { kind: 'mark', value: { b: 'bold', i: 'italic', u: 'underline' }[key] }); }
    if (key === 'p' && selected) { event.preventDefault(); command('print', { noteId: selected.id }); }
    if (key === 'w') { event.preventDefault(); command('window.close'); }
  }
  function clipboard(event, operation) {
    if (event.target.closest('[data-notes-editable], [data-notes-control="search"]')) {
      event.preventDefault(); event.stopPropagation(); command('clipboard', { operation });
    }
  }
  async function drop(event) {
    event.preventDefault(); if (readonly || !selected) return;
    const raw = event.dataTransfer?.getData('application/x-jesteros-file-ids') || event.dataTransfer?.getData('application/x-jesteros-file-id');
    if (!raw) { message = 'Drag actual local Files records; host files are not imported.'; return; }
    let ids; try { const decoded = JSON.parse(raw); ids = Array.isArray(decoded) ? decoded : [decoded]; } catch { ids = [raw]; }
    for (const fileId of ids) if (typeof fileId === 'string') await command('attachment.add', { noteId: selected.id, fileId });
  }
  function rowKey(event, index) {
    let next; if (event.key === 'ArrowDown') next = Math.min(notes.length - 1, index + 1); else if (event.key === 'ArrowUp') next = Math.max(0, index - 1); else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = notes.length - 1; else if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); command('context.set', { noteId: notes[index].id }); return; } else return;
    event.preventDefault(); const id = notes[next].id; command('select', { noteId: id }).then(result => { if (!retired && result.status === 'applied' && selected?.id === id) facade?.focus(`row-${id}`); });
  }
  const attachmentGuards = new WeakMap();
  function attachmentGuard(note, attachment) {
    if (!root || !facade) return () => false;
    let map = attachmentGuards.get(note); if (!map) { map = new WeakMap(); attachmentGuards.set(note, map); }
    if (!map.has(attachment)) { const originalRoot = root, originalFacade = facade; map.set(attachment, () => !retired && root === originalRoot && facade === originalFacade && facade?.available() && notesData.notes.find(row => row.id === note.id) === note && !noteWorkspaceLocked(note) && note.attachments.includes(attachment) && selected === note); } return map.get(attachment);
  }
  function openSheet(sheet, noteId) { secret = ''; hint = ''; folderName = ''; participantName = ''; command('sheet.open', { sheet, ...(noteId ? { noteId } : {}) }); }
  function preference(key, value) { command('preferences.set', { preferences: { ...notesData.preferences, [key]: value } }); }
  function tableAction(operation) { command('table', { operation, ...(operation !== 'insert' && currentTable ? { blockId: currentTable.id, row: session.selection.row, column: session.selection.column } : {}) }); }
  onMount(() => {
    mountedState = notesData; mountedProfile = profile; mountedWindowId = windowId;
    facade = createNotesWorkspaceNativeView({ root: () => root, editor: () => editor, list: () => list, state: () => notesData, window: () => session, note: () => selected }); registerView(windowId, facade);
    const originalFacade = facade; return () => { retired = true; registerView(mountedWindowId, null, originalFacade); facade = null; };
  });
</script>

{#snippet symbol(name)}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if name === 'new'}<path d="M20 13v8H3V4h10M9 16l1-5L19 2l3 3-9 9-4 2Z" />
    {:else if name === 'folder'}<path d="M3 7V5h7l2 2h9v13H3Z" />
    {:else if name === 'trash'}<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    {:else if name === 'sidebar'}<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5 8h2m-2 4h2" />
    {:else if name === 'check'}<circle cx="6" cy="7" r="3" /><path d="m4 7 2 2 3-4M12 7h9M3 17h6m3 0h9" />
    {:else if name === 'table'}<rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M11 5v14" />
    {:else if name === 'attachment'}<path d="m8 13 8-8a4 4 0 0 1 6 6L11 22a6 6 0 0 1-9-9L13 2m-8 13 9-9a2 2 0 0 1 3 3l-9 9" />
    {:else if name === 'lock'}<rect x="5" y="10" width="14" height="12" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3" />
    {:else if name === 'share'}<path d="M5 9v12h14V9M12 16V2m-4 4 4-4 4 4" />
    {:else if name === 'search'}<circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" />
    {:else if name === 'pin'}<path d="M8 3h8l-1 6 4 4H5l4-4-1-6ZM12 13v8" />
    {/if}
  </svg>
{/snippet}
{#snippet richRuns(runs, baseFont = 'Liberation Sans')}
  {#each runs as run}<span class:rich-bold={run.marks.includes('bold')} class:rich-italic={run.marks.includes('italic')} class:rich-underline={run.marks.includes('underline')} class:rich-strike={run.marks.includes('strike')} data-font={run.font} style:font-family={documentFonts.css(run.font ?? baseFont, run.marks.includes('bold'), run.marks.includes('italic'), baseFont === 'Liberation Mono' ? 'monospace' : 'sans-serif')} data-bold={run.marks.includes('bold')} data-italic={run.marks.includes('italic')} data-underline={run.marks.includes('underline')} data-strike={run.marks.includes('strike')}>{run.text}</span>{/each}
{/snippet}
<svelte:window onkeydown={keyboard} />
<section class="notes-workspace" class:notes-classic={classic} class:notes-sierra={sierra} class:notes-golden={golden} class:notes-sticky={windows} class:standalone={session?.standalone} class:inactive={!active} class:folders-hidden={!session?.sidebarVisible} class:dark={notesData.preferences.theme === 'dark' || notesData.preferences.theme === 'system' && controls.dark === true} bind:this={root} aria-label={windows ? 'Sticky Notes' : 'Notes'} inert={!available} oncopy={event => clipboard(event, 'copy')} oncut={event => clipboard(event, 'cut')} onpaste={event => clipboard(event, 'paste')}>
  <header class="notes-workspace-toolbar" data-sticky-color={selected?.color ?? 'yellow'} data-window-drag>
    {#if !windows}<WindowControls {active} {...controls} onfullscreen={controls.onscreen ?? controls.onfullscreen} ongreenmenu={controls.green ?? controls.ongreenmenu} onsplitbegin={controls.split ?? controls.onsplitbegin} />{/if}
    {#each toolbarItems as item}
      {#if item === 'spacer'}<div class="notes-toolbar-spacer"></div>
      {:else if item === 'search'}<label class="notes-search" data-window-no-drag>{@render symbol('search')}<input type="search" placeholder={windows ? 'Search…' : 'Search'} aria-label="Search notes" data-notes-control="search" value={session?.query ?? ''} oninput={event => command('search', { query: event.currentTarget.value })} /></label>
      {:else}<button aria-label={toolLabel(item)} title={toolLabel(item)} data-window-no-drag data-notes-control={item === 'new' ? 'new-note' : item} disabled={toolDisabled(item)} onpointerdown={event => { if (['format', 'check', 'table'].includes(item)) event.preventDefault(); }} onclick={() => toolbarAction(item)}>
        {#if item === 'format'}<span class="notes-format-icon">Aa</span>
        {:else if item === 'list'}<span class="notes-mode-icon">☷</span>
        {:else if item === 'gallery' || item === 'browser'}<span class="notes-mode-icon">⊞</span>
        {:else if item === 'collaboration'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M19 10v8m-4-4h8"/></svg>
        {:else if item === 'settings'}<span class="notes-mode-icon">⚙</span>
        {:else if item === 'more'}<span class="notes-mode-icon">⋯</span>
        {:else if windows && item === 'new'}<span class="notes-mode-icon">＋</span>
        {:else}{@render symbol(item === 'trash' && selected?.deletedAt !== null ? 'folder' : item)}{/if}
      </button>{/if}
    {/each}
  </header>
  {#if windows && !session?.standalone || controls.embeddedMenus === true}
    <nav class="notes-workspace-menubar" aria-label={windows ? 'Sticky Notes local action menus' : 'Notes local menu access'}>
      {#each menus as menu}<button aria-haspopup="menu" aria-expanded={session?.menu === menu.id} data-notes-control={`menu-${menu.id}`} class:chosen={session?.menu === menu.id} onpointerdown={event => event.preventDefault()} onclick={() => command('menu.set', { menu: session.menu === menu.id ? null : menu.id })}>{menu.label}</button>{/each}
    </nav>
  {/if}
  {#if windows}<div class="notes-local-disclosure">Sticky Notes · fictional local scene. Folders, rich headings, tables, password locks, collaboration, trash retention and export are disclosed local extensions, not Windows 23H2 native features.</div>{/if}
  {#if currentMenu}<div class="notes-workspace-menu" role="menu" aria-label={`${currentMenu.label} menu`}>
    {#if windows}<nav class="notes-local-menu-pages" aria-label="Disclosed local action sections">{#each menus as menu}<button aria-pressed={menu.id === currentMenu.id} onpointerdown={event => event.preventDefault()} onclick={() => command('menu.set', { menu: menu.id })}>{menu.label}</button>{/each}</nav>{/if}
    {#each currentMenu.children as item}<button role="menuitem" disabled={!item.enabled} onpointerdown={event => event.preventDefault()} onclick={() => menuAction(item)}><span>{item.checked ? '✓ ' : ''}{item.label}</span><kbd>{item.shortcut ?? ''}</kbd></button>{/each}
  </div>{/if}
  <div class="notes-workspace-columns">
    {#if session?.sidebarVisible && !session.standalone}<aside class="notes-workspace-folders" aria-label="Notes folders and fictional accounts">
      <button class:selected={session.folderId === 'all'} onclick={() => command('folder.select', { folderId: 'all' })}>{@render symbol('folder')}<span>All Notes</span><small>{notesData.notes.filter(note => note.deletedAt === null).length}</small></button>
      {#each notesData.accounts as account}<h2>{account.name}{!account.enabled ? ' · Off' : ''}</h2>{#each notesData.folders.filter(folder => folder.accountId === account.id && folder.deletedAt === null) as folder}<button class:selected={session.folderId === folder.id} disabled={!account.enabled} data-notes-control={`folder-${folder.id}`} onclick={() => command('folder.select', { folderId: folder.id })} oncontextmenu={event => { event.preventDefault(); if (!folder.builtin) command('sheet.open', { sheet: 'delete-folder', folderId: folder.id }); }}>{@render symbol('folder')}<span>{folder.name}</span><small>{notesData.notes.filter(note => note.folderId === folder.id && note.deletedAt === null).length}</small></button>{/each}{/each}
      <button class:selected={session.folderId === 'deleted'} data-notes-control="folder-deleted" onclick={() => command('folder.select', { folderId: 'deleted' })}>{@render symbol('trash')}<span>Recently Deleted</span><small>{notesData.notes.filter(note => note.deletedAt !== null).length}</small></button>
      <button class:selected={session.folderId === 'attachments'} onclick={() => command('folder.select', { folderId: 'attachments' })}>{@render symbol('attachment')}<span>Attachments</span></button>
      <button class="notes-new-folder" onclick={() => openSheet('folder')}>＋ New Folder</button>
    </aside>{/if}
    {#if !session?.standalone}
    <nav class="notes-workspace-list" class:gallery={session?.mode === 'gallery'} aria-label="Notes list" bind:this={list}>
      {#each notes as note, index (note.id)}
        {#if classic && !notesData.preferences.groupByDate && !session.query && session.folderId !== 'deleted' && ((index === 0 && note.pinned) || (index > 0 && notes[index - 1].pinned && !note.pinned))}<h3>{note.pinned ? 'Pinned' : 'Notes'}</h3>{/if}
        {#if notesData.preferences.groupByDate && notesData.preferences.sortBy !== 'title' && session.mode === 'list' && !session.query && (index === 0 || notesWorkspaceGroupLabel(note, controls.sceneTime ?? note.updatedAt) !== notesWorkspaceGroupLabel(notes[index - 1], controls.sceneTime ?? note.updatedAt))}<h3>{notesWorkspaceGroupLabel(note, controls.sceneTime ?? note.updatedAt)}</h3>{/if}
        <button class="notes-workspace-row" class:selected={note.id === selected?.id} data-sticky-color={note.color} data-notes-control={`row-${note.id}`} aria-pressed={note.id === selected?.id} onclick={() => command('select', { noteId: note.id })} onkeydown={event => rowKey(event, index)} oncontextmenu={event => { event.preventDefault(); command('context.set', { noteId: note.id }); }}><strong>{noteWorkspaceTitle(note)}</strong>{#if session.mode === 'gallery'}<div class="notes-gallery-page">{noteWorkspaceLocked(note) ? 'Locked' : noteWorkspacePreview(note)}</div>{/if}<span><time>{new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }).format(note.updatedAt)}</time> {noteWorkspacePreview(note) || (noteWorkspaceLocked(note) ? 'Password protected' : 'No additional text')}</span>{#if note.pinned}<small class="notes-row-pin">{@render symbol('pin')}</small>{/if}{#if !classic}<small>{notesData.folders.find(folder => folder.id === note.folderId)?.name}</small>{/if}</button>
      {/each}
      {#if !notes.length}<p class="notes-empty">{session?.query ? 'No matching notes' : 'No notes'}</p>{/if}
    </nav>
    {/if}
    <main class="notes-workspace-editor" data-sticky-color={selected?.color ?? 'yellow'} aria-label="Rich note editor" bind:this={editor} ondragover={event => event.preventDefault()} ondrop={drop}>
      {#if selected}
        <div class="notes-note-info"><time>{formatDate(selected.updatedAt)}</time>{#if selected.pinned}<span>Pinned</span>{/if}</div>
        {#if selected.deletedAt !== null}<div class="notes-deleted-banner">Notes are retained for 30 authored days. Restore to edit.<button onclick={() => command('restore', { noteId: selected.id })}>Restore</button><button onclick={() => command('delete.permanent', { noteId: selected.id, confirm: false })}>Delete Permanently…</button></div>{/if}
        {#if locked}<div class="notes-locked-card">{@render symbol('lock')}<h2>This note is locked.</h2><p>Fictional local password gating, not encryption.</p><button onclick={() => openSheet('unlock', selected.id)}>Enter Password…</button></div>
        {:else}
          {#if selected.collaboration.enabled}<div class="notes-collaboration-banner">Local collaboration · {selected.collaboration.permission === 'view' ? 'View only' : 'Can edit'} · {selected.collaboration.participants.map(row => row.name).join(', ') || 'No participants'}<button onclick={() => openSheet('collaboration', selected.id)}>Manage…</button></div>{/if}
          {#if currentTable && !readonly}<div class="notes-table-controls">{#each [['row.add', '+ Row'], ['row.delete', '− Row'], ['column.add', '+ Column'], ['column.delete', '− Column'], ['delete', 'Delete Table']] as action}<button onpointerdown={event => event.preventDefault()} onclick={() => tableAction(action[0])}>{action[1]}</button>{/each}</div>{/if}
          <label class="notes-font-control">Font <select data-notes-control="font-family" aria-label="Font family" value={selectedFont} disabled={readonly} onchange={event => setFont(event.currentTarget.value)}>{#each documentFonts.choices(selectedFont) as font}<option value={font} disabled={!documentFonts.has(font)}>{font}{!documentFonts.has(font) ? ' (unavailable)' : ''}</option>{/each}</select></label>
          {#key editorEpoch}
          <div class="notes-rich-document" style:font-family={documentFonts.css('Liberation Sans')} style:font-size={`${notesData.preferences.textSize}px`}>
            {#each selected.document.blocks as block, index (block.id)}
              {#if block.type === 'paragraph'}<div class="notes-rich-paragraph" class:checked={block.checked && block.list === 'check'} style:padding-left={`${block.indent * 24}px`} style:font-family={documentFonts.css(block.style === 'monospaced' ? 'Liberation Mono' : 'Liberation Sans', false, false, block.style === 'monospaced' ? 'monospace' : 'sans-serif')}>
                {#if block.list === 'check'}<button class="notes-check-toggle" aria-label={block.checked ? 'Mark unchecked' : 'Mark checked'} aria-pressed={block.checked} disabled={readonly} onclick={() => command('checklist', { blockId: block.id, checked: !block.checked })}>{block.checked ? '✓' : ''}</button>{:else if block.list !== 'none'}<span class="notes-list-marker">{block.list === 'bullet' ? '•' : `${index + 1}.`}</span>{/if}
                <div class="notes-rich-editable notes-style-{block.style}" style:font-family="inherit" role="textbox" aria-label={`${block.style} paragraph ${index + 1}`} aria-multiline="true" contenteditable={!readonly} spellcheck="false" tabindex="0" data-notes-editable data-block-id={block.id} data-row="-1" data-column="-1" oninput={editInput} onbeforeinput={beforeInput} onkeydown={editorKey} onkeyup={observeSelection} onpointerup={observeSelection} onfocus={observeSelection}>{@render richRuns(block.runs, block.style === 'monospaced' ? 'Liberation Mono' : 'Liberation Sans')}</div>
              </div>
              {:else}<table class="notes-rich-table" aria-label="Editable note table"><tbody>{#each block.rows as row, rowIndex}<tr>{#each row as cell, columnIndex}<td><div role="textbox" aria-label={`Row ${rowIndex + 1} column ${columnIndex + 1}`} contenteditable={!readonly} tabindex="0" spellcheck="false" data-notes-editable data-block-id={block.id} data-row={rowIndex} data-column={columnIndex} oninput={editInput} onbeforeinput={beforeInput} onkeydown={editorKey} onkeyup={observeSelection} onpointerup={observeSelection} onfocus={observeSelection}>{@render richRuns(cell)}</div></td>{/each}</tr>{/each}</tbody></table>{/if}
            {/each}
          </div>
          {/key}
          {#each selected.attachments as attachment (attachment.id)}<section class="notes-attachment"><NotesAttachmentPreview {attachment} readFile={controls.readFile} {windowId} guard={attachmentGuard(selected, attachment)} /><div><button onclick={() => command('attachment.open', { noteId: selected.id, attachmentId: attachment.id, reveal: false })}>Open</button><button onclick={() => command('attachment.open', { noteId: selected.id, attachmentId: attachment.id, reveal: true })}>Show in Files</button><button disabled={readonly} onclick={() => command('attachment.remove', { noteId: selected.id, attachmentId: attachment.id })}>Remove</button></div></section>{/each}
          {#if windows}<div class="notes-sticky-format" aria-label="Sticky Notes formatting bar">
            {#each [['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['strike', 'S']] as format}<button aria-label={format[0]} class="rich-{format[0]}" disabled={readonly} onpointerdown={event => event.preventDefault()} onclick={() => command('format', { kind: 'mark', value: format[0] })}>{format[1]}</button>{/each}
            <button aria-label="Bulleted list" disabled={readonly} onpointerdown={event => event.preventDefault()} onclick={() => command('format', { kind: 'list', value: 'bullet' })}>≡</button>
            <button aria-label="Add an actual local image" disabled={readonly} onclick={() => openSheet('attachments', selected.id)}>{@render symbol('attachment')}</button>
          </div>{/if}
        {/if}
      {:else}<p class="notes-editor-empty">{session?.query ? 'No matching notes' : 'No note selected'}</p>{/if}
    </main>
  </div>
  {#if contextNote}<div class="notes-context-menu" role="menu" aria-label="Note actions"><strong>{noteWorkspaceTitle(contextNote)}</strong>{#if contextNote.deletedAt !== null}<button onclick={() => command('restore', { noteId: contextNote.id })}>Restore Note</button><button onclick={() => command('delete.permanent', { noteId: contextNote.id, confirm: false })}>Delete Permanently…</button>{:else}<button onclick={() => command('pin', { noteId: contextNote.id, pinned: !contextNote.pinned })}>{contextNote.pinned ? 'Unpin' : 'Pin'} Note</button><button onclick={() => command('trash', { noteId: contextNote.id })}>Delete Note</button><label>Move to<select value={contextNote.folderId} onchange={event => command('move', { noteId: contextNote.id, folderId: event.currentTarget.value })}>{#each notesData.folders.filter(folder => folder.deletedAt === null) as folder}<option value={folder.id}>{notesData.accounts.find(account => account.id === folder.accountId)?.name} / {folder.name}</option>{/each}</select></label>{/if}<button onclick={() => command('context.set', { noteId: null })}>Close</button></div>{/if}
  {#if session?.sheet !== 'none'}<div class="notes-sheet-backdrop"><section class="notes-sheet" role="dialog" aria-modal="true" aria-label={`${session.sheet} Notes dialog`}>
    <h2>{session.sheet === 'preferences' ? windows ? 'Settings' : classic ? 'Preferences' : 'Settings' : session.sheet.replace(/-/g, ' ')}</h2>
    {#if session.sheet === 'preferences'}
      <label>Sort notes by<select value={notesData.preferences.sortBy} onchange={event => preference('sortBy', event.currentTarget.value)}><option value="date-edited">Date Edited</option><option value="date-created">Date Created</option><option value="title">Title</option></select></label>
      <label><input type="checkbox" checked={notesData.preferences.groupByDate} onchange={event => preference('groupByDate', event.currentTarget.checked)} />Group notes by date {classic || windows ? '· local extension' : ''}</label>
      <label>New notes start with<select value={notesData.preferences.defaultStyle} onchange={event => preference('defaultStyle', event.currentTarget.value)}><option value="title">Title</option><option value="heading">Heading</option><option value="body">Body</option></select></label>
      <label>Default account<select value={notesData.preferences.defaultAccountId} onchange={event => preference('defaultAccountId', event.currentTarget.value)}>{#each notesData.accounts.filter(account => account.enabled) as account}<option value={account.id}>{account.name}</option>{/each}</select></label>
      {#if !windows}<label><input type="checkbox" checked={notesData.accounts.find(account => account.id === 'local')?.enabled} disabled={notesData.preferences.defaultAccountId === 'local'} onchange={event => command('account.save', { account: { ...notesData.accounts.find(account => account.id === 'local'), enabled: event.currentTarget.checked } })} />Enable the On My Mac account</label>{/if}
      <label>Default text size <input type="range" min="12" max="24" value={notesData.preferences.textSize} oninput={event => preference('textSize', event.currentTarget.valueAsNumber)} /><span>{notesData.preferences.textSize} simulation px</span></label>
      <label><input type="checkbox" checked={notesData.preferences.sortChecked} onchange={event => preference('sortChecked', event.currentTarget.checked)} />Sort checked items automatically · local option</label>
      <label><input type="checkbox" checked={notesData.preferences.confirmDelete} onchange={event => preference('confirmDelete', event.currentTarget.checked)} />Confirm before deleting · Sticky Notes/local preference</label>
      <label>Appearance<select value={notesData.preferences.theme} onchange={event => preference('theme', event.currentTarget.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <p>No real iCloud sync. Locked-note passwords and accounts are fictional; secrets are saved in local scene data, not encrypted.</p>
    {:else if session.sheet === 'accounts'}
      <p>Fictional local account sections. No credentials, network or sync.</p>
      {#each notesData.accounts as account}<div class="notes-account-row"><strong>{account.name}</strong><label><input type="checkbox" checked={account.enabled} disabled={account.id === notesData.preferences.defaultAccountId} onchange={event => command('account.save', { account: { ...account, enabled: event.currentTarget.checked } })} />Enable</label><button disabled={['local', 'icloud', 'microsoft'].includes(account.id)} onclick={() => command('account.delete', { accountId: account.id })}>Remove</button></div>{/each}
      <label>Account name<input bind:value={accountName} /></label><label>Account type<select bind:value={accountKind}><option value="icloud">iCloud</option><option value="exchange">Exchange</option><option value="microsoft">Microsoft</option><option value="local">Local</option></select></label><button disabled={!accountName.trim()} onclick={() => command('account.save', { account: { id: `account-${notesData.nextId}`, name: accountName, kind: accountKind, enabled: true } })}>Add Fictional Account</button>
    {:else if session.sheet === 'folder'}
      <label>Folder name<input bind:value={folderName} /></label><label>Account<select bind:value={sourceId}>{#each notesData.accounts.filter(account => account.enabled) as account}<option value={account.id}>{account.name}</option>{/each}</select></label><button onclick={() => command('folder.save', { folderId: session.sheetFolderId, accountId: sourceId, name: folderName })}>Save Folder</button>
      {#each notesData.folders.filter(folder => !folder.builtin && folder.deletedAt === null) as folder}<div>{folder.name}<button onclick={() => { folderName = folder.name; sourceId = folder.accountId; command('sheet.open', { sheet: 'folder', folderId: folder.id }); }}>Rename…</button><button onclick={() => command('folder.delete', { folderId: folder.id, confirm: false })}>Delete…</button></div>{/each}
      {#each notesData.folders.filter(folder => folder.deletedAt !== null) as folder}<div>{folder.name} · deleted<button onclick={() => command('folder.restore', { folderId: folder.id })}>Recover Folder</button></div>{/each}
    {:else if session.sheet === 'delete-folder'}
      <p>Delete “{notesData.folders.find(folder => folder.id === session.sheetFolderId)?.name}” and move its notes to Recently Deleted? Notes can be restored for 30 authored days; recovery to a removed folder falls back to On My Mac / Notes.</p><button class="destructive" onclick={() => command('folder.delete', { folderId: session.sheetFolderId, confirm: true })}>Delete Folder</button>
    {:else if session.sheet === 'trash-note'}
      <p>Move “{noteWorkspaceTitle(sheetNote)}” to Recently Deleted? It can be restored for 30 authored days.</p><button onclick={() => command('trash', { noteId: sheetNote.id, confirm: true })}>Delete Note</button>
    {:else if session.sheet === 'delete-note' || session.sheet === 'empty-trash'}
      <p>Permanently delete {session.sheet === 'delete-note' ? `“${noteWorkspaceTitle(sheetNote)}”` : 'all notes in Recently Deleted'}? This cannot be undone.</p><button class="destructive" onclick={() => command(session.sheet === 'delete-note' ? 'delete.permanent' : 'trash.empty', session.sheet === 'delete-note' ? { noteId: sheetNote.id, confirm: true } : { confirm: true })}>Delete Permanently</button>
    {:else if session.sheet === 'lock' || session.sheet === 'unlock'}
      <p>Fictional local password gating only. No encryption, Keychain, biometrics or real account security.</p><label>Password<input type="password" bind:value={secret} autocomplete="off" /></label>{#if session.sheet === 'lock'}<label>Hint<input bind:value={hint} /></label>{:else if sheetNote?.lock?.hint}<p>Hint: {sheetNote.lock.hint}</p>{/if}<button disabled={!secret} onclick={() => command(session.sheet, { noteId: sheetNote.id, secret, ...(session.sheet === 'lock' ? { hint } : {}) }).then(result => { if (!retired && result.status === 'applied') secret = ''; })}>{session.sheet === 'lock' ? 'Set Fictional Password' : 'Unlock'}</button>{#if session.sheet === 'unlock'}<button disabled={!secret} onclick={() => command('lock.remove', { noteId: sheetNote.id, secret })}>Remove Fictional Lock</button>{/if}
    {:else if session.sheet === 'collaboration'}
      <p>Fictional collaboration roster and real local read-only permission; no invitation transport or online editing.</p><label>Permission<select value={sheetNote?.collaboration.permission} onchange={event => command('collaboration.set', { noteId: sheetNote.id, enabled: true, permission: event.currentTarget.value, participants: sheetNote.collaboration.participants })}><option value="edit">Can edit</option><option value="view">View only</option></select></label>
      {#each sheetNote?.collaboration.participants ?? [] as participant}<div>{participant.name} · {participant.role}<button onclick={() => command('collaboration.set', { noteId: sheetNote.id, enabled: true, permission: sheetNote.collaboration.permission, participants: sheetNote.collaboration.participants.filter(row => row.id !== participant.id) })}>Remove</button></div>{/each}
      <label>Participant name<input bind:value={participantName} /></label><button disabled={!participantName.trim()} onclick={() => command('collaboration.set', { noteId: sheetNote.id, enabled: true, permission: sheetNote.collaboration.permission, participants: [...sheetNote.collaboration.participants, { id: `participant-${notesData.nextId}-${sheetNote.collaboration.participants.length}`, name: participantName, role: 'edit' }] })}>Add Local Participant</button><button onclick={() => command('collaboration.set', { noteId: sheetNote.id, enabled: false, permission: 'edit', participants: [] })}>Stop Local Collaboration</button><button onclick={() => command('share', { noteId: sheetNote.id })}>Open Actual Share Sheet</button>
    {:else if session.sheet === 'attachments'}
      <p>Drop actual Files records into the editor, or enter a canonical file ID. Local PNG, JPEG, WebP, GIF and PDF only. No host file access.</p><label>File ID<input bind:value={attachmentFileId} /></label><button onclick={() => command('attachment.add', { noteId: sheetNote.id, fileId: attachmentFileId })}>Attach Actual File</button>
      {#each sheetNote?.attachments ?? [] as attachment}<div>{attachment.name}<button onclick={() => command('attachment.open', { noteId: sheetNote.id, attachmentId: attachment.id, reveal: true })}>Show in Files</button></div>{/each}
    {:else if session.sheet === 'export'}
      <label>Filename<input bind:value={exportName} /></label><label>Format<select bind:value={exportFormat}><option value="html">HTML · supported local rich structure</option><option value="text">Plain text projection</option><option value="markdown">Markdown text projection</option><option value="pdf">PDF text projection</option></select></label><p>Image/PDF attachments remain actual Files references and are not embedded in text exports. PDF uses the bundled licensed font and rejects unsupported glyphs rather than losing text.</p><button onclick={() => command('export', { noteId: sheetNote.id, name: exportName, format: exportFormat })}>Create Actual File</button>
    {:else if session.sheet === 'help'}
      <h3>Editing Notes</h3><p>Installed font families are the original shared Font Book/Font Library sources, not proprietary Apple or Microsoft fonts. Enablement and source changes update this mounted document. Unavailable authored family names remain literal and use a safe browser rendering fallback; existing export font-embedding scopes are unchanged.</p><p>Create a note, type in the real rich editor, select text then choose Format for emphasis. Checklists toggle stored paragraph values. Tab moves between actual table cells; Tab from the last cell adds a row. Undo and Redo retain structured documents and native ranges across close/reopen.</p><p>Custom folders belong to fictional account sections. Deleted folders and notes are retained for 30 days measured only against the authored scene clock. Apply retention explicitly from View; nothing disappears on host timers.</p><p>Attachments read canonical Files through guarded bridges. Share opens the actual scene share UI; printing opens the actual print workflow and is not claimed as completed printing. Missing bridges reject visibly.</p><p>{windows ? 'Sticky Notes native counterpart: basic cards/list, text emphasis, images, search and settings. Rich headings/checklists/tables/accounts/folders/lock/collaboration/retention/export are functional local extensions.' : classic ? 'Classic Notes chrome and Preferences are kept separate from modern Settings and date grouping. Fictional passwords/accounts/collaboration and generalized rich exports are local equivalents.' : 'Modern Notes toolbar, folder/list/gallery and Settings. Golden appearance uses current first-party guide observations, not a verified 27.0.1 binary.'}</p><p>Editing ranges are within one paragraph or table cell; cross-block native selections are rejected rather than misapplied. Simulation typography uses available licensed fonts, not redistributed Apple/Microsoft fonts.</p>
    {:else if session.sheet === 'about'}<p>{windows ? 'Sticky Notes' : 'Notes'} · JesterOS fictional offline scene for {profile.id}.</p><p>Rich document authority, original-window lifecycle, local account/lock/collaboration equivalents and actual shared Files/print/share bridges. No network, host clipboard, authentication or encryption.</p>{/if}
    <footer><button onclick={() => { secret = ''; command('sheet.close'); }}>Close</button></footer>
  </section></div>{/if}
  {#if documentFonts.error || message}<div class="notes-workspace-message" role="alert">{documentFonts.error || message}<button disabled={!!documentFonts.error} onclick={() => message = ''}>Dismiss</button></div>{/if}
</section>

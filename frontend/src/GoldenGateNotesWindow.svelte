<script>
  import { onMount } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { noteTitle, notePreview, groupNotes } from './notes-state.js';
  import { createGoldenGateNotesView } from './golden-gate-notes-view.js';
  import './golden-gate-documents.css';

  let { state: noteState, viewState, execute, registerView, active = true, zoomed = false,
    onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu,
    fullScreen = false, revealedTop = true, modernGreenMenu = true } = $props();
  let root, searchInput, listElement;
  let titleInput = $state(null), bodyInput = $state(null), contextElement = $state(null);
  const context = $derived(viewState.context);
  const groups = $derived(groupNotes(noteState));
  const notes = $derived(groups.flatMap(group => group.notes));
  const groupHeadings = $derived(new Map(groups.map(group => [group.notes[0].id, group])));
  const selected = $derived(noteState.notes.find((note) => note.id === noteState.selectedId));
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const summaryDateFormat = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
  const view = createGoldenGateNotesView({ execute: (request) => execute(request), state: () => noteState,
    presentation: () => viewState, isActive: () => active,
    refs: () => ({ root, search: searchInput, list: listElement, title: titleInput, body: bodyInput, context: contextElement }) });
  // Original line artwork; not SF Symbols or screenshot crops.
  const symbols = {
    sidebar: 'M4 4h16v16H4zM10 4v16M6.5 7h1M6.5 10h1M6.5 13h1',
    folder: 'M3 7V5h6l2 2h10v13H3z',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    restore: 'M5 8a8 8 0 1 1-1 8M5 3v5h5M12 7v5l3 2',
    new: 'M13 4H4v16h16v-9M9 15l1-5 8-8 4 4-8 8zM16 4l4 4',
    format: 'M3 18 8 5l5 13M5 13h6M15 18l3-8 3 8M16 15h4',
    checklist: 'm3 6 2 2 3-4M11 6h10m-18 7 2 2 3-4M11 13h10M3 20h5M11 20h10',
    table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
    attachment: 'm9 15 7-7a3 3 0 0 0-4-4L4 12a5 5 0 0 0 7 7l9-9M7 14l8-8',
    markup: 'M5 20 7 12 16 3l5 5-9 9zM7 12l5 5M14 5l5 5M5 20l7-3',
    share: 'M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6',
    pin: 'm8 3 8 0-1 6 4 4v2H5v-2l4-4zM12 15v7',
    more: 'M5 12h.1M12 12h.1M19 12h.1',
    plus: 'M12 4v16M4 12h16',
  };
  onMount(() => view.register(registerView));
</script>

{#snippet symbol(name)}
  <svg class="golden-gate-document-symbol" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width={name === 'more' ? 3.4 : 1.65} stroke-linecap="round" stroke-linejoin="round"><path d={symbols[name]} /></svg>
{/snippet}

<svelte:window onkeydown={view.keyboard} />
<svelte:document onpointerdown={view.dismissContext} onfocusin={view.dismissContext} />

<section class="golden-gate-notes" class:inactive={!active} class:folders-hidden={!noteState.sidebarVisible}
  style:--golden-gate-notes-text-size="{noteState.preferences.textSize}px"
  bind:this={root} aria-label="Notes application" onfocusin={view.observeFocus} onfocusout={view.observeBlur}>
  <header class="golden-gate-notes-toolbar" data-window-drag>
    <div class="golden-gate-notes-window-tools">
      <WindowControls {active} {zoomed} {onclose} {onminimize} {onzoom} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
      <button type="button" class="golden-gate-document-tool" data-window-no-drag data-notes-control="sidebar" data-golden-gate-notes-control="sidebar" aria-label={noteState.sidebarVisible ? 'Hide folders' : 'Show folders'} title="Show or hide folders" aria-pressed={noteState.sidebarVisible} onclick={() => view.command('setSidebarVisible', {}, { visible: !noteState.sidebarVisible })}>{@render symbol('sidebar')}</button>
    </div>
    <div class="golden-gate-notes-collection-tools">
      <div class="golden-gate-notes-collection-title"><strong>{noteState.folder === 'deleted' ? 'Recently Deleted' : 'Notes'}</strong><span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span></div>
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" data-window-no-drag aria-label="View options — not implemented" title="List view; gallery and sorting options are not implemented" disabled>{@render symbol('more')}</button>
    </div>
    <div class="golden-gate-notes-writing-tools" data-window-no-drag>
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" data-notes-control="new-note" data-golden-gate-notes-control="new-note" aria-label="New note" title="New note (⌘N)" onclick={view.newNote}>{@render symbol('new')}</button>
      <div class="golden-gate-document-tool-group golden-gate-notes-formatting">
        <button type="button" class="golden-gate-document-tool" aria-label="Formatting — not implemented" title="Plain-text notes only" disabled>{@render symbol('format')}</button>
        <button type="button" class="golden-gate-document-tool" aria-label="Checklist — not implemented" disabled>{@render symbol('checklist')}</button>
        <button type="button" class="golden-gate-document-tool" aria-label="Table — not implemented" disabled>{@render symbol('table')}</button>
        <button type="button" class="golden-gate-document-tool" aria-label="Attachments — not implemented" disabled>{@render symbol('attachment')}</button>
        <button type="button" class="golden-gate-document-tool" aria-label="Drawings — not implemented" disabled>{@render symbol('markup')}</button>
      </div>
      <div class="golden-gate-document-tool-group golden-gate-notes-actions">
        {#if noteState.folder === 'deleted'}
          <button type="button" class="golden-gate-document-tool" data-notes-control="restore" data-golden-gate-notes-control="restore" aria-label="Restore note" title="Restore note" disabled={!selected} onclick={() => view.command('restore', { noteId: selected.id })}>{@render symbol('restore')}</button>
        {:else}
          <button type="button" class="golden-gate-document-tool" data-notes-control="delete" data-golden-gate-notes-control="delete" aria-label="Delete note" title="Delete note" disabled={!selected} onclick={() => view.command('trash', { noteId: selected.id })}>{@render symbol('trash')}</button>
        {/if}
        <button type="button" class="golden-gate-document-tool" aria-label="Share note — not implemented" disabled>{@render symbol('share')}</button>
        <button type="button" class="golden-gate-document-tool" aria-label="Lock note and other note actions — not implemented" title="Lock note and additional actions are not implemented" disabled>{@render symbol('more')}</button>
      </div>
      <label class="golden-gate-document-search golden-gate-notes-search">{@render symbol('search')}<input type="search" data-notes-control="search" data-golden-gate-notes-control="search" aria-label="Search notes" placeholder="Search" bind:this={searchInput} value={noteState.search} oninput={(event) => view.command('search', {}, { query: event.currentTarget.value })} /></label>
    </div>
  </header>

  <div class="golden-gate-notes-columns">
    {#if noteState.sidebarVisible}
      <aside class="golden-gate-notes-folders" aria-label="Note folders">
        <div class="golden-gate-notes-folder-content">
          <h2>On My Mac</h2>
          <button type="button" data-notes-control="folder" data-golden-gate-notes-control="folder" data-folder="notes" class:selected={noteState.folder === 'notes'} aria-label="Notes folder" aria-pressed={noteState.folder === 'notes'} onclick={() => view.command('selectFolder', { folder: 'notes' })}>{@render symbol('folder')}<span>Notes</span><span class="golden-gate-notes-folder-count">{noteState.notes.filter((note) => !note.deleted).length}</span></button>
          <button type="button" data-notes-control="folder" data-golden-gate-notes-control="folder" data-folder="deleted" class:selected={noteState.folder === 'deleted'} aria-label="Recently Deleted folder" aria-pressed={noteState.folder === 'deleted'} onclick={() => view.command('selectFolder', { folder: 'deleted' })}>{@render symbol('trash')}<span>Recently Deleted</span><span class="golden-gate-notes-folder-count">{noteState.notes.filter((note) => note.deleted).length}</span></button>
        </div>
        <button type="button" class="golden-gate-notes-new-folder" aria-label="New folder — not implemented" disabled>{@render symbol('plus')}<span>New Folder</span></button>
      </aside>
    {/if}
    <nav class="golden-gate-notes-list" aria-label="Notes list" bind:this={listElement} onscroll={(event) => view.observeScroll('list', event)}>
      {#each notes as note (note.id)}
        {#if !noteState.search && noteState.folder === 'notes' && groupHeadings.has(note.id)}<h3 class="golden-gate-notes-list-heading" data-notes-group-id={groupHeadings.get(note.id).id}>{groupHeadings.get(note.id).label}</h3>{/if}
        <button type="button" class="golden-gate-notes-row" class:selected={note.id === noteState.selectedId} data-notes-control="row" data-golden-gate-notes-control="row" data-note-id={note.id} aria-label={`${noteTitle(note)}${note.pinned && !note.deleted ? ', pinned' : ''}`} aria-pressed={note.id === noteState.selectedId} onclick={() => view.command('select', { noteId: note.id })} oncontextmenu={(event) => view.openContext(event, note)} onkeydown={(event) => view.rowKeydown(event, note, notes)}>
          <span class="golden-gate-notes-row-title">{noteTitle(note)}</span>
          <span class="golden-gate-notes-row-summary"><time datetime={new Date(note.updatedAt).toISOString()}>{summaryDateFormat.format(note.updatedAt)}</time><span>{notePreview(note) || 'No additional text'}</span></span>
          <span class="golden-gate-notes-row-folder">{@render symbol(note.pinned && !note.deleted ? 'pin' : 'folder')} {noteState.folder === 'deleted' ? 'Recently Deleted' : 'Notes'}</span>
        </button>
      {/each}
      {#if !notes.length}<p class="golden-gate-notes-empty">{noteState.search ? 'No matching notes' : 'No notes'}</p>{/if}
    </nav>
    <section class="golden-gate-notes-editor" aria-label="Note editor">
      {#if selected}
        <time class="golden-gate-notes-modified" datetime={new Date(selected.updatedAt).toISOString()}>{dateFormat.format(selected.updatedAt)}</time>
        {#if selected.deleted}<div class="golden-gate-notes-deleted">Restore this note to make changes.</div>{/if}
        <input class="golden-gate-notes-title" data-notes-control="title" data-golden-gate-notes-control="title" data-note-id={selected.id} aria-label="Note title" placeholder="New Note" spellcheck="false" readonly={selected.deleted} bind:this={titleInput} value={view.firstLine(selected)} oninput={(event) => view.edit(event.currentTarget.value, view.bodyText(selected))} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); view.command('focus', { control: 'body' }); } }} />
        <textarea class="golden-gate-notes-body" data-notes-control="body" data-golden-gate-notes-control="body" data-note-id={selected.id} aria-label="Note body" spellcheck="false" readonly={selected.deleted} bind:this={bodyInput} value={view.bodyText(selected)} oninput={(event) => view.edit(view.firstLine(selected), event.currentTarget.value)} onscroll={(event) => view.observeScroll('editor', event)}></textarea>
      {:else}<div class="golden-gate-notes-editor-empty">{noteState.search ? 'No matching notes' : noteState.folder === 'deleted' ? 'No recently deleted notes' : 'No note selected'}</div>{/if}
    </section>
  </div>
  {#if context}
    <div class="golden-gate-notes-context" role="menu" aria-label="Note actions" tabindex="-1" bind:this={contextElement} style:left="{context.left}px" style:top="{context.top}px" onkeydown={view.contextKeydown}>
      {#if noteState.folder === 'deleted'}
        <button type="button" role="menuitem" data-notes-control="context" data-golden-gate-notes-control="context" data-item="restore" onclick={() => view.contextAction('restore')}>{@render symbol('restore')}Restore Note</button>
      {:else}
        <button type="button" role="menuitem" data-notes-control="context" data-golden-gate-notes-control="context" data-item="pin" onclick={() => view.contextAction('pin')}>{@render symbol('pin')}{noteState.notes.find((note) => note.id === context.id)?.pinned ? 'Unpin Note' : 'Pin Note'}</button>
        <div role="separator"></div>
        <button type="button" role="menuitem" data-notes-control="context" data-golden-gate-notes-control="context" data-item="delete" onclick={() => view.contextAction('delete')}>{@render symbol('trash')}Delete Note</button>
      {/if}
    </div>
  {/if}
</section>

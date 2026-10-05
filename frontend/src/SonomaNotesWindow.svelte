<script>
  import { onMount } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import SonomaSymbol from './SonomaSymbol.svelte';
  import { noteTitle, notePreview, visibleNotes } from './notes-state.js';
  import { createSonomaNotesView } from './sonoma-notes-view.js';
  import './sonoma.css';
  let { state: noteState, viewState, execute, registerView, active = true, zoomed = false, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu, fullScreen = false, revealedTop = true, modernGreenMenu = true } = $props();
  let root, searchInput, listElement;
  let titleInput = $state(null), bodyInput = $state(null), contextElement = $state(null);
  const context = $derived(viewState.context);
  const notes = $derived(visibleNotes(noteState));
  const selected = $derived(noteState.notes.find((note) => note.id === noteState.selectedId));
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const summaryDateFormat = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
  const view = createSonomaNotesView({ execute: (request) => execute(request), state: () => noteState, presentation: () => viewState, isActive: () => active, refs: () => ({ root, search: searchInput, list: listElement, title: titleInput, body: bodyInput, context: contextElement }) });
  onMount(() => view.register(registerView));
</script>

<svelte:window onkeydown={view.keyboard} />
<svelte:document onpointerdown={view.dismissContext} onfocusin={view.dismissContext} />

<section class="sonoma-notes" class:inactive={!active} class:folders-hidden={!noteState.sidebarVisible} bind:this={root} aria-label="Notes application" onfocusin={view.observeFocus} onfocusout={view.observeBlur}>
  <header class="sonoma-notes-toolbar" data-window-drag>
    <div class="sonoma-notes-leading">
      <WindowControls {active} {zoomed} {onclose} {onminimize} {onzoom} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
      <button type="button" class="sonoma-tool" data-window-no-drag data-notes-control="sidebar" aria-label={noteState.sidebarVisible ? 'Hide folders' : 'Show folders'} title="Show or hide folders" aria-pressed={noteState.sidebarVisible} onclick={() => view.command('setSidebarVisible', {}, { visible: !noteState.sidebarVisible })}><SonomaSymbol name="sidebar" /></button>
    </div>
    <div class="sonoma-notes-list-tools" data-window-no-drag>
      <button type="button" class="sonoma-tool sonoma-list-mode" aria-label="List view" aria-pressed="true" disabled><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 6h13M8 12h13M8 18h13M3 6h2m-2 6h2m-2 6h2"/></svg></button>
      <button type="button" class="sonoma-tool" aria-label="Gallery view — not implemented" disabled><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
      {#if noteState.folder === 'deleted'}
        <button type="button" class="sonoma-tool" data-notes-control="restore" aria-label="Restore note" title="Restore note" disabled={!selected} onclick={() => view.command('restore', { noteId: selected.id })}><SonomaSymbol name="restore" /></button>
      {:else}
        <button type="button" class="sonoma-tool" data-notes-control="delete" aria-label="Delete note" title="Delete note" disabled={!selected} onclick={() => view.command('trash', { noteId: selected.id })}><SonomaSymbol name="trash" /></button>
      {/if}
    </div>
    <div class="sonoma-notes-editor-tools" data-window-no-drag>
      <button type="button" class="sonoma-tool" data-notes-control="new-note" aria-label="New note" title="New note (⌘N)" onclick={view.newNote}><SonomaSymbol name="new" /></button>
      <div class="sonoma-note-format-tools">
        <button type="button" class="sonoma-tool" aria-label="Formatting — not implemented" title="Formatting is outside the plain-text slice" disabled><SonomaSymbol name="format" /></button>
        <button type="button" class="sonoma-tool" aria-label="Checklist — not implemented" disabled><SonomaSymbol name="checklist" /></button>
        <button type="button" class="sonoma-tool" aria-label="Table — not implemented" disabled><SonomaSymbol name="table" /></button>
        <button type="button" class="sonoma-tool" aria-label="Attachments — not implemented" disabled><SonomaSymbol name="attachment" /></button>
      </div>
      <div class="sonoma-note-sharing-tools">
        <button type="button" class="sonoma-tool" aria-label="Lock note — not implemented" disabled><SonomaSymbol name="lock" /></button>
        <button type="button" class="sonoma-tool" aria-label="Share note — not implemented" disabled><SonomaSymbol name="share" /></button>
      </div>
      <label class="sonoma-notes-search"><SonomaSymbol name="search" /><input type="search" data-notes-control="search" aria-label="Search notes" placeholder="Search" bind:this={searchInput} value={noteState.search} oninput={(event) => view.command('search', {}, { query: event.currentTarget.value })} /></label>
    </div>
  </header>

  <div class="sonoma-notes-columns">
    {#if noteState.sidebarVisible}
      <aside class="sonoma-notes-folders" aria-label="Note folders">
        <h2>On My Mac</h2>
        <button type="button" data-notes-control="folder" data-folder="notes" class:selected={noteState.folder === 'notes'} aria-label="Notes folder" aria-pressed={noteState.folder === 'notes'} onclick={() => view.command('selectFolder', { folder: 'notes' })}><SonomaSymbol name="folder" /><span>Notes</span><span class="sonoma-folder-count">{noteState.notes.filter((note) => !note.deleted).length}</span></button>
        <button type="button" data-notes-control="folder" data-folder="deleted" class:selected={noteState.folder === 'deleted'} aria-label="Recently Deleted folder" aria-pressed={noteState.folder === 'deleted'} onclick={() => view.command('selectFolder', { folder: 'deleted' })}><SonomaSymbol name="trash" /><span>Recently Deleted</span><span class="sonoma-folder-count">{noteState.notes.filter((note) => note.deleted).length}</span></button>
      </aside>
    {/if}
    <nav class="sonoma-notes-list" aria-label="Notes list" bind:this={listElement} onscroll={(event) => view.observeScroll('list', event)}>
      {#each notes as note, index (note.id)}
        {#if !noteState.search && noteState.folder === 'notes' && ((index === 0 && note.pinned) || (index > 0 && notes[index - 1].pinned && !note.pinned))}<h3 class="sonoma-notes-list-heading">{note.pinned ? 'Pinned' : 'Notes'}</h3>{/if}
        <button type="button" class="sonoma-note-row" class:selected={note.id === noteState.selectedId} data-notes-control="row" data-note-id={note.id} aria-label={`${noteTitle(note)}${note.pinned && !note.deleted ? ', pinned' : ''}`} aria-pressed={note.id === noteState.selectedId} onclick={() => view.command('select', { noteId: note.id })} oncontextmenu={(event) => view.openContext(event, note)} onkeydown={(event) => view.rowKeydown(event, note, notes)}>
          <span class="sonoma-note-row-title">{noteTitle(note)}</span>
          <span class="sonoma-note-row-summary"><time datetime={new Date(note.updatedAt).toISOString()}>{summaryDateFormat.format(note.updatedAt)}</time><span>{notePreview(note) || 'No additional text'}</span></span>
          <span class="sonoma-note-row-folder">{#if note.pinned && !note.deleted}<SonomaSymbol name="pin" />{:else}<SonomaSymbol name="folder" />{/if} {noteState.folder === 'deleted' ? 'Recently Deleted' : 'Notes'}</span>
        </button>
      {/each}
      {#if !notes.length}<p class="sonoma-notes-empty">{noteState.search ? 'No matching notes' : 'No notes'}</p>{/if}
    </nav>
    <section class="sonoma-notes-editor" aria-label="Note editor">
      {#if selected}
        <time class="sonoma-note-modified" datetime={new Date(selected.updatedAt).toISOString()}>{dateFormat.format(selected.updatedAt)}</time>
        {#if selected.deleted}<div class="sonoma-note-deleted">Restore this note to make changes.</div>{/if}
        <input class="sonoma-note-title" data-notes-control="title" aria-label="Note title" placeholder="New Note" spellcheck="false" readonly={selected.deleted} bind:this={titleInput} value={view.firstLine(selected)} oninput={(event) => view.edit(event.currentTarget.value, view.bodyText(selected))} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); view.command('focus', { control: 'body' }); } }} />
        <textarea class="sonoma-note-body" data-notes-control="body" aria-label="Note body" spellcheck="false" readonly={selected.deleted} bind:this={bodyInput} value={view.bodyText(selected)} oninput={(event) => view.edit(view.firstLine(selected), event.currentTarget.value)} onscroll={(event) => view.observeScroll('editor', event)}></textarea>
      {:else}<div class="sonoma-notes-editor-empty">{noteState.search ? 'No matching notes' : noteState.folder === 'deleted' ? 'No recently deleted notes' : 'No note selected'}</div>{/if}
    </section>
  </div>
  {#if context}
    <div class="sonoma-notes-context" role="menu" aria-label="Note actions" tabindex="-1" bind:this={contextElement} style:left="{context.left}px" style:top="{context.top}px" onkeydown={view.contextKeydown}>
      {#if noteState.folder === 'deleted'}<button type="button" role="menuitem" data-notes-control="context" data-item="restore" onclick={() => view.contextAction('restore')}>Restore Note</button>
      {:else}
        <button type="button" role="menuitem" data-notes-control="context" data-item="pin" onclick={() => view.contextAction('pin')}><SonomaSymbol name="pin" />{noteState.notes.find((note) => note.id === context.id)?.pinned ? 'Unpin Note' : 'Pin Note'}</button>
        <div role="separator"></div>
        <button type="button" role="menuitem" data-notes-control="context" data-item="delete" onclick={() => view.contextAction('delete')}><SonomaSymbol name="trash" />Delete Note</button>
      {/if}
    </div>
  {/if}
</section>

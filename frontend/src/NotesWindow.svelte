<script>
  import { tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { noteTitle, notePreview, visibleNotes, createNote, updateNote, togglePin, trashNote, restoreNote, selectFolder, selectNote, setSearch } from './notes-state.js';
  import './notes.css';

  let { state: noteState = $bindable(), active = true, zoomed = false, onclose, onminimize, onzoom } = $props();
  let root;
  let titleInput = $state(null);
  let bodyInput = $state(null);
  let searchInput;
  let contextElement = $state(null);
  let context = $state(null);
  const notes = $derived(visibleNotes(noteState));
  const selected = $derived(noteState.notes.find((note) => note.id === noteState.selectedId));
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const summaryDateFormat = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' });

  function firstLine(note) {
    return note.text.split('\n', 1)[0];
  }

  function bodyText(note) {
    const newline = note.text.indexOf('\n');
    return newline < 0 ? '' : note.text.slice(newline + 1);
  }

  async function newNote() {
    context = null;
    createNote(noteState);
    await tick();
    titleInput?.focus();
  }

  function edit(title, body) {
    if (!selected || selected.deleted) return;
    const id = selected.id;
    // Leaving the search filter before an edit prevents a disappearing result
    // from unmounting the editor while the actor is typing.
    if (noteState.search) setSearch(noteState, '');
    updateNote(noteState, id, body ? `${title}\n${body}` : title);
  }

  function removeSelected() {
    if (selected && !selected.deleted) trashNote(noteState, selected.id);
    return finishContextAction();
  }

  function restoreSelected() {
    if (selected?.deleted) restoreNote(noteState, selected.id);
    return finishContextAction();
  }

  async function finishContextAction() {
    const wasOpen = Boolean(context);
    context = null;
    if (!wasOpen) return;
    await tick();
    if (noteState.selectedId) focusRow(noteState.selectedId);
    else root.querySelector('button[aria-label="New note"]')?.focus();
  }

  function keyboard(event) {
    if (!active || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newNote();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  }

  function dismissContext(event) {
    if (context && !contextElement?.contains(event.target)) context = null;
  }

  async function openContext(event, note, fromKeyboard = false) {
    event.preventDefault();
    selectNote(noteState, note.id);
    const rect = root.getBoundingClientRect();
    const scale = rect.width / root.clientWidth;
    const target = event.currentTarget.getBoundingClientRect();
    context = {
      id: note.id,
      left: Math.max(4, Math.min(root.clientWidth - 208, ((fromKeyboard ? target.right : event.clientX) - rect.left) / scale)),
      top: Math.max(4, Math.min(root.clientHeight - 82, ((fromKeyboard ? target.top : event.clientY) - rect.top) / scale)),
    };
    await tick();
    contextElement?.querySelector('button')?.focus();
  }

  function focusRow(id) {
    root.querySelector(`[data-note-id="${id}"]`)?.focus();
  }

  function contextKeydown(event) {
    const items = [...contextElement.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const id = context.id;
      context = null;
      focusRow(id);
      return;
    }
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }

  function rowKeydown(event, note) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      openContext(event, note, true);
      return;
    }
    let index = notes.findIndex((item) => item.id === note.id);
    if (event.key === 'ArrowDown') index = Math.min(notes.length - 1, index + 1);
    else if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = notes.length - 1;
    else return;
    event.preventDefault();
    selectNote(noteState, notes[index].id);
    focusRow(notes[index].id);
  }

  async function pinContext() {
    const id = context.id;
    togglePin(noteState, id);
    context = null;
    await tick();
    focusRow(id);
  }
</script>

{#snippet icon(name)}
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    {#if name === 'sidebar'}<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M5 8h2m-2 4h2m-2 4h2"/>
    {:else if name === 'new'}<path d="M20 13v8H3V4h10M9 16l1-5L19 2l3 3-9 9-4 2Zm8-12 3 3"/>
    {:else if name === 'trash'}<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 9v8m4-8v8"/>
    {:else if name === 'restore'}<path d="M3 8h18v12H3V8Zm0 0V5h7l2 3M12 17v-6m-3 3 3-3 3 3"/>
    {:else if name === 'search'}<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>
    {:else if name === 'pin'}<path d="m9 3 8 0-1 6 4 4H6l4-4-1-6Zm4 10v8"/>
    {/if}
  </svg>
{/snippet}

<svelte:window onkeydown={keyboard} />
<svelte:document onpointerdown={dismissContext} onfocusin={dismissContext} />

<section class="notes-window" class:inactive={!active} bind:this={root} aria-label="Notes application">
  <header class="notes-toolbar" data-window-drag>
    <WindowControls class="notes-traffic-lights" {active} {zoomed} {onclose} {onminimize} {onzoom} />
    <div class="notes-toolbar-actions" data-window-no-drag>
      <button type="button" class="notes-tool" aria-label={noteState.sidebarVisible ? 'Hide folders' : 'Show folders'} title="Show or hide folders" aria-pressed={noteState.sidebarVisible} onclick={() => { noteState.sidebarVisible = !noteState.sidebarVisible; }}>{@render icon('sidebar')}</button>
      <button type="button" class="notes-tool" aria-label="New note" title="New note (⌘N)" onclick={newNote}>{@render icon('new')}</button>
      {#if noteState.folder === 'deleted'}
        <button type="button" class="notes-tool" aria-label="Restore note" title="Restore note" disabled={!selected} onclick={restoreSelected}>{@render icon('restore')}</button>
      {:else}
        <button type="button" class="notes-tool" aria-label="Delete note" title="Delete note" disabled={!selected} onclick={removeSelected}>{@render icon('trash')}</button>
      {/if}
    </div>
    <label class="notes-search" data-window-no-drag>
      {@render icon('search')}
      <input type="search" aria-label="Search notes" placeholder="Search" bind:this={searchInput} value={noteState.search} oninput={(event) => setSearch(noteState, event.currentTarget.value)} />
    </label>
  </header>

  <div class="notes-columns" class:folders-hidden={!noteState.sidebarVisible}>
    {#if noteState.sidebarVisible}
      <aside class="notes-folders" aria-label="Note folders">
        <h2>On My Mac</h2>
        <button type="button" class:selected={noteState.folder === 'notes'} aria-label="Notes folder" aria-pressed={noteState.folder === 'notes'} onclick={() => selectFolder(noteState, 'notes')}><span>Notes</span></button>
        <button type="button" class:selected={noteState.folder === 'deleted'} aria-label="Recently Deleted folder" aria-pressed={noteState.folder === 'deleted'} onclick={() => selectFolder(noteState, 'deleted')}><span>Recently Deleted</span></button>
      </aside>
    {/if}

    <nav class="notes-list" aria-label="Notes list">
      {#each notes as note, index (note.id)}
        {#if !noteState.search && noteState.folder === 'notes' && ((index === 0 && note.pinned) || (index > 0 && notes[index - 1].pinned && !note.pinned))}
          <div class="notes-list-heading">{note.pinned ? 'Pinned' : 'Notes'}</div>
        {/if}
        <button type="button" class="notes-row" class:selected={note.id === noteState.selectedId} data-note-id={note.id} aria-label={`${noteTitle(note)}${note.pinned && !note.deleted ? ', pinned' : ''}`} aria-pressed={note.id === noteState.selectedId} onclick={() => selectNote(noteState, note.id)} oncontextmenu={(event) => openContext(event, note)} onkeydown={(event) => rowKeydown(event, note)}>
          <span class="notes-row-title">{noteTitle(note)}</span>
          <span class="notes-row-summary"><time datetime={new Date(note.updatedAt).toISOString()}>{summaryDateFormat.format(note.updatedAt)}</time><span>{notePreview(note) || 'No additional text'}</span></span>
          {#if note.pinned && !note.deleted}<span class="notes-row-pin" aria-label="Pinned">{@render icon('pin')}</span>{/if}
        </button>
      {/each}
      {#if !notes.length}<p class="notes-list-empty">{noteState.search ? 'No matching notes' : 'No notes'}</p>{/if}
    </nav>

    <section class="notes-editor" aria-label="Note editor">
      {#if selected}
        <time class="notes-modified" datetime={new Date(selected.updatedAt).toISOString()}>{dateFormat.format(selected.updatedAt)}</time>
        {#if selected.deleted}<div class="notes-deleted-message">Restore this note to make changes.</div>{/if}
        <input class="notes-note-title" aria-label="Note title" placeholder="New Note" spellcheck="false" readonly={selected.deleted} bind:this={titleInput} value={firstLine(selected)} oninput={(event) => edit(event.currentTarget.value, bodyText(selected))} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); bodyInput?.focus(); } }} />
        <textarea class="notes-note-body" aria-label="Note body" placeholder="" spellcheck="false" readonly={selected.deleted} bind:this={bodyInput} value={bodyText(selected)} oninput={(event) => edit(firstLine(selected), event.currentTarget.value)}></textarea>
      {:else}
        <div class="notes-editor-empty">{noteState.search ? 'No matching notes' : noteState.folder === 'deleted' ? 'No recently deleted notes' : 'No note selected'}</div>
      {/if}
    </section>
  </div>

  {#if context}
    <div class="notes-context-menu" role="menu" aria-label="Note actions" tabindex="-1" bind:this={contextElement} style:left="{context.left}px" style:top="{context.top}px" onkeydown={contextKeydown}>
      {#if noteState.folder === 'deleted'}
        <button type="button" role="menuitem" onclick={restoreSelected}>Restore Note</button>
      {:else}
        <button type="button" role="menuitem" onclick={pinContext}>{noteState.notes.find((note) => note.id === context.id)?.pinned ? 'Unpin Note' : 'Pin Note'}</button>
        <button type="button" role="menuitem" onclick={removeSelected}>Delete Note</button>
      {/if}
    </div>
  {/if}
</section>

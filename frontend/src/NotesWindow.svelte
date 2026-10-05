<script>
  import { onMount } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { noteTitle, notePreview, visibleNotes } from './notes-state.js';
  import './notes.css';

  let { state: noteState, viewState, execute, registerView, active = true, zoomed = false, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu, fullScreen = false, revealedTop = true, modernGreenMenu = false } = $props();
  let root;
  let titleInput = $state(null);
  let bodyInput = $state(null);
  let searchInput;
  let listElement;
  let contextElement = $state(null);
  const context = $derived(viewState.context);
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

  function command(name, target = {}, payload = {}) {
    return execute({ command: `notes.${name}`, target, payload });
  }

  function newNote() {
    return command('create', {}, { focus: true });
  }

  function edit(title, body) {
    return command('edit', { noteId: selected.id }, { text: body ? `${title}\n${body}` : title });
  }

  function keyboard(event) {
    if (!active || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newNote();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      command('focus', { control: 'search' }, { select: true });
    }
  }

  function dismissContext(event) {
    if (context && !contextElement?.contains(event.target)) command('context.close');
  }

  function openContext(event, note, fromKeyboard = false) {
    event.preventDefault();
    const payload = { focus: true };
    if (!fromKeyboard) {
      const rect = root.getBoundingClientRect();
      const scale = rect.width / root.clientWidth;
      payload.x = (event.clientX - rect.left) / scale;
      payload.y = (event.clientY - rect.top) / scale;
    }
    command('context.open', { noteId: note.id }, payload);
  }

  function contextAction(item) {
    const note = noteState.notes.find((entry) => entry.id === context.id);
    return command('context.execute', { noteId: context.id, item }, { focus: true, ...(item === 'pin' ? { pinned: !note.pinned } : {}) });
  }

  function contextKeydown(event) {
    const items = noteState.folder === 'deleted' ? ['restore'] : ['pin', 'delete'];
    const index = items.indexOf(viewState.contextItem);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      command('context.close', {}, { focus: true });
      return;
    }
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    command('context.select', { item: items[next] }, { focus: true });
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
    command('select', { noteId: notes[index].id }, { focus: true });
  }

  function controlElement(target) {
    if (target.control === 'title') return titleInput;
    if (target.control === 'body') return bodyInput;
    if (target.control === 'search') return searchInput;
    return [...root.querySelectorAll('[data-notes-control]')].find((element) =>
      element.dataset.notesControl === target.control
      && (target.noteId === undefined || element.dataset.noteId === target.noteId)
      && (target.folder === undefined || element.dataset.folder === target.folder)
      && (target.item === undefined || element.dataset.item === target.item));
  }

  function observeFocus(event) {
    const element = event.target.closest('[data-notes-control]');
    if (!element || !root.contains(element)) {
      command('focus', { control: 'none' }, { observe: true });
      return;
    }
    const target = { control: element.dataset.notesControl };
    if (target.control === 'row') target.noteId = element.dataset.noteId;
    if (target.control === 'folder') target.folder = element.dataset.folder;
    if (target.control === 'context') target.item = element.dataset.item;
    command('focus', target, { observe: true });
  }

  function observeBlur(event) {
    if (!root.contains(event.relatedTarget)) command('focus', { control: 'none' }, { observe: true });
  }

  function observeScroll(area, event) {
    command('scroll', { area }, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true });
  }

  onMount(() => {
    const scrollElement = (area) => area === 'list' ? listElement : bodyInput;
    const view = {
      anchorContext(noteId, position) {
        const row = controlElement({ control: 'row', noteId });
        if (!row) return null;
        // A semantic remote/keyboard target may be outside the scrolled list.
        // Reveal its row before anchoring; pointer-positioned menus stay put.
        if (!position) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = root.getBoundingClientRect();
        const scale = rect.width / root.clientWidth;
        const anchor = row.getBoundingClientRect();
        return {
          left: Math.max(4, Math.min(root.clientWidth - 208, position?.x ?? (anchor.right - rect.left) / scale)),
          top: Math.max(4, Math.min(root.clientHeight - 82, position?.y ?? (anchor.top - rect.top) / scale)),
        };
      },
      focus(target, { select = false } = {}) {
        const element = controlElement(target);
        if (!element) return;
        // Observation commands never invoke this helper or reset the actor's caret.
        if (document.activeElement !== element) element.focus();
        if (select) element.select?.();
      },
      scroll(area, position) {
        const element = scrollElement(area);
        if (!element) return;
        if (position.top !== undefined) element.scrollTop = position.top;
        if (position.left !== undefined) element.scrollLeft = position.left;
      },
      scrollPosition(area) {
        const element = scrollElement(area);
        return { top: element?.scrollTop ?? 0, left: element?.scrollLeft ?? 0 };
      },
    };
    const cleanup = registerView(view);
    for (const area of ['list', 'editor']) view.scroll(area, viewState.scroll?.[area] ?? { top: 0, left: 0 });
    return cleanup;
  });
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

<section class="notes-window" class:inactive={!active} bind:this={root} aria-label="Notes application" onfocusin={observeFocus} onfocusout={observeBlur}>
  <header class="notes-toolbar" data-window-drag>
    <WindowControls class="notes-traffic-lights" {active} {zoomed} {onclose} {onminimize} {onzoom} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
    <div class="notes-toolbar-actions" data-window-no-drag>
      <button type="button" class="notes-tool" data-notes-control="sidebar" aria-label={noteState.sidebarVisible ? 'Hide folders' : 'Show folders'} title="Show or hide folders" aria-pressed={noteState.sidebarVisible} onclick={() => command('setSidebarVisible', {}, { visible: !noteState.sidebarVisible })}>{@render icon('sidebar')}</button>
      <button type="button" class="notes-tool" data-notes-control="new-note" aria-label="New note" title="New note (⌘N)" onclick={newNote}>{@render icon('new')}</button>
      {#if noteState.folder === 'deleted'}
        <button type="button" class="notes-tool" data-notes-control="restore" aria-label="Restore note" title="Restore note" disabled={!selected} onclick={() => command('restore', { noteId: selected.id })}>{@render icon('restore')}</button>
      {:else}
        <button type="button" class="notes-tool" data-notes-control="delete" aria-label="Delete note" title="Delete note" disabled={!selected} onclick={() => command('trash', { noteId: selected.id })}>{@render icon('trash')}</button>
      {/if}
    </div>
    <label class="notes-search" data-window-no-drag>
      {@render icon('search')}
      <input type="search" data-notes-control="search" aria-label="Search notes" placeholder="Search" bind:this={searchInput} value={noteState.search} oninput={(event) => command('search', {}, { query: event.currentTarget.value })} />
    </label>
  </header>

  <div class="notes-columns" class:folders-hidden={!noteState.sidebarVisible}>
    {#if noteState.sidebarVisible}
      <aside class="notes-folders" aria-label="Note folders">
        <h2>On My Mac</h2>
        <button type="button" data-notes-control="folder" data-folder="notes" class:selected={noteState.folder === 'notes'} aria-label="Notes folder" aria-pressed={noteState.folder === 'notes'} onclick={() => command('selectFolder', { folder: 'notes' })}><span>Notes</span></button>
        <button type="button" data-notes-control="folder" data-folder="deleted" class:selected={noteState.folder === 'deleted'} aria-label="Recently Deleted folder" aria-pressed={noteState.folder === 'deleted'} onclick={() => command('selectFolder', { folder: 'deleted' })}><span>Recently Deleted</span></button>
      </aside>
    {/if}

    <nav class="notes-list" aria-label="Notes list" bind:this={listElement} onscroll={(event) => observeScroll('list', event)}>
      {#each notes as note, index (note.id)}
        {#if !noteState.search && noteState.folder === 'notes' && ((index === 0 && note.pinned) || (index > 0 && notes[index - 1].pinned && !note.pinned))}
          <div class="notes-list-heading">{note.pinned ? 'Pinned' : 'Notes'}</div>
        {/if}
        <button type="button" class="notes-row" class:selected={note.id === noteState.selectedId} data-notes-control="row" data-note-id={note.id} aria-label={`${noteTitle(note)}${note.pinned && !note.deleted ? ', pinned' : ''}`} aria-pressed={note.id === noteState.selectedId} onclick={() => command('select', { noteId: note.id })} oncontextmenu={(event) => openContext(event, note)} onkeydown={(event) => rowKeydown(event, note)}>
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
        <input class="notes-note-title" data-notes-control="title" aria-label="Note title" placeholder="New Note" spellcheck="false" readonly={selected.deleted} bind:this={titleInput} value={firstLine(selected)} oninput={(event) => edit(event.currentTarget.value, bodyText(selected))} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); command('focus', { control: 'body' }); } }} />
        <textarea class="notes-note-body" data-notes-control="body" aria-label="Note body" placeholder="" spellcheck="false" readonly={selected.deleted} bind:this={bodyInput} value={bodyText(selected)} oninput={(event) => edit(firstLine(selected), event.currentTarget.value)} onscroll={(event) => observeScroll('editor', event)}></textarea>
      {:else}
        <div class="notes-editor-empty">{noteState.search ? 'No matching notes' : noteState.folder === 'deleted' ? 'No recently deleted notes' : 'No note selected'}</div>
      {/if}
    </section>
  </div>

  {#if context}
    <div class="notes-context-menu" role="menu" aria-label="Note actions" tabindex="-1" bind:this={contextElement} style:left="{context.left}px" style:top="{context.top}px" onkeydown={contextKeydown}>
      {#if noteState.folder === 'deleted'}
        <button type="button" role="menuitem" data-notes-control="context" data-item="restore" onclick={() => contextAction('restore')}>Restore Note</button>
      {:else}
        <button type="button" role="menuitem" data-notes-control="context" data-item="pin" onclick={() => contextAction('pin')}>{noteState.notes.find((note) => note.id === context.id)?.pinned ? 'Unpin Note' : 'Pin Note'}</button>
        <button type="button" role="menuitem" data-notes-control="context" data-item="delete" onclick={() => contextAction('delete')}>Delete Note</button>
      {/if}
    </div>
  {/if}
</section>

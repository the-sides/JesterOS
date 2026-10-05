<script>
  import { tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';

  let { profile, state: stackState, folder, items, view, anchor, execute } = $props();
  let panel = $state();
  let pane = $state();
  let geometry = $state(null);
  let observing = 0;
  const modern = $derived(profile.renderer === 'sonoma');
  const Icon = $derived(modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const nested = $derived(stackState.pathFileIds.length > 1);
  const fanCapacity = $derived(geometry?.fanCapacity ?? 1);
  const visibleItems = $derived(view === 'fan' ? items.slice(0, fanCapacity) : items);
  const overflow = $derived(view === 'fan' && items.length > fanCapacity);

  function request(command, target = {}, payload = {}) {
    return execute({ command: `dock.stack.${command}`, target, payload });
  }
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
  }
  function rectOf(node) {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top,
      right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function mounted() {
    return panel?.isConnected && pane?.isConnected && geometry && panel.getClientRects().length;
  }
  function controls() {
    return mounted() ? [...panel.querySelectorAll('[data-dock-stack-item-key]')].filter(node => !node.disabled) : [];
  }
  function control(itemId) {
    return controls().find(node => node.dataset.dockStackItemKey === itemId);
  }
  export function itemIds() {
    return controls().map(node => node.dataset.dockStackItemKey);
  }
  export function bounds() {
    if (!mounted()) return null;
    return { popup: rectOf(panel), controls: controls().map(node => ({ itemId: node.dataset.dockStackItemKey, ...rectOf(node) })) };
  }
  export function scrollPosition() {
    return mounted() ? { top: pane.scrollTop, left: pane.scrollLeft } : null;
  }
  export async function focus(itemId) {
    await tick(); await tick();
    const node = control(itemId);
    const root = panel;
    if (!node) return false;
    observing++;
    try {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      await tick();
      if (!node.isConnected || panel !== root || control(itemId) !== node) return false;
      node.focus({ preventScroll: true });
      await tick();
      if (!mounted() || panel !== root || document.activeElement !== node) return false;
      const rect = node.getBoundingClientRect();
      const region = (pane.contains(node) ? pane : panel).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > region.top && rect.top < region.bottom
        && rect.right > region.left && rect.left < region.right;
    } finally { observing--; }
  }
  export async function scroll(top, left = 0) {
    await tick(); await tick();
    if (!mounted() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    const node = pane;
    observing++;
    try {
      node.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      return mounted() && pane === node ? scrollPosition() : null;
    } finally { observing--; }
  }

  // CSS coordinates and the Dock anchor are physical client pixels. Restrict the
  // popup to the visual viewport and any clipping scene ancestor, not screen size.
  $effect(() => {
    const node = panel;
    const source = anchor;
    const presentation = view;
    const count = items.length;
    modern;
    if (!node || !source) { geometry = null; return; }
    let cancelled = false;
    let observer;
    const ancestors = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    function measure() {
      if (cancelled || !node.isConnected || panel !== node) return;
      const viewport = window.visualViewport;
      let left = viewport?.offsetLeft ?? 0;
      let top = viewport?.offsetTop ?? 0;
      let right = left + (viewport?.width ?? document.documentElement.clientWidth);
      let bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
      for (const parent of ancestors) {
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
          left = Math.max(left, rect.left); right = Math.min(right, rect.right);
        }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
          top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
        }
      }
      const margin = 6;
      left += margin; top += margin; right -= margin; bottom -= margin;
      const width = Math.max(1, Math.min(presentation === 'grid' ? 484 : presentation === 'fan' ? 330 : 300, right - left));
      const pointerHeight = 10;
      const anchorX = clamp(source.x, left, right);
      const anchorY = clamp(source.y, top, bottom + margin);
      const roomAbove = anchorY - pointerHeight - top;
      const roomBelow = bottom - anchorY - pointerHeight;
      const below = roomAbove < 112 && roomBelow > roomAbove;
      // A clipped/mid-screen anchor may leave neither side tall enough. In that
      // case clamp the whole panel into the scene, keeping its actions reachable.
      const minimumHeight = presentation === 'fan' ? 114 : 112;
      const availableHeight = Math.max(1, below ? roomBelow : roomAbove,
        Math.min(minimumHeight, bottom - top - pointerHeight));
      const compactFan = presentation === 'fan' && availableHeight < 190;
      const headerHeight = compactFan ? 28 : 36;
      const finderHeight = compactFan ? 34 : 40;
      const moreHeight = compactFan ? 28 : 34;
      const fanRow = compactFan ? clamp(availableHeight - headerHeight - finderHeight - moreHeight - 2, 24, 40) : 56;
      const capacity = clamp(Math.floor((availableHeight - headerHeight - finderHeight - moreHeight - 2) / fanRow), 1, 7);
      const hasMore = presentation === 'fan' && count > capacity;
      const columns = Math.max(1, Math.floor((width - 24) / 104));
      const contentHeight = presentation === 'fan' ? (count ? Math.min(count, capacity) * fanRow : 40)
        : presentation === 'grid' ? Math.max(82, Math.ceil(count / columns) * 104 + 16)
          : Math.max(52, count * 29 + 8);
      const desiredHeight = headerHeight + finderHeight + contentHeight + (hasMore ? moreHeight : 0) + 2;
      const height = Math.min(desiredHeight, 552, availableHeight);
      const x = clamp(anchorX - width / 2, left, right - width);
      const y = clamp(below ? anchorY + pointerHeight : anchorY - pointerHeight - height, top, bottom - height);
      const next = { x, y, width, height, below, pointer: clamp(anchorX - x, 16, width - 16),
        fanCapacity: capacity, columns, fanRow, headerHeight, finderHeight, moreHeight };
      if (!geometry || Object.keys(next).some(key => geometry[key] !== next[key])) geometry = next;
    }
    tick().then(() => {
      if (cancelled || !node.isConnected) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(node);
      for (const parent of ancestors) observer.observe(parent);
    });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelled = true; observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  });

  $effect(() => {
    const node = pane;
    const top = stackState.scroll.top;
    const left = stackState.scroll.left;
    stackState.folderId; view; geometry?.height; visibleItems.length;
    if (!node) return;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !node.isConnected || pane !== node) return;
      if (node.scrollTop !== top || node.scrollLeft !== left) node.scrollTo({ top, left, behavior: 'instant' });
    });
    return () => { cancelled = true; };
  });

  $effect(() => {
    const selected = stackState.focusedItemId;
    const renderedFiles = visibleItems;
    nested; overflow; geometry; panel;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !mounted() || !selected || control(selected)) return;
      select(renderedFiles.length ? `file:${renderedFiles[0].id}` : 'open-finder');
    });
    return () => { cancelled = true; };
  });

  function select(itemId, observe = false) {
    if (stackState.focusedItemId !== itemId && (!observe || !observing)) request('select', { itemId }, observe ? { observe: true } : {});
  }
  function observeScroll() {
    const position = scrollPosition();
    if (position && (position.top !== stackState.scroll.top || position.left !== stackState.scroll.left)) {
      request('scroll', {}, { ...position, observe: true });
    }
  }
  function activate(itemId) {
    if (itemId === 'open-finder') request('openInFinder');
    else if (itemId === 'more') request('showMore');
    else if (itemId === 'back') request('navigate', { folderId: stackState.pathFileIds.at(-2) });
    else if (itemId?.startsWith('file:')) request('activate', { fileId: itemId.slice(5) });
  }
  function clickFile(event, file) {
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) { event.preventDefault(); return; }
    const itemId = `file:${file.id}`;
    if (profile.renderer === 'mojave' && event.detail !== 0 && event.pointerType !== 'touch') select(itemId);
    else if (event.detail < 2) activate(itemId);
  }
  function doubleClickFile(event, file) {
    event.preventDefault(); event.stopPropagation();
    if (profile.renderer === 'mojave' && !event.ctrlKey && event.button === 0) activate(`file:${file.id}`);
  }
  function clickControl(event, itemId) {
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) { event.preventDefault(); return; }
    if (event.detail < 2) activate(itemId);
  }
  function pointerdown(event) {
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) event.preventDefault();
  }
  function contextmenu(event) { event.preventDefault(); event.stopPropagation(); }
  function hover(event, itemId) {
    if (view !== 'grid' && event.pointerType === 'mouse' && !event.buttons) select(itemId);
  }
  function keydown(event) {
    event.stopPropagation();
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const keys = itemIds();
    const current = keys.includes(document.activeElement?.dataset?.dockStackItemKey)
      ? document.activeElement.dataset.dockStackItemKey : stackState.focusedItemId;
    const index = keys.indexOf(current);
    let next;
    if (event.key === 'Escape') request('close');
    else if (event.key === 'Tab') { request('close', {}, { restoreFocus: false }); return; }
    else if (event.key === 'Enter' || event.key === ' ') { if (keys.includes(current)) activate(current); }
    else if (event.key === 'Backspace' || (event.key === 'ArrowLeft' && nested && view !== 'grid')) {
      if (nested) activate('back');
    } else if (event.key === 'Home') next = keys[0];
    else if (event.key === 'End') next = keys.at(-1);
    else if (event.key === 'ArrowRight' && view === 'list' && current?.startsWith('file:')
      && items.find(file => `file:${file.id}` === current)?.kind === 'folder') activate(current);
    else if (event.key.startsWith('Arrow')) {
      let step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      if (view === 'grid' && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && current?.startsWith('file:')) {
        const files = keys.filter(key => key.startsWith('file:'));
        const fileIndex = files.indexOf(current);
        const destination = fileIndex + step * geometry.columns;
        next = destination < 0 ? (nested ? 'back' : files[0]) : destination >= files.length ? 'open-finder' : files[destination];
      } else if (view === 'fan' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const vertical = ['open-finder', ...keys.filter(key => key.startsWith('file:')),
          ...(overflow ? ['more'] : []), ...(nested ? ['back'] : [])];
        const position = vertical.indexOf(current);
        next = vertical[clamp(position < 0 ? 0 : position - step, 0, vertical.length - 1)];
      } else {
        next = keys[clamp(index < 0 ? 0 : index + step, 0, keys.length - 1)];
      }
    } else return;
    event.preventDefault();
    if (next) select(next);
  }
</script>

<div bind:this={panel} class="dock-stack" class:modern class:fan={view === 'fan'} class:grid={view === 'grid'} class:list={view === 'list'} class:below={geometry?.below}
  data-dock-stack data-dock-stack-view={view} data-folder-id={folder.id}
  role="dialog" aria-label={`${folder.name}, ${view} view`} tabindex="-1"
  style:left={`${geometry?.x ?? 0}px`} style:top={`${geometry?.y ?? 0}px`}
  style:width={`${geometry?.width ?? 1}px`} style:height={`${geometry?.height ?? 1}px`}
  style:--pointer-x={`${geometry?.pointer ?? 16}px`} style:--grid-columns={geometry?.columns ?? 1}
  style:--fan-row={`${geometry?.fanRow ?? 56}px`} style:--header-height={`${geometry?.headerHeight ?? 36}px`}
  style:--finder-height={`${geometry?.finderHeight ?? 40}px`} style:--more-height={`${geometry?.moreHeight ?? 34}px`}
  style:--footer-height={`${(geometry?.finderHeight ?? 40) + (overflow ? geometry?.moreHeight ?? 34 : 0)}px`}
  style:visibility={geometry ? 'visible' : 'hidden'} onkeydown={keydown} onpointerdown={pointerdown} oncontextmenu={contextmenu}>
  <header class="stack-header">
    {#if nested}
      <button type="button" class="back-control" data-dock-stack-item-key="back" class:selected={stackState.focusedItemId === 'back'}
        tabindex={stackState.focusedItemId === 'back' ? 0 : -1} aria-label="Back to enclosing folder" title="Back to enclosing folder"
        onfocus={() => select('back', true)} onclick={event => clickControl(event, 'back')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg>
      </button>
    {/if}
    <h2 title={folder.name}>{folder.name}</h2>
  </header>
  <div bind:this={pane} class="stack-pane" aria-label={`Items in ${folder.name}`} onscroll={observeScroll}>
    <div class="stack-items">
      {#each visibleItems as file, index (file.id)}
        {@const itemId = `file:${file.id}`}
        <button type="button" class="file-control" class:selected={stackState.focusedItemId === itemId}
          data-dock-stack-item-key={itemId} data-file-id={file.id} tabindex={stackState.focusedItemId === itemId ? 0 : -1}
          aria-label={`Open ${file.name}${file.kind === 'folder' ? ', folder' : ''}`} title={file.name}
          aria-current={stackState.focusedItemId === itemId ? 'true' : undefined}
          style:--fan-offset={`${Math.min(40, index * index * 1.8)}px`} style:--fan-angle={`${-Math.min(9, index * 1.4)}deg`}
          onfocus={() => select(itemId, true)} onpointerenter={event => hover(event, itemId)}
          onclick={event => clickFile(event, file)} ondblclick={event => doubleClickFile(event, file)}>
          <span class="file-icon" aria-hidden="true"><Icon name={file.icon ?? (file.kind === 'folder' ? 'folder' : 'pdf')} assets={profile.assets}/></span>
          <span class="file-label">{file.name}</span>
          {#if file.kind === 'folder' && view === 'list'}<svg class="folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>{/if}
        </button>
      {:else}
        <p class="empty-state">This folder is empty.</p>
      {/each}
    </div>
  </div>
  <footer class="stack-footer">
    {#if overflow}
      <button type="button" class="more-control" data-dock-stack-item-key="more" class:selected={stackState.focusedItemId === 'more'}
        tabindex={stackState.focusedItemId === 'more' ? 0 : -1} title="Show all items in a grid" aria-label={`Show all ${items.length} items in a grid`}
        onfocus={() => select('more', true)} onpointerenter={event => hover(event, 'more')} onclick={event => clickControl(event, 'more')}>
        <span>More…</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>
      </button>
    {/if}
    <button type="button" class="finder-control" data-dock-stack-item-key="open-finder" class:selected={stackState.focusedItemId === 'open-finder'}
      tabindex={stackState.focusedItemId === 'open-finder' || stackState.focusedItemId === null ? 0 : -1}
      onfocus={() => select('open-finder', true)} onpointerenter={event => hover(event, 'open-finder')} onclick={event => clickControl(event, 'open-finder')}>
      <svg class="finder-arrow" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><path class="arrow-fill" d="m23 9 10 9-10 8v-5c-8-1-12 3-13 9-2-10 2-16 13-16z"/></svg>
      <span>Open in Finder</span>
    </button>
  </footer>
</div>

<style>
  .dock-stack { position: fixed; z-index: 7100; box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; color: #252525; border: 1px solid rgb(0 0 0 / 24%); border-radius: 7px; background: rgb(218 213 211 / 88%); box-shadow: 0 8px 28px #0006, inset 0 1px 0 #ffffff5c; backdrop-filter: blur(22px) saturate(1.15); font-family: var(--ui-font); font-size: 13px; line-height: 18px; user-select: none; outline: none; }
  .dock-stack::after { content: ''; position: absolute; z-index: -1; left: calc(var(--pointer-x) - 8px); bottom: -9px; width: 16px; height: 16px; transform: rotate(45deg); border-right: 1px solid rgb(0 0 0 / 24%); border-bottom: 1px solid rgb(0 0 0 / 24%); border-radius: 0 0 3px; background: rgb(218 213 211 / 96%); }
  .below::after { top: -9px; bottom: auto; transform: rotate(225deg); }
  .modern { border-radius: 10px; background: rgb(227 231 224 / 80%); border-color: rgb(41 45 36 / 28%); font-family: var(--sonoma-font); box-shadow: 0 10px 34px #0005, inset 0 0 0 1px #ffffff38; backdrop-filter: blur(30px) saturate(1.45); }
  .modern::after { background: rgb(227 231 224 / 94%); }
  .stack-header { position: relative; display: flex; align-items: center; flex-shrink: 0; box-sizing: border-box; height: var(--header-height); min-width: 0; padding: 3px 38px; }
  h2 { width: 100%; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; font-size: 15px; line-height: 22px; font-weight: 400; }
  button { box-sizing: border-box; border: 0; background: transparent; color: inherit; font: inherit; cursor: default; outline: none; }
  .back-control { position: absolute; left: 7px; top: 3px; display: grid; place-items: center; width: 24px; height: 24px; padding: 5px; border-radius: 4px; }
  .back-control svg, .folder-chevron, .more-control svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; flex-shrink: 0; }
  .stack-pane { flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scroll-behavior: auto; }
  .stack-items { display: grid; grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr)); align-content: start; gap: 6px; padding: 8px 12px; }
  .file-control { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-width: 0; height: 98px; padding: 4px; border-radius: 5px; }
  .file-icon { display: block; width: 64px; height: 64px; flex-shrink: 0; filter: drop-shadow(0 2px 2px #0003); }
  .file-icon :global(.app-icon), .file-icon :global(.sonoma-icon) { display: block; width: 100%; height: 100%; }
  .file-label { display: block; max-width: 100%; min-width: 0; padding: 0 3px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-control.selected .file-label { color: white; background: #3875c9; }
  .file-control.selected .file-icon { border-radius: 5px; background: #ffffff35; }
  .file-control:focus-visible .file-label { outline: 2px solid #94c6ff; outline-offset: 1px; }
  .stack-footer { box-sizing: border-box; flex-shrink: 0; height: var(--footer-height); min-width: 0; padding: 3px 6px; border: 1px solid transparent; border-top-color: #00000016; border-radius: 0 0 6px 6px; }
  .finder-control, .more-control { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: calc(var(--finder-height) - 8px); margin: 0; padding: 2px 8px; border-radius: 4px; }
  .finder-control span, .more-control span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .finder-arrow { width: 24px; height: 24px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.4; }
  .arrow-fill { fill: currentColor; stroke: none; }
  .more-control { height: var(--more-height); justify-content: space-between; }
  .back-control.selected, .finder-control.selected, .more-control.selected { background: #3875c9; color: white; }
  .back-control:focus-visible, .finder-control:focus-visible, .more-control:focus-visible { outline: 2px solid #94c6ff; outline-offset: -1px; }
  .empty-state { grid-column: 1 / -1; align-self: center; margin: 12px 0; padding: 0 8px; color: #575757; text-align: center; }
  .list .stack-items { display: flex; flex-direction: column; gap: 0; padding: 4px 5px; }
  .list .file-control { flex-direction: row; justify-content: flex-start; gap: 7px; width: 100%; height: 29px; flex-shrink: 0; padding: 3px 7px; border-radius: 3px; text-align: left; }
  .list .file-icon { width: 22px; height: 22px; }
  .list .file-label { flex: 1; padding: 0; }
  .list .file-control.selected { color: white; background: #3875c9; }
  .list .file-control.selected .file-icon { background: transparent; }
  .list .file-control:focus-visible { outline: 2px solid #94c6ff; outline-offset: -1px; }
  .list .file-control:focus-visible .file-label { outline: none; }
  .fan { border: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
  .fan::after { background: rgb(57 57 57 / 94%); border-color: #ffffff30; }
  .fan .stack-header { color: white; text-shadow: 0 1px 3px #000; }
  .fan h2 { font-size: 13px; font-weight: 500; }
  .fan .stack-pane { overflow: hidden; }
  .fan .stack-items { display: flex; flex-direction: column-reverse; gap: 0; padding: 0 8px; min-height: 100%; box-sizing: border-box; }
  .fan .file-control { flex-direction: row-reverse; justify-content: flex-start; gap: 8px; height: var(--fan-row); flex-shrink: 0; padding: 0; padding-right: var(--fan-offset); }
  .fan .file-icon { width: calc(var(--fan-row) - 4px); height: calc(var(--fan-row) - 4px); transform: rotate(var(--fan-angle)); }
  .fan .file-label { padding: 3px 8px; color: white; background: rgb(30 30 30 / 78%); border: 1px solid #ffffff25; box-shadow: 0 1px 3px #0005; text-align: right; }
  .fan .file-control.selected .file-label { background: #3875c9; border-color: #82b9f4; }
  .fan .file-control.selected .file-icon { background: transparent; }
  .fan .stack-footer { color: #f8f8f8; background: rgb(57 57 57 / 88%); border: 1px solid #ffffff30; border-radius: 6px; box-shadow: 0 3px 10px #0005; backdrop-filter: blur(18px); }
  .fan .empty-state { margin: 8px 0; color: white; align-self: stretch; text-shadow: 0 1px 3px #000; }
  .modern .back-control, .modern .finder-control, .modern .more-control, .modern .file-control { border-radius: 5px; }
  @media (prefers-reduced-transparency: reduce) { .dock-stack:not(.fan) { background: #dedcd7; backdrop-filter: none; } .modern:not(.fan) { background: #e2e5df; } .fan .stack-footer { background: #393939; } }
</style>

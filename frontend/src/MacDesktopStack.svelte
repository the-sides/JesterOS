<script>
  let { profile, options, stack, viewState, execute, Icon, onnavigate } = $props();
  const selected = $derived(viewState.stacks.focusedStackId === stack.id || stack.fileIds.every(id => viewState.selectedFileIds.includes(id)));
  const customView = $derived(options.iconSize !== 64 || options.gridSpacing !== (profile.capabilities.includes('shell.window-green-menu') ? 24 : 23)
    || options.textSize !== 12 || options.labelPosition !== 'bottom');
  const label = $derived(stack.browsing && !stack.expanded ? stack.topItem.name : stack.name);
  let wheelDistance = 0;
  function request(command, target = { stackId: stack.id }, payload = {}) { return execute({ command: `desktop.stacks.${command}`, target, payload }); }
  function context(event) {
    event.preventDefault(); event.stopPropagation();
    request('context', { stackId: stack.id }, { x: Math.max(0, event.clientX), y: Math.max(0, event.clientY) });
  }
  function pointerdown(event) {
    event.stopPropagation();
    if (event.button === 0 && event.ctrlKey) context(event);
  }
  function click(event) {
    if (event.ctrlKey || viewState.context) { event.preventDefault(); return; }
    if (event.detail < 2) request('expand', { stackId: stack.id }, { expanded: !stack.expanded });
  }
  function keydown(event) {
    if (event.isComposing) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = event.currentTarget.getBoundingClientRect();
      event.preventDefault(); event.stopPropagation();
      request('context', { stackId: stack.id }, { x: Math.max(0, rect.left + 8), y: Math.max(0, rect.top + 8) });
    } else if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'o' || event.key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation(); request('open');
    } else if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); execute({ command: 'desktop.trash', target: { fileIds: stack.fileIds }, payload: {} });
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation();
        request('expand', { stackId: stack.id }, { expanded: !stack.expanded });
      } else if (event.key === 'Escape' && stack.expanded) {
        event.preventDefault(); event.stopPropagation(); request('expand', { stackId: stack.id }, { expanded: false });
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        if (stack.expanded) {
          if (event.key === 'ArrowLeft') request('expand', { stackId: stack.id }, { expanded: false });
        } else request('browse', { stackId: stack.id }, { direction: event.key === 'ArrowLeft' ? 'previous' : 'next' });
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation(); onnavigate?.(event.key === 'ArrowUp' ? 'previous' : 'next');
      }
    }
  }
  function wheel(event) {
    if (stack.expanded) return;
    const horizontal = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!horizontal || (!event.shiftKey && Math.abs(horizontal) < Math.abs(event.deltaY))) return;
    event.preventDefault(); event.stopPropagation();
    wheelDistance += horizontal;
    if (Math.abs(wheelDistance) < 30) return;
    const direction = wheelDistance > 0 ? 'next' : 'previous';
    wheelDistance = 0;
    request('browse', { stackId: stack.id }, { direction });
  }
</script>
<button type="button" class="desktop-stack" class:desktop-file={profile.renderer === 'mojave'} class:sonoma-file={profile.renderer === 'sonoma'} class:golden-gate-file={profile.renderer === 'golden-gate'} class:modern={profile.capabilities.includes('shell.window-green-menu')} class:custom-view={customView} class:selected class:right-label={options.labelPosition === 'right'}
  data-stack-id={stack.id} aria-label={`${label}, stack, ${stack.fileIds.length} ${stack.fileIds.length === 1 ? 'item' : 'items'}`} aria-expanded={stack.expanded}
  style:--stack-custom-size={`${options.iconSize}px`} style:--stack-custom-text={`${options.textSize}px`}
  onpointerdown={pointerdown} onclick={click} ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); request('open'); }} oncontextmenu={context} onkeydown={keydown} onwheel={wheel}
  onfocus={() => { if (viewState.stacks.focusedStackId !== stack.id) request('focus'); }}>
  <span class="stack-icon" class:expanded={stack.expanded}>
    {#if stack.expanded}
      <Icon name="folder" assets={profile.assets}/><svg class="down-arrow" viewBox="0 0 64 64" aria-hidden="true"><path d="M27 21h10v16h9L32 51 18 37h9z" fill="#f5faff" stroke="#416b96" stroke-width="1"/></svg>
    {:else if options.showIconPreview}
      <Icon name={stack.topItem.icon} assets={profile.assets}/>
    {:else}
      <svg class="generic-document" viewBox="0 0 64 64" aria-hidden="true"><path fill="#fafafa" stroke="#b4b4b4" d="M14 3h25l12 12v46H14z"/><path fill="#dedede" stroke="#b4b4b4" d="M39 3v12h12"/><path stroke="#b6c1cb" stroke-width="2" d="M22 27h21M22 34h21M22 41h21M22 48h15"/></svg>
    {/if}
  </span>
  <span class="stack-label">{label}</span>
  {#if options.showItemInfo}<small class="stack-item-info">{stack.fileIds.length} {stack.fileIds.length === 1 ? 'item' : 'items'}</small>{/if}
</button>
<style>
  .desktop-stack { --stack-size: var(--stack-custom-size); --stack-text: var(--stack-custom-text); position: relative; flex-shrink: 0; align-self: start; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 5px; width: max(102px, calc(var(--stack-size) + 38px)); padding: 0; border: 0; background: transparent; color: white; font: inherit; font-size: var(--stack-text); line-height: 16px; text-align: center; text-shadow: 0 1px 2px #000; touch-action: none; user-select: none; direction: ltr; }
  .custom-view { line-height: 1.3333; }
  .modern { width: max(104px, calc(var(--stack-size) + 40px)); }
  .stack-icon { position: relative; display: block; flex-shrink: 0; width: var(--stack-size); height: var(--stack-size); isolation: isolate; }
  .stack-icon:not(.expanded)::before, .stack-icon:not(.expanded)::after { content: ''; position: absolute; z-index: -1; left: 19%; top: 5%; width: 59%; height: 89%; border: 1px solid #c0c0c0; background: #f4f4f1; box-shadow: 0 1px 2px #0005; transform: rotate(-9deg); }
  .stack-icon:not(.expanded)::after { transform: rotate(8deg); }
  .stack-icon :global(.app-icon), .stack-icon :global(.sonoma-icon), .generic-document, .down-arrow { width: var(--stack-size); height: var(--stack-size); }
  .down-arrow { position: absolute; inset: 0; }
  .stack-label { max-width: 100%; padding: 0 3px; border-radius: 3px; overflow-wrap: anywhere; }
  .selected .stack-label { background: var(--appearance-selection, #3c76c1); color: var(--appearance-selection-ink, white); box-shadow: inset 0 0 0 1px var(--appearance-focus, #8ebbf0); }
  .selected .stack-icon { border-radius: 4px; background: #ffffff26; }
  .desktop-stack:focus { outline: none; }
  .desktop-stack:focus-visible .stack-label { box-shadow: inset 0 0 0 1px var(--appearance-focus, #afd3ff), 0 0 0 2px var(--appearance-focus, #abd1ff); }
  .stack-item-info { max-width: 100%; color: #c5defb; font-size: .9em; }
  .right-label { width: max(180px, calc(var(--stack-size) + 120px)); flex-direction: row; flex-wrap: wrap; text-align: left; }
  .right-label .stack-label { flex: 1; min-width: 0; }
  .right-label .stack-item-info { flex-basis: calc(100% - var(--stack-size) - 6px); margin-left: calc(var(--stack-size) + 6px); }
  @media (max-width: 760px) {
    .desktop-stack:not(.custom-view) { --stack-size: 48px; --stack-text: 11px; width: 82px; }
    .modern:not(.custom-view) { width: 86px; }
  }
  @media (max-width: 520px) and (max-height: 650px) { .desktop-stack:not(.modern):not(.custom-view) { width: 78px; } }
</style>

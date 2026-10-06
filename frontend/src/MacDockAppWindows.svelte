<script>
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { profile, app, state, cards, area, execute } = $props();
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const Icon = $derived(profile.renderer === 'golden-gate' ? GoldenGateIcon : modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
  const selectedWindowId = $derived(state.selectedWindowId);

  function request(command, windowId) {
    return execute({ command: `dock.windows.${command}`, target: windowId === undefined ? {} : { windowId }, payload: {} });
  }

  function select(windowId) {
    if (selectedWindowId !== windowId) request('select', windowId);
  }

  function keydown(event) {
    event.stopPropagation();
    if (event.isComposing) return;
    const index = cards.findIndex(card => card.windowId === selectedWindowId);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = cards[(index + 1) % cards.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = cards[index < 0 ? cards.length - 1 : (index - 1 + cards.length) % cards.length];
    else if (event.key === 'Home') next = cards[0];
    else if (event.key === 'End') next = cards.at(-1);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (index >= 0) request('activate', cards[index].windowId);
    } else if (event.key === 'Escape') request('close');
    else return;
    event.preventDefault();
    if (next) select(next.windowId);
  }

  function pointerdown(event) {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey) event.preventDefault();
  }

  function activate(event, windowId) {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) return;
    request('activate', windowId);
  }

  function close(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.button !== 0) return;
    request('close');
  }

  function suppressContext(event) {
    event.preventDefault();
    event.stopPropagation();
  }

</script>

<div class="app-windows" class:modern data-dock-app-windows data-app-id={app.id}
  role="dialog" aria-label={`${app.name} windows`} tabindex="-1"
  style:width={`${area.width}px`} style:height={`${area.height}px`}
  style:--overview-width={`${area.width}px`} style:--overview-height={`${area.height}px`}
  onkeydown={keydown} oncontextmenu={suppressContext}>
  <button type="button" class="backdrop" aria-label="Close app window overview" tabindex="-1"
    onpointerdown={pointerdown} onclick={close}></button>

  <header class="app-identity">
    <span class="identity-icon" aria-hidden="true"><Icon name={app.icon} assets={profile.assets}/></span>
    <h2>{app.name}</h2>
  </header>

  {#each cards as card (card.windowId)}
    {@const label = card.label}
    <button type="button" class="window-hit" class:selected={selectedWindowId === card.windowId}
      data-dock-window-id={card.windowId} aria-label={`${card.title}${card.minimized ? ', minimized' : ''}`}
      aria-pressed={selectedWindowId === card.windowId} tabindex={selectedWindowId === card.windowId ? 0 : -1}
      style:left={`${card.rect.x}px`} style:top={`${card.rect.y}px`}
      style:width={`${card.rect.width}px`} style:height={`${card.rect.height}px`}
      onpointerenter={() => select(card.windowId)} onfocus={() => select(card.windowId)}
      onpointerdown={pointerdown} onclick={(event) => activate(event, card.windowId)}></button>
    <div class="window-label" class:selected={selectedWindowId === card.windowId}
      data-dock-window-label={card.windowId} aria-hidden="true" title={`${card.title}${card.minimized ? ' — Minimized' : ''}`}
      style:left={`${label.x}px`} style:top={`${label.y}px`} style:width={`${label.width}px`}
      style:height={`${label.height}px`} style:font-size={`${Math.min(12, label.height * 0.6)}px`}
      style:line-height={`${label.height}px`}
      style:padding={`0 ${Math.min(7, label.width / 10)}px`}>
      <span class="window-title">{card.title}</span>
      {#if card.minimized}<span class="minimized">Minimized</span>{/if}
    </div>
  {:else}
    <p class="empty-state" role="status">No Available Windows</p>
  {/each}
</div>

<style>
  /* This root must not establish a stacking context: live managed windows sit between backdrop and controls. */
  .app-windows { position: absolute; left: 0; top: 0; overflow: hidden; pointer-events: none; color: white; font-family: var(--system-font, -apple-system, BlinkMacSystemFont, sans-serif); text-shadow: 0 1px 3px #000b; user-select: none; outline: none; }
  .backdrop { position: absolute; inset: 0; z-index: 7000; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: rgb(0 0 0 / 48%); pointer-events: auto; cursor: default; outline: none; }
  .modern .backdrop { background: rgb(0 0 0 / 38%); }
  .app-identity { position: absolute; z-index: 7002; top: min(20px, 4%); left: 50%; transform: translateX(-50%); display: flex; justify-content: center; align-items: center; gap: min(10px, 2vw); box-sizing: border-box; width: min(440px, 100%); height: min(44px, calc(var(--overview-height) / 4)); overflow: hidden; padding: min(4px, calc(var(--overview-height) / 24)) min(12px, 2%); }
  .identity-icon { display: block; width: min(36px, var(--overview-width), calc(var(--overview-height) / 6)); height: min(36px, var(--overview-width), calc(var(--overview-height) / 6)); flex-shrink: 0; }
  .identity-icon :global(.app-icon), .identity-icon :global(.sonoma-icon) { display: block; width: 100%; height: 100%; }
  h2 { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(12px, calc(var(--overview-width) / 24), 22px); line-height: 1.3; font-weight: 500; }
  .window-hit { position: absolute; z-index: 7002; box-sizing: border-box; padding: 0; border: 0; border-radius: 5px; background: transparent; pointer-events: auto; cursor: default; outline: none; }
  .window-hit.selected { box-shadow: inset 0 0 0 3px var(--appearance-selection, #58a5ff), 0 0 0 1px var(--appearance-focus, #c0deff), 0 0 8px 2px var(--appearance-focus-shadow, #3b8eff80); }
  .modern .window-hit { border-radius: 9px; }
  .modern .window-hit.selected { box-shadow: inset 0 0 0 3px var(--appearance-selection, #75b5ff), 0 0 0 1px var(--appearance-focus, #d0e6ff), 0 0 8px 2px var(--appearance-focus-shadow, #4b9cff70); }
  .window-label { position: absolute; z-index: 7002; display: flex; justify-content: center; align-items: center; box-sizing: border-box; height: 26px; gap: 6px; padding: 2px 7px; border-radius: 5px; background: rgb(24 24 24 / 76%); font-size: 12px; line-height: 18px; text-shadow: 0 1px 1px #0009; }
  .window-label.selected { background: var(--appearance-selection, rgb(28 89 163 / 92%)); color: var(--appearance-selection-ink, white); }
  .window-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .minimized { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d5e3f6; font-size: 10px; }
  .window-label.selected .minimized { color: var(--appearance-selection-ink, #d5e3f6); }
  .empty-state { position: absolute; z-index: 7002; top: 50%; left: 50%; transform: translate(-50%, -50%); box-sizing: border-box; width: min(360px, 100%); max-height: 100%; overflow: hidden; margin: 0; padding: min(10px, 2%) min(16px, 3%); text-align: center; overflow-wrap: anywhere; font-size: clamp(12px, calc(var(--overview-width) / 20), 24px); line-height: 1.3; font-weight: 400; }
</style>

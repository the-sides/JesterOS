<script>
  import { onDestroy } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import WindowResizeHandles from './WindowResizeHandles.svelte';
  import './golden-gate.css';

  let { window, active, zIndex, onfocus, onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu, fullScreen = false, revealedTop = true, modernGreenMenu = true, onmove, resizable = false, onresize, presentationBounds, interactive = true, visible = true, children } = $props();
  const bounds = $derived(presentationBounds ?? window.bounds);
  $effect(() => { if (!interactive || !visible || fullScreen) endDrag(); });
  let element;
  let drag = null;

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const { pointerId } = drag;
    drag = null;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  function startDrag(event) {
    if (!interactive || !visible || !event.isPrimary || event.button !== 0) return;
    onfocus();
    const target = event.target;
    if (fullScreen || window.zoomed || !(target instanceof Element) || !target.closest('[data-window-drag]')) return;
    if (target.closest('button, input, textarea, select, a, [contenteditable], [role="button"], [data-window-no-drag]')) return;
    endDrag();
    element.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: window.bounds.x, top: window.bounds.y };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!event.buttons) {
      endDrag(event);
      return;
    }
    const x = drag.left + event.clientX - drag.x;
    const y = drag.top + event.clientY - drag.y;
    onmove(x, y);
    event.preventDefault();
  }

  onDestroy(() => endDrag());
</script>

<div bind:this={element} class="golden-gate-window-position managed-window" class:inactive={!active} class:zoomed={window.zoomed} class:full-screen={fullScreen} data-window-id={window.id} role="dialog" aria-label={window.title} tabindex="-1" inert={!interactive} style:visibility={visible ? undefined : 'hidden'} style:left="{bounds.x}px" style:top="{bounds.y}px" style:width="{bounds.width}px" style:height="{bounds.height}px" style:z-index={zIndex} onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onlostpointercapture={endDrag} onfocusin={onfocus}>
  <div class="golden-gate-window-surface" style:width="{bounds.width / bounds.scale}px" style:height="{bounds.height / bounds.scale}px" style:transform="scale({bounds.scale})">
    {#if !window.utilityKind && (window.appId === 'messages' || window.appId === 'notes')}{@render children()}
    {:else}<div class="golden-gate-launch-window"><header class="golden-gate-launch-toolbar" data-window-drag><WindowControls {active} zoomed={window.zoomed} {onclose} {onminimize} {onzoom} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu}/><span>{window.title}</span></header><div class="golden-gate-launch-content" class:application-panel-content={window.utilityKind === 'application-about' || window.utilityKind === 'application-settings' || window.appId === 'printcenter'} aria-label={window.utilityKind === 'application-about' ? 'About application content' : window.utilityKind === 'application-settings' ? 'Application settings content' : window.appId === 'finder' ? 'Finder location contents' : window.appId === 'printcenter' ? 'Print queue contents' : 'Launch-only application window'}>{@render children()}</div></div>{/if}
  </div>
  <WindowResizeHandles windowId={window.id} bounds={window.bounds} resizable={resizable && interactive && visible && !fullScreen} {onfocus} {onresize} />
</div>

<style>
  .application-panel-content { display: flex; overflow: hidden; }
  .full-screen :global(.golden-gate-window-surface), .full-screen :global(.golden-gate-window-surface > *) { border-radius: 0; box-shadow: none; }
</style>

<script>
  import { onDestroy } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import WindowResizeHandles from './WindowResizeHandles.svelte';
  import './sonoma.css';

  let { window, active, zIndex, onfocus, onclose, onminimize, onzoom, onmove, resizable = false, onresize, presentationBounds, interactive = true, visible = true, children } = $props();
  const bounds = $derived(presentationBounds ?? window.bounds);
  $effect(() => { if (!interactive) endDrag(); });
  let element;
  let drag = null;

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const { pointerId } = drag;
    drag = null;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  function startDrag(event) {
    if (!event.isPrimary || event.button !== 0) return;
    onfocus();
    const target = event.target;
    if (window.zoomed || !(target instanceof Element) || !target.closest('[data-window-drag]')) return;
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

<div bind:this={element} class="sonoma-window-position managed-window" class:inactive={!active} class:zoomed={window.zoomed} data-window-id={window.id} role="dialog" aria-label={window.title} tabindex="-1" inert={!interactive} style:visibility={visible ? undefined : 'hidden'} style:left="{bounds.x}px" style:top="{bounds.y}px" style:width="{bounds.width}px" style:height="{bounds.height}px" style:z-index={zIndex} onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onlostpointercapture={endDrag} onfocusin={onfocus}>
  <div class="sonoma-window-surface" style:width="{window.bounds.width / window.bounds.scale}px" style:height="{window.bounds.height / window.bounds.scale}px" style:transform="scale({bounds.scale})">
    {#if window.appId === 'messages' || window.appId === 'notes'}{@render children()}
    {:else}<div class="sonoma-launch-window"><header class="sonoma-launch-toolbar" data-window-drag><WindowControls {active} zoomed={window.zoomed} {onclose} {onminimize} {onzoom}/><span>{window.title}</span></header><div class="sonoma-launch-content" aria-label={window.appId === 'finder' ? 'Finder location contents' : 'Launch-only application window'}>{@render children()}</div></div>{/if}
  </div>
  <WindowResizeHandles windowId={window.id} bounds={window.bounds} {resizable} {onfocus} {onresize} />
</div>

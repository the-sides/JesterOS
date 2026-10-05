<script>
  import { onDestroy } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import './windows.css';

  let { window, area, active, zIndex, onfocus, onclose, onminimize, onzoom, onmove, children } = $props();
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
    const x = Math.max(0, Math.min(drag.left + event.clientX - drag.x, area.width - window.bounds.width));
    const y = Math.max(0, Math.min(drag.top + event.clientY - drag.y, area.height - window.bounds.height));
    onmove(x, y);
    event.preventDefault();
  }

  onDestroy(() => endDrag());
</script>

<div
  bind:this={element}
  class="window-position managed-window"
  class:inactive={!active}
  class:zoomed={window.zoomed}
  data-window-id={window.id}
  role="dialog"
  aria-label={window.title}
  tabindex="-1"
  style:left="{window.bounds.x}px"
  style:top="{window.bounds.y}px"
  style:width="{window.bounds.width}px"
  style:height="{window.bounds.height}px"
  style:z-index={zIndex}
  onpointerdown={startDrag}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onlostpointercapture={endDrag}
  onfocusin={onfocus}
>
  <div
    class="window-surface"
    style:width="{window.bounds.width / window.bounds.scale}px"
    style:height="{window.bounds.height / window.bounds.scale}px"
    style:transform="scale({window.bounds.scale})"
  >
    {#if window.appId === 'messages' || window.appId === 'notes'}
      {@render children()}
    {:else}
      <div class="application-window">
        <header class="application-titlebar" data-window-drag>
          <WindowControls {active} zoomed={window.zoomed} {onclose} {onminimize} {onzoom} />
          <span class="application-title">{window.title}</span>
        </header>
        <div class="application-content"></div>
      </div>
    {/if}
  </div>
</div>

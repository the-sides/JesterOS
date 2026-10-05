<script>
  import { onDestroy } from 'svelte';
  let { onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu,
    fullScreen = false, revealedTop = true, modernGreenMenu = false,
    active = true, zoomed = false, class: className = '' } = $props();
  let holdTimer;
  let hoverTimer;
  let held = false;
  let pointerId = null;
  let latestPointer;
  function clearTimers() { clearTimeout(holdTimer); clearTimeout(hoverTimer); }
  function down(event) {
    if (event.button !== 0 || !event.isPrimary || event.altKey) return;
    clearTimers(); held = false; latestPointer = event; pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!modernGreenMenu) holdTimer = setTimeout(() => {
      held = true;
      onsplitbegin?.(latestPointer);
    }, 500);
  }
  function move(event) {
    if (pointerId !== event.pointerId) return;
    latestPointer = event;
    if (held) onsplitside?.(event);
  }
  function release(event) {
    clearTimeout(holdTimer);
    pointerId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function click(event) {
    if (held) { held = false; event.preventDefault(); return; }
    clearTimers();
    if (event.altKey && !fullScreen) onzoom?.();
    else onfullscreen?.();
  }
  function hover() {
    if (modernGreenMenu) hoverTimer = setTimeout(() => ongreenmenu?.(), 350);
  }
  function keydown(event) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault(); event.stopPropagation(); clearTimers();
    if (modernGreenMenu) ongreenmenu?.();
    else onsplitbegin?.(event);
  }
  function context(event) {
    if (!modernGreenMenu) return;
    event.preventDefault(); event.stopPropagation(); clearTimers(); ongreenmenu?.();
  }
  onDestroy(clearTimers);
</script>

<div class="window-traffic-lights {className}" class:inactive={!active} aria-label="Window controls" data-window-no-drag
  inert={fullScreen && !revealedTop} style:visibility={fullScreen && !revealedTop ? 'hidden' : undefined}>
  <button type="button" class="traffic-light close" aria-label="Close window" onclick={onclose}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" /></svg>
  </button>
  <button type="button" class="traffic-light minimize" aria-label="Minimize window" disabled={fullScreen} onclick={onminimize}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" /></svg>
  </button>
  <button type="button" class="traffic-light zoom" aria-label={fullScreen ? 'Exit Full Screen' : 'Enter Full Screen'}
    aria-haspopup={modernGreenMenu ? 'menu' : 'dialog'} data-window-green-control
    onclick={click} onpointerdown={down} onpointermove={move} onpointerup={release}
    onpointercancel={(event) => { held = false; release(event); }} onlostpointercapture={() => { clearTimeout(holdTimer); pointerId = null; }}
    onpointerenter={hover} onpointerleave={() => clearTimeout(hoverTimer)} onkeydown={keydown} oncontextmenu={context}>
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {#if fullScreen || zoomed}<path class="zoom-symbol" d="M2 5h3V2Zm8 2H7v3Z" />
      {:else}<path class="zoom-symbol" d="M2 2h4L2 6Zm8 8H6l4-4Z" />{/if}
    </svg>
  </button>
</div>

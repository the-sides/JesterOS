<script>
  import { onDestroy } from 'svelte';

  let { windowId, bounds, resizable = false, onfocus, onresize } = $props();
  const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  let gesture = null;
  let destroyed = false;

  function endResize(event) {
    event?.stopPropagation();
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    const { target, pointerId } = gesture;
    gesture = null;
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  }

  function startResize(event, edge) {
    event.stopPropagation();
    if (destroyed || !resizable || gesture || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    gesture = {
      target,
      pointerId: event.pointerId,
      windowId,
      edge,
      clientX: event.clientX,
      clientY: event.clientY,
      x: bounds.x + (edge.includes('e') ? bounds.width : 0),
      y: bounds.y + (edge.includes('s') ? bounds.height : 0),
      resize: onresize,
    };
    target.setPointerCapture(event.pointerId);
    onfocus();
  }

  function moveResize(event) {
    event.stopPropagation();
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (destroyed || !resizable || windowId !== gesture.windowId || !gesture.target.isConnected || !(event.buttons & 1)) {
      endResize(event);
      return;
    }
    const { edge, x, y, clientX, clientY, resize } = gesture;
    const coordinates = {};
    // Bounds are physical workspace coordinates; client deltas retain the grab
    // offset without applying the logical application's surface scale again.
    if (edge.includes('e') || edge.includes('w')) coordinates.x = x + event.clientX - clientX;
    if (edge.includes('n') || edge.includes('s')) coordinates.y = y + event.clientY - clientY;
    resize(edge, coordinates);
    event.preventDefault();
  }

  function stopGripEvent(event) {
    event.stopPropagation();
  }

  $effect(() => {
    const currentWindowId = windowId;
    if (!resizable || (gesture && currentWindowId !== gesture.windowId)) endResize();
  });

  onDestroy(() => {
    destroyed = true;
    endResize();
  });
</script>

{#if resizable}
  {#each edges as edge (edge)}
    <!-- Pointer-only frame hit regions are not buttons or keyboard focus stops. -->
    <div
      class="resize-grip resize-{edge}"
      data-window-resize={edge}
      data-window-no-drag
      role="presentation"
      aria-hidden="true"
      onpointerdown={(event) => startResize(event, edge)}
      onpointermove={moveResize}
      onpointerup={endResize}
      onpointercancel={endResize}
      onlostpointercapture={endResize}
      onclick={stopGripEvent}
      ondblclick={stopGripEvent}
    ></div>
  {/each}
{/if}

<style>
  .resize-grip {
    position: absolute;
    z-index: 1;
    touch-action: none;
    user-select: none;
  }

  .resize-n, .resize-s {
    left: 6px;
    right: 6px;
    height: 3px;
    cursor: ns-resize;
  }
  .resize-n { top: 0; }
  .resize-s { bottom: 0; }

  .resize-e, .resize-w {
    top: 6px;
    bottom: 6px;
    width: 3px;
    cursor: ew-resize;
  }
  .resize-e { right: 0; }
  .resize-w { left: 0; }

  .resize-ne, .resize-nw, .resize-se, .resize-sw {
    width: 6px;
    height: 6px;
  }
  .resize-ne, .resize-nw { top: 0; }
  .resize-se, .resize-sw { bottom: 0; }
  .resize-ne, .resize-se { right: 0; }
  .resize-nw, .resize-sw { left: 0; }
  .resize-ne, .resize-sw { cursor: nesw-resize; }
  .resize-nw, .resize-se { cursor: nwse-resize; }
</style>

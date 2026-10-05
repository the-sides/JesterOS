<script>
  import { onDestroy } from 'svelte';
  import Windows11Icon from './Windows11Icon.svelte';
  import WindowResizeHandles from './WindowResizeHandles.svelte';
  import './windows11.css';
  let { window, active, zIndex, onfocus, onclose, onminimize, onmaximize, onmove, resizable = false, onresize,
    presentationBounds, interactive = true, visible = true, fullScreen = false, revealedTop = true, children } = $props();
  const bounds = $derived(presentationBounds ?? window.bounds);
  $effect(() => { if (!interactive || !visible || fullScreen) endDrag(); });
  let element;
  let drag = null;
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const { pointerId } = drag; drag = null;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }
  function startDrag(event) {
    if (!interactive || !visible || !event.isPrimary || event.button !== 0) return;
    onfocus();
    if (fullScreen || window.maximized || !(event.target instanceof Element) || !event.target.closest('[data-window-drag]') || event.target.closest('button,input,textarea,select,a,[contenteditable]')) return;
    endDrag(); element.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: window.bounds.x, top: window.bounds.y };
    element.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!event.buttons) { endDrag(event); return; }
    onmove(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y); event.preventDefault();
  }
  function windowKey(event) {
    if (!interactive || !visible) return;
    if (event.altKey && event.key === 'F4') { event.preventDefault(); event.stopPropagation(); onclose(); }
    else if (!fullScreen && event.metaKey && event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (!window.maximized) onmaximize(); }
    else if (!fullScreen && event.metaKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); if (window.maximized) onmaximize(); else onminimize(); }
  }
  onDestroy(() => endDrag());
</script>
<div bind:this={element} class="win11-window managed-window" class:inactive={!active} class:maximized={window.maximized} class:full-screen={fullScreen}
  data-window-id={window.id} role="dialog" aria-label={window.title} tabindex="-1" inert={!interactive}
  style:visibility={visible ? undefined : 'hidden'} style:left="{bounds.x}px" style:top="{bounds.y}px"
  style:width="{bounds.width}px" style:height="{bounds.height}px" style:z-index={zIndex}
  onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag}
  onlostpointercapture={endDrag} onfocusin={() => { if (interactive && visible) onfocus(); }} onkeydown={windowKey}
  ondblclick={(event) => { if (interactive && visible && !fullScreen && event.target.closest('[data-window-drag]') && !event.target.closest('button')) onmaximize(); }}>
  <div class="win11-window-surface" style:width="{bounds.width / bounds.scale}px" style:height="{bounds.height / bounds.scale}px" style:transform="scale({bounds.scale})">
    <header class="win11-titlebar" data-window-drag inert={fullScreen && !revealedTop} style:display={fullScreen && !revealedTop ? 'none' : undefined}>
      <Windows11Icon name={window.appId} size={16}/><span>{window.title}</span>
      <div class="win11-caption-controls">
        <button aria-label="Minimize" title="Minimize" disabled={fullScreen} onclick={onminimize}><svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg></button>
        <button aria-label={window.maximized ? 'Restore Down' : 'Maximize'} title={window.maximized ? 'Restore Down' : 'Maximize'} disabled={fullScreen} onclick={onmaximize}><svg viewBox="0 0 12 12">{#if window.maximized}<path d="M4 3V1h7v7H9M1 4h7v7H1z"/>{:else}<path d="M1.5 1.5h9v9h-9z"/>{/if}</svg></button>
        <button class="win11-close" aria-label="Close" title="Close" onclick={onclose}><svg viewBox="0 0 12 12"><path d="m1 1 10 10M11 1 1 11"/></svg></button>
      </div>
    </header>
    <div class="win11-window-body">{@render children()}</div>
  </div>
  <WindowResizeHandles windowId={window.id} bounds={window.bounds} resizable={resizable && interactive && visible && !fullScreen} {onfocus} {onresize} />
</div>

<style>
  .win11-window.full-screen { border-radius: 0; box-shadow: none; }
  .full-screen .win11-titlebar { position: absolute; inset: 0 0 auto; z-index: 1; }
</style>

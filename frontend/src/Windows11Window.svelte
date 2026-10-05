<script>
  import { onDestroy } from 'svelte';
  import Windows11Icon from './Windows11Icon.svelte';
  import WindowResizeHandles from './WindowResizeHandles.svelte';
  import './windows11.css';
  let { window, active, zIndex, onfocus, onclose, onminimize, onmaximize, onmove, resizable = false, onresize, children } = $props();
  let element;
  let drag = null;
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const { pointerId } = drag; drag = null;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }
  function startDrag(event) {
    if (!event.isPrimary || event.button !== 0) return;
    onfocus();
    if (window.maximized || !(event.target instanceof Element) || !event.target.closest('[data-window-drag]') || event.target.closest('button,input,textarea,select,a,[contenteditable]')) return;
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
    if (event.altKey && event.key === 'F4') { event.preventDefault(); event.stopPropagation(); onclose(); }
    else if (event.metaKey && event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (!window.maximized) onmaximize(); }
    else if (event.metaKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); if (window.maximized) onmaximize(); else onminimize(); }
  }
  onDestroy(() => endDrag());
</script>
<div bind:this={element} class="win11-window managed-window" class:inactive={!active} class:maximized={window.maximized} data-window-id={window.id} role="dialog" aria-label={window.title} tabindex="-1" style:left="{window.bounds.x}px" style:top="{window.bounds.y}px" style:width="{window.bounds.width}px" style:height="{window.bounds.height}px" style:z-index={zIndex} onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onlostpointercapture={endDrag} onfocusin={onfocus} onkeydown={windowKey} ondblclick={(event) => { if (event.target.closest('[data-window-drag]') && !event.target.closest('button')) onmaximize(); }}>
  <div class="win11-window-surface" style:width="{window.bounds.width / window.bounds.scale}px" style:height="{window.bounds.height / window.bounds.scale}px" style:transform="scale({window.bounds.scale})">
    <header class="win11-titlebar" data-window-drag>
      <Windows11Icon name={window.appId} size={16}/><span>{window.title}</span>
      <div class="win11-caption-controls">
        <button aria-label="Minimize" title="Minimize" onclick={onminimize}><svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg></button>
        <button aria-label={window.maximized ? 'Restore Down' : 'Maximize'} title={window.maximized ? 'Restore Down' : 'Maximize'} onclick={onmaximize}><svg viewBox="0 0 12 12">{#if window.maximized}<path d="M4 3V1h7v7H9M1 4h7v7H1z"/>{:else}<path d="M1.5 1.5h9v9h-9z"/>{/if}</svg></button>
        <button class="win11-close" aria-label="Close" title="Close" onclick={onclose}><svg viewBox="0 0 12 12"><path d="m1 1 10 10M11 1 1 11"/></svg></button>
      </div>
    </header>
    <div class="win11-window-body">{@render children()}</div>
  </div>
  <WindowResizeHandles windowId={window.id} bounds={window.bounds} {resizable} {onfocus} {onresize} />
</div>

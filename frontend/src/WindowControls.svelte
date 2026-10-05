<script>
  let { onclose, onminimize, onzoom, active = true, zoomed = false, class: className = '' } = $props();
</script>

<div class="window-traffic-lights {className}" class:inactive={!active} aria-label="Window controls" data-window-no-drag>
  <button type="button" class="traffic-light close" aria-label="Close window" onclick={onclose}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" /></svg>
  </button>
  <button type="button" class="traffic-light minimize" aria-label="Minimize window" onclick={onminimize}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" /></svg>
  </button>
  <button type="button" class="traffic-light zoom" aria-label={zoomed ? 'Restore window size' : 'Zoom window'} onclick={onzoom}>
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {#if zoomed}<path class="zoom-symbol" d="M2 5h3V2Zm8 2H7v3Z" />
      {:else}<path class="zoom-symbol" d="M2 2h4L2 6Zm8 8H6l4-4Z" />{/if}
    </svg>
  </button>
</div>

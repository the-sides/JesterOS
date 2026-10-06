<script>
  let { control, segments, textSize } = $props();
  let metrics = $state(null);
  $effect(() => {
    const node = control;
    textSize; segments;
    if (!node?.isConnected) { metrics = null; return; }
    function refresh() {
      const css = getComputedStyle(node);
      metrics = { width: node.clientWidth, top: node.scrollTop, left: node.scrollLeft,
        style: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
          'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'tab-size', 'direction', 'text-align'].map(key => `${key}:${css.getPropertyValue(key)}`).join(';'),
        multiline: node.tagName === 'TEXTAREA' };
    }
    refresh();
    const resize = new ResizeObserver(refresh); resize.observe(node);
    node.addEventListener('scroll', refresh); node.addEventListener('focus', refresh); node.addEventListener('blur', refresh);
    return () => { resize.disconnect(); node.removeEventListener('scroll', refresh); node.removeEventListener('focus', refresh); node.removeEventListener('blur', refresh); };
  });
</script>

{#if metrics && segments.length}
  <div class="text-annotation-viewport" aria-hidden="true">
    <div class="text-annotation-content" class:multiline={metrics.multiline}
      style={`${metrics.style};width:${metrics.width}px;transform:translate(${-metrics.left}px,${-metrics.top}px)`}>{#each segments as segment}<span class:find={segment.find} class:selected={segment.selected} class:spelling={segment.spelling} data-text-annotation-find={segment.find || undefined} data-text-annotation-spelling={segment.spelling || undefined}>{segment.text}</span>{/each}{'\u200b'}</div>
  </div>
{/if}

<style>
  .text-annotation-viewport { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
  .text-annotation-content { color: transparent; white-space: pre; box-sizing: border-box; transform-origin: 0 0; }
  .text-annotation-content.multiline { white-space: pre-wrap; overflow-wrap: break-word; }
  span.find { background: #eac34d55; border-radius: 2px; }
  span.selected { background: #cb952650; outline: 1px solid #b2872380; }
  span.spelling { text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: #d7443e; text-underline-offset: 3px; }
</style>

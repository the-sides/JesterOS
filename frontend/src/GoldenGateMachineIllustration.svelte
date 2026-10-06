<script>
  let { windowId, width = 155 } = $props();
  const gradientId = $derived(`system-laptop-${windowId}`);
</script>

<svg class="machine-picture" viewBox="0 0 180 110" aria-hidden="true" style:width="{width}px">
  <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop stop-color="#287ba8"/><stop offset="1" stop-color="#6cc6f1"/></linearGradient></defs>
  <rect x="28" y="8" width="124" height="82" rx="5" fill="#24272b" stroke="#778087"/>
  <path d="M31 12h118v74H31Z" fill={`url(#${gradientId})`}/>
  <path d="M82 12h16v4H82Z" fill="#22252a"/>
  <path d="m28 91-17 10q0 5 9 5h140q9 0 9-5l-17-10Z" fill="#bdc2c6" stroke="#8c9399"/>
  <path d="M24 100h132M72 101h36" stroke="#7e858b" stroke-width="2" stroke-linecap="round"/>
</svg>

<style>
  .machine-picture { display: block; max-width: 100%; height: auto; margin: 0 auto; }
</style>

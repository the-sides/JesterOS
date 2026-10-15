<script>
  let { name, size = 18 } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  {#if name === 'back'}<path d="M19 12H5m6-6-6 6 6 6"/>
  {:else if name === 'forward'}<path d="M5 12h14m-6-6 6 6-6 6"/>
  {:else if name === 'reload'}<path d="M19.8 10A8 8 0 1 0 19 16M20 4v6h-6"/>
  {:else if name === 'close'}<path d="m6 6 12 12M18 6 6 18"/>
  {:else if name === 'star'}<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9Z"/>
  {:else if name === 'menu'}<g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></g>
  {:else if name === 'tune'}<path d="M4 7h4m6 0h6M4 17h10m6 0h0"/><circle cx="11" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>
  {:else if name === 'lock'}<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
  {:else if name === 'info'}<circle cx="12" cy="12" r="8"/><path d="M12 11v6m0-10v.2"/>
  {:else if name === 'download'}<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>
  {:else if name === 'profile'}<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6.5 18a6 6 0 0 1 11 0"/>
  {:else if name === 'incognito'}<path d="m7 10 2-6h6l2 6M4 11h16"/><circle cx="7.5" cy="17" r="3.5"/><circle cx="16.5" cy="17" r="3.5"/><path d="M11 16h2"/>
  {/if}
</svg>

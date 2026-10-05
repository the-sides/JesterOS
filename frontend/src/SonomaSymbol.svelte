<script>let { name } = $props();</script>
<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  {#if name === 'sidebar'}<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5.5 8h1m-1 4h1m-1 4h1"/>
  {:else if name === 'new'}<path d="M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8M10 16l1-5L19 3l3 3-8 8-4 2Zm7-11 3 3"/>
  {:else if name === 'trash'}<path d="M4 6h16M9 6V3h6v3M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14M10 10v7m4-7v7"/>
  {:else if name === 'restore'}<path d="M3 8h18v12H3V8Zm0 0V5h7l2 3M12 17v-6m-3 3 3-3 3 3"/>
  {:else if name === 'search'}<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>
  {:else if name === 'pin'}<path d="M9 3h8l-1 6 4 4H6l4-4-1-6Zm4 10v8"/>
  {:else if name === 'folder'}<path d="M3 7V5h6l3 3h9v12H3V7Z"/>
  {:else if name === 'format'}<path d="m3 18 6-13 6 13M5 14h8m3-3c6-3 6 3 6 7m0-4c-9-3-7 7 0 3"/>
  {:else if name === 'checklist'}<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="m2 12 2 2 4-5m3-3h10m-10 6h10m-10 6h10"/>
  {:else if name === 'table'}<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 5v14m6-14v14"/>
  {:else if name === 'lock'}<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
  {:else if name === 'share'}<path d="M7 9H4v12h16V9h-3M12 15V2m-4 4 4-4 4 4"/>
  {:else if name === 'attachment'}<path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9"/>
  {:else if name === 'info'}<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>
  {:else if name === 'video'}<rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-4v12l-6-4"/>
  {:else if name === 'plus'}<path d="M12 4v16M4 12h16"/>
  {:else if name === 'audio'}<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>
  {:else if name === 'emoji'}<circle cx="12" cy="12" r="9"/><path d="M8 9h.1m7.9 0h.1M7 14c3 4 7 4 10 0"/>
  {/if}
</svg>

<script>
  let { name } = $props();
</script>

<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  {#if name === 'finder'}
    <path fill="#4cb3f7" d="M5 7h54v49H5z"/>
    <path fill="#dcefff" d="M35 7h24v49H29c-3-15-2-32 6-49"/>
    <path d="M19 21v5m27-5v5M15 35c8 10 26 11 35 0M35 8c-6 9-8 18-7 24h8v24" stroke="#20364b" stroke-width="2" stroke-linecap="round"/>
  {:else if name === 'launchpad'}
    <circle cx="32" cy="31" r="27" fill="#c4c9d0" stroke="#f6f7f8" stroke-width="2"/>
    <circle cx="32" cy="31" r="22" fill="#e4e6e9"/>
    <path d="M26 35C24 22 33 14 43 12c1 11-2 22-13 28z" fill="#737e8c"/>
    <path d="m25 26-8 5-1 11 10-5m9-3 1 10-10 5 1-10" fill="#8b96a3"/>
    <circle cx="35" cy="24" r="4" fill="#d9e8f0"/>
    <path d="m23 40-7 12 12-8" fill="#ed9d48"/>
  {:else if name === 'safari'}
    <circle cx="32" cy="31" r="28" fill="#e8eef1" stroke="#b2bdc5"/>
    <circle cx="32" cy="31" r="24" fill="#2eaceb"/>
    <circle cx="32" cy="31" r="20" stroke="#d9f5ff" stroke-width="3" stroke-dasharray="1 4"/>
    <path d="m44 15-8 21-16 11 8-21z" fill="#f5f7f7"/>
    <path d="m44 15-8 21-8-10z" fill="#f25b59"/>
    <path d="m20 47 16-11-8-10z" fill="#e4e7eb"/>
  {:else if name === 'mail'}
    <path fill="#4ea9e2" stroke="#d7eafa" stroke-width="2" d="M4 11h56v43H4z"/>
    <path fill="#eaf6ff" d="M9 17h46v32H9z"/>
    <path d="m9 17 23 18 23-18M9 49l18-17m28 17L37 32" stroke="#85a7c4" stroke-width="1.5"/>
    <path stroke="#effaff" stroke-dasharray="2 3" d="M3 7h58v51H3z"/>
  {:else if name === 'contacts'}
    <path fill="#b7895d" stroke="#725b43" d="M11 6h41v51H11z"/>
    <path stroke="#e7c8a0" d="M15 8v47m35-47v47"/>
    <path fill="#d4b185" d="M52 12h5v8h-5zm0 13h5v8h-5zm0 13h5v8h-5z"/>
    <circle cx="33" cy="26" r="8" fill="#e9d0ac"/>
    <path fill="#e9d0ac" d="M21 44c0-15 24-15 24 0z"/>
    <path stroke="#73553a" stroke-width="2" d="M8 14h7M8 25h7M8 36h7M8 47h7"/>
  {:else if name === 'calendar'}
    <path d="M8 7h48v49H8z" fill="#fafafa" stroke="#bababa"/>
    <path fill="#e95d57" d="M8 7h48v15H8z"/>
    <text x="32" y="18" fill="white" font-size="9" text-anchor="middle" font-family="Helvetica, sans-serif">SEPTEMBER</text>
    <text x="32" y="46" fill="#333" font-size="29" font-weight="300" text-anchor="middle" font-family="Helvetica, sans-serif">24</text>
    <path stroke="#e1e1e1" d="M10 52h44m-42 6h40"/>
  {:else if name === 'notes'}
    <path d="M10 5h44v53H10z" fill="#faf8ed" stroke="#c5c0b5"/>
    <path d="M10 5h44v14H10z" fill="#efcf54"/>
    <path stroke="#dad5c7" d="M14 27h36M14 34h36M14 41h36M14 48h36"/>
    <path stroke="#e9e1c8" stroke-dasharray="1 2" d="M10 20h44"/>
  {:else if name === 'messages'}
    <ellipse cx="29" cy="28" rx="27" ry="22" fill="#69d057"/>
    <path d="m10 40-4 13 17-9" fill="#69d057"/>
    <ellipse cx="40" cy="39" rx="22" ry="17" fill="#f3f4f5" stroke="#d5d6d8" stroke-width=".7"/>
    <path d="m53 49 4 10-14-5" fill="#f3f4f5"/>
    <g fill="#8d9197"><circle cx="29" cy="39" r="2.5"/><circle cx="40" cy="39" r="2.5"/><circle cx="51" cy="39" r="2.5"/></g>
  {:else if name === 'photos'}
    <circle cx="32" cy="31" r="27" fill="#fafafa" stroke="#ddd"/>
    {#each ['#ee6978', '#f49b52', '#f6cd50', '#abd15f', '#65c3ac', '#69b6e2', '#8884c3', '#c278b9'] as color, i}
      <ellipse cx="32" cy="19" rx="8" ry="13" fill={color} fill-opacity=".85" transform={`rotate(${i * 45} 32 31)`}/>
    {/each}
    <circle cx="32" cy="31" r="6" fill="#fff3bb" fill-opacity=".7"/>
  {:else if name === 'settings'}
    <rect x="6" y="7" width="52" height="49" rx="5" fill="#b6b9bd" stroke="#eceeef"/>
    <circle cx="32" cy="32" r="20" fill="#53585e" stroke="#d6d8db" stroke-width="4"/>
    <circle cx="32" cy="32" r="14" stroke="#b9bec5" stroke-width="7" stroke-dasharray="3 4"/>
    <circle cx="32" cy="32" r="7" fill="#707781" stroke="#d9dce0" stroke-width="2"/>
  {:else if name === 'folder'}
    <path d="M4 15h23l5 5h28v35H4z" fill="#61aed9" stroke="#458bb8"/>
    <path d="M4 24h56v31H4z" fill="#8bceee" stroke="#5ba9d2"/>
    <path d="M6 26h52" stroke="#c4eaff"/>
  {:else if name === 'drive'}
    <path d="M14 5h36l5 47H9z" fill="#d6d8d9" stroke="#7d8288"/>
    <path d="M9 48h46v10H9z" fill="#a8adb2" stroke="#70777e"/>
    <path d="M17 10h30l2 28H15z" fill="#bec3c8"/>
    <circle cx="32" cy="24" r="9" fill="#dce0e2" stroke="#a8adb2"/>
    <circle cx="32" cy="24" r="3" fill="#a8adb2"/>
    <path d="m33 24 12 8" stroke="#899198" stroke-width="3"/>
    <circle cx="48" cy="53" r="1.5" fill="#76d16b"/>
  {:else if name === 'pdf'}
    <path d="M15 3h25l12 12v45H15z" fill="#fff" stroke="#b3b8bf"/>
    <path d="M40 3v13h12" fill="#e0e5e9" stroke="#b3b8bf"/>
    <path d="M23 41c14-26 6-30 6-16 0 14 22 16 15 10-7-6-30 6-21 6z" stroke="#d55750" stroke-width="1.6"/>
    <path d="M12 46h33v11H12z" fill="#c84a44"/>
    <text x="28" y="54" fill="white" font-size="8" text-anchor="middle" font-family="Helvetica, sans-serif">PDF</text>
  {:else if name === 'trash'}
    <path d="m16 16 4 40h25l4-40" fill="#e0e5e9" fill-opacity=".7" stroke="#a1aab3"/>
    <ellipse cx="32.5" cy="16" rx="16.5" ry="5" fill="#e8ecef" stroke="#b4bdc5"/>
    <ellipse cx="32.5" cy="16" rx="12" ry="3" fill="#9ca6af"/>
    <path d="m24 23 2 28m6-28v28m9-28-2 28" stroke="#9faab4" stroke-width="2"/>
    <ellipse cx="32.5" cy="56" rx="12.5" ry="3" fill="#bdc6ce"/>
  {/if}
</svg>

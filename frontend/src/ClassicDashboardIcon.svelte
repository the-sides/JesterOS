<!-- Authored approximation of the classic Dashboard gauge, not Apple artwork. -->
<svg class="app-icon" viewBox="0 0 128 128" aria-hidden="true">
  <defs><radialGradient id="dashboard-bezel"><stop stop-color="#4b4d50"/><stop offset=".78" stop-color="#18191b"/><stop offset=".86" stop-color="#a9abad"/><stop offset=".94" stop-color="#333638"/><stop offset="1" stop-color="#090a0b"/></radialGradient></defs>
  <circle cx="64" cy="64" r="58" fill="url(#dashboard-bezel)" stroke="#888" stroke-width="2"/>
  <path d="M26 79a42 42 0 1 1 76 0" fill="none" stroke="#b9bdc0" stroke-width="3"/>
  {#each [-120,-90,-60,-30,0,30,60,90,120] as angle}
    <path d="M64 23v8" stroke="#e1e3e4" stroke-width="3" transform={`rotate(${angle} 64 64)`}/>
  {/each}
  <path d="m62 67 31-35-24 41Z" fill="#f04c3c"/>
  <circle cx="64" cy="68" r="7" fill="#d9dde0"/>
  <rect x="43" y="89" width="42" height="13" rx="2" fill="#bbc3a5"/><text x="64" y="99" text-anchor="middle" font-size="10" font-family="monospace" fill="#34392e">0248</text>
</svg>

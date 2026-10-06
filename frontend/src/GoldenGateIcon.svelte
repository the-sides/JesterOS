<script>
  let { name, assets } = $props();
  const colors = {
    messages: '#32ce58', facetime: '#34cf62', safari: '#198ee9', mail: '#248ee4', maps: '#66afaa',
    notes: '#f6c63e', reminders: '#fafafa', calendar: '#fff', contacts: '#b49b7c', settings: '#a5a9b0',
    music: '#f4526b', appstore: '#2489ed', books: '#ef9639', podcasts: '#a463dd', tv: '#28282b',
    weather: '#258ddd', clock: '#252528', terminal: '#29292c', calculator: '#e5a047', news: '#f25e6b',
    shortcuts: '#5350ae', freeform: '#fafafa', home: '#f3b73d', findmy: '#e8f2ec', passwords: '#e9e9ee',
    siri: '#6063af', preview: '#76a4cb', textedit: '#f0f0f4', stocks: '#23232a', photobooth: '#d55b55',
    'voice-memos': '#25252b', activitymonitor: '#283138', diskutility: '#b8bec4', systeminformation: '#a6a9b0',
  };
  const monograms = { automator: 'A', chess: 'C', dictionary: 'Aa', fontbook: 'F', screenshot: '⌗', stickies: 'N',
    airport: 'Wi', audiomidi: '♫', 'bluetooth-exchange': 'B', colorsync: 'C', console: '>_', digitalcolor: 'RGB',
    grapher: 'ƒ', imagecapture: 'IC', keychain: 'K', migration: '⇢', printcenter: 'P', quicktime: 'Q',
    screensharing: 'SS', scripteditor: '{ }', voiceover: 'VO', tips: 'i', apps: '•••', utilities: 'U',
    preview: 'P', textedit: 'Aa', siri: 'S', passwords: '•••', home: '⌂', news: 'N', books: 'B',
    freeform: '✎', contacts: 'AB', reminders: '✓', settings: '⚙', appstore: 'A', calculator: '+',
    diskutility: 'DU', systeminformation: 'i', activitymonitor: '↝' };
  const background = $derived(colors[name] ?? '#7f8fa7');
</script>

<svg class="golden-gate-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  {#if name === 'folder' || name === 'downloads' || name === 'applications' || name === 'utilities'}
    <path d="M5 13q0-3 3-3h17l6 6h25q3 0 3 4v32q0 3-4 3H8q-3 0-3-3Z" fill="#69baf0" stroke="#288fcb" stroke-width=".7"/>
    <path d="M6 22h52v30q0 3-4 3H9q-3 0-3-3Z" fill="#87cff6"/>
    <path d="M8 23h48" stroke="#d8f1ff" stroke-width="1.3"/>
    {#if name === 'downloads'}<path d="M32 29v17m-7-6 7 7 7-7M22 49h20" fill="none" stroke="#2685b8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>{/if}
    {#if name === 'applications'}<path d="m25 43 7-15 7 15m-17-4h20" fill="none" stroke="#278bbd" stroke-width="3" stroke-linecap="round"/>{/if}
    {#if name === 'utilities'}<path d="m23 32 18 17m-4-20-16 19" stroke="#278bbd" stroke-width="4" stroke-linecap="round"/>{/if}
  {:else if name === 'drive'}
    <path d="M13 6h38l4 49q0 4-4 4H13q-4 0-4-4Z" fill="#bbc0c6" stroke="#767c85"/>
    <path d="M14 8h36l3 43H11Z" fill="#e1e4e7"/><path d="M13 53h37" stroke="#949ba4"/><circle cx="47" cy="55" r="1.4" fill="#43d185"/>
  {:else if name === 'pdf' || name === 'document' || name === 'file'}
    <path d="M14 4h25l12 12v44H14Z" fill="#fafafc" stroke="#b0bac5"/><path d="M39 4v12h12" fill="#d9dee4" stroke="#b0bac5"/>
    <path d="M21 26h23M21 32h23M21 38h18" stroke="#c7ccd3" stroke-width="2"/>
    {#if name === 'pdf'}<rect x="12" y="43" width="41" height="14" rx="3" fill="#e84e50"/><text x="32" y="53" text-anchor="middle" fill="white" font-size="10" font-weight="700">PDF</text>{/if}
  {:else if name === 'trash' || name === 'trash-full'}
    <path d="m17 17 4 40h22l4-40M15 15h34M25 10h14" fill="#e9eef2" stroke="#8594a4" stroke-width="2" stroke-linecap="round"/>
    <path d="m26 23 1 27m10-27-1 27M32 23v27" stroke="#a1aeba" stroke-width="2"/>
  {:else}
    <rect x="4" y="4" width="56" height="56" rx="14" fill={background}/>
    <rect x="4.7" y="4.7" width="54.6" height="54.6" rx="13.3" fill="none" stroke="#ffffff70"/>
    <path d="M17 5h30q12 0 12 12v7q-23-12-54 0v-7Q5 5 17 5" fill="#ffffff20"/>
    {#if name === 'finder'}
      <path d="M5 17Q5 5 17 5h16v54H17Q5 59 5 47Z" fill="#43b8f4"/><path d="M33 5h14q12 0 12 12v30q0 12-12 12H32V39h-7l7-20Z" fill="#ecf6fe"/>
      <path d="M19 24v5m27-5v5M18 40q14 10 29 0" fill="none" stroke="#175685" stroke-width="2.6" stroke-linecap="round"/>
    {:else if name === 'messages'}
      <path d="M49 29c0 10-9 17-21 17h-5l-10 5 3-11q-5-4-5-11c0-10 8-17 19-17s19 7 19 17Z" fill="white"/><path d="M15 19q15-11 29 0" stroke="#e5ffe8" fill="none" stroke-width="1.4"/>
    {:else if name === 'safari'}
      <circle cx="32" cy="32" r="23" fill="#e6f5ff"/><circle cx="32" cy="32" r="20" fill="#31a6e7"/>
      <path d="M32 13v3m0 32v3M13 32h3m32 0h3m-6-13-2 2M21 43l-2 2M19 19l2 2m22 22 2 2" stroke="white" stroke-width="1.5"/>
      <path d="m42 20-7 16-16 8 8-17Z" fill="#f5faff"/><path d="m42 20-7 16-8-9Z" fill="#f24f52"/>
    {:else if name === 'mail'}
      <rect x="10" y="17" width="44" height="31" rx="4" fill="#fff"/><path d="m12 19 20 16 20-16M12 46l14-14m26 14L38 32" fill="none" stroke="#6cb5e9" stroke-width="1.4"/>
    {:else if name === 'notes'}
      <rect x="10" y="9" width="44" height="46" rx="5" fill="#fffdf1"/><path d="M10 21h44V13q0-4-4-4H14q-4 0-4 4Z" fill="#ffdc5b"/><path d="M16 29h33M16 36h33M16 43h25" stroke="#dad7ca"/>
    {:else if name === 'calendar'}
      <path d="M4 18v-1Q4 4 17 4h30q13 0 13 13v1Z" fill="#ee5a56"/><text x="32" y="15" fill="white" text-anchor="middle" font-size="9" font-weight="600">MON</text><text x="32" y="49" fill="#25262a" text-anchor="middle" font-size="34" font-weight="300">28</text>
    {:else if name === 'photos'}
      {#each ['#ee6370','#f39543','#edcb35','#86ba54','#54c4c2','#5599d8','#9274c5','#ca78b5'] as color, i}<ellipse cx="32" cy="22" rx="7" ry="13" fill={color} opacity=".86" transform={`rotate(${i * 45} 32 32)`}/>{/each}<circle cx="32" cy="32" r="5" fill="#fff7"/>
    {:else if name === 'facetime'}
      <rect x="12" y="22" width="28" height="23" rx="5" fill="white"/><path d="m42 28 11-6v23l-11-6Z" fill="white"/>
    {:else if name === 'maps'}
      <path d="m5 15 18-8 18 7 18-5v43l-18 6-18-7-18 6Z" fill="#eff2dc"/><path d="m23 7 0 44m18-37v44" stroke="#afce86" stroke-width="7"/><path d="m5 35 19-5 15 8 20-12" fill="none" stroke="white" stroke-width="9"/><path d="m5 35 19-5 15 8 20-12" fill="none" stroke="#f0b859" stroke-width="3"/><circle cx="41" cy="23" r="10" fill="#49a6e6" stroke="white" stroke-width="2"/><path d="m41 16 5 12-5-2-5 2Z" fill="white"/>
    {:else if name === 'music'}
      <path d="M29 19v24c-1 8-15 10-15 2 0-5 8-7 12-6V18l23-5v26c0 8-14 10-14 2 0-5 7-6 11-5V20Z" fill="white"/>
    {:else if name === 'clock'}
      <circle cx="32" cy="32" r="23" fill="white"/><path d="M32 13v3m0 32v3M13 32h3m32 0h3M32 19v13l-10 9" stroke="#29292d" stroke-width="2" stroke-linecap="round"/><path d="M32 32h15" stroke="#f25952" stroke-width="1.3"/><circle cx="32" cy="32" r="2" fill="#f25952"/>
    {:else if name === 'terminal'}
      <path d="m15 19 10 8-10 8m16 5h15" fill="none" stroke="#e8f8ea" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    {:else if name === 'weather'}
      <circle cx="24" cy="25" r="11" fill="#ffd360"/><path d="M22 45h28c10-2 7-16-1-16-1-13-20-13-22-1-14-3-19 17-5 17Z" fill="#f6fbff"/>
    {:else if name === 'tv'}<text x="32" y="43" text-anchor="middle" fill="white" font-size="28" font-weight="600">tv</text>
    {:else if name === 'findmy'}<circle cx="32" cy="32" r="21" fill="#64ca88"/><circle cx="32" cy="32" r="13" fill="#a8dfb8"/><circle cx="32" cy="32" r="5" fill="#f5fbf7"/><path d="m32 32 15-15" stroke="#e9fff0" stroke-width="2"/>
    {:else if name === 'podcasts'}<circle cx="32" cy="28" r="6" fill="white"/><path d="M26 39q0-7 6-7t6 7l-2 14h-8Z" fill="white"/><path d="M21 41a18 18 0 1 1 22 0M23 32a11 11 0 1 1 18 0" fill="none" stroke="white" stroke-width="2.6" stroke-linecap="round"/>
    {:else if name === 'stocks'}<path d="M12 44h40M12 30h40M12 16h40" stroke="#a1abb733"/><path d="m12 41 9-7 7 6 8-18 7 8 9-13" fill="none" stroke="#55b9f6" stroke-width="2.5"/>
    {:else if name === 'voice-memos'}<path d="M12 28v8m6-14v20m6-25v30m8-34v38m8-29v20m6-16v12m6-10v8" stroke="#f66a6b" stroke-width="3" stroke-linecap="round"/>
    {:else}<text x="32" y="42" text-anchor="middle" fill={['settings','freeform','reminders','passwords'].includes(name) ? '#4d535e' : '#fff'} font-family="sans-serif" font-size={(monograms[name] ?? name?.slice(0, 2) ?? '').length > 2 ? '17' : '27'} font-weight="600">{monograms[name] ?? name?.slice(0, 2).toUpperCase()}</text>{/if}
  {/if}
</svg>

<style>
  .golden-gate-icon { display: block; width: 100%; height: 100%; overflow: visible; flex-shrink: 0; }
</style>

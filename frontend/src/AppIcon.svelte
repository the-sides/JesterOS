<script module>
  const vectorIcons = new Set(['folder', 'drive', 'pdf', 'trash']);
</script>

<script>
  let { name } = $props();
</script>

{#if name === 'calendar'}
  <span class="app-icon calendar-icon" aria-hidden="true">
    <img src="/icons/calendar.png" alt="" draggable="false" />
    <svg viewBox="0 0 128 128">
      <defs>
        <linearGradient id="calendar-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fafbfb" />
          <stop offset="1" stop-color="#e8eded" />
        </linearGradient>
        <linearGradient id="calendar-header" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f15c56" />
          <stop offset="1" stop-color="#ed625c" />
        </linearGradient>
      </defs>
      <path d="M13 20 96 7 101 34 18 49Z" fill="url(#calendar-header)" />
      <path d="m18 49 83-15 8 63-83 15Z" fill="url(#calendar-paper)" />
      <g transform="rotate(-9 64 64)" text-anchor="middle" font-family="var(--system-font)">
        <text x="60" y="31" font-size="18" font-weight="400" fill="#fff">SEP</text>
        <text x="63" y="97" font-size="53" font-weight="300" fill="#333a3d">24</text>
      </g>
    </svg>
  </span>
{:else}
  <img class="app-icon" src={`/icons/${name}.${vectorIcons.has(name) ? 'svg' : 'png'}`} alt="" aria-hidden="true" draggable="false" />
{/if}

<style>
  .calendar-icon { position: relative; display: block; }
  .calendar-icon img, .calendar-icon svg { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>

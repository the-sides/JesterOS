<script module>
  const vectorIcons = new Set(['folder', 'drive', 'pdf', 'trash']);
</script>

<script>
  let { name } = $props();
</script>

<img class="app-icon" src={`/icons/${name}.${vectorIcons.has(name) ? 'svg' : 'png'}`} alt="" aria-hidden="true" draggable="false" />

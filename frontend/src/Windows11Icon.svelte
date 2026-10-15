<script>
  let { name, size = 32, label = '' } = $props();
  // Teams is a locally authored vector, like the other offline Windows icons.
  const source = $derived(name === 'teams' ? '/windows11/icons/teams.svg' : `/windows11/icons/${name}.svg`);
</script>
<img class="win11-icon" src={source} width={size} height={size} alt={label} draggable="false"/>

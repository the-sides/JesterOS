<script>
  let { name, size = 32, label = '' } = $props();
</script>
<img class="win11-icon" src="/windows11/icons/{name}.svg" width={size} height={size} alt={label} draggable="false"/>

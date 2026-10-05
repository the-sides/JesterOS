<script>
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  let { profile, full } = $props();
  const Icon = $derived(profile.renderer === 'sonoma' ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);
</script>

<span class="trash-artwork" class:full aria-hidden="true">
  {#if full}
    <svg class="trash-paper" viewBox="0 0 128 128">
      <path d="m40 12 27-7 16 18-4 63-35 6-12-39Z" fill="#eef1f3" stroke="#a1aeb7" stroke-width="1.5"/>
      <path d="m67 5-3 19 19-1Z" fill="#b8c4cd"/>
      <path d="m74 15 17-6 13 24-7 46-29 5-12-34Z" fill="#fff" stroke="#a1aeb7" stroke-width="1.5"/>
      <path d="m91 9-5 25 18-1Z" fill="#cbd3d9"/>
      <path d="m29 25 21-9 16 22-5 47-27 3-10-37Z" fill="#f7f8fa" stroke="#a1aeb7" stroke-width="1.5"/>
      <path d="m50 16-5 21 21 1Z" fill="#ccd5dd"/>
    </svg>
  {/if}
  <Icon name="trash" assets={profile.assets}/>
</span>

<style>
  .trash-artwork { position: relative; display: block; width: 100%; height: 100%; }
  .trash-paper { position: absolute; inset: 0; width: 100%; height: 100%; }
  .trash-artwork :global(.app-icon), .trash-artwork :global(.sonoma-icon) { position: relative; width: 100%; height: 100%; }
</style>

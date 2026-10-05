<script>
  let { requestedId, profiles } = $props();
</script>

<main class="profile-unavailable" aria-label="Unsupported OS profile">
  <div>
    <p class="product">JesterOS scene setup</p>
    <h1>Unsupported OS profile</h1>
    <p><code>{requestedId || '(empty profile ID)'}</code> is not installed. No substitute desktop has been loaded.</p>
    <h2>Installed profiles</h2>
    <ul>
      {#each profiles as profile (profile.id)}
        <li>{profile.name} {profile.version} — <code>{profile.id}</code></li>
      {/each}
    </ul>
    <p>Set the profile ID in the scene URL before starting the take.</p>
  </div>
</main>

<style>
  .profile-unavailable { min-height: 100vh; display: grid; place-items: center; padding: 32px; box-sizing: border-box; background: #f6f5f1; color: #252626; font-family: system-ui, sans-serif; }
  .profile-unavailable > div { max-width: 620px; width: 100%; }
  .product { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; }
  h1 { font-size: 28px; font-weight: 600; margin: 16px 0; }
  h2 { font-size: 15px; margin: 32px 0 12px; }
  p, li { font-size: 15px; line-height: 1.6; }
  code { overflow-wrap: anywhere; font-size: 13px; }
  ul { padding-left: 20px; }
</style>

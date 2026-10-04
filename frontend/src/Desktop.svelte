<script>
  import AppIcon from './AppIcon.svelte';

  let { children } = $props();

  const dockApps = [
    { name: 'Finder', icon: 'finder', active: true },
    { name: 'Launchpad', icon: 'launchpad' },
    { name: 'Safari', icon: 'safari' },
    { name: 'Mail', icon: 'mail' },
    { name: 'Contacts', icon: 'contacts' },
    { name: 'Calendar', icon: 'calendar' },
    { name: 'Notes', icon: 'notes' },
    { name: 'Messages', icon: 'messages', active: true },
    { name: 'System Preferences', icon: 'settings' },
  ];
</script>

<div class="desktop">
  <header class="menu-bar" aria-label="Desktop menu bar, inactive">
    <div class="menu-headings">
      <span class="apple-mark" aria-label="Apple menu"><svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z" transform="translate(0 -1) scale(.9)"/></svg></span>
      <span class="app-menu">Messages</span>
      <span>File</span><span>Edit</span><span>View</span><span class="optional-menu">Buddies</span><span class="optional-menu">Window</span><span class="optional-menu">Help</span>
    </div>
    <div class="status-items">
      <span class="wifi" aria-label="Wi-Fi connected"><svg viewBox="0 0 24 18" aria-hidden="true"><path fill="currentColor" d="M0 4.5a20 20 0 0 1 24 0l-2.2 2.7a16.5 16.5 0 0 0-19.6 0Zm4.2 5.1a13 13 0 0 1 15.6 0l-2.3 2.7a9.4 9.4 0 0 0-11 0Zm4.5 5.2a5.7 5.7 0 0 1 6.6 0L12 18Z"/></svg></span>
      <span class="battery-status" aria-label="Battery: 87 percent"><span>87%</span><svg viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2.5" width="23" height="9" rx="1.6" fill="none" stroke="currentColor"/><path fill="currentColor" d="M3 4.5h17v5H3zm22 0h2v5h-2z"/></svg></span>
      <time datetime="2018-09-24T17:42:00">Mon 5:42 PM</time>
      <span class="spotlight" aria-label="Spotlight"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.6"/></svg></span>
      <span class="notification-center" aria-label="Notification Center"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h3m2 0h11M2 10h3m2 0h8M2 15h3m2 0h11" stroke="currentColor" stroke-width="1.7"/></svg></span>
    </div>
  </header>

  <main class="desktop-workspace" aria-label="macOS Mojave-style desktop">
    <section class="desktop-files" aria-label="Desktop files">
      <div class="desktop-file"><AppIcon name="drive"/><span>Macintosh HD</span></div>
      <div class="desktop-file"><AppIcon name="folder"/><span>Personal</span></div>
      <div class="desktop-file"><AppIcon name="pdf"/><span>Itinerary.pdf</span></div>
    </section>
    <div class="window-position">{@render children()}</div>
  </main>

  <footer class="dock" aria-label="Application dock, inactive">
    <ul class="dock-apps">
      {#each dockApps as app}
        <li class="dock-item" aria-label={`${app.name}${app.active ? ', running' : ''}`}><AppIcon name={app.icon}/>{#if app.active}<span class="active-dot"></span>{/if}</li>
      {/each}
    </ul>
    <div class="dock-separator" aria-hidden="true"></div>
    <div class="dock-item" aria-label="Photos, recent application"><AppIcon name="photos"/></div>
    <div class="dock-separator" aria-hidden="true"></div>
    <div class="dock-item" aria-label="Downloads"><AppIcon name="downloads"/></div>
    <div class="dock-item" aria-label="Trash"><AppIcon name="trash"/></div>
  </footer>
</div>

<script>
  import AppIcon from './AppIcon.svelte';
  import { conversations, messages, dockApps } from './desktop.js';
</script>

<div class="desktop">
  <header class="menu-bar" aria-label="Desktop menu bar">
    <div class="menu-headings">
      <span class="apple-mark" aria-label="Apple menu">
        <svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z" transform="translate(0 -1) scale(.9)"/></svg>
      </span>
      <span class="app-menu">Messages</span>
      <span>File</span><span>Edit</span><span>View</span><span class="optional-menu">Buddies</span><span>Window</span><span class="optional-menu">Help</span>
    </div>
    <div class="status-items">
      <span class="wifi" aria-label="Wi-Fi connected"><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M1 5Q12-3 23 5M5 9q7-5 14 0M9 13q3-2 6 0" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="16" r="1.3" fill="currentColor"/></svg></span>
      <span class="battery-status" aria-label="Battery: 87 percent"><span>87%</span><svg viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2" width="23" height="10" rx="2" fill="none" stroke="currentColor"/><path fill="currentColor" d="M3 4h17v6H3zm22 1h2v4h-2z"/></svg></span>
      <time datetime="2018-09-24T17:42:00">Mon 5:42 PM</time>
      <span class="spotlight" aria-label="Spotlight"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.6"/></svg></span>
      <span class="notification-center" aria-label="Notification Center"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h2m2 0h11M3 10h2m2 0h11M3 15h2m2 0h11" stroke="currentColor" stroke-width="1.6"/></svg></span>
    </div>
  </header>

  <main aria-label="macOS Mojave-style desktop">
    <section class="desktop-files" aria-label="Desktop files">
      <div class="desktop-file"><AppIcon name="drive"/><span>Macintosh HD</span></div>
      <div class="desktop-file"><AppIcon name="folder"/><span>Personal</span></div>
      <div class="desktop-file"><AppIcon name="pdf"/><span>Itinerary.pdf</span></div>
    </section>

    <section class="messages-window" aria-labelledby="messages-title">
      <header class="window-toolbar">
        <div class="sidebar-toolbar">
          <div class="traffic-lights" aria-label="Window controls, inactive"><span class="close"></span><span class="minimize"></span><span class="maximize"></span></div>
          <span class="compose-icon" aria-label="New message, inactive"><svg viewBox="0 0 22 22" aria-hidden="true"><path d="M12 5H4v14h14v-8M9 14l1-4L18 2l3 3-8 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
        </div>
        <div class="conversation-toolbar"><h1 id="messages-title">Messages</h1><span class="details-label">Details</span></div>
      </header>
      <div class="window-content">
        <aside class="conversation-sidebar" aria-label="Conversations">
          <div class="search-wrap"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m12 12 4 4" stroke="currentColor" stroke-width="1.5"/></svg><input aria-label="Search conversations, inactive" placeholder="Search" disabled /></div>
          <ul class="conversation-list">
            {#each conversations as conversation}
              <li class:selected={conversation.selected} aria-label={`Conversation with ${conversation.name}`} aria-current={conversation.selected ? 'true' : undefined}>
                <span class="avatar" style:background={conversation.color}>{conversation.initials}</span>
                <div class="conversation-preview"><div class="conversation-name"><strong>{conversation.name}</strong><span>{conversation.time}</span></div><p>{conversation.preview}</p></div>
              </li>
            {/each}
          </ul>
        </aside>
        <section class="conversation" aria-label="Conversation with Alex Morgan">
          <div class="recipient"><span>To:</span> Alex Morgan</div>
          <div class="message-history">
            <div class="conversation-date"><strong>Today</strong> 5:38 PM</div>
            <ol class="message-list">
              {#each messages as message}
                <li class:outgoing={message.outgoing}><span class="sr-only">{message.outgoing ? 'You' : 'Alex Morgan'}: </span><p class="bubble">{message.text}</p></li>
              {/each}
            </ol>
            <p class="delivered">Delivered</p>
          </div>
          <div class="composer"><input aria-label="Message composer, read-only" placeholder="iMessage" readonly /><span class="emoji-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/><path d="M6 12q4 5 8 0" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span></div>
        </section>
      </div>
    </section>
  </main>

  <footer class="dock" aria-label="Application dock, inactive">
    <ul class="dock-apps">
      {#each dockApps as app}
        <li class="dock-item" aria-label={`${app.name}${app.active ? ', running' : ''}`}><AppIcon name={app.icon}/>{#if app.active}<span class="active-dot"></span>{/if}</li>
      {/each}
    </ul>
    <div class="dock-separator"></div>
    <div class="dock-item dock-folder" aria-label="Downloads"><AppIcon name="folder"/></div>
    <div class="dock-item" aria-label="Trash"><AppIcon name="trash"/></div>
  </footer>
</div>

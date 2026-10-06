<script>
  import WindowControls from './WindowControls.svelte';
  import './golden-gate-documents.css';

  let { onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu,
    fullScreen = false, revealedTop = true, modernGreenMenu = true, active = true, zoomed = false } = $props();
  // Authored fictional scene. No imported contact photos, messages, or account data.
  const pinned = [
    { name: 'Casey', initials: 'CR', tint: '#d39a72' },
    { name: 'Studio', initials: 'ST', tint: '#7d99ac' },
    { name: 'Trail Crew', initials: 'TC', tint: '#789d82', selected: true },
  ];
  const conversations = [
    { name: 'Jordan Lee', initials: 'JL', tint: '#a49ab7', time: '9:32 AM', preview: 'The sketches look great. See you later!' },
    { name: 'Morgan Park', initials: 'MP', tint: '#b08f77', time: '9:18 AM', preview: 'I left the book by your desk.' },
    { name: 'Weekend Plans', initials: 'WP', tint: '#8ca3b9', time: 'Yesterday', preview: 'Let’s meet at the café on Saturday.' },
    { name: 'Sam Rivera', initials: 'SR', tint: '#9baa81', time: 'Yesterday', preview: 'Thanks for the recommendation!' },
  ];
  const symbols = {
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6',
    filter: 'M4 6h16M7 12h10M10 18h4',
    new: 'M13 4H4v16h16v-9M9 15l1-5 8-8 4 4-8 8zM16 4l4 4',
    video: 'M3 6h12v12H3zM15 10l6-4v12l-6-4',
    plus: 'M12 4v16M4 12h16',
    audio: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4',
    emoji: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9h.1M16 9h.1M7 14q5 7 10 0',
    chevron: 'm9 5 7 7-7 7',
  };
</script>

{#snippet symbol(name)}
  <svg class="golden-gate-document-symbol" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d={symbols[name]} /></svg>
{/snippet}
{#snippet avatar(initials, tint, extraClass = '')}
  <span class="golden-gate-messages-avatar {extraClass}" style:--avatar-tint={tint} aria-hidden="true">{initials}</span>
{/snippet}

<section class="golden-gate-messages" class:inactive={!active} aria-label="Messages — fixed fictional sample">
  <aside class="golden-gate-messages-sidebar" aria-label="Sample conversations">
    <header class="golden-gate-messages-sidebar-toolbar" data-window-drag>
      <WindowControls {onclose} {onminimize} {onzoom} {active} {zoomed} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {fullScreen} {revealedTop} {modernGreenMenu} />
      <div class="golden-gate-messages-sidebar-actions" data-window-no-drag>
        <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" aria-label="Filter conversations — sample only" disabled>{@render symbol('filter')}</button>
        <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" aria-label="New message — sample only" disabled>{@render symbol('new')}</button>
      </div>
    </header>
    <label class="golden-gate-document-search golden-gate-messages-search">{@render symbol('search')}<input type="search" aria-label="Search conversations — sample only" placeholder="Search" disabled /></label>
    <div class="golden-gate-messages-conversation-scroll">
      <ul class="golden-gate-messages-pinned" aria-label="Pinned sample conversations">
        {#each pinned as conversation}
          <li class:selected={conversation.selected} aria-current={conversation.selected ? 'true' : undefined}>
            <button type="button" aria-label={`${conversation.name} — sample only`} disabled>{@render avatar(conversation.initials, conversation.tint)}<span>{conversation.name}</span></button>
          </li>
        {/each}
      </ul>
      <ul class="golden-gate-messages-conversations">
        {#each conversations as conversation}
          <li>
            <button type="button" aria-label={`${conversation.name} — sample only`} disabled>
              {@render avatar(conversation.initials, conversation.tint)}
              <span class="golden-gate-messages-conversation-copy"><span class="golden-gate-messages-conversation-heading"><strong>{conversation.name}</strong><time>{conversation.time}</time></span><span class="golden-gate-messages-conversation-preview">{conversation.preview}</span></span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </aside>
  <div class="golden-gate-messages-thread">
    <header class="golden-gate-messages-recipient-toolbar" data-window-drag>
      <button type="button" class="golden-gate-messages-recipient golden-gate-document-capsule" data-window-no-drag aria-label="Trail Crew conversation details — sample only" disabled>{@render avatar('TC', '#789d82')}<span>Trail Crew</span>{@render symbol('chevron')}</button>
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule golden-gate-messages-call" data-window-no-drag aria-label="Video call — sample only" disabled>{@render symbol('video')}</button>
    </header>
    <ol class="golden-gate-messages-history" aria-label="Fictional conversation with Trail Crew">
      <li class="golden-gate-messages-timestamp"><time datetime="2026-09-28T09:41:00Z">Today 9:41 AM</time></li>
      <li class="golden-gate-messages-bubble outgoing"><p>Morning! Where are we meeting?</p></li>
      <li class="golden-gate-messages-bubble incoming"><span class="golden-gate-messages-sender">Casey Rivera</span><p>At the trailhead by the coast. I made a little sketch of the route.</p></li>
      <li class="golden-gate-messages-artwork">
        <span class="golden-gate-messages-sender">Casey Rivera</span>
        <svg viewBox="0 0 340 190" role="img" aria-label="Original illustration of a coastal trail, hills, and a small orange tent">
          <rect width="340" height="190" rx="18" fill="#d5e8eb" />
          <circle cx="260" cy="42" r="21" fill="#f4d794" />
          <path d="M0 106Q55 65 115 103T230 104Q284 91 340 120V190H0Z" fill="#76947b" />
          <path d="M0 145Q58 110 116 133T227 138L340 110V190H0Z" fill="#497e88" />
          <path d="M0 170q82-78 162-54 45 15 78-22 26-24 100-10v106H0Z" fill="#afbc8a" />
          <path d="M44 190q20-36 84-49t94-40q16-22 73-19" fill="none" stroke="#eddfb4" stroke-width="13" stroke-linecap="round" />
          <path d="m218 130 27-39 33 39z" fill="#d88851" /><path d="m245 91 8 39h-35z" fill="#f4b570" /><path d="m239 111-12 19h24z" fill="#6e5750" />
          <path d="m62 118 13-28 13 28zm6-16 7-17 8 17zM298 91l10-24 12 24z" fill="#386553" /><path d="M75 111v13m233-40v14" stroke="#675d49" stroke-width="4" />
          <path d="m22 154 20-7m-17 16 28-9m234 10 25-5m-16 13 21-5" stroke="#edf5ee" stroke-width="2" stroke-linecap="round" opacity=".65" />
        </svg>
      </li>
      <li class="golden-gate-messages-bubble incoming"><span class="golden-gate-messages-sender">Jordan Lee</span><p>I’ll bring the picnic. See you at ten!</p></li>
      <li class="golden-gate-messages-bubble outgoing golden-gate-messages-last"><p>Perfect. See you both there!</p><span class="golden-gate-messages-delivered">Delivered · sample</span></li>
    </ol>
    <div class="golden-gate-messages-composer" aria-label="Message composer — sending unavailable">
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" aria-label="Add photos, stickers, polls, and attachments — sample only" disabled>{@render symbol('plus')}</button>
      <div class="golden-gate-messages-input"><input aria-label="Message — fixed sample only" placeholder="iMessage" disabled /><button type="button" class="golden-gate-document-tool" aria-label="Record audio message — sample only" disabled>{@render symbol('audio')}</button></div>
      <button type="button" class="golden-gate-document-tool golden-gate-document-capsule" aria-label="Emoji and stickers — sample only" disabled>{@render symbol('emoji')}</button>
    </div>
    <p class="golden-gate-messages-sample-notice">Fictional sample · Sending, search, and media actions unavailable</p>
  </div>
</section>

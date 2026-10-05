<script>
  import { conversations } from './messages-scene.js';
  import WindowControls from './WindowControls.svelte';
  import SonomaSymbol from './SonomaSymbol.svelte';
  import './sonoma.css';
  let { assets, onclose, onminimize, onzoom, active = true, zoomed = false } = $props();
</script>
<section class="sonoma-messages" class:inactive={!active} aria-label="Messages fixed sample">
  <aside class="sonoma-messages-sidebar" aria-label="Conversations">
    <header class="sonoma-messages-sidebar-toolbar" data-window-drag>
      <WindowControls {onclose} {onminimize} {onzoom} {active} {zoomed} />
      <button type="button" class="sonoma-tool" aria-label="New message — sample only" disabled><SonomaSymbol name="new" /></button>
    </header>
    <label class="sonoma-messages-search"><SonomaSymbol name="search" /><input aria-label="Search conversations — sample only" placeholder="Search" disabled /></label>
    <ul class="sonoma-conversations">
      {#each conversations as conversation}
        <li class:selected={conversation.selected} aria-current={conversation.selected ? 'true' : undefined}>
          <img class="sonoma-conversation-portrait" src={`${assets.messages}/${conversation.portrait}`} alt="" width="44" height="44" />
          <div class="sonoma-conversation-copy"><div class="sonoma-conversation-heading"><span>{conversation.name}</span><time>{conversation.time}</time></div><p>{#each conversation.preview as line, index}<span>{#if conversation.emoji?.line === index && conversation.emoji.before}<img src={`${assets.messages}/${conversation.emoji.image}`} alt={conversation.emoji.label} />{/if}{line}{#if conversation.emoji?.line === index && !conversation.emoji.before}<img src={`${assets.messages}/${conversation.emoji.image}`} alt={conversation.emoji.label} />{/if}</span>{/each}</p></div>
        </li>
      {/each}
    </ul>
  </aside>
  <div class="sonoma-messages-thread">
    <header class="sonoma-messages-recipient-toolbar" data-window-drag>
      <span class="sonoma-recipient"><span>To:</span> Shelley Willems</span>
      <button type="button" class="sonoma-tool" aria-label="FaceTime — sample only" disabled><SonomaSymbol name="video" /></button>
      <button type="button" class="sonoma-tool" aria-label="Conversation information — sample only" disabled><SonomaSymbol name="info" /></button>
    </header>
    <ol class="sonoma-message-history" aria-label="Conversation with Shelley Willems">
      <li class="sonoma-message-photo"><img src={`${assets.messages}/silhouette-photo.png`} alt="A woman silhouetted against a sunset" width="387" height="156" /></li>
      <li class="sonoma-message-bubble outgoing"><p>I love it! You’re a great<br />photographer.</p></li>
      <li class="sonoma-message-bubble incoming"><p>Thanks! I’ll be posting the rest<br />soon.</p></li>
      <li class="sonoma-message-bubble incoming"><p>Hey, we are planning a camping<br />trip next month. You should<br />come!</p></li>
      <li class="sonoma-message-emoji"><img src={`${assets.messages}/grinning-face.png`} alt="Grinning face" width="65" height="68" /><img src={`${assets.messages}/camping.png`} alt="Camping" width="70" height="65" /><img src={`${assets.messages}/national-park.png`} alt="National park" width="67" height="70" /></li>
      <li class="sonoma-message-bubble outgoing sonoma-last-message"><p>I’m there!</p><span class="sonoma-delivered">Delivered</span></li>
    </ol>
    <div class="sonoma-messages-composer" aria-label="Message composer — fixed sample">
      <button type="button" class="sonoma-imessage-apps" aria-label="iMessage apps — sample only" disabled><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="12" rx="10" ry="8"/><path d="m7 17 6-10m-2 0 6 10M5 14h14"/></svg></button>
      <div class="sonoma-messages-input"><input aria-label="Message — sample only" placeholder="iMessage" disabled /><button type="button" class="sonoma-tool" aria-label="Audio message — sample only" disabled><SonomaSymbol name="audio" /></button></div>
      <button type="button" class="sonoma-tool" aria-label="Emoji and stickers — sample only" disabled><SonomaSymbol name="emoji" /></button>
    </div>
  </div>
</section>

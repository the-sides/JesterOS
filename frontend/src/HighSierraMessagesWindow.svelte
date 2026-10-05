<script>
  import { conversations } from './high-sierra-messages-scene.js';
  import WindowControls from './WindowControls.svelte';
  import './messages.css';

  let { assets, onclose, onminimize, onzoom, active = true, zoomed = false } = $props();
</script>

{#snippet bubbleTail(direction, color)}
  <svg
    class="bubble-tail {direction}"
    viewBox="0 0 22 22"
    aria-hidden="true"
    style:color
  >
    <path d="M16 0H22V17C16 20 9 22 0 22C9 18 12 11 12 0Z" fill="currentColor" />
  </svg>
{/snippet}

<section class="messages-window" class:inactive={!active} aria-label="Messages">
  <header class="messages-toolbar" data-window-drag>
    <div class="messages-toolbar-sidebar">
      <WindowControls class="messages-traffic-lights" {onclose} {onminimize} {onzoom} {active} {zoomed} />

      <div class="messages-search">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.3" cy="8.3" r="6.7" />
          <path d="m13.1 13.1 5.2 5.2" />
        </svg>
        <input aria-label="Search conversations" placeholder="Search" disabled />
      </div>

      <button class="messages-compose-button" aria-label="New message" disabled>
        <svg viewBox="0 0 28 26" aria-hidden="true">
          <path class="compose-outline" d="M20.2 13.4v9.1H3V5.3h10.5" />
          <path class="compose-pencil" d="m10.2 17.6 1-5.1L22.7 1l4 4-11.4 11.5Z" />
          <path class="compose-pencil-end" d="m20.3 3.4 4 4" />
        </svg>
      </button>
    </div>

    <div class="messages-recipient-toolbar">
      <div class="messages-recipient"><span>To:</span> Euna Kwon</div>
      <button class="messages-details" disabled>Details</button>
    </div>
  </header>

  <aside class="messages-sidebar" aria-label="Conversations">
    <ul class="messages-conversations">
      {#each conversations as conversation}
        <li class:selected={conversation.selected} aria-current={conversation.selected ? 'true' : undefined}>
          <img class="conversation-portrait" src={`${assets.messages}/${conversation.portrait}`} alt="" width="67" height="67" />
          <div class="conversation-copy">
            <div class="conversation-heading">
              <span class="conversation-name">{conversation.name}</span>
              <span class="conversation-time">{conversation.time}</span>
            </div>
            <p class="conversation-preview">
              {#each conversation.preview as line, index}
                <span class="preview-line">
                  {#if conversation.emoji?.line === index && conversation.emoji.before}
                    <img class="preview-emoji before" src={`${assets.messages}/${conversation.emoji.image}`} alt={conversation.emoji.label} />
                  {/if}
                  {line}
                  {#if conversation.emoji?.line === index && !conversation.emoji.before}
                    <img class="preview-emoji after" src={`${assets.messages}/${conversation.emoji.image}`} alt={conversation.emoji.label} />
                  {/if}
                </span>
              {/each}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </aside>

  <div class="messages-conversation">
    <ol class="message-history" aria-label="Conversation with Euna Kwon">
      <li class="hs-miami-photo" aria-label="Photo of Miami Beach">
        <img src={`${assets.messages}/miami-beach.png`} alt="People enjoying Miami Beach beside the ocean" width="388" height="192" />
      </li>
      <li class="message-bubble incoming hs-miami-message">
        <p>Miami was amazing!</p>
        {@render bubbleTail('incoming', '#e5e5e9')}
      </li>
      <li class="hs-euna-photo">
        <img src={`${assets.messages}/euna-photo.png`} alt="Euna in a yellow scarf in the sunshine" width="388" height="216" />
        <span class="hs-tapback" aria-label="Thumbs-up reaction">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M7 13H3v14h4zm3 13h12c2 0 3-1 3-3l3-11c.4-2-1-3-3-3h-8l1-5c.4-2-2-3-3-1l-5 9Z" /></svg>
        </span>
        {@render bubbleTail('incoming', '#e2c672')}
      </li>
      <li class="message-bubble outgoing hs-want-to-go">
        <p>I want to go!</p>
        {@render bubbleTail('outgoing', '#2697ef')}
        <span class="message-delivered">Delivered</span>
      </li>
    </ol>

    <div class="messages-composer" aria-label="Message composer">
      <div class="messages-input-capsule">
        <input aria-label="Message" placeholder="iMessage" disabled />
        <button class="messages-emoji-button" aria-label="Emoji" disabled>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle class="smiley-outline" cx="14" cy="14" r="11.3" />
            <circle class="smiley-eye" cx="10" cy="10" r="1.3" />
            <circle class="smiley-eye" cx="18" cy="10" r="1.3" />
            <path class="smiley-mouth" d="M6.7 15.2c1.1 8.6 13.5 8.6 14.6 0-4.1 1.8-10.5 1.8-14.6 0Z" />
          </svg>
        </button>
      </div>
      <button class="messages-microphone-button" aria-label="Audio message" disabled>
        <svg viewBox="0 0 20 30" aria-hidden="true">
          <rect x="6" y="2" width="8" height="18" rx="4" />
          <path d="M3.5 13v3.5a6.5 6.5 0 0 0 13 0V13M10 23v5m-4 0h8" />
        </svg>
      </button>
    </div>
  </div>
</section>

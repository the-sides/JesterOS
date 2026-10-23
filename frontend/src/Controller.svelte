<script>
  import { onDestroy } from 'svelte';
  import { socketURL } from './remote-control.js';
  let code = $state(''), status = $state('Unpaired'), state = $state(null), conversation = $state(''), text = $state(''), feedback = $state(''), pending = $state(null);
  let socket, timeout;
  const selected = $derived(state?.conversations.find(row => row.id === conversation));
  const window = $derived(state?.windows.find(row => row.available));
  function pair(event) {
    event.preventDefault(); socket?.close(); state = null; status = 'Connecting';
    const current = new WebSocket(socketURL()); socket = current;
    current.onopen = () => current.send(JSON.stringify({ type: 'pair', code }));
    current.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'paired') status = 'Connected';
      if (message.type === 'error') { status = 'Unpaired'; feedback = message.message; current.close(); }
      if (message.type === 'disconnected') { status = 'Screen disconnected'; state = null; current.close(); }
      if (message.type === 'state') { state = message.state; if (!state.conversations.some(row => row.id === conversation)) conversation = state.conversations[0]?.id ?? ''; }
      if (message.type === 'result' && message.id === pending) {
        clearTimeout(timeout); pending = null;
        feedback = message.result.status === 'applied' ? 'Cue delivered · confirmed by screen' : `Cue rejected · ${message.result.error?.message ?? message.result.message ?? message.result.error?.code ?? 'Screen unavailable'}`;
        if (message.result.status === 'applied') text = '';
      }
    };
    current.onclose = () => { if (socket !== current) return; status = 'Disconnected'; state = null; if (pending) { feedback = 'Delivery unknown · check the screen before sending again'; pending = null; } };
  }
  function send(event) {
    event.preventDefault();
    if (!window || !selected || !text.trim() || socket?.readyState !== 1 || pending) return;
    pending = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    socket.send(JSON.stringify({ type: 'cue', id: pending, windowId: window.windowId, conversationId: conversation, text }));
    feedback = 'Awaiting screen confirmation…';
    timeout = setTimeout(() => { if (pending) { pending = null; feedback = 'Delivery unknown · check the screen before sending again'; } }, 15000);
  }
  onDestroy(() => { clearTimeout(timeout); socket?.close(); });
</script>
<svelte:head><title>JesterOS · Controller</title></svelte:head>
<main>
  <header><a href="/">JESTER<span>OS</span></a><span class="label">OPERATOR CONSOLE / 01</span><strong class:online={status === 'Connected'}>{status}</strong>{#if status === 'Connected'}<button onclick={() => socket?.close()}>Disconnect</button>{/if}</header>
  <section class="intro"><p class="label">SCREEN DIRECTION</p><h1>Stand by.<br />Make it happen.</h1><p>Pair a puppet screen. Deliver the next line on cue.</p></section>
  <div class="grid">
    <aside><p class="label">01 / CONNECT A SCREEN</p><form onsubmit={pair}><label for="code">Pairing code</label><input id="code" bind:value={code} maxlength="10" placeholder="SCREEN CODE" required autocomplete="off" /><button disabled={status === 'Connected'}>Pair screen ↗</button></form><p class="hint">On the filming device, open JesterOS and choose “Connect controller”. Use the same server address on both devices.</p>{#if state}<p class="profile">{state.profile ?? 'Puppet screen'}<br />Live state updates every ½ second</p>{/if}</aside>
    <section class="cue"><p class="label">02 / MESSAGES CUE</p><form onsubmit={send}><label for="conversation">Conversation / sender</label><select id="conversation" bind:value={conversation} disabled={!state}><option value="" disabled>Select a conversation</option>{#each state?.conversations ?? [] as row}<option value={row.id}>{row.name}</option>{/each}</select><label for="message">Incoming message</label><textarea id="message" bind:value={text} maxlength="4096" placeholder="Write the line that arrives on screen…" rows="5"></textarea><div class="action"><span>{text.length} / 4096</span><button disabled={!window || !selected || !text.trim() || !!pending}>{pending ? 'Sending…' : 'Send cue →'}</button></div></form><p role="status" class="feedback">{feedback || (state && !window ? 'Open Messages on the puppet screen to enable cues.' : 'Waiting for your cue.')}</p></section>
    <section class="history"><p class="label">03 / LIVE CONVERSATION</p>{#if selected}<h2>{selected.name}</h2><div class="messages">{#each selected.items as item}<article class:outgoing={item.direction !== 'incoming'}><small>{item.direction === 'incoming' ? selected.name : 'Actor / outgoing'}</small><p>{item.text || '[Attachment]'}</p></article>{/each}</div>{:else}<p class="empty">The conversation will appear here when a screen connects.</p>{/if}</section>
  </div><footer>JESTEROS / LOCAL SET CONTROL<span>Fictional messages. Real timing.</span></footer>
</main>
<style>
:global(body){margin:0;background:#101916;color:#e6e9de}main{max-width:1400px;margin:auto;padding:30px 5vw;font-family:'Trebuchet MS',sans-serif}header{display:flex;align-items:center;gap:30px;border-bottom:1px solid #39433b;padding-bottom:24px}a{color:inherit;text-decoration:none;font-size:24px;font-weight:bold;letter-spacing:-1px}a span{color:#d3f596}header strong{margin-left:auto;font:12px monospace;color:#a6afa6}.online{color:#d3f596!important}.label{font:11px monospace;letter-spacing:2px;color:#a5b39e}.intro{padding:48px 0 36px}.intro h1{font-family:Georgia,serif;font-weight:normal;font-size:clamp(46px,6vw,80px);line-height:1.02;letter-spacing:-3px;margin:18px 0 22px}.intro>p:last-child{color:#a6afa6}.grid{display:grid;grid-template-columns:240px 1fr 1fr;border-top:1px solid #39433b}aside,.cue,.history{padding:26px 24px;min-width:0}aside{padding-left:0}.cue,.history{border-left:1px solid #39433b}form{display:flex;flex-direction:column;gap:12px}label{font-size:13px;margin-top:12px}input,select,textarea{box-sizing:border-box;width:100%;background:#1b2721;color:#e6e9de;border:1px solid #52604e;border-radius:3px;padding:13px;font:15px 'Trebuchet MS',sans-serif}textarea{resize:vertical}button{background:#d3f596;border:0;border-radius:3px;padding:14px 18px;font: bold 14px 'Trebuchet MS',sans-serif;color:#172416;cursor:pointer}button:disabled{opacity:.4;cursor:default}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid #d3f596;outline-offset:3px}.hint,.profile,.empty{font-size:13px;line-height:1.7;color:#a6afa6}.profile{border-top:1px solid #39433b;padding-top:20px}.action{display:flex;align-items:center;justify-content:space-between;gap:12px}.action span{font:11px monospace;color:#a6afa6}.feedback{font-size:13px;color:#d3f596;line-height:1.6;min-height:40px}h2{font:24px Georgia,serif}.messages{max-height:430px;overflow:auto;display:flex;flex-direction:column;gap:12px}article{background:#26342c;padding:12px 16px;border-radius:3px;max-width:85%;overflow-wrap:anywhere}article.outgoing{align-self:flex-end;background:#39452e}small{font:10px monospace;color:#b9c5b1}article p{white-space:pre-wrap;font-size:14px;line-height:1.5;margin:6px 0}footer{margin-top:36px;padding-top:20px;border-top:1px solid #39433b;display:flex;justify-content:space-between;color:#8e9d87;font:10px monospace;letter-spacing:1px}@media(max-width:1000px){.grid{grid-template-columns:220px 1fr}.history{grid-column:1/-1;border-left:0;border-top:1px solid #39433b}}@media(max-width:600px){header>.label{display:none}.grid{display:block}.cue,.history{border-left:0;border-top:1px solid #39433b;padding:24px 0}aside{padding-right:0}.intro{padding-top:30px}footer span{display:none}}
</style>

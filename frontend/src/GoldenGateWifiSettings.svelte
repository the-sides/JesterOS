<script>
  import { tick } from 'svelte';
  let { profile, window, wifi, execute, registerView } = $props();
  let panel = $state(null);
  const connected = $derived(wifi.networks.find(network => network.id === wifi.connectedNetworkId));
  const known = $derived(wifi.networks.filter(network => network.known));
  const availableOthers = $derived(wifi.networks.filter(network => network.available && !network.known && !network.hidden));
  async function setPower(event) {
    const input = event.currentTarget;
    try { await execute({ command: 'wifi.power.set', payload: { powered: input.checked } }); }
    finally { await tick(); if (input.isConnected) input.checked = wifi.powered; }
  }
  function networkAction(network) {
    const connect = wifi.connectedNetworkId !== network.id;
    return execute({ command: connect ? 'wifi.connect' : 'wifi.disconnect', target: { networkId: network.id } });
  }
  function openJoin() {
    return execute({ command: 'wifi.join.hidden', payload: {} });
  }
  $effect(() => registerView?.(window.id, {
    async reconcile() { await tick(); return true; },
    scrollTop() { return panel?.scrollTop ?? null; },
    async scrollTo(top) {
      if (!panel?.isConnected || !Number.isFinite(top) || top < 0) return null;
      panel.scrollTo({ top, left: 0, behavior: 'instant' });
      await tick();
      return panel?.isConnected ? panel.scrollTop : null;
    },
  }));
</script>

{#snippet networkRow(network)}
  <div class="network-row">
    <svg class="signal" viewBox="0 0 24 20" aria-hidden="true">
      <path opacity={network.strength >= 3 ? 1 : .25} fill="currentColor" d="M0 4.5a20 20 0 0 1 24 0l-2.2 2.7a16.5 16.5 0 0 0-19.6 0Z"/>
      <path opacity={network.strength >= 2 ? 1 : .25} fill="currentColor" d="M4.2 9.6a13 13 0 0 1 15.6 0l-2.3 2.7a9.4 9.4 0 0 0-11 0Z"/>
      <path opacity={network.strength >= 1 ? 1 : .25} fill="currentColor" d="M8.7 14.8a5.7 5.7 0 0 1 6.6 0L12 18Z"/>
    </svg>
    <span class="network-name">{network.name}<small>{wifi.connectedNetworkId === network.id ? 'Connected' : !network.available ? 'Not available' : network.security === 'password' ? 'Secured network' : 'Open network'}</small></span>
    <button type="button" data-application-settings-control={`network:${network.id}`} disabled={!wifi.powered || !network.available}
      aria-label={`${wifi.connectedNetworkId === network.id ? 'Disconnect from' : 'Connect to'} ${network.name}`}
      onclick={() => networkAction(network)}>{wifi.connectedNetworkId === network.id ? 'Disconnect' : 'Connect'}</button>
  </div>
{/snippet}

<section class="wifi-settings" bind:this={panel} data-system-panel="settings-wifi" data-application-panel-scroll data-application-scroll-area="settings-wifi"
  aria-label="Wi-Fi settings" tabindex="-1" onscroll={event => execute({ command: 'system.panel.scroll', target: { windowId: window.id }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="page">
    <header><p class="crumb">System Settings</p><h1>Wi-Fi</h1></header>
    <article class="card">
      <label class="power-row">
        <span class="power-copy"><strong>Wi-Fi</strong><small>{!wifi.powered ? 'Off' : connected ? `Connected to ${connected.name}` : 'Not connected'}</small></span>
        <input type="checkbox" role="switch" aria-label="Wi-Fi" data-application-settings-control="wifi-power" checked={wifi.powered} onchange={setPower} />
      </label>
    </article>
    <h2>Known Networks</h2>
    <article class="card">{#if wifi.powered}{#each known as network (network.id)}{@render networkRow(network)}{:else}<p class="empty">No known networks.</p>{/each}{:else}<p class="empty">Wi-Fi is off.</p>{/if}</article>
    <h2>Other Networks</h2>
    <article class="card">
      {#if wifi.powered}
        {#each availableOthers as network (network.id)}{@render networkRow(network)}{:else}<p class="empty">No other available networks.</p>{/each}
      {:else}
        <p class="empty">Turn on Wi-Fi to see available networks.</p>
      {/if}
      <div class="other-row"><button type="button" data-application-settings-control="other-network" disabled={!wifi.powered} onclick={openJoin}>Other…</button></div>
    </article>
    <p class="boundary">Fictional offline networks only. Default secured fixtures use “scene”; authored scenes supply their own fictional passwords. No host Wi-Fi, internet or account service is accessed.</p>
  </div>
</section>

<style>
  .wifi-settings { flex:1; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; background:var(--appearance-panel,#f2f2f3); color:var(--appearance-ink,#252529); font:13px/1.45 var(--golden-gate-font,sans-serif); }
  .page { max-width:650px; margin:0 auto; padding:22px 26px; }
  .crumb { margin:0 0 2px; opacity:.6; font-size:11px; } h1 { margin:0 0 18px; font-size:25px; letter-spacing:-.5px; font-weight:680; }
  h2 { font-size:13px; margin:20px 4px 7px; font-weight:650; }
  .card { padding:6px 16px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:12px; background:var(--appearance-surface,#fff); }
  .power-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; cursor:default; }
  .power-copy { min-width:0; } strong { font-weight:650; }
  .power-copy small, .network-name small { display:block; margin-top:2px; font-size:11px; opacity:.65; overflow-wrap:anywhere; }
  input[type='checkbox'] { flex-shrink:0; appearance:none; position:relative; width:34px; height:20px; margin:0; border:0; border-radius:12px; background:var(--appearance-menu-disabled,#979797); cursor:default; }
  input[type='checkbox']::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0003; }
  input[type='checkbox']:checked { background:var(--appearance-accent,#0878ef); }
  input[type='checkbox']:checked::after { left:17px; }
  .network-row { display:flex; align-items:center; gap:12px; padding:10px 0; } .network-row + .network-row { border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .signal { width:24px; height:20px; flex-shrink:0; }
  .network-name { flex:1; min-width:0; overflow-wrap:anywhere; }
  .network-row button, .other-row button { flex-shrink:0; min-height:28px; padding:4px 12px; border:1px solid var(--appearance-soft-border,#dcd8d3); border-radius:7px; background:var(--appearance-panel,#f2f2f3); color:inherit; font:inherit; cursor:default; }
  button:disabled { opacity:.45; }
  .other-row { display:flex; justify-content:flex-end; padding:9px 0; border-top:1px solid var(--appearance-soft-border,#dcd8d3); }
  .empty { margin:10px 0; opacity:.65; }
  .boundary { margin:16px 4px; font-size:11px; opacity:.65; }
  button:focus-visible,input:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:2px; }
  .wifi-settings:focus-visible { outline:2px solid var(--appearance-focus,#4f98e8); outline-offset:-3px; }
  @media(max-width:500px) { .page { padding:16px; } .card { padding:6px 10px; } .network-row { gap:7px; } }
</style>

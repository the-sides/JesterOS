<script>
  import AppIcon from './AppIcon.svelte';
  import HighSierraAppIcon from './HighSierraAppIcon.svelte';
  import SonomaIcon from './SonomaIcon.svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';

  let { profile, preferences, execute } = $props();
  const modern = $derived(profile.capabilities.includes('shell.window-green-menu'));
  const hasRecents = $derived(profile.renderer === 'mojave' || modern);
  const Icon = $derived(profile.renderer === 'golden-gate' ? GoldenGateIcon : modern ? SonomaIcon : profile.renderer === 'high-sierra' ? HighSierraAppIcon : AppIcon);

  function set(payload) {
    return execute({ command: 'dock.preferences.set', target: {}, payload });
  }
</script>

{#snippet sizeSlider()}
  <div class="slider-control">
    <input
      type="range"
      aria-label="Size"
      aria-valuetext={`${preferences.size} pixels`}
      data-dock-preference="size"
      min="16"
      max="128"
      step="1"
      value={preferences.size}
      oninput={(event) => set({ size: Number(event.currentTarget.value) })}
    />
    <div class="range-labels" aria-hidden="true"><span>Small</span><span>Large</span></div>
  </div>
{/snippet}

{#snippet magnificationSlider()}
  <div class="slider-control" class:disabled={!preferences.magnification}>
    <input
      type="range"
      aria-label="Magnification size"
      aria-valuetext={`${preferences.magnificationSize} pixels`}
      data-dock-preference="magnificationSize"
      min="32"
      max="192"
      step="1"
      value={preferences.magnificationSize}
      disabled={!preferences.magnification}
      oninput={(event) => set({ magnificationSize: Number(event.currentTarget.value) })}
    />
    <div class="range-labels" aria-hidden="true"><span>Small</span><span>Large</span></div>
  </div>
{/snippet}

<section class="dock-preferences" class:modern aria-label={modern ? 'Desktop & Dock settings' : 'Dock preferences'} data-dock-preferences data-window-no-drag>
  <div class="preferences-content">
    <header class="pane-heading">
      <span class="pane-icon" aria-hidden="true"><Icon name="settings" assets={profile.assets} /></span>
      <h1>{modern ? 'Desktop & Dock' : 'Dock'}</h1>
    </header>

    {#if modern}<h2>Dock</h2>{/if}
    <div class="settings-group">
      <div class="size-row">
        <span class="setting-title">Size</span>
        {@render sizeSlider()}
      </div>

      <div class="magnification-row">
        <label class="check-setting magnification-toggle">
          <input type="checkbox" data-dock-preference="magnification" checked={preferences.magnification} onchange={(event) => set({ magnification: event.currentTarget.checked })} />
          <span>Magnification</span>
        </label>
        {@render magnificationSlider()}
      </div>

      <div class="behavior-settings">
        <label class="check-setting">
          <input type="checkbox" data-dock-preference="minimizeIntoApp" checked={preferences.minimizeIntoApp} onchange={(event) => set({ minimizeIntoApp: event.currentTarget.checked })} />
          <span>Minimize windows into application icon</span>
        </label>
        <label class="check-setting">
          <input type="checkbox" data-dock-preference="autoHide" checked={preferences.autoHide} onchange={(event) => set({ autoHide: event.currentTarget.checked })} />
          <span>Automatically hide and show the Dock</span>
        </label>
        {#if hasRecents}
          <label class="check-setting">
            <input type="checkbox" data-dock-preference="showRecent" checked={preferences.showRecent} onchange={(event) => set({ showRecent: event.currentTarget.checked })} />
            <span>{modern ? 'Show suggested and recent apps in Dock' : 'Show recent applications in Dock'}</span>
          </label>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .dock-preferences {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    overflow: auto;
    padding: 23px 28px 30px;
    color: var(--appearance-ink, #242424);
    background: var(--appearance-panel, #ededed);
    font: 13px/1.4 var(--system-font);
    -webkit-font-smoothing: antialiased;
    container-type: inline-size;
  }
  .preferences-content { width: 100%; max-width: 530px; margin: 0 auto; }
  .pane-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
  .pane-icon { display: block; flex: 0 0 44px; width: 44px; height: 44px; }
  .pane-icon :global(.app-icon), .pane-icon :global(.sonoma-icon) { display: block; width: 100%; height: 100%; }
  h1 { margin: 0; font-size: 18px; font-weight: 500; letter-spacing: -0.3px; }
  h2 { margin: 0 0 9px 12px; font-size: 13px; font-weight: 600; }
  .size-row, .magnification-row { display: grid; grid-template-columns: 180px minmax(0, 1fr); align-items: start; gap: 20px; margin-bottom: 21px; }
  .setting-title { padding-top: 3px; text-align: right; }
  .magnification-toggle { justify-content: flex-end; padding-top: 2px; }
  .slider-control { min-width: 0; }
  input { font: inherit; accent-color: var(--appearance-accent, #1479e5); }
  input[type='range'] { display: block; box-sizing: border-box; width: 100%; height: 22px; margin: 0; padding: 0; cursor: default; }
  .range-labels { display: flex; justify-content: space-between; gap: 12px; margin-top: 2px; color: var(--appearance-muted, #595959); font-size: 11px; line-height: 16px; }
  .disabled .range-labels { color: var(--appearance-disabled, #929292); }
  input:disabled { cursor: default; opacity: 0.5; }
  .behavior-settings { border-top: 1px solid var(--appearance-soft-border, #d0d0d0); margin-top: 25px; padding: 17px 0 0 160px; }
  .check-setting { display: flex; align-items: flex-start; gap: 7px; min-width: 0; cursor: default; }
  .check-setting input[type='checkbox'] { flex: 0 0 auto; width: 14px; height: 14px; margin: 2px 0 0; }
  .check-setting span { min-width: 0; overflow-wrap: break-word; }
  .behavior-settings .check-setting + .check-setting { margin-top: 11px; }
  input:focus-visible { outline: 3px solid var(--appearance-focus, rgb(47 136 237 / 55%)); outline-offset: 3px; border-radius: 3px; }

  .modern { padding: 24px 23px 30px; background: var(--appearance-panel, #f5f5f5); font-family: var(--sonoma-font); }
  .modern .preferences-content { max-width: 620px; }
  .modern .pane-heading { gap: 11px; margin-bottom: 24px; }
  .modern .pane-icon { flex-basis: 36px; width: 36px; height: 36px; }
  .modern h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.4px; }
  .modern .settings-group { padding: 0 14px; border: 1px solid var(--appearance-soft-border, #dedede); border-radius: 10px; background: var(--appearance-card, #fff); box-shadow: 0 1px 2px rgb(0 0 0 / 2%); }
  .modern .size-row { grid-template-columns: minmax(0, 1fr) minmax(120px, 215px); align-items: center; gap: 22px; margin: 0; padding: 14px 0; }
  .modern .setting-title { padding: 0; text-align: left; }
  .modern .magnification-row { grid-template-columns: minmax(0, 1fr) minmax(120px, 215px); align-items: center; gap: 22px; margin: 0; padding: 14px 0; border-top: 1px solid var(--appearance-soft-border, #e5e5e5); }
  .modern .magnification-toggle { grid-column: 1 / -1; padding: 0; }
  .modern .magnification-row .slider-control { grid-column: 2; margin-top: -13px; }
  .modern .range-labels { color: var(--appearance-muted, #7a7a7a); font-size: 10px; }
  .modern .disabled .range-labels { color: var(--appearance-disabled, #a1a1a1); }
  .modern .behavior-settings { border-top: 0; margin: 0; padding: 0; }
  .modern .check-setting { align-items: center; justify-content: space-between; gap: 18px; }
  .modern .behavior-settings .check-setting { min-height: 44px; box-sizing: border-box; padding: 11px 0; border-top: 1px solid var(--appearance-soft-border, #e5e5e5); }
  .modern .behavior-settings .check-setting + .check-setting { margin: 0; }
  .modern .check-setting span { order: 0; }
  .modern .check-setting input[type='checkbox'] { position: relative; order: 1; appearance: none; width: 28px; height: 16px; margin: 0; border: 1px solid var(--appearance-border, #c6c6c6); border-radius: 10px; background: var(--appearance-inactive-selection, #d4d4d4); box-shadow: inset 0 1px 2px rgb(0 0 0 / 8%); }
  .modern .check-setting input[type='checkbox']::before { content: ''; position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%; background: var(--appearance-accent-ink, white); box-shadow: 0 1px 2px rgb(0 0 0 / 25%); }
  .modern .check-setting input[type='checkbox']:checked { border-color: var(--appearance-accent, #1479e5); background: var(--appearance-accent, #1479e5); }
  .modern .check-setting input[type='checkbox']:checked::before { left: 13px; }
  .modern .check-setting input:focus-visible { border-radius: 10px; }

  @container (max-width: 430px) {
    .size-row, .magnification-row { grid-template-columns: minmax(0, 1fr); gap: 7px; }
    .setting-title { text-align: left; }
    .magnification-toggle { justify-content: flex-start; }
    .behavior-settings { padding-left: 0; }
    .modern .size-row, .modern .magnification-row { grid-template-columns: minmax(0, 1fr); gap: 9px; }
    .modern .magnification-toggle, .modern .magnification-row .slider-control { grid-column: 1; margin: 0; }
    .pane-heading { margin-bottom: 21px; }
  }
  @media (forced-colors: active) {
    .modern .check-setting input[type='checkbox'] { appearance: auto; width: 16px; height: 16px; }
    .modern .check-setting input[type='checkbox']::before { display: none; }
    input:focus-visible { outline-color: Highlight; }
  }
</style>

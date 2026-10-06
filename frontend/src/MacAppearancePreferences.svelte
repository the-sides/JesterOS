<script>
  import { tick } from 'svelte';
  import { appearancePresets, appearanceOptions, appearanceColor } from './appearance.js';

  let { profile, state: appearance, execute } = $props();
  const modern = $derived(profile.renderer === 'sonoma');
  const highSierra = $derived(profile.renderer === 'high-sierra');
  const options = $derived(appearanceOptions(profile));
  const accents = $derived(appearancePresets.filter(preset => options.accents.includes(preset.id)));
  const highlights = $derived(appearancePresets.filter(preset => options.highlights.includes(preset.id)));
  const custom = $derived(appearance.highlight.startsWith('#'));
  const resolvedHighlight = $derived(appearanceColor(appearance.highlight));
  const channels = $derived([1, 3, 5].map(offset => parseInt(resolvedHighlight.slice(offset, offset + 2), 16)));
  const classicDock = $derived(!modern && profile.capabilities.includes('shell.dock-management'));
  const classicMissionControl = $derived(!modern && profile.capabilities.includes('shell.dashboard'));
  let highlightSelect;
  let hexInput = $state(null);

  // Only the editable text draft is local; the supplied state owns every preference.
  let hexDraft = $state('');
  let hexFocused = $state(false);
  let hexDirty = $state(false);
  const validDraft = $derived(/^#?[\da-f]{6}$/i.test(hexDraft));
  const invalidDraft = $derived(hexDirty && !validDraft);
  $effect.pre(() => {
    if (!custom) {
      // A preset owns the new color before removing Other's draft controls.
      // Native blur/change must not replay a stale Hex edit over that choice.
      hexDirty = false; hexFocused = false; hexDraft = resolvedHighlight;
      if (document.activeElement?.closest('[data-appearance-custom-highlight]'))
        highlightSelect?.focus({ preventScroll: true });
    }
    else if (!hexDirty && hexDraft !== resolvedHighlight) {
      const input = hexInput, color = resolvedHighlight;
      const focused = input && document.activeElement === input;
      const shift = hexDraft.startsWith('#') ? 0 : 1;
      const selection = focused ? { start: input.selectionStart + shift, end: input.selectionEnd + shift, direction: input.selectionDirection } : null;
      hexDraft = color;
      if (selection) tick().then(() => {
        if (input.isConnected && document.activeElement === input && !hexDirty && custom && hexDraft === color)
          input.setSelectionRange(Math.min(selection.start, color.length), Math.min(selection.end, color.length), selection.direction);
      });
    }
  });
  $effect(() => {
    if (!hexFocused && !hexDirty) hexDraft = resolvedHighlight;
  });

  function set(command, payload) {
    return execute({ command, target: {}, payload });
  }

  function selectHighlight(value) {
    hexDirty = false;
    return set('appearance.setHighlight', { color: value === 'other' ? resolvedHighlight : value });
  }

  function setChannel(index, value) {
    const rgb = channels.map((channel, channelIndex) => channelIndex === index ? Number(value) : channel);
    hexDirty = false;
    return set('appearance.setHighlight', { color: `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}` });
  }

  function commitHex() {
    if (!hexDirty || !validDraft) return;
    const color = `#${hexDraft.replace(/^#/, '').toLowerCase()}`;
    hexDirty = false;
    set('appearance.setHighlight', { color });
  }

  function leaveHex() {
    hexFocused = false;
    if (!hexDirty) hexDraft = resolvedHighlight;
  }

  function previewInk(hex) {
    const linear = [1, 3, 5].map(offset => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    return luminance > 0.179 ? '#000000' : '#ffffff';
  }
</script>

<section class="appearance-preferences" class:modern class:high-sierra={highSierra} aria-label={`${options.paneName} preferences`} data-appearance-preferences data-window-no-drag>
  <div class="preferences-content">
    <header><span class="pane-symbol" aria-hidden="true"><i></i><i></i><i></i></span><h1>{options.paneName}</h1></header>

    <div class="settings-group">
      {#if highSierra}
        <label class="setting-row">
          <span class="setting-label">Appearance:</span>
          <select data-appearance-control="accent" value={appearance.accent} onchange={event => set('appearance.setAccent', { color: event.currentTarget.value })}>
            {#each accents as preset}<option value={preset.id}>{preset.name}</option>{/each}
          </select>
        </label>
        <label class="dark-shell setting-indent">
          <input type="checkbox" data-appearance-control="mode" checked={appearance.mode === 'dark'} onchange={event => set('appearance.setMode', { mode: event.currentTarget.checked ? 'dark' : 'light' })} />
          <span>Use dark menu bar and Dock</span>
        </label>
      {:else}
        <fieldset class="appearance-row">
          <legend>{modern ? 'Appearance' : 'Appearance:'}</legend>
          <div class="preview-choices">
            {#each options.modes as mode}
              <label class="mode-choice" class:selected={appearance.mode === mode}>
                <input type="radio" name="mac-appearance-mode" value={mode} checked={appearance.mode === mode} data-appearance-mode={mode} onchange={() => set('appearance.setMode', { mode })} />
                <span class="preview-frame" class:dark-preview={mode === 'dark'} aria-hidden="true">
                  <span class="preview-desktop"><span class="preview-menu"></span><span class="preview-window"><span class="preview-title"><i></i><i></i><i></i></span><span class="preview-sidebar"></span><span class="preview-lines"><i></i><i></i><i></i></span><span class="preview-button"></span></span><span class="preview-dock"><i></i><i></i><i></i><i></i></span></span>
                </span>
                <span class="mode-label">{mode === 'light' ? 'Light' : 'Dark'}</span>
              </label>
            {/each}
          </div>
        </fieldset>
        <fieldset class="accent-row">
          <legend>{modern ? 'Accent color' : 'Accent color:'}</legend>
          <div class="accent-choices">
            {#each accents as preset}
              <label class="accent-choice" title={preset.name}>
                <input type="radio" name="mac-appearance-accent" aria-label={preset.name} value={preset.id} checked={appearance.accent === preset.id} data-appearance-accent={preset.id} style={`--swatch: ${appearanceColor(preset.id, 'accent')}`} onchange={() => set('appearance.setAccent', { color: preset.id })} />
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}

      <label class="setting-row highlight-row">
        <span class="setting-label">{modern ? 'Highlight color' : 'Highlight color:'}</span>
        <span class="highlight-control">
          <span class="highlight-swatch" style={`background: ${resolvedHighlight}`} aria-hidden="true"></span>
          <select bind:this={highlightSelect} data-appearance-control="highlight" value={custom ? 'other' : appearance.highlight} onchange={event => selectHighlight(event.currentTarget.value)}>
            {#each highlights as preset}<option value={preset.id}>{preset.name}</option>{/each}
            <option value="other">Other…</option>
          </select>
        </span>
      </label>

      {#if custom}
        <fieldset class="custom-highlight" data-appearance-custom-highlight>
          <legend>Custom highlight color</legend>
          <p class="custom-note">An in-page RGB approximation of Other…, not the macOS Color panel.</p>
          {#each ['Red', 'Green', 'Blue'] as channel, index}
            <label class="rgb-row">
              <span>{channel}</span>
              <input type="range" min="0" max="255" step="1" value={channels[index]} aria-valuetext={`${channels[index]} of 255`} data-appearance-rgb={channel.toLowerCase()} oninput={event => setChannel(index, event.currentTarget.value)} />
              <output>{channels[index]}</output>
            </label>
          {/each}
          <label class="hex-row"><span>Hex</span><input bind:this={hexInput} type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-invalid={invalidDraft} aria-describedby="appearance-hex-help" data-appearance-hex value={hexDraft} onfocus={() => { hexFocused = true; }} onblur={leaveHex} oninput={event => { hexDraft = event.currentTarget.value; hexDirty = true; }} onchange={commitHex} onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }} /></label>
          <p id="appearance-hex-help" class="hex-help" class:invalid={invalidDraft} aria-live="polite">{invalidDraft ? 'Enter six hexadecimal digits, for example #4a90d9. Your last valid color is unchanged.' : 'Six hexadecimal digits, with or without #. Press Enter or leave the field to use the color.'}</p>
          <div class="highlight-preview" aria-label={`Highlight preview ${resolvedHighlight}`}><span style={`background: ${resolvedHighlight}; color: ${previewInk(resolvedHighlight)}`}>Selected text</span><code>{resolvedHighlight}</code></div>
        </fieldset>
      {/if}
    </div>

    <p class="scope-note">{highSierra ? 'Dark appearance affects the menu bar and Dock only.' : modern ? 'Light and Dark are manual scene settings. Auto scheduling and Multicolor are not represented.' : 'Appearance changes this scene, not your computer’s settings.'}</p>
    {#if classicDock || classicMissionControl}
      <footer>
        {#if classicDock}<button type="button" data-appearance-open="dock" onclick={() => execute({ command: 'dock.preferences.open', target: {}, payload: {} })}>Dock…</button>{/if}
        {#if classicMissionControl}<button type="button" data-appearance-open="mission-control" onclick={() => execute({ command: 'dashboard.preferences.open', target: {}, payload: {} })}>Mission Control…</button>{/if}
      </footer>
    {/if}
  </div>
</section>

<style>
  .appearance-preferences { box-sizing: border-box; width: 100%; height: 100%; min-width: 0; overflow: auto; padding: 24px 28px; background: var(--appearance-panel, #ededed); color: var(--appearance-ink, #242424); font: 13px/1.4 var(--system-font); container-type: inline-size; -webkit-font-smoothing: antialiased; }
  .preferences-content { max-width: 530px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
  h1 { margin: 0; font-size: 20px; font-weight: 400; letter-spacing: -.35px; }
  .pane-symbol { box-sizing: border-box; display: flex; align-items: center; justify-content: space-evenly; width: 40px; height: 38px; padding: 7px 4px; border: 1px solid var(--appearance-border, #999); border-radius: 5px; background: var(--appearance-card, linear-gradient(#fafafa, #d9d9d9)); }
  .pane-symbol i { display: block; width: 6px; height: 22px; border-radius: 2px; background: var(--appearance-muted, #888); position: relative; }
  .pane-symbol i::after { content: ''; position: absolute; left: -2px; top: 5px; width: 10px; height: 5px; border: 1px solid var(--appearance-border, #777); border-radius: 2px; background: var(--appearance-card, #eee); }
  .pane-symbol i:nth-child(2)::after { top: 13px; }
  .pane-symbol i:nth-child(3)::after { top: 9px; }
  .settings-group { padding: 4px 0; }
  .setting-row { display: flex; align-items: center; gap: 15px; margin: 18px 0; }
  .setting-label { flex: 0 0 126px; text-align: right; }
  fieldset { min-width: 0; padding: 0; border: 0; margin: 0; }
  .appearance-row, .accent-row { display: flex; gap: 15px; position: relative; padding-left: 141px; margin-bottom: 23px; }
  .appearance-row legend, .accent-row legend { position: absolute; top: 8px; left: 0; width: 126px; text-align: right; }
  .accent-row legend { top: 3px; }
  .preview-choices { display: flex; gap: 18px; }
  .mode-choice { display: flex; flex-direction: column; align-items: center; position: relative; cursor: pointer; gap: 7px; }
  .mode-choice > input { position: absolute; width: 100%; height: 76px; margin: 0; opacity: 0; cursor: pointer; }
  .preview-frame { display: block; width: 104px; height: 70px; padding: 3px; border: 2px solid transparent; border-radius: 6px; }
  .selected .preview-frame { border-color: var(--appearance-accent, #007aff); }
  .mode-choice input:focus-visible + .preview-frame { outline: 3px solid var(--appearance-focus, #80baff); outline-offset: 2px; }
  .preview-desktop { display: block; position: relative; overflow: hidden; width: 100%; height: 100%; border-radius: 3px; background: linear-gradient(160deg, #e5bc91 0%, #cb945c 42%, #9b6656 43%, #543b51 100%); }
  .preview-menu { position: absolute; inset: 0 0 auto; height: 5px; background: #f0e3d8; }
  .preview-window { position: absolute; top: 14px; left: 15px; width: 72px; height: 40px; border-radius: 2px; background: #fafafa; box-shadow: 0 1px 5px #0005; }
  .preview-title { display: flex; gap: 2px; padding: 3px; height: 4px; background: #dedede; border-radius: 2px 2px 0 0; }
  .preview-title i { width: 3px; height: 3px; border-radius: 50%; background: #999; }
  .preview-sidebar { position: absolute; top: 10px; bottom: 0; width: 19px; background: #e8e8e8; }
  .preview-lines { position: absolute; top: 16px; left: 25px; right: 7px; display: grid; gap: 4px; }
  .preview-lines i { height: 2px; background: #ccc; }
  .preview-lines i:last-child { width: 70%; }
  .preview-button { position: absolute; bottom: 4px; right: 5px; width: 14px; height: 5px; border-radius: 2px; background: var(--appearance-accent, #007aff); }
  .preview-dock { position: absolute; bottom: 2px; left: 31px; display: flex; gap: 3px; padding: 2px 4px; border-radius: 2px; background: #ddd9; }
  .preview-dock i { width: 5px; height: 5px; border-radius: 1px; background: #fff9; }
  .dark-preview .preview-desktop { background: linear-gradient(160deg, #384160 0%, #47516a 42%, #282c47 43%, #151a2b 100%); }
  .dark-preview .preview-menu { background: #292929; }
  .dark-preview .preview-window { background: #323232; }
  .dark-preview .preview-title { background: #444; }
  .dark-preview .preview-sidebar { background: #3c3c3c; }
  .dark-preview .preview-lines i { background: #777; }
  .dark-preview .preview-dock { background: #333b; }
  .accent-choices { display: flex; flex-wrap: wrap; gap: 9px; }
  .accent-choice { display: flex; align-items: center; cursor: pointer; }
  .accent-choice input { appearance: none; margin: 0; width: 20px; height: 20px; border: 1px solid #0002; border-radius: 50%; background: var(--swatch); cursor: pointer; }
  .accent-choice input:checked { box-shadow: inset 0 0 0 3px var(--appearance-card, #fff), 0 0 0 1px var(--appearance-muted, #888); }
  input, select { accent-color: var(--appearance-accent, auto); }
  select, .hex-row input, button { box-sizing: border-box; max-width: 100%; border: 1px solid var(--appearance-border, #aaa); border-radius: 4px; color: var(--appearance-ink, #222); background: var(--appearance-input, #fff); font: inherit; }
  select { min-width: 142px; padding: 3px 7px; }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 3px solid var(--appearance-focus, #80baff); outline-offset: 2px; }
  input:disabled, select:disabled, button:disabled { color: var(--appearance-disabled, #999); cursor: default; opacity: .6; }
  .highlight-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .highlight-swatch { width: 18px; height: 18px; flex: none; border: 1px solid var(--appearance-border, #aaa); border-radius: 3px; }
  .dark-shell { display: flex; align-items: center; gap: 7px; margin: -5px 0 24px 141px; }
  .dark-shell input { margin: 0; flex: none; }
  .custom-highlight { margin: 20px 0 0 141px; padding: 12px; border: 1px solid var(--appearance-soft-border, #ccc); border-radius: 5px; background: var(--appearance-card, #f6f6f6); }
  .custom-highlight legend { padding: 0 5px; font-weight: 500; }
  .custom-note, .hex-help, .scope-note { color: var(--appearance-muted, #707070); font-size: 11px; line-height: 1.5; }
  .custom-note { margin: 0 0 12px; }
  .rgb-row { display: grid; grid-template-columns: 38px minmax(50px, 1fr) 26px; align-items: center; gap: 8px; margin: 9px 0; }
  .rgb-row input { width: 100%; margin: 0; min-width: 0; }
  output { font-variant-numeric: tabular-nums; text-align: right; }
  .hex-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .hex-row > span { width: 38px; flex: none; }
  .hex-row input { width: 125px; min-width: 0; padding: 4px 7px; font-variant-numeric: tabular-nums; }
  .hex-row input[aria-invalid='true'] { border-color: #ba3a35; }
  .hex-help { margin: 7px 0 12px; }
  .hex-help.invalid { color: var(--appearance-ink, #242424); }
  .highlight-preview { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--appearance-soft-border, #ccc); border-radius: 3px; background: var(--appearance-input, #fff); }
  .highlight-preview span { padding: 1px 3px; }
  .highlight-preview code { color: var(--appearance-muted, #707070); font-size: 11px; }
  .scope-note { margin: 25px 0 0; }
  footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--appearance-soft-border, #ccc); padding-top: 16px; margin-top: 20px; }
  button { padding: 3px 12px; background: var(--appearance-card, linear-gradient(#fff, #eee)); cursor: pointer; }
  button:hover { background: var(--appearance-hover, #e3e3e3); }
  .modern { background: var(--appearance-surface, #f5f5f5); padding: 24px; }
  .modern h1 { font-size: 22px; font-weight: 600; }
  .modern .settings-group { padding: 20px 16px; background: var(--appearance-card, #fff); border: 1px solid var(--appearance-soft-border, #dedede); border-radius: 9px; }
  .modern .pane-symbol { border-radius: 9px; }
  @container (max-width: 430px) {
    .setting-label { flex-basis: 104px; }
    .appearance-row, .accent-row { padding-left: 119px; }
    .appearance-row legend, .accent-row legend { width: 104px; }
    .preview-choices { gap: 7px; }
    .preview-frame { width: 85px; height: 62px; }
    .preview-window { left: 8px; width: 65px; }
    .preview-dock { left: 22px; }
    .custom-highlight { margin-left: 0; }
    .dark-shell { margin-left: 119px; }
  }
  @container (max-width: 340px) {
    .appearance-row, .accent-row { padding: 0; display: block; }
    .appearance-row legend, .accent-row legend { position: static; width: auto; text-align: left; margin-bottom: 10px; }
    .setting-row { align-items: flex-start; flex-direction: column; gap: 7px; }
    .setting-label { flex: none; text-align: left; }
    .dark-shell { margin-left: 0; }
    .accent-choices { gap: 10px; }
    .modern .settings-group { padding: 15px 12px; }
  }
</style>

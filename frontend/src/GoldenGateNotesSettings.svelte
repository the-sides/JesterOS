<script>
  let { preferences, execute, windowId } = $props();

  function setPreference(field, value) {
    return execute({ command: 'app.settings.set', target: { appId: 'notes' }, payload: { [field]: value } });
  }
</script>

<section class="settings-panel golden-gate-notes-settings" data-application-notes-settings data-application-panel-scroll aria-label="Notes settings" tabindex="-1" onscroll={(event) => execute({ command: 'app.panel.scroll', target: { windowId }, payload: { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, observe: true } })}>
  <div class="settings-content">
    <h1>Notes Settings</h1>
    <div class="settings-group">
      <label class="sort-row">
        <span>Sort notes by</span>
        <select data-application-settings-control="sort-by" value={preferences.sortBy} onchange={(event) => setPreference('sortBy', event.currentTarget.value)}>
          <option value="date-edited">Date Edited</option>
          <option value="date-created">Date Created</option>
          <option value="title">Title</option>
        </select>
      </label>
      {#if preferences.sortBy !== 'title'}
        <label class="group-row">
          <input type="checkbox" data-application-settings-control="group-by-date" checked={preferences.groupByDate} onchange={(event) => setPreference('groupByDate', event.currentTarget.checked)} />
          <span>Group notes by date</span>
        </label>
      {/if}
    </div>
    <p class="setting-description">Pinned notes always appear at the top of the list.</p>
    <div class="settings-group text-group">
      <label class="text-size-row">
        <span class="text-size-heading"><span>Default text size</span><span class="text-size-value">{preferences.textSize} px</span></span>
        <input type="range" min="12" max="24" step="1" data-application-settings-control="text-size" value={preferences.textSize} aria-valuetext={`${preferences.textSize} simulation pixels`} oninput={(event) => setPreference('textSize', event.currentTarget.valueAsNumber)} />
      </label>
      <div class="range-labels" aria-hidden="true"><span>12</span><span>24</span></div>
    </div>
    <p class="setting-description">Text size uses simulation pixels, not native points.</p>
  </div>
</section>

<style>
  .settings-panel { display: flex; flex: 1; flex-direction: column; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 20px; color: var(--appearance-ink, #252529); background: var(--appearance-panel, #f2f2f3); font: 13px/1.4 var(--golden-gate-font, sans-serif); }
  .settings-content { flex: 0 0 auto; width: 100%; max-width: 440px; margin: 0 auto; }
  h1 { margin: 0 0 16px; font-size: 17px; font-weight: 650; }
  .settings-group { padding: 12px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 10px; background: var(--appearance-surface, #fff); }
  .sort-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  select { box-sizing: border-box; min-width: 136px; max-width: 100%; min-height: 28px; padding: 3px 7px; border: 1px solid var(--appearance-soft-border, #dcd8d3); border-radius: 6px; color: inherit; background: var(--appearance-surface, #fff); font: inherit; }
  .group-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--appearance-soft-border, #dcd8d3); }
  input { accent-color: var(--appearance-accent, #0878ef); }
  input[type='checkbox'] { flex: 0 0 auto; width: 15px; height: 15px; margin: 0; }
  .text-size-row { display: flex; flex-direction: column; gap: 8px; }
  .text-size-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 12px; }
  .text-size-value { font-variant-numeric: tabular-nums; opacity: .75; }
  input[type='range'] { box-sizing: border-box; width: 100%; min-width: 0; height: 22px; margin: 0; }
  .range-labels { display: flex; justify-content: space-between; padding: 0 2px; font-size: 10px; opacity: .6; font-variant-numeric: tabular-nums; }
  .setting-description { margin: 7px 4px 16px; font-size: 11px; line-height: 1.4; opacity: .7; }
  .setting-description:last-child { margin-bottom: 0; }
  select:focus-visible, input:focus-visible { outline: 3px solid var(--appearance-focus, #4f98e8); outline-offset: 3px; }
  .settings-panel:focus-visible { outline: 2px solid var(--appearance-focus, #4f98e8); outline-offset: -3px; }
</style>

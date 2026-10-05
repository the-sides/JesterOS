<script>
  import { STACK_GROUPS, STACK_SORTS, STACK_LABELS } from './desktop-stacks-model.js';
  let { profile, options, sortBy, stacks, execute } = $props();
  function set(option, value) { return execute({ command: 'desktop.view.set', target: {}, payload: { option, value } }); }
  function sort(event) { return execute({ command: stacks?.enabled ? 'desktop.stacks.sort' : 'desktop.sort', target: {}, payload: { by: event.currentTarget.value } }); }
</script>
<div class="view-inspector" class:modern={profile.renderer === 'sonoma'}>
  <h2>Desktop</h2>
  {#if stacks?.enabled}<label class="row"><span>Group By:</span><select aria-label="Group Stacks By" value={stacks.groupBy} onchange={(event) => execute({ command: 'desktop.stacks.group', target: {}, payload: { by: event.currentTarget.value } })}>{#each STACK_GROUPS as by}<option value={by}>{STACK_LABELS[by]}</option>{/each}</select></label>{/if}
  <label class="row"><span>Sort By:</span><select aria-label="Sort By" value={stacks?.enabled ? stacks.sortBy : sortBy} onchange={sort}>{#each stacks?.enabled ? STACK_SORTS : ['none', 'name', 'kind', 'size'] as by}<option value={by}>{by === 'none' ? 'None' : STACK_LABELS[by]}</option>{/each}</select></label>
  <label class="slider"><span>Icon Size: <output>{options.iconSize} × {options.iconSize}</output></span><input aria-label="Icon Size" type="range" min="16" max="128" step="1" value={options.iconSize} oninput={(event) => set('iconSize', Number(event.currentTarget.value))}/><small><span>16 × 16</span><span>128 × 128</span></small></label>
  <label class="slider"><span>Grid Spacing:</span><input aria-label="Grid Spacing" type="range" min="8" max="64" step="1" value={options.gridSpacing} oninput={(event) => set('gridSpacing', Number(event.currentTarget.value))}/><small><span>Less</span><span>More</span></small></label>
  <label class="row"><span>Text Size:</span><select aria-label="Text Size" value={options.textSize} onchange={(event) => set('textSize', Number(event.currentTarget.value))}>{#each [10, 11, 12, 13, 14, 15, 16] as size}<option value={size}>{size}</option>{/each}</select></label>
  <fieldset><legend>Label Position:</legend><label><input type="radio" name="desktop-label-position" value="bottom" checked={options.labelPosition === 'bottom'} onchange={() => set('labelPosition', 'bottom')}/> Bottom</label><label><input type="radio" name="desktop-label-position" value="right" checked={options.labelPosition === 'right'} onchange={() => set('labelPosition', 'right')}/> Right</label></fieldset>
  <label class="check"><input type="checkbox" checked={options.showItemInfo} onchange={(event) => set('showItemInfo', event.currentTarget.checked)}/> Show item info</label>
  <label class="check"><input type="checkbox" checked={options.showIconPreview} onchange={(event) => set('showIconPreview', event.currentTarget.checked)}/> Show icon preview</label>
</div>
<style>
  .view-inspector { height: 100%; overflow: auto; box-sizing: border-box; padding: 14px 18px; color: #222; background: #ededed; font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; }
  h2 { margin: 0 0 16px; font-size: 13px; font-weight: 600; text-align: center; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; } select { min-width: 125px; font: inherit; color: #222; }
  .slider { display: block; margin: 14px 0 18px; } .slider>span { display: flex; justify-content: space-between; } input[type="range"] { display: block; width: 100%; margin: 8px 0 2px; accent-color: #287bd6; } small { display: flex; justify-content: space-between; color: #777; font-size: 10px; }
  fieldset { padding: 0; border: 0; margin: 0 0 15px; display: flex; gap: 18px; } legend { margin-bottom: 6px; } input { accent-color: #287bd6; vertical-align: -2px; } .check { display: block; margin: 10px 0; }
  .modern { background: #f4f4f4; font-size: 13px; } .modern select { border: 1px solid #bbb; border-radius: 5px; padding: 2px 5px; background: white; }
</style>

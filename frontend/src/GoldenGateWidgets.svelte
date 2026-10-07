<script>
  import { onMount } from 'svelte';
  import { widgetCatalog, widgetPresentation } from './notification-widget-model.js';
  let { state: widgetState, clock, centerId, ui, foreground = true, execute, onerror = () => {} } = $props();
  let root = $state(null), option = $state(false), drag = null, cityDrag = null, bodyGesture = null;
  const id = (widget, suffix) => `widget:${widget.id}:${suffix}`;
  function owned(widget, node, owner = centerId) { return foreground && owner === centerId && root?.isConnected && node?.isConnected && root.contains(node) && widgetState.instances.includes(widget); }
  onMount(() => {
    const ownerRoot = root;
    const controlClick = event => { if (foreground && event.ctrlKey) { event.preventDefault(); event.stopPropagation(); } };
    ownerRoot.addEventListener('click', controlClick, true);
    return () => ownerRoot.removeEventListener('click', controlClick, true);
  });
  function bodyStart(event, widget) {
    bodyGesture = null;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || !owned(widget, event.currentTarget)
      || event.target.closest('button,input,select,label,[role="slider"],.context,.configuration')) return;
    bodyGesture = { widget, node: event.currentTarget, owner: centerId, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false };
  }
  function bodyMove(event) {
    if (bodyGesture?.pointerId === event.pointerId && Math.hypot(event.clientX - bodyGesture.x, event.clientY - bodyGesture.y) > 6)
      bodyGesture.moved = true;
  }
  function bodyEnd(event) {
    const original = bodyGesture; bodyGesture = null;
    if (original && !original.moved && original.pointerId === event.pointerId && event.button === 0
      && !event.ctrlKey && !event.metaKey && !event.altKey && owned(original.widget, original.node, original.owner))
      void request('open', original.widget, {}, {}, original.node);
  }
  async function request(command, widget, payload = {}, extra = {}, node = root) {
    const owner = centerId, ownerRoot = root;
    if (!owned(widget, node, owner)) return;
    try { const result = await execute(`widgets.${command}`, { centerId: owner, widgetId: widget.id, ...extra }, payload); if (root === ownerRoot && ownerRoot?.isConnected && foreground && owner === centerId && (result.status === 'applied' || owned(widget, node, owner))) onerror(result.status === 'rejected' ? result.error.message : null); return result; }
    catch (error) { if (owned(widget, node, owner)) onerror(error?.message ?? 'Widget request failed.'); }
  }
  async function configure(widget, field, value, node) {
    const owner = centerId, ownerRoot = root;
    const result = await request('configure', widget, { configuration: { ...widget.configuration, [field]: value } }, {}, node);
    if (result?.status === 'applied' || owner !== centerId || ownerRoot !== root || !root?.contains(node) || !widgetState.instances.includes(widget)) return;
    const current = widget.configuration[field];
    if (node.multiple) for (const option of node.options) option.selected = current.includes(option.value);
    else node.value = current ?? '';
  }
  function selection(event) { return Array.from(event.currentTarget.selectedOptions, option => option.value); }
  async function toggleReminder(event, widget, reminder) {
    const owner = centerId, node = event.currentTarget;
    const original = widgetState.sources.reminders.find(row => row.id === reminder.id);
    if (!original || !owned(widget, node, owner)) return;
    const result = await request('reminder.setCompleted', widget, { completed: node.checked }, { reminderId: original.id }, node);
    if (result?.status !== 'applied' && owner === centerId && root?.contains(node) && widgetState.instances.includes(widget)
      && widgetState.sources.reminders.includes(original)) node.checked = original.completed;
  }
  function scrolled(widget, node) {
    if (!owned(widget, node)) return;
    const previous = ui.scrolls?.[widget.id];
    if (previous?.top !== node.scrollTop || previous?.left !== node.scrollLeft)
      void request('scroll', widget, { top: node.scrollTop, left: node.scrollLeft }, {}, node);
  }
  $effect(() => { if (!foreground) { option = false; drag = null; cityDrag = null; bodyGesture = null; } });
  function dragStart(event, widget) {
    if (event.button !== 0 || !owned(widget, event.currentTarget)) return;
    drag = { widget, node: event.currentTarget.closest('[data-widget-id]'), owner: centerId, pointerId: event.pointerId, y: event.clientY, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function dragMove(event) { if (drag?.pointerId === event.pointerId && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true; }
  function dragEnd(event) {
    const original = drag; drag = null;
    if (!original || original.pointerId !== event.pointerId || !original.moved || !owned(original.widget, original.node, original.owner)) return;
    const nodes = Array.from(root.querySelectorAll('[data-widget-id]'));
    const hovered = nodes.find(node => { const bounds = node.getBoundingClientRect(); return event.clientY >= bounds.top && event.clientY <= bounds.bottom && event.clientX >= bounds.left && event.clientX <= bounds.right; });
    let index;
    if (hovered) {
      const targetIndex = nodes.indexOf(hovered), bounds = hovered.getBoundingClientRect();
      const after = hovered.classList.contains('small') ? event.clientX > bounds.left + bounds.width / 2 : event.clientY > bounds.top + bounds.height / 2;
      index = targetIndex + (after ? 1 : 0) - (nodes.indexOf(original.node) < targetIndex + (after ? 1 : 0) ? 1 : 0);
    } else index = nodes.filter(node => node !== original.node && event.clientY > node.getBoundingClientRect().bottom).length;
    void request('reorder', original.widget, { index: Math.max(0, Math.min(widgetState.instances.length - 1, index)) }, {}, original.node);
  }
  function reorderKey(event, widget, index) {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? widgetState.instances.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
    event.preventDefault(); event.stopPropagation(); void request('reorder', widget, { index: Math.max(0, Math.min(widgetState.instances.length - 1, next)) }, {}, event.currentTarget);
  }
  function cityMove(widget, cityId, direction, node) { const cities = [...widget.configuration.cityIds], at = cities.indexOf(cityId), next = at + direction; if (next < 0 || next >= cities.length) return; [cities[at], cities[next]] = [cities[next], cities[at]]; configure(widget, 'cityIds', cities, node); }
  function cityDragStart(event, widget, cityId) {
    if (event.button !== 0 || !owned(widget, event.currentTarget)) return;
    cityDrag = { widget, cityId, node: event.currentTarget, owner: centerId, pointerId: event.pointerId,
      configuration: widget.configuration, order: [...widget.configuration.cityIds], x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function cityDragEnd(event) {
    const original = cityDrag; cityDrag = null;
    if (!original || original.pointerId !== event.pointerId || !owned(original.widget, original.node, original.owner)
      || Math.hypot(event.clientX - original.x, event.clientY - original.y) <= 8
      || original.widget.configuration !== original.configuration
      || original.order.some((cityId, index) => original.widget.configuration.cityIds[index] !== cityId)) return;
    const card = original.node.closest('[data-widget-id]');
    const hovered = [...card.querySelectorAll('[data-widget-city-id]')].find(node => {
      const bounds = node.getBoundingClientRect(); return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    if (!hovered) return;
    const order = [...original.order], from = order.indexOf(original.cityId), to = order.indexOf(hovered.dataset.widgetCityId);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(from, 1); order.splice(to, 0, original.cityId);
    configure(original.widget, 'cityIds', order, original.node);
  }
</script>

<svelte:window onkeydown={event => { if (foreground) option = event.altKey; }} onkeyup={event => { if (foreground) option = event.altKey; }} onblur={() => { option = false; drag = null; cityDrag = null; bodyGesture = null; }} onpointerup={event => { dragEnd(event); cityDragEnd(event); bodyGesture = null; }} onpointercancel={() => { drag = null; cityDrag = null; bodyGesture = null; }} />
<section class="widgets" aria-label="Widgets" bind:this={root}>
  {#each widgetState.instances as widget, index (widget.id)}
    {@const view = widgetPresentation(widgetState, widget, clock)}
    {@const catalog = widgetCatalog.find(item => item.kind === widget.kind)}
    {@const editing = ui.editingWidgetId === widget.id}
    <article class="widget {widget.size} {widget.kind}" class:editing tabindex="-1" data-widget-id={widget.id} data-notification-control={id(widget, 'card')} aria-label={`${view.title}, ${widget.size} widget`}
      oncontextmenu={event => { event.preventDefault(); event.stopPropagation(); void request('context.open', widget, {}, {}, event.currentTarget); }}
      onpointerdown={event => {
        option = event.altKey;
        if (event.button === 0 && event.ctrlKey) {
          event.preventDefault(); event.stopPropagation(); bodyGesture = null; drag = null; cityDrag = null;
          void request('context.open', widget, {}, {}, event.currentTarget);
        } else bodyStart(event, widget);
      }}
      onpointermove={bodyMove} onpointerup={bodyEnd}
      onscroll={event => scrolled(widget, event.currentTarget)}>
      {#if (editing || option) && ui.contextWidgetId !== widget.id}<button class="remove" class:option-remove={!editing} data-notification-control={id(widget, 'remove')} aria-label={`Remove ${view.title} widget`} onclick={() => request('remove', widget)}>−</button>{/if}
      <header><span class="move" role="slider" tabindex="0" data-notification-control={id(widget, 'move')} aria-label={`Position of ${view.title} widget`}
        aria-valuemin="0" aria-valuemax={widgetState.instances.length - 1} aria-valuenow={index} aria-valuetext={`${index + 1} of ${widgetState.instances.length}`} aria-orientation="vertical"
        onpointerdown={event => dragStart(event, widget)} onpointermove={dragMove} onpointerup={dragEnd} onkeydown={event => reorderKey(event, widget, index)}>⋮⋮</span>
        <button class="open" data-notification-control={id(widget, 'open')} onclick={() => request('open', widget)}>{view.title}</button><button class="menu-trigger" data-notification-control={id(widget, 'menu')} aria-label={`Options for ${view.title}`} onclick={() => request('context.open', widget)}>•••</button></header>
      {#if view.date}
        <div class="date-heading"><span>{view.date.weekday}</span><strong>{view.date.day}</strong><span>{view.date.monthLabel}</span></div>
        {#if widget.kind === 'calendar'}<div class="month" aria-label={view.date.label}>{#each ['S','M','T','W','T','F','S'] as day}<b aria-hidden="true">{day}</b>{/each}{#each view.date.monthDays as day}<span class:today={day.today} style:grid-column={day.day === 1 ? day.weekday + 1 : undefined}>{day.day}</span>{/each}</div>{/if}
      {/if}
      {#if widget.kind === 'calendar'}<div class="events">{#each view.events ?? [] as event (event.id)}<button data-notification-control={id(widget, `open:${event.id}`)} style:border-color={event.color} onclick={() => request('open', widget, {}, { recordId: event.id })}><small>{event.time}</small><strong>{event.title}</strong>{#if widget.size === 'large'}<small>{event.location}</small>{/if}</button>{:else}<p class="empty">No upcoming events in selected calendars.</p>{/each}</div>{/if}
      {#if widget.kind === 'reminders'}<h3>{view.list?.name ?? 'No list selected'}</h3><div class="reminders">{#each (view.reminders ?? []).filter(reminder => !reminder.completed) as reminder (reminder.id)}<label><input type="checkbox" checked={reminder.completed} data-notification-control={id(widget, `reminder:${reminder.id}`)} onchange={event => toggleReminder(event, widget, reminder)} /><span>{reminder.title}{#if reminder.dueText}<small>{reminder.dueText}</small>{/if}</span></label>{:else}<p class="empty">No incomplete reminders in this list.</p>{/each}</div>{/if}
      {#if widget.kind === 'weather'}{#if view.weather}<h3>{view.weather.name}</h3><div class="temperature">{view.weather.temperatureText}</div><p>{view.weather.conditionText}<br /><small>H:{view.weather.highText} L:{view.weather.lowText}</small></p>{#if widget.size !== 'small'}<div class="forecast">{#each view.weather.hourly as hour}<div><small>{hour.time}</small><span>{hour.temperatureText}</span></div>{/each}</div>{/if}{#if widget.size === 'large'}<div class="daily">{#each view.weather.daily as day}<div><b>{day.day}</b><span>{day.condition}</span><span>{day.lowText} · {day.highText}</span></div>{/each}</div>{/if}{:else}<p class="empty">No weather location selected.</p>{/if}{/if}
      {#if widget.kind.startsWith('stock-')}<small class="fictional">Fictional market · scene snapshot</small>{#each view.stocks ?? [] as stock (stock.id)}<button class="stock" data-notification-control={id(widget, `open:${stock.id}`)} onclick={() => request('open', widget, {}, { recordId: stock.id })}><strong>{stock.symbol}</strong><span>{stock.priceText}</span><small>{stock.name}</small><small class:negative={stock.change < 0}>{stock.changeText}</small><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label={`${stock.symbol} price history`}><polyline points={stock.points} fill="none" stroke="currentColor" stroke-width="1.8" /></svg></button>{:else}<p class="empty">No symbols selected.</p>{/each}{/if}
      {#if widget.kind.startsWith('clock-')}<div class="clocks">{#each view.clocks ?? [] as city (city.id)}<button class="clock" data-notification-control={id(widget, `open:${city.id}`)} onclick={() => request('open', widget, {}, { recordId: city.id })}><svg viewBox="0 0 100 100" aria-label={`${city.name}, ${city.time}`}><circle cx="50" cy="50" r="47" fill={city.dayNight === 'night' ? '#24252a' : '#faf8f3'} stroke="#aaa" />{#each Array(12) as _, hour}<line x1="50" y1="7" x2="50" y2="12" stroke="#888" transform={`rotate(${hour * 30} 50 50)`} />{/each}<line x1="50" y1="50" x2="50" y2="27" stroke={city.dayNight === 'night' ? '#fff' : '#222'} stroke-width="4" stroke-linecap="round" transform={`rotate(${city.hour * 30 + city.minute / 2} 50 50)`} /><line x1="50" y1="50" x2="50" y2="15" stroke={city.dayNight === 'night' ? '#fff' : '#222'} stroke-width="2.5" stroke-linecap="round" transform={`rotate(${city.minute * 6} 50 50)`} /><circle cx="50" cy="50" r="3" fill="#f18b35" /></svg><strong>{city.name}</strong><small>{city.time}</small></button>{:else}<p class="empty">No cities selected.</p>{/each}</div>{/if}
      {#if ui.contextWidgetId === widget.id}<div class="context" role="group" aria-label="Widget options">{#if widget.kind !== 'date'}<button data-notification-control={id(widget, 'edit')} onclick={() => request('edit.open', widget)}>Edit Widget</button>{/if}{#each catalog.sizes as size}<button data-notification-control={id(widget, `size:${size}`)} aria-pressed={widget.size === size} onclick={() => request('resize', widget, { size })}>{size}</button>{/each}<button data-notification-control={id(widget, 'remove')} onclick={() => request('remove', widget)}>Remove Widget</button><button data-notification-control={id(widget, 'menu-close')} onclick={() => request('context.close', widget)}>Close Options</button></div>{/if}
      {#if editing}<div class="configuration">
        {#if widget.kind === 'calendar'}<label>Calendars<select multiple data-notification-control={id(widget, 'config:calendarIds')} onchange={event => configure(widget, 'calendarIds', selection(event), event.currentTarget)}>{#each widgetState.sources.calendars as item}<option value={item.id} selected={widget.configuration.calendarIds.includes(item.id)}>{item.name}</option>{/each}</select></label>{/if}
        {#if widget.kind === 'weather'}<label>Location<select value={widget.configuration.locationId ?? ''} data-notification-control={id(widget, 'config:locationId')} onchange={event => configure(widget, 'locationId', event.currentTarget.value || null, event.currentTarget)}><option value="">No location</option>{#each widgetState.sources.weather as item}<option value={item.id}>{item.name}</option>{/each}</select></label><label>Units<select value={widget.configuration.unit} data-notification-control={id(widget, 'config:unit')} onchange={event => configure(widget, 'unit', event.currentTarget.value, event.currentTarget)}><option value="celsius">Celsius</option><option value="fahrenheit">Fahrenheit</option></select></label>{/if}
        {#if widget.kind === 'reminders' || widget.kind === 'stock-symbol' || widget.kind === 'clock-city'}{@const field = widget.kind === 'reminders' ? 'listId' : widget.kind === 'stock-symbol' ? 'symbolId' : 'cityId'}{@const rows = widget.kind === 'reminders' ? widgetState.sources.reminderLists : widget.kind === 'stock-symbol' ? widgetState.sources.stocks : widgetState.sources.clockCities}<label>{view.title}<select value={widget.configuration[field] ?? ''} data-notification-control={id(widget, `config:${field}`)} onchange={event => configure(widget, field, event.currentTarget.value || null, event.currentTarget)}><option value="">None selected</option>{#each rows as item}<option value={item.id}>{item.name}</option>{/each}</select></label>{/if}
        {#if widget.kind === 'stock-watchlist' || widget.kind === 'clock-world'}{@const field = widget.kind === 'clock-world' ? 'cityIds' : 'symbolIds'}{@const rows = widget.kind === 'clock-world' ? widgetState.sources.clockCities : widgetState.sources.stocks}<label>{widget.kind === 'clock-world' ? 'Cities (up to four)' : 'Symbols'}<select multiple data-notification-control={id(widget, `config:${field}`)} onchange={event => configure(widget, field, selection(event), event.currentTarget)}>{#each rows as item}<option value={item.id} selected={widget.configuration[field].includes(item.id)}>{item.name}</option>{/each}</select></label>{#if widget.kind === 'clock-world'}{#each widget.configuration.cityIds as cityId, cityIndex}<div class="city-order" data-widget-city-id={cityId}>
          <span class="city-move" role="slider" tabindex="0" data-notification-control={id(widget, `config:cityIds:drag:${cityId}`)} aria-label={`Position of ${rows.find(city => city.id === cityId)?.name}`}
            aria-valuemin="0" aria-valuemax={widget.configuration.cityIds.length - 1} aria-valuenow={cityIndex} aria-orientation="vertical"
            onpointerdown={event => cityDragStart(event, widget, cityId)}
            onkeydown={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); cityMove(widget, cityId, event.key === 'ArrowUp' ? -1 : 1, event.currentTarget); } }}>⋮⋮</span>
          <span>{rows.find(city => city.id === cityId)?.name}</span><button disabled={cityIndex === 0} data-notification-control={id(widget, `config:cityIds:up:${cityId}`)} aria-label="Move city earlier" onclick={event => cityMove(widget, cityId, -1, event.currentTarget)}>↑</button><button disabled={cityIndex === widget.configuration.cityIds.length - 1} data-notification-control={id(widget, `config:cityIds:down:${cityId}`)} aria-label="Move city later" onclick={event => cityMove(widget, cityId, 1, event.currentTarget)}>↓</button></div>{/each}{/if}{/if}
        <button data-notification-control={id(widget, 'done')} onclick={() => request('edit.close', widget)}>Done</button>
      </div>{/if}
    </article>
  {:else}<p class="no-widgets">No widgets added. Choose Edit Widgets to add one.</p>{/each}
</section>

<style>
  .widgets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px;align-items:start}.widget{position:relative;min-width:0;min-height:156px;max-height:190px;overflow:auto;padding:14px;border-radius:24px;background:color-mix(in srgb,var(--appearance-surface,#fff) 92%,transparent);box-shadow:0 4px 16px #0002;color:var(--appearance-ink,#252529);border:1px solid var(--appearance-light-edge,#fff8);scrollbar-width:thin}.medium,.large{grid-column:1/-1}.medium{max-height:210px}.large{min-height:310px;max-height:380px}.editing{max-height:560px}header{display:flex;gap:5px;align-items:center;margin-bottom:8px}button,select,input{font:inherit;color:inherit}button{border:0;background:transparent;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible,.widget:focus-visible{outline:2px solid var(--appearance-focus,#0878ef);outline-offset:2px}.open{font-size:11px;font-weight:650;text-align:left;padding:0;flex:1}.menu-trigger{font-size:10px;opacity:.65}.date-heading{display:flex;flex-direction:column}.date-heading>span:first-child{color:#e45143;font-size:12px}.date-heading strong{font-size:46px;line-height:1.1;font-weight:400}.date-heading span:last-child{font-size:11px;opacity:.7}.calendar .date-heading{float:left;margin-right:16px}.month{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;font-size:10px;max-width:180px;margin-left:auto}.month b{font-size:9px;opacity:.5}.today{border-radius:50%;background:#e94b44;color:white}.events{clear:both;padding-top:8px}.events button{display:flex;flex-direction:column;text-align:left;border-left:3px solid;padding:3px 8px;margin-bottom:7px;width:100%}small{font-size:10px;opacity:.7}.events strong{font-size:12px}h3{font-size:15px;margin:4px 0 10px}.empty{font-size:12px;opacity:.65;margin:12px 0;line-height:1.5}.no-widgets{grid-column:1/-1;text-align:center;font-size:12px;opacity:.65}.reminders label{display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid #8882;font-size:12px}.reminders input{accent-color:#f49d27}.reminders small{display:block}.weather{background:linear-gradient(150deg,#286eaf,#75aad2);color:#fff}.temperature{font-size:42px;font-weight:300;line-height:1}.weather p{margin:4px 0}.forecast{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #fff4;padding-top:10px;margin-top:8px}.forecast div{display:flex;flex-direction:column;gap:7px;text-align:center;font-size:12px}.daily{margin-top:12px}.daily>div{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:5px 0;border-top:1px solid #fff3}.fictional{font-size:9px;display:block;margin-bottom:7px}.stock{display:grid;grid-template-columns:1fr 1fr;text-align:left;width:100%;gap:3px;margin-bottom:8px}.stock>span,.stock>small:nth-of-type(2){text-align:right}.stock svg{grid-column:1/-1;width:100%;height:35px;color:#34ad72}.negative{color:#e86969}.clocks{display:flex;justify-content:space-around;gap:10px}.clock{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;padding:0;flex:1}.clock svg{width:100%;max-width:110px}.clock strong{font-size:10px;overflow-wrap:anywhere}.clock small{font-size:9px}.remove{position:absolute;left:0;top:0;border-radius:50%;width:23px;height:23px;background:var(--appearance-panel,#eee);box-shadow:0 1px 4px #0004;z-index:2;font-size:20px}.context,.configuration{position:relative;margin-top:12px;padding:10px;border-radius:12px;background:var(--appearance-panel,#ececf0);color:var(--appearance-ink,#222);display:flex;flex-direction:column;gap:7px}.context button,.configuration>button{padding:6px;border-radius:7px;background:#8882;text-align:left}.context button[aria-pressed=true]{background:var(--appearance-focus,#0878ef);color:white}.configuration label{display:flex;flex-direction:column;gap:4px;font-size:11px}.configuration select{width:100%;min-width:0;border:1px solid #8885;border-radius:5px;background:var(--appearance-surface,#fff);padding:4px}.city-order{display:flex;align-items:center;gap:8px;font-size:11px}.city-order span{flex:1}.city-order button{background:#8882;border-radius:4px}.city-order button:disabled{opacity:.3}
  .option-remove { visibility:hidden; }
  .widget:hover > .option-remove,.option-remove:focus-visible { visibility:visible; }
  .move,.city-move { cursor:grab; touch-action:none; user-select:none; font-size:12px; opacity:.55; border-radius:5px; }
  .move:focus-visible,.city-move:focus-visible { outline:2px solid var(--appearance-focus,#0878ef); outline-offset:2px; }
  .city-order .city-move { flex:0 0 20px; }
</style>

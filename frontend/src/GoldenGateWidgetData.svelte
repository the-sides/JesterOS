<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { widgetPresentation, widgetDataScope } from './notification-widget-model.js';
  let { windowId, appId, state: widgetState, clock, foreground = true, execute, registerView } = $props();
  let panel = $state(null), error = $state(null);
  let observedScope = null, observedScroll = { top: 0, left: 0 };
  const scope = $derived(widgetDataScope(appId, widgetState.selected));
  $effect(() => { const currentScope = scope; if (panel && currentScope !== observedScope) {
    observedScope = currentScope; panel.scrollTop = 0; panel.scrollLeft = 0; observedScroll = { top: 0, left: 0 };
  } });
  let disposed = false;
  const lease = () => ({ windowId, appId, panel });
  const current = owner => !disposed && owner.windowId === windowId && owner.appId === appId && owner.panel === panel && panel?.dataset.widgetDataWindowId === windowId;
  function mounted(node) { if (!foreground || !panel?.isConnected || !node?.isConnected || !panel.contains(node) || panel.clientWidth <= 0 || panel.clientHeight <= 0) return false; for (let parent = node; parent; parent = parent.parentElement) { const style = parent.ownerDocument.defaultView.getComputedStyle(parent); if (parent.hidden || parent.inert || style.display === 'none' || ['hidden','collapse'].includes(style.visibility) || style.opacity === '0') return false; } return true; }
  const available = () => current(lease()) && mounted(panel);
  const nodes = () => available() ? [panel, ...panel.querySelectorAll('[data-widget-data-control]')].filter(node => mounted(node) && !node.disabled) : [];
  const control = id => nodes().find(node => node.dataset.widgetDataControl === id);
  const valid = (owner, guard) => current(owner) && available() && (typeof guard !== 'function' || guard() === true);
  const position = () => ({ top: panel?.scrollTop ?? 0, left: panel?.scrollLeft ?? 0 });
  function describe() { const all = nodes(); observedScroll = position(); return { controlIds: all.map(node => node.dataset.widgetDataControl), focusedControl: all.find(node => node.ownerDocument.activeElement === node)?.dataset.widgetDataControl ?? null, scroll: { ...observedScroll } }; }
  async function prepare(id, guard) { const owner = lease(), node = control(id), reminder = id.startsWith('reminder:') ? widgetState.sources.reminders.find(row => `reminder:${row.id}` === id) : null; if (!node || !valid(owner, guard)) return false; await tick(); return valid(owner, guard) && node === control(id) && (!reminder || widgetState.sources.reminders.includes(reminder)); }
  async function focus(id, guard) { const owner = lease(), node = control(id); if (!node || !valid(owner, guard)) return false; await tick(); if (!valid(owner, guard) || node !== control(id)) return false; node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (!valid(owner, guard) || node !== control(id)) return false; node.focus({ preventScroll: true }); observedScroll = position(); return valid(owner, guard) && node.ownerDocument.activeElement === node; }
  async function scroll(offsets, guard) { const owner = lease(); if (!valid(owner, guard) || !Number.isFinite(offsets?.top) || !Number.isFinite(offsets?.left) || offsets.top < 0 || offsets.left < 0 || offsets.top > Number.MAX_SAFE_INTEGER || offsets.left > Number.MAX_SAFE_INTEGER) return null; await tick(); if (!valid(owner, guard)) return null; owner.panel.scrollTop = offsets.top; owner.panel.scrollLeft = offsets.left; observedScroll = position(); return valid(owner, guard) ? { ...observedScroll } : null; }
  onMount(() => registerView({ available, describe, prepare, focus, scroll }));
  onDestroy(() => { disposed = true; registerView(null); });
  async function toggle(event, reminder) {
    const owner = lease(), node = event.currentTarget;
    const original = widgetState.sources.reminders.find(row => row.id === reminder.id);
    if (!original || !valid(owner) || control(`reminder:${reminder.id}`) !== node) return;
    let result;
    try {
      result = await execute('widgets.data.reminder.setCompleted', { windowId: owner.windowId, reminderId: original.id }, { completed: node.checked });
      if (current(owner) && panel.contains(node) && widgetState.sources.reminders.includes(original))
        error = result.status === 'rejected' ? result.error.message : null;
    } catch (cause) { if (current(owner)) error = cause?.message ?? 'Reminder request failed.'; }
    if (result?.status !== 'applied' && current(owner) && panel.contains(node) && widgetState.sources.reminders.includes(original))
      node.checked = original.completed;
  }
  async function scrollChanged() {
    const owner = lease(), actual = position();
    if (!valid(owner) || actual.top === observedScroll.top && actual.left === observedScroll.left) return;
    observedScroll = actual;
    const result = await execute('widgets.data.scroll', { windowId: owner.windowId }, actual);
    if (current(owner)) error = result.status === 'rejected' ? result.error.message : null;
  }
  const event = $derived(widgetState.sources.events.find(row => row.id === widgetState.selected.calendarEventId));
  const kind = $derived(appId === 'calendar' ? 'calendar' : appId === 'weather' ? 'weather' : appId === 'reminders' ? 'reminders' : appId === 'stocks' ? 'stock-symbol' : 'clock-world');
  const configuration = $derived(appId === 'calendar' ? { calendarIds: event ? [event.calendarId] : widgetState.sources.calendars.map(row => row.id) } : appId === 'weather' ? { locationId: widgetState.selected.weatherLocationId, unit: 'celsius' } : appId === 'reminders' ? { listId: widgetState.selected.reminderListId } : appId === 'stocks' ? { symbolId: widgetState.selected.stockSymbolId } : { cityIds: widgetState.selected.clockCityIds });
  const view = $derived(widgetPresentation(widgetState, { id: 'selected-data', kind, size: appId === 'stocks' || appId === 'clock' ? 'medium' : 'large', configuration }, clock));
  const title = $derived(appId === 'calendar' ? 'Calendar' : appId === 'weather' ? 'Weather' : appId === 'reminders' ? 'Reminders' : appId === 'stocks' ? 'Stocks' : 'World Clock');
  const eventFormat = $derived(new Intl.DateTimeFormat('en-US', { timeZone: clock.timeZone, dateStyle: 'full', timeStyle: 'short' }));
</script>
<div class="data" role="region" aria-label={`${appId} scene data`} data-widget-data-window-id={windowId} data-widget-data-scope={scope} data-widget-data-control="panel" tabindex="-1" bind:this={panel} onscroll={scrollChanged}>
  <header><small>{title}</small><h1>{appId === 'calendar' ? event?.title ?? view.date?.label ?? 'Calendar' : appId === 'reminders' ? view.list?.name ?? 'No list selected' : appId === 'weather' ? view.weather?.name ?? 'No location selected' : appId === 'stocks' ? view.stocks?.[0]?.name ?? 'No symbol selected' : 'World Clock'}</h1><p>Shared widget data · scene snapshot</p></header>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if appId === 'calendar'}
    {#if event}<dl><dt>Calendar</dt><dd>{widgetState.sources.calendars.find(row => row.id === event.calendarId)?.name}</dd><dt>Starts</dt><dd>{event.allDay ? 'All day · ' : ''}{eventFormat.format(new Date(event.start))}</dd><dt>Ends</dt><dd>{eventFormat.format(new Date(event.end))}</dd><dt>Location</dt><dd>{event.location || 'No location'}</dd></dl>
    {:else}
      {#if view.date}<h2>{view.date.monthLabel} {view.date.year}</h2><div class="month" aria-label={view.date.label}>
        {#each ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as day}<b>{day}</b>{/each}
        {#each view.date.monthDays as day}<span class:today={day.today} style:grid-column={day.day === 1 ? day.weekday + 1 : undefined}>{day.day}</span>{/each}
      </div>{/if}
      <h2>Upcoming scene events</h2>
      {#each view.events ?? [] as item}<p><strong>{item.title}</strong><br />{eventFormat.format(new Date(item.start))} · {item.location || 'No location'}</p>
      {:else}<p class="empty">No upcoming events in the scene calendars.</p>{/each}
    {/if}
  {:else if appId === 'reminders'}<div class="checklist">{#each view.reminders ?? [] as reminder (reminder.id)}<label><input type="checkbox" checked={reminder.completed} data-widget-data-control={`reminder:${reminder.id}`} onchange={event => toggle(event, reminder)} /><span class:completed={reminder.completed}>{reminder.title}{#if reminder.dueText}<small>{reminder.dueText}</small>{/if}</span></label>{:else}<p class="empty">No reminders in the selected list.</p>{/each}</div>
  {:else if appId === 'weather'}{#if view.weather}<div class="weather-current"><strong>{view.weather.temperatureText}</strong><span>{view.weather.conditionText}<br />H:{view.weather.highText} L:{view.weather.lowText}</span></div><h2>Hourly forecast</h2><div class="hours">{#each view.weather.hourly as hour}<div><small>{hour.time}</small><strong>{hour.temperatureText}</strong><small>{hour.condition}</small></div>{/each}</div><h2>Daily forecast</h2><div class="days">{#each view.weather.daily as day}<div><b>{day.day}</b><span>{day.condition}</span><span>{day.lowText} — {day.highText}</span></div>{/each}</div>{:else}<p class="empty">Open a configured Weather widget to view its forecast.</p>{/if}
  {:else if appId === 'stocks'}{#each view.stocks ?? [] as stock (stock.id)}<p class="fictional">Fictional market data, not live quotes or investment information.</p><div class="quote"><strong>{stock.symbol}</strong><b>{stock.priceText}</b><span>{stock.changeText}</span></div><svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label={`${stock.symbol} price history`}><polyline points={stock.points} fill="none" stroke="currentColor" stroke-width="1" /></svg><dl><dt>Currency</dt><dd>{stock.currency}</dd><dt>Previous close</dt><dd>{stock.previousClose}</dd><dt>Change</dt><dd>{stock.percent.toFixed(2)}%</dd></dl>{:else}<p class="empty">Open a stock symbol widget to view its quote.</p>{/each}
  {:else if appId === 'clock'}<div class="cities">{#each view.clocks ?? [] as city (city.id)}<section><svg viewBox="0 0 100 100" aria-label={`${city.name}, ${city.time}`}><circle cx="50" cy="50" r="47" fill={city.dayNight === 'night' ? '#25262b' : '#faf8f3'} stroke="#999"/>{#each Array(12) as _, hour}<line x1="50" y1="7" x2="50" y2="12" stroke="#999" transform={`rotate(${hour * 30} 50 50)`}/>{/each}<line x1="50" y1="50" x2="50" y2="27" stroke={city.dayNight === 'night' ? '#fff' : '#222'} stroke-width="4" transform={`rotate(${city.hour * 30 + city.minute / 2} 50 50)`}/><line x1="50" y1="50" x2="50" y2="14" stroke={city.dayNight === 'night' ? '#fff' : '#222'} stroke-width="2.5" transform={`rotate(${city.minute * 6} 50 50)`}/><circle cx="50" cy="50" r="3" fill="#f18b35"/></svg><h2>{city.name}</h2><strong>{city.time}</strong><small>{city.dateLabel}</small></section>{:else}<p class="empty">No cities selected. Open a configured Clock widget.</p>{/each}</div>{/if}
</div>
<style>
.data{box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;overflow:auto;padding:22px 28px;background:var(--appearance-surface,#fafafc);color:var(--appearance-ink,#252529);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;scrollbar-width:thin}.data:focus-visible,input:focus-visible{outline:2px solid var(--appearance-focus,#0878ef);outline-offset:-2px}header{margin-bottom:22px}header>small{text-transform:uppercase;letter-spacing:.08em;font-size:10px;opacity:.6}h1{margin:7px 0;font-size:27px;font-weight:550;overflow-wrap:anywhere}header p{font-size:11px;opacity:.6;margin:0}h2{font-size:14px;margin:22px 0 12px}dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;line-height:1.5}dt{opacity:.6}dd{margin:0;overflow-wrap:anywhere}.checklist{max-width:650px}.checklist label{display:flex;align-items:flex-start;gap:10px;padding:13px 0;border-bottom:1px solid #8883}.checklist input{accent-color:#ee9c24}.checklist small{display:block;opacity:.6;font-size:11px;margin-top:4px}.completed{text-decoration:line-through;opacity:.5}.weather-current{display:flex;align-items:center;gap:22px}.weather-current strong{font-size:64px;font-weight:300}.weather-current span{line-height:1.8}.hours{display:flex;gap:12px;flex-wrap:wrap;padding-bottom:10px}.hours>div{display:flex;flex-direction:column;gap:10px;align-items:center;min-width:65px;padding:12px 8px;border-radius:13px;background:#8881}.hours small{font-size:10px}.days>div{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #8882}.fictional{font-size:11px;opacity:.6}.quote{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.quote strong{font-size:24px}.quote b{font-size:30px;font-weight:400}.quote span{color:#2d9d6d}.chart{color:#2d9d6d;width:100%;height:150px;margin:20px 0}.cities{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:20px}.cities section{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center}.cities svg{width:100%;max-width:150px}.cities h2{margin:5px 0}.cities small{opacity:.6;font-size:10px}.empty{opacity:.6;line-height:1.6}.error{color:#d14d43}.month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;text-align:center;max-width:420px;margin-bottom:24px}.month b{font-size:10px;opacity:.6}.month span{padding:6px;border-radius:50%}.today{background:#e94b44;color:#fff}@media(max-width:420px){.data{padding:12px 16px}h1{font-size:21px}header{margin-bottom:12px}dl{grid-template-columns:80px 1fr;font-size:12px}.weather-current strong{font-size:45px}.days>div{font-size:11px}.cities{gap:12px}.month{gap:4px}}
</style>

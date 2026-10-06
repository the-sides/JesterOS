<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { dashboardWidgetTargets, dashboardWidgetTypes } from './dashboard-widgets.js';

  let { profile, state: dashboard, sceneRect, execute } = $props();
  let root = $state();
  let board = $state();
  let content = $state();
  let geometry = $state(null);
  let drag = $state(null);
  const view = $derived(dashboard.view);
  const widgets = $derived(dashboard.widgets.map(widget => ({ widget, target: dashboardWidgetTargets(widget, dashboard.sceneTime) })));
  // Native-sized, authored skins remain legible on small scenes: the board scrolls instead of shrinking controls.
  const sizes = { clock: [180, 210], calculator: [220, 260], calendar: [260, 250], weather: [300, 230], converter: [340, 180] };
  const names = { clock: 'World Clock', calculator: 'Calculator', calendar: 'Calendar', weather: 'Weather', converter: 'Unit Converter' };
  const keyLabels = { sign: '+/−', backspace: '⌫', add: '+', subtract: '−', multiply: '×', divide: '÷', equals: '=', mc: 'MC', mr: 'MR', 'm+': 'M+', 'm-': 'M−' };
  const keypad = ['C', '%', 'backspace', 'divide', '7', '8', '9', 'multiply', '4', '5', '6', 'subtract', '1', '2', '3', 'add', 'sign', '0', '.', 'equals'];
  const extent = $derived({
    width: Math.max(900, ...dashboard.widgets.map(widget => widget.x + sizes[widget.type][0] + 24)),
    height: Math.max(590, ...dashboard.widgets.map(widget => widget.y + sizes[widget.type][1] + 24))
  });
  let disposed = false;
  let observing = 0;
  let gesture = null;
  let suppressedClickUntil = 0;
  let measureGeometry = () => {};
  let selectionPending = null;
  let selectionLatest = null;
  const scrollQueue = { frame: 0, pending: null, latest: null };
  let pending = Promise.resolve();
  const request = (command, target = {}, payload = {}, nativeScroll = false) => {
    const lifecycle = dashboard.view;
    const result = pending.then(() => available() && dashboard.view === lifecycle
      ? execute({ command, target, payload: nativeScroll ? scrollPosition() : payload }) : null);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const shell = (name, target = {}, payload = {}) => request(`shell.dashboard.${name}`, target, payload);
  const domain = (widgetId, type, name, payload = {}) => request(`dashboard.${type}.${name}`, { widgetId }, payload);
  const controlId = (id, field) => `control:${id}:${field}`;

  function laidOut(node) {
    if (!node?.isConnected || node.closest('[inert]') || !node.getClientRects().length) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }
  export function available() {
    return Boolean(!disposed && dashboard.view && geometry?.width > 0 && geometry?.height > 0 && laidOut(root) && laidOut(board) && laidOut(content));
  }
  function controls() {
    return available() ? [...root.querySelectorAll('[data-dashboard-item-id]')].filter(node => !node.disabled && laidOut(node)) : [];
  }
  const control = itemId => controls().find(node => node.dataset.dashboardItemId === itemId);
  const widgetNode = widgetId => [...(content?.querySelectorAll('[data-dashboard-widget-id]') ?? [])].find(node => node.dataset.dashboardWidgetId === widgetId);
  export function itemIds() { return controls().map(node => node.dataset.dashboardItemId); }
  export function focusedItemId() { return controls().find(node => node === document.activeElement)?.dataset.dashboardItemId ?? null; }
  function physicalRect(node) {
    const box = node.getBoundingClientRect(), x = box.left + window.scrollX, y = box.top + window.scrollY;
    return { x, y, left: x, top: y, right: x + box.width, bottom: y + box.height, width: box.width, height: box.height };
  }
  export function bounds() {
    return available() ? { ...physicalRect(root), board: physicalRect(board), content: physicalRect(content),
      controls: controls().map(node => ({ itemId: node.dataset.dashboardItemId, ...physicalRect(node) })),
      widgets: [...content.querySelectorAll('[data-dashboard-widget-id]')].filter(laidOut).map(node => ({ widgetId: node.dataset.dashboardWidgetId, ...physicalRect(node) })) } : null;
  }
  export function scrollPosition() { return available() ? { top: board.scrollTop, left: board.scrollLeft } : null; }
  export async function prepare() {
    await tick();
    if (disposed || !dashboard.view) return;
    measureGeometry();
    await tick();
  }
  function clip() {
    const box = board.getBoundingClientRect();
    return { left: Math.max(box.left, geometry.x), top: Math.max(box.top, geometry.y),
      right: Math.min(box.left + board.clientWidth, geometry.x + geometry.width),
      bottom: Math.min(box.top + board.clientHeight, geometry.y + geometry.height) };
  }
  function reveal(node) {
    if (!board.contains(node)) return;
    const box = node.getBoundingClientRect(), area = clip();
    board.scrollTop += box.top < area.top ? box.top - area.top : box.bottom > area.bottom ? box.bottom - area.bottom : 0;
    board.scrollLeft += box.left < area.left ? box.left - area.left : box.right > area.right ? box.right - area.right : 0;
  }
  export async function focus(itemId) {
    await prepare();
    if (!available()) return false;
    const node = control(itemId), owner = root, lifecycle = dashboard.view;
    if (!node) return false;
    observing++;
    try {
      reveal(node);
      await tick();
      if (!available() || root !== owner || dashboard.view !== lifecycle || control(itemId) !== node) return false;
      if (document.activeElement !== node) node.focus({ preventScroll: true });
      await tick();
      if (!available() || root !== owner || dashboard.view !== lifecycle || control(itemId) !== node || document.activeElement !== node) return false;
      const box = node.getBoundingClientRect(), area = board.contains(node) ? clip() : geometry;
      const right = area.right ?? area.x + area.width, bottom = area.bottom ?? area.y + area.height;
      return box.left >= (area.left ?? area.x) - .5 && box.top >= (area.top ?? area.y) - .5 && box.right <= right + .5 && box.bottom <= bottom + .5;
    } finally { observing--; }
  }
  export async function scroll(top, left) {
    await prepare();
    if (!available() || !Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0) return null;
    const owner = root, pane = board, lifecycle = dashboard.view;
    observing++;
    try {
      pane.scrollTo({ top, left, behavior: 'instant' });
      await tick();
      return available() && root === owner && board === pane && dashboard.view === lifecycle ? scrollPosition() : null;
    } finally { observing--; }
  }
  export function widgetPosition(widgetId, x, y) {
    if (!available() || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const node = widgetNode(widgetId);
    if (!laidOut(node) || !dashboard.widgets.some(widget => widget.id === widgetId)) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.max(0, Math.min(x, content.clientWidth - box.width)), y: Math.max(0, Math.min(y, content.clientHeight - box.height)) };
  }

  $effect(() => {
    const owner = root;
    sceneRect.x; sceneRect.y; sceneRect.width; sceneRect.height; profile.renderer;
    if (!owner) return;
    let cancelled = false;
    const ancestors = [];
    for (let node = owner.parentElement; node; node = node.parentElement) ancestors.push(node);
    function measure() {
      if (cancelled || disposed || !dashboard.view || root !== owner || !owner.isConnected) return;
      const origin = owner.getBoundingClientRect(), viewport = window.visualViewport;
      let x = Math.max(origin.left, viewport?.offsetLeft ?? 0), y = Math.max(origin.top, viewport?.offsetTop ?? 0);
      let right = Math.min(origin.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth));
      let bottom = Math.min(origin.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight));
      for (const node of ancestors) {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) { x = Math.max(x, box.left); right = Math.min(right, box.right); }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) { y = Math.max(y, box.top); bottom = Math.min(bottom, box.bottom); }
      }
      const width = Math.max(0, right - x), height = Math.max(0, bottom - y);
      const next = { x, y, width, height, localX: x - origin.left, localY: y - origin.top };
      if (!geometry || Object.keys(next).some(key => geometry[key] !== next[key])) geometry = next;
    }
    measureGeometry = measure;
    const observer = new ResizeObserver(measure);
    for (const node of [owner, ...ancestors]) observer.observe(node);
    measure();
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelled = true; observer.disconnect();
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure);
      if (measureGeometry === measure) measureGeometry = () => {};
    };
  });
  let initialPane = null, initialView = null;
  $effect(() => {
    const snapshot = dashboard.view, pane = board, layout = geometry;
    const { top, left } = untrack(() => snapshot?.scroll ?? { top: 0, left: 0 });
    extent.width; extent.height; snapshot?.library;
    let cancelled = false;
    tick().then(() => {
      if (cancelled || !available() || dashboard.view !== snapshot || board !== pane || geometry !== layout) return;
      if (initialPane !== pane || initialView !== snapshot) {
        observing++;
        try { pane.scrollTo({ top, left, behavior: 'instant' }); } finally { observing--; }
        initialPane = pane; initialView = snapshot;
      }
      observeScroll();
    });
    return () => { cancelled = true; };
  });
  function observeScroll() {
    if (!available() || observing) return;
    const actual = scrollPosition(), canonical = dashboard.view.scroll;
    if (actual.top === canonical.top && actual.left === canonical.left) return;
    scrollQueue.latest = actual;
    if (!scrollQueue.frame && !scrollQueue.pending) scrollQueue.frame = requestAnimationFrame(() => { scrollQueue.frame = 0; flushScroll(); });
  }
  function flushScroll() {
    if (!available() || scrollQueue.pending || !scrollQueue.latest) { if (!available()) scrollQueue.latest = null; return; }
    const actual = scrollPosition(), owner = root, lifecycle = dashboard.view;
    scrollQueue.latest = null;
    if (actual.top === lifecycle.scroll.top && actual.left === lifecycle.scroll.left) return;
    const pending = request('shell.dashboard.scroll', {}, actual, true);
    scrollQueue.pending = pending;
    pending.then(finish, finish);
    function finish() {
      if (scrollQueue.pending !== pending) return;
      scrollQueue.pending = null;
      if (!available() || root !== owner || dashboard.view !== lifecycle) { scrollQueue.latest = null; return; }
      if (scrollQueue.latest) {
        flushScroll();
      } else observeScroll();
    }
  }
  function select(itemId) {
    if (!available() || observing || !control(itemId) || dashboard.view.selectedItemId === itemId) return;
    if (selectionPending) { selectionLatest = itemId; return; }
    const owner = root, lifecycle = dashboard.view;
    const pending = Promise.resolve(shell('select', { itemId }));
    selectionPending = pending;
    pending.then(finish, finish);
    function finish() {
      if (selectionPending !== pending) return;
      selectionPending = null;
      const next = selectionLatest; selectionLatest = null;
      if (next && available() && root === owner && dashboard.view === lifecycle) select(next);
    }
  }
  function observeFocus(event) {
    const node = event.target.closest?.('[data-dashboard-item-id]');
    if (node && root?.contains(node)) select(node.dataset.dashboardItemId);
  }
  function configure(widgetId) { shell('configure', { widgetId }); }
  function close() { shell('close', {}, { restoreFocus: true }); }
  function keydown(event) {
    if (!available() || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (gesture) { cancelGesture(); return; }
      if (dashboard.view.configWidgetId) configure(null);
      else if (dashboard.view.library) shell('setLibrary', {}, { open: false });
      else if (dashboard.view.editing) shell('setEditing', {}, { editing: false });
      else close();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    const node = event.target.closest?.('[data-dashboard-widget-id]');
    const widget = dashboard.widgets.find(widget => widget.id === node?.dataset.dashboardWidgetId);
    if (widget?.type !== 'calculator' || ['Enter', ' '].includes(event.key) && event.target.closest?.('button:not([data-dashboard-drag])')) return;
    const key = /^\d$/.test(event.key) ? event.key : ({ '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '=': 'equals', Enter: 'equals', Backspace: 'backspace', Delete: 'C', '.': '.', '%': '%', ',': '.' }[event.key]);
    if (key) { event.preventDefault(); domain(widget.id, 'calculator', 'key', { key }); }
  }
  function pointerdown(event) {
    if (!available() || gesture || event.button !== 0 || !event.isPrimary || event.metaKey || event.ctrlKey) return;
    const handle = event.target.closest?.('[data-dashboard-drag]');
    if (!handle || !root.contains(handle)) return;
    const widgetId = handle.dataset.dashboardDrag, widget = dashboard.widgets.find(widget => widget.id === widgetId);
    if (!widget || dashboard.view.configWidgetId === widgetId) return;
    const node = widgetNode(widgetId), box = node.getBoundingClientRect(), base = content.getBoundingClientRect();
    gesture = { owner: root, lifecycle: dashboard.view, widgetId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: box.left - base.left, y: box.top - base.top, scrollTop: board.scrollTop, scrollLeft: board.scrollLeft, dragging: false };
    suppressedClickUntil = 0;
    try { root.setPointerCapture(event.pointerId); } catch { cancelGesture(); }
  }
  function gestureLive(active) {
    return available() && gesture === active && root === active.owner && dashboard.view === active.lifecycle && dashboard.widgets.some(widget => widget.id === active.widgetId);
  }
  function pointermove(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!gestureLive(active)) { cancelGesture(); return; }
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    if (!active.dragging && Math.hypot(dx, dy) < 4) return;
    active.dragging = true; event.preventDefault();
    const planned = widgetPosition(active.widgetId, active.x + dx + board.scrollLeft - active.scrollLeft, active.y + dy + board.scrollTop - active.scrollTop);
    if (planned) drag = { widgetId: active.widgetId, ...planned };
  }
  function pointerup(event) {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    const area = available() ? clip() : null;
    const planned = drag;
    const commit = gestureLive(active) && active.dragging && planned && area && event.clientX >= area.left && event.clientX <= area.right && event.clientY >= area.top && event.clientY <= area.bottom;
    if (active.dragging) suppressedClickUntil = performance.now() + 500;
    cancelGesture();
    if (commit) request('dashboard.widget.move', { widgetId: active.widgetId }, { x: planned.x, y: planned.y });
  }
  function cancelGesture() {
    const active = gesture; gesture = null; drag = null;
    if (active?.owner.hasPointerCapture(active.pointerId)) active.owner.releasePointerCapture(active.pointerId);
  }
  function pointercancel(event) { if (gesture?.pointerId === event.pointerId) cancelGesture(); }
  function background() { if (available() && dashboard.mode === 'overlay' && performance.now() >= suppressedClickUntil) close(); }
  function converterChange(widgetId, field, value) {
    if (!available()) return;
    const widget = dashboard.widgets.find(widget => widget.id === widgetId);
    if (widget?.type !== 'converter') return;
    const target = dashboardWidgetTargets(widget, dashboard.sceneTime);
    const payload = { category: target.category, fromUnit: target.fromUnit, toUnit: target.toUnit, value: target.value, [field]: value };
    if (field === 'category') {
      const category = target.categories.find(category => category.id === value);
      if (!category) return;
      payload.fromUnit = category.units[0].id; payload.toUnit = category.units[Math.min(1, category.units.length - 1)].id;
    }
    domain(widgetId, 'converter', 'change', payload);
  }
  function swap(widgetId) {
    if (!available()) return;
    const widget = dashboard.widgets.find(widget => widget.id === widgetId);
    if (widget?.type !== 'converter') return;
    const target = dashboardWidgetTargets(widget, dashboard.sceneTime);
    domain(widgetId, 'converter', 'change', { category: target.category, fromUnit: target.toUnit, toUnit: target.fromUnit, value: target.value });
  }
  function conditionGlyph(condition, dayNight = 'day') { return /rain|shower/i.test(condition) ? '☂' : /cloud|overcast/i.test(condition) ? '☁' : dayNight === 'night' ? '☾' : '☀'; }
  onDestroy(() => {
    disposed = true; cancelGesture();
    if (scrollQueue.frame) cancelAnimationFrame(scrollQueue.frame);
    scrollQueue.latest = null; selectionLatest = null;
  });
</script>

<svelte:window onblur={cancelGesture} />

<div bind:this={root} data-dashboard data-dashboard-mode={dashboard.mode} class:space={dashboard.mode === 'space'}
  role="dialog" aria-modal="true" aria-label="Dashboard" tabindex="-1" onkeydown={keydown} onfocusin={observeFocus}
  style:left={`${sceneRect.x}px`} style:top={`${sceneRect.y}px`} style:width={`${sceneRect.width}px`} style:height={`${sceneRect.height}px`}
  onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointercancel} onlostpointercapture={pointercancel}>
  <div class="viewport" style:left={`${geometry?.localX ?? 0}px`} style:top={`${geometry?.localY ?? 0}px`}
    style:width={`${geometry?.width ?? 0}px`} style:height={`${geometry?.height ?? 0}px`}>
    <div bind:this={board} data-dashboard-board class="board" onscroll={observeScroll}>
      <div bind:this={content} class="board-content" style:width={`${extent.width}px`} style:height={`${extent.height + (view?.library ? 188 : 0)}px`}>
        {#if dashboard.mode === 'overlay'}<button class="board-background" tabindex="-1" aria-label="Return from Dashboard" onfocus={() => select('close')} onclick={background}></button>{/if}
        {#each widgets as { widget, target } (widget.id)}
          {@const back = view?.configWidgetId === widget.id}
          <section class={`widget ${widget.type}`} class:dragging={drag?.widgetId === widget.id} class:back
            class:selected={view?.selectedItemId === `widget:${widget.id}` || view?.selectedItemId === `configure:${widget.id}` || view?.selectedItemId === `delete:${widget.id}` || view?.selectedItemId?.startsWith(`control:${widget.id}:`)}
            data-dashboard-widget-id={widget.id} aria-label={`${names[widget.type]} widget`}
            style:left={`${drag?.widgetId === widget.id ? drag.x : widget.x}px`}
            style:top={`${drag?.widgetId === widget.id ? drag.y : widget.y}px`}
            style:width={`${sizes[widget.type][0]}px`} style:height={`${sizes[widget.type][1]}px`}>
            {#if view?.editing}
              <button class="delete-widget" data-dashboard-item-id={`delete:${widget.id}`} aria-label={`Remove ${names[widget.type]}`} title={`Remove ${names[widget.type]}`}
                onclick={() => request('dashboard.widget.remove', { widgetId: widget.id })}>×</button>
            {/if}
            {#if back && (widget.type === 'clock' || widget.type === 'weather')}
              <button class="drag-title config-title" data-dashboard-item-id={`widget:${widget.id}`} title={names[widget.type]} onclick={() => select(`widget:${widget.id}`)}>{names[widget.type]}</button>
              <div class="configuration">
                {#if widget.type === 'clock'}
                  <label for={`${widget.id}-region`}>Region</label>
                  <select id={`${widget.id}-region`} data-dashboard-item-id={controlId(widget.id, 'region')} value={target.regionId}
                    onchange={event => domain(widget.id, 'clock', 'configure', { cityId: target.cities.find(city => city.regionId === event.currentTarget.value).id })}>
                    {#each target.regions as region}<option value={region.id}>{region.label}</option>{/each}
                  </select>
                {/if}
                <label for={`${widget.id}-city`}>City</label>
                <select id={`${widget.id}-city`} data-dashboard-item-id={controlId(widget.id, 'city')} value={target.cityId}
                  onchange={event => domain(widget.id, widget.type, 'configure', widget.type === 'weather' ? { cityId: event.currentTarget.value, unit: target.unit } : { cityId: event.currentTarget.value })}>
                  {#each target.cities.filter(city => widget.type !== 'clock' || city.regionId === target.regionId) as city}<option value={city.id}>{city.label}</option>{/each}
                </select>
                <p class="zone" title={target.timeZone}>{target.timeZone}</p>
                {#if widget.type === 'weather'}
                  <label for={`${widget.id}-unit`}>Temperature</label>
                  <select id={`${widget.id}-unit`} data-dashboard-item-id={controlId(widget.id, 'unit')} value={target.unit}
                    onchange={event => domain(widget.id, 'weather', 'configure', { cityId: target.cityId, unit: event.currentTarget.value })}>
                    <option value="celsius">Celsius (°C)</option><option value="fahrenheit">Fahrenheit (°F)</option>
                  </select>
                {/if}
                <button class="done" data-dashboard-item-id={controlId(widget.id, 'done')} onclick={() => configure(null)}>Done</button>
              </div>
            {:else if widget.type === 'clock'}
              <div class="clock-bezel" class:night={target.dayNight === 'night'}>
                <svg viewBox="0 0 160 160" aria-hidden="true">
                  <circle class="clock-face" cx="80" cy="80" r="72" />
                  {#each Array(60) as _, index}
                    <line class="tick" x1="80" y1={index % 5 === 0 ? 13 : 17} x2="80" y2="21" transform={`rotate(${index * 6} 80 80)`} stroke-width={index % 5 === 0 ? 2 : 1} />
                  {/each}
                  {#each [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as number, index}
                    <text x={80 + Math.sin(index * Math.PI / 6) * 49} y={84 - Math.cos(index * Math.PI / 6) * 49} text-anchor="middle">{number}</text>
                  {/each}
                  <line class="hour-hand" x1="80" y1="88" x2="80" y2="44" transform={`rotate(${target.angles.hour} 80 80)`} />
                  <line class="minute-hand" x1="80" y1="90" x2="80" y2="28" transform={`rotate(${target.angles.minute} 80 80)`} />
                  <line class="second-hand" x1="80" y1="95" x2="80" y2="23" transform={`rotate(${target.angles.second} 80 80)`} />
                  <circle class="pin" cx="80" cy="80" r="4" />
                </svg>
              </div>
              <button class="drag-title clock-city" data-dashboard-drag={widget.id} data-dashboard-item-id={`widget:${widget.id}`} title={`${target.city} — ${target.timeZone}`}>{target.city}</button>
              <output class="clock-digital" aria-label={`${target.city} time`}>{target.digital}</output>
              <button class="info" data-dashboard-item-id={`configure:${widget.id}`} aria-label="Configure World Clock" title="Choose a city" onclick={() => configure(widget.id)}>i</button>
            {:else if widget.type === 'calculator'}
              <button class="drag-title calculator-title" data-dashboard-drag={widget.id} data-dashboard-item-id={`widget:${widget.id}`}>Calculator</button>
              <div class="calculator-screen"><small title={target.expression}>{target.expression || ' '}</small><output aria-live="polite" title={target.error ?? target.display}>{target.display}</output>{#if target.memoryAvailable}<span class="memory-indicator">M</span>{/if}</div>
              {#if target.error}<span class="calculator-error" role="alert" title={target.error}>{target.error}</span>{/if}
              <div class="memory-keys">
                {#each ['m+', 'm-', 'mc', 'mr'] as key}<button data-dashboard-item-id={controlId(widget.id, `key:${key}`)} disabled={['mc', 'mr'].includes(key) ? !target.memoryAvailable : Boolean(target.error)} onclick={() => domain(widget.id, 'calculator', 'key', { key })}>{keyLabels[key]}</button>{/each}
              </div>
              <div class="keypad">
                {#each keypad as key}<button class:operator={['add', 'subtract', 'multiply', 'divide', 'equals'].includes(key)} class:equals={key === 'equals'}
                  disabled={Boolean(target.error) && !['C', '.', ...'0123456789'].includes(key)}
                  data-dashboard-item-id={controlId(widget.id, `key:${key}`)} aria-label={key === 'backspace' ? 'Backspace' : keyLabels[key] ?? key}
                  onclick={() => domain(widget.id, 'calculator', 'key', { key })}>{keyLabels[key] ?? key}</button>{/each}
              </div>
            {:else if widget.type === 'calendar'}
              <div class="calendar-tearoff" aria-label={`Selected date ${target.selectedDate}`}>
                <span>{target.selectedWeekday}</span><strong>{target.selectedDay}</strong>
                <small title={target.selectedDate}>{target.selectedDate}</small>
              </div>
              <div class="calendar-heading">
                <button class="month-arrow" data-dashboard-item-id={controlId(widget.id, 'previous')} aria-label="Previous month" disabled={!target.canPrevious} onclick={() => domain(widget.id, 'calendar', 'navigate', { months: -1 })}>‹</button>
                <button class="drag-title" data-dashboard-drag={widget.id} data-dashboard-item-id={`widget:${widget.id}`} title={target.monthLabel}>{target.monthLabel}</button>
                <button class="month-arrow" data-dashboard-item-id={controlId(widget.id, 'next')} aria-label="Next month" disabled={!target.canNext} onclick={() => domain(widget.id, 'calendar', 'navigate', { months: 1 })}>›</button>
              </div>
              <div class="calendar-grid">
                {#each target.weekdays as day}<strong class="weekday">{day.slice(0, 1)}</strong>{/each}
                {#each target.days as day}
                  {#if day.date}<button class:outside={!day.inMonth} class:selected={day.selected} class:today={day.today}
                    data-dashboard-item-id={controlId(widget.id, `date:${day.date}`)} aria-label={day.date} aria-pressed={day.selected}
                    onclick={() => domain(widget.id, 'calendar', 'select', { date: day.date })}>{day.day}</button>{:else}<span class="empty-day"></span>{/if}
                {/each}
              </div>
              <div class="calendar-footer"><output title={target.selectedDate}>{target.selectedDate}</output><button data-dashboard-item-id={controlId(widget.id, 'today')} onclick={() => domain(widget.id, 'calendar', 'today')}>Today</button></div>
            {:else if widget.type === 'weather'}
              <div class="weather-sky" class:night={target.dayNight === 'night'}>
                <button class="drag-title weather-city" data-dashboard-drag={widget.id} data-dashboard-item-id={`widget:${widget.id}`} title={target.city}>{target.city}</button>
                <span class="weather-symbol" aria-hidden="true">{conditionGlyph(target.condition, target.dayNight)}</span>
                <output class="temperature">{target.temperature}°</output>
                <span class="condition" title={target.condition}>{target.condition}</span>
                <small class="weather-range">H {target.high}° · L {target.low}° {target.unit === 'celsius' ? 'C' : 'F'}</small>
              </div>
              <div class="forecast" aria-label="Six-day forecast">
                {#each target.forecast as day}<div title={`${day.date}: ${day.condition}, high ${day.high}°, low ${day.low}°`}><strong>{day.day}</strong><span aria-hidden="true">{conditionGlyph(day.condition)}</span><b>{day.high}°</b><small>{day.low}°</small></div>{/each}
              </div>
              <div class="weather-footer"><span title={`${target.source}; updated ${target.updatedAt}; refresh ${target.refreshCount}`}>Offline scene forecast</span><button data-dashboard-item-id={controlId(widget.id, 'refresh')} aria-label="Refresh local weather fixture" title="Refresh local fixture (no network)" onclick={() => domain(widget.id, 'weather', 'refresh')}>↻</button></div>
              <button class="info" data-dashboard-item-id={`configure:${widget.id}`} aria-label="Configure Weather" title="Choose a city and temperature unit" onclick={() => configure(widget.id)}>i</button>
            {:else if widget.type === 'converter'}
              <button class="drag-title converter-title" data-dashboard-drag={widget.id} data-dashboard-item-id={`widget:${widget.id}`}>Unit Converter</button>
              <select class="category" aria-label="Conversion category" title="Conversion category" data-dashboard-item-id={controlId(widget.id, 'category')} value={target.category} onchange={event => converterChange(widget.id, 'category', event.currentTarget.value)}>
                {#each target.categories as category}<option value={category.id}>{category.label}</option>{/each}
              </select>
              <div class="conversion-row">
                <input aria-label="Value to convert" data-dashboard-item-id={controlId(widget.id, 'value')} value={target.value} inputmode="decimal" spellcheck="false" aria-invalid={Boolean(target.error)} oninput={event => converterChange(widget.id, 'value', event.currentTarget.value)} />
                <select aria-label="Source unit" title="Source unit" data-dashboard-item-id={controlId(widget.id, 'fromUnit')} value={target.fromUnit} onchange={event => converterChange(widget.id, 'fromUnit', event.currentTarget.value)}>{#each target.units as unit}<option value={unit.id}>{unit.label}</option>{/each}</select>
              </div>
              <div class="conversion-row">
                <output aria-label="Converted value" title={target.result ?? target.error ?? ''}>{target.result ?? '—'}</output>
                <select aria-label="Destination unit" title="Destination unit" data-dashboard-item-id={controlId(widget.id, 'toUnit')} value={target.toUnit} onchange={event => converterChange(widget.id, 'toUnit', event.currentTarget.value)}>{#each target.units as unit}<option value={unit.id}>{unit.label}</option>{/each}</select>
              </div>
              <div class="converter-footer"><span title={target.source}>{target.source}</span><button data-dashboard-item-id={controlId(widget.id, 'swap')} aria-label="Swap source and destination units" title="Swap units" onclick={() => swap(widget.id)}>⇄</button></div>
              {#if target.error}<div class="conversion-error" role="alert">{target.error}</div>{/if}
            {/if}
          </section>
        {/each}
        {#if !widgets.length}<p class="empty-board">Click + to add a widget.</p>{/if}
        {#if view?.library}
          <section class="widget-library" aria-label="Widget library" style:top={`${extent.height}px`}>
            <h2>Widgets</h2>
            <div class="library-items">
              {#each dashboardWidgetTypes as type}<button data-dashboard-item-id={`library:${type}`} disabled={dashboard.widgets.length >= 16} title={`Add ${names[type]}`} onclick={() => request('dashboard.widget.add', { type })}>
                <span class={`library-skin library-${type}`} aria-hidden="true">{({ clock: '◷', calculator: '123', calendar: '25', weather: '☀', converter: '⇄' })[type]}</span><span>{names[type]}</span>
              </button>{/each}
            </div>
            {#if dashboard.widgets.length >= 16}<p role="status">All 16 widget places are in use. Remove a widget to add another.</p>{/if}
          </section>
        {/if}
      </div>
    </div>
    <nav class="management" aria-label="Dashboard controls">
      <button data-dashboard-item-id="add" class:active={view?.library} aria-label={view?.library ? 'Close widget library' : 'Add widgets'} aria-expanded={Boolean(view?.library)} title="Add widgets" onclick={() => shell('setLibrary', {}, { open: !dashboard.view?.library })}>+</button>
      <button data-dashboard-item-id="remove" class:active={view?.editing} aria-label={view?.editing ? 'Finish removing widgets' : 'Remove widgets'} aria-pressed={Boolean(view?.editing)} title="Remove widgets" onclick={() => shell('setEditing', {}, { editing: !dashboard.view?.editing })}>−</button>
      <span class="management-label">Dashboard</span>
      <button data-dashboard-item-id="close" class="close-dashboard" aria-label="Close Dashboard" title="Return from Dashboard" onclick={close}>×</button>
    </nav>
  </div>
</div>

<style>
  [data-dashboard]{position:absolute;inset:0;z-index:14000;background:rgba(0,0,0,.48);overflow:clip;font-family:"Helvetica Neue",Helvetica,sans-serif;color:#eee;outline:none}
  .widget.selected{z-index:10}
  [data-dashboard].space{background-color:#282b2c;background-image:repeating-linear-gradient(0deg,transparent 0 2px,#ffffff05 2px 3px),repeating-linear-gradient(90deg,transparent 0 2px,#00000022 2px 3px),radial-gradient(ellipse at 50% 0,#434748,#202324 85%)}
  .viewport{position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:clip}.board{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-color:#7778 #1114;scrollbar-width:thin}.board-content{position:relative;min-width:100%;min-height:100%}.board-background{position:absolute;inset:0;border:0;padding:0;background:transparent;cursor:default}.widget{position:absolute;box-sizing:border-box;filter:drop-shadow(0 7px 6px #0008);isolation:isolate}.widget.dragging{z-index:20;filter:drop-shadow(0 12px 10px #000b)}
  button,select,input{font:inherit;box-sizing:border-box}button{cursor:pointer}button:disabled{cursor:default;opacity:.45}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8dc7ff;outline-offset:2px}.drag-title{border:0;background:transparent;color:inherit;font-weight:700;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:grab;touch-action:none}.dragging .drag-title{cursor:grabbing}.delete-widget{position:absolute;right:3px;top:3px;z-index:8;width:22px;height:22px;padding:0;border:1px solid #eee;border-radius:50%;background:linear-gradient(#777,#171717);color:#fff;font-size:20px;line-height:18px;box-shadow:0 1px 3px #000b}.info{position:absolute;right:7px;bottom:6px;width:19px;height:19px;line-height:16px;padding:0;border:1px solid #ddd8;border-radius:50%;background:linear-gradient(#555,#191919);color:#fff;font:bold italic 15px Georgia,serif}
  .clock-bezel{width:164px;height:164px;margin:4px auto 0;border:5px solid #a4a7a8;border-radius:50%;box-sizing:border-box;background:#eee;box-shadow:inset 0 0 0 2px #42484b,0 0 0 1px #eee,0 3px 3px #0008}.clock-bezel svg{width:100%;height:100%;display:block}.clock-face{fill:#fffef0}.tick{stroke:#2c2b28}.clock-bezel text{font:13px Georgia,serif;fill:#24231f}.hour-hand,.minute-hand{stroke:#242622;stroke-linecap:round}.hour-hand{stroke-width:5}.minute-hand{stroke-width:3}.second-hand{stroke:#b33225;stroke-width:1.5}.pin{fill:#a1271b}.clock-bezel.night .clock-face{fill:#222a32}.clock-bezel.night .tick{stroke:#d4d7d2}.clock-bezel.night text{fill:#e8e9e0}.clock-bezel.night .hour-hand,.clock-bezel.night .minute-hand{stroke:#e9e9df}.clock-city{display:block;width:146px;margin:5px auto 0;font-size:14px;text-shadow:0 1px 2px #000;padding:0 5px}.clock-digital{display:block;text-align:center;font:11px Menlo,monospace;color:#ddd;margin-top:3px}.clock .info{bottom:3px;right:0}
  .calculator{background:linear-gradient(110deg,#696c68,#272b29 55%,#454945);border:1px solid #92958e;border-radius:12px;padding:7px 10px 8px;box-shadow:inset 0 1px 2px #fff7,inset 0 -2px 2px #0009}.calculator-title{display:block;font-size:10px;font-weight:500;color:#d7d8d1;text-shadow:0 -1px #000;height:16px;width:100%;padding:0}.calculator-screen{height:49px;margin:4px 0 7px;padding:3px 7px;background:linear-gradient(#a6b396,#d1dcc0);border:2px solid #1d261c;border-radius:3px;box-shadow:inset 0 2px 5px #0005;position:relative;color:#253521}.calculator-screen small{display:block;font:9px Menlo,monospace;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;height:12px}.calculator-screen output{display:block;font:24px Menlo,monospace;line-height:27px;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.memory-indicator{position:absolute;left:4px;top:3px;font:9px Menlo,monospace}.memory-keys{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:5px}.memory-keys button,.keypad button{border:1px solid #161b17;border-radius:4px;box-shadow:inset 0 1px #ffffff80,0 1px 1px #0007;background:linear-gradient(#f1f0e4,#bdbeb2);color:#282924;text-shadow:0 1px #fff8}.memory-keys button{height:19px;padding:0;font-size:9px}.keypad{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.keypad button{height:25px;font-size:14px;padding:0}.keypad button.operator{background:linear-gradient(#adb1a6,#757c70);color:#f7f8ee;text-shadow:0 -1px #0006}.keypad button.equals{background:linear-gradient(#dd983f,#a66625);color:#fff}.keypad button:active,.memory-keys button:active{box-shadow:inset 0 2px 3px #0007}.calculator-error{position:absolute;left:10px;bottom:4px;width:195px;font-size:9px;color:#ffd5a4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .calendar{border-radius:8px;background:linear-gradient(#383b3c,#111314);border:1px solid #777;color:#eee;box-shadow:inset 0 1px #ffffff66;overflow:hidden}.calendar-tearoff{position:absolute;left:0;top:0;bottom:0;width:94px;background:repeating-linear-gradient(#fffdf4 0 3px,#faf7ed 3px 4px);border-right:1px solid #050606;box-shadow:2px 0 4px #0006;color:#333126;text-align:center;padding-top:41px;box-sizing:border-box}.calendar-tearoff span{display:block;color:#ae362c;font:18px Georgia,serif}.calendar-tearoff strong{display:block;font:65px/95px Georgia,serif;letter-spacing:-4px}.calendar-tearoff small{display:block;font:9px Georgia,serif;color:#7d7265;margin-top:9px}.calendar-heading{height:42px;margin-left:94px;display:flex;align-items:center;gap:0;color:#fff5e6;padding:0 3px;text-shadow:0 -1px #000}.calendar-heading .drag-title{flex:1;min-width:0;font:700 11px Georgia,serif;padding:0}.month-arrow{border:0;background:transparent;color:inherit;font-size:24px;padding:0;width:18px;flex:none}.calendar-grid{margin-left:94px;display:grid;grid-template-columns:repeat(7,1fr);grid-template-rows:20px repeat(6,24px);padding:5px 5px 0;text-align:center;gap:0 1px}.weekday{font-size:9px;color:#a4a5a0;line-height:20px}.calendar-grid button{border:1px solid transparent;border-radius:3px;background:transparent;font-size:10px;color:#e5e5df;padding:0}.calendar-grid button.outside{color:#707370}.calendar-grid button.selected{background:#ae362c;color:white;border-color:#7e271e;box-shadow:inset 0 1px #da6a58}.calendar-grid button.today:not(.selected){border-color:#d66150;color:#ffac96;font-weight:700}.calendar-footer{display:flex;align-items:center;justify-content:flex-end;margin:8px 9px 0 101px;border-top:1px solid #ffffff26;padding-top:5px;font-size:10px}.calendar-footer output{display:none}.calendar-footer button{border:1px solid #111;border-radius:8px;padding:1px 10px;background:linear-gradient(#777,#333);font-size:10px;color:#eee}
  .weather{border-radius:13px;overflow:hidden;background:#1d3d69;border:1px solid #7c9dc0;box-shadow:inset 0 1px #ffffff66;color:#fff}.weather-sky{height:139px;position:relative;background:radial-gradient(ellipse at 22% 83%,#e3edfa77,transparent 43%),linear-gradient(#143d76,#5999cf);border-radius:12px 12px 0 0}.weather-sky.night{background:radial-gradient(ellipse at 17% 65%,#949acf55,transparent 40%),linear-gradient(#10142b,#333c68)}.weather-city{position:absolute;top:10px;left:17px;width:245px;text-align:left;font-size:20px;font-weight:400;text-shadow:0 1px 3px #0009}.weather-symbol{position:absolute;left:27px;top:39px;font:72px Georgia,serif;line-height:80px;color:#ffe99f;text-shadow:0 0 20px #ffeeac66,0 2px 3px #0005}.temperature{position:absolute;right:19px;top:35px;font-size:57px;font-weight:300;letter-spacing:-3px;text-shadow:0 2px #0004}.condition{position:absolute;left:18px;bottom:9px;max-width:170px;font-size:12px;text-shadow:0 1px #0005;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.weather-range{position:absolute;right:15px;bottom:11px;font-size:10px;color:#dce9f9}.forecast{height:65px;display:grid;grid-template-columns:repeat(6,1fr);background:linear-gradient(#283f67,#152b4c);border-top:1px solid #bccfea6e;padding:5px 7px;box-sizing:border-box}.forecast div{text-align:center;display:grid;grid-template-rows:12px 21px 12px 10px;border-right:1px solid #ffffff19;font-size:9px}.forecast div:last-child{border-right:0}.forecast strong{font-weight:400;color:#d4dcea;overflow:hidden}.forecast span{font:22px Georgia,serif;color:#fbe7ad;line-height:21px}.forecast b{font-weight:400}.forecast small{font-size:9px;color:#a3b7d7}.weather-footer{height:24px;padding:2px 31px 0 10px;display:flex;align-items:center;justify-content:space-between;color:#aebbd0;font-size:9px}.weather-footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weather-footer button{border:0;background:transparent;color:#ddeaff;width:22px;padding:0;font-size:18px}.weather .info{bottom:4px}
  .converter{border:1px solid #a98956;border-radius:10px;background:linear-gradient(#ded1b1,#b5a17c);box-shadow:inset 0 1px #fff6,inset 0 -1px #6c563c;color:#43372a;padding:9px 14px}.converter-title{width:145px;padding:0;text-align:left;height:19px;font:700 13px Georgia,serif;text-shadow:0 1px #fff5}.converter select{height:25px;border:1px solid #8d806c;border-radius:3px;background:linear-gradient(#fcf9ee,#ddd7c3);color:#3f392f;font-size:11px;max-width:100%;text-overflow:ellipsis}.converter .category{float:right;width:141px;height:22px;margin-bottom:8px}.conversion-row{clear:both;display:grid;grid-template-columns:120px 1fr;gap:10px;margin-top:7px;align-items:center}.conversion-row input,.conversion-row output{width:100%;height:29px;border:1px solid #948a73;border-radius:2px;background:#f7f4e9;box-shadow:inset 0 1px 3px #0002;color:#393930;text-align:right;padding:4px 6px;font:15px Menlo,monospace;box-sizing:border-box}.conversion-row output{background:#e5dfca;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.converter-footer{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:9px}.converter-footer span{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.converter-footer button{width:30px;height:22px;background:linear-gradient(#faf5e7,#cdc1a3);border:1px solid #9b8864;border-radius:10px;color:#56422f;font-size:17px;line-height:17px;padding:0}.conversion-error{position:absolute;left:14px;right:14px;bottom:6px;padding:3px 5px;border:1px solid #9f4f34;background:#fff0ce;color:#813218;font-size:10px;border-radius:3px;overflow-wrap:anywhere}
  .widget.back{background:linear-gradient(125deg,#45494b,#171c1f);border:1px solid #737879;border-radius:12px;color:#eee;padding:12px}.config-title{display:block;width:100%;height:25px;font-size:15px;text-shadow:0 -1px #000;cursor:default}.configuration{padding:10px 1px;font-size:12px}.configuration label{display:block;font-size:11px;color:#d5d5d5;margin-bottom:4px}.configuration select{width:100%;height:25px;border:1px solid #777;border-radius:4px;font-size:11px;color:#222;background:#eee}.zone{font-size:9px;color:#bfc7c9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:7px 0 12px}.done{display:block;margin:13px 0 0 auto;border:1px solid #1c2227;border-radius:11px;background:linear-gradient(#fff,#aaa);color:#222;font-size:11px;padding:3px 13px;box-shadow:0 1px #fff2}
  .widget-library{position:absolute;left:12px;right:12px;height:168px;box-sizing:border-box;border-top:1px solid #aaa4;background:linear-gradient(#333e,#111e);border-radius:8px;padding:12px 20px;box-shadow:inset 0 1px #ffffff14}.widget-library h2{font-size:12px;font-weight:400;color:#ddd;margin:0 0 8px}.library-items{display:flex;gap:19px}.library-items button{width:133px;flex:none;border:0;background:transparent;color:#eee;display:flex;flex-direction:column;align-items:center;gap:9px;font-size:12px;padding:4px;border-radius:5px}.library-items button:hover{background:#ffffff10}.library-items button>span:last-child{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.library-skin{width:65px;height:65px;box-sizing:border-box;display:grid;place-items:center;font:36px Georgia,serif;box-shadow:0 4px 5px #0008}.library-clock{border-radius:50%;border:4px solid #b3b9b9;background:#fffced;color:#292c28}.library-calculator{border-radius:7px;border:2px solid #81877e;background:linear-gradient(#b6c19f 36%,#3b403b 37%);color:#263a23;font:18px Menlo,monospace;padding-bottom:28px}.library-calendar{border-radius:4px;border-top:16px solid #ac362b;background:#fff9e5;color:#393529;font-size:29px}.library-weather{width:86px;border-radius:9px;background:linear-gradient(#1f4e94,#6ba2d5 70%,#163157 71%);color:#ffe3a1}.library-converter{width:86px;border-radius:7px;background:linear-gradient(#ddd2b5,#b8a781);color:#584832}.widget-library p{margin:7px 0 0;font-size:11px;color:#ddd}.empty-board{position:absolute;top:80px;left:40px;font-size:16px;color:#ddd;text-shadow:0 1px 3px #000;pointer-events:none}
  .management{height:48px;flex:none;display:flex;align-items:center;gap:9px;padding:0 14px;box-sizing:border-box;overflow:clip;background:linear-gradient(transparent,#0006);color:#fff}.management button{flex:none;width:30px;height:30px;padding:0;border-radius:50%;border:1px solid #888;background:linear-gradient(#686868,#1b1b1b);box-shadow:inset 0 1px #ffffff66,0 1px 3px #000a;color:#fff;font:26px/26px Helvetica,sans-serif;text-shadow:0 -1px #000}.management button.active{background:linear-gradient(#222,#575757);box-shadow:inset 0 2px 4px #000b}.management-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#ddd;text-shadow:0 1px #000}.management .close-dashboard{margin-left:auto;font-size:25px}
  @media(max-height:300px){.management{height:34px;padding:0 8px;gap:7px}.management button{width:25px;height:25px;font-size:22px;line-height:21px}}
  .calculator-screen,.weather-footer{box-sizing:border-box}
  .configuration{padding:5px 1px}.configuration .zone{margin:4px 0 5px}.configuration .done{margin-top:5px}
</style>

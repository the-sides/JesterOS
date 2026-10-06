import { rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice, offset } from './command-schema.js';
import { helpArticles, searchHelpArticles } from './help-content.js';

const fields = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const id = value => typeof value === 'string' && value.length > 0;
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const offsets = value => fields(value, ['top', 'left']) && position(value.top) && position(value.left);
// Read through reactive pane proxies while detaching only public JSON-shaped data.
const clone = value => Array.isArray(value) ? value.map(clone)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const fail = code => rejected(code, code === 'invalid_arguments' ? 'Use the closed documented Help target and payload.' : 'The original Help owner or native surface is no longer available.');
const applied = target => ({ status: 'applied', target });
const bounded = entries => entries.slice(-128);

export function createHelpViewerCommands(ctx) {
  let sequence = 0, epoch = 0, disposed = false;
  const returns = new Map();
  const installed = appId => helpArticles(ctx.profile, appId).length > 0;
  const available = appId => !disposed && ctx.available() === true && ctx.getActiveAppId() === appId && installed(appId);
  const validArticle = (appId, articleId) => helpArticles(ctx.profile, appId).some(article => article.articleId === articleId);
  const owner = target => {
    const pane = ctx.getPane();
    return pane && pane.helpId === target.helpId && available(pane.appId) ? pane : null;
  };
  const lease = pane => {
    const generation = epoch, appId = pane.appId;
    return () => generation === epoch && ctx.getPane() === pane && pane.appId === appId && available(appId);
  };
  // Catch only failures at the native bridge boundary, not domain/programming errors.
  async function native(call) { try { return await call(); } catch { return null; } }
  async function prepared(pane, guard) {
    const view = ctx.getView();
    if (!view || view.available() !== true) return null;
    if (await native(() => view.prepare()) !== true || !guard() || ctx.getView() !== view || view.available() !== true) return null;
    return view;
  }
  function live(view, guard) { return guard() && ctx.getView() === view && view.available() === true; }
  function controls(view) {
    const pane = ctx.getPane(), values = view.controlIds();
    const allowed = new Set(['search', 'contents', 'reader', 'back', 'forward', 'close',
      ...helpArticles(ctx.profile, pane?.appId).map(article => `article:${article.articleId}`)]);
    return Array.isArray(values) ? values.filter(value => allowed.has(value)) : [];
  }
  async function focus(view, controlId, guard) {
    if (!live(view, guard) || !controls(view).includes(controlId)) return false;
    const previous = view.focusedControl();
    const result = await native(() => view.focus(controlId));
    if (result === true && live(view, guard) && view.focusedControl() === controlId) return true;
    if (live(view, guard) && controls(view).includes(previous)) await native(() => view.focus(previous));
    return false;
  }
  async function scroll(view, region, requested, guard) {
    if (!live(view, guard)) return null;
    const previous = view.scrollPosition(region);
    if (!offsets(previous)) return null;
    const result = await native(() => view.scroll(region, requested.top, requested.left));
    const actual = live(view, guard) ? view.scrollPosition(region) : null;
    if (offsets(result) && offsets(actual) && actual.top === result.top && actual.left === result.left) return { ...actual };
    if (live(view, guard)) await native(() => view.scroll(region, previous.top, previous.left));
    return null;
  }
  async function restore(token, guard) {
    if (token !== undefined && guard()) await native(() => ctx.restoreFocus(token, guard));
  }
  function dismiss() { epoch++; returns.clear(); if (ctx.getPane() !== null) ctx.setPane(null); }
  function reconcile() {
    const pane = ctx.getPane();
    if (disposed || ctx.available() !== true || pane && (!available(pane.appId) || !validArticle(pane.appId, pane.articleId))) dismiss();
  }
  function payloadEmpty(payload) { return fields(payload, []); }
  function targetPane(target, extra = []) { return fields(target, ['helpId', ...extra]) && id(target.helpId); }
  async function transition(pane, next) {
    const guard = lease(pane), view = await prepared(pane, guard);
    if (!view) return fail(guard() ? 'unavailable' : 'stale_target');
    const current = view.scrollPosition('article');
    if (!offsets(current)) return fail('unavailable');
    const previous = clone(pane);
    const outgoing = { articleId: pane.articleId, ...current };
    if (next.direction) {
      const source = next.direction === 'back' ? pane.backStack : pane.forwardStack;
      const destination = next.direction === 'back' ? pane.forwardStack : pane.backStack;
      next.entry = source.at(-1);
      source.pop(); destination.push(outgoing);
      if (destination.length > 128) destination.splice(0, destination.length - 128);
    } else {
      pane.backStack = bounded([...pane.backStack, outgoing]); pane.forwardStack = [];
      next.entry = { articleId: next.articleId, top: 0, left: 0 };
    }
    pane.articleId = next.entry.articleId;
    pane.scroll.article = { top: next.entry.top, left: next.entry.left };
    await ctx.settle();
    if (!live(view, guard)) return fail('stale_target');
    const actual = await scroll(view, 'article', pane.scroll.article, guard);
    if (!actual) {
      if (guard()) { Object.assign(pane, previous); await ctx.settle(); await scroll(view, 'article', current, guard); }
      return fail(guard() ? 'unavailable' : 'stale_target');
    }
    pane.scroll.article = actual;
    return applied({ helpId: pane.helpId, articleId: pane.articleId });
  }
  const handlers = {
    'help.viewer.open': async (target, payload) => {
      if (!fields(target, ['appId']) || !id(target.appId) || !fields(payload, [], ['articleId'])
        || payload.articleId !== undefined && !id(payload.articleId)) return fail('invalid_arguments');
      if (!available(target.appId)) return fail('unavailable');
      const articleId = payload.articleId ?? 'overview';
      if (!validArticle(target.appId, articleId)) return fail('stale_target');
      const old = ctx.getPane();
      if (old?.appId === target.appId) {
        const guard = lease(old), view = await prepared(old, guard);
        if (!view) return fail(guard() ? 'unavailable' : 'stale_target');
        const previousFocus = view.focusedControl();
        const controlId = controls(view).includes(old.focusedControl) ? old.focusedControl : 'search';
        if (!await focus(view, controlId, guard)) return fail(guard() ? 'unavailable' : 'stale_target');
        if (payload.articleId !== undefined && old.articleId !== articleId) {
          const result = await transition(old, { articleId });
          if (result.status !== 'applied') {
            if (live(view, guard) && controls(view).includes(previousFocus)) await native(() => view.focus(previousFocus));
            return result;
          }
        }
        old.focusedControl = controlId;
        return applied({ helpId: old.helpId, appId: old.appId, articleId: old.articleId });
      }
      let token;
      try { token = ctx.captureFocus(); } catch { return fail('unavailable'); }
      const generation = ++epoch;
      const candidate = { helpId: `${ctx.namespace}-help-${++sequence}`, appId: target.appId, query: '', articleId,
        backStack: [], forwardStack: [], focusedControl: 'search', scroll: { results: { top: 0, left: 0 }, article: { top: 0, left: 0 } } };
      ctx.setPane(candidate);
      const pane = ctx.getPane(), guard = lease(pane);
      returns.set(pane.helpId, token);
      await ctx.settle();
      const view = guard() ? await prepared(pane, guard) : null;
      if (!view || !await focus(view, 'search', guard)) {
        if (generation === epoch && ctx.getPane() === pane) {
          returns.delete(pane.helpId);
          ctx.setPane(old); await ctx.settle();
          await restore(token, () => generation === epoch && ctx.getPane() === old && available(target.appId));
        }
        return fail(generation === epoch ? 'unavailable' : 'stale_target');
      }
      returns.clear(); returns.set(pane.helpId, token);
      return applied({ helpId: pane.helpId, appId: pane.appId, articleId: pane.articleId });
    },
    'help.viewer.close': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, [], ['restoreFocus']) || payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean') return fail('invalid_arguments');
      const pane = owner(target); if (!pane) return fail('stale_target');
      const token = returns.get(pane.helpId), appId = pane.appId;
      dismiss(); const generation = epoch; await ctx.settle();
      if (payload.restoreFocus !== false) await restore(token, () => generation === epoch && ctx.getPane() === null && available(appId));
      return applied({ helpId: pane.helpId });
    },
    'help.viewer.search': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 256) return fail('invalid_arguments');
      const pane = owner(target); if (!pane) return fail('stale_target');
      const guard = lease(pane), view = await prepared(pane, guard); if (!view) return fail(guard() ? 'unavailable' : 'stale_target');
      const previous = { query: pane.query, results: view.scrollPosition('results') };
      if (!offsets(previous.results)) return fail('unavailable');
      pane.query = payload.query; pane.scroll.results = { top: 0, left: 0 }; await ctx.settle();
      const actual = await scroll(view, 'results', pane.scroll.results, guard);
      if (!actual) {
        if (guard()) { pane.query = previous.query; pane.scroll.results = previous.results; await ctx.settle(); await scroll(view, 'results', previous.results, guard); }
        return fail(guard() ? 'unavailable' : 'stale_target');
      }
      pane.scroll.results = actual;
      return applied({ helpId: pane.helpId, query: pane.query, articleIds: searchHelpArticles(ctx.profile, pane.appId, pane.query).map(article => article.articleId) });
    },
    'help.viewer.read': async (target, payload) => {
      if (!targetPane(target, ['articleId']) || !id(target.articleId) || !payloadEmpty(payload)) return fail('invalid_arguments');
      const pane = owner(target); if (!pane || !validArticle(pane.appId, target.articleId)) return fail('stale_target');
      if (pane.articleId === target.articleId) {
        const guard = lease(pane), view = await prepared(pane, guard);
        return view ? applied({ helpId: pane.helpId, articleId: pane.articleId }) : fail(guard() ? 'unavailable' : 'stale_target');
      }
      return transition(pane, { articleId: target.articleId });
    },
    'help.viewer.navigate': async (target, payload) => {
      if (!targetPane(target) || !fields(payload, ['direction']) || !['back', 'forward'].includes(payload.direction)) return fail('invalid_arguments');
      const pane = owner(target); if (!pane) return fail('stale_target');
      if (!(payload.direction === 'back' ? pane.backStack : pane.forwardStack).length) return fail('disabled');
      return transition(pane, { direction: payload.direction });
    },
    'help.viewer.focus': async (target, payload) => {
      if (!targetPane(target, ['controlId']) || !id(target.controlId) || !fields(payload, [], ['observe']) || payload.observe !== undefined && typeof payload.observe !== 'boolean') return fail('invalid_arguments');
      const pane = owner(target); if (!pane) return fail('stale_target');
      const guard = lease(pane), view = payload.observe ? ctx.getView() : await prepared(pane, guard);
      if (!view || !live(view, guard) || !controls(view).includes(target.controlId)) return fail('unavailable');
      if (payload.observe ? view.focusedControl() !== target.controlId : !await focus(view, target.controlId, guard)) return fail('unavailable');
      pane.focusedControl = target.controlId;
      return applied({ helpId: pane.helpId, controlId: target.controlId });
    },
    'help.viewer.scroll': async (target, payload) => {
      if (!targetPane(target, ['region']) || !['results', 'article'].includes(target.region) || !fields(payload, ['top'], ['left', 'observe'])
        || !position(payload.top) || payload.left !== undefined && !position(payload.left) || payload.observe !== undefined && typeof payload.observe !== 'boolean') return fail('invalid_arguments');
      const pane = owner(target); if (!pane) return fail('stale_target');
      const guard = lease(pane), view = payload.observe ? ctx.getView() : await prepared(pane, guard);
      if (!view || !live(view, guard)) return fail('unavailable');
      const requested = { top: payload.top, left: payload.left ?? 0 };
      const actual = payload.observe ? view.scrollPosition(target.region) : await scroll(view, target.region, requested, guard);
      if (!offsets(actual) || payload.observe && (actual.top !== requested.top || actual.left !== requested.left)) return fail('unavailable');
      pane.scroll[target.region] = { ...actual };
      return applied({ helpId: pane.helpId, region: target.region, ...actual });
    },
  };
  function targets() {
    const pane = ctx.getPane(), view = pane && available(pane.appId) ? ctx.getView() : null;
    const actual = view?.available() === true ? view : null;
    return { pane: clone(pane), articles: pane ? helpArticles(ctx.profile, pane.appId) : [],
      results: pane ? searchHelpArticles(ctx.profile, pane.appId, pane.query) : [],
      controls: actual ? [...controls(actual)] : [], bounds: actual ? clone(actual.bounds()) : null };
  }
  return { handlers, targets, reconcile,
    // Internal interruption hand-off only: no token is ever projected or inspected.
    getReturnFocus() { const pane = ctx.getPane(); return pane ? returns.get(pane.helpId) : undefined; },
    dispose() { disposed = true; dismiss(); } };
}

const profiles = ['macos-golden-gate-27.0.1'], capability = 'shell.help-workflows';
const paneTarget = object({ helpId: identity });
const observed = object({ observe: flag }, []);
const query = { type: 'string', maxLength: 256 };
const result = properties => object(properties);
const catalog = (name, target, payload, output) => defineCommand(profiles, `help.viewer.${name}`, capability,
  target, payload, ['frontmost installed app', 'current root and native Help owner'], ['transient offline Help viewer'], [], [], result(output));
export const helpViewerCatalog = Object.fromEntries([
  catalog('open', object({ appId: identity }), object({ articleId: identity }, []), { helpId: identity, appId: identity, articleId: identity }),
  catalog('close', paneTarget, object({ restoreFocus: flag }, []), { helpId: identity }),
  catalog('search', paneTarget, object({ query }), { helpId: identity, query, articleIds: { type: 'array', items: identity } }),
  catalog('read', object({ helpId: identity, articleId: identity }), empty, { helpId: identity, articleId: identity }),
  catalog('navigate', paneTarget, object({ direction: choice('back', 'forward') }), { helpId: identity, articleId: identity }),
  catalog('focus', object({ helpId: identity, controlId: identity }), observed, { helpId: identity, controlId: identity }),
  catalog('scroll', object({ helpId: identity, region: choice('results', 'article') }), object({ top: offset, left: offset, observe: flag }, ['top']),
    { helpId: identity, region: choice('results', 'article'), top: offset, left: offset }),
]);

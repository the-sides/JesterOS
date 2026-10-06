import { searchHelpArticles } from './help-content.js';

const termsFor = query => query.trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);

/** Search only real current-app provider leaves, including unavailable commands. */
export function helpMenuResults(menus, appId, query) {
  const terms = termsFor(query);
  if (!terms.length) return [];
  const results = [];
  for (const menu of menus) {
    if (menu.appId !== appId || menu.menuId === 'help') continue;
    const visit = (items, pathIds, pathLabels, ancestorsEnabled) => {
      for (const item of items) {
        if (item.separator || item.heading) continue;
        const ids = [...pathIds, item.id], labels = [...pathLabels, item.label];
        const enabled = ancestorsEnabled && item.enabled === true;
        if (item.children) visit(item.children, ids, labels, enabled);
        else {
          const text = labels.join(' ').toLocaleLowerCase('en-US');
          if (terms.every(term => text.includes(term))) results.push({
            resultId: `help-menu:${JSON.stringify([menu.menuId, ...ids])}`,
            menuId: menu.menuId, itemId: item.id, pathIds: ids, pathLabels: labels,
            label: item.label, shortcut: item.shortcut ?? '', enabled,
            request: item.request ?? null,
          });
        }
      }
    };
    visit(menu.items, [], [menu.label], menu.enabled === true);
  }
  return results;
}

/** Help results remain part of the one canonical host tree, not a copied command registry. */
export function helpMenuProviders(menus, state, profile) {
  if (!profile.capabilities.includes('shell.help-workflows')) return menus;
  return menus.map(menu => {
    if (menu.menuId !== 'help') return menu;
    const query = state.menuId === 'help' && state.appId === menu.appId ? state.helpSearch?.query ?? '' : '';
    const commands = helpMenuResults(menus, menu.appId, query);
    const articles = query.trim() ? searchHelpArticles(profile, menu.appId, query) : [];
    const items = [];
    if (query.trim()) {
      items.push({ id: 'help-menu-heading', label: 'Menu Items', enabled: false, heading: true });
      if (!commands.length) items.push({ id: 'help-menu-empty', label: 'No matching menu commands', enabled: false, heading: true });
      for (const result of commands) items.push({ id: result.resultId, label: result.label,
        enabled: true, shortcut: result.shortcut, helpResult: result,
        ...(result.enabled && result.request ? { request: result.request } : {}) });
      items.push({ id: 'help-topic-heading', label: 'Help Topics', enabled: false, heading: true });
      if (!articles.length) items.push({ id: 'help-topic-empty', label: 'No matching offline articles', enabled: false, heading: true });
      for (const article of articles) items.push({ id: `help-topic:${article.articleId}`, label: article.title, enabled: true,
        request: { command: 'help.viewer.open', target: { appId: menu.appId }, payload: { articleId: article.articleId } } });
      items.push({ id: 'help-results-separator', label: '', enabled: false, separator: true });
    }
    return { ...menu, search: { query }, items: [...items, ...menu.items] };
  });
}

/** Resolve the exact live provider/path; disabled leaves can be shown but not executed. */
export function helpMenuLocation(menus, state) {
  if (state.menuId !== 'help' || !state.helpSearch?.locationId) return null;
  const result = helpMenuResults(menus, state.appId, state.helpSearch.query)
    .find(result => result.resultId === state.helpSearch.locationId);
  if (!result) return null;
  const menu = menus.find(menu => menu.menuId === result.menuId && menu.appId === state.appId);
  const levels = [];
  let items = menu.items;
  for (const itemId of result.pathIds) {
    const item = items.find(item => item.id === itemId);
    if (!item) return null;
    levels.push({ items, itemId });
    items = item.children;
  }
  return { ...result, menu, levels };
}

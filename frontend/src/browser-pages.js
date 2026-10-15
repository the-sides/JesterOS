// Authored closed-address-space pages. Nothing here fetches or embeds remote data.
export const browserPages = [
  { id: 'home', address: 'jester://start', title: 'Start Page', heading: 'A little room to explore.', description: 'Favorites and reading for your local production desktop.', kind: 'start', reader: false, sections: [{ title: 'Offline by design', body: 'These are authored fictional pages, not cached websites. Your searches, sample forms and downloaded documents stay inside this scene.' }], links: [{ title: 'Scene guide', url: 'jester://guide' }, { title: 'Studio journal', url: 'jester://journal' }, { title: 'Production desk', url: 'jester://studio' }, { title: 'Download library', url: 'jester://downloads' }] },
  { id: 'empty', address: 'jester://empty', title: 'Empty Page', heading: '', description: '', kind: 'empty', reader: false, sections: [] },
  { id: 'guide', address: 'jester://guide', title: 'Scene guide', heading: 'Welcome to your production desktop', description: 'A practical guide to your fictional workspace.', kind: 'article', reader: true, sections: [{ title: 'Make something', body: 'Keep the call sheet nearby, sketch a set, and browse your saved images. A virtual download becomes a real canonical scene file, available to the desktop file applications.' }, { title: 'Your files stay here', body: 'Documents and images are fictional virtual files. Closing a browser window retains ordinary tabs and history. Private windows do not add visits, forms or closed tabs to the retained browser session.' }], links: [{ title: 'Visit the studio', url: 'jester://studio' }] },
  { id: 'journal', address: 'jester://journal', title: 'Studio journal', heading: 'Notes from the studio', description: 'A quiet morning by the coast', kind: 'article', reader: true, sections: [{ title: '09:00 — Light study', body: 'The coast reference is cool blue against warm sand. Try a dark outline with a single bright accent. The studio doors open onto a garden where the morning sun reaches the drawing table.' }, { title: '09:41 — Ready for rehearsal', body: 'The call sheet is on the desktop. Leave room for a new sketch and a rectangular crop for the prop board. Bring a notebook to rehearsal and record the changing light.' }], links: [{ title: 'Download the call sheet', url: 'jester://downloads' }] },
  { id: 'studio', address: 'jester://studio', title: 'Production desk', heading: 'Reserve a fictional studio visit', description: 'Sample form — do not enter real information. No account or network exists.', kind: 'form', reader: false, sections: [{ title: 'Sample identity', body: 'Use Casey Sample and casey@studio.invalid. The AutoFill sheet supplies only fictional built-in values; this is not a password manager for actual credentials.' }, { title: 'Site permissions', body: 'Camera, microphone, location, notifications and pop-ups are simulated site settings. Allowing a permission never accesses a device. A blocked sample pop-up can open the local journal in a tab.' }] },
  { id: 'confirmation', address: 'jester://confirmation', title: 'Fictional login confirmed', heading: 'You’re signed in to the sample studio', description: 'The fictional login was accepted inside this browser tab.', kind: 'article', reader: false, sections: [{ title: 'Sample reservation', body: 'Your tab retains its fictional form confirmation. No account, message, external request, real cookie or calendar appointment was created. Closing a private window discards this form state.' }], links: [{ title: 'Return to the production desk', url: 'jester://studio' }, { title: 'Read the studio journal', url: 'jester://journal' }] },
  { id: 'downloads', address: 'jester://downloads', title: 'Download library', heading: 'The production library', description: 'Locally authored documents for the virtual Downloads folder.', kind: 'download', reader: false, sections: [{ title: 'Call sheet', body: 'A text call sheet and a small coast reference image can be saved to the canonical virtual file store.' }], downloads: [{ name: 'Studio Call Sheet.txt', mime: 'text/plain', content: 'FICTIONAL STUDIO CALL SHEET\n09:00 Light study\n09:41 Ready for rehearsal\n10:00 Coast scene\nSample production — no actual appointments.\n' }, { name: 'Coast Reference.svg', mime: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#d7e7ea"/><path d="M0 200 Q180 130 320 205T640 180V360H0Z" fill="#769ba9"/><path d="M0 290Q240 220 640 280V360H0Z" fill="#d7c39d"/></svg>' }] },
  { id: 'about', address: 'jester://about', title: 'About this browser', heading: 'Your local browser', description: 'A native-era interior with a deliberately closed address space.', kind: 'about', reader: false, sections: [{ title: 'What works', body: 'Independent windows and tabs, loading and stop, history, bookmarks, reading list, Reader, find, zoom, local forms, permissions, source and inspector, and shared file, print and share bridges.' }, { title: 'Boundaries', body: 'There is no Internet, actual sign-in, certificate verification, installed extension code, device access or external search. Native browser names and controls are represented; authored pages are fictional.' }] },
  { id: 'unsafe', address: 'jester://unsafe', title: 'Security Demonstration', heading: 'A deliberately flagged fictional site', description: 'This authored page exercises the fraudulent-website warning preference; it contains no actual threat or external content.', kind: 'article', reader: false, sections: [{ title: 'Local warning policy', body: 'With the Security warning preference enabled, this page is blocked by a fictional warning. Turning the preference off and reloading displays this harmless fixture. No security service, certificate validation or request is contacted.' }] },
  { id: 'error', address: 'jester://offline', title: 'Cannot Open Page', heading: 'This page is not available offline', description: 'The local browser does not make external requests.', kind: 'error', reader: false, sections: [{ title: 'Try a local page', body: 'Choose a Favorite, enter jester://guide, or search the authored studio pages.' }] },
];
const byId = new Map(browserPages.map(page => [page.id, page]));
const fixtureURLs = new Map([['https://studio.invalid', 'studio'], ['https://journal.studio.invalid', 'journal'], ['https://unsafe.studio.invalid', 'unsafe']]);
export const browserSiteURLs = [...browserPages.map(page => page.address), ...fixtureURLs.keys()];
export const browserSVGFileId = address => /^jester:\/\/file\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(address)?.[1] ?? null;
export function browserSVGSource(file) {
  if (!file || file.deleted || typeof file.content !== 'string' || !/\.svg$/iu.test(file.name ?? '')) return null;
  if (/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/iu.test(file.content)) return file.content;
  if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/iu.test(file.content)) return null;
  // SVG-as-image disables script execution and external SVG resource loading.
  // These are the original File bytes, encoded for an actual native img decoder.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
}
export function browserCertificate(url) {
  if (!fixtureURLs.has(url)) return { status: url.startsWith('jester://') ? 'local' : 'offline', subject: '', issuer: '', serial: '', validFrom: '', validTo: '', explanation: 'No TLS connection or certificate exists for this authored local scheme. No network request was made.' };
  return { status: fixtureURLs.get(url) === 'unsafe' ? 'fictional-warning' : 'fictional-valid', subject: url.slice(8), issuer: 'Studio Fixture Authority — NOT a trusted CA', serial: 'JESTER-FIXTURE-0001', validFrom: '2017-01-01', validTo: '2099-12-31', explanation: 'Authored certificate details for the reserved .invalid local page. No genuine certificate, TLS handshake or external request exists.' };
}
export function resolveBrowserURL(input, { blockFraud = true, svgAvailable = true, svgError = false } = {}) {
  const value = String(input).toWellFormed().trim().slice(0, 2048);
  const normalized = value.toLowerCase().replace(/\/$/, '');
  const page = browserPages.find(page => page.address === normalized || page.id === normalized);
  const fileId = browserSVGFileId(value);
  if (fileId) return { url: `jester://file/${fileId}`, title: svgError ? 'Cannot Display Image' : svgAvailable ? 'Local SVG document' : 'Cannot Open Page', pageId: svgAvailable ? 'svg' : 'error', query: '', error: svgError ? 'decode' : svgAvailable ? '' : 'offline' };
  if (page) return siteEntry(page, page.address, blockFraud);
  if (fixtureURLs.has(normalized)) return siteEntry(byId.get(fixtureURLs.get(normalized)), normalized, blockFraud);
  if (value.startsWith('jester://search?q=')) return searchEntry(new URLSearchParams(value.slice(16)).get('q') ?? '');
  if (/^(?:[a-z][a-z\d+.-]*:|www\.|[^\s]+\.[a-z]{2,}(?:\/|$))/i.test(value)) return { url: value, title: 'Cannot Open Page', pageId: 'error', query: '', error: 'offline' };
  return searchEntry(value);
}
function siteEntry(page, url, blockFraud) {
  const blocked = page.id === 'unsafe' && blockFraud;
  return { url, title: blocked ? 'Fraudulent Website Warning' : page.title, pageId: page.id, query: '', error: blocked ? 'security' : page.id === 'error' ? 'offline' : '' };
}
function searchEntry(value) {
  let query = '', encoded = '', count = 0;
  for (const character of value.toWellFormed()) {
    const part = encodeURIComponent(character);
    if (count === 200 || 16 + encoded.length + part.length > 2048) break;
    query += character; encoded += part; count++;
  }
  return { url: `jester://search?q=${encoded}`, title: query ? `Search: ${query}`.slice(0, 256).toWellFormed() : 'Studio Search', pageId: 'search', query, error: '' };
}
export function browserSearchResults(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return browserPages.filter(page => page.id !== 'error' && page.id !== 'home' && terms.every(term => `${page.title} ${page.description} ${page.sections.map(s => `${s.title} ${s.body}`).join(' ')}`.toLowerCase().includes(term)));
}
export function browserPage(entry) {
  if (entry.pageId === 'svg') return { id: 'svg', address: entry.url, title: entry.title, heading: entry.title, description: 'Original virtual File · SVG image decoded by the browser, not Preview.', kind: 'image', reader: false, sections: [] };
  if (entry.error === 'security') return { id: 'unsafe', address: entry.url, title: entry.title, heading: 'Fraudulent Website Warning', description: 'This fictional local site is blocked by your warning preference.', kind: 'error', reader: false, sections: [] };
  if (entry.pageId === 'search') return { id: 'search', address: entry.url, title: entry.title, heading: 'Studio Search', description: `Fictional local results for “${entry.query}”`, kind: 'search', reader: false, sections: [], links: browserSearchResults(entry.query).map(p => ({ title: p.title, url: p.address })) };
  return byId.get(entry.pageId) ?? byId.get('error');
}
export const pageText = entry => { const page = browserPage(entry); return [page.heading, page.description, ...page.sections.flatMap(s => [s.title, s.body]), ...(page.links ?? []).map(s => s.title)].join('\n\n'); };
const escape = text => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
export function pageSource(entry) {
  const page = browserPage(entry);
  const form = page.kind === 'form' ? '<form data-local-only><label>Name<input name="name"></label><label>Email<input name="email" type="email"></label><label>Message<textarea name="message"></textarea></label><label>Fictional password<input name="password" readonly></label><button type="submit">Log In</button></form>' : '';
  const downloads = (page.downloads ?? []).map(asset => `<button data-local-download="${escape(asset.name)}">${escape(asset.name)}</button>`).join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escape(page.title)}</title></head>\n<body><main><h1>${escape(page.heading)}</h1><p>${escape(page.description)}</p>\n${page.sections.map(section => `<section><h2>${escape(section.title)}</h2><p>${escape(section.body)}</p></section>`).join('\n')}\n${(page.links ?? []).map(link => `<a href="${escape(link.url)}">${escape(link.title)}</a>`).join('\n')}\n${form}\n${downloads}\n</main></body></html>`;
}

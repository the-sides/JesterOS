import { text, identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState, liveFile, children, writeFile, validName, resolvePath, pathOf } from './windows11-app-helpers.js';

export const menus = ['profiles'];
const session = id => ({ id, cwd: 'root', input: '', lines: ['Windows PowerShell', 'Local scene terminal — deterministic virtual commands only.', 'Type help for available commands. No host commands, network, or processes.'], history: [], historyIndex: 0, draft: '' });
export const createState = () => ({ ui: uiState(), tabs: [session('terminal-1')], activeTabId: 'terminal-1', nextTabId: 2, theme: 'dark', fontSize: 14 });
const target = object({ tabId: identity });
export const specs = {
  'win11.terminal.new': [empty, empty],
  'win11.terminal.activate': [target, empty],
  'win11.terminal.closeTab': [target, empty],
  'win11.terminal.input': [target, object({ input: text })],
  'win11.terminal.run': [target, empty, ['Parse local input; unsupported commands print an explicit error, never call a host shell.'], ['Supported commands use the shared session virtual filesystem.']],
  'win11.terminal.history': [target, object({ direction: choice('previous', 'next') })],
  'win11.terminal.clear': [target, empty],
  'win11.terminal.dialog.open': [empty, object({ kind: choice('settings', 'about') })],
  'win11.terminal.dialog.close': [empty, empty],
  'win11.terminal.settings': [empty, object({ theme: choice('dark', 'light'), fontSize: { type: 'integer', minimum: 10, maximum: 24 } })],
};
function tokens(input) {
  const result = []; const redirections = []; let token = ''; let quote = null; let started = false;
  for (const char of input.trim()) {
    if (quote) { if (char === quote) quote = null; else token += char; started = true; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { result.push(token); token = ''; started = false; } }
    else if (/[|;&]/.test(char)) return { error: 'Pipelines, chaining, and host execution are unsupported.', unsupported: true };
    else if (char === '>') { if (started) result.push(token); redirections.push(result.length); result.push('>'); token = ''; started = false; }
    else { token += char; started = true; }
  }
  if (quote) return { error: 'Unterminated quoted argument.' };
  if (started) result.push(token); return { values: result, redirections };
}
function destination(apps, path, cwd, fallbackName) {
  const existing = resolvePath(apps, path, cwd);
  if (existing?.kind === 'folder') return { folderId: existing.id, name: fallbackName };
  if (existing) return { error: 'Destination already exists; overwriting is not supported.' };
  const normalized = path.replace(/\\/g, '/'); const index = normalized.lastIndexOf('/');
  const name = index < 0 ? normalized : normalized.slice(index + 1);
  const parent = index < 0 ? liveFile(apps, cwd) : resolvePath(apps, normalized.slice(0, index) || '/', cwd);
  if (parent?.kind !== 'folder' || !validName(name)) return { error: 'Destination folder or file name is invalid.' };
  return { folderId: parent.id, name };
}
export function createCommands(apps, context) {
  const state = apps.terminal;
  const tab = id => state.tabs.find(item => item.id === id);
  const add = () => { const item = session(`terminal-${state.nextTabId++}`); state.tabs.push(item); state.activeTabId = item.id; return item; };
  const errorOf = result => result.error?.message || result.message || 'Virtual filesystem command was rejected.';
  async function interpret(item, input) {
    const parsed = tokens(input); if (parsed.error) return parsed;
    const [raw, ...args] = parsed.values; if (!raw) return { lines: [] };
    const name = raw.toLowerCase();
    const supported = ['pwd', 'cd', 'dir', 'ls', 'cat', 'type', 'echo', 'mkdir', 'touch', 'copy', 'move', 'rename', 'del', 'restore', 'help', 'cls'];
    if (!supported.includes(name)) return { error: `Unsupported command: ${raw}. Type help for local commands.`, unsupported: true };
    if (name !== 'echo' && parsed.redirections.length) return { error: 'Redirection outside echo is unsupported.', unsupported: true };
    const exact = count => args.length === count;
    const path = value => resolvePath(apps, value, item.cwd);
    const invoke = async (command, target, payload = {}) => { const result = await context.invoke(command, target, payload); return result.status === 'applied' ? { lines: ['Operation completed.'] } : { error: errorOf(result) }; };
    if (name === 'help') return exact(0) ? { lines: ['pwd                        Show current virtual folder', 'cd [path]                  Change folder / show current path', 'dir / ls [path]            List virtual files', 'cat / type <path>          Read a text file', 'echo <text>                Print text', 'echo <text> > <path>       Write a shared text file', 'mkdir <path>               Create a folder', 'touch <path>               Create a new empty text file', 'copy / move <src> <dest>   Copy / move a file or folder', 'rename <path> <name>       Rename a file or folder', 'del <path>                 Move item to Recycle Bin', 'restore <id|name|path>     Restore an item from Recycle Bin', 'cls                        Clear this tab', 'help                       Show this help', 'Quote paths containing spaces. No host shell, wildcards, flags, pipelines, network, or scripts.'] } : { error: 'Usage: help' };
    if (name === 'pwd' || name === 'cls') return !exact(0) ? { error: `Usage: ${name}` } : name === 'cls' ? { clear: true, lines: [] } : { lines: [pathOf(apps, item.cwd)] };
    if (name === 'cd') {
      if (!args.length) return { lines: [pathOf(apps, item.cwd)] };
      if (!exact(1)) return { error: 'Usage: cd <path>' };
      const file = path(args[0]); if (file?.kind !== 'folder') return { error: 'Folder not found.' };
      return { cwd: file.id, lines: [] };
    }
    if (name === 'dir' || name === 'ls') {
      if (args.length > 1) return { error: `Usage: ${name} [path]` };
      if (args[0]?.toLowerCase() === 'trash') return { lines: ['Recycle Bin', ...children(apps, 'trash').map(file => `${file.id}  ${file.name}`)] };
      const file = args.length ? path(args[0]) : liveFile(apps, item.cwd);
      if (!file) return { error: 'Path not found.' };
      const list = file.kind === 'folder' ? children(apps, file.id) : [file];
      return { lines: [pathOf(apps, file.id), ...list.map(entry => `${entry.kind === 'folder' ? '<DIR>' : '     '}  ${entry.name}`), `${list.length} item(s)`] };
    }
    if (name === 'cat' || name === 'type') { if (!exact(1)) return { error: `Usage: ${name} <path>` }; const file = path(args[0]); return file?.kind === 'text' ? { lines: file.content.split('\n') } : { error: 'Live text file not found.' }; }
    if (name === 'echo') {
      const at = parsed.redirections.length ? parsed.redirections[0] - 1 : -1; if (at < 0) return { lines: [args.join(' ')] };
      if (at !== args.length - 2 || parsed.redirections.length !== 1) return { error: 'Usage: echo <text> > <path>' };
      const content = args.slice(0, at).join(' '); const file = path(args[at + 1]);
      if (file) { if (file.kind !== 'text') return { error: 'Destination is not a text file.' }; writeFile(apps, file, content); return { lines: ['Text saved to shared virtual file.'] }; }
      const dest = destination(apps, args[at + 1], item.cwd, ''); if (dest.error) return dest;
      const result = await context.invoke('win11.explorer.create', { folderId: dest.folderId }, { name: dest.name, kind: 'text' });
      if (result.status !== 'applied') return { error: errorOf(result) };
      const created = liveFile(apps, result.target.fileId); writeFile(apps, created, content); return { lines: ['Text saved to shared virtual file.'] };
    }
    if (name === 'mkdir' || name === 'touch') {
      if (!exact(1)) return { error: `Usage: ${name} <new-path>` };
      if (path(args[0])) return { error: 'Path already exists.' };
      const dest = destination(apps, args[0], item.cwd, ''); if (dest.error) return dest;
      return invoke('win11.explorer.create', { folderId: dest.folderId }, { name: dest.name, kind: name === 'mkdir' ? 'folder' : 'text' });
    }
    if (name === 'restore') {
      if (!exact(1)) return { error: 'Usage: restore <id|name|path>' };
      const value = args[0].toLowerCase(); const matches = children(apps, 'trash').filter(file => file.id.toLowerCase() === value || file.name.toLowerCase() === value || pathOf(apps, file.id).toLowerCase() === value);
      if (matches.length !== 1) return { error: matches.length ? 'Ambiguous name; use the file ID from dir trash.' : 'Deleted item not found. Use dir trash.' };
      return invoke('win11.explorer.restore', { fileId: matches[0].id });
    }
    const count = name === 'del' ? 1 : 2; if (!exact(count)) return { error: `Usage: ${name} <path>${count === 2 ? ' <destination>' : ''}` };
    const source = path(args[0]); if (!source) return { error: 'Source path not found.' };
    if (name === 'del') return invoke('win11.explorer.trash', { fileId: source.id });
    if (name === 'rename') return invoke('win11.explorer.rename', { fileId: source.id }, { name: args[1] });
    const dest = destination(apps, args[1], item.cwd, source.name); if (dest.error) return dest;
    return invoke(`win11.explorer.${name}`, { fileId: source.id }, dest);
  }
  return {
    'win11.terminal.new': () => { if (state.ui.dialog) return invalid('Close the dialog first.'); const item = add(); state.ui.menu = null; return applied({ tabId: item.id }); },
    'win11.terminal.activate': ({ tabId }) => { if (!tab(tabId)) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.'); state.activeTabId = tabId; return applied({ tabId }); },
    'win11.terminal.closeTab': ({ tabId }) => { const index = state.tabs.findIndex(item => item.id === tabId); if (index < 0) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.'); state.tabs.splice(index, 1); if (tabId === state.activeTabId) state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)]?.id || null; if (!state.tabs.length) add(); return applied({ tabId }); },
    'win11.terminal.input': ({ tabId }, { input }) => { const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.'); item.input = input; item.historyIndex = item.history.length; item.draft = input; return applied({ tabId }); },
    'win11.terminal.run': async ({ tabId }) => {
      const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.');
      if (liveFile(apps, item.cwd)?.kind !== 'folder') return stale('Current folder was deleted. Open a new tab to start at C:.');
      const input = item.input; const result = await interpret(item, input);
      if (input.trim()) item.history.push(input); item.historyIndex = item.history.length; item.draft = ''; item.input = '';
      if (result.clear) item.lines = []; else item.lines.push(`PS ${pathOf(apps, item.cwd)}> ${input}`, ...(result.error ? [`Error: ${result.error}`] : result.lines || []));
      if (result.cwd) item.cwd = result.cwd;
      return applied({ tabId }, { supported: !result.unsupported, succeeded: !result.error });
    },
    'win11.terminal.history': ({ tabId }, { direction }) => { const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.'); const index = item.historyIndex + (direction === 'previous' ? -1 : 1); if (index < 0 || index > item.history.length) return stale('No more history.'); if (item.historyIndex === item.history.length) item.draft = item.input; item.historyIndex = index; item.input = item.history[index] ?? item.draft; return applied({ tabId }); },
    'win11.terminal.clear': ({ tabId }) => { const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (state.ui.dialog) return invalid('Close the dialog first.'); item.lines = []; state.ui.menu = null; return applied({ tabId }); },
    'win11.terminal.dialog.open': (_, { kind }) => { if (state.ui.dialog) return invalid('A dialog is already open.'); state.ui.dialog = { kind }; state.ui.menu = null; return applied(); },
    'win11.terminal.dialog.close': () => { if (!state.ui.dialog) return stale(); state.ui.dialog = null; return applied(); },
    'win11.terminal.settings': (_, { theme, fontSize }) => { if (state.ui.dialog?.kind !== 'settings') return stale('Settings is not open.'); state.theme = theme; state.fontSize = fontSize; return applied(); },
  };
}
export function readTargets(apps) {
  const state = apps.terminal;
  return { activeTabId: state.activeTabId, tabs: state.tabs.map(item => ({ id: item.id, cwd: item.cwd, path: pathOf(apps, item.cwd), cwdAvailable: liveFile(apps, item.cwd)?.kind === 'folder', input: item.input, history: [...item.history], historyIndex: item.historyIndex })), theme: state.theme, fontSize: state.fontSize, supportedCommands: ['pwd', 'cd', 'dir', 'ls', 'cat', 'type', 'echo', 'mkdir', 'touch', 'copy', 'move', 'rename', 'del', 'restore', 'help', 'cls'], menu: state.ui.menu, dialog: state.ui.dialog ? { ...state.ui.dialog } : null };
}

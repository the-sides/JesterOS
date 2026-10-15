<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import LocalPdfQuickLook from './MessagesPdfQuickLook.svelte';
  import { mailWindow, visibleMailMessages, mailboxCount, mailCapabilities, mailPlainToHtml, mailRecipientParts, mailDisplayAddress, MAIL_TOOLBAR, MAIL_PANES } from './mail-state.js';
  import { mailMenuProvider } from './mail-menus.js';
  import { createMailNativeView } from './mail-native-view.js';
  import { AUDIO_FIXTURES } from './audio-fixtures.js';
  import './mail.css';

  let { state: mailData, profile, windowId, execute, registerView, available = true, active = true, showLocalMenus = true, controls = {} } = $props();
  const { onclose, onminimize, onzoom, onfullscreen, onsplitbegin, onsplitside, ongreenmenu } = controls;
  function canonicRenderer(candidate) {
    const source = typeof candidate === 'string' ? candidate : candidate?.renderer ?? candidate?.id ?? '';
    for (const key of ['high-sierra', 'mojave', 'sonoma', 'golden-gate', 'windows11']) if (source.startsWith(key)) return key;
    return source.includes('windows11') ? 'windows11' : 'sonoma';
  }
  let root;
  let bodyControl;
  let soundNode;
  let soundSource = $state('');
  let mounted = false;
  let originalState;
  let originalRoot;
  let error = $state('');
  let openMenu = $state('');
  let sheet = $state('');
  let form = $state({});
  let recipientField = $state('');
  let suggestions = $state([]);
  let recipientRequest = 0;
  let expandedAccounts = $state({});
  let selectedAccountId = $state('');
  let selectedSignatureId = $state('');
  let selectedRuleId = $state('');
  let accountForm = $state({ name: '', email: '' });
  let signatureForm = $state({ name: '', text: '' });
  let ruleForm = $state({ name: '', enabled: true, field: 'sender', match: '', action: 'flag', mailboxId: '' });
  let toolbarItems = $state([]);
  let preview = $state(null);
  let sheetReturnFocus = null;
  let focusedSheet = '';
  $effect(() => {
    const kind = currentSheet;
    if (!mounted || !root || kind === focusedSheet) return;
    focusedSheet = kind;
    if (kind) {
      if (!sheetReturnFocus) sheetReturnFocus = root.contains(document.activeElement) ? document.activeElement : null;
      tick().then(() => {
        if (!owns() || currentSheet !== kind) return;
        const dialog = root.querySelector('.mail-sheet');
        (dialog?.querySelector('input:not([disabled]), textarea:not([disabled]), [data-mail-control="continue-compose"], [data-mail-control="sheet-cancel"], [data-mail-control="toolbar-done"], [data-mail-control="preview-done"]') ?? dialog?.querySelector('button:not([disabled])'))?.focus();
      });
    } else {
      const destination = sheetReturnFocus;
      sheetReturnFocus = null;
      tick().then(() => { if (owns() && !currentSheet && destination?.isConnected && root.contains(destination) && !destination.disabled) destination.focus({ preventScroll: true }); });
    }
  });

  const profileId = $derived(profile?.id && ['high-sierra', 'mojave', 'sonoma', 'golden-gate', 'windows11'].includes(profile.id) ? profile.id : canonicRenderer(profile));
  const windows = $derived(profileId === 'windows11' || typeof profile?.family === 'string' && profile.family.startsWith('windows'));
  const classic = $derived(profileId === 'high-sierra' || profileId === 'mojave');
  const view = $derived(mailWindow(mailData, windowId));
  const messages = $derived(visibleMailMessages(mailData, windowId));
  const selected = $derived(mailData.messages.find(message => message.id === view?.selectedIds?.[0]));
  const mailbox = $derived(mailData.mailboxes.find(item => item.id === view?.mailboxId));
  const draft = $derived(mailData.drafts.find(item => item.id === view?.draftId));
  const draftSignature = $derived(mailData.signatures.find(item => item.id === draft?.signatureId)?.text ?? '');
  const menus = $derived(mailMenuProvider({ state: mailData, profile, windowId }));
  const capabilities = $derived(mailCapabilities(typeof profile === 'string' ? { id: profile, renderer: profile } : profile));
  const preferences = $derived(mailData.preferences);
  const panes = [...MAIL_PANES];
  const tools = [...MAIL_TOOLBAR];
  const toolLabels = { get: 'Get Mail', compose: windows ? 'New mail' : 'New Message', reply: 'Reply', replyAll: 'Reply All', forward: 'Forward', archive: 'Archive', junk: windows ? 'Junk' : 'Junk Mail', delete: 'Delete', flag: 'Flag', read: 'Mark Read', move: 'Move', search: 'Search' };
  const iconPaths = {
    get: 'M3 5h18v14H3z M3 6l9 7 9-7', compose: 'M4 7v13h13 M9 15l2-5L19 2l3 3-8 8z', reply: 'M9 5L3 10l6 5 M3 10h10c5 0 7 3 7 8', replyAll: 'M8 5l-5 5 5 5 M13 5l-5 5 5 5 M8 10h7c4 0 6 3 6 8', forward: 'M15 5l6 5-6 5 M21 10H11c-5 0-7 3-7 8', archive: 'M3 4h18v5H3z M5 9v12h14V9 M9 13h6', junk: 'M12 2l10 18H2z M12 8v5 M12 16v1', delete: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', flag: 'M5 22V3 M5 3h14l-3 5 3 5H5', read: 'M3 8l9-6 9 6v13H3z M3 8l9 7 9-7', move: 'M2 6h8l2 3h10v12H2z M12 12l3 3-3 3 M7 15h8', search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l7 7', settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2', sidebar: 'M3 4h18v16H3z M9 4v16', attach: 'M8 15l8-8a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L14 3', send: 'M2 3l20 9-20 9 4-9z M6 12h16', more: 'M4 12h1 M11 12h1 M18 12h1', folder: 'M2 6h8l2 3h10v12H2z', smart: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'
  };
  const readerMessages = $derived(selected ? view.threaded ? mailData.messages.filter(item => item.threadId === selected.threadId && item.mailboxId === selected.mailboxId) : [selected] : []);
  const currentSheet = $derived(sheet || (view?.sheet && view.sheet !== 'none' ? view.sheet : ''));
  const freshForm = kind => ({ name: '', email: '', value: '', accountId: '', field: 'unread', mime: 'text/plain', text: '', ...(kind === 'attach' ? { name: 'Document.txt' } : {}) });
  let lastCanonicalSheet = '';
  $effect(() => {
    const canonical = view?.sheet && view.sheet !== 'none' ? view.sheet : '';
    if (!canonical && lastCanonicalSheet && sheet === lastCanonicalSheet) sheet = '';
    lastCanonicalSheet = canonical;
    if (!canonical || sheet) return;
    sheet = canonical;
    if (canonical === 'toolbar') { if (!toolbarItems.length) toolbarItems = [...view.toolbar]; return; }
    if (form.__kind !== canonical) form = { __kind: canonical, ...freshForm(canonical) };
  });

  function owns() {
    return mounted && available && root === originalRoot && mailData === originalState && root?.isConnected && !root.closest('[hidden], [inert]');
  }
  async function command(name, target = {}, payload = {}) {
    if (!owns()) return null;
    const owner = root;
    const ownerState = mailData;
    try {
      const result = await execute(name, name.startsWith('mail.') ? { windowId, ...target } : target, payload);
      if (owner === root && ownerState === mailData && owns()) {
        error = result?.status === 'rejected' || result?.status === 'unavailable' ? result.error?.message ?? result.message ?? 'This operation is unavailable.' : '';
      }
      return result;
    } catch (cause) {
      if (owner === root && ownerState === mailData && owns()) error = cause?.message ?? 'The operation could not be completed.';
      return null;
    }
  }
  const applied = result => result?.status === 'applied';
  const preference = (key, value) => command('mail.preferences.set', {}, { [key]: value });
  const updateDraft = (field, value) => command('mail.draft.update', {}, { field, value });
  const action = (action, mailboxId) => command('mail.message.action', {}, { action, ...(mailboxId ? { mailboxId } : {}) });
  const compose = mode => command('mail.compose.new', {}, { mode, ...(mode !== 'new' && selected ? { messageId: selected.id } : {}) });
  const visibleMailbox = item => !item.accountId || mailData.accounts.some(account => account.id === item.accountId && account.enabled);
  const dateLabel = date => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fullDate = date => new Date(date).toLocaleString();
  function openForm(kind, values = {}) {
    form = { ...values, __kind: kind };
    if (view?.sheet && view.sheet !== 'none' && view.sheet !== kind) command('mail.view.set', {}, { sheet: 'none' });
    sheet = kind; openMenu = '';
  }
  function closeSheet() {
    sheet = ''; preview = null;
    if (view?.sheet && view.sheet !== 'none') command('mail.view.set', {}, { sheet: 'none' });
  }
  async function submitForm(event) {
    event.preventDefault();
    let result;
    if (sheet === 'mailbox' || sheet === 'smart') result = await command('mail.mailbox.create', {}, { name: form.name, smart: sheet === 'smart', ...(sheet === 'smart' ? { field: form.field, value: form.value } : {}), ...(form.accountId ? { accountId: form.accountId } : {}) });
    else if (sheet === 'rename') result = await command('mail.mailbox.rename', {}, { mailboxId: form.mailboxId, name: form.name });
    else if (sheet === 'account') result = await command('mail.account.add', {}, { name: form.name, email: form.email });
    else if (sheet === 'attach') result = await command('mail.draft.attach', {}, { name: form.name, mime: form.mime, text: form.text });
    if (applied(result) && owns()) closeSheet();
  }
  async function resolveRecipients(field, value) {
    const request = ++recipientRequest;
    const ownerDraft = draft?.id;
    suggestions = [];
    recipientField = field;
    await updateDraft(field, value);
    if (request !== recipientRequest || !owns() || ownerDraft !== draft?.id) return;
    const query = mailRecipientParts(value).at(-1)?.trim() ?? '';
    if (!query) return;
    const result = await command('mail.recipients.resolve', {}, { query, field });
    if (request !== recipientRequest || !owns() || ownerDraft !== draft?.id || recipientField !== field) return;
    if (applied(result) && Array.isArray(result.contacts)) suggestions = result.contacts.map(person => ({ name: person.name ?? '', email: person.email }));
  }
  async function chooseRecipient(person) {
    const request = ++recipientRequest, field = recipientField, ownerDraft = draft?.id;
    const result = await command('mail.recipients.choose', {}, { field, email: person.email, name: person.name ?? '' });
    if (request !== recipientRequest || !owns() || draft?.id !== ownerDraft || recipientField !== field) return;
    if (applied(result)) { suggestions = []; await command('mail.native.focus', {}, { control: field }); }
  }
  function recipientKey(event) {
    if (event.key === 'Escape') { suggestions = []; ++recipientRequest; }
    if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); command('mail.native.focus', {}, { control: `recipient:${recipientField}:0` }); }
  }
  function suggestionKey(event, index) {
    if (event.key === 'Escape') { event.preventDefault(); suggestions = []; ++recipientRequest; command('mail.native.focus', {}, { control: recipientField }); }
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? suggestions.length - 1 : Math.max(0, Math.min(suggestions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      command('mail.native.focus', {}, { control: `recipient:${recipientField}:${next}` });
    }
  }
  function format(style) {
    const start = bodyControl?.selectionStart;
    const end = bodyControl?.selectionEnd;
    command('mail.draft.format', {}, { style, ...(Number.isInteger(start) ? { start, end } : {}) });
  }
  async function attachmentPreview(message, attachment) {
    const result = await command('mail.attachment.preview', { messageId: message.id, attachmentId: attachment.id });
    const detail = applied(result) ? result.attachment : null;
    if (detail?.text !== undefined && owns()) { preview = { name: detail.name ?? attachment.name, mime: detail.mime ?? attachment.mime, text: detail.text, dataURI: detail.text }; sheet = 'preview'; }
  }
  function toolbarAction(tool) {
    if (tool === 'get') command('mail.connection.check');
    else if (tool === 'compose') compose('new');
    else if (['reply', 'replyAll', 'forward'].includes(tool)) compose(tool);
    else if (tool === 'search') command('mail.native.focus', {}, { control: 'search' });
    else if (tool === 'move') openForm('move');
    else if (tool === 'flag') action(selected?.flagged ? 'unflag' : 'flag');
    else if (tool === 'read') action(selected?.read ? 'unread' : 'read');
    else action(tool);
  }
  function rowKey(event, message) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const index = messages.findIndex(item => item.id === message.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? messages.length - 1 : Math.max(0, Math.min(messages.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const row = messages[next];
    if (row) { command('mail.message.select', {}, { messageId: row.id, extend: event.shiftKey }); command('mail.native.focus', {}, { control: `message:${row.id}` }); }
  }
  function keyboard(event) {
    if (!active || !owns() || event.defaultPrevented) return;
    if (currentSheet && event.key === 'Tab') {
      const nodes = [...root.querySelectorAll('.mail-sheet button:not([disabled]), .mail-sheet input:not([disabled]), .mail-sheet textarea:not([disabled]), .mail-sheet select:not([disabled])')].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last || !nodes.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      return;
    }
    if (event.key === 'Escape') { openMenu = ''; suggestions = []; if (currentSheet) closeSheet(); return; }
    if (!(windows ? event.ctrlKey : event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); compose('new'); }
    else if (key === 'f' && !event.shiftKey) { event.preventDefault(); command('mail.native.focus', {}, { control: 'search' }); }
    else if (key === 's' && draft) { event.preventDefault(); command('mail.draft.save'); }
    else if ((windows ? key === 'enter' : key === 'd' && event.shiftKey) && draft) { event.preventDefault(); command('mail.draft.send'); }
    else if (key === 'r' && selected && !draft) { event.preventDefault(); compose(event.shiftKey ? 'replyAll' : 'reply'); }
  }
  function loadAccount(id) { selectedAccountId = id; const account = mailData.accounts.find(item => item.id === id); accountForm = account ? { name: account.name, email: account.email } : { name: '', email: '' }; }
  function loadSignature(id) { selectedSignatureId = id; const signature = mailData.signatures.find(item => item.id === id); signatureForm = signature ? { name: signature.name, text: signature.text } : { name: '', text: '' }; }
  function loadRule(id) { selectedRuleId = id; const rule = mailData.rules.find(item => item.id === id); ruleForm = rule ? { name: rule.name, enabled: rule.enabled, field: rule.field, match: rule.match, action: rule.action, mailboxId: rule.mailboxId ?? '' } : { name: '', enabled: true, field: 'sender', match: '', action: 'flag', mailboxId: '' }; }
  async function saveAccount(event) { event.preventDefault(); const result = await command(selectedAccountId ? 'mail.account.update' : 'mail.account.add', {}, { ...(selectedAccountId ? { accountId: selectedAccountId } : {}), ...accountForm }); if (applied(result)) loadAccount(selectedAccountId); }
  async function saveSignature(event) { event.preventDefault(); const result = await command('mail.signature.save', {}, { ...(selectedSignatureId ? { signatureId: selectedSignatureId } : {}), ...signatureForm }); if (applied(result)) loadSignature(selectedSignatureId); }
  async function saveRule(event) { event.preventDefault(); const result = await command('mail.rule.save', {}, { ...(selectedRuleId ? { ruleId: selectedRuleId } : {}), ...ruleForm, mailboxId: ruleForm.action === 'move' ? ruleForm.mailboxId : null }); if (applied(result) && selectedRuleId) loadRule(selectedRuleId); }
  async function customizeToolbar() { toolbarItems = [...view.toolbar]; const result = await command('mail.toolbar.open'); if (applied(result)) sheet = 'toolbar'; }
  async function setToolbar() { const result = await command('mail.toolbar.set', {}, { items: toolbarItems }); if (applied(result)) sheet = ''; }
  function dismissMenus(event) { if (openMenu && !event.target.closest?.('[data-mail-menu]')) openMenu = ''; }
  let facade = null;
  onMount(() => {
    mounted = true; originalState = mailData; originalRoot = root;
    facade = createMailNativeView({ getRoot: () => owns() ? root : null, getState: () => mailData, windowId: String(windowId), available: () => owns(), tick });
    facade.playSound = async (spec, guard) => {
      if (!owns() || guard() !== true || spec.kind !== 'new-mail-preview') return false;
      soundNode?.pause();
      soundSource = AUDIO_FIXTURES.quicktime.src;
      await tick();
      const original = soundNode;
      if (!owns() || guard() !== true || !original?.isConnected) return false;
      original.currentTime = 0;
      try {
        await original.play();
        if (!owns() || guard() !== true || soundNode !== original) { original.pause(); return false; }
        return true;
      } catch { if (owns()) error = 'The original authored local Mail sound could not play.'; return false; }
    };
    registerView?.(facade);
    const disposed = facade;
    return () => { soundNode?.pause(); mounted = false; ++recipientRequest; disposed.destroy?.(); registerView?.(null, disposed); facade = null; };
  });
</script>

{#snippet icon(name)}
  <svg class="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[name] ?? iconPaths.get} /></svg>
{/snippet}
{#snippet menuItems(items)}
  {#each items as item (item.id)}
    {#if item.children?.length}
      <details class="mail-submenu"><summary data-mail-control={`menu:${item.id}`}>{item.label}</summary><div role="group">{@render menuItems(item.children)}</div></details>
    {:else if item.separator}
      <hr />
    {:else if item.request}
      <button type="button" role={item.radio ? 'menuitemradio' : 'menuitem'} data-mail-control={`menu:${item.id}`} aria-checked={item.radio ? item.checked === true : undefined} disabled={!available || item.enabled === false} onclick={() => { openMenu = ''; command(item.request.command, item.request.target ?? {}, item.request.payload ?? {}); }}><span class="mail-menu-check">{item.radio ? (item.checked ? '●' : '') : item.checked ? '✓' : ''}</span>{item.label}{#if item.shortcut}<kbd aria-hidden="true">{item.shortcut}</kbd>{/if}</button>
    {:else}
      <button type="button" role="menuitem" data-mail-control={`menu:${item.id}`} disabled>{item.label}</button>
    {/if}
  {/each}
{/snippet}
{#snippet mailboxRow(item)}
  {#if visibleMailbox(item)}
  <div class="mail-folder-row" class:selected={view.mailboxId === item.id}>
    <button type="button" data-mail-control={`mailbox:${item.id}`} aria-current={view.mailboxId === item.id ? 'page' : undefined} onclick={() => command('mail.mailbox.select', {}, { mailboxId: item.id })}>
      {@render icon(item.kind === 'smart' ? 'smart' : ['inbox', 'sent', 'outbox'].includes(item.kind) ? 'get' : item.kind === 'trash' ? 'delete' : item.kind === 'archive' ? 'archive' : 'folder')}
      <span>{item.name}</span>{#if mailboxCount(mailData, item.id)}<b>{mailboxCount(mailData, item.id)}</b>{/if}
    </button>
    <button type="button" class="mail-favorite" data-mail-control={`favorite:${item.id}`} aria-label={`${item.favorite ? 'Remove' : 'Add'} ${item.name} ${item.favorite ? 'from' : 'to'} favorites`} aria-pressed={item.favorite} onclick={() => command('mail.mailbox.favorite', {}, { mailboxId: item.id, favorite: !item.favorite })}>{item.favorite ? '★' : '☆'}</button>
  </div>
  {/if}
{/snippet}

<svelte:window onkeydown={keyboard} />
<svelte:document onpointerdown={dismissMenus} />
<section bind:this={root} class="mail-app" class:mail-windows={windows} class:mail-classic={classic} class:mail-modern={!classic && !windows} class:inactive={!active} data-mail-window-id={windowId} data-mail-profile={profileId} data-mail-counterpart={windows ? 'Windows Mail UWP 2023' : 'Apple Mail'} data-mail-kind={view?.kind} aria-label={windows ? 'Mail — Windows Mail' : 'Mail'} inert={!available}>
  <audio bind:this={soundNode} src={soundSource || undefined} preload="none" aria-label="JesterOS Original local new-mail sound"></audio>
  {#if !windows}
    <header class="mail-titlebar" data-window-drag>
      <WindowControls onclose={onclose ?? (() => command('mail.window.close'))} {onminimize} {onzoom} {onfullscreen} {onsplitbegin} {onsplitside} {ongreenmenu} {active} />
      <strong>{view?.kind === 'compose' ? draft?.subject || 'New Message' : view?.kind === 'preferences' ? capabilities.preferencesLabel : view?.kind === 'doctor' ? 'Connection Doctor' : view?.kind === 'activity' ? 'Activity' : view?.kind === 'help' ? 'Mail Help' : mailbox?.name || 'Mail'}</strong>
      <span class="mail-title-detail">{view?.kind === 'mailbox' ? `${messages.length} messages` : ''}</span>
    </header>
  {/if}
  {#if showLocalMenus}
  <nav class="mail-menubar" aria-label={windows ? 'Mail command equivalents' : 'Mail menus'}>
    {#each menus as menu (menu.id)}
      <div class="mail-menu" data-mail-menu={menu.id}>
        <button type="button" data-mail-control={`menu:${menu.id}`} aria-haspopup="menu" aria-expanded={openMenu === menu.id} onclick={() => openMenu = openMenu === menu.id ? '' : menu.id}>{menu.label}</button>
        {#if openMenu === menu.id}<div class="mail-menu-popup" role="menu" aria-label={menu.label}>{@render menuItems(menu.items)}</div>{/if}
      </div>
    {/each}
  </nav>
  {/if}
  {#if error}<div class="mail-error" role="alert"><span>{error}</span><button type="button" data-mail-control="dismiss-error" aria-label="Dismiss error" onclick={() => error = ''}>×</button></div>{/if}
  {#if view?.kind === 'compose' && draft}
    <div class="mail-compose-toolbar">
      <button type="button" class="mail-send" data-mail-control="send" onclick={() => command('mail.draft.send')}>{@render icon('send')}<span>Send</span></button>
      <button type="button" data-mail-control="save-draft" onclick={() => command('mail.draft.save')}>Save Draft</button>
      <button type="button" data-mail-control="attach" onclick={() => openForm('attach', { name: 'Document.txt', mime: 'text/plain', text: '' })}>{@render icon('attach')}<span>Attach</span></button>
      <button type="button" data-mail-control="attach-files" onclick={() => command('mail.draft.chooseAttachment')}>{@render icon('attach')}<span>Attach from Files…</span></button>
      <span class="mail-toolbar-spacer"></span>
      <button type="button" data-mail-control="cancel-compose" onclick={() => openForm('cancel')}>Cancel</button>
    </div>
    <div class="mail-compose-addresses">
      <label><span>From:</span><select data-mail-control="from" value={draft.accountId} onchange={event => updateDraft('accountId', event.currentTarget.value)}>{#each mailData.accounts.filter(account => account.enabled) as account (account.id)}<option value={account.id}>{account.name} &lt;{account.email}&gt;</option>{/each}</select></label>
      {#each ['to', 'cc', 'bcc'] as field}
        <div class="mail-recipient-field"><label><span>{field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'}:</span><input data-mail-control={field} aria-label={field === 'to' ? 'Recipients' : field === 'cc' ? 'Carbon copy' : 'Blind carbon copy'} autocomplete="off" value={draft[field]} maxlength="4096" role="combobox" aria-autocomplete="list" aria-controls={`mail-recipients-${windowId}-${field}`} aria-expanded={recipientField === field && suggestions.length > 0} oninput={event => resolveRecipients(field, event.currentTarget.value)} onkeydown={recipientKey} /></label>
          {#if recipientField === field && suggestions.length}<div id={`mail-recipients-${windowId}-${field}`} class="mail-recipient-results" role="listbox" aria-label="Matching contacts">{#each suggestions as person, index}<button type="button" role="option" aria-selected="false" data-mail-control={`recipient:${field}:${index}`} onclick={() => chooseRecipient(person)} onkeydown={event => suggestionKey(event, index)}><strong>{person.name || person.email}</strong><span>{person.email}</span></button>{/each}</div>{/if}
        </div>
      {/each}
      <label><span>Subject:</span><input data-mail-control="subject" aria-label="Subject" value={draft.subject} maxlength="1024" oninput={event => updateDraft('subject', event.currentTarget.value)} /></label>
      <div class="mail-compose-options"><label>Signature <select data-mail-control="signature" value={draft.signatureId ?? ''} onchange={event => updateDraft('signatureId', event.currentTarget.value)}><option value="">None</option>{#each mailData.signatures as signature (signature.id)}<option value={signature.id}>{signature.name}</option>{/each}</select></label><label>Priority <select data-mail-control="priority" value={draft.priority} onchange={event => updateDraft('priority', event.currentTarget.value)}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label>{#if !capabilities.priorityNative}<span class="mail-note">Importance is exposed here as a local equivalent.</span>{/if}<label>Format <select data-mail-control="format" value={draft.format} onchange={event => format(event.currentTarget.value)}><option value="plain">Plain Text</option><option value="rich">Rich Text</option></select></label></div>
    </div>
    <div class="mail-format-toolbar" aria-label="Text formatting">
      {#each [['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['quote', 'Quote'], ['list', 'List']] as [style, label]}<button type="button" class={`mail-format-${style}`} data-mail-control={`format:${style}`} aria-label={style} onclick={() => format(style)}>{label}</button>{/each}
      <span class="mail-toolbar-spacer"></span><button type="button" data-mail-control="undo" disabled={draft.historyIndex <= 0} onclick={() => command('mail.draft.undo')}>Undo</button><button type="button" data-mail-control="redo" disabled={draft.historyIndex >= draft.history.length - 1} onclick={() => command('mail.draft.redo')}>Redo</button>
    </div>
    <textarea bind:this={bodyControl} class="mail-compose-body" data-mail-control="body" data-mail-area="reader" aria-label="Message body" maxlength={65536 - (draftSignature ? draftSignature.length + 2 : 0)} value={draft.body} oninput={event => updateDraft('body', event.currentTarget.value)} spellcheck="true"></textarea>
    {#if draftSignature}<pre class="mail-compose-signature" aria-label="Selected signature">{draftSignature}</pre>{/if}
    {#if draft.attachments.length}<div class="mail-draft-attachments">{#each draft.attachments as attachment (attachment.id)}<span>{@render icon('attach')}{attachment.name}<button type="button" data-mail-control={`remove-attachment:${attachment.id}`} aria-label={`Remove ${attachment.name}`} onclick={() => command('mail.draft.removeAttachment', {}, { attachmentId: attachment.id })}>×</button></span>{/each}</div>{/if}
    <footer class="mail-status"><span>{draft.dirty ? 'Edited' : 'Draft saved'} · {draft.format === 'rich' ? 'Rich text uses local formatting markers' : 'Plain text'}</span><span>Fictional local delivery</span></footer>
  {:else if view?.kind === 'preferences'}
    <div class="mail-preferences">
      <nav class="mail-preference-tabs" aria-label={windows ? 'Mail settings' : 'Mail preferences'}>{#each panes as pane}<button type="button" data-mail-control={`pane:${pane}`} class:selected={view.pane === pane} aria-current={view.pane === pane ? 'page' : undefined} onclick={() => command('mail.preferences.open', {}, { pane })}><span class="mail-pane-symbol" aria-hidden="true">{({ General: '⚙', Accounts: '@', 'Junk Mail': '⊘', 'Fonts & Colors': 'Aa', Viewing: '▤', Composing: '✎', Signatures: '⌁', Rules: '⇢' })[pane]}</span>{pane}</button>{/each}</nav>
      <div class="mail-preference-content" data-mail-area="settings">
        <h2>{view.pane}</h2>
        {#if windows}<p class="mail-boundary">Windows Mail UWP (2023), not Outlook. Native primary equivalents: accounts, folders, importance, signatures, conversations. Local extensions, explicitly marked: {#if !capabilities.smartNative}smart saved searches, {/if}{#if !capabilities.rulesNative}rules, {/if}{#if !capabilities.doctorNative}Connection Doctor, {/if}customized toolbar commands, and the Fonts &amp; Colors pane.</p>{/if}
        {#if view.pane === 'General'}
          <label class="mail-setting">Default account <select data-mail-control="default-account" value={preferences.defaultAccountId ?? ''} onchange={event => preference('defaultAccountId', event.currentTarget.value)}>{#each mailData.accounts as account (account.id)}<option value={account.id}>{account.name}</option>{/each}</select></label>
          <label class="mail-setting">Check for new messages <select data-mail-control="check-interval" value={preferences.checkInterval} onchange={event => preference('checkInterval', event.currentTarget.value)}><option value="manual">Manually</option><option value="minute">Every minute</option><option value="five">Every 5 minutes</option><option value="fifteen">Every 15 minutes</option></select></label>
          <label class="mail-check"><input type="checkbox" data-mail-control="play-sound" checked={preferences.playSound} onchange={event => preference('playSound', event.currentTarget.checked)} />Play a sound for new mail</label>
          <button type="button" data-mail-control="sound-preview" disabled={!preferences.playSound} title={preferences.playSound ? 'Preview the local new-mail sound' : 'Enable Play a sound for new mail first'} onclick={() => command('mail.sound.preview')}>Preview local new-mail sound</button>
          <p class="mail-note">Actual authored local WAV playback; not an Apple or Microsoft factory alert recording.</p>
          <p class="mail-note">Checks and delivery run against fictional accounts only; no remote server is contacted.</p>
        {:else if view.pane === 'Accounts'}
          <div class="mail-crud-layout"><div class="mail-record-list" data-mail-area="list">{#each mailData.accounts as account (account.id)}<button type="button" data-mail-control={`account:${account.id}`} class:selected={selectedAccountId === account.id} onclick={() => loadAccount(account.id)}><strong>{account.name}</strong><span>{account.email}</span><small>{account.connection}</small></button>{/each}<button type="button" data-mail-control="account-new" onclick={() => loadAccount('')}>＋ Add Account</button></div>
            <form class="mail-record-editor" onsubmit={saveAccount}><label>Name <input data-mail-control="account-name" bind:value={accountForm.name} maxlength="120" required /></label><label>Email <input data-mail-control="account-email" type="email" bind:value={accountForm.email} maxlength="254" required /></label>
              {#if selectedAccountId && mailData.accounts.some(item => item.id === selectedAccountId)}{@const account = mailData.accounts.find(item => item.id === selectedAccountId)}<label class="mail-check"><input type="checkbox" data-mail-control="account-enabled" checked={account.enabled} onchange={event => command('mail.account.update', {}, { accountId: account.id, enabled: event.currentTarget.checked })} />Enable this account</label><label class="mail-check"><input type="checkbox" data-mail-control="account-online" checked={account.online} onchange={event => command('mail.account.update', {}, { accountId: account.id, online: event.currentTarget.checked })} />Account online</label><label>Signature <select data-mail-control="account-signature" value={account.signatureId ?? ''} onchange={event => command('mail.account.update', {}, { accountId: account.id, signatureId: event.currentTarget.value || null })}><option value="">None</option>{#each mailData.signatures as signature (signature.id)}<option value={signature.id}>{signature.name}</option>{/each}</select></label><label>Local connection scenario <select data-mail-control="account-failure" value={account.failure} onchange={event => command('mail.account.update', {}, { accountId: account.id, failure: event.currentTarget.value })}><option value="none">Connected</option><option value="send">Sending fails</option><option value="receive">Receiving fails</option></select></label><p class="mail-note">{account.connection}</p>{/if}
              <div class="mail-form-actions"><button type="submit" data-mail-control="account-save">{selectedAccountId ? 'Save Changes' : 'Add Account'}</button>{#if selectedAccountId}<button type="button" data-mail-control="account-remove" class="mail-danger" onclick={async () => { const result = await command('mail.account.remove', {}, { accountId: selectedAccountId }); if (applied(result)) loadAccount(''); }}>Remove Account</button>{/if}</div>
            </form></div>
        {:else if view.pane === 'Junk Mail'}
          <label class="mail-check"><input type="checkbox" data-mail-control="junk-enabled" checked={preferences.junkEnabled} onchange={event => preference('junkEnabled', event.currentTarget.checked)} />Enable junk mail filtering</label>
          <label class="mail-setting">Delete junk mail <select data-mail-control="delete-junk" value={preferences.deleteJunk} onchange={event => preference('deleteJunk', event.currentTarget.value)}><option value="never">Never</option><option value="day">After one day</option><option value="week">After one week</option><option value="month">After one month</option></select></label><p class="mail-note">Rules and local message actions determine fictional junk classification.</p><button type="button" data-mail-control="junk-rules" onclick={() => command('mail.preferences.open', {}, { pane: 'Rules' })}>Edit Rules…</button>
        {:else if view.pane === 'Fonts & Colors'}
          <label class="mail-setting">Message font <select data-mail-control="font-family" value={preferences.fontFamily} onchange={event => preference('fontFamily', event.currentTarget.value)}><option value="system">System</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select></label><label class="mail-setting">Font size <input data-mail-control="font-size" type="number" min="10" max="24" value={preferences.fontSize} onchange={event => preference('fontSize', Number(event.currentTarget.value))} /></label><label class="mail-setting">Quoted text color <input data-mail-control="quote-color" type="color" value={preferences.quoteColor} oninput={event => preference('quoteColor', event.currentTarget.value)} /></label><blockquote style:font-size={`${preferences.fontSize}px`} style:color={preferences.quoteColor}>This is a preview of quoted text.</blockquote>
        {:else if view.pane === 'Viewing'}
          <label class="mail-check"><input type="checkbox" data-mail-control="mark-read" checked={preferences.markRead} onchange={event => preference('markRead', event.currentTarget.checked)} />Mark messages as read when viewed</label><label class="mail-check"><input type="checkbox" data-mail-control="show-preview" checked={preferences.showPreview} onchange={event => preference('showPreview', event.currentTarget.checked)} />Show message previews in the list</label><label class="mail-check"><input type="checkbox" data-mail-control="conversation-view" checked={preferences.conversationView} onchange={event => preference('conversationView', event.currentTarget.checked)} />Organize by conversation by default</label>
        {:else if view.pane === 'Composing'}
          <label class="mail-setting">Message format <select data-mail-control="compose-format" value={preferences.composeFormat} onchange={event => preference('composeFormat', event.currentTarget.value)}><option value="rich">Rich Text</option><option value="plain">Plain Text</option></select></label><label class="mail-check"><input type="checkbox" data-mail-control="quote-original" checked={preferences.quoteOriginal} onchange={event => preference('quoteOriginal', event.currentTarget.checked)} />Quote the original message when replying</label><label class="mail-check"><input type="checkbox" data-mail-control="default-reply-all" checked={preferences.replyAll} onchange={event => preference('replyAll', event.currentTarget.checked)} />Reply to all recipients by default</label><label class="mail-setting">Default signature <select data-mail-control="default-signature" value={preferences.defaultSignatureId ?? ''} onchange={event => preference('defaultSignatureId', event.currentTarget.value || null)}><option value="">None</option>{#each mailData.signatures as signature (signature.id)}<option value={signature.id}>{signature.name}</option>{/each}</select></label>
        {:else if view.pane === 'Signatures'}
          <div class="mail-crud-layout"><div class="mail-record-list" data-mail-area="list">{#each mailData.signatures as signature (signature.id)}<button type="button" data-mail-control={`signature:${signature.id}`} class:selected={selectedSignatureId === signature.id} onclick={() => loadSignature(signature.id)}>{signature.name}</button>{/each}<button type="button" data-mail-control="signature-new" onclick={() => loadSignature('')}>＋ New Signature</button></div><form class="mail-record-editor" onsubmit={saveSignature}><label>Name <input data-mail-control="signature-name" bind:value={signatureForm.name} required maxlength="120" /></label><label>Signature <textarea data-mail-control="signature-text" bind:value={signatureForm.text} rows="7" maxlength="4096"></textarea></label><div class="mail-form-actions"><button type="submit" data-mail-control="signature-save">Save Signature</button>{#if selectedSignatureId}<button type="button" data-mail-control="signature-delete" class="mail-danger" onclick={async () => { const result = await command('mail.signature.delete', {}, { signatureId: selectedSignatureId }); if (applied(result)) loadSignature(''); }}>Delete</button>{/if}</div></form></div>
        {:else if view.pane === 'Rules'}
          <div class="mail-crud-layout"><div class="mail-record-list" data-mail-area="list">{#each mailData.rules as rule (rule.id)}<button type="button" data-mail-control={`rule:${rule.id}`} class:selected={selectedRuleId === rule.id} onclick={() => loadRule(rule.id)}><strong>{rule.name}</strong><span>{rule.enabled ? 'Enabled' : 'Disabled'}</span></button>{/each}<button type="button" data-mail-control="rule-new" onclick={() => loadRule('')}>＋ Add Rule</button></div><form class="mail-record-editor" onsubmit={saveRule}><label>Name <input data-mail-control="rule-name" bind:value={ruleForm.name} required maxlength="120" /></label><label class="mail-check"><input data-mail-control="rule-enabled" type="checkbox" bind:checked={ruleForm.enabled} />Enable rule</label><label>If <select data-mail-control="rule-field" bind:value={ruleForm.field}><option value="sender">Sender</option><option value="subject">Subject</option><option value="body">Message body</option><option value="attachment">Attachment name</option></select></label><label>Contains <input data-mail-control="rule-match" bind:value={ruleForm.match} required maxlength="1024" /></label><label>Perform <select data-mail-control="rule-action" bind:value={ruleForm.action}><option value="flag">Flag message</option><option value="read">Mark as read</option><option value="junk">Move to Junk</option><option value="move">Move message</option></select></label>{#if ruleForm.action === 'move'}<label>Mailbox <select data-mail-control="rule-mailbox" bind:value={ruleForm.mailboxId} required><option value="" disabled>Choose a mailbox</option>{#each mailData.mailboxes.filter(item => item.kind !== 'smart') as item (item.id)}<option value={item.id}>{item.name}</option>{/each}</select></label>{/if}{#if !capabilities.rulesNative}<p class="mail-note">Local rule equivalent; this profile does not expose native rules.</p>{/if}<div class="mail-form-actions"><button type="submit" data-mail-control="rule-save">Save Rule</button>{#if selectedRuleId}<button type="button" data-mail-control="rule-delete" class="mail-danger" onclick={async () => { const result = await command('mail.rule.delete', {}, { ruleId: selectedRuleId }); if (applied(result)) loadRule(''); }}>Delete</button>{/if}<button type="button" data-mail-control="rule-apply" disabled={!mailbox?.id} title={mailbox ? `Apply rules to ${mailbox.name}` : 'No mailbox selected'} onclick={() => command('mail.rule.apply')}>{mailbox?.name ? `Apply Rules to ${mailbox.name}` : 'Apply Rules'}</button></div></form></div>
        {/if}
      </div>
    </div>
  {:else if view?.kind === 'activity' || view?.kind === 'doctor'}
    <div class="mail-diagnostics" data-mail-area={view.kind === 'activity' ? 'activity' : 'reader'}><h2>{view.kind === 'doctor' ? 'Connection Doctor' : 'Activity'}</h2><p class="mail-note">{capabilities.doctorNative ? 'Local fictional accounts only. No credentials, network connections, or real mail transport.' : 'Local simulator equivalent of Connection Doctor. Fictional accounts only; no credentials, network connections, or real mail transport.'}</p><div class="mail-diagnostic-actions"><button type="button" data-mail-control="check-connections" onclick={() => command('mail.connection.check')}>Check Again</button><button type="button" data-mail-control="offline" aria-pressed={mailData.offline} onclick={() => command('mail.connection.offline', {}, { offline: !mailData.offline })}>{mailData.offline ? 'Take All Accounts Online' : 'Take All Accounts Offline'}</button><button type="button" data-mail-control="show-activity" onclick={() => command(view.kind === 'doctor' ? 'mail.activity.open' : 'mail.doctor.open')}>{view.kind === 'doctor' ? 'Show Activity' : 'Connection Doctor'}</button></div>
      {#if view.kind === 'doctor'}<table class="mail-connection-table"><thead><tr><th>Status</th><th>Account</th><th>Details</th><th>Action</th></tr></thead><tbody>{#each mailData.accounts as account (account.id)}<tr><td><span class="mail-connection-dot" class:connected={account.connection === 'connected'} class:failed={account.connection === 'failed'}></span>{account.connection}</td><td>{account.name}<small>{account.email}</small></td><td>{!account.enabled ? 'Account disabled' : account.failure === 'none' ? account.online && !mailData.offline ? 'Local connection available' : 'Account is offline' : `${account.failure === 'send' ? 'Sending' : 'Receiving'} fails in the selected local scenario`}</td><td><button type="button" data-mail-control={`doctor-account:${account.id}`} onclick={() => command('mail.preferences.open', {}, { pane: 'Accounts' })}>Settings…</button></td></tr>{/each}</tbody></table>{/if}
      <h3>Connection activity</h3><ol class="mail-activity-list">{#each [...mailData.activity].reverse() as activity (activity.id)}<li><span class={`mail-activity-state ${activity.status}`}>{activity.status}</span><div><strong>{mailData.accounts.find(account => account.id === activity.accountId)?.name ?? 'Mail'} · {activity.operation}</strong><p>{activity.detail}</p><time>{fullDate(activity.time)}</time></div>{#if activity.messageId && mailData.messages.some(message => message.id === activity.messageId && ['queued', 'failed'].includes(message.delivery))}<div><button type="button" data-mail-control={`retry:${activity.id}`} onclick={() => command('mail.delivery.retry', { messageId: activity.messageId })}>Retry</button><button type="button" data-mail-control={`cancel-delivery:${activity.id}`} onclick={() => command('mail.delivery.cancel', { messageId: activity.messageId })}>Cancel</button></div>{/if}</li>{:else}<li>No connection activity.</li>{/each}</ol>
    </div>
  {:else if view?.kind === 'help'}
    <article class="mail-help" data-mail-area="reader"><h1>Mail Help</h1><p>Read, organize, and compose mail with fictional local accounts.</p><h2>Read and organize</h2><p>Select a mailbox, then a message. Use the toolbar to reply, archive, flag, or delete. Search checks sender, recipients, subject, and local message content. Select several messages with Shift or {windows ? 'Ctrl' : 'Command'}; use Select All for the entire visible list.</p><h2>Write a message</h2><p>Choose New Message. Enter recipients, or select a matching contact returned by the local Contacts bridge. Add Cc and Bcc, a subject, message text, a signature, and local attachments. Send delivers only to the fictional outbox and sent mailboxes. Save Draft preserves an unfinished message.</p><h2>Accounts and connections</h2><p>Use Accounts settings to create or modify fictional accounts. Connection Doctor and Activity show local connection and delivery state. Retry a failed delivery after correcting its local account scenario.</p><h2>Profile boundaries</h2><p>{windows ? 'This profile models the Windows Mail UWP app available in 2023, not Outlook. Smart mailboxes, the Apple menu families, Connection Doctor, and the eight preference groups are explicit local equivalents, not claims about UWP native features.' : profileId === 'golden-gate' ? 'The current Apple Mail guide links use product-guide 16.0 on OS path 27. Golden Gate 27.0.1 remains a qualified simulator profile, not a verified factory screenshot or guidebook 27 release. No pixel identity is claimed.' : classic ? 'This layout uses the compact separate-titlebar and segmented-toolbar conventions of Mail on macOS 10.13 / 10.14. The retained guides identify the release family, not exact factory patch geometry.' : 'This layout uses the integrated, spacious Mail conventions of macOS Sonoma 14. Factory pixel equivalence is unverified.'}</p><button type="button" data-mail-control="help-compose" onclick={() => compose('new')}>Write a Message</button><button type="button" data-mail-control="help-accounts" onclick={() => command('mail.preferences.open', {}, { pane: 'Accounts' })}>Manage Accounts</button></article>
  {:else if view}
    <div class="mail-toolbar" data-window-no-drag>
      <button type="button" data-mail-control="toggle-sidebar" aria-label="Toggle mailbox sidebar" aria-pressed={view.sidebarVisible} onclick={() => command('mail.view.set', {}, { sidebarVisible: !view.sidebarVisible })}>{@render icon('sidebar')}</button>
      {#each view.toolbar.filter(item => item !== 'search') as tool}<button type="button" data-mail-control={`toolbar:${tool}`} disabled={!['get', 'compose'].includes(tool) && !selected} title={toolLabels[tool]} aria-label={toolLabels[tool]} onclick={() => toolbarAction(tool)}>{@render icon(tool)}<span>{toolLabels[tool]}</span></button>{/each}
      <span class="mail-toolbar-spacer"></span>
      {#if view.toolbar.includes('search')}<label class="mail-search">{@render icon('search')}<input type="search" data-mail-control="search" aria-label="Search mail" placeholder="Search" value={view.query} maxlength="4096" oninput={event => command('mail.view.set', {}, { query: event.currentTarget.value })} /></label>{/if}
      <button type="button" data-mail-control="customize-toolbar" aria-label="Customize toolbar" onclick={customizeToolbar}>{@render icon('more')}</button>
    </div>
    {#if classic}<nav class="mail-favorites-bar" aria-label="Favorite mailboxes"><button type="button" data-mail-control="favorites-sidebar" aria-pressed={view.sidebarVisible} onclick={() => command('mail.view.set', {}, { sidebarVisible: !view.sidebarVisible })}>{@render icon('sidebar')}Mailboxes</button>{#each mailData.mailboxes.filter(item => item.favorite && visibleMailbox(item)) as item (item.id)}<button type="button" data-mail-control={`favorite-bar:${item.id}`} class:selected={view.mailboxId === item.id} onclick={() => command('mail.mailbox.select', {}, { mailboxId: item.id })}>{item.name}{#if mailboxCount(mailData, item.id)} <b>{mailboxCount(mailData, item.id)}</b>{/if}</button>{/each}</nav>{/if}
    {#if mailData.offline || mailData.accounts.some(account => account.connection === 'failed')}<div class="mail-connection-banner"><span>{mailData.offline ? 'All accounts are offline' : 'An account needs attention'}</span><button type="button" data-mail-control="connection-banner" onclick={() => command('mail.doctor.open')}>Connection Doctor</button>{#if mailData.offline}<button type="button" data-mail-control="go-online" onclick={() => command('mail.connection.offline', {}, { offline: false })}>Go Online</button>{/if}</div>{/if}
    <div class="mail-workspace" class:without-sidebar={!view.sidebarVisible}>
      {#if view.sidebarVisible}<aside class="mail-sidebar" aria-label="Mailboxes"><div class="mail-sidebar-scroll" data-mail-area="sidebar"><h2>Favorites</h2>{#each mailData.mailboxes.filter(item => item.favorite) as item (item.id)}{@render mailboxRow(item)}{/each}
        {#if mailData.mailboxes.some(item => item.kind === 'smart')}<h2>{capabilities.smartNative ? 'Smart Mailboxes' : 'Smart mailboxes · local equivalent'}</h2>{#each mailData.mailboxes.filter(item => item.kind === 'smart' && !item.favorite) as item (item.id)}{@render mailboxRow(item)}{/each}{/if}
        {#if mailData.mailboxes.some(item => !item.accountId && !item.favorite && item.kind !== 'smart')}<h2>{windows ? 'Folders' : 'On My Mac'}</h2>{#each mailData.mailboxes.filter(item => !item.accountId && !item.favorite && item.kind !== 'smart') as item (item.id)}{@render mailboxRow(item)}{/each}{/if}
        {#each mailData.accounts.filter(account => account.enabled) as account (account.id)}<button type="button" class="mail-account-disclosure" data-mail-control={`disclosure:${account.id}`} aria-expanded={expandedAccounts[account.id] !== false} onclick={() => expandedAccounts = { ...expandedAccounts, [account.id]: expandedAccounts[account.id] === false }}><span>{expandedAccounts[account.id] === false ? '▸' : '▾'}</span>{account.name}<span class="mail-account-state">{account.connection !== 'connected' ? '●' : ''}</span></button>{#if expandedAccounts[account.id] !== false}{#each mailData.mailboxes.filter(item => item.accountId === account.id && item.kind !== 'smart') as item (item.id)}{@render mailboxRow(item)}{/each}{/if}{/each}
        </div><div class="mail-sidebar-bottom"><button type="button" data-mail-control="new-mailbox" aria-label="New mailbox" onclick={() => openForm('mailbox', { name: '', accountId: '' })}>＋</button><button type="button" data-mail-control="new-smart-mailbox" onclick={() => openForm('smart', { name: '', field: 'unread', value: '' })}>Smart…</button><button type="button" data-mail-control="add-account" aria-label="Add account" onclick={() => openForm('account', { name: '', email: '' })}>@＋</button><button type="button" data-mail-control="settings" aria-label="Mail settings" onclick={() => command('mail.preferences.open', {}, { pane: 'General' })}>{@render icon('settings')}</button></div></aside>{/if}
      <section class="mail-list-pane" aria-label="Message list">
        <header class="mail-list-heading"><div><strong>{mailbox?.name ?? 'Mail'}</strong><span>{messages.length} messages{view.selectedIds.length > 1 ? ` · ${view.selectedIds.length} selected` : ''}</span></div><button type="button" data-mail-control="mailbox-options" aria-label="Mailbox options" onclick={() => openForm('folder-options')}>{@render icon('more')}</button></header>
        <div class="mail-list-options"><label class="mail-filter-label"><span class="mail-sr-only">Filter</span><select data-mail-control="filter" value={view.filter} onchange={event => command('mail.view.set', {}, { filter: event.currentTarget.value })}><option value="all">All messages</option><option value="unread">Unread</option><option value="flagged">Flagged</option><option value="attachments">Attachments</option></select></label><label><span class="mail-sr-only">Sort</span><select data-mail-control="sort" value={view.sort} onchange={event => command('mail.view.set', {}, { sort: event.currentTarget.value })}><option value="date">Date</option><option value="sender">Sender</option><option value="subject">Subject</option></select></label><button type="button" data-mail-control="sort-direction" aria-label={view.ascending ? 'Sort descending' : 'Sort ascending'} onclick={() => command('mail.view.set', {}, { ascending: !view.ascending })}>{view.ascending ? '↑' : '↓'}</button></div>
        <div class="mail-list-bulk"><button type="button" data-mail-control="select-all" onclick={() => command('mail.selection.all')}>Select All</button><label><input type="checkbox" data-mail-control="conversations" checked={view.threaded} onchange={event => command('mail.view.set', {}, { threaded: event.currentTarget.checked })} />Conversations</label></div>
        <div class="mail-message-list" data-mail-area="list" role="listbox" aria-label="Messages" aria-multiselectable="true">
          {#each messages as message (message.id)}
            <button type="button" class="mail-message-row" class:selected={view.selectedIds.includes(message.id)} class:unread={!message.read} role="option" aria-selected={view.selectedIds.includes(message.id)} data-mail-control={`message:${message.id}`} data-mail-message-id={message.id} onclick={event => command('mail.message.select', {}, { messageId: message.id, extend: event.shiftKey, toggle: event.metaKey || event.ctrlKey })} onkeydown={event => rowKey(event, message)}>
              <span class="mail-row-indicators"><span class="mail-unread-dot" class:is-unread={!message.read} aria-label={message.read ? 'Read' : 'Unread'}></span>{#if message.flagged}<span class="mail-row-flag" aria-label="Flagged">⚑</span>{/if}</span><span class="mail-row-copy"><span class="mail-row-top"><strong title={mailDisplayAddress(message.from)}>{message.from.name || message.from.email}</strong><time>{dateLabel(message.date)}</time></span><span class="mail-row-subject">{message.subject || '(No Subject)'}{#if message.priority === 'high'}<b aria-label="High priority"> !</b>{/if}</span>{#if preferences.showPreview}<span class="mail-row-preview">{message.text.slice(0, 180)}</span>{/if}<span class="mail-row-meta">{#if message.attachments.length}{@render icon('attach')}{message.attachments.length}{/if}{#if view.threaded && mailData.messages.filter(item => item.threadId === message.threadId && item.mailboxId === message.mailboxId).length > 1}<span>{mailData.messages.filter(item => item.threadId === message.threadId && item.mailboxId === message.mailboxId).length} in conversation</span>{/if}{#if ['failed', 'queued', 'cancelled', 'draft'].includes(message.delivery)}<span class:mail-delivery-failed={message.delivery === 'failed'}>{message.delivery}</span>{/if}</span></span>
            </button>
          {:else}<p class="mail-empty">{view.query ? 'No matching messages' : 'No messages'}</p>{/each}
        </div>
      </section>
      <section class="mail-reader" data-mail-area="reader" aria-label="Message content" style:--mail-reader-font-size={`${preferences.fontSize}px`} style:--mail-quote-color={preferences.quoteColor} style:--mail-reader-font={preferences.fontFamily === 'serif' ? 'Georgia, serif' : preferences.fontFamily === 'monospace' ? 'Menlo, Consolas, monospace' : 'inherit'}>
        {#if selected}
          <div class="mail-reader-actions"><button type="button" data-mail-control="reply" onclick={() => compose('reply')}>Reply</button><button type="button" data-mail-control="reply-all" onclick={() => compose('replyAll')}>Reply All</button><button type="button" data-mail-control="forward" onclick={() => compose('forward')}>Forward</button><span class="mail-toolbar-spacer"></span><button type="button" data-mail-control="headers" aria-pressed={view.headersVisible} onclick={() => command('mail.view.set', {}, { headersVisible: !view.headersVisible })}>Details</button><button type="button" data-mail-control="reading-mode" onclick={() => command('mail.view.set', {}, { readingMode: view.readingMode === 'html' ? 'text' : 'html' })}>{view.readingMode === 'html' ? 'Plain Text' : 'Rich View'}</button></div>
          <div class="mail-message-actionbar"><button type="button" data-mail-control="mark-read" onclick={() => action(selected.read ? 'unread' : 'read')}>{selected.read ? 'Mark Unread' : 'Mark Read'}</button><button type="button" data-mail-control="flag" aria-pressed={selected.flagged} onclick={() => action(selected.flagged ? 'unflag' : 'flag')}>{selected.flagged ? 'Unflag' : 'Flag'}</button><button type="button" data-mail-control="archive" onclick={() => action('archive')}>Archive</button><button type="button" data-mail-control="junk" onclick={() => action('junk')}>Junk</button><button type="button" data-mail-control="move" onclick={() => openForm('move')}>Move…</button><button type="button" data-mail-control="delete" onclick={() => action('delete')}>Delete</button>{#if mailbox?.kind === 'trash'}<button type="button" data-mail-control="restore" onclick={() => action('restore')}>Restore</button>{/if}</div>
          {#each readerMessages as message (message.id)}<article class="mail-read-message" data-mail-message-id={message.id}>
            <header><div class="mail-message-avatar" aria-hidden="true">{(message.from.name || message.from.email).slice(0, 1).toUpperCase()}</div><div><h1>{message.subject || '(No Subject)'}</h1><strong>{mailDisplayAddress(message.from)}</strong><p>To: {message.to.map(mailDisplayAddress).join(', ')}</p>{#if message.cc.length}<p>Cc: {message.cc.map(mailDisplayAddress).join(', ')}</p>{/if}<time>{fullDate(message.date)}</time></div><button type="button" data-mail-control={`contact:${message.id}`} title="Add sender to Contacts" aria-label="Add sender to Contacts" onclick={() => command('mail.contact.create', { messageId: message.id })}>＋ Contact</button></header>
            {#if view.headersVisible}<dl class="mail-headers">{#each message.headers as header}<dt>{header.name}</dt><dd>{header.value}</dd>{/each}<dt>Delivery</dt><dd>{message.delivery}</dd><dt>Account</dt><dd>{mailData.accounts.find(account => account.id === message.accountId)?.email}</dd></dl>{/if}
            {#if message.delivery === 'failed' || message.delivery === 'queued'}<div class="mail-delivery-banner"><span>{message.delivery === 'failed' ? 'This message could not be sent.' : 'This message is waiting to send.'}</span><button type="button" data-mail-control={`delivery-retry:${message.id}`} onclick={() => command('mail.delivery.retry', { messageId: message.id })}>Retry</button><button type="button" data-mail-control={`delivery-cancel:${message.id}`} onclick={() => command('mail.delivery.cancel', { messageId: message.id })}>Cancel Delivery</button></div>{/if}
            {#if message.invitation}<div class="mail-invitation"><span class="mail-calendar-symbol" aria-hidden="true">▦</span><div><h3>{message.invitation.title}</h3><p>{fullDate(message.invitation.start)} – {fullDate(message.invitation.end)}</p><p>{message.invitation.location}</p><span class="mail-note">Response: {message.invitation.status}</span><div class="mail-invitation-actions">{#each [['accepted', 'Accept'], ['tentative', 'Maybe'], ['declined', 'Decline']] as [response, label]}<button type="button" data-mail-control={`invitation:${message.id}:${response}`} aria-pressed={message.invitation.status === response} onclick={() => command('mail.invitation.respond', { messageId: message.id }, { response })}>{label}</button>{/each}</div></div></div>{/if}
            {#if view.readingMode === 'text'}<pre class="mail-body-text">{message.text}</pre>{:else}<div class="mail-body-html">{@html mailPlainToHtml(message.text, message.format === 'rich')}</div>{/if}
            {#if message.attachments.length}<div class="mail-attachments"><h3>{message.attachments.length} {message.attachments.length === 1 ? 'attachment' : 'attachments'}</h3>{#each message.attachments as attachment (attachment.id)}<div class="mail-attachment">{@render icon('attach')}<div><strong>{attachment.name}</strong><small>{attachment.mime} · {attachment.text.length} text units</small></div><button type="button" data-mail-control={`attachment-preview:${message.id}:${attachment.id}`} onclick={() => attachmentPreview(message, attachment)}>Preview</button><button type="button" data-mail-control={`attachment-save:${message.id}:${attachment.id}`} onclick={() => command('mail.attachment.save', { messageId: message.id, attachmentId: attachment.id })}>Save</button><button type="button" data-mail-control={`attachment-open:${message.id}:${attachment.id}`} onclick={() => command('mail.attachment.open', { messageId: message.id, attachmentId: attachment.id })}>Open</button></div>{/each}</div>{/if}
          </article>{/each}
          <div class="mail-reader-bottom"><button type="button" data-mail-control="print" onclick={() => command('mail.message.print', { messageId: selected.id })}>Print…</button><button type="button" data-mail-control="share" onclick={() => command('mail.message.share', { messageId: selected.id })}>Share…</button><button type="button" data-mail-control="export" onclick={() => command('mail.message.export', { messageId: selected.id })}>Export…</button></div>
        {:else}<div class="mail-reader-empty">{@render icon('get')}<p>No message selected</p><span>Select a message to read it here.</span></div>{/if}
      </section>
    </div>
    <footer class="mail-status"><span>{view.status || (mailData.offline ? 'Offline' : `${messages.length} messages`)}</span><div><button type="button" data-mail-control="activity" onclick={() => command('mail.activity.open')}>Activity</button><button type="button" data-mail-control="doctor" onclick={() => command('mail.doctor.open')}>Connection Doctor</button><button type="button" data-mail-control="offline-toggle" aria-pressed={mailData.offline} onclick={() => command('mail.connection.offline', {}, { offline: !mailData.offline })}>{mailData.offline ? 'Go Online' : 'Work Offline'}</button></div></footer>
  {:else}<p class="mail-empty">This Mail window is not available.</p>{/if}
  {#if currentSheet}
    <div class="mail-sheet-backdrop"><section class="mail-sheet" role="dialog" aria-modal="true" aria-label={currentSheet === 'toolbar' ? 'Customize Toolbar' : currentSheet === 'preview' ? 'Attachment Preview' : 'Mail'}>
      <header><h2>{({ mailbox: 'New Mailbox', smart: 'New Smart Mailbox', rename: 'Rename Mailbox', account: 'Add Account', attach: 'Attach Local Document', move: 'Move Messages', 'folder-options': 'Mailbox', delete: 'Delete Messages', cancel: 'Save this message?', toolbar: 'Customize Toolbar', preview: preview?.name ?? 'Attachment Preview' })[currentSheet]}</h2><button type="button" data-mail-control="sheet-close" aria-label="Close dialog" onclick={closeSheet}>×</button></header>
      {#if error}<p role="alert" class="mail-error">{error}</p>{/if}
      {#if ['mailbox', 'smart', 'rename', 'account', 'attach'].includes(currentSheet)}
        <form onsubmit={submitForm}>
          <label>Name <input data-mail-control="sheet-name" bind:value={form.name} maxlength="120" required /></label>
          {#if currentSheet === 'mailbox'}<label>Location <select data-mail-control="sheet-account" bind:value={form.accountId}><option value="">Default account</option>{#each mailData.accounts as account (account.id)}<option value={account.id}>{account.name}</option>{/each}</select></label>{/if}
          {#if currentSheet === 'smart'}<p class="mail-note">{capabilities.smartNative ? 'Show messages that match this condition.' : 'Local smart-folder equivalent; not a native feature of this profile.'}</p><label>Condition <select data-mail-control="smart-field" bind:value={form.field}><option value="all">All messages</option><option value="sender">Sender contains</option><option value="subject">Subject contains</option><option value="unread">Unread</option><option value="flagged">Flagged</option><option value="attachment">Has attachment</option></select></label>{#if ['sender', 'subject'].includes(form.field)}<label>Contains <input data-mail-control="smart-value" bind:value={form.value} maxlength="4096" required /></label>{/if}{/if}
          {#if currentSheet === 'account'}<label>Email <input type="email" data-mail-control="sheet-email" bind:value={form.email} maxlength="254" required /></label><p class="mail-note">Fictional account. No password, credentials, or network transport.</p>{/if}
          {#if currentSheet === 'attach'}<label>Content type <select data-mail-control="attachment-mime" bind:value={form.mime}><option value="text/plain">Plain text</option><option value="text/markdown">Markdown</option><option value="text/csv">CSV</option><option value="application/json">JSON</option></select></label><label>Document content <textarea data-mail-control="attachment-content" bind:value={form.text} rows="7" maxlength="65536"></textarea></label><p class="mail-note">Creates a local fictional attachment; no host files are read.</p>{/if}
          <div class="mail-form-actions"><button type="button" data-mail-control="sheet-cancel" onclick={closeSheet}>Cancel</button><button type="submit" class="mail-primary" data-mail-control="sheet-submit">{currentSheet === 'attach' ? 'Attach' : currentSheet === 'rename' ? 'Rename' : 'Create'}</button></div>
        </form>
      {:else if currentSheet === 'folder-options' && mailbox}
        <div class="mail-sheet-options"><span class="mail-note">{mailbox.name}{mailbox.accountId ? ` · ${mailData.accounts.find(account => account.id === mailbox.accountId)?.name ?? ''}` : ''}{mailbox.kind === 'smart' ? ' · smart mailbox' : ''}</span>{#if ['custom', 'smart'].includes(mailbox.kind)}<button type="button" data-mail-control="rename-mailbox" onclick={() => openForm('rename', { mailboxId: mailbox.id, name: mailbox.name })}>Rename Mailbox…</button>{/if}<button type="button" data-mail-control="favorite-mailbox" onclick={async () => { const result = await command('mail.mailbox.favorite', {}, { mailboxId: mailbox.id, favorite: !mailbox.favorite }); if (applied(result)) closeSheet(); }}>{mailbox.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</button>{#if ['custom', 'smart'].includes(mailbox.kind)}<button type="button" class="mail-danger" data-mail-control="delete-mailbox" onclick={async () => { const result = await command('mail.mailbox.delete', {}, { mailboxId: mailbox.id }); if (applied(result)) closeSheet(); }}>Delete Mailbox</button>{/if}</div>
      {:else if currentSheet === 'move'}
        <p>Move {view.selectedIds.length} selected {view.selectedIds.length === 1 ? 'message' : 'messages'} to:</p><div class="mail-sheet-options">{#each mailData.mailboxes.filter(item => item.kind !== 'smart' && item.id !== view.mailboxId && mailData.messages.filter(message => view.selectedIds.includes(message.id)).every(message => message.accountId === item.accountId)) as item (item.id)}<button type="button" data-mail-control={`move-to:${item.id}`} onclick={async () => { const result = await action('move', item.id); if (applied(result)) closeSheet(); }}>{item.name}{item.accountId ? ` — ${mailData.accounts.find(account => account.id === item.accountId)?.name ?? ''}` : ''}</button>{/each}</div>
      {:else if currentSheet === 'delete'}
        <p>Permanently delete {view.selectedIds.length} selected {view.selectedIds.length === 1 ? 'message' : 'messages'}? This cannot be undone.</p><div class="mail-form-actions"><button type="button" data-mail-control="sheet-cancel" onclick={closeSheet}>Cancel</button><button type="button" class="mail-danger" data-mail-control="delete-confirm" onclick={async () => { const result = await command('mail.message.action', {}, { action: 'delete', confirm: true }); if (applied(result)) closeSheet(); }}>Delete Permanently</button></div>
      {:else if currentSheet === 'cancel'}
        <p>You can save this message in Drafts or discard it.</p><div class="mail-form-actions"><button type="button" data-mail-control="continue-compose" onclick={closeSheet}>Continue Editing</button><button type="button" class="mail-danger" data-mail-control="discard-draft" onclick={async () => { const result = await command('mail.draft.cancel', {}, { discard: true }); if (applied(result)) closeSheet(); }}>Discard</button><button type="button" class="mail-primary" data-mail-control="cancel-save-draft" onclick={async () => { const result = await command('mail.draft.cancel', {}, { discard: false }); if (applied(result)) closeSheet(); }}>Save Draft</button></div>
      {:else if currentSheet === 'toolbar'}
        <p>Choose the controls to show. Use the arrows to change their order.{#if !capabilities.toolbarNative} Toolbar customization is a local equivalent on this profile.{/if}</p><div class="mail-toolbar-picker">{#each tools as tool}<label><input type="checkbox" data-mail-control={`toolbar-choose:${tool}`} checked={toolbarItems.includes(tool)} onchange={event => toolbarItems = event.currentTarget.checked ? [...toolbarItems, tool] : toolbarItems.filter(item => item !== tool)} />{@render icon(tool)}{toolLabels[tool]}</label>{/each}</div><ol class="mail-toolbar-order">{#each toolbarItems as tool, index}<li><span>{toolLabels[tool]}</span><button type="button" data-mail-control={`toolbar-up:${tool}`} disabled={index === 0} aria-label={`Move ${toolLabels[tool]} left`} onclick={() => { const next = [...toolbarItems]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; toolbarItems = next; }}>↑</button><button type="button" data-mail-control={`toolbar-down:${tool}`} disabled={index === toolbarItems.length - 1} aria-label={`Move ${toolLabels[tool]} right`} onclick={() => { const next = [...toolbarItems]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; toolbarItems = next; }}>↓</button></li>{/each}</ol><div class="mail-form-actions"><button type="button" data-mail-control="toolbar-default" onclick={() => toolbarItems = ['get', 'compose', 'reply', 'archive', 'delete', 'flag', 'search']}>Default Set</button><button type="button" class="mail-primary" data-mail-control="toolbar-done" onclick={setToolbar}>Done</button></div>
      {:else if currentSheet === 'preview' && preview}<p class="mail-note">{preview.mime} · Local attachment preview</p>{#if preview.mime === 'application/pdf'}<LocalPdfQuickLook attachment={preview} {windowId} {available} {owns} />{:else if preview.mime === 'image/svg+xml'}<img class="mail-preview-image" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.text)}`} alt={preview.name} />{:else}<pre class="mail-preview-content">{preview.text}</pre>{/if}<div class="mail-form-actions"><button type="button" data-mail-control="preview-done" onclick={closeSheet}>Done</button></div>{/if}
    </section></div>
  {/if}
</section>

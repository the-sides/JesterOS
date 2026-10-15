<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { contactsWindow, visibleContacts, contactName, contactById, linkedContact, contactsCapabilities, contactsDuplicates, emptyContactSpec } from './contacts-state.js';
  import { contactsMenuProvider } from './contacts-commands.js';
  import { createContactsNativeView } from './contacts-native-view.js';
  import './contacts.css';

  let { state: contactsData, profile, windowId, execute, registerView, available = true, active = true, controls = {}, showLocalMenus = true } = $props();
  let root, mounted = false, ownedState, ownedRoot;
  let error = $state(''), openMenu = $state(''), sheetKey = $state('');
  let groupForm = $state(null), accountForm = $state(null), importText = $state(''), importFileId = $state('');
  let linkIds = $state([]), mergeIds = $state([]), primaryId = $state('');
  let exportName = $state('Contacts.vcf'), printStyle = $state('card');
  let photoData = $state(''), photoFileId = $state(''), templateLabelField = $state('phones');
  const renderer = $derived(typeof profile === 'string' ? profile : profile?.renderer ?? profile?.id ?? 'sonoma');
  const windows = $derived(renderer.includes('windows'));
  const classic = $derived(renderer.includes('high-sierra') || renderer.includes('mojave'));
  const golden = $derived(renderer.includes('golden-gate'));
  const era = $derived(windows ? 'windows11' : golden ? 'golden-gate' : renderer.includes('high-sierra') ? 'high-sierra' : renderer.includes('mojave') ? 'mojave' : 'sonoma');
  const view = $derived(contactsWindow(contactsData, windowId));
  const listContacts = $derived(visibleContacts(contactsData, windowId));
  const selected = $derived(selectedGroup?.accountId ? contactById(contactsData, view?.selectedIds?.[0]) : linkedContact(contactsData, view?.selectedIds?.[0]));
  const selectedGroup = $derived(contactsData.groups.find(group => group.id === view?.groupId));
  const editor = $derived(view?.editor);
  const sheet = $derived(view?.sheet ?? 'none');
  const capabilities = $derived(contactsCapabilities(profile));
  const duplicates = $derived(contactsDuplicates(contactsData));
  const groupTerm = $derived(classic ? 'Group' : windows ? 'Local list' : 'List');
  const menus = [['contacts','Contacts'],['file','File'],['edit','Edit'],['view','View'],['card','Card'],['window','Window'],['help','Help']];
  const nameFields = [['prefix','Prefix'],['given','First name'],['middle','Middle name'],['family','Last name'],['suffix','Suffix'],['nickname','Nickname'],['phoneticGiven','Phonetic first name'],['phoneticFamily','Phonetic last name']];
  const scalarFields = [['organization','Company'],['department','Department'],['jobTitle','Job title']];
  const repeatFields = [['phones','Phone'],['emails','Email'],['urls','URL'],['addresses','Address']];
  const templateFields = ['prefix','middle','suffix','nickname','phoneticGiven','phoneticFamily','organization','department','jobTitle','emails','phones','addresses','urls','birthday','notes'];
  const ruleFields = ['name','organization','email','phone','notes','birthday'];
  const icons = { sidebar:'M3 4h18v16H3z M9 4v16', add:'M12 4v16 M4 12h16', mail:'M3 5h18v14H3z M3 6l9 7 9-7', message:'M3 4h18v13H9l-5 4v-4H3z', call:'M7 3l4 4-3 3c2 3 3 4 6 6l3-3 4 4-2 4C10 22 2 14 3 5z', share:'M5 10v11h14V10 M12 15V2 M7 7l5-5 5 5', edit:'M4 16l-1 5 5-1L21 7l-5-5z M14 4l5 5', settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3', person:'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M4 22v-3a8 8 0 0 1 16 0v3', search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l7 7' };
  icons.video = 'M3 5h12v14H3z M15 9l6-4v14l-6-4';
  const initials = contact => `${contact?.name?.given?.[0] ?? ''}${contact?.name?.family?.[0] ?? ''}`.toUpperCase() || contact?.organization?.slice(0,2).toUpperCase() || '?';
  const sortLetter = contact => (contactsData.preferences.sort === 'family' ? contact.name.family || contact.name.given : contact.name.given || contact.name.family || contact.organization).charAt(0).toUpperCase() || '#';
  const writable = contact => !!contact && contactsData.accounts.some(account => account.id === contact.accountId && account.enabled && !account.readOnly);
  // New drafts present only the card-template fields (plus values already typed);
  // an existing source card always shows every field. Revealing is local presentation.
  let revealedFields = $state([]);
  const templateGroups = [...nameFields.filter(([key]) => !['given','family'].includes(key)).map(([key,label]) => `name:${key}:${label}`),
    ...scalarFields.map(([key,label]) => `scalar:${key}:${label}`),
    ...repeatFields.map(([field,label]) => `repeat:${field}:${label}`), 'date:Birthday', 'notes:Notes'];
  const newEditor = $derived(!!editor && !view?.editingId);
  const nameShown = key => !newEditor || ['given','family'].includes(key) || contactsData.template.fields.includes(key) || !!editor.name[key] || revealedFields.includes(`name:${key}`);
  const scalarShown = key => !newEditor || contactsData.template.fields.includes(key) || !!editor[key] || revealedFields.includes(`scalar:${key}`);
  const rowFilled = (field,index = null) => (index === null ? editor[field] : [editor[field][index]]).some(row => row && [row.label,...field === 'addresses' ? [row.street,row.city,row.region,row.postalCode,row.country] : [row.value]].some(Boolean));
  const repeatShown = field => !newEditor || contactsData.template.fields.includes(field) || rowFilled(field) || revealedFields.includes(`repeat:${field}`);
  const dateShown = !newEditor || contactsData.template.fields.includes('birthday') || !!editor?.birthday || revealedFields.includes('date');
  const notesShown = !newEditor || contactsData.template.fields.includes('notes') || !!editor?.notes || revealedFields.includes('notes');
  const hiddenFieldsets = $derived(newEditor ? templateGroups.filter(group => {
    const [kind,key] = group.split(':');
    if (kind === 'date') return !dateShown;
    if (kind === 'notes') return !notesShown;
    if (kind === 'name') return !nameShown(key);
    if (kind === 'scalar') return !scalarShown(key);
    return !repeatShown(key);
  }) : []);
  const revealField = group => { const [kind,key] = group.split(':'); revealedFields = [...new Set([...revealedFields, kind === 'date' || kind === 'notes' ? kind : `${kind}:${key}`])]; };
  function owns() { return mounted && available && root === ownedRoot && contactsData === ownedState && root?.isConnected && !root.closest('[hidden], [inert]'); }
  async function command(name, payload = {}, target = {}) {
    if (!owns()) return null;
    const owner = root, original = contactsData;
    try {
      const result = await execute(`contacts.${name}`, { windowId, ...target }, payload);
      if (owns() && owner === root && original === contactsData) error = ['rejected','unavailable'].includes(result?.status) ? result.error?.message ?? result.message ?? 'The operation could not be completed.' : '';
      return result;
    } catch (cause) { if (owns() && owner === root && original === contactsData) error = cause?.message ?? 'The operation could not be completed.'; return null; }
  }
  const applied = result => result?.status === 'applied';
  const openSheet = (kind, pane) => { openMenu = ''; sheetKey = ''; return command('sheet.open', { sheet: kind, ...(pane ? { pane } : {}) }); };
  const closeSheet = () => { sheetKey = ''; return command('sheet.close'); };
  const preference = (key,value) => command('preferences.set', { preferences: { ...contactsData.preferences, [key]:value } });
  const editField = (key,value) => command('editor.set', { spec: { ...editor, [key]:value } });
  const editName = (key,value) => editField('name', { ...editor.name, [key]:value });
  function editRow(field,index,key,value) { editField(field, editor[field].map((row,i) => i === index ? { ...row,[key]:value } : { ...row })); }
  function addRow(field) {
    const label = contactsData.template.labels.find(row => row.field === field)?.label ?? (field === 'phones' ? 'mobile' : 'home');
    editField(field, [...editor[field], field === 'addresses' ? { label,street:'',city:'',region:'',postalCode:'',country:'' } : { label,value:'' }]);
  }
  const removeRow = (field,index) => editField(field, editor[field].filter((_,i) => i !== index));
  async function selectContact(event,id) {
    if (view?.editor) return;
    let ids = [id];
    if (event.shiftKey && view.selectedIds.length) {
      const a = listContacts.findIndex(row => row.id === view.selectedIds[0]), b = listContacts.findIndex(row => row.id === id);
      if (a >= 0) ids = listContacts.slice(Math.min(a,b), Math.max(a,b)+1).map(row => row.id);
    } else if (event.metaKey || event.ctrlKey) ids = view.selectedIds.includes(id) ? view.selectedIds.filter(item => item !== id) : [...view.selectedIds,id];
    await command('select',{ contactIds:ids });
  }
  function toggleIds(values,id,checked) { return checked ? [...new Set([...values,id])] : values.filter(item => item !== id); }
  function freshGroup(kind = 'group') { return { groupId:null,name:'',kind,accountId:null,memberIds:[],match:'all',rules: kind === 'smart' ? [{ field:'organization',operator:'contains',value:'' }] : [] }; }
  function chooseGroup(group) { groupForm = group ? { groupId:group.id,name:group.name,kind:group.kind,accountId:group.accountId,memberIds:[...group.memberIds],match:group.match,rules:group.rules.map(row => ({...row})) } : freshGroup(sheet === 'smart' ? 'smart' : 'group'); }
  function chooseAccount(account) { accountForm = account ? { accountId:account.id,name:account.name,kind:account.kind,enabled:account.enabled,readOnly:account.readOnly } : { accountId:null,name:'',kind:'local',enabled:true,readOnly:false }; }
  function setRule(index,key,value) { groupForm = { ...groupForm,rules:groupForm.rules.map((row,i) => i === index ? {...row,[key]:value} : row) }; }
  async function saveGroup(event) { event.preventDefault(); const {groupId,...spec} = groupForm; if (applied(await command('group.save',{groupId,spec}))) closeSheet(); }
  async function saveAccount(event) { event.preventDefault(); const {accountId,...spec} = accountForm; if (applied(await command('account.save',{accountId,spec}))) chooseAccount(contactsData.accounts.find(row => row.id === accountId) ?? contactsData.accounts.at(-1)); }
  function templateField(key,checked) { command('template.set',{ template:{ ...contactsData.template,fields:checked ? [...new Set([...contactsData.template.fields,key])] : contactsData.template.fields.filter(item => item !== key) } }); }
  function templateLabel(index,label) { command('template.set',{ template:{ ...contactsData.template,labels:contactsData.template.labels.map((row,i) => i === index ? {...row,label} : {...row}) } }); }
  async function runMenu(row) {
    if (!row.enabled || !row.request) return;
    openMenu = '';
    const { command: name, target = {}, payload = {} } = row.request;
    if (name.startsWith('contacts.')) await command(name.slice(9), payload, target);
    else if (owns()) await execute(name, target, payload);
  }
  function menuRows(menuId) { const rows = contactsMenuProvider({state: contactsData,profile,windowId,menuId}); return Array.isArray(rows) ? rows : rows?.items ?? []; }
  // Clipboard canonical fields (search, editor name/scalar/repeat/notes/birthday,
  // template labels) are committed by the controller directly; committing them
  // here would nest contacts.* execution inside the clipboard lease.
  async function commitControl(id,value,guard) {
    if (!owns() || (guard && !guard())) return false;
    const parts = id.split(':');
    if (id === 'group:name' && groupForm) groupForm.name = value;
    else if (parts[0] === 'rule' && parts[2] === 'value' && groupForm?.rules[Number(parts[1])]) setRule(Number(parts[1]),'value',value);
    else if (id === 'account:name' && accountForm) accountForm.name = value;
    else if (id === 'import:text') importText = value;
    else if (id === 'import:fileId') importFileId = value;
    else if (id === 'export:name') exportName = value;
    else if (id === 'editor:photo:data') photoData = value;
    else if (id === 'editor:photo:fileId') photoFileId = value;
    else return false;
    await tick();
    return owns() && (!guard || guard());
  }
  function keydown(event) {
    if (event.key === 'Escape') { if (openMenu) { openMenu=''; event.preventDefault(); } else if (sheet !== 'none') { closeSheet(); event.preventDefault(); } return; }
    if (event.target?.matches('input,textarea,select')) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { if (view.selectedIds.length && !editor && sheet === 'none') { event.preventDefault(); openSheet('delete'); } }
    if (['ArrowDown','ArrowUp'].includes(event.key) && sheet === 'none' && !editor) {
      const index = listContacts.findIndex(row => row.id === view.selectedIds.at(-1));
      const next = listContacts[Math.max(0,Math.min(listContacts.length-1,index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { event.preventDefault(); selectContact(event,next.id); }
    }
  }
  $effect(() => {
    const key = `${sheet}:${view?.pane ?? ''}`;
    if (sheet === 'none' || sheetKey === key) return;
    sheetKey = key;
    if (sheet === 'group' || sheet === 'smart') chooseGroup(selectedGroup?.kind === (sheet === 'smart' ? 'smart' : 'group') ? selectedGroup : null);
    if (sheet === 'accounts') chooseAccount(contactsData.accounts[0]);
    if (sheet === 'link') linkIds = selected ? [...new Set([selected.id,...selected.links])] : [...view.selectedIds];
    if (sheet === 'duplicates') { mergeIds = [...view.selectedIds]; primaryId = mergeIds[0] ?? ''; }
  });
  // A fresh draft forgets any revealed-but-still-blank presentation toggles.
  $effect(() => { if (view && !view.editor) revealedFields = []; });
  onMount(() => {
    mounted = true; ownedState = contactsData; ownedRoot = root;
    const facade = createContactsNativeView({getRoot:()=>root,getState:()=>contactsData,windowId,available:owns,tick,getMenu:()=>openMenu,setMenu:value=>{openMenu=value;},commitControl});
    registerView?.(windowId,facade);
    return () => { mounted=false; facade.destroy(); registerView?.(windowId,null,facade); };
  });
</script>

{#snippet icon(kind)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons[kind] ?? icons.person}/></svg>{/snippet}
{#snippet portrait(contact, large = false)}
  <span class="contacts-portrait" class:large style:background={contact?.photo?.kind === 'color' ? contact.photo.value : undefined} aria-label={contact?.photo?.kind === 'none' ? 'No contact photo' : 'Contact monogram'}>
    {#if contact?.photo?.kind === 'image'}<img src={contact.photo.value} alt={contactName(contact,contactsData.preferences)}/>{:else if contact?.photo?.kind !== 'none'}{initials(contact)}{:else}{@render icon('person')}{/if}
  </span>
{/snippet}

{#snippet menuItems(rows,menuId)}
  {#each rows as row,index}
    {#if row.separator}<hr/>
    {:else if row.children?.length}<details class="contacts-submenu"><summary data-contacts-control="submenu:{menuId}:{row.id ?? index}">{row.label}</summary>{@render menuItems(row.children,`${menuId}:${row.id ?? index}`)}</details>
    {:else}<button role="menuitem" data-contacts-control="menuitem:{menuId}:{row.id ?? index}" disabled={!row.enabled || !row.request} onclick={()=>runMenu(row)}><span>{row.checked ? '✓' : ''}</span><span>{row.label}</span><kbd>{row.shortcut ?? ''}</kbd></button>{/if}
  {/each}
{/snippet}

<section bind:this={root} class="contacts-app contacts-{era}" class:inactive={!active} class:sidebar-hidden={!view?.sidebarVisible} data-contacts-window-id={windowId} data-native-capabilities={JSON.stringify(capabilities)} aria-label={windows ? 'People — local contacts' : 'Contacts'} onkeydown={keydown}>
  {#if !windows}
    <header class="contacts-caption" data-window-drag-region>
      <WindowControls {...controls} {active} modernGreenMenu={golden}/>
      <strong>{classic ? 'Contacts' : selectedGroup?.name ?? 'Contacts'}</strong>
      <span class="contacts-caption-actions" data-window-no-drag>
        <button data-contacts-control="sidebar" aria-label="Show or hide lists" onclick={()=>command('view.set',{sidebarVisible:!view.sidebarVisible})}>{@render icon('sidebar')}</button>
        <button data-contacts-control="new" aria-label="New contact" onclick={()=>command('editor.open',{contactId:null})} disabled={!!editor}>{@render icon('add')}</button>
      </span>
    </header>
  {/if}
  {#if showLocalMenus}
  <nav class="contacts-menubar" aria-label="Contacts menus" data-window-no-drag>
    {#each menus as [menuId,label]}
      <div class="contacts-menu-anchor">
        <button class:chosen={openMenu === menuId} data-contacts-control="menu:{menuId}" aria-haspopup="menu" aria-expanded={openMenu===menuId} onclick={()=>openMenu=openMenu===menuId?'':menuId}>{menuId === 'contacts' && windows ? 'People' : label}</button>
        {#if openMenu === menuId}
          <div class="contacts-menu" role="menu" aria-label={menuId}>
            {@render menuItems(menuRows(menuId),menuId)}
          </div>
        {/if}
      </div>
    {/each}
    {#if windows}<button data-contacts-control="new" disabled={!!editor} onclick={()=>command('editor.open',{contactId:null})}>＋ New contact</button>{/if}
  </nav>
  {/if}
  <div class="contacts-workspace" inert={sheet !== 'none'}>
    {#if view?.sidebarVisible}
      <aside class="contacts-sidebar" data-contacts-area="groups" aria-label={groupTerm+'s'}>
        <button class:selected={!view.groupId} data-contacts-control="group:all" onclick={()=>command('group.select',{groupId:null})}>All {windows ? 'contacts' : 'Contacts'} <small>{contactsData.contacts.length}</small></button>
        {#each contactsData.accounts as account}
          <h3>{account.name}<small>{!account.enabled ? 'Off' : account.readOnly ? 'Read only' : ''}</small></h3>
          {#each contactsData.groups.filter(group=>group.accountId===account.id) as group}
            <button class:selected={view.groupId===group.id} data-contacts-control="group:{group.id}" onclick={()=>command('group.select',{groupId:group.id})}><span>{group.kind==='smart'?'⚙':'▤'}</span>{group.name}</button>
          {/each}
        {/each}
        {#if contactsData.groups.some(group=>!group.accountId)}<h3>{windows ? 'Local collections' : classic ? 'Groups' : 'Lists'}</h3>{/if}
        {#each contactsData.groups.filter(group=>!group.accountId) as group}
          <button class:selected={view.groupId===group.id} data-contacts-control="group:{group.id}" onclick={()=>command('group.select',{groupId:group.id})}><span>{group.kind==='smart'?'⚙':'▤'}</span>{group.name}</button>
        {/each}
        <div class="contacts-sidebar-tools">
          <button data-contacts-control="group:new" onclick={()=>openSheet('group')}>＋ {groupTerm}</button>
          <button data-contacts-control="group:smart" onclick={()=>openSheet('smart')}>＋ {windows?'Smart local list':classic?'Smart Group':'Smart List'}</button>
          {#if selectedGroup}<button data-contacts-control="group:edit" onclick={()=>openSheet(selectedGroup.kind==='smart'?'smart':'group')}>Edit {groupTerm.toLowerCase()}</button>{/if}
          <button data-contacts-control="accounts" onclick={()=>openSheet('accounts')}>Accounts…</button>
        </div>
      </aside>
    {/if}
    <div class="contacts-list-pane">
      <label class="contacts-search">{@render icon('search')}<input data-contacts-control="search" aria-label="Search contacts" placeholder={classic && selectedGroup ? `Search ${selectedGroup.name}…` : 'Search'} value={view?.query ?? ''} disabled={!!editor} oninput={event=>command('search',{query:event.currentTarget.value})}/></label>
      <div class="contacts-sort"><label>Sort <select data-contacts-control="sort" aria-label="Sort contacts" value={contactsData.preferences.sort} onchange={event=>preference('sort',event.currentTarget.value)}><option value="given">First name</option><option value="family">Last name</option></select></label><button data-contacts-control="sidebar:list" aria-label="Show or hide lists" onclick={()=>command('view.set',{sidebarVisible:!view.sidebarVisible})}>{@render icon('sidebar')}</button></div>
      <div class="contacts-list" data-contacts-area="list" aria-label="Contacts list">
        {#each listContacts as contact,index (contact.id)}
          {#if !classic && (index===0 || sortLetter(contact)!==sortLetter(listContacts[index-1]))}<div class="contacts-letter">{sortLetter(contact)}</div>{/if}
          <button class="contacts-list-row" class:selected={view.selectedIds.includes(contact.id)} data-contacts-control="contact:{contact.id}" data-contacts-contact-id={contact.id} aria-pressed={view.selectedIds.includes(contact.id)} disabled={!!editor} onclick={event=>selectContact(event,contact.id)} ondblclick={()=>!windows&&command('card.open',{contactId:contact.id})}>
            {#if contactsData.preferences.showPhotos && (golden || windows)}{@render portrait(contact)}{/if}
            <span>{contactName(contact,contactsData.preferences)}{#if contact.id===contactsData.myCardId}<small>My Card</small>{/if}{#if windows && contact.organization}<small>{contact.organization}</small>{/if}</span>
          </button>
        {:else}<div class="contacts-list-empty">{view?.query ? 'No matching contacts' : 'No contacts'}<p>{view?.query ? 'Try a different name or detail.' : 'Add a contact to get started.'}</p></div>{/each}
      </div>
      <footer>{listContacts.length} {listContacts.length===1?'contact':'contacts'}{view.selectedIds.length>1?` · ${view.selectedIds.length} selected`:''}</footer>
    </div>
    <main class="contacts-card" data-contacts-area="card" class:golden-colored={golden && selected?.photo?.kind==='color' && !editor} style:--contact-color={selected?.photo?.kind==='color'?selected.photo.value:undefined}>
      {#if editor}
        <form class="contacts-editor" onsubmit={event=>{event.preventDefault();command('editor.save');}}>
          <header><h2>{view.editingId ? 'Edit contact' : 'New contact'}</h2><div><button type="button" data-contacts-control="editor:cancel" onclick={()=>command('editor.cancel')}>Cancel</button><button class="primary" data-contacts-control="editor:save">{windows?'Save':'Done'}</button></div></header>
          <div class="contacts-photo-editor">{@render portrait(editor,true)}<div><label>Photo style<select data-contacts-control="editor:photo:kind" value={editor.photo.kind} onchange={event=>{if(event.currentTarget.value==='image'){photoData=editor.photo.kind==='image'?editor.photo.value:'';}else editField('photo',{kind:event.currentTarget.value,value:event.currentTarget.value==='color'?'#7896a9':''});}}><option value="none">None</option><option value="initials">Monogram</option><option value="color">Color monogram</option>{#if editor.photo.kind==='image'}<option value="image">Image</option>{/if}</select></label>{#if editor.photo.kind==='color'}<label>Photo color<input type="color" data-contacts-control="editor:photo:color" value={editor.photo.value} oninput={event=>editField('photo',{kind:'color',value:event.currentTarget.value})}/></label>{/if}<small>Paste an embedded PNG, JPEG, or WebP image or use a virtual photo file. No camera, network, or host-library access.</small></div></div>
          <details class="contacts-photo-data"><summary data-contacts-control="editor:photo:expand">Choose contact photo…</summary><label class="contacts-field stacked">Image data URL<textarea data-contacts-control="editor:photo:data" bind:value={photoData} maxlength="131072" rows="3" placeholder="data:image/png;base64,…"></textarea></label><button type="button" data-contacts-control="editor:photo:apply" disabled={!photoData.trim()} onclick={()=>editField('photo',{kind:'image',value:photoData})}>Use Image</button><label class="contacts-field">Virtual photo file<input data-contacts-control="editor:photo:fileId" bind:value={photoFileId}/></label><button type="button" data-contacts-control="editor:photo:file" disabled={!photoFileId.trim()} onclick={()=>command('photo.file',{fileId:photoFileId})}>Use Virtual Photo</button></details>
          <label class="contacts-field">Account<select data-contacts-control="editor:account" value={editor.accountId} onchange={event=>editField('accountId',event.currentTarget.value)}>{#each contactsData.accounts.filter(account=>account.enabled&&!account.readOnly) as account}<option value={account.id}>{account.name}</option>{/each}</select></label>
          <fieldset><legend>Name</legend>{#each nameFields.filter(([key])=>nameShown(key)) as [key,label]}<label class="contacts-field">{label}<input data-contacts-control="editor:name:{key}" value={editor.name[key]} oninput={event=>editName(key,event.currentTarget.value)} maxlength="1024"/></label>{/each}</fieldset>
          <fieldset><legend>Work</legend>{#each scalarFields.filter(([key])=>scalarShown(key)) as [key,label]}<label class="contacts-field">{label}<input data-contacts-control="editor:{key}" value={editor[key]} oninput={event=>editField(key,event.currentTarget.value)} maxlength="1024"/></label>{/each}{#if !newEditor || scalarFields.some(([key])=>scalarShown(key))}<label class="contacts-check"><input type="checkbox" data-contacts-control="editor:company" checked={editor.company} onchange={event=>editField('company',event.currentTarget.checked)}/>Show as company</label>{/if}</fieldset>
          {#if hiddenFieldsets.length}<div class="contacts-reveal" aria-label="Reveal additional fields"><span>Add Field:</span>{#each hiddenFieldsets as group}{@const fieldLabel = group.split(':').slice(2).join('') || group.split(':')[1]}<button type="button" data-contacts-control="editor:addfield:{group}" onclick={()=>revealField(group)}>＋ {fieldLabel}</button>{/each}</div>{/if}
          {#each repeatFields.filter(([field])=>repeatShown(field)) as [field,label]}
            <fieldset><legend>{label}</legend>
              {#each editor[field] as row,index}
                <div class="contacts-repeat"><input class="contacts-label-input" data-contacts-control="editor:{field}:{index}:label" aria-label={label+' custom label'} list="contacts-labels-{windowId}" value={row.label} placeholder="label" oninput={event=>editRow(field,index,'label',event.currentTarget.value)}/>
                  {#if field==='addresses'}<div class="contacts-address-inputs">{#each [['street','Street'],['city','City'],['region','State / Province'],['postalCode','Postal code'],['country','Country']] as [key,title]}{#if key==='street'}<textarea data-contacts-control="editor:addresses:{index}:{key}" aria-label={title} placeholder={title} rows="2" maxlength="1024" value={row[key]} oninput={event=>editRow(field,index,key,event.currentTarget.value)}></textarea>{:else}<input data-contacts-control="editor:addresses:{index}:{key}" aria-label={title} placeholder={title} value={row[key]} oninput={event=>editRow(field,index,key,event.currentTarget.value)}/>{/if}{/each}</div>
                  {:else}<input data-contacts-control="editor:{field}:{index}:value" aria-label={label} value={row.value} placeholder={label} oninput={event=>editRow(field,index,'value',event.currentTarget.value)}/>{/if}
                  <button type="button" class="contacts-remove" data-contacts-control="editor:{field}:{index}:remove" aria-label={'Remove '+label} onclick={()=>removeRow(field,index)}>−</button>
                </div>
              {/each}
              <button type="button" class="contacts-add-field" data-contacts-control="editor:{field}:add" onclick={()=>addRow(field)}>＋ Add {label.toLowerCase()}</button>
            </fieldset>
          {/each}
          <datalist id="contacts-labels-{windowId}"><option value="home"/><option value="work"/><option value="mobile"/><option value="iPhone"/><option value="other"/></datalist>
          {#if dateShown}<label class="contacts-field">Birthday<input type="date" data-contacts-control="editor:birthday" value={editor.birthday} oninput={event=>editField('birthday',event.currentTarget.value)}/></label>{/if}
          {#if notesShown}<label class="contacts-field">Notes<textarea data-contacts-control="editor:notes" rows="4" value={editor.notes} oninput={event=>editField('notes',event.currentTarget.value)}></textarea></label>{/if}
        </form>
      {:else if selected}
        <div class="contacts-card-heading">
          {#if contactsData.preferences.showPhotos}{@render portrait(selected,true)}{/if}
          <div><h1>{contactName(selected,contactsData.preferences)}</h1>{#if selected.name.nickname}<p>“{selected.name.nickname}”</p>{/if}{#if selected.jobTitle || selected.organization}<p>{[selected.jobTitle,selected.organization].filter(Boolean).join(' · ')}</p>{/if}{#if selected.id===contactsData.myCardId}<small>My Card</small>{/if}</div>
        </div>
        <div class="contacts-quick-actions">
          {#each [['message','message'],['call','call'],['video',classic?'FaceTime':'video'],['mail','mail']] as [kind,label]}<button data-contacts-control="action:{kind}" aria-label={kind==='video'?'Start video call':label} disabled={kind==='mail'?!selected.emails.some(row=>row.value):kind==='call'?!selected.phones.some(row=>row.value):!selected.phones.some(row=>row.value)&&!selected.emails.some(row=>row.value)} onclick={()=>command('action',{contactId:selected.id,kind,index:0})}><span>{@render icon(kind)}</span>{label}</button>{/each}
        </div>
        <div class="contacts-card-fields">
          {#if selected.department}<div class="contacts-detail"><dt>department</dt><dd>{selected.department}</dd></div>{/if}
          {#each selected.phones as row,index}<div class="contacts-detail"><dt>{row.label}</dt><dd><button class="contacts-value" data-contacts-control="phone:{index}" onclick={()=>command('action',{contactId:selected.id,kind:'call',index})}>{row.value}</button><button class="contacts-inline-action" data-contacts-control="message:{index}" aria-label={'Message '+row.value} onclick={()=>command('action',{contactId:selected.id,kind:'message',index})}>{@render icon('message')}</button></dd></div>{/each}
          {#each selected.emails as row,index}<div class="contacts-detail"><dt>{row.label}</dt><dd><button class="contacts-value" data-contacts-control="email:{index}" onclick={()=>command('action',{contactId:selected.id,kind:'mail',index})}>{row.value}</button></dd></div>{/each}
          {#each selected.urls as row,index}<div class="contacts-detail"><dt>{row.label}</dt><dd class="contacts-url">{row.value}</dd></div>{/each}
          {#if selected.birthday}<div class="contacts-detail"><dt>birthday</dt><dd>{selected.birthday}</dd></div>{/if}
          {#each selected.addresses as row}<div class="contacts-detail"><dt>{row.label}</dt><dd>{row.street}<br/>{[row.city,row.region,row.postalCode].filter(Boolean).join(' ')}<br/>{row.country}</dd></div>{/each}
          {#if selected.notes}<div class="contacts-detail"><dt>note</dt><dd class="contacts-notes">{selected.notes}</dd></div>{/if}
          {#if selected.name.phoneticGiven || selected.name.phoneticFamily}<div class="contacts-detail"><dt>phonetic name</dt><dd>{selected.name.phoneticGiven} {selected.name.phoneticFamily}</dd></div>{/if}
          <div class="contacts-detail"><dt>account</dt><dd>{contactsData.accounts.find(account=>account.id===selected.accountId)?.name}</dd></div>
          {#if selected.links.length}<div class="contacts-detail"><dt>linked cards</dt><dd>{#each selected.links as id}<span>{contactName(contactById(contactsData,id),contactsData.preferences)}</span><button class="contacts-inline-action" data-contacts-control="linked:edit:{id}" disabled={!writable(contactById(contactsData,id))} aria-label={'Edit source card '+contactName(contactById(contactsData,id),contactsData.preferences)} onclick={()=>command('editor.open',{contactId:id})}>{@render icon('edit')}</button>{/each}<button data-contacts-control="links:edit" onclick={()=>openSheet('link')}>Edit links…</button></dd></div>{/if}
        </div>
        <div class="contacts-card-tools"><button data-contacts-control="card:new" aria-label="New contact" onclick={()=>command('editor.open',{contactId:null})}>{@render icon('add')}</button><button data-contacts-control="edit" disabled={!writable(selected)} onclick={()=>command('editor.open',{contactId:selected.id})}>{windows?'Edit contact':'Edit'}</button><button data-contacts-control="action:share" aria-label="Share contact" onclick={()=>command('action',{contactId:selected.id,kind:'share',index:0})}>{@render icon('share')}</button></div>
        <details class="contacts-more"><summary data-contacts-control="card:more">More contact actions…</summary><div class="contacts-extra-tools"><button data-contacts-control="delete" disabled={!writable(selected)} onclick={()=>openSheet('delete')}>Delete…</button><button data-contacts-control="mycard" disabled={selected.id===contactsData.myCardId} onclick={()=>command('myCard.set',{contactId:selected.id})}>Make My Card</button><button data-contacts-control="link" onclick={()=>openSheet('link')}>Link cards…</button><button data-contacts-control="merge" onclick={()=>openSheet('duplicates')}>Look for Duplicates…</button></div>
        <div class="contacts-membership"><label>Add selected to <select data-contacts-control="membership:group" onchange={event=>{if(event.currentTarget.value)command('group.members',{groupId:event.currentTarget.value,contactIds:view.selectedIds,operation:'add'});event.currentTarget.value='';}}><option value="">Choose {groupTerm.toLowerCase()}…</option>{#each contactsData.groups.filter(group=>group.kind==='group') as group}<option value={group.id}>{group.name}</option>{/each}</select></label>{#if selectedGroup?.kind==='group'}<button data-contacts-control="membership:remove" onclick={()=>command('group.members',{groupId:selectedGroup.id,contactIds:view.selectedIds,operation:'remove'})}>Remove from {selectedGroup.name}</button>{/if}</div>
        </details>
      {:else}<div class="contacts-empty">{@render icon('person')}<h2>{listContacts.length?'No Card Selected':'No Contacts'}</h2><p>{listContacts.length?'Select a contact to see their information.':'Keep names, phone numbers, and addresses in one place.'}</p><button class="primary" data-contacts-control="empty:new" onclick={()=>command('editor.open',{contactId:null})}>Add Contact</button></div>{/if}
      {#if !editor}<details class="contacts-more"><summary data-contacts-control="transfer:expand">Import, export, and print…</summary>
      {#if !editor}<div class="contacts-transfer"><label>vCard name<input data-contacts-control="export:name" bind:value={exportName}/></label><button data-contacts-control="export" disabled={!view.selectedIds.length} onclick={()=>command('export',{contactIds:view.selectedIds,name:exportName})}>Export vCard…</button><button data-contacts-control="import" onclick={()=>openSheet('import')}>Import…</button><label>Print<select data-contacts-control="print:style" bind:value={printStyle}><option value="card">Cards</option><option value="list">Contact list</option><option value="labels">Mailing labels</option></select></label><button data-contacts-control="print" disabled={!view.selectedIds.length} onclick={()=>command('print',{contactIds:view.selectedIds,style:printStyle})}>Print…</button></div>{/if}
      </details>{/if}
    </main>
  </div>
  {#if windows}<div class="contacts-equivalence">Windows 11 23H2 People · local simulation. Smart lists, My Card, templates, vCard, and printing are JesterOS local equivalents, not native People features.</div>{/if}
  {#if error || view?.status}<div class="contacts-status" role="status">{error || view.status}</div>{/if}
  {#if sheet !== 'none'}
    <div class="contacts-sheet-overlay">
      <section class="contacts-sheet" role="dialog" aria-modal="true" aria-labelledby="contacts-sheet-title-{windowId}" data-contacts-area="dialog">
        <header><h2 id="contacts-sheet-title-{windowId}">{sheet==='group'?groupTerm:sheet==='smart'?(windows?'Smart local list':classic?'Smart Group':'Smart List'):sheet==='duplicates'?'Resolve Duplicates':sheet==='link'?'Linked Cards':sheet==='delete'?'Delete Contacts':sheet==='import'?'Import Contacts':sheet==='template'?'Card Template':sheet==='accounts'?'Accounts':sheet==='help'?'Contacts Help':windows?'People Settings':classic?'Contacts Preferences':'Contacts Settings'}</h2><button data-contacts-control="sheet:close" aria-label="Close dialog" onclick={closeSheet}>×</button></header>
        {#if windows && ['group','smart','duplicates','link','template','preferences'].includes(sheet)}<p class="contacts-local-notice">This is a local JesterOS contact-management equivalent, not a claim of native People feature availability.</p>{/if}
        {#if (sheet==='group' || sheet==='smart') && groupForm}
          <form onsubmit={saveGroup}>
            <label class="contacts-field">Edit existing<select data-contacts-control="group:existing" value={groupForm.groupId??''} onchange={event=>chooseGroup(contactsData.groups.find(group=>group.id===event.currentTarget.value))}><option value="">New {groupTerm.toLowerCase()}</option>{#each contactsData.groups.filter(group=>group.kind===(sheet==='smart'?'smart':'group')) as group}<option value={group.id}>{group.name}</option>{/each}</select></label>
            <label class="contacts-field">Name<input data-contacts-control="group:name" bind:value={groupForm.name} required/></label>
            <label class="contacts-field">Account<select data-contacts-control="group:account" value={groupForm.accountId??''} onchange={event=>groupForm.accountId=event.currentTarget.value||null}><option value="">All local accounts</option>{#each contactsData.accounts as account}<option value={account.id}>{account.name}</option>{/each}</select></label>
            {#if sheet==='smart'}
              <label class="contacts-field">Match<select data-contacts-control="group:match" bind:value={groupForm.match}><option value="all">All of the following conditions</option><option value="any">Any of the following conditions</option></select></label>
              {#each groupForm.rules as rule,index}<div class="contacts-rule"><select data-contacts-control="rule:{index}:field" aria-label="Rule field" value={rule.field} onchange={event=>setRule(index,'field',event.currentTarget.value)}>{#each ruleFields as field}<option value={field}>{field}</option>{/each}</select><select data-contacts-control="rule:{index}:operator" aria-label="Rule comparison" value={rule.operator} onchange={event=>setRule(index,'operator',event.currentTarget.value)}><option value="contains">contains</option><option value="equals">is</option><option value="present">is set</option><option value="absent">is not set</option></select><input data-contacts-control="rule:{index}:value" aria-label="Rule value" value={rule.value} disabled={['present','absent'].includes(rule.operator)} oninput={event=>setRule(index,'value',event.currentTarget.value)}/><button type="button" data-contacts-control="rule:{index}:remove" aria-label="Remove condition" disabled={groupForm.rules.length===1} onclick={()=>groupForm.rules=groupForm.rules.filter((_,i)=>i!==index)}>−</button></div>{/each}
              <button type="button" data-contacts-control="rule:add" onclick={()=>groupForm.rules=[...groupForm.rules,{field:'name',operator:'contains',value:''}]}>＋ Add condition</button>
            {:else}<fieldset class="contacts-member-picker"><legend>Members</legend>{#each contactsData.contacts.filter(contact=>!groupForm.accountId||contact.accountId===groupForm.accountId) as contact}<label><input type="checkbox" data-contacts-control="group:member:{contact.id}" checked={groupForm.memberIds.includes(contact.id)} onchange={event=>groupForm.memberIds=toggleIds(groupForm.memberIds,contact.id,event.currentTarget.checked)}/>{contactName(contact,contactsData.preferences)}</label>{:else}<p>No contacts in this account.</p>{/each}</fieldset>{/if}
            <footer>{#if groupForm.groupId}<button type="button" class="danger" data-contacts-control="group:delete" onclick={async()=>{if(applied(await command('group.delete',{groupId:groupForm.groupId})))closeSheet();}}>Delete {groupTerm}</button>{/if}<button type="button" data-contacts-control="group:cancel" onclick={closeSheet}>Cancel</button><button class="primary" data-contacts-control="group:save">Save</button></footer>
          </form>
        {:else if sheet==='duplicates'}
          <p>Review cards before merging. The primary card keeps its identity; unique details and list memberships are combined.</p>
          <div class="contacts-duplicate-results">{#each duplicates as cluster,index}{@const ids = cluster.map(contact=>contact.id)}<button data-contacts-control="duplicates:{index}" onclick={()=>{mergeIds=[...ids];primaryId=ids[0]??'';}}>{cluster.map(contact=>contactName(contact,contactsData.preferences)).join(' / ')}</button>{:else}<p>No automatically detected duplicates. You can still select cards below to merge deliberately.</p>{/each}</div>
          <fieldset class="contacts-member-picker"><legend>Cards to merge</legend>{#each contactsData.contacts as contact}<label><input type="checkbox" data-contacts-control="merge:card:{contact.id}" checked={mergeIds.includes(contact.id)} onchange={event=>{mergeIds=toggleIds(mergeIds,contact.id,event.currentTarget.checked);if(!mergeIds.includes(primaryId))primaryId=mergeIds[0]??'';}}/>{contactName(contact,contactsData.preferences)}</label>{/each}</fieldset>
          <label class="contacts-field">Primary card<select data-contacts-control="merge:primary" bind:value={primaryId}>{#each mergeIds as id}<option value={id}>{contactName(contactById(contactsData,id),contactsData.preferences)}</option>{/each}</select></label>
          <footer><button data-contacts-control="merge:cancel" onclick={closeSheet}>Cancel</button><button class="primary" data-contacts-control="merge:apply" disabled={mergeIds.length<2||!primaryId} onclick={async()=>{if(applied(await command('merge',{contactIds:mergeIds,primaryId})))closeSheet();}}>Merge Selected</button></footer>
        {:else if sheet==='link'}
          <p>Link separate cards for the same person without deleting their account records. Choose at least two cards.</p>
          <fieldset class="contacts-member-picker"><legend>Cards</legend>{#each contactsData.contacts as contact}<label><input type="checkbox" data-contacts-control="link:card:{contact.id}" checked={linkIds.includes(contact.id)} onchange={event=>linkIds=toggleIds(linkIds,contact.id,event.currentTarget.checked)}/>{contactName(contact,contactsData.preferences)} <small>{contactsData.accounts.find(account=>account.id===contact.accountId)?.name}</small></label>{/each}</fieldset>
          <footer><button data-contacts-control="link:unlink" disabled={linkIds.length<2} onclick={async()=>{if(applied(await command('link',{contactIds:linkIds,operation:'unlink'})))closeSheet();}}>Unlink</button><button data-contacts-control="link:cancel" onclick={closeSheet}>Cancel</button><button class="primary" data-contacts-control="link:apply" disabled={linkIds.length<2} onclick={async()=>{if(applied(await command('link',{contactIds:linkIds,operation:'link'})))closeSheet();}}>Link</button></footer>
        {:else if sheet==='delete'}
          <p>Delete {view.selectedIds.length} {view.selectedIds.length===1?'contact':'contacts'}? These cards will be removed from all lists. This cannot be undone.</p><ul>{#each view.selectedIds as id}<li>{contactName(contactById(contactsData,id),contactsData.preferences)}</li>{/each}</ul><footer><button data-contacts-control="delete:cancel" onclick={closeSheet}>Cancel</button><button class="danger" data-contacts-control="delete:confirm" onclick={async()=>{if(applied(await command('delete',{contactIds:view.selectedIds})))closeSheet();}}>Delete</button></footer>
        {:else if sheet==='import'}
          <p>Import vCard text or a file from the virtual filesystem. No host disk or network access is used.</p><label class="contacts-field">Virtual file ID<input data-contacts-control="import:fileId" bind:value={importFileId} placeholder="Virtual vCard file ID"/></label><button data-contacts-control="import:file" disabled={!importFileId.trim()} onclick={async()=>{if(applied(await command('import.file',{fileId:importFileId})))closeSheet();}}>Import Virtual File</button><label class="contacts-field stacked">vCard text<textarea data-contacts-control="import:text" rows="10" bind:value={importText} placeholder="BEGIN:VCARD&#10;VERSION:3.0&#10;…&#10;END:VCARD"></textarea></label><footer><button data-contacts-control="import:cancel" onclick={closeSheet}>Cancel</button><button class="primary" data-contacts-control="import:apply" disabled={!importText.trim()} onclick={async()=>{if(applied(await command('import',{text:importText})))closeSheet();}}>Import vCard</button></footer>
        {:else if sheet==='accounts' && accountForm}
          <p>Accounts are local contact containers. Provider names do not connect to online accounts or request credentials.</p><div class="contacts-account-layout"><aside>{#each contactsData.accounts as account}<button class:selected={accountForm.accountId===account.id} data-contacts-control="account:{account.id}" onclick={()=>chooseAccount(account)}>{account.name}<small>{account.kind} · {account.enabled?'Enabled':'Disabled'}</small></button>{/each}<button data-contacts-control="account:new" onclick={()=>chooseAccount(null)}>＋ Add Account</button></aside><form onsubmit={saveAccount}><label class="contacts-field">Description<input data-contacts-control="account:name" bind:value={accountForm.name} required/></label><label class="contacts-field">Provider<select data-contacts-control="account:kind" bind:value={accountForm.kind}>{#each ['local','icloud','exchange','google','carddav'] as kind}<option value={kind}>{kind==='local'?'On My Computer':kind==='icloud'?'iCloud':kind==='carddav'?'CardDAV':kind==='google'?'Google':'Exchange'}</option>{/each}</select></label><label class="contacts-check"><input type="checkbox" data-contacts-control="account:enabled" bind:checked={accountForm.enabled}/>Enable this account</label><label class="contacts-check"><input type="checkbox" data-contacts-control="account:readonly" bind:checked={accountForm.readOnly}/>Read-only contacts</label><footer>{#if accountForm.accountId}<button type="button" class="danger" data-contacts-control="account:delete" onclick={async()=>{if(applied(await command('account.delete',{accountId:accountForm.accountId})))chooseAccount(contactsData.accounts[0]);}}>Remove Account</button>{/if}<button class="primary" data-contacts-control="account:save">Save Account</button></footer></form></div>
        {:else if sheet==='template' || sheet==='preferences'}
          <nav class="contacts-preferences-tabs" aria-label="Settings categories">{#each ['General','Accounts','Template','vCard'] as pane}<button class:selected={view.pane===pane||(sheet==='template'&&pane==='Template')} data-contacts-control="preferences:pane:{pane}" onclick={()=>openSheet(pane==='Accounts'?'accounts':pane==='Template'?'template':'preferences',pane)}>{pane}</button>{/each}</nav>
          {#if sheet==='template' || view.pane==='Template'}
            <p>Choose the fields and default labels included in a new contact card. Existing contacts are not changed.</p><fieldset class="contacts-template-fields"><legend>Card fields</legend>{#each templateFields as field}<label><input type="checkbox" data-contacts-control="template:field:{field}" checked={contactsData.template.fields.includes(field)} onchange={event=>templateField(field,event.currentTarget.checked)}/>{nameFields.find(row=>row[0]===field)?.[1]??scalarFields.find(row=>row[0]===field)?.[1]??field}</label>{/each}</fieldset><fieldset><legend>Default labels</legend>{#each contactsData.template.labels as row,index}<label class="contacts-field">{row.field}<input data-contacts-control="template:label:{index}" value={row.label} oninput={event=>templateLabel(index,event.currentTarget.value)}/></label>{/each}<div class="contacts-rule"><select data-contacts-control="template:add:field" aria-label="New default label field" id="contacts-template-field-{windowId}">{#each repeatFields as [field,label]}<option value={field}>{label}</option>{/each}</select><button data-contacts-control="template:add" onclick={()=>{const field=root.querySelector(`#contacts-template-field-${windowId}`)?.value;if(field)command('template.set',{template:{...contactsData.template,labels:[...contactsData.template.labels,{field,label:'other'}]}});}}>＋ Add label</button></div>{#each contactsData.template.labels as row,index}<button data-contacts-control="template:remove:{index}" onclick={()=>command('template.set',{template:{...contactsData.template,labels:contactsData.template.labels.filter((_,i)=>i!==index)}})}>Remove {row.field} “{row.label}”</button>{/each}</fieldset>
          {:else if view.pane==='vCard'}<label class="contacts-check"><input type="checkbox" data-contacts-control="preferences:exportNotes" checked={contactsData.preferences.exportNotes} onchange={event=>preference('exportNotes',event.currentTarget.checked)}/>Export notes in vCards</label><label class="contacts-check"><input type="checkbox" data-contacts-control="preferences:exportPhotos" checked={contactsData.preferences.exportPhotos} onchange={event=>preference('exportPhotos',event.currentTarget.checked)}/>Export local photo metadata in vCards</label><p>vCard exports are saved to the virtual filesystem, not downloaded to the host.</p>
          {:else}<label class="contacts-field">Sort by<select data-contacts-control="preferences:sort" value={contactsData.preferences.sort} onchange={event=>preference('sort',event.currentTarget.value)}><option value="given">First Name</option><option value="family">Last Name</option></select></label><label class="contacts-field">Display name<select data-contacts-control="preferences:display" value={contactsData.preferences.display} onchange={event=>preference('display',event.currentTarget.value)}><option value="given">First Name, Last Name</option><option value="family">Last Name, First Name</option></select></label><label class="contacts-field">Default account<select data-contacts-control="preferences:defaultAccountId" value={contactsData.preferences.defaultAccountId} onchange={event=>preference('defaultAccountId',event.currentTarget.value)}>{#each contactsData.accounts.filter(account=>account.enabled&&!account.readOnly) as account}<option value={account.id}>{account.name}</option>{/each}</select></label><label class="contacts-check"><input type="checkbox" data-contacts-control="preferences:showPhotos" checked={contactsData.preferences.showPhotos} onchange={event=>preference('showPhotos',event.currentTarget.checked)}/>Show contact photos</label>{/if}
          <footer><button class="primary" data-contacts-control="preferences:done" onclick={closeSheet}>Done</button></footer>
        {:else if sheet==='help'}<p>Add or select a contact, then use Edit to change its information. Custom labels can be typed next to any phone, email, URL, or address.</p><p>Use Shift-click to select a range; Command-click (Control-click on Windows) toggles individual cards. Use lists to organize contacts, and Smart Lists to match details automatically.</p><p>Mail and Messages create local drafts. Calls and sharing use the parent application’s local action bridge. vCards and printing use the canonical virtual filesystem and print queue.</p><p>Windows People availability differs from Mac Contacts. This surface represents the 23H2-era contact entrypoint; macOS-only features are explicitly identified as local equivalents.</p><footer><button class="primary" data-contacts-control="help:done" onclick={closeSheet}>Done</button></footer>{/if}
        {#if error}<p class="contacts-dialog-error" role="alert">{error}</p>{/if}
      </section>
    </div>
  {/if}
</section>

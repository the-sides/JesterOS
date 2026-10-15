<script>
  import { onMount, tick } from 'svelte';
  import WindowControls from './WindowControls.svelte';
  import { createPhotosNativeView, photosGroups, photoContent } from './photos-native-view.js';
  import { photosWindow, photosVisibleItems, photosSelected } from './photos-state.js';
  import { renderPhoto } from './photos-codec.js';
  import './photos.css';
  let { state: photosData, profile, windowId, execute, registerView, available = true, active = true, controls = {} } = $props();
  let root = $state(null), facade = $state(null), message = $state(''), preview = $state(null), previewPending = $state(false), editorImage = $state(null);
  let albumName = $state(''), folderName = $state(''), albumId = $state(''), folderId = $state(''), exportName = $state(''), exportFormat = $state('png'), exportOriginal = $state(false);
  let markTool = $state('pen'), markColor = $state('#e63946'), markWidth = $state(6), markText = $state(''), markStyle = $state('solid'), markPoints = $state([]), albumShared = $state(false);
  let originalData, originalProfile, originalWindowId, retired = false, gesture = null;
  const session = $derived(photosWindow(photosData, windowId));
  const classic = $derived(/high-sierra|mojave/u.test(profile.id));
  const windows = $derived(profile.id.includes('windows'));
  const golden = $derived(profile.id.includes('golden-gate'));
  const external = $derived(!!session?.external);
  const items = $derived(photosVisibleItems(photosData, session));
  const groups = $derived(photosGroups(items, session?.grouping ?? 'all'));
  const selected = $derived(photosSelected(photosData, session));
  const shown = $derived(session?.slideshow ? items[session.slideshowIndex % Math.max(1, items.length)] : selected);
  const editingItem = $derived(photosData.items.find(item => item.id === session?.editing?.itemId));
  const editingKey = $derived(session?.editing && editingItem ? JSON.stringify([editingItem.id, editingItem.revision, session.editing.edits]) : '');
  const undoSource = $derived(session?.editing ?? (external ? selected : null));
  const undoEnabled = $derived(Boolean(undoSource && (undoSource.undo?.length || (external && selected?.undo?.length && !session.editing))));
  const redoEnabled = $derived(Boolean(undoSource && (undoSource.redo?.length || (external && selected?.redo?.length && !session.editing))));
  const dirty = $derived(Boolean(external && selected && selected.revision !== selected.savedRevision));
  const heading = $derived(({library:windows?'All Photos':classic?'Photos':'Library',favorites:'Favorites',hidden:windows?'Hidden · local':'Hidden',trash:windows?'Local Trash':'Recently Deleted',people:windows?'People · authored':classic?'People':'People & Pets',places:windows?'Places · authored':'Places',memories:windows?'Memories · local':'Memories',shared:'Shared Albums',cloud:windows?'iCloud Photos':'iCloud',captures:windows?'Fictional Camera':'Photo Booth'})[session?.section] ?? photosData.albums.find(row => `album:${row.id}` === session?.section)?.name ?? photosData.folders.find(row => `folder:${row.id}` === session?.section)?.name ?? 'Photos');
  const people = $derived([...new Set(items.flatMap(item => item.people))]);
  const places = $derived([...new Set(items.map(item => item.place).filter(Boolean))]);
  const hasSelection = $derived(!!selected);
  const deleting = $derived(session?.section === 'trash');
  function current() { return !retired && root?.isConnected && photosData === originalData && profile === originalProfile && windowId === originalWindowId; }
  async function command(name, payload = {}, itemId = null) {
    if (!current() || !available || !active) return;
    const owner = root, result = await execute(`photos.${name}`, { windowId, ...(itemId ? { itemId } : {}) }, payload);
    if (current() && root === owner) message = result?.status === 'applied' ? '' : result?.error?.message ?? 'Local operation unavailable.';
    return result;
  }
  function navigate(section, grouping) { return command('navigate', { section, ...(grouping ? { grouping } : {}) }); }
  function sheet(kind) {
    if (kind === 'album') { albumName = ''; albumId = session.section.startsWith('album:') ? session.section.slice(6) : ''; folderId = ''; }
    if (kind === 'folder') { folderName = ''; folderId = session.section.startsWith('folder:') ? session.section.slice(7) : ''; }
    if (kind === 'export' && selected) { exportName = ''; exportOriginal = false; exportFormat = selected.mime === 'image/jpeg' ? 'jpeg' : 'png'; }
    return command('sheet', { sheet: kind, menu: null });
  }
  function select(item, event) { return command('select', { ids: [item.id], additive: event.metaKey || event.ctrlKey || event.shiftKey }); }
  function changeEdit(key, value) { if (session?.editing) return command('editUpdate', { edits: { ...session.editing.edits, [key]: value } }); }
  function addMark(mark) {
    if (!session?.editing) return;
    const marks = session.editing.edits.marks ?? [];
    if (marks.length >= 64) { message = 'The image already has 64 annotations; remove an existing mark first.'; return; }
    changeEdit('marks', [...marks, mark]);
  }
  function crop(key, value) {
    if (!session?.editing) return;
    const next = { ...session.editing.edits.crop, [key]: Number(value) };
    if (key === 'x') next.width = Math.min(next.width, 1 - next.x);
    if (key === 'y') next.height = Math.min(next.height, 1 - next.y);
    changeEdit('crop', next);
  }
  async function saveAlbum(operation) { const result = await command('album', { operation, ...(albumId ? { albumId } : {}), ...(['create','rename'].includes(operation) ? { name: albumName } : {}), ...(operation === 'create' ? { folderId: folderId || null, shared: albumShared } : {}), ...(['add','remove'].includes(operation) ? { itemIds: [...session.selectedIds] } : {}) }); if (result?.status === 'applied') { albumShared = false; command('sheet', { sheet: null }); } }
  async function saveFolder(operation) { const result = await command('folder', { operation, ...(folderId ? { folderId } : {}), ...(['create','rename'].includes(operation) ? { name: folderName } : {}) }); if (result?.status === 'applied') command('sheet', { sheet: null }); }
  function advance(direction) {
    if (!items.length) return;
    if (session.slideshow) command('slideshow', { enabled: true, index: (session.slideshowIndex + direction + items.length) % items.length });
    else command('open', { itemId: items[(items.findIndex(item => item.id === selected?.id) + direction + items.length) % items.length].id });
  }
  function key(event) {
    if (!active || !available || !current() || event.target.matches('input,select,textarea')) return;
    if (event.key === 'Escape') { event.preventDefault(); if (session.sheet || session.menu) command('sheet', { sheet: null, menu: null }); else if (session.slideshow) command('slideshow', { enabled: false }); else if (session.editing) command('editCancel'); else navigate(session.section); }
    if (session.sheet) return;
    if (event.key === 'Enter' && selected && !session.editing) { event.preventDefault(); command('open', { itemId: selected.id }); }
    if (['ArrowRight','ArrowLeft'].includes(event.key) && (session.viewerId || session.slideshow)) { event.preventDefault(); advance(event.key === 'ArrowRight' ? 1 : -1); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (hasSelection) sheet('delete'); }
    if ((windows ? event.ctrlKey : event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); command('select', { ids: items.map(item => item.id) }); }
    if ((windows ? event.ctrlKey : event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (session.editing || external) command(event.shiftKey ? 'redo' : 'undo'); }
    if ((windows ? event.ctrlKey : event.metaKey) && event.key.toLowerCase() === 's' && external) { event.preventDefault(); command('save'); }
  }
  function gestureValid(owner) {
    return owner && current() && available && active && session?.editing && facade?.available() && !previewPending && !session.compare && editorImage === owner.image
      && root === owner.root && session === owner.session && editingItem === owner.item && editingKey === owner.editingKey
      && owner.image.isConnected && owner.item.revision === owner.revision;
  }
  function gestureStart(event) {
    if (!current() || !available || !active || !external || !session.editing || session.compare || previewPending || !facade?.available()) return;
    if (!['pen','highlighter','line','rectangle','ellipse'].includes(markTool) || event.button !== 0 || event.currentTarget !== editorImage) return;
    if (session.editing.edits.marks.length >= 64) { message = 'The image already has 64 annotations; undo or remove an existing mark first.'; return; }
    const rect = editorImage.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    event.preventDefault(); editorImage.setPointerCapture(event.pointerId);
    gesture = { root, image: editorImage, session, item: editingItem, revision: editingItem.revision, editingKey, kind: markTool,
      color: markColor, lineWidth: markWidth, lineStyle: markStyle, pointerId: event.pointerId, rect };
    markPoints = [{ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }];
  }
  function gestureMove(event) {
    if (!gestureValid(gesture) || event.pointerId !== gesture.pointerId) return;
    const rect = gesture.rect;
    const point = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    if (markPoints.length < 4095 && ['pen','highlighter'].includes(gesture.kind)) markPoints = [...markPoints, point];
  }
  function gestureEnd(event) {
    const owner = gesture, samples = markPoints; gesture = null; markPoints = [];
    if (!gestureValid(owner) || event.pointerId !== owner.pointerId || !samples.length) return;
    const rect = editorImage.getBoundingClientRect();
    if (rect.width !== owner.rect.width || rect.height !== owner.rect.height || rect.left !== owner.rect.left || rect.top !== owner.rect.top) return;
    const end = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    const points = ['pen','highlighter'].includes(owner.kind) ? [...samples, end] : [samples[0], end];
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    const width = Math.max(...points.map(point => point.x)) - x, height = Math.max(...points.map(point => point.y)) - y;
    if (['rectangle','ellipse'].includes(owner.kind) && (!width || !height)) return;
    addMark({ id: `mark-${windowId}-${session.revision}-${session.editing.edits.marks.length+1}`, kind: owner.kind, points, x, y, width, height,
      color: owner.color, lineWidth: owner.lineWidth, lineStyle: owner.lineStyle, text: '', fontSize: 18 });
  }
  function addTextMark() {
    if (!session?.editing || !markText.trim()) return;
    const mark = { id: `mark-${windowId}-${session.revision}-${(session.editing.edits.marks?.length??0)+1}`, kind: 'text', points: [], x: 0.1, y: 0.1, width: 0.4, height: 0.12, color: markColor, lineWidth: markWidth, lineStyle: markStyle, text: markText, fontSize: 18 };
    markText = ''; addMark(mark);
  }
  onMount(() => {
    originalData = photosData; originalProfile = profile; originalWindowId = windowId;
    facade = createPhotosNativeView({ getRoot: () => root, getState: () => photosData, getProfile: () => profile, windowId, available: () => current() && available && active, tick });
    registerView(windowId, facade);
    return () => { retired = true; facade.destroy(); registerView(originalWindowId, null, facade); };
  });
  $effect(() => {
    const key = editingKey, mounted = facade, enabled = available && active;
    if (!key || !mounted || !enabled) { preview = null; previewPending = false; return; }
    const item = editingItem, edits = session.editing.edits, revision = item.revision, owner = root;
    let cancelled = false; previewPending = true;
    const valid = () => !cancelled && current() && available && active && owner === root && editingItem === item && item.revision === revision && editingKey === key;
    renderPhoto(item.content, item.mime, edits, { guard: valid }).then(result => { if (valid()) { preview = result; previewPending = false; } }).catch(error => { if (valid()) { previewPending = false; message = error.message; } });
    return () => { cancelled = true; };
  });
  $effect(() => {
    const playing = session?.slideshow, index = session?.slideshowIndex, seconds = photosData.preferences.slideshowSeconds, enabled = active && available, count = items.length;
    if (!playing || !enabled || count < 2) return;
    const owner = root, id = windowId;
    const timer = setTimeout(() => { if (current() && owner === root && id === windowId && session.slideshow && session.slideshowIndex === index) command('slideshow', { enabled: true, index: (index + 1) % count }); }, seconds * 1000);
    return () => clearTimeout(timer);
  });
</script>

<section bind:this={root} class="photos-app" class:classic class:windows class:golden class:inactive={!active} data-photos-window-id={windowId} data-profile={profile.id} onkeydown={key} role="region" aria-label={windows?'Microsoft Photos':'Photos'} tabindex="-1">
  <div class="photos-main-surface" inert={!!session?.sheet || !available || !active}>
    <header class="photos-toolbar">
      {#if !windows}<WindowControls active={active} onclose={()=>dirty&&!session.editing?sheet('close'):session.editing?sheet('close'):command('closeConfirm',{decision:'discard'})} onminimize={controls.onminimize} onzoom={controls.onzoom} onfullscreen={controls.onfullscreen} onsplitbegin={controls.onsplitbegin} onsplitside={controls.onsplitside} ongreenmenu={controls.ongreenmenu} fullScreen={controls.fullScreen} revealedTop={controls.revealedTop} modernGreenMenu={controls.modernGreenMenu} zoomed={controls.zoomed}/>{:else}<strong class="photos-brand">{external?'▣ '+selected?.title:'▧ Photos'}</strong>{/if}
      {#if (session?.viewerId || session?.editing) && !external}<button data-photos-control="back" title="Back to library" onclick={()=>session.editing?command('editCancel'):navigate(session.section)}>‹</button>{/if}
      <label class="photos-zoom"><span>−</span><input data-photos-control="zoom" aria-label="Zoom" type="range" min="0.25" max={session?.viewerId?4:2} step="0.05" value={session?.zoom??1} oninput={event=>command('zoom',{zoom:Number(event.currentTarget.value)})}/><span>+</span></label>
      {#if !windows && !session?.viewerId && !session?.editing}<nav class="photos-grouping" aria-label="Library grouping">{#each (classic?[['all','Photos'],['moments','Moments'],['collections','Collections'],['years','Years']]:[['years','Years'],['collections','Months'],['days','Days'],['all','All Photos']]) as [id,label]}<button data-photos-control={`group:${id}`} class:pressed={session?.grouping===id} onclick={()=>navigate('library',id)}>{label}</button>{/each}</nav>{:else}<strong class="photos-toolbar-title">{session?.editing?'Edit':selected?.title??heading}{dirty?' ·':''}</strong>{/if}
      <div class="photos-toolbar-spacer"></div>
      {#if external}<button data-photos-control="save" disabled={!dirty} class:primary={dirty} title={windows?'Save to actual Files':'Save'} onclick={()=>command('save')}>{windows?'Save':'⌘S'}{dirty?'':' ✓'}</button>{/if}
      <button data-photos-control="info" disabled={!hasSelection} title="Info" onclick={()=>sheet('metadata')}>ⓘ</button>
      <button data-photos-control="share" disabled={!hasSelection||deleting} title="Share" onclick={()=>command('share')}>↑</button>
      <button data-photos-control="favorite" disabled={!hasSelection||deleting||external} title="Favorite" onclick={()=>command('favorite',{enabled:!selected.favorite})}>{selected?.favorite?'♥':'♡'}</button>
      <button data-photos-control="edit" disabled={!hasSelection||deleting||selected?.mime.startsWith('video/')} onclick={()=>command('editBegin')}>Edit{windows?' image':''}</button>
      {#if !external}<label class="photos-search"><span>⌕</span><input data-photos-control="search" aria-label="Search authored photo metadata" placeholder="Search" value={session?.search??''} maxlength="4096" oninput={event=>command('search',{query:event.currentTarget.value})}/></label>{/if}
      {#if windows && !external}<button data-photos-control="import" onclick={()=>command('import')}>Import</button>{/if}
      <button data-photos-control="preferences" title={classic?'Preferences':'Settings'} onclick={()=>sheet('preferences')}>⚙</button>
    </header>
    <nav class="photos-local-menubar" aria-label="Application menus">{#each ['file','edit','view','photos','window','help'] as menu}<button data-photos-control={`menu:${menu}`} class:pressed={session?.menu===menu} onclick={()=>command('sheet',{sheet:null,menu:session.menu===menu?null:menu})}>{menu==='photos'?windows?'Image':'Image':menu[0].toUpperCase()+menu.slice(1)}</button>{/each}</nav>
    {#if session?.menu}<div class="photos-menu" role="menu" aria-label={session.menu}>
      {#if session.menu==='file'}{#if external}<button role="menuitem" onclick={()=>command('openFile')}>Open Actual Files Image…</button><button role="menuitem" disabled={!hasSelection} onclick={()=>sheet('export')}>Export Photo…</button><button role="menuitem" disabled={!hasSelection} onclick={()=>command('print')}>Print…</button>{:else}<button role="menuitem" onclick={()=>command('import')}>Import…</button><button role="menuitem" disabled={!hasSelection} onclick={()=>sheet('export')}>Export Photo…</button><button role="menuitem" disabled={!hasSelection} onclick={()=>command('print')}>Print…</button><button role="menuitem" onclick={()=>sheet('album')}>New Album…</button><button role="menuitem" onclick={()=>sheet('folder')}>New Folder…</button><button role="menuitem" disabled={!items.length} onclick={()=>command('slideshow',{enabled:true,index:0})}>Play Slideshow</button>{/if}
      {:else if session.menu==='edit'}{#if external}<button role="menuitem" onclick={()=>command('undo')} disabled={!undoEnabled}>Undo Edit</button><button role="menuitem" onclick={()=>command('redo')} disabled={!redoEnabled}>Redo Edit</button><button role="menuitem" onclick={()=>command('save')} disabled={!dirty}>Save Actual File</button><button role="menuitem" onclick={()=>sheet('preferences')}>{classic?'Preferences':'Settings'}…</button>{:else}<button role="menuitem" disabled={!items.length} onclick={()=>command('select',{ids:items.map(item=>item.id)})}>Select All</button><button role="menuitem" onclick={()=>command('select',{ids:[]})}>Deselect All</button><button role="menuitem" onclick={()=>sheet('preferences')}>{classic?'Preferences':'Settings'}…</button>{/if}
      {:else if session.menu==='view'}<button role="menuitem" onclick={()=>command('preferences',{showHidden:!photosData.preferences.showHidden})}>{photosData.preferences.showHidden?'Hide':'Show'} Hidden Photo Album</button>{#if !external}<button role="menuitem" onclick={()=>navigate('library')}>Library</button><button role="menuitem" onclick={()=>navigate('trash')}>Recently Deleted</button>{:else}<button role="menuitem" onclick={()=>command('openFile')}>Open Actual Files Image…</button>{/if}
      {:else if session.menu==='photos'}<button role="menuitem" disabled={!hasSelection||external} onclick={()=>command('duplicate')}>Duplicate Photo</button><button role="menuitem" disabled={!hasSelection||external} onclick={()=>command('hide',{enabled:!selected.hidden})}>{selected?.hidden?'Unhide':'Hide'} Photo</button><button role="menuitem" disabled={!hasSelection||external} onclick={()=>sheet('delete')}>Delete Photo…</button><button role="menuitem" disabled={!selected?.editedContent} onclick={()=>command('revert')}>Revert to Original</button><button role="menuitem" disabled={!hasSelection||external} onclick={()=>sheet('album')}>Add to Album…</button>
      {:else if session.menu==='window'}<button role="menuitem" onclick={()=>dirty||session.editing?sheet('close'):command('closeConfirm',{decision:'discard'})}>Close Window</button>
      {:else}<button role="menuitem" onclick={()=>sheet('help')}>Photos Help</button>{/if}
      <button role="menuitem" onclick={()=>command('sheet',{sheet:null,menu:null})}>Dismiss Menu</button>
    </div>{/if}
    <div class="photos-body">
      {#if !session?.editing && !session?.slideshow && !external}<aside class="photos-sidebar" data-photos-area="sidebar" aria-label="Photo library">
        <small>{windows?'Collection':classic?'Library':'Photos'}</small>
        {#each [['library',windows?'All Photos':classic?'Photos':'Library',''],['memories',windows?'Memories · local':'Memories','◷'],['favorites','Favorites','♡'],['people',windows?'People · authored':classic?'People':'People & Pets','♙'],['places',windows?'Places · authored':'Places','⌖'],['captures',windows?'Fictional Camera':'Photo Booth',''],['trash',windows?'Local Trash':'Recently Deleted','']] as [id,label,icon]}<button data-photos-control={`section:${id}`} class:pressed={session?.section===id} onclick={()=>navigate(id)}><span>{icon}</span>{label}</button>{/each}
        {#if photosData.preferences.showHidden}<button data-photos-control="section:hidden" class:pressed={session?.section==='hidden'} onclick={()=>navigate('hidden')}><span>◌</span>Hidden</button>{/if}
        {#if windows}<small>Cloud services · local simulation</small><button data-photos-control="section:cloud" class:pressed={session?.section==='cloud'} onclick={()=>navigate('cloud')}>☁ iCloud Photos</button><p class="photos-sidebar-note">No OneDrive or iCloud account connection.</p>{/if}
        <small>{windows?'Local Collections · equivalent':'Albums'}</small>
        {#if photosData.preferences.sharedAlbums}<button data-photos-control="section:shared" class:pressed={session?.section==='shared'} onclick={()=>navigate('shared')}>▱ Shared Albums <small>local</small></button>{/if}
        {#each photosData.folders as folder}<button data-photos-control={`folder:${folder.id}`} class:pressed={session?.section===`folder:${folder.id}`} onclick={()=>navigate(`folder:${folder.id}`)}>▱ {folder.name}</button>{#each photosData.albums.filter(album=>album.folderId===folder.id&&(!album.shared||photosData.preferences.sharedAlbums)) as album}<button class="photos-sidebar-album nested" data-photos-control={`album:${album.id}`} class:pressed={session?.section===`album:${album.id}`} onclick={()=>navigate(`album:${album.id}`)}>▧ {album.name}</button>{/each}{/each}
        {#each photosData.albums.filter(album=>!album.folderId&&(!album.shared||photosData.preferences.sharedAlbums)) as album}<button class="photos-sidebar-album" data-photos-control={`album:${album.id}`} class:pressed={session?.section===`album:${album.id}`} onclick={()=>navigate(`album:${album.id}`)}>▧ {album.name}</button>{/each}
        <div class="photos-sidebar-actions"><button data-photos-control="album:new" onclick={()=>sheet('album')}>+ {windows?'Local Album':'Album'}</button><button data-photos-control="folder:new" onclick={()=>sheet('folder')}>+ {windows?'Album Group':'Folder'}</button></div>
      </aside>{/if}
      {#if session?.editing && editingItem}<div class="photos-editor">
        <div class="photos-editor-toolbar"><button data-photos-control="edit:cancel" onclick={()=>command('editCancel')}>Cancel</button><strong>Adjust · Filters · Crop{external?' · Markup':''}</strong><button data-photos-control="edit:undo" disabled={!undoEnabled} onclick={()=>command('undo')}>↶ Undo</button><button data-photos-control="edit:redo" disabled={!redoEnabled} onclick={()=>command('redo')}>↷ Redo</button><button data-photos-control="edit:compare" class:pressed={session.compare} onclick={()=>command('compare',{enabled:!session.compare})}>Show {session.compare?'Edited':'Original'}</button><button data-photos-control="edit:save" class="primary" disabled={previewPending} onclick={()=>command(external?'save':'editSave')}>{windows?(external?'Save':'Save image'):'Done'}</button></div>
        <div class="photos-editor-body"><div class="photos-edit-image" data-photos-area="viewer"><img bind:this={editorImage} draggable="false" src={session.compare?editingItem.content:preview?.content??photoContent(editingItem)} alt={`${editingItem.title} ${session.compare?'original':'pixel edit preview'}`} onpointerdown={gestureStart} onpointermove={gestureMove} onpointerup={gestureEnd} onpointercancel={()=>{gesture=null;markPoints=[];}}/>{#if previewPending}<span class="photos-rendering" role="status">Rendering actual pixels…</span>{/if}</div>
          <aside class="photos-adjustments"><h3>Adjust</h3>{#each [['exposure','Exposure',-1,1],['contrast','Contrast',0,2],['saturation','Saturation',0,2]] as [id,label,min,max]}<label>{label}<output>{session.editing.edits[id].toFixed(2)}</output><input data-photos-control={`edit:${id}`} type="range" {min} {max} step="0.05" value={session.editing.edits[id]} oninput={event=>changeEdit(id,Number(event.currentTarget.value))}/></label>{/each}<h3>Filters</h3><div class="photos-filter-options">{#each ['none','mono','sepia','vivid'] as filter}<button data-photos-control={`filter:${filter}`} class:pressed={session.editing.edits.filter===filter} onclick={()=>changeEdit('filter',filter)}>{filter[0].toUpperCase()+filter.slice(1)}</button>{/each}</div><h3>Crop</h3><p>Normalized source coordinates</p>{#each ['x','y','width','height'] as id}<label>{id}<input data-photos-control={`crop:${id}`} type="number" min={['x','y'].includes(id)?0:0.01} max={id==='width'?1-session.editing.edits.crop.x:id==='height'?1-session.editing.edits.crop.y:0.99} step="0.01" value={session.editing.edits.crop[id]} onchange={event=>crop(id,event.currentTarget.value)}/></label>{/each}<button data-photos-control="edit:rotate" onclick={()=>changeEdit('rotate',(session.editing.edits.rotate+1)%4)}>↻ Rotate 90°</button>
            {#if external}<h3>Resize</h3><p>Output pixel size ({editingItem.width} × {editingItem.height} source)</p><label>Width<input data-photos-control="resize:width" type="number" min="1" max="8192" value={session.editing.edits.resize?.width??editingItem.width} onchange={event=>{const value=Number(event.currentTarget.value);if(value>=1&&value<=8192)changeEdit('resize',{...(session.editing.edits.resize??{height:editingItem.height}),width:value});}}/></label><label>Height<input data-photos-control="resize:height" type="number" min="1" max="8192" value={session.editing.edits.resize?.height??editingItem.height} onchange={event=>{const value=Number(event.currentTarget.value);if(value>=1&&value<=8192)changeEdit('resize',{...(session.editing.edits.resize??{width:editingItem.width}),height:value});}}/></label><button data-photos-control="resize:reset" disabled={!session.editing.edits.resize} onclick={()=>changeEdit('resize',null)}>Reset Size</button>
            <h3>Markup</h3><p>Normalized annotations rendered into saved pixels. Line styles and all tools write genuine raster strokes; point counts bounded at 4096 and 64 marks.</p><div class="photos-filter-options">{#each [['pen','Pen'],['highlighter','Highlighter'],['rectangle','Rectangle'],['ellipse','Ellipse'],['line','Line']] as [id,label]}<button data-photos-control={`tool:${id}`} class:pressed={markTool===id} onclick={()=>markTool=id}>{label}</button>{/each}</div><div class="photos-filter-options">{#each ['solid','dashed','dotted'] as style}<button data-photos-control={`linestyle:${style}`} class:pressed={markStyle===style} onclick={()=>markStyle=style}>{style}</button>{/each}</div><label>Color<input data-photos-control="mark:color" type="color" bind:value={markColor}/></label><label>Width<output>{markWidth}</output><input data-photos-control="mark:width" type="range" min="1" max="32" step="0.25" bind:value={markWidth}/></label><label>Text<input data-photos-control="mark:text" bind:value={markText} maxlength="256" placeholder="Type text annotation"/></label><button data-photos-control="mark:addText" disabled={!markText.trim()} onclick={()=>addTextMark()}>Add Text Annotation</button><p>Pen and highlight rendering are verified period features. Advanced tools may be local extensions, not exact 2023 Photos app behavior.</p>{/if}
            <p>Edits save genuine raster pixels. Original retained for Revert.</p></aside>
        </div>
      </div>
      {:else if (session?.viewerId || session?.slideshow) && shown}<div class="photos-viewer" class:slideshow={session.slideshow}>
        <div class="photos-viewer-image" data-photos-area="viewer" tabindex="0">{#if !external}<button data-photos-control="previous" class="photos-viewer-arrow previous" aria-label="Previous photo" onclick={()=>advance(-1)}>‹</button>{/if}{#if shown.mime.startsWith('video/')}<video src={photoContent(shown)} controls aria-label={shown.title}></video>{:else}<img src={photoContent(shown,session.compare)} alt={shown.title} style:width={`${Math.max(10,session.zoom*100)}%`} style:max-width={session.zoom>1?'none':'100%'}/>{/if}{#if !external}<button data-photos-control="next" class="photos-viewer-arrow next" aria-label="Next photo" onclick={()=>advance(1)}>›</button>{/if}</div>
        <div class="photos-viewer-caption"><strong>{shown.title}</strong><span>{shown.takenAt} · {shown.place||'No location metadata'}</span>{#if session.slideshow}<button data-photos-control="slideshow:stop" onclick={()=>command('slideshow',{enabled:false})}>Stop Slideshow</button>{:else}<button data-photos-control="compare" class:pressed={session.compare} disabled={!shown.editedContent} onclick={()=>command('compare',{enabled:!session.compare})}>Compare Original</button>{/if}</div>
        {#if !external}<div class="photos-filmstrip" data-photos-area="filmstrip">{#each items as item}<button data-photos-control={`filmstrip:${item.id}`} class:pressed={shown.id===item.id} onclick={()=>session.slideshow?command('slideshow',{enabled:true,index:items.indexOf(item)}):command('open',{itemId:item.id})}>{#if item.mime.startsWith('video/')}<video src={photoContent(item)} muted aria-label={item.title}></video>{:else}<img src={photoContent(item)} alt={item.title}/>{/if}</button>{/each}</div>{/if}
      </div>
      {:else}<main class="photos-library" data-photos-area="library" tabindex="0" aria-label={heading}>
        <div class="photos-library-heading"><h1>{session?.search?`Search: ${session.search}`:heading}</h1><span>{items.length} {items.length===1?'item':'items'}</span>{#if windows}<button data-photos-control="slideshow:start" disabled={!items.length} onclick={()=>command('slideshow',{enabled:true,index:0})}>▷ Slideshow</button>{/if}</div>
        {#if session?.section==='cloud'||session?.section==='shared'}<p class="photos-disclosure">Fictional local membership only. No cloud upload, account, network sync, or invitation is performed.</p>{/if}
        {#if session?.section==='hidden'||deleting}<p class="photos-disclosure">Local collection. No biometric authentication or secure vault. {deleting?'Recover items or permanently delete the selected local entries.':'Hidden photos are excluded from the normal library.'}</p>{/if}
        {#if session?.section==='people'}<p class="photos-disclosure">Authored person labels, not face recognition.</p><div class="photos-metadata-groups">{#each people as person}<button data-photos-control={`person:${person}`} onclick={()=>command('search',{query:person})}><span>♙</span><strong>{person}</strong><small>{items.filter(item=>item.people.includes(person)).length} photos</small></button>{/each}</div>
        {:else if session?.section==='places'}<p class="photos-disclosure">Authored location labels; no geolocation or network maps.</p><div class="photos-metadata-groups">{#each places as place}<button data-photos-control={`place:${place}`} onclick={()=>command('search',{query:place})}><span>⌖</span><strong>{place}</strong><small>{items.filter(item=>item.place===place).length} photos</small></button>{/each}</div>
        {:else if session?.section==='memories'}<p class="photos-disclosure">Local date groups, not machine-generated memories or licensed music.</p>{#each groups as group}<button class="photos-memory" data-photos-control={`memory:${group.id}`} onclick={()=>command('slideshow',{enabled:true,index:items.indexOf(group.items[0])})}>{#if !group.items[0].mime.startsWith('video/')}<img src={photoContent(group.items[0])} alt=""/>{/if}<span><strong>{group.title}</strong>{group.items.length} items · Play local slideshow</span></button>{/each}
        {:else}{#each groups as group}<section class="photos-date-group"><h2>{group.title}</h2><div class="photos-grid" class:compact={session?.grouping==='years'||session?.grouping==='collections'} style:--photo-size={`${Math.round(150*(session?.zoom??1))}px`}>{#each group.items as item}<button class="photos-tile" class:selected={session?.selectedIds.includes(item.id)} data-photos-item-id={item.id} data-photos-control={`item:${item.id}`} aria-label={`${item.title}${item.favorite?', favorite':''}`} aria-pressed={session?.selectedIds.includes(item.id)} onclick={event=>select(item,event)} ondblclick={()=>command('open',{itemId:item.id})}>{#if item.mime.startsWith('video/')}<video src={photoContent(item)} muted preload="metadata" aria-label={item.title}></video><span class="photos-tile-video">▶ Video</span>{:else}<img src={photoContent(item)} alt={item.title}/>{/if}{#if item.favorite}<span class="photos-tile-favorite">♥</span>{/if}{#if session?.selectedIds.includes(item.id)}<span class="photos-tile-selected">✓</span>{/if}<span class="photos-tile-title">{item.title}</span></button>{/each}</div></section>{/each}{/if}
        {#if !items.length}<div class="photos-empty"><span>▧</span><h2>{session?.search?'No matching photos':'No Photos'}</h2><p>{session?.search?'Search titles, authored people, locations, or dates.':'Import a genuine local image to this library.'}</p><button data-photos-control="empty:import" onclick={()=>command('import')}>Import…</button></div>{/if}
      </main>{/if}
    </div>
    {#if !session?.editing}<div class="photos-actions" aria-label="Selection actions"><span>{session?.selectedIds.length??0} selected</span>{#if deleting}<button data-photos-control="restore" disabled={!hasSelection} onclick={()=>command('restore')}>Recover</button><button data-photos-control="delete:permanent" disabled={!hasSelection} onclick={()=>sheet('delete')}>Delete Permanently…</button>{:else}<button data-photos-control="duplicate" disabled={!hasSelection||external} onclick={()=>command('duplicate')}>Duplicate</button><button data-photos-control="hide" disabled={!hasSelection||external} onclick={()=>command('hide',{enabled:!selected.hidden})}>{selected?.hidden?'Unhide':'Hide'}</button><button data-photos-control="delete" disabled={!hasSelection||external} onclick={()=>sheet('delete')}>Delete…</button><button data-photos-control="album:add" disabled={!hasSelection||external} onclick={()=>sheet('album')}>Add to Album…</button>{/if}<button data-photos-control="export" disabled={!hasSelection} onclick={()=>sheet('export')}>Export…</button><button data-photos-control="print" disabled={!hasSelection||selected?.mime.startsWith('video/')} onclick={()=>command('print')}>Print…</button></div>{/if}
    <footer class="photos-status" role="status">{message||`${external?'External local image · genuine edits retained until actual Save':`${items.length} local items · No cloud, face recognition, or host camera`}${golden?' · Tahoe 26 qualified visual proxy for Golden Gate 27.0.1':''}`}</footer>
  </div>
  {#if session?.sheet}<div class="photos-sheet-backdrop"><section class="photos-sheet" role="dialog" aria-modal="true" aria-label={session.sheet}>
    <h2>{{metadata:'Info',preferences:classic?'Photos Preferences':'Photos Settings',album:'Albums',folder:'Folders',help:'Photos Help',delete:deleting?'Permanently Delete Photos?':'Delete Photos?',close:'Save Changes?',memory:'Local Slideshow',export:'Export to Files'}[session.sheet]}</h2>
    {#if session.sheet==='metadata'&&selected}<dl><dt>Title</dt><dd>{selected.title}</dd><dt>Format</dt><dd>{selected.editedMime||selected.mime}</dd><dt>Dimensions</dt><dd>{selected.width} × {selected.height} pixels</dd><dt>Date</dt><dd>{selected.takenAt||'Unspecified'}</dd><dt>Location</dt><dd>{selected.place||'Unspecified'}</dd><dt>People</dt><dd>{selected.people.join(', ')||'No authored labels'}</dd><dt>Library</dt><dd>{selected.inLibrary===false?'External image — not added to the local library':'Retained library photo'}</dd><dt>Source</dt><dd>{selected.sourceFileId||'Authored local fixture'}</dd><dt>Revision</dt><dd>{selected.revision}{dirty?' (unsaved)':''}</dd></dl><p>Metadata is authored local catalog data. Imported items use scene import time, not an extracted camera capture date. No EXIF, GPS, camera model, biometric identity, or device provenance is fabricated.</p>
    {:else if session.sheet==='preferences'}<label class="photos-check"><input data-photos-control="preference:cloud" type="checkbox" checked={photosData.preferences.iCloud} onchange={event=>command('preferences',{iCloud:event.currentTarget.checked})}/>iCloud Photos · fictional local mirror</label><label class="photos-check"><input data-photos-control="preference:shared" type="checkbox" checked={photosData.preferences.sharedAlbums} onchange={event=>command('preferences',{sharedAlbums:event.currentTarget.checked})}/>Shared Albums · local collections</label><label class="photos-check"><input data-photos-control="preference:hidden" type="checkbox" checked={photosData.preferences.showHidden} onchange={event=>command('preferences',{showHidden:event.currentTarget.checked})}/>Show Hidden Album</label><label>Slideshow seconds<input data-photos-control="preference:slideshow" type="number" min="1" max="30" value={photosData.preferences.slideshowSeconds} onchange={event=>command('preferences',{slideshowSeconds:Number(event.currentTarget.value)})}/></label><p>No account sign-in, external uploads, downloads, cloud sync, shared invitations, or biometric authentication.</p>
    {:else if session.sheet==='export'&&selected}<label>Name<input data-photos-control="export:name" bind:value={exportName} placeholder={selected.title} maxlength="256"/></label>{#if !selected.mime.startsWith('video/')}<label>Format<select data-photos-control="export:format" bind:value={exportFormat}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>{/if}<label class="photos-check"><input data-photos-control="export:original" type="checkbox" bind:checked={exportOriginal}/>Unmodified original bytes</label><button data-photos-control="export:save" onclick={()=>command('export',{...(exportName.trim()?{name:exportName}:{}),original:exportOriginal,...(!selected.mime.startsWith('video/')&&!exportOriginal?{format:exportFormat}:{})})}>Export Actual Media</button><p>Exports genuine raster bytes to shared Files; no compression beyond chosen format.</p>
    {:else if session.sheet==='album'}<label>Album<select data-photos-control="album:choose" bind:value={albumId}><option value="">New Album</option>{#each photosData.albums as album}<option value={album.id}>{album.name}</option>{/each}</select></label><label>Name<input data-photos-control="album:name" bind:value={albumName} maxlength="256" placeholder={photosData.albums.find(album=>album.id===albumId)?.name??'Album name'}/></label>{#if !albumId}<label>Folder<select data-photos-control="album:folder" bind:value={folderId}><option value="">None</option>{#each photosData.folders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select></label><label class="photos-check"><input data-photos-control="album:shared" type="checkbox" bind:checked={albumShared}/>Shared Album · fictional local collection</label><button data-photos-control="album:create" disabled={!albumName.trim()} onclick={()=>saveAlbum('create')}>Create Album</button>{:else}<button data-photos-control="album:rename" disabled={!albumName.trim()} onclick={()=>saveAlbum('rename')}>Rename</button><button data-photos-control="album:delete" onclick={()=>saveAlbum('delete')}>Delete Album</button><button data-photos-control="album:addSelected" disabled={!session.selectedIds.length} onclick={()=>saveAlbum('add')}>Add Selected Photos</button><button data-photos-control="album:removeSelected" disabled={!session.selectedIds.length} onclick={()=>saveAlbum('remove')}>Remove Selected Photos</button>{/if}<p>Deleting an album leaves its photos in the library.</p>
    {:else if session.sheet==='folder'}<label>Folder<select data-photos-control="folder:choose" bind:value={folderId}><option value="">New Folder</option>{#each photosData.folders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select></label><label>Name<input data-photos-control="folder:name" bind:value={folderName} maxlength="256"/></label><button data-photos-control="folder:save" disabled={!folderName.trim()} onclick={()=>saveFolder(folderId?'rename':'create')}>{folderId?'Rename':'Create Folder'}</button>{#if folderId}<button data-photos-control="folder:delete" onclick={()=>saveFolder('delete')}>Delete Folder</button>{/if}
    {:else if session.sheet==='delete'}<p>{deleting?'Permanently delete the selected local items? This cannot be undone.':'Move the selected items to Recently Deleted? Their original and edited bytes remain recoverable there.'}</p><button data-photos-control="delete:confirm" class="danger" onclick={()=>command('delete',{confirm:true,permanent:deleting})}>{deleting?'Delete Permanently':'Delete Photos'}</button>
    {:else if session.sheet==='close'}<p>Save the current genuine raster edits before closing?</p><button data-photos-control="close:discard" onclick={()=>command('closeConfirm',{decision:'discard'})}>Discard Changes</button><button data-photos-control="close:cancel" onclick={()=>command('closeConfirm',{decision:'cancel'})}>Cancel</button><button data-photos-control="close:save" class="primary" onclick={()=>command('closeConfirm',{decision:'save'})}>Save</button>
    {:else if session.sheet==='memory'}<p>Slideshow displays local items with the configured duration. No generated movie or music service.</p><button data-photos-control="memory:play" onclick={()=>command('slideshow',{enabled:true,index:0})}>Play</button>
    {:else if session.sheet==='help'}<p>Browse genuine local images and videos. Select multiple photos with {windows?'Ctrl':'Command'}-click; double-click to view. Arrow keys navigate the viewer. Select All: {windows?'Ctrl+A':'⌘A'}.</p><p>Import uses shared Files. Export saves original or actual edited pixels. Editing supports crop, quarter-turn rotate, exposure, contrast, saturation, and four filters. Compare shows retained original bytes; Revert removes raster edits.</p><p>People and places are authored metadata. iCloud and shared membership are fictional local collections, not services. Hidden and Recently Deleted are not protected by biometric authentication.</p>{#if windows}<p>Album groups, authored people/place browsing, hidden collections, local trash, and local memories are functional local equivalents, not claims that the new 2023 Windows Photos app has the Mac library surfaces. Album groups do not browse real Files folders; local trash retains library copies without deleting their original Files sources or using Windows Recycle Bin. Fictional Camera is not native Windows Camera or Photo Booth. Advanced shapes, text, styled strokes, and dimension resize are explicit local editing equivalents; no cloud AI or modern Designer features are backported.</p>{/if}<p>{golden?'Golden Gate 27.0.1 uses qualified macOS Tahoe 26 visual research, not a claim of exact 27 UI fidelity.':windows?'Microsoft Photos is a separately updated package; this surface uses period September 2023 evidence, not a claim that build 22631.2428 fixed the Photos package version.':'Native-era layout is authored from Apple Photos primary screenshots.'} Windows has no native Photo Booth. No real camera, microphone, host media devices, Apple Intelligence, or cloud network access.</p>{/if}
    {#if session.sheet==='help'}<p>Bundled authored video and recorded clips use genuine browser-supported WebM/MP4 containers. Playback is a local equivalent; the historical native package’s container/codec acceptance is not emulated or claimed.</p>{/if}
    {#if message}<p class="photos-error" role="alert">{message}</p>{/if}
    {#if session.sheet!=='close'}<div class="photos-sheet-actions"><button data-photos-control="sheet:done" onclick={()=>command('sheet',{sheet:null,menu:null})}>Done</button></div>{/if}
  </section></div>{/if}
</section>

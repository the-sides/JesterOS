<script>
  import { onMount, tick } from 'svelte';
  import Windows11Explorer from './Windows11Explorer.svelte';
  import Windows11Notepad from './Windows11Notepad.svelte';
  import Windows11Calculator from './Windows11Calculator.svelte';
  import Windows11Settings from './Windows11Settings.svelte';
  import Windows11Edge from './Windows11Edge.svelte';
  import Windows11Paint from './Windows11Paint.svelte';
  import Windows11Photos from './Windows11Photos.svelte';
  import Windows11Clock from './Windows11Clock.svelte';
  import Windows11Snipping from './Windows11Snipping.svelte';
  import Windows11Terminal from './Windows11Terminal.svelte';
  import { createWindows11AppView } from './windows11-app-view.js';
  import { liveFile } from './windows11-app-helpers.js';
  import './windows11-apps.css';
  let {appId,windowId,profile,native,execute,registerView} = $props();
  let root;
  let surface = null;
  let mounted = false;
  const components = {explorer:Windows11Explorer,notepad:Windows11Notepad,calculator:Windows11Calculator,settings:Windows11Settings,edge:Windows11Edge,paint:Windows11Paint,photos:Windows11Photos,clock:Windows11Clock,snipping:Windows11Snipping,terminal:Windows11Terminal};
  const Component = $derived(components[appId]);
  const state = $derived(native.apps[appId]);
  const view = createWindows11AppView(() => root,() => surface);
  async function scopedExecute(request) {
    const target = request.target || {};
    const ownApp = request.command.startsWith(`win11.${appId}.`) ||
      (request.command.startsWith('win11.apps.') && target.appId === appId);
    if (ownApp) return execute({ ...request, target: { ...target, windowId } });
    // File Open owns the source window. The MIME-aware reducer activates the
    // genuine destination; pre-opening by legacy kind creates an empty editor.
    if (request.command === 'win11.files.open')
      return execute({ ...request, target: { ...target, windowId: target.windowId ?? windowId } });
    if (!target.windowId && request.command === 'win11.photos.open')
      return execute({ command: 'win11.files.open', target: { fileId: target.fileId, windowId }, payload: {} });
    if (!target.windowId && request.command === 'win11.notepad.open') {
      const file = liveFile(native.apps, target.fileId);
      const destination = file && ({ folder: 'explorer', text: 'notepad', image: 'photos' })[file.kind];
      const requested = request.command.split('.')[1];
      if (destination && destination === requested) {
        const opened = await execute({ command: 'app.open', target: { appId: destination }, payload: {} });
        if (opened.status !== 'applied') return opened;
        return execute({ ...request, target: { ...target, windowId: opened.target.windowId } });
      }
    }
    const result = await execute({ ...request, target });
    if (result.status === 'applied' && request.command === 'window.create' && target.appId === appId && mounted && root?.isConnected && state.ui.menu)
      await execute({ command: 'win11.apps.menu', target: { appId, windowId }, payload: { menu: null } });
    return result;
  }
  const command = (name,target={},payload={}) => scopedExecute({command:name,target,payload});
  function registerSurface(callback) { surface = callback; return () => {if(surface === callback) surface = null;}; }
  function observeFocus(event) { if (!mounted || !root?.isConnected) return; const element = event.target.closest?.('[data-control]'); if(element && root.contains(element)) command('win11.apps.focus.observe',{appId,control:element.dataset.control}); }
  function observeBlur(event) { if(!root?.contains(event.relatedTarget)) queueMicrotask(() => { if(mounted && root?.isConnected && view.focusedControl() === null) command('win11.apps.focus.observe',{appId,control:null}); }); }
  function observeSelection(event) { const element = event.target; if(mounted && element.isConnected && element.dataset.control && typeof element.selectionStart === 'number') command('win11.apps.selection.observe',{appId,control:element.dataset.control},{start:element.selectionStart,end:element.selectionEnd}); }
  function dismissMenu(event) { if(event.key === 'Escape' && state.ui.menu) { event.preventDefault(); command('win11.apps.menu',{appId},{menu:null}); } }
  $effect(() => {
    const dialog = state.ui.dialog;
    if(dialog) tick().then(() => {
      if(!mounted || state.ui.dialog !== dialog || !root?.isConnected) return;
      const element = [...root.querySelectorAll('[role="dialog"] [data-control]')].find(item => !item.disabled && !item.closest('[hidden],[inert]'));
      if(element) command('win11.apps.focus',{appId,control:element.dataset.control});
    });
  });
  onMount(() => {
    mounted = true;
    const keyboard = event => {
      if (!root?.isConnected || event.target.closest?.('[data-window-id]')?.dataset.windowId !== windowId) return;
      dismissMenu(event);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' &&
        ((['explorer', 'edge'].includes(appId) && !event.shiftKey) || (appId === 'notepad' && event.shiftKey))) {
        event.preventDefault();
        if (!state.ui.dialog && !state.pendingClose) command('window.create', { appId });
      }
    };
    document.addEventListener('keydown', keyboard);
    const cleanup = registerView(windowId,view);
    tick().then(() => {
      if (!mounted || !root?.isConnected) return;
      const selection = state.ui.selection;
      if (selection) view.select(selection.control, selection.start, selection.end, false);
      for (const [area, offsets] of Object.entries(state.ui.scroll)) view.scroll(area, offsets.top, offsets.left);
    });
    return () => { mounted = false; document.removeEventListener('keydown', keyboard); cleanup(); };
  });
</script>
<section class="w11-app" class:dark={native.apps.settings.theme === 'dark'} class:custom-accent={native.apps.settings.accent !== '#0078d4'} style:--w11-accent={native.apps.settings.accent} data-app-id={appId} data-window-id={windowId} aria-label={profile.applications[appId]?.name || appId} bind:this={root} onfocusin={observeFocus} onfocusout={observeBlur} onselect={observeSelection}>
  {#if Component}<Component {profile} {native} {windowId} execute={scopedExecute} {registerSurface} />{/if}
</section>

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
  import './windows11-apps.css';
  let {appId,profile,native,execute,registerView} = $props();
  let root;
  let surface = null;
  const components = {explorer:Windows11Explorer,notepad:Windows11Notepad,calculator:Windows11Calculator,settings:Windows11Settings,edge:Windows11Edge,paint:Windows11Paint,photos:Windows11Photos,clock:Windows11Clock,snipping:Windows11Snipping,terminal:Windows11Terminal};
  const Component = $derived(components[appId]);
  const state = $derived(native.apps[appId]);
  const view = createWindows11AppView(() => root,() => surface);
  const command = (name,target={},payload={}) => execute({command:name,target,payload});
  function registerSurface(callback) { surface = callback; return () => {if(surface === callback) surface = null;}; }
  function observeFocus(event) { const element = event.target.closest('[data-control]'); if(element && root.contains(element)) command('win11.apps.focus.observe',{appId,control:element.dataset.control}); }
  function observeBlur(event) { if(!root.contains(event.relatedTarget)) queueMicrotask(() => { if(view.focusedControl() === null) command('win11.apps.focus.observe',{appId,control:null}); }); }
  function observeSelection(event) { const element = event.target; if(element.dataset.control && typeof element.selectionStart === 'number') command('win11.apps.selection.observe',{appId,control:element.dataset.control},{start:element.selectionStart,end:element.selectionEnd}); }
  function dismissMenu(event) { if(event.key === 'Escape' && state.ui.menu) { event.preventDefault(); command('win11.apps.menu',{appId},{menu:null}); } }
  $effect(() => {
    const dialog = state.ui.dialog;
    if(dialog) tick().then(() => {
      if(state.ui.dialog !== dialog || !root) return;
      const element = [...root.querySelectorAll('[role="dialog"] [data-control]')].find(item => !item.disabled && !item.closest('[hidden],[inert]'));
      if(element) command('win11.apps.focus',{appId,control:element.dataset.control});
    });
  });
  onMount(() => {
    const keyboard = event => { if (root?.contains(event.target)) dismissMenu(event); };
    document.addEventListener('keydown', keyboard);
    const cleanup = registerView(appId,view);
    tick().then(() => { for(const [area,offsets] of Object.entries(state.ui.scroll)) view.scroll(area,offsets.top,offsets.left); });
    return () => { document.removeEventListener('keydown', keyboard); cleanup(); };
  });
</script>
<section class="w11-app" class:dark={native.apps.settings.theme === 'dark'} style:--w11-accent={native.apps.settings.accent} data-app-id={appId} aria-label={profile.applications[appId]?.name || appId} bind:this={root} onfocusin={observeFocus} onfocusout={observeBlur} onselect={observeSelection}>
  {#if Component}<Component {profile} {native} {execute} {registerSurface} />{/if}
</section>

<script>
 import { onMount } from 'svelte';
 import { keys } from './windows11-calculator.js';
 let {native,execute}=$props();
 let element;
 const state=$derived(native.apps.calculator);
 const labels={'backspace':'⌫',reciprocal:'1/x',square:'x²',sqrt:'√x',divide:'÷',multiply:'×',subtract:'−',add:'+',sign:'+/−',equals:'='};
 const send=(name,payload={},target={})=>execute({command:`win11.calculator.${name}`,target,payload});
 function keyboard(event) {
  if(event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
   || event.target instanceof HTMLInputElement
   || (event.target instanceof Element && event.target.closest('button') && ['Enter',' '].includes(event.key))) return;
  const key = /^\d$/.test(event.key) ? event.key : ({'+':'add','-':'subtract','*':'multiply','/':'divide','Enter':'equals','=':'equals','Escape':'C','Backspace':'backspace','.':'.','%':'%'}[event.key]);
  if(key) { event.preventDefault(); send('key',{key}); }
 }
 onMount(() => {
  // Root focus after app.open belongs to the interactive managed dialog, not
  // its inner section. Listen on this frame only, including its native controls.
  const frame = element.closest('.managed-window[data-window-id]');
  frame.addEventListener('keydown', keyboard);
  return () => frame.removeEventListener('keydown', keyboard);
 });
</script>
<section class="calculator" data-calculator data-control="calculator-keyboard" tabindex="-1" aria-label="Standard Calculator" bind:this={element}>
 <div class="w11-app-toolbar"><button data-control="calculator-navigation" aria-label="Navigation" onclick={()=>execute({command:'win11.apps.menu',target:{appId:'calculator'},payload:{menu:state.ui.menu?null:'navigation'}})}>☰</button><h2>Standard</h2><button data-control="calculator-toggle-history" aria-label="History" onclick={()=>send('panel',{panel:state.panel==='none'?'history':'none'})}>◷</button></div>
 {#if state.ui.menu}<div class="w11-app-menu"><strong>Calculator</strong><button data-control="calculator-standard" onclick={()=>execute({command:'win11.apps.menu',target:{appId:'calculator'},payload:{menu:null}})}>Standard ✓</button><button data-control="calculator-new-window" onclick={()=>execute({command:'window.create',target:{appId:'calculator'},payload:{}})}>New window</button><button data-control="calculator-exit" onclick={()=>execute({command:'app.quit',target:{appId:'calculator'},payload:{}})}>Exit</button><small>Other calculator modes are not represented.</small></div>{/if}
 <div class="calculator-body"><div class="main"><div class="expression">{state.expression || ' '}</div><output aria-live="polite" class:error={state.error}>{state.display}</output>
 <div class="memory-bar">{#each [['clear','MC'],['recall','MR'],['add','M+'],['subtract','M−'],['store','MS']] as [action,label]}<button data-control={`calculator-memory-${action}`} disabled={['clear','recall'].includes(action)&&!state.memory.length} onclick={()=>send('memory',{action})}>{label}</button>{/each}<button data-control="calculator-memory-panel" onclick={()=>send('panel',{panel:state.panel==='memory'?'none':'memory'})}>M▾</button></div>
 <div class="keypad">{#each keys as key}<button class:digit={/^\d$/.test(key)||key==='.'||key==='sign'} class:equals={key==='equals'} data-control={`calculator-key-${key}`} aria-label={key==='backspace'?'Backspace':labels[key]||key} onclick={()=>send('key',{key})}>{labels[key]||key}</button>{/each}</div></div>
 {#if state.panel!=='none'}<aside><nav><button data-control="calculator-history-tab" class:selected={state.panel==='history'} onclick={()=>send('panel',{panel:'history'})}>History</button><button data-control="calculator-memory-tab" class:selected={state.panel==='memory'} onclick={()=>send('panel',{panel:'memory'})}>Memory</button></nav><div class="entries" data-area="calculator-entries" onscroll={event=>execute({command:'win11.apps.scroll.observe',target:{appId:'calculator',area:'calculator-entries'},payload:{top:event.currentTarget.scrollTop,left:event.currentTarget.scrollLeft}})}>
 {#if state.panel==='history'}{#each state.history as entry}<button class="entry" data-control={`calculator-history-${entry.id}`} onclick={()=>send('historyRecall',{}, {entryId:entry.id})}><small>{entry.expression}</small><strong>{entry.value}</strong></button>{:else}<p>There's no history yet</p>{/each}{:else}{#each state.memory as entry}<div class="entry"><button data-control={`calculator-recall-${entry.id}`} onclick={()=>send('memoryEntry',{action:'recall'},{entryId:entry.id})}>{entry.value}</button><div>{#each [['delete','MC'],['add','M+'],['subtract','M−']] as [action,label]}<button data-control={`calculator-${action}-${entry.id}`} onclick={()=>send('memoryEntry',{action},{entryId:entry.id})}>{label}</button>{/each}</div></div>{:else}<p>There's nothing saved in memory</p>{/each}{/if}</div>{#if state.panel==='history'}<button data-control="calculator-clear-history" disabled={!state.history.length} onclick={()=>send('historyClear')}>♜ Clear history</button>{/if}</aside>{/if}</div>
</section>
<style>
 .calculator{height:100%;display:flex;flex-direction:column;background:var(--w11-theme-chrome,#f3f3f3);color:var(--w11-theme-text,#202020);position:relative;outline:none}.calculator h2{font-size:20px;margin:0;flex:1}.calculator button{border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;padding:9px}.calculator button:hover{background:var(--w11-theme-hover,#e6e6e6)}.calculator button:disabled{opacity:.35;cursor:default}.calculator-body{display:flex;flex:1;min-height:0}.main{flex:1;min-width:220px;padding:8px;display:flex;flex-direction:column}.expression{text-align:right;color:var(--w11-theme-muted,#666);font-size:13px;min-height:22px}output{display:block;text-align:right;font-size:42px;font-weight:600;overflow-wrap:anywhere;min-height:64px}output.error{font-size:22px}.memory-bar{display:flex;justify-content:space-between}.memory-bar button{font-size:12px;padding:10px 7px}.keypad{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(6,minmax(38px,1fr));gap:3px;flex:1}.keypad button{background:var(--w11-theme-surface,#f9f9f9);border:1px solid var(--w11-theme-border,#e1e1e1);font-size:19px;box-shadow:0 1px 1px var(--w11-theme-border,#ddd)}.keypad button.digit{background:var(--w11-theme-card,white);font-size:23px}.keypad button.equals{background:var(--w11-accent,#0078d4);color:white}.keypad button:hover{filter:brightness(.96)}aside{width:210px;display:flex;flex-direction:column;padding:8px;min-height:0}aside nav{display:flex;gap:12px}aside nav .selected{border-bottom:3px solid var(--w11-accent,#0078d4);border-radius:0}.entries{flex:1;overflow:auto}.entry{display:flex!important;flex-direction:column;width:100%;text-align:right;margin:15px 0;gap:7px}.entry strong{font-size:23px}.entry small{color:var(--w11-theme-muted,#666)}.entries p{font-size:14px;margin-top:28px}@media(max-width:540px){aside{width:150px}.main{min-width:190px}output{font-size:32px}.keypad button{padding:5px}}
 .keypad{min-height:0}
 .calculator .keypad button.equals:hover{background:var(--w11-accent,#0078d4)}
 @media(max-width:540px){.main{min-width:0;padding:4px}aside{width:130px;padding:4px}aside nav{gap:2px}aside nav button{padding:7px 5px;font-size:12px}.memory-bar button{padding:8px 3px;font-size:11px}.keypad button{min-width:0;font-size:16px}.keypad button.digit{font-size:20px}.entry strong{font-size:19px}}
</style>

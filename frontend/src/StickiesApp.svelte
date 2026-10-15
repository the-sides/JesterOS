<script>
 import { tick } from 'svelte';
 import { stickiesWindow,stickiesSelected,stickiesCapabilities,stickiesSearch } from './stickies-state.js';
 import { textEditPlainText } from './textedit-content.js';
 import { stickiesMenus } from './stickies-menus.js';
 import { createStickiesNativeView } from './stickies-native-view.js';
 import './stickies.css';
 let {window,profile,state: stickiesState,dispatch,onRegisterNativeView=()=>{},onWindowDrag=null,showMenuBar=false}= $props();
 let root=$state(),editor=$state();
 let w=$derived(stickiesWindow(stickiesState,window.id));
 let note=$derived(stickiesSelected(stickiesState,w));
 let cap=$derived(stickiesCapabilities(profile));
 let menus=$derived(stickiesMenus({state: stickiesState,profile,windowId:window.id}));
 let matches=$derived(w?stickiesSearch(stickiesState,w):[]);
 let exportName=$state('Note.rtf'),exportFormat=$state('rtf'),font=$state('Helvetica'),size=$state(12),message=$state('');
 let busy=false;
 let view=createStickiesNativeView({getRoot:()=>root,getEditor:()=>editor,getNote:()=>note,isAvailable:()=>!!w&&!window.minimized});
 async function send(suffix,payload={}){const result=await dispatch({command:`stickies.${suffix}`,target:{windowId:window.id},payload});message=result?.status==='rejected'?result.error?.message??'Operation unavailable.':'';return result;}
 async function request(item){if(!item.enabled||!item.request)return;await send('menu',{menu:null});const result=await dispatch(item.request);message=result?.status==='rejected'?result.error?.message??'Operation unavailable.':'';}
 async function remember(){if(busy)return;const s=view.captureSelection();if(s&&(s.start!==w.selection.start||s.end!==w.selection.end))await send('selection',{start:s.start,end:s.end,revision:s.revision});}
 async function beforeInput(event){event.preventDefault();if(busy||!note)return;const s=view.captureSelection();if(!s)return;let {start,end}=s,text=event.data??'';
  if(event.inputType==='insertParagraph'||event.inputType==='insertLineBreak')text='\n';
  else if(event.inputType==='deleteContentBackward'&&start===end){const prefix=textEditPlainText(note.content).slice(0,start);start-=Array.from(prefix).at(-1)?.length??0;text='';}
  else if(event.inputType==='deleteContentForward'&&start===end){end+=Array.from(textEditPlainText(note.content).slice(end))[0]?.length??0;text='';}
  else if(event.inputType.startsWith('delete'))text='';
  else if(!['insertText','insertCompositionText','insertReplacementText'].includes(event.inputType)){message='This rich input operation is not supported; use the Stickies menu.';return;}
  busy=true;const r=await send('edit',{start,end,text,revision:s.revision});await tick();if(r?.status==='applied')view.selectRange(w.selection.start,w.selection.end);busy=false;
 }
 async function clipboard(event,operation){event.preventDefault();busy=true;const r=await send('clipboard',{operation});await tick();if(r?.status==='applied'&&operation!=='copy')view.selectRange(w.selection.start,w.selection.end);busy=false;}
 async function keydown(event){const primary=cap.windows?event.ctrlKey:event.metaKey;if(primary){const k=event.key.toLowerCase(),commands={n:['note.new',{}],w:['close',{}],f:['sheet',{sheet:'find'}],z:[event.shiftKey?'redo':'undo',{}],b:['format',{bold:true}],i:['format',{italic:true}],u:['format',{underline:true}]};if(commands[k]){event.preventDefault();await remember();await send(...commands[k]);}}}
 let drag=null;
 function dragStart(event){if(event.button!==0||event.target!==event.currentTarget)return;if(onWindowDrag){onWindowDrag(event,window.id);return;}event.currentTarget.setPointerCapture(event.pointerId);drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:window.x,y:window.y};}
 function dragMove(event){if(!drag||drag.pointerId!==event.pointerId)return;void dispatch({command:'window.move',target:{windowId:window.id},payload:{x:drag.x+event.clientX-drag.startX,y:drag.y+event.clientY-drag.startY}});}
 function dragEnd(event){if(drag?.pointerId===event.pointerId){drag=null;void send('geometry');}}
 async function dropped(event){event.preventDefault();const data=event.dataTransfer.getData('application/x-jesteros-file-id');if(data)await send('import',{fileId:data});else message='Drop an original shared Files text/RTF file; attachments and RTFD are unsupported.';}
 $effect(()=>{const actualRoot=root,actualEditor=editor;if(!actualRoot||!actualEditor)return;view=createStickiesNativeView({getRoot:()=>root,getEditor:()=>editor,getNote:()=>note,isAvailable:()=>!!w&&!window.minimized});const unregister=onRegisterNativeView(window.id,view);return ()=>{if(typeof unregister==='function')unregister();else onRegisterNativeView(window.id,null);};});
 $effect(()=>{const selection=w?.selection,revision=note?.revision;if(selection&&editor&&!busy&&editor.ownerDocument.activeElement===editor){void tick().then(()=>view.selectRange(selection.start,selection.end));}void revision;});
</script>

{#if w && note}
<section bind:this={root} class="stickies-app" class:stickies-windows={cap.windows} class:stickies-classic={/high-sierra|mojave/.test(profile.id)} class:stickies-collapsed={note.collapsed} class:stickies-translucent={note.translucent} data-stickies-color={note.color} data-stickies-note={note.id} aria-label={cap.label}>
 <header class="stickies-titlebar" title={`Created: ${new Date(note.createdAt).toLocaleString('en-US',{timeZone:'UTC'})} UTC · Edited: ${new Date(note.modifiedAt).toLocaleString('en-US',{timeZone:'UTC'})} UTC`} ondblclick={()=>send('options',{collapsed:!note.collapsed})} onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}>
  <button class="stickies-close" aria-label="Close note" onclick={()=>send('close')}></button>
  <span>{note.collapsed?textEditPlainText(note.content).split('\n')[0]||'Untitled Note':''}</span>
  <button class="stickies-menu-trigger" aria-label="Stickies menus" onclick={()=>send('menu',{menu:w.menu?null:'file'})}>⋯</button>
  <button class="stickies-collapse" aria-label={window.zoomed||window.maximized?'Restore note size':'Maximize note'} onclick={()=>dispatch({command:cap.windows?'window.setMaximized':'window.setZoomed',target:{windowId:window.id},payload:cap.windows?{maximized:!window.maximized}:{zoomed:!window.zoomed}})}>◿</button>
  <button class="stickies-collapse" aria-label={note.collapsed?'Expand note':'Collapse note'} onclick={()=>send('options',{collapsed:!note.collapsed})}>⊟</button>
 </header>
 {#if showMenuBar || cap.windows}
 <nav class="stickies-menubar" aria-label="Application menus">{#each menus as menu}<button class:active={w.menu===menu.id} onclick={()=>send('menu',{menu:w.menu===menu.id?null:menu.id})}>{menu.label}</button>{/each}</nav>
 {/if}
 {#if w.menu}
 <div class="stickies-menu" role="menu">{#each menus as menu}{#if menu.id===w.menu}{#each menu.children as item}{#if item.children}<strong>{item.label}</strong>{#each item.children as child}<button role="menuitem" disabled={!child.enabled} onclick={()=>request(child)}>{child.label}</button>{/each}{:else}<button role="menuitem" disabled={!item.enabled} onclick={()=>request(item)}><span>{item.checked?'✓ ':''}{item.label}</span><small>{item.shortcut??''}</small></button>{/if}{/each}{/if}{/each}<div class="stickies-menu-switch">{#each menus as menu}<button onclick={()=>send('menu',{menu:menu.id})}>{menu.label}</button>{/each}</div></div>
 {/if}
 {#if !note.collapsed}
  {#if cap.windows}<p class="stickies-disclosure">Mac Stickies local equivalent · separate from Microsoft Sticky Notes</p>{/if}
  <div bind:this={editor} class="stickies-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note text" data-stickies-control="editor" spellcheck="false" tabindex="0" onbeforeinput={beforeInput} onpointerup={remember} onkeyup={remember} onkeydown={keydown} oncopy={(e)=>clipboard(e,'copy')} oncut={(e)=>clipboard(e,'cut')} onpaste={(e)=>clipboard(e,'paste')} ondragover={(e)=>e.preventDefault()} ondrop={dropped}>
   {#each note.content.blocks as block (block.id)}<p data-stickies-paragraph={block.id} style:text-align={block.align} style:line-height={block.spacing} style:margin-left={`${block.indent}pt`} class:stickies-bullet={block.list==='bullet'} class:stickies-number={block.list==='number'}>{#each block.runs as run}<span style:font-family={run.marks.font} style:font-size={`${run.marks.size}pt`} style:color={run.marks.color} style:font-weight={run.marks.bold?'700':'400'} style:font-style={run.marks.italic?'italic':'normal'} style:text-decoration={[run.marks.underline?'underline':'',run.marks.strike?'line-through':''].filter(Boolean).join(' ')||'none'}>{run.text}</span>{/each}{#if !block.runs.some(r=>r.text)}<br />{/if}</p>{/each}
  </div>
  {#if note.floating}<span class="stickies-float-indicator" title="Float on Top">↑</span>{/if}
 {/if}
 {#if w.sheet!=='none'}
 <section class="stickies-sheet" role="dialog" aria-label={w.sheet==='close'?'Close note confirmation':`${w.sheet} controls`}>
  {#if w.sheet==='close'}
   <h2>Are you sure you want to delete this note?</h2><p>Deleting this note removes its retained rich text.</p><div class="stickies-actions"><button onclick={()=>send('close',{decision:'cancel'})}>Cancel</button><button onclick={()=>send('close',{decision:'keep'})}>Keep Note · local</button><button class="default" onclick={()=>send('close',{decision:'delete'})}>Delete Note</button></div>
  {:else if w.sheet==='fonts'}
   <h2>Fonts</h2><p>Select note text to change its formatting.</p><label>Family<select bind:value={font}><option>Helvetica</option><option>Times</option><option>Courier</option><option>Comic Sans MS</option></select></label><label>Size<input type="number" min="1" max="144" step="0.5" bind:value={size}/></label><button onclick={()=>send('format',{font,size})}>Apply Font</button><div class="stickies-actions">{#each ['bold','italic','underline','strike'] as style}<button onclick={()=>send('format',{[style]:true})}>{style}</button>{/each}<button onclick={()=>send('format',{bold:false,italic:false,underline:false,strike:false})}>Regular</button></div><label>Text color<input type="color" value="#000000" oninput={(e)=>send('format',{color:e.currentTarget.value})}/></label><label>Alignment<select onchange={(e)=>send('format',{align:e.currentTarget.value})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option></select></label><label>List<select onchange={(e)=>send('format',{list:e.currentTarget.value})}><option value="none">None</option><option value="bullet">Bullets</option><option value="number">Numbers</option></select></label>
  {:else if w.sheet==='find'}
   <h2>Find</h2><input aria-label="Find text" data-stickies-control="find" value={w.query} oninput={(e)=>send('find',{query:e.currentTarget.value})}/><label><input type="checkbox" checked={w.allNotes} onchange={(e)=>send('find',{allNotes:e.currentTarget.checked})}/>All notes</label><label><input type="checkbox" checked={w.ignoreCase} onchange={(e)=>send('find',{ignoreCase:e.currentTarget.checked})}/>Ignore Case</label><p>{matches.length} matches</p><div class="stickies-actions"><button onclick={()=>send('find.next',{backwards:true})}>Previous</button><button onclick={()=>send('find.next',{backwards:false})}>Next</button></div><input aria-label="Replace with" value={w.replacement} oninput={(e)=>send('find',{replacement:e.currentTarget.value})}/><div class="stickies-actions"><button onclick={()=>send('replace',{all:false})}>Replace</button><button onclick={()=>send('replace',{all:true})}>Replace All</button></div>
  {:else if w.sheet==='export'}
   <h2>Export Text</h2><label>Save As<input bind:value={exportName}/></label><label>Format<select bind:value={exportFormat}><option value="rtf">Rich Text (RTF)</option><option value="txt">Plain Text (UTF-8)</option></select></label><p>Plain text intentionally omits formatting. RTFD and attachments are not supported.</p><button class="default" onclick={()=>send('export',{name:exportName,format:exportFormat})}>Save to Documents</button>
  {:else if w.sheet==='retained'}
   <h2>Retained Notes · local extension</h2>{#each stickiesState.notes as n}<button class="stickies-retained" onclick={()=>send('note.reopen',{noteId:n.id})}>{textEditPlainText(n.content).split('\n')[0]||'Untitled Note'}</button>{/each}
  {:else if w.sheet==='help'}
   <h2>Stickies</h2><p>{cap.disclosure}</p><p>File → New Note opens an independent native note window. Color changes the paper; double-click the title bar to collapse. Window offers Float on Top, Translucent and Arrange By.</p><p>Select rich text before using Font controls. Find searches current or all retained notes. Import/export supports UTF-8 text and the genuine shared TextEdit paragraph RTF subset. Unsupported RTF controls, custom tab stops, tables, attachments and RTFD are rejected, never silently flattened.</p><p>Notes are automatically retained locally. Native Delete Note removes text after confirmation; Keep Note is a disclosed local extension. No Notes database, Microsoft Sticky Notes account, cloud sync or host clipboard is used.</p>
  {/if}
  {#if w.sheet!=='close'}<div class="stickies-actions"><button onclick={()=>send('sheet',{sheet:'none'})}>Done</button></div>{/if}
 </section>
 {/if}
 {#if message}<p class="stickies-status" role="status">{message}</p>{/if}
</section>
{/if}

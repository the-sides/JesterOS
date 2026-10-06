<script>
  import { validLearnedWord } from './editing-state.js';
  let { mode, windowId, note, tools, preferences, execute, onbeforeinput } = $props();
  let error = $state('');
  const owner = $derived({ windowId, noteId: note.id });
  const versioned = $derived({ ...owner, revision: note.updatedAt });
  const find = $derived(tools.find?.windowId === windowId && tools.find.noteId === note.id ? tools.find : null);
  const checked = $derived(tools.spelling?.windowId === windowId && tools.spelling.noteId === note.id ? tools.spelling : null);
  const issue = $derived(checked?.revision === note.updatedAt ? checked.issues[0] : null);
  const range = $derived(issue ? { ...versioned, start: issue.start, end: issue.end } : null);
  async function run(command, target = owner, payload = {}) {
    const result = await execute({ command, target, payload });
    error = result.status === 'rejected' ? result.error.message : '';
    return result;
  }
  const configure = payload => run('text.find.configure', owner, payload);
  const next = backward => run('text.find.next', owner, { backward });
  async function preference(key, node) {
    const result = await run('text.preferences.set', { windowId }, { [key]: node.checked });
    if (result.status === 'rejected' && node.isConnected) node.checked = preferences[key];
  }
  async function checkNext(from = issue?.end ?? 0) {
    return run('text.spelling.check', versioned, { from: Math.min(from, note.text.length), maxIssues: 1, suggestions: true });
  }
  async function changeWord() {
    if (!range) return;
    const replacement = checked.replacement, target = { ...range }, from = target.start + replacement.length;
    const result = await run('text.spelling.replace', target, { replacement });
    if (result.status === 'applied') await checkNext(from);
  }
  async function acceptWord(command) {
    if (!range) return;
    const from = issue.end;
    if ((await run(command, range)).status === 'applied') await checkNext(from);
  }
  function selection() {
    const selected = tools.panel?.selection;
    return selected?.revision === note.updatedAt && selected.start < selected.end ? { start: selected.start, end: selected.end } : null;
  }
  function panelKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); run('text.tools.close', { windowId }); }
  }
</script>

{#if mode === 'find' && find?.open}
  <section class="text-find-bar" data-text-tool-window={windowId} data-text-panel-kind="find" aria-label="Find in note">
    <div class="find-line">
      <input type="search" aria-label="Find text" data-text-tool-control="query" maxlength="4096" value={find.query} onbeforeinput={onbeforeinput}
        oninput={event => configure({ query: event.currentTarget.value })}
        onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); next(event.shiftKey); } else if (event.key === 'Escape') { event.preventDefault(); run('text.find.close'); } }} />
      <output aria-live="polite">{find.query ? `${find.count ? (find.selected?.index ?? 0) + 1 : 0} of ${find.count}` : 'Find in this note'}</output>
      {#if find.count > 500}<span class="language-caption">First 500 matches highlighted; navigation and All include every match.</span>{/if}
      <button type="button" aria-label="Previous match" title="Previous match (⇧⌘G)" disabled={!find.count} onclick={() => next(true)}>‹</button>
      <button type="button" aria-label="Next match" title="Next match (⌘G)" disabled={!find.count} onclick={() => next(false)}>›</button>
      <button type="button" aria-label="Close Find" onclick={() => run('text.find.close')}>Done</button>
    </div>
    <div class="find-options">
      <label><input type="checkbox" checked={find.replace} onchange={event => configure({ replace: event.currentTarget.checked })} />Replace</label>
      <label><input type="checkbox" checked={!find.caseSensitive} onchange={event => configure({ caseSensitive: !event.currentTarget.checked })} />Ignore case</label>
      <label><input type="checkbox" checked={find.wholeWord} onchange={event => configure({ wholeWord: event.currentTarget.checked })} />Whole words</label>
    </div>
    {#if find.replace}
      <div class="find-line">
        <input aria-label="Replace with" data-text-tool-control="replacement" maxlength="4096" value={find.replacement} onbeforeinput={onbeforeinput} oninput={event => configure({ replacement: event.currentTarget.value })} />
        <button type="button" disabled={note.deleted || !find.count} onclick={() => run('text.find.replace', versioned)}>Replace</button>
        <button type="button" disabled={note.deleted || !find.count} onclick={() => run('text.find.replace', versioned, { all: true })}>All</button>
      </div>
    {/if}
    {#if error}<p class="tool-error" role="status">{error}</p>{/if}
  </section>
{:else if mode === 'spelling' || mode === 'substitutions'}
  <div class="text-language-panel" data-text-tool-window={windowId} data-text-panel-kind={mode} role="dialog" aria-label={mode === 'spelling' ? 'Spelling and Grammar' : 'Substitutions'} tabindex="-1" onkeydown={panelKey}>
    <header><strong>{mode === 'spelling' ? 'Spelling and Grammar' : 'Substitutions'}</strong><button type="button" aria-label="Close text tools" onclick={() => run('text.tools.close', { windowId })}>×</button></header>
    <div class="language-content">
      {#if mode === 'spelling'}
        <p class="language-caption">English (United States) · local dictionary</p>
        {#if issue}
          <p class="misspelled-word" title={issue.word}>{issue.word}</p>
          {#if issue.reason === 'word_too_long'}<p class="language-caption">This word exceeds the dictionary’s 128 UTF-16 unit limit. You can replace it manually.</p>{/if}
          <input aria-label="Spelling replacement" data-text-tool-control="word" value={checked.replacement} onbeforeinput={onbeforeinput}
            oninput={event => run('text.spelling.configure', range, { replacement: event.currentTarget.value })} disabled={note.deleted} maxlength="128" />
          <ul class="spelling-guesses" aria-label="Spelling suggestions">
            {#each issue.suggestions as suggestion}<li><button type="button" aria-pressed={checked.replacement === suggestion} onclick={() => run('text.spelling.configure', range, { replacement: suggestion })}>{suggestion}</button></li>{/each}
          </ul>
          {#if !issue.suggestions.length}<p class="language-caption">No suggestions.</p>{/if}
        {:else}<p role="status">{checked?.revision === note.updatedAt ? checked.checkedFrom ? 'No further spelling errors.' : 'No spelling errors found.' : 'The note changed. Check it again.'}</p>{/if}
        <div class="language-actions">
          <button type="button" disabled={!issue || note.deleted || !checked?.replacement} onclick={changeWord}>Change</button>
          <button type="button" disabled={!issue || !validLearnedWord(issue.word)} onclick={() => acceptWord('text.spelling.ignore')}>Ignore</button>
          <button type="button" disabled={!issue || !validLearnedWord(issue.word)} onclick={() => acceptWord('text.spelling.learn')}>Learn</button>
          <button type="button" onclick={() => checkNext(issue ? issue.end : 0)}>Find Next</button>
        </div>
        <label class="language-option"><input type="checkbox" disabled />Check grammar <span>Not implemented</span></label>
        <label class="language-option"><input type="checkbox" checked={preferences.checkSpellingWhileTyping} onchange={event => preference('checkSpellingWhileTyping', event.currentTarget)} />Check spelling while typing</label>
        <label class="language-option"><input type="checkbox" checked={preferences.correctSpellingAutomatically} onchange={event => preference('correctSpellingAutomatically', event.currentTarget)} />Correct spelling automatically</label>
      {:else}
        <label class="language-option"><input type="checkbox" checked={preferences.smartQuotes} onchange={event => preference('smartQuotes', event.currentTarget)} />Smart Quotes</label>
        <label class="language-option"><input type="checkbox" checked={preferences.smartDashes} onchange={event => preference('smartDashes', event.currentTarget)} />Smart Dashes</label>
        <label class="language-option"><input type="checkbox" checked={preferences.textReplacement} onchange={event => preference('textReplacement', event.currentTarget)} />Text Replacement</label>
        <label class="language-option"><input type="checkbox" disabled />Smart Links <span>Plain-text notes</span></label>
        <div class="replacement-list" aria-label="Configured text replacements">
          {#each preferences.replacements as replacement}<div><code>{replacement.from}</code><span>→</span><span>{replacement.to || '(empty)'}</span></div>{/each}
          {#if !preferences.replacements.length}<p>No configured replacements.</p>{/if}
        </div>
        <button type="button" disabled title="Keyboard text settings are not implemented">Text Settings…</button>
        <div class="language-actions">
          <button type="button" disabled={note.deleted || !selection()} onclick={() => run('text.substitutions.apply', versioned, selection())}>Replace Selection</button>
          <button type="button" disabled={note.deleted} onclick={() => run('text.substitutions.apply', versioned)}>Replace All</button>
        </div>
      {/if}
      {#if error}<p class="tool-error" role="status">{error}</p>{/if}
    </div>
  </div>
{/if}

<style>
  .text-find-bar { flex: 0 0 auto; padding: 8px 10px; border-bottom: 1px solid var(--appearance-soft-border, #0002); background: var(--appearance-panel, #f4f3f2); font-size: 12px; color: var(--appearance-ink, #242424); }
  .find-line { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  input:not([type=checkbox]) { min-width: 0; border: 1px solid var(--appearance-border, #0003); border-radius: 5px; background: var(--appearance-input, #fff); color: inherit; font: inherit; padding: 4px 6px; }
  .find-line input { flex: 1 1 90px; width: 90px; }
  output { color: var(--appearance-muted, #777); font-size: 11px; white-space: nowrap; }
  button { color: inherit; background: var(--appearance-input, #fff); border: 1px solid var(--appearance-border, #0002); border-radius: 5px; padding: 3px 8px; font: inherit; cursor: default; }
  button:disabled { opacity: .45; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--appearance-focus, #c29b43); outline-offset: 1px; }
  .find-options { display: flex; flex-wrap: wrap; gap: 10px; margin: 5px 0; }
  label { display: flex; align-items: center; gap: 4px; }
  input[type=checkbox] { accent-color: var(--appearance-accent, #ae882d); }
  .text-language-panel { position: absolute; z-index: 8; right: 10px; top: 74px; width: min(316px, calc(100% - 20px)); max-height: calc(100% - 84px); min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--appearance-border, #0003); border-radius: 10px; background: var(--appearance-panel, #f4f3f2); color: var(--appearance-ink, #242424); box-shadow: 0 10px 30px #0003; font-size: 12px; }
  .text-language-panel header { padding: 7px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--appearance-soft-border, #0002); }
  header button { border: 0; background: transparent; padding: 1px 5px; font-size: 18px; }
  .language-content { min-height: 0; overflow: auto; padding: 10px; }
  .language-content > input { width: 100%; box-sizing: border-box; }
  .language-caption { color: var(--appearance-muted, #777); margin: 0 0 8px; font-size: 11px; }
  .misspelled-word { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 5px 0 8px; }
  .spelling-guesses { list-style: none; padding: 0; margin: 6px 0; max-height: 90px; overflow: auto; border: 1px solid var(--appearance-border, #0002); border-radius: 5px; background: var(--appearance-input, #fff); }
  .spelling-guesses button { width: 100%; border: 0; border-radius: 0; text-align: left; }
  .spelling-guesses button[aria-pressed=true] { background: #c6a45242; }
  .language-actions { display: flex; gap: 5px; flex-wrap: wrap; margin: 8px 0; }
  .language-option { margin: 7px 0; }
  .language-option span { margin-left: auto; color: var(--appearance-muted, #777); font-size: 10px; }
  .replacement-list { margin: 9px 0; max-height: 100px; overflow: auto; border: 1px solid var(--appearance-border, #0002); border-radius: 5px; }
  .replacement-list > div { display: grid; grid-template-columns: 1fr 16px 1fr; gap: 4px; padding: 5px; border-bottom: 1px solid var(--appearance-soft-border, #0001); overflow-wrap: anywhere; }
  .tool-error { color: #a52d25; font-size: 11px; overflow-wrap: anywhere; margin: 5px 0; }
</style>

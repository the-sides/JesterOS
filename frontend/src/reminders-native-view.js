export function createRemindersNativeView({ root, owns }) {
  const current = () => owns() === true && root?.isConnected === true;
  const controls = () => { if (!current()) return []; const sheet = root.querySelector('.reminders-sheet'); return [...(sheet ?? root).querySelectorAll('[data-reminder-control]')].filter(node => !node.disabled && !node.closest('[hidden],[inert]')); };
  const node = id => controls().find(element => element.dataset.reminderControl === id);
  const focused = () => controls().find(element => element === root.ownerDocument.activeElement);
  return {
    available: current,
    describe() { if (!current()) return null; const scroll = root.querySelector('[data-reminder-scroll]'); return { controls: controls().map(element => element.dataset.reminderControl), focusedControl: focused()?.dataset.reminderControl ?? null, top: scroll?.scrollTop ?? 0, left: scroll?.scrollLeft ?? 0 }; },
    focus(id, guard) { if (!current() || !guard()) return false; const element = node(id); if (!element) return false; element.focus({ preventScroll: true }); return current() && guard() && root.ownerDocument.activeElement === element; },
    scroll({ top, left }, guard) { if (!current() || !guard()) return null; const element = root.querySelector('[data-reminder-scroll]'); if (!element) return null; element.scrollTop = top; element.scrollLeft = left; return current() && guard() ? { top: element.scrollTop, left: element.scrollLeft } : null; },
    selection() { if (!current()) return null; const element = focused(); if (!element || typeof element.selectionStart !== 'number') return null; return { controlId: element.dataset.reminderControl, value: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection }; },
    selectAll(guard) { if (!current() || !guard()) return false; const element = focused(); if (!element || typeof element.select !== 'function') return false; element.select(); return current() && guard() && element.selectionStart === 0 && element.selectionEnd === element.value.length; },
    replaceSelection(selection, text, guard) { if (!current() || !guard()) return false; const element = focused(); if (!element || element.dataset.reminderControl !== selection.controlId || element.value !== selection.value || element.selectionStart !== selection.start || element.selectionEnd !== selection.end || typeof element.setRangeText !== 'function') return false; element.setRangeText(text, selection.start, selection.end, 'end'); return current() && guard() && element.value === selection.value.slice(0, selection.start) + text + selection.value.slice(selection.end); },
  };
}

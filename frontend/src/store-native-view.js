export function createStoreNativeView({ root, owns }) {
  const current = () => owns() === true && root?.isConnected === true && !root.closest('[hidden],[inert]');
  const controls = () => { if (!current()) return []; const scope = root.querySelector('.store-sheet') ?? root; return [...scope.querySelectorAll('[data-store-control]')].filter(node => !node.disabled && !node.closest('[hidden],[inert]')); };
  const control = id => controls().find(node => node.dataset.storeControl === id);
  return {
    available: current,
    describe() { if (!current()) return null; const scroll = root.querySelector('[data-store-scroll]'); return { controls: controls().map(node => node.dataset.storeControl), focusedControl: controls().find(node => node === root.ownerDocument.activeElement)?.dataset.storeControl ?? null, scroll: { top: scroll?.scrollTop ?? 0, left: scroll?.scrollLeft ?? 0 } }; },
    focus(id, guard) { if (!current() || guard() !== true) return false; const node = control(id); if (!node) return false; node.focus({ preventScroll: true }); return current() && guard() === true && root.ownerDocument.activeElement === node; },
    selectAll(guard) { if (!current() || guard() !== true) return false; const node = controls().find(node => node === root.ownerDocument.activeElement); if (!node || typeof node.select !== 'function') return false; node.select(); return current() && guard() === true && node.selectionStart === 0 && node.selectionEnd === node.value.length; },
    scroll({ top, left }, guard) { if (!current() || guard() !== true || root.querySelector('.store-sheet')) return null; const node = root.querySelector('[data-store-scroll]'); if (!node) return null; node.scrollTop = top; node.scrollLeft = left; return current() && guard() === true ? { top: node.scrollTop, left: node.scrollLeft } : null; },
  };
}

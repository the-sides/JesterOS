export function createWindows11AppView(getRoot,getSurface) {
  const elements = () => getRoot() ? [...getRoot().querySelectorAll('[data-control]')] : [];
  const available = element => !element.closest('[hidden],[inert]') && element.getClientRects().length > 0;
  const control = id => elements().find(element => element.dataset.control === id && available(element));
  const area = id => getRoot() ? [...getRoot().querySelectorAll('[data-area]')].find(element => element.dataset.area === id && available(element)) : null;
  const editable = element => element && typeof element.selectionStart === 'number' && typeof element.setSelectionRange === 'function';
  return {
    controls:() => elements().filter(available).map(element => ({id:element.dataset.control,disabled:Boolean(element.disabled),editable:Boolean(editable(element)),length:editable(element) ? element.value.length : 0})),
    focusedControl:() => { const active = document.activeElement; const element = active?.closest('[data-control]'); return element && getRoot()?.contains(element) ? element.dataset.control : null; },
    focus:id => { const element = control(id); if(!element || element.disabled) return false; element.focus({preventScroll:true}); return document.activeElement === element; },
    areas:() => getRoot() ? [...getRoot().querySelectorAll('[data-area]')].filter(available).map(element => element.dataset.area) : [],
    readScroll:id => { const element = area(id); return element ? {top:element.scrollTop,left:element.scrollLeft} : null; },
    scroll:(id,top,left) => { const element = area(id); if(!element) return null; element.scrollTop = top; element.scrollLeft = left; return {top:element.scrollTop,left:element.scrollLeft}; },
    readSelection:id => { const element = control(id); return editable(element) ? {start:element.selectionStart,end:element.selectionEnd} : null; },
    select:(id,start,end) => { const element = control(id); if(!editable(element) || element.disabled) return false; element.focus({preventScroll:true}); element.setSelectionRange(start,end); return element.selectionStart === start && element.selectionEnd === end; },
    hasCaptureSurface:() => typeof getSurface() === 'function',
    captureSurface:() => getSurface()?.() || null,
  };
}

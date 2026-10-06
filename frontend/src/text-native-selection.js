/** Native textarea selection does not reliably reveal an offscreen range.
 * Measure with the same authored typography, then move only its inner viewport. */
export function selectNativeText(node, range, { reveal = true } = {}) {
  if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length
    || typeof node.setSelectionRange !== 'function') return false;
  const start = Math.min(node.value.length, range.start), end = Math.min(node.value.length, range.end);
  node.setSelectionRange(start, end, range.direction ?? 'none');
  node.focus({ preventScroll: true });
  if (document.activeElement !== node) return false;
  if (reveal && node instanceof HTMLTextAreaElement) {
    const style = getComputedStyle(node), mirror = document.createElement('div'), caret = document.createElement('span');
    mirror.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'tabSize']) mirror.style[property] = style[property];
    mirror.style.width = `${node.clientWidth}px`;
    mirror.textContent = node.value.slice(0, range.direction === 'backward' ? start : end); caret.textContent = '\u200b'; mirror.append(caret);
    document.body.append(mirror);
    try {
      const top = caret.offsetTop, lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.55;
      if (top < node.scrollTop || top + lineHeight > node.scrollTop + node.clientHeight)
        node.scrollTop = Math.max(0, top - (node.clientHeight - lineHeight) / 2);
    } finally { mirror.remove(); }
  }
  return true;
}

export function documentControlRange(text, start, end) {
  const newline = text.indexOf('\n');
  if (newline < 0 || end <= newline) return { control: 'title', start: text.slice(0, start).replace(/\r/g, '').length,
    end: text.slice(0, end).replace(/\r/g, '').length, direction: 'forward' };
  const body = text.slice(newline + 1);
  const normalize = value => value.replace(/\r\n?/g, '\n').length;
  return { control: 'body', start: normalize(body.slice(0, Math.max(0, start - newline - 1))),
    end: normalize(body.slice(0, Math.max(0, end - newline - 1))), direction: 'forward' };
}

export function controlDocumentOffset(text, control, offset) {
  if (control === 'title') {
    let logical = 0;
    for (let at = 0; at < text.length && text[at] !== '\n'; at++) {
      if (text[at] !== '\r') { if (logical === offset) return at; logical++; }
    }
    const newline = text.indexOf('\n'); return newline < 0 ? text.length : newline;
  }
  const newline = text.indexOf('\n'); if (newline < 0) return text.length;
  let logical = 0;
  for (let at = newline + 1; at < text.length; at++) {
    if (logical === offset) return at;
    if (text[at] === '\r' && text[at + 1] === '\n') at++;
    logical++;
  }
  return text.length;
}

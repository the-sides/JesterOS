export const recipientFold = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim();

// Keep display-name punctuation and angle-address contents in their original
// token. The last token may be incomplete while the native recipient field edits.
export function messageRecipientTokens(text) {
  const tokens = [];
  let start = 0, quoted = false, escaped = false, angle = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (!angle && char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '<') angle = true;
    else if (char === '>') angle = false;
    else if (!angle && (char === ',' || char === ';')) {
      tokens.push(text.slice(start, index)); start = index + 1;
    }
  }
  tokens.push(text.slice(start));
  return tokens;
}

export function messageRecipientLabel({ name, address }) {
  const display = /[",;\\]/u.test(name) ? `"${name.replace(/[\\"]/gu, '\\$&')}"` : name;
  return `${display} <${address}>`;
}

export function messageRecipient(token) {
  const text = token.trim(), labelled = /^(.*?)\s*<([^<>]+)>$/u.exec(text);
  if (!text || /[\r\n<>]/u.test(labelled ? labelled[1] + labelled[2] : text)) return null;
  const address = (labelled ? labelled[2] : text).trim();
  let name = (labelled ? labelled[1] : text).trim() || address;
  if (labelled && name.includes('"')) {
    if (!/^"(?:[^"\\]|\\["\\])*"$/u.test(name)) return null;
    name = name.slice(1, -1).replace(/\\(["\\])/gu, '$1');
  }
  return address.length <= 320 && name.length <= 256 ? { name, address } : null;
}
export function recipientIdentity(value) {
  const recipient = messageRecipient(value);
  if (!recipient) return null;
  const address = recipient.address.normalize('NFKC').trim();
  // Phone display punctuation does not create another conversation. Literal
  // local names remain valid recipients; no carrier or remote account is claimed.
  if (/^\+?[\d\s().-]+$/u.test(address) && /\d{3}/u.test(address.replace(/\D/gu, ''))) return address.replace(/[^\d+]/gu, '');
  return address.toLocaleLowerCase('en-US');
}
export function messageRecipients(text, resolve = null) {
  const recipients = [], seen = new Set();
  for (const token of messageRecipientTokens(text)) {
    if (!token.trim()) continue;
    const parsed = messageRecipient(token);
    if (!parsed) return null;
    const resolved = resolve?.(parsed);
    const recipient = resolved === undefined ? parsed : resolved;
    if (!recipient || typeof recipient.name !== 'string' || typeof recipient.address !== 'string'
      || !messageRecipient(messageRecipientLabel(recipient))) return null;
    const key = recipientIdentity(recipient.address);
    if (seen.has(key)) continue;
    if (recipients.length >= 128) return null;
    seen.add(key); recipients.push({ name: recipient.name, address: recipient.address });
  }
  return recipients.length ? recipients : null;
}

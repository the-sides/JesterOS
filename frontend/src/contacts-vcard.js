import { CONTACTS_LIMITS, emptyContactSpec, contactsSpecValid, contactName, linkedContact, validateContactsState } from './contacts-state.js';

const escape = value => value.replace(/\\/gu, '\\\\').replace(/\r\n|\r|\n/gu, '\\n').replace(/;/gu, '\\;').replace(/,/gu, '\\,');
function splitEscaped(value, delimiter) {
  const parts = ['']; let escaped = false;
  for (const character of value) { if (escaped) { parts[parts.length - 1] += `\\${character}`; escaped = false; } else if (character === '\\') escaped = true; else if (character === delimiter) parts.push(''); else parts[parts.length - 1] += character; }
  if (escaped) throw new Error('A vCard value ends in an incomplete escape.');
  return parts;
}
const unescape = value => value.replace(/\\([nN,;\\])/gu, (_, token) => token.toLowerCase() === 'n' ? '\n' : token);
const fold = line => { const encoder = new TextEncoder(); let width = 0, result = ''; for (const character of line) { const size = encoder.encode(character).length; if (width + size > 75) { result += '\r\n '; width = 1; } result += character; width += size; } return result; };
const fail = message => ({ status: 'rejected', code: 'invalid_vcard', message });

// RFC 6350/2426 text vCards. No URI photo/network fetch, binary execution or host file access.
export function parseContactsVCard(state, text) {
  if (!validateContactsState(state) || typeof text !== 'string' || text.length > CONTACTS_LIMITS.vcard || /\u0000/u.test(text)) return fail('Use a bounded UTF-8 vCard text file.');
  const lines = text.replace(/^\uFEFF/u, '').replace(/\r\n|\r/gu, '\n').replace(/\n[ \t]/gu, '').split('\n');
  const cards = [], warnings = new Set(); let card = null;
  try {
    for (const raw of lines) {
      if (!raw.trim()) continue;
      if (/^BEGIN:VCARD$/iu.test(raw)) { if (card) throw new Error('Nested vCard boundaries are invalid.'); card = { spec: emptyContactSpec(state), version: null, fn: '', hasName: false, properties: [], labels: new Map() }; continue; }
      if (/^END:VCARD$/iu.test(raw)) {
        if (!card || !['3.0', '4.0'].includes(card.version)) throw new Error('Every card must declare supported VERSION:3.0 or VERSION:4.0.');
        if (!card.fn) throw new Error('Every card must contain FN.');
        if (card.version === '3.0' && !card.hasName) throw new Error('A vCard 3.0 card must contain structured N.');
        if (!Object.values(card.spec.name).some(Boolean) && !card.spec.organization) card.spec.name.given = card.fn;
        for (const { group, field, item } of card.properties) if (group && card.labels.has(group)) item.label = card.labels.get(group);
        if (!contactsSpecValid(state, card.spec, true)) throw new Error('A card has invalid or over-limit fields, labels, dates, addresses, URLs or photo data.');
        cards.push(card.spec); if (cards.length > CONTACTS_LIMITS.contacts || state.contacts.length + cards.length > CONTACTS_LIMITS.contacts) throw new Error('The contact count limit would be exceeded.');
        card = null; continue;
      }
      if (!card) throw new Error('Content outside a vCard boundary is invalid.');
      const colon = raw.indexOf(':'); if (colon < 1) throw new Error('A vCard property is missing its value separator.');
      const [property, ...params] = raw.slice(0, colon).split(';'), dot = property.lastIndexOf('.'), group = dot < 0 ? '' : property.slice(0, dot).toLowerCase(), key = property.slice(dot + 1).toUpperCase(), value = raw.slice(colon + 1);
      const parameters = new Map(params.map(param => { const equals = param.indexOf('='); return equals < 0 ? ['TYPE', param] : [param.slice(0, equals).toUpperCase(), param.slice(equals + 1).replace(/^"|"$/gu, '')]; }));
      if (parameters.has('ENCODING') && !['B', 'BASE64'].includes(parameters.get('ENCODING').toUpperCase())) throw new Error('Quoted-printable and legacy encodings must be converted to UTF-8 vCard 3/4 first.');
      if (parameters.has('CHARSET') && !/^utf-?8$/iu.test(parameters.get('CHARSET'))) throw new Error('Convert legacy character encodings to UTF-8 before importing.');
      const label = unescape(parameters.get('TYPE')?.split(',')[0]?.toLowerCase() || 'other');
      const append = (field, item) => { card.spec[field].push(item); card.properties.push({ group, field, item }); };
      if (key === 'VERSION') { if (card.version) throw new Error('Duplicate VERSION is invalid.'); card.version = value; }
      else if (key === 'FN') card.fn = unescape(value);
      else if (key === 'N') { card.hasName = true; const values = splitEscaped(value, ';').map(unescape); [card.spec.name.family, card.spec.name.given, card.spec.name.middle, card.spec.name.prefix, card.spec.name.suffix] = Array.from({ length: 5 }, (_, index) => values[index] ?? ''); }
      else if (key === 'NICKNAME') card.spec.name.nickname = unescape(splitEscaped(value, ',')[0]);
      else if (key === 'ORG') { const values = splitEscaped(value, ';').map(unescape); card.spec.organization = values.shift() ?? ''; card.spec.department = values.join(' / '); }
      else if (key === 'TITLE') card.spec.jobTitle = unescape(value);
      else if (key === 'EMAIL') append('emails', { label, value: unescape(value) });
      else if (key === 'TEL') append('phones', { label, value: unescape(value).replace(/^tel:/iu, '') });
      else if (key === 'URL') append('urls', { label, value: unescape(value) });
      else if (key === 'ADR') { const values = splitEscaped(value, ';').map(unescape); append('addresses', { label, street: [values[0], values[1], values[2]].filter(Boolean).join('\n'), city: values[3] ?? '', region: values[4] ?? '', postalCode: values[5] ?? '', country: values[6] ?? '' }); }
      else if (key === 'BDAY') card.spec.birthday = /^\d{8}$/u.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
      else if (key === 'NOTE') card.spec.notes = unescape(value);
      else if (key === 'X-ABLABEL') card.labels.set(group, unescape(value).replace(/^_\$!<|>!\$_$/gu, ''));
      else if (key === 'X-ABSHOWAS') card.spec.company = value.toLowerCase() === 'company';
      else if (key === 'X-PHONETIC-FIRST-NAME') card.spec.name.phoneticGiven = unescape(value);
      else if (key === 'X-PHONETIC-LAST-NAME') card.spec.name.phoneticFamily = unescape(value);
      else if (key === 'X-JESTER-PHOTO-COLOR') card.spec.photo = { kind: 'color', value: unescape(value) };
      else if (key === 'X-JESTER-PHOTO-INITIALS') card.spec.photo = { kind: 'initials', value: unescape(value) };
      else if (key === 'PHOTO') {
        if (/^data:image\/(png|jpeg|webp);base64,/u.test(value)) card.spec.photo = { kind: 'image', value };
        else if (['B', 'BASE64'].includes(parameters.get('ENCODING')?.toUpperCase())) { const mime = parameters.get('TYPE')?.toLowerCase().replace('jpg', 'jpeg'); if (!['png', 'jpeg', 'webp'].includes(mime)) throw new Error('Photo encoding must be PNG, JPEG or WebP.'); card.spec.photo = { kind: 'image', value: `data:image/${mime};base64,${value}` }; }
        else warnings.add('Remote PHOTO URIs are not fetched; photos must be embedded PNG/JPEG/WebP.');
      } else if (!['UID', 'REV', 'PRODID', 'KIND'].includes(key)) warnings.add(`Unsupported vCard property ${key} was not imported.`);
    }
    if (card) throw new Error('The final card has no END:VCARD.');
    if (!cards.length) throw new Error('No contact cards were found.');
    return { status: 'applied', specs: cards, warnings: [...warnings] };
  } catch (error) { return fail(error.message); }
}

export function exportContactsVCard(state, contactIds, { version = '3.0', notes = state.preferences.exportNotes, photos = state.preferences.exportPhotos } = {}) {
  if (!validateContactsState(state) || !['3.0', '4.0'].includes(version) || !Array.isArray(contactIds) || !contactIds.length || contactIds.length > CONTACTS_LIMITS.contacts || new Set(contactIds).size !== contactIds.length || contactIds.some(id => !state.contacts.some(row => row.id === id))) return null;
  const blocks = contactIds.map(id => {
    const card = linkedContact(state, id), n = card.name;
    const lines = ['BEGIN:VCARD', `VERSION:${version}`, `UID:${escape(card.id)}`, `FN:${escape(contactName(card, state.preferences))}`, `N:${[n.family, n.given, n.middle, n.prefix, n.suffix].map(escape).join(';')}`];
    if (n.nickname) lines.push(`NICKNAME:${escape(n.nickname)}`);
    if (n.phoneticGiven) lines.push(`X-PHONETIC-FIRST-NAME:${escape(n.phoneticGiven)}`);
    if (n.phoneticFamily) lines.push(`X-PHONETIC-LAST-NAME:${escape(n.phoneticFamily)}`);
    if (card.organization || card.department) lines.push(`ORG:${[card.organization, card.department].map(escape).join(';')}`);
    if (card.jobTitle) lines.push(`TITLE:${escape(card.jobTitle)}`);
    if (card.company) lines.push('X-ABShowAs:COMPANY');
    let index = 0;
    const add = (property, row, value) => { const group = `item${++index}`; lines.push(`${group}.${property}:${value}`, `${group}.X-ABLabel:${escape(row.label)}`); };
    for (const row of card.emails) add('EMAIL', row, escape(row.value));
    for (const row of card.phones) add('TEL', row, escape(row.value));
    for (const row of card.urls) add('URL', row, escape(row.value));
    for (const row of card.addresses) add('ADR', row, ['', '', row.street, row.city, row.region, row.postalCode, row.country].map(escape).join(';'));
    if (card.birthday) lines.push(`BDAY:${version === '4.0' ? card.birthday.replace(/-/gu, '') : card.birthday}`);
    if (notes && card.notes) lines.push(`NOTE:${escape(card.notes)}`);
    if (photos && card.photo.kind === 'image') {
      const [header, data] = card.photo.value.split(',');
      lines.push(version === '4.0' ? `PHOTO:${card.photo.value}` : `PHOTO;ENCODING=b;TYPE=${header.slice(11, -7).toUpperCase()}:${data}`);
    } else if (photos && ['color', 'initials'].includes(card.photo.kind)) lines.push(`X-JESTER-PHOTO-${card.photo.kind.toUpperCase()}:${escape(card.photo.value)}`);
    lines.push('END:VCARD'); return lines.map(fold).join('\r\n');
  });
  const text = `${blocks.join('\r\n')}\r\n`;
  return text.length <= CONTACTS_LIMITS.vcard ? text : null;
}

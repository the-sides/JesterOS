const MAX_TEXT = 1024 * 1024;

const definitions = [
  { id: 'lookup', label: 'Look Up', provider: 'dictionary', kind: 'text', accepts: source => source.text.trim().length > 0 && source.text.length <= 256 },
  { id: 'create-note', label: 'Create Note from Selection', provider: 'notes', kind: 'text' },
  { id: 'new-contact', label: 'Create Contact from Selection', provider: 'contacts', kind: 'text' },
  { id: 'new-message', label: 'New Message with Selection', provider: 'messages', kind: 'text' },
  { id: 'new-mail', label: 'New Email with Selection', provider: 'mail', kind: 'text' },
  { id: 'copy-paths', label: 'Copy File Paths', provider: 'finder', kind: 'files' },
  { id: 'show-info', label: 'Get Info', provider: 'finder', kind: 'files' },
  { id: 'new-mail-with-attachments', label: 'New Email with Attachments', provider: 'mail', kind: 'files',
    accepts: source => source.files.length <= 16 && source.files.every(file => file.kind === 'document'
      && typeof file.fileId === 'string' && file.fileId.length > 0 && Number.isSafeInteger(file.revision) && file.revision >= 0) },
  { id: 'email-contact', label: 'Email Contact', provider: 'mail', kind: 'contact', accepts: source => Boolean(source.contact.email.trim()) },
  { id: 'message-contact', label: 'Message Contact', provider: 'messages', kind: 'contact',
    accepts: source => Boolean(source.contact.phone.trim() || source.contact.email.trim()) },
];

/** Original registered local services, not a claimed factory Services inventory.
 * The source is the existing native selection/record, never another selection store. */
export function applicableServices(source, profile) {
  if (!profile.capabilities.includes('shell.services-workflows') || !source?.sourceId
    || !Object.hasOwn(profile.applications, source.appId)) return [];
  if (source.kind === 'text' && (typeof source.text !== 'string' || !source.text.trim() || source.text.length > MAX_TEXT)
    || source.kind === 'files' && (!Array.isArray(source.files) || !source.files.length)
    || source.kind === 'contact' && (!source.contact || typeof source.contact.id !== 'string'
      || !['name', 'email', 'phone'].every(field => typeof source.contact[field] === 'string'))) return [];
  return definitions.filter(service => service.kind === source.kind && Object.hasOwn(profile.applications, service.provider)
    && (!service.accepts || service.accepts(source)));
}

export function serviceMenuItems(source, profile) {
  return applicableServices(source, profile).map(service => ({
    id: `local-service:${service.id}:${source.sourceId}`, label: service.label, enabled: true,
    request: { command: 'app.service.perform', target: { appId: source.appId, serviceId: service.id, sourceId: source.sourceId }, payload: {} },
  }));
}

export function contactServiceFields(text) {
  const value = text.trim();
  const email = /^[^\s@]+@[^\s@]+$/.test(value);
  const phone = /^[+()\d .-]+$/.test(value) && /\d/.test(value);
  return { name: !email && !phone && !/[\r\n]/.test(value) && value.length <= 4096 ? value : '',
    email: email && value.length <= 4096 ? value : '', phone: phone && value.length <= 4096 ? value : '', notes: text };
}

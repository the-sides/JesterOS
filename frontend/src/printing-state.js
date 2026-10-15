import { object, choice } from './command-schema.js';
import { isRecord } from './feature-commands.js';
import { canonicalStringUnits } from './canonical-data.js';

export const PRINTING_LIMITS = Object.freeze({ jobs: 1024, pages: 1024, copies: 99, pdf: 1024 * 1024,
  totalText: 4 * 1024 * 1024, counter: Number.MAX_SAFE_INTEGER - 1, timestamp: 8_640_000_000_000_000 - 1 });
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const printSourceSchema = object({ appId: identity, windowId: identity, documentId: identity }, ['appId', 'windowId']);
export const printingSchema = object({
  nextJobId: integer(1, PRINTING_LIMITS.counter),
  jobs: { type: 'array', maxItems: PRINTING_LIMITS.jobs, items: object({
    id: { ...identity, pattern: '^job-[1-9][0-9]*$' }, title: { type: 'string', maxLength: 1024 },
    source: printSourceSchema, origin: { type: 'string', maxLength: 256 }, mime: { type: 'string', minLength: 1, maxLength: 128 },
    archiveFileId: identity, printerId: { const: 'studio-printer' }, copies: integer(1, 99), pageCount: integer(1, 1024),
    pageFrom: integer(1, 1024), pageTo: integer(1, 1024),
    pdfBase64: { type: 'string', minLength: 1, maxLength: PRINTING_LIMITS.pdf, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' },
    status: choice('queued', 'printing', 'paused', 'completed', 'cancelled'),
    printedPages: integer(0, 1024 * 99), createdAt: integer(0, PRINTING_LIMITS.timestamp),
  }) },
});
export const printingDefaults = () => ({ nextJobId: 1, jobs: [] });
const fields = (value, keys, required = keys) => isRecord(value) && Reflect.ownKeys(value).every(key => keys.includes(key))
  && required.every(key => Object.hasOwn(value, key)) && Reflect.ownKeys(value).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
export const validPrintingId = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  && ![...Object.getOwnPropertyNames(Object.prototype), 'prototype'].includes(value);
export const printedPageTotal = job => (job.pageTo - job.pageFrom + 1) * job.copies;
export const printingTextUnits = canonicalStringUnits;
export function validPdfBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > PRINTING_LIMITS.pdf || value.length % 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { const bytes = atob(value); return btoa(bytes) === value && /^%PDF-(?:1\.[0-9]|2\.0)/.test(bytes) && /%%EOF\s*$/.test(bytes); }
  catch { return false; }
}

/** Historical source metadata is never live authority. Jobs retain selected PDF
 * bytes after source edits/deletion and after the destination window closes. */
export function validatePrintingState(state) {
  const invalid = message => ({ ok: false, message });
  if (!fields(state, ['nextJobId', 'jobs']) || !bounded(state.nextJobId, 1, PRINTING_LIMITS.counter)
    || !Array.isArray(state.jobs) || state.jobs.length > PRINTING_LIMITS.jobs) return invalid('Expected a closed bounded printing state.');
  let previousId = 0, previousTime = 0, printing = 0;
  const archives = new Set();
  const keys = ['id', 'title', 'source', 'origin', 'mime', 'archiveFileId', 'printerId', 'copies', 'pageCount', 'pageFrom', 'pageTo', 'pdfBase64', 'status', 'printedPages', 'createdAt'];
  for (const job of state.jobs) {
    if (!fields(job, keys) || typeof job.id !== 'string' || !/^job-[1-9][0-9]*$/.test(job.id)
      || !fields(job.source, ['appId', 'windowId', 'documentId'], ['appId', 'windowId'])
      || !Object.values(job.source).every(validPrintingId) || !validPrintingId(job.archiveFileId) || archives.has(job.archiveFileId)
      || typeof job.title !== 'string' || job.title.length > 1024 || typeof job.origin !== 'string' || job.origin.length > 256
      || typeof job.mime !== 'string' || job.mime.length > 128 || !/^[\w.+-]+\/[\w.+-]+$/.test(job.mime)
      || job.printerId !== 'studio-printer' || !bounded(job.copies, 1, 99) || !bounded(job.pageCount, 1, 1024)
      || !bounded(job.pageFrom, 1, job.pageCount) || !bounded(job.pageTo, job.pageFrom, job.pageCount)
      || !bounded(job.createdAt, previousTime, PRINTING_LIMITS.timestamp) || !validPdfBase64(job.pdfBase64)
      || !['queued', 'printing', 'paused', 'completed', 'cancelled'].includes(job.status)) return invalid('Invalid print job fields, PDF snapshot or page range.');
    const number = Number(job.id.slice(4)), total = printedPageTotal(job);
    if (!bounded(number, previousId + 1, PRINTING_LIMITS.counter) || number >= state.nextJobId
      || !bounded(job.printedPages, 0, total) || (job.status === 'completed' ? job.printedPages !== total : job.printedPages >= total)) return invalid('Invalid print job identity, counter or progress.');
    if (job.status === 'printing' && ++printing > 1) return invalid('Only one job can be printing.');
    archives.add(job.archiveFileId); previousId = number; previousTime = job.createdAt;
  }
  if (printingTextUnits(state) > PRINTING_LIMITS.totalText) return invalid('Print archive exceeds the aggregate text budget.');
  return { ok: true };
}

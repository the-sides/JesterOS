import { object, choice } from './command-schema.js';
import { isRecord } from './feature-commands.js';

export const PRINTING_LIMITS = Object.freeze({ jobs: 1024, pages: 1024, copies: 99, pdf: 1024 * 1024, totalText: 4 * 1024 * 1024,
  counter: Number.MAX_SAFE_INTEGER - 1, timestamp: 8_640_000_000_000_000 - 1 });
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const printingSchema = object({
  nextJobId: integer(1, PRINTING_LIMITS.counter),
  jobs: { type: 'array', maxItems: PRINTING_LIMITS.jobs, items: object({
    id: { ...identity, pattern: '^job-[1-9][0-9]*$' }, title: { type: 'string', maxLength: 1024 * 1024 }, sourceNoteId: identity,
    printerId: { const: 'studio-printer' }, copies: integer(1, 99), pageCount: integer(1, 1024),
    pageFrom: integer(1, 1024), pageTo: integer(1, 1024),
    pdfBase64: { type: 'string', minLength: 1, maxLength: PRINTING_LIMITS.pdf, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' },
    status: choice('queued', 'printing', 'paused', 'completed', 'cancelled'),
    printedPages: integer(0, 1024 * 99), createdAt: integer(0, PRINTING_LIMITS.timestamp),
  }) },
});
export const printingDefaults = () => ({ nextJobId: 1, jobs: [] });
const fields = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const validId = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  && ![...Object.getOwnPropertyNames(Object.prototype), 'prototype'].includes(value);
export const printedPageTotal = job => (job.pageTo - job.pageFrom + 1) * job.copies;
export function validPdfBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > PRINTING_LIMITS.pdf || value.length % 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    const bytes = atob(value);
    return btoa(bytes) === value && /^%PDF-1\.[0-9]/.test(bytes) && /%%EOF\s*$/.test(bytes);
  } catch { return false; }
}

/** Structural plus cross-job validation; source notes may since have been
 * edited/deleted. Their IDs label immutable snapshots, not live dependencies. */
export function validatePrintingState(state) {
  const invalid = message => ({ ok: false, message });
  if (!fields(state, ['nextJobId', 'jobs']) || !bounded(state.nextJobId, 1, PRINTING_LIMITS.counter)
    || !Array.isArray(state.jobs) || state.jobs.length > PRINTING_LIMITS.jobs) return invalid('Expected a closed bounded printing state.');
  let previousId = 0, previousTime = 0, textBudget = 'nextJobId'.length + 'jobs'.length, printing = 0;
  const keys = ['id', 'title', 'sourceNoteId', 'printerId', 'copies', 'pageCount', 'pageFrom', 'pageTo', 'pdfBase64', 'status', 'printedPages', 'createdAt'];
  const jobKeyBudget = keys.reduce((total, key) => total + key.length, 0);
  let index = 0;
  for (const job of state.jobs) {
    if (!fields(job, keys) || typeof job.id !== 'string' || !/^job-[1-9][0-9]*$/.test(job.id)
      || !validId(job.sourceNoteId) || typeof job.title !== 'string' || job.title.length > 1024 * 1024
      || job.printerId !== 'studio-printer' || !bounded(job.copies, 1, 99) || !bounded(job.pageCount, 1, 1024)
      || !bounded(job.pageFrom, 1, job.pageCount) || !bounded(job.pageTo, job.pageFrom, job.pageCount)
      || !bounded(job.createdAt, previousTime, PRINTING_LIMITS.timestamp) || !validPdfBase64(job.pdfBase64)
      || !['queued', 'printing', 'paused', 'completed', 'cancelled'].includes(job.status)) return invalid('Invalid print job fields, PDF snapshot or page range.');
    const number = Number(job.id.slice(4)), total = printedPageTotal(job);
    if (!bounded(number, previousId + 1, PRINTING_LIMITS.counter) || number >= state.nextJobId
      || !bounded(job.printedPages, 0, total) || (job.status === 'completed' ? job.printedPages !== total : job.printedPages >= total)) return invalid('Invalid print job identity, counter or progress.');
    if (job.status === 'printing' && ++printing > 1) return invalid('Only one job can be printing.');
    textBudget += jobKeyBudget + String(index++).length + job.id.length + job.title.length + job.sourceNoteId.length
      + job.printerId.length + job.pdfBase64.length + job.status.length;
    if (textBudget > PRINTING_LIMITS.totalText) return invalid('Print archive exceeds the aggregate text budget.');
    previousId = number; previousTime = job.createdAt;
  }
  return { ok: true };
}

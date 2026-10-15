import { copyCanonicalData } from './canonical-data.js';
import { encodeDOCX } from './createoffice-xml-codec.js';
import { createPagesState, pagesCreateDocument, pagesAllocate } from './pages-model.js';
import { PREVIEW_IMAGE_CONTENT } from './preview-image-fixture.js';

/** Disposable interchange projection: exactly one retained canonical rich model.
 * Paragraph-style labels are local UI metadata; their effective rich runs are
 * exported. Image descriptions remain local because the shared codec has no
 * alternative-description field. Never pass unsupported UI fields to OOXML. */
export function pagesCodecDocument(content) {
  return { title: content.title, page: copyCanonicalData(content.page), blocks: content.blocks.map(block => {
    if (block.type === 'paragraph') return { type: 'paragraph', align: block.align, ...(Object.hasOwn(block, 'pageBreakBefore') ? { pageBreakBefore: block.pageBreakBefore } : {}), runs: copyCanonicalData(block.runs) };
    if (block.type === 'table') return { type: 'table', rows: copyCanonicalData(block.rows) };
    if (block.type === 'image') return { type: 'image', content: block.content, width: block.width, height: block.height };
    return { type: 'chart', kind: block.kind, title: block.title, labels: [...block.labels], values: [...block.values] };
  }) };
}
/** Root may seed these genuine original File specs once, not per window launch.
 * Fictional locally authored content; no native proprietary format is claimed. */
export function pagesDefaultFiles(profile) {
  const state = createPagesState(profile), document = pagesCreateDocument(state, 'report');
  document.content.title = 'Harbor Project Report';
  document.content.blocks[0].runs[0].text = 'Harbor Project Report';
  document.content.blocks[3].runs[0].text = 'The harbor team completed a four-week review of the project. The following table, chart, and locally authored illustration summarize the work.';
  document.content.blocks.push({ id: pagesAllocate(state, 'pages-block'), type: 'table', rows: [[{ text: 'Week' }, { text: 'Completed' }], [{ text: 'One' }, { text: '12' }], [{ text: 'Two' }, { text: '24' }], [{ text: 'Three' }, { text: '18' }], [{ text: 'Four' }, { text: '30' }]] });
  document.content.blocks.push({ id: pagesAllocate(state, 'pages-block'), type: 'chart', kind: 'bar', title: 'Completed Tasks', labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], values: [12, 24, 18, 30] });
  document.content.blocks.push({ id: pagesAllocate(state, 'pages-block'), type: 'image', content: PREVIEW_IMAGE_CONTENT, width: 420, height: 280, alt: 'Locally authored harbor illustration' });
  const encoded = encodeDOCX(pagesCodecDocument(document.content));
  return [{ name: 'Harbor Project Report.docx', mime: encoded.mime, content: encoded.content, parentId: 'documents' }];
}

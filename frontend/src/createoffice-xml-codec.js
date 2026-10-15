// Genuine OPC ZIP interoperability. Proprietary Apple IWA packages and Office
// active content are deliberately not re-labelled or silently approximated.
export { encodeDOCX,decodeDOCX } from './office-docx-codec.js';
export { encodeXLSX,decodeXLSX } from './office-xlsx-codec.js';
export { encodePPTX,decodePPTX } from './office-pptx-codec.js';
export { OFFICE_XML_LIMITS } from './office-xml-common.js';
export const OFFICE_FORMAT_DISCLOSURE=Object.freeze({docx:'Interoperable Word document: rich paragraphs, tables, embedded PNG/JPEG and single-series charts. Apple Pages IWA packages, tracked changes, fields and advanced layout are not supported.',xlsx:'Interoperable Excel workbook: cells, supported formulas, fonts/fills/number formats, row/column sizes and rectangular multi-series bar/line charts or single-series pie charts. Macros, pivot tables, merged cells, linked workbooks and advanced worksheet drawings are not supported.',pptx:'Interoperable PowerPoint presentation: slides, text, shapes, embedded PNG/JPEG, single-series charts, notes and fade/push/wipe transitions. Proprietary Keynote packages and unsupported embedded audio/video are not re-labelled.'});

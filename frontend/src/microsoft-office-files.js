import {createWordDocument} from './word-state.js';
import {createExcelDocument} from './excel-state.js';
import {createPowerPointDocument} from './powerpoint-state.js';
import {encodeDOCX,encodeXLSX} from './createoffice-xml-codec.js';
import {encodePowerPointDocument} from './powerpoint-commands.js';
export const MICROSOFT_OFFICE_FILE_TYPES=Object.freeze({
 word:Object.freeze({extension:'docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),
 excel:Object.freeze({extension:'xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
 powerpoint:Object.freeze({extension:'pptx',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})
});
/** Genuine packaged examples; Root alone assigns source File identity and timestamps. */
export function createMicrosoftOfficeFileFixtures(){
 return [['word','Project Report',createWordDocument('report'),encodeDOCX],['excel','Monthly Budget',createExcelDocument('budget'),encodeXLSX],['powerpoint','Project Pitch',createPowerPointDocument('pitch'),encodePowerPointDocument]].map(([appId,title,document,encode])=>{
  const output=encode(document);if(output&&typeof output.then==='function')throw new Error('Synchronous OOXML fixture encoder is required.');
  return {appId,name:`${title}.${output.extension}`,mime:output.mime,content:output.content,icon:'document',parentId:'documents'};
 });
}

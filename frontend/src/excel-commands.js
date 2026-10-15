import {createMicrosoftOfficeCommands} from './microsoft-office-controller.js';
import {validateExcelState,excelWindow,createExcelWindow,excelWindowMetadata,excelCapabilities,createExcelDocument,validateExcelDocument,resetExcelSelection} from './excel-state.js';
import {excelCommandSpecs,mutateExcel,encodeExcelCSV,decodeExcelCSV} from './excel-model.js';
import {encodeXLSX,decodeXLSX} from './createoffice-xml-codec.js';
export const EXCEL_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function decodeExcelFile(content,mime=EXCEL_MIME){return mime==='text/csv'?decodeExcelCSV(content):decodeXLSX(content);}
export function createExcelCommands(state,ctx){return createMicrosoftOfficeCommands(state,ctx,{appId:'excel',validate:validateExcelState,session:excelWindow,createWindow:createExcelWindow,metadata:excelWindowMetadata,capabilities:excelCapabilities,createDocument:createExcelDocument,validateDocument:validateExcelDocument,commandSpecs:excelCommandSpecs,mutate:mutateExcel,encode:encodeXLSX,decode:decodeExcelFile,mime:EXCEL_MIME,mimes:[EXCEL_MIME,'text/csv'],resetSelection:resetExcelSelection,extraFormats:{csv:encodeExcelCSV}});}

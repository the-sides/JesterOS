import {createMicrosoftOfficeCommands,microsoftOfficeCommonCommandSpecs} from './microsoft-office-controller.js';
import {wordWindow,createWordWindow,wordWindowMetadata,wordCapabilities,createWordDocument,validateWordDocument,validateWordState} from './word-state.js';
import {wordCommandSpecs,mutateWord,resetWordSelection,normalizeWordDocument} from './word-model.js';
import {encodeDOCX,decodeDOCX} from './createoffice-xml-codec.js';
export const wordCommands={...microsoftOfficeCommonCommandSpecs,...wordCommandSpecs};
export function createWordCommands(state,ctx){return createMicrosoftOfficeCommands(state,ctx,{appId:'word',validate:validateWordState,session:wordWindow,createWindow:createWordWindow,metadata:wordWindowMetadata,capabilities:wordCapabilities,createDocument:createWordDocument,validateDocument:validateWordDocument,commandSpecs:wordCommandSpecs,mutate:mutateWord,encode:encodeDOCX,decode:decodeDOCX,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',resetSelection:resetWordSelection,normalizeDocument:normalizeWordDocument});}

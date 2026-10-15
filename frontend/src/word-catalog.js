import {createMicrosoftOfficeCatalog,microsoftOfficeTargetSchema} from './microsoft-office-controller.js';
import {wordCommandSpecs} from './word-model.js';
export {wordCommandSpecs};
export const wordTargetSchema=microsoftOfficeTargetSchema;
export const wordCatalog=createMicrosoftOfficeCatalog('word',wordCommandSpecs);

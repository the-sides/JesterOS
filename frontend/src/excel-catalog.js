import {createMicrosoftOfficeCatalog} from './microsoft-office-controller.js';
import {excelCommandSpecs} from './excel-model.js';
export const excelCatalog=createMicrosoftOfficeCatalog('excel',excelCommandSpecs);

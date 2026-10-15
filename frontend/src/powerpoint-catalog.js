import { createMicrosoftOfficeCatalog, microsoftOfficeCommonCommandSpecs, microsoftOfficeImageCommandSpecs, microsoftOfficeTargetSchema } from './microsoft-office-controller.js';
import { powerpointCommandSpecs } from './powerpoint-model.js';
export { powerpointCommandSpecs } from './powerpoint-model.js';
export const powerpointTargetSchema = microsoftOfficeTargetSchema;
export const powerpointCatalog = createMicrosoftOfficeCatalog('powerpoint', powerpointCommandSpecs);
export const powerpointAllCommandSpecs = { ...microsoftOfficeCommonCommandSpecs, ...microsoftOfficeImageCommandSpecs, ...powerpointCommandSpecs };

import { defineCommand, choice, object, empty, identity, offset } from './command-schema.js';
import { appModules } from './windows11-app-state.js';
import { appIds } from './windows11-app-helpers.js';
const appTarget = object({appId:choice(...appIds)});
const controlTarget = object({appId:choice(...appIds),control:identity});
const areaTarget = object({appId:choice(...appIds),area:identity});
export const baseAppSpecs = {
  'win11.files.open':[object({fileId:identity}),empty,['Open the associated native application and populate its actual session document.'],[]],
  'win11.apps.menu':[appTarget,object({menu:{anyOf:[identity,{const:null}]}}),['Open a current application menu, or dismiss it.'],[]],
  'win11.apps.focus':[controlTarget,empty,['Focus an actual currently mounted, enabled semantic control.'],[]],
  'win11.apps.focus.observe':[object({appId:choice(...appIds),control:{anyOf:[identity,{const:null}]}}),empty,['Retain observed real control focus.'],[]],
  'win11.apps.scroll':[areaTarget,object({top:offset,left:offset}),['Scroll a current semantic application area and retain actual clamped offsets.'],[]],
  'win11.apps.scroll.observe':[areaTarget,object({top:offset,left:offset}),['Retain actual observed scroll offsets.'],[]],
  'win11.apps.selection':[controlTarget,object({start:{type:'integer',minimum:0},end:{type:'integer',minimum:0}}),['Select actual editable control text and retain selection.'],[]],
  'win11.apps.selection.observe':[controlTarget,object({start:{type:'integer',minimum:0},end:{type:'integer',minimum:0}}),['Retain actual observed editable text selection.'],[]],
};
export const windows11AppSpecs = {...baseAppSpecs,...Object.assign({},...Object.values(appModules).map(module => module.specs))};
export const windows11AppCatalog = Object.fromEntries(Object.entries(windows11AppSpecs).map(([name,[target,payload,presentation=[],data=[],rules=[]]]) => defineCommand(['windows11-23h2-22631.2428'],name,'windows.apps',target,payload,['Targets must be live in this profile session. Presentation commands require a visible mounted view.'],presentation,data,rules)));

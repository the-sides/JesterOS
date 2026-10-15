import { object } from './command-schema.js';
import { baseDiskProperties,boundedArray,boundedText,diskId,validateDiskFamily,profileId } from './disk-family-state.js';
export const migrationSchema=object({...baseDiskProperties,users:boundedArray(object({id:diskId,name:boundedText(128,1),homeRootId:diskId,sourceRootId:diskId}),64)});
export function createMigrationState(profile){return {version:1,profileId:profileId(profile),revision:0,nextId:1,sessions:[],users:[]};}
export function validateMigrationState(state,profile){const base=validateDiskFamily(state,migrationSchema,profile);if(!base.ok)return base;if(new Set(state.users.map(r=>r.id)).size!==state.users.length||new Set(state.users.map(r=>r.homeRootId)).size!==state.users.length)return {ok:false,message:'Duplicate migration user identity or home folder.'};return {ok:true};}

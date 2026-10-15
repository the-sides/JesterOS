import { copyCanonicalData } from './canonical-data.js';
import { validateDiskState } from './disk-state.js';
import { validateBackupState } from './backup-state.js';
import { validateMigrationState } from './migration-state.js';
import { validateBootCampState } from './boot-camp-state.js';
function project(state,validate,profile){const valid=validate(state,profile);if(!valid.ok)throw new Error(valid.message);const candidate=copyCanonicalData(state);for(const session of candidate.sessions)if(session.stage==='running'){session.stage='ready';session.progress=0;session.message='Interrupted operation was not resumed. No incomplete file result was published.';}if(candidate.status==='preparing'||candidate.status==='backing-up')candidate.status='cancelled';return candidate;}
export const projectDiskState=(state,profile)=>project(state,validateDiskState,profile);
export const rehydrateDiskState=(state,profile)=>projectDiskState(state,profile);
export const projectBackupState=(state,profile)=>project(state,validateBackupState,profile);
export const rehydrateBackupState=(state,profile)=>projectBackupState(state,profile);
export const projectMigrationState=(state,profile)=>project(state,validateMigrationState,profile);
export const rehydrateMigrationState=(state,profile)=>projectMigrationState(state,profile);
export const projectBootCampState=(state,profile)=>project(state,validateBootCampState,profile);
export const rehydrateBootCampState=(state,profile)=>projectBootCampState(state,profile);

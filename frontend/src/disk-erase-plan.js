import { diskFileBytes } from './disk-family-controller.js';
const anchors=new Set(['disk','root','desktop','documents','downloads','pictures','trash','icloud-drive','mail-cache']);
// Keep immutable installation/OS anchors, but erase every writable descendant,
// including hidden Trash bytes. Root protects the same canonical anchor identities.
export function planDiskErase(files,root){const descendants=[],queue=[root.id],seen=new Set(queue);for(let i=0;i<queue.length;i++)for(const f of files)if(f.parentId===queue[i]&&!seen.has(f.id)){seen.add(f.id);queue.push(f.id);descendants.push(f);}const retained=new Set([...anchors,root.id]);for(const file of descendants.filter(f=>f.readOnly)){let f=file;while(f&&f.id!==root.id&&!retained.has(f.id)){retained.add(f.id);f=files.find(p=>p.id===f.parentId);}}
 const roots=descendants.filter(f=>!retained.has(f.id)&&retained.has(f.parentId)),removed=new Set();for(const f of roots){const todo=[f.id];for(let i=0;i<todo.length;i++){removed.add(todo[i]);for(const child of descendants)if(child.parentId===todo[i])todo.push(child.id);}}
 return {operations:roots.map(f=>({type:'remove',fileId:f.id,recursive:true,expectedRevision:f.revision})),remaining:files.filter(f=>!removed.has(f.id)),removedBytes:descendants.filter(f=>removed.has(f.id)).reduce((n,f)=>n+diskFileBytes(f),0),records:descendants};
}

export function keychainMenus({session,keychain,selected,preferences,classic=false}){
 const action=(label,command,payload={},disabled=false)=>({id:`${command}:${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,label,enabled:!!session&&!disabled,request:{command:`keychain.${command}`,target:{windowId:session?.windowId},payload}});
 const panel=(label,p)=>action(label,'panel',{panel:p});
 const categories=[['all','All Items'],['password','Passwords'],['secure-note','Secure Notes'],['identity','My Certificates'],['key','Keys'],['certificate','Certificates']];
 return [
  {id:'keychain',label:'Keychain Access',enabled:!!session,children:[panel(classic?'Preferences…':'Settings…','preferences'),panel('Password Assistant…','generator')]},
  {id:'file',label:'File',enabled:!!session,children:[panel('New Keychain…','new-keychain'),panel('New Password Item…','new'),action('Import Items…','import',{},keychain?.locked),action('Export Items…','export',{itemId:selected?.id,format:'pem'},!selected||selected.kind!=='certificate'||keychain?.locked),action(keychain?.locked?'Unlock Keychain…':'Lock Keychain',keychain?.locked?'panel':'keychain',keychain?.locked?{panel:'unlock'}:{operation:'lock'}),action('Delete Keychain','keychain',{operation:'delete'},!keychain||keychain.locked||['login','system'].includes(keychain.id)),action('Close','window.close')]},
  {id:'edit',label:'Edit',enabled:!!session,children:[panel('Get Info','inspect'),panel('Edit Item…','edit'),action('Copy Password','copy',{itemId:selected?.id},!selected||selected.kind==='certificate'||!session?.revealed||keychain?.locked),action('Delete Item','item',{operation:'delete',itemId:selected?.id},!selected||keychain?.locked)]},
  {id:'view',label:'View',enabled:!!session,children:categories.map(([category,label])=>action(label,'navigate',{category}))},
  {id:'window',label:'Window',enabled:!!session,children:[action('Close Window','window.close')]},
  {id:'help',label:'Help',enabled:!!session,children:[panel('Local Keychain Help','preferences')]}
 ];
}

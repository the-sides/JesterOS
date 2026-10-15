export function fontBookMenus({session,selected,classic=false}){
 const action=(label,command,payload={},disabled=false)=>({id:`${command}:${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,label,enabled:!!session&&!disabled,request:{command:`fontbook.${command}`,target:{windowId:session?.windowId},payload}});
 const panel=(label,p)=>action(label,'panel',{panel:p}),font=(label,operation)=>action(label,'font',{operation,fontId:selected?.id},!selected);
 const views=classic?[['sample','Sample'],['repertoire','Repertoire'],['custom','Custom'],['information','Information']].map(([preview,label])=>action(label,'preview',{preview})):[['grid','Grid'],['sample','Sample'],['list','List']].map(([view,label])=>action(label,'preview',{view}));
 return [
  {id:'fontbook',label:'Font Book',enabled:!!session,children:[panel(classic?'Preferences…':'Settings…','preferences')]},
  {id:'file',label:'File',enabled:!!session,children:[action(classic?'Add Fonts…':'Add Fonts to Current User…','install',{duplicates:'skip'}),panel('New Collection…','collection'),font(classic?'Validate Font':'Validate Selection','validate'),font('Export Fonts…','export'),...(!classic?[panel('Resolve Duplicates…','duplicates')]:[]),action('Close','window.close')]},
  {id:'edit',label:'Edit',enabled:!!session,children:[font(selected?.enabled?(classic?'Disable Font':'Deactivate Font'):(classic?'Enable Font':'Activate Font'),selected?.enabled?'disable':'enable'),font('Remove Font','remove'),...(classic?[panel('Look for Enabled Duplicates…','duplicates')]:[])]},
  {id:'view',label:'View',enabled:!!session,children:views},
  {id:'window',label:'Window',enabled:!!session,children:[action('Close Window','window.close')]},
  {id:'help',label:'Help',enabled:!!session,children:[panel('Local Font Book Help','preferences')]}
 ];
}

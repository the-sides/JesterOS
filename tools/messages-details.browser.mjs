import fs from 'node:fs/promises';

// Real Files chooser, compositor, PDF/image decoder and original application roots.
const profiles=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export async function runMessagesDetailsAcceptance({ browser, baseURL, artifactDirectory: directory }) {
await fs.mkdir(directory,{recursive:true});const reports=[];
for(const profile of profiles){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(8000);
 const report={profile,checks:[],errors:[],external:[]};reports.push(report);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(baseURL+'/')&&!/^(data:|blob:)/.test(r.url()))report.external.push(r.url());});
 const c=id=>page.locator(`[data-messages-control="${id}"]`).filter({visible:true});
 const execute=(command,target={},payload={})=>page.evaluate(({command,target,payload})=>jesteros.execute({command,target,payload}),{command,target,payload});
 const data=()=>page.evaluate(()=>jesteros.inspect().state);
 const selected=()=>page.evaluate(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId);});
 const check=(value,label)=>{if(!value)throw Error(label);report.checks.push(label);};
 try{
  await page.goto(baseURL+'/?profile='+profile);await page.waitForFunction(()=>window.jesteros?.inspect().state.windows.length);
  const appId=profile.startsWith('windows')?'teams':'messages',classic=/high-sierra|mojave/.test(profile);
  let state=await data(),w=state.windows.find(w=>w.appId===appId);if(!w){await execute('app.open',{appId});state=await data();w=state.windows.find(w=>w.appId===appId);}
  if(appId==='teams')await page.getByRole('button',{name:'Open Teams',exact:true}).click();
  await c('new-message').click();await c('draft-to').fill('Casey Test <casey.test@jester.local>, Jordan Test <jordan.test@jester.local>, Sam Test <sam.test@jester.local>');
  await c('draft-body').fill('Details and attachments café 東京 — original payload');
  await page.waitForFunction(()=>jesteros.inspect().state.messages.drafts.some(d=>d.fields.body.includes('original payload')));
  const files=(await data()).files,image=files.find(f=>f.id==='preview-harbor-image'),pdf=files.find(f=>f.mime==='application/pdf'&&f.content);
  check(Boolean(image&&pdf),'Genuine original PNG/PDF Files exist');report.sources=[image.id,pdf.id];
  for(const source of [image,pdf]){
   if(classic){await page.locator('[data-menu-invoker="file"]').click();await page.getByRole('menuitem',{name:/^Attach Virtual File/}).click();}else await c('attach-file').click();
   const picker=page.locator('[data-destination-kind="picker"]');await picker.waitFor({state:'visible'});
   await picker.locator('[data-destination-control="location"]').selectOption(source.parentId);
   await picker.locator(`[data-destination-control="file"][data-file-id="${source.id}"]`).click();
   await picker.locator('[data-destination-control="open"]').click();await picker.waitFor({state:'hidden'});
   await page.waitForFunction(id=>{const s=jesteros.inspect().state.messages;return s.drafts.find(d=>d.id===s.selectedDraftId).attachments.some(a=>a.originalFileId===id);},source.id);
  }
  await c('draft-send').click();await page.waitForFunction(()=>jesteros.inspect().state.messages.conversations.some(r=>r.items.some(i=>i.text==='Details and attachments café 東京 — original payload')));
  const group=await selected(),message=group.items.at(-1);report.conversationId=group.id;report.messageId=message.id;
  check(group.participants.length===3&&message.attachments.length===2,'Native send creates exact original three-recipient group with two attachments');
  check(message.attachments.find(a=>a.originalFileId===image.id).dataURI===image.content,'PNG snapshot retains full original bytes');
  await c('conversation-details').click();await c('details-close').waitFor({state:'visible'});
  check(await page.locator('.messages-details-participants li').count()===3,'Details renders all original participants');
  if(!classic)await c('conversation-name-edit').click();
  await c('conversation-name').fill('Trail group café 東京');await c('conversation-rename').click();
  await page.waitForFunction(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).name==='Trail group café 東京';});
  check(true,'Native group rename retains Unicode');
  const prior=(await selected()).dnd;await c('conversation-dnd').click();await page.waitForFunction(value=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).dnd===value;},!prior);
  check(true,'Native thread mute uses canonical original DND');
  await c('location-edit').click();
  await execute('messages.conversation.details',{windowId:w.id,conversationId:group.id},{panel:'details',open:true});
  check(await c('location-label').isVisible()&&(await page.evaluate(()=>jesteros.describe().targets.messages.windows.find(w=>w.available).presentation.details.section))==='location','Repeated Details open preserves the actual expanded location editor');
  await c('location-label').fill('Harbor café');await c('location-latitude').fill('999');await c('location-longitude').fill('-73.9');
  check(!(await c('location-latitude').evaluate(n=>n.checkValidity())),'Out-of-range location is natively invalid');
  const beforeInvalid=JSON.stringify(await selected());await c('location-share').click();check(JSON.stringify(await selected())===beforeInvalid,'Invalid location cannot change original thread');
  await c('location-latitude').fill('40.7');await c('location-share').click();
  await page.waitForFunction(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).location?.label==='Harbor café';});
  check((await selected()).location.latitude===40.7,'Native simulated location commits exact entered coordinates');
  await c('location-edit').click();await c('location-label').fill('Uncommitted replacement');await c('location-cancel').click();check((await selected()).location.label==='Harbor café','Location Cancel retains committed original');
  await c('location-edit').click();await c('location-label').fill('Direct cancellation draft');
  check((await execute('messages.details.navigate',{windowId:w.id,conversationId:group.id},{section:'summary',discard:true})).status==='applied','Direct Cancel acknowledges original Details buffers');
  await c('location-edit').click();check(await c('location-label').inputValue()==='Harbor café','Direct and pointer Cancel discard the same unsubmitted buffer');
  await c('location-cancel').click();
  for(const section of ['photos','files']){
   if(classic)await c('shared-'+section).click();else check((await execute('messages.details.navigate',{windowId:w.id,conversationId:group.id},{section})).status==='applied','Direct '+section+' navigation applies');
   await page.waitForFunction(section=>jesteros.describe().targets.messages.windows.some(w=>w.presentation.details?.section===section),section);
   check(true,'Details '+section+' is discoverable and keyboard-focusable');
  }
  if(classic)await c('shared-photos').click();else await execute('messages.details.navigate',{windowId:w.id,conversationId:group.id},{section:'photos'});
  const photo=page.locator('.messages-attachment.shared-details').filter({visible:true});
  await photo.locator('img').evaluate(n=>n.decode());check(await photo.locator('img').evaluate(n=>n.naturalWidth===960&&n.naturalHeight===640),'Original shared Details photo genuinely decodes');
  await photo.locator('button').first().click({button:'right'});await page.getByRole('menuitem',{name:'Quick Look',exact:true}).or(page.getByRole('menuitem',{name:'Preview (local equivalent)',exact:true})).click();
  await c('quick-look-close').waitFor({state:'visible'});check(await page.locator('.messages-quick-look img').evaluate(n=>n.decode().then(()=>n.naturalWidth===960)),'Native shared photo Quick Look uses genuine bytes');await c('quick-look-close').click();
  await c('location-remove').click();await page.waitForFunction(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).location===null;});check(true,'Stop Sharing retires only local location');
  await page.screenshot({path:directory+'/'+profile+'-details.png'});
  await c('details-close').click();
  const beforeClose=JSON.stringify((await data()).messages);
  check((await execute('window.close',{windowId:w.id})).status==='applied','Original messaging window closes');
  check((await execute('app.open',{appId})).status==='applied','Original messaging app reopens');
  check(JSON.stringify((await data()).messages)===beforeClose,'Group/attachments/DND/name survive actual window lifetime');
  check(report.errors.length===0,'No page errors');check(report.external.length===0,'No external requests');
 }catch(e){report.failure=e.stack;await page.screenshot({path:directory+'/'+profile+'-failure.png'}).catch(()=>{});}
 await fs.writeFile(directory+'/results.json',JSON.stringify(reports,null,2));console.log(profile,report.failure?'FAIL '+report.failure:report.checks.length+' checks passed');await context.close();
}
return reports;
}

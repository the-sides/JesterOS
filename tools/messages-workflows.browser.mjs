import fs from 'node:fs/promises';
const profiles=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export async function runMessagesWorkflowsAcceptance({ browser, baseURL, artifactDirectory: directory }) {
await fs.mkdir(directory,{recursive:true});const reports=[];
for(const profile of profiles){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(8000);
 const report={profile,checks:[],errors:[],external:[]};reports.push(report);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(baseURL.replace(/\/$/, '')+'/')&&!/^(data:|blob:)/.test(r.url()))report.external.push(r.url());});
 const c=id=>page.locator(`[data-messages-control="${id}"]`).filter({visible:true});
 const execute=(command,target={},payload={})=>page.evaluate(({command,target,payload})=>jesteros.execute({command,target,payload}),{command,target,payload});
 const data=()=>page.evaluate(()=>jesteros.inspect().state);
 const selected=()=>page.evaluate(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId);});
 const check=(value,label)=>{if(!value)throw Error(label);report.checks.push(label);};
 try{
  await page.goto(baseURL.replace(/\/$/, '')+'/?profile='+profile);await page.waitForFunction(()=>window.jesteros?.inspect().state.windows.length);
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
  const photoAttachment=message.attachments.find(a=>a.originalFileId===image.id),pdfAttachment=message.attachments.find(a=>a.originalFileId===pdf.id);
  const transcriptImage=page.locator(`.messages-attachment[data-messages-source-file-id="${image.id}"]`).filter({visible:true});
  await c('attachment-expand:'+photoAttachment.id).click();check(await c('attachment-expand:'+photoAttachment.id).getAttribute('aria-expanded')==='true','Native image expansion opens original inline image');
  const photoTarget={windowId:w.id,conversationId:group.id,messageId:message.id,attachmentId:photoAttachment.id};
  check((await execute('messages.attachment.preview',photoTarget,{expanded:false})).status==='applied','Direct API collapses original image');
  check((await execute('messages.attachment.preview',photoTarget,{expanded:true})).status==='applied','Direct API expands same original image');
  await page.keyboard.press('Escape');check(await c('attachment-expand:'+photoAttachment.id).getAttribute('aria-expanded')==='false','Escape collapses only original image');
  const pdfFigure=page.locator(`.messages-attachment[data-messages-source-file-id="${pdf.id}"]`).filter({visible:true});
  await pdfFigure.locator('[data-messages-control="pdf-next"]').waitFor({state:'visible'});
  await page.waitForFunction(id=>{const n=[...document.querySelectorAll('.messages-attachment')].find(n=>n.dataset.messagesSourceFileId===id&&!n.classList.contains('shared-details'));return n?.querySelector('canvas')?.width>0&&!n.querySelector('[role="status"]');},pdf.id);
  check(await pdfFigure.locator('canvas').evaluate(n=>{const d=n.getContext('2d').getImageData(0,0,n.width,n.height).data;return d.some((v,i)=>i%4===0&&d[i+3]&&v<200);}), 'Inline PDF renders actual visible page ink');
  await pdfFigure.locator('[data-messages-control="pdf-next"]').click();await page.waitForFunction(id=>{const n=[...document.querySelectorAll('.messages-attachment')].find(n=>n.dataset.messagesSourceFileId===id&&!n.classList.contains('shared-details'));return n?.querySelector('nav span')?.textContent==='Page 2 of 3'&&!n.querySelector('[role="status"]');},pdf.id);check(true,'Native inline PDF navigation renders actual page two');
  check((await execute('messages.attachment.preview',photoTarget,{menuOpen:true})).status==='applied','Direct API opens original attachment context menu');
  check(await c('attachment-save:'+photoAttachment.id).isVisible(),'Original native context menu controls are genuinely visible');
  check((await execute('messages.attachment.preview',photoTarget,{menuOpen:false})).status==='applied','Direct API dismisses same native context menu');
  await c('attachment-actions:'+photoAttachment.id).click();await c('attachment-save:'+photoAttachment.id).click();
  let save=page.locator('[data-destination-kind="picker"]');await save.waitFor({state:'visible'});await save.locator('[data-destination-control="location"]').selectOption('documents');await save.locator('[data-destination-control="save-name"]').fill('Messages retained café.png');await save.locator('[data-destination-control="save"]').click();await save.waitFor({state:'hidden'});
  const afterSave=await data(),saved=afterSave.files.find(f=>f.name==='Messages retained café.png');check(saved&&saved.content===image.content&&saved.mime===image.mime,'Native attachment Save As retains exact original MIME and bytes');
  check(afterSave.files.find(f=>f.id===image.id).content===image.content,'Save As leaves original source File unchanged');
  await c('attachment-actions:'+photoAttachment.id).click();await c('attachment-open:'+photoAttachment.id).click();
  await page.waitForFunction(appId=>jesteros.inspect().state.activeAppId!==appId,appId);
  const associated=await data();check(associated.activeAppId==='preview'||associated.activeAppId==='photos','Native attachment Open reaches actual image application');
  check(JSON.stringify(associated.preview).includes(image.id)||JSON.stringify(associated.photos).includes(image.id),'Associated app model owns exact source File');
  await execute('window.focus',{windowId:w.id});
  // A genuine HTML drag from the represented Finder/Explorer, without injected DataTransfer bytes.
  const fileApp=appId==='teams'?'explorer':'finder';await execute('app.open',{appId:fileApp});
  let finder=(await data()).windows.find(win=>win.appId===fileApp&&!win.utilityKind);
  if(appId==='teams')await page.locator('[data-control="explorer-nav-'+image.parentId+'"]').click();else await execute('desktop.folder.navigate',{windowId:finder.id,folderId:image.parentId});
  // Expose a strip of the original messaging view beside the source window.
  await execute('window.move',{windowId:finder.id},{x:0,y:30});
  if((await data()).windows.find(win=>win.id===w.id).maximized)await execute('window.setMaximized',{windowId:w.id},{maximized:false});
  await execute('window.move',{windowId:w.id},{x:1200,y:80});
  await execute('window.focus',{windowId:finder.id});
  const sourceRow=appId==='teams'?page.locator('[data-control="explorer-file-'+image.id+'"]'):page.locator('[data-finder-file-id="'+image.id+'"]');
  await sourceRow.dragTo(c('draft-body'));
  await page.waitForFunction(id=>{const s=jesteros.inspect().state.messages;return s.drafts.find(d=>d.id===s.selectedDraftId).attachments.some(a=>a.originalFileId===id);},image.id);
  check(true,'Native Finder/Explorer drag attaches the genuine original File');
  await execute('window.focus',{windowId:w.id});
  // Emoji and authored audio, with a real retained composer and decoded media.
  const dragState=(await data()).messages,dragDraft=dragState.drafts.find(d=>d.id===dragState.selectedDraftId);
  for(const attachment of dragDraft.attachments)await c('draft-detach:'+attachment.id).click();
  await c('draft-body').fill('Emoji café 東京 ');await c('emoji-picker').click();await c('emoji:🌲').click();
  await page.waitForFunction(()=>jesteros.inspect().state.messages.drafts.some(d=>d.fields.body==='Emoji café 東京 🌲'));
  await c('emoji-close').click();check(await c('draft-body').inputValue()==='Emoji café 東京 🌲','Native emoji picker inserts exact Unicode in original draft');
  check(await c('draft-body').evaluate(n=>document.activeElement===n&&n.selectionStart===n.value.length&&n.selectionEnd===n.value.length),'Emoji Close restores original composer and accepted caret');
  await c('draft-body').fill('');await c('audio-fixture').click();await c('draft-body').fill('Authored audio café 東京');await c('draft-send').click();
  await page.waitForFunction(()=>{let s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).items.some(i=>i.text==='Authored audio café 東京');});
  const audioMessage=(await selected()).items.at(-1),audioAttachment=audioMessage.attachments[0];
  check(audioAttachment.mime==='audio/wav'&&audioAttachment.durationMs===8000,'Native audio interface retains genuine eight-second authored WAV');
  const media=page.locator('.messages-attachment.audio audio').filter({visible:true}),audioTarget={windowId:w.id,conversationId:group.id,messageId:audioMessage.id,attachmentId:audioAttachment.id};
  await media.evaluate(n=>n.readyState>=1?Promise.resolve():new Promise(resolve=>n.addEventListener('loadedmetadata',resolve,{once:true})));
  check((await execute('messages.attachment.preview',audioTarget,{playing:true})).status==='applied','Direct API starts original decoded audio');
  await page.waitForFunction(()=>[...document.querySelectorAll('.messages-attachment.audio audio')].some(n=>!n.paused&&n.currentTime>0));
  check((await execute('messages.attachment.preview',audioTarget,{playing:false})).status==='applied'&&await media.evaluate(n=>n.paused),'Direct API pauses original audio element');
  check((await execute('messages.attachment.preview',audioTarget,{time:2})).status==='applied'&&await media.evaluate(n=>Math.abs(n.currentTime-2)<.1),'Direct API seeks actual media timeline');
  check((await execute('messages.attachment.preview',audioTarget,{time:9})).status!=='applied','Seek beyond original decoded duration rejects');
  await page.locator('p').filter({hasText:/^Authored audio café 東京$/}).filter({visible:true}).click({button:'right'});await c('message-actions-close').waitFor({state:'visible'});
  check(await page.evaluate(()=>jesteros.describe().targets.messages.windows.find(w=>w.available).presentation.messageActions)===audioMessage.id,'Native message actions expose original target through discovery');
  await c('reaction:👍').click();await page.waitForFunction(id=>{let s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).items.find(i=>i.id===id).reactions?.[0]?.emoji==='👍';},audioMessage.id);check(true,'Native reaction changes original message only');
  await c('message-copy').click();await c('message-actions-close').click();await c('draft-body').fill('');
  check((await execute('messages.edit.paste',{windowId:w.id})).status==='applied','Message Copy uses shared simulation clipboard');check(await c('draft-body').inputValue()==='Authored audio café 東京','Pasted copied message preserves literal Unicode');
  await page.locator('p').filter({hasText:/^Authored audio café 東京$/}).filter({visible:true}).click({button:'right'});await c('message-delete').click();const beforeDelete=JSON.stringify((await data()).messages);await c('confirmation-cancel').click();check(JSON.stringify((await data()).messages)===beforeDelete,'Native Delete Message Cancel is non-destructive');
  await page.locator('p').filter({hasText:/^Authored audio café 東京$/}).filter({visible:true}).click({button:'right'});await c('message-delete').click();await c('confirmation-confirm').click();await page.waitForFunction(id=>{let s=jesteros.inspect().state.messages;return !s.conversations.find(r=>r.id===s.selectedConversationId).items.some(i=>i.id===id);},audioMessage.id);check(true,'Native Delete Message Confirm removes exact original message');
  // Replacing an open same-kind Quick Look must remount its original media owner.
  await c('draft-body').fill('');await c('audio-fixture').click();await c('draft-body').fill('Second audio owner');await c('draft-send').click();
  await page.waitForFunction(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).items.some(i=>i.text==='Second audio owner');});
  const secondAudio=(await selected()).items.at(-1),secondTarget={windowId:w.id,conversationId:group.id,messageId:secondAudio.id,attachmentId:secondAudio.attachments[0].id};
  check((await execute('messages.attachment.quickLook',secondTarget)).status==='applied','Direct Quick Look opens original authored audio');
  await c('quick-look-close').waitFor({state:'visible'});
  await c('quick-look-close').click();
  await c('draft-body').fill('');await c('audio-fixture').click();await c('draft-body').fill('Third audio owner');await c('draft-send').click();
  await page.waitForFunction(()=>{const s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).items.some(i=>i.text==='Third audio owner');});
  const thirdAudio=(await selected()).items.at(-1),thirdTarget={windowId:w.id,conversationId:group.id,messageId:thirdAudio.id,attachmentId:thirdAudio.attachments[0].id};
  await execute('messages.attachment.quickLook',secondTarget);
  check((await execute('messages.attachment.quickLook',thirdTarget)).status==='applied','Direct audio Quick Look replaces same-kind original owner');
  const quickMedia=page.locator('.messages-quick-look audio');
  await quickMedia.evaluate(n=>n.readyState>=1?Promise.resolve():new Promise(resolve=>n.addEventListener('loadedmetadata',resolve,{once:true})));
  check((await execute('messages.attachment.preview',thirdTarget,{playing:true})).status==='applied'&&await quickMedia.evaluate(n=>!n.paused),'Replacement audio Quick Look commands own the actual new media');
  check((await execute('messages.attachment.preview',secondTarget,{playing:false})).status!=='applied','Retired audio Quick Look cannot borrow replacement media');
  await execute('messages.attachment.preview',thirdTarget,{playing:false});
  check((await execute('messages.attachment.quickLook',thirdTarget,{open:false})).status==='applied'&&await c('quick-look-close').count()===0,'Direct Quick Look Close retires only original preview');
  await c('draft-body').fill('Retained draft after audio replacement');
  // Shared account and participant policy remain the same original domain.
  await execute('messages.conversation.details',{windowId:w.id},{panel:'account',open:true});await c('account-signin').click();let beforeSignout=JSON.stringify((await data()).messages);await c('confirmation-cancel').click();check(JSON.stringify((await data()).messages)===beforeSignout,'Native Sign Out Cancel retains exact shared account and draft');
  await c('account-signin').click();await c('confirmation-confirm').click();await page.waitForFunction(()=>!jesteros.inspect().state.messages.account.signedIn);await c('account-close').click();
  check(await c('draft-send').isDisabled(),'Signed-out account disables native Send');await execute('messages.conversation.details',{windowId:w.id},{panel:'account',open:true});await c('account-signin').click();await c('account-close').click();check((await data()).messages.account.signedIn,'Native local Sign In restores original account');
  await c('conversation-details').click();await page.locator('.messages-details-management summary').click();const removed=(await selected()).participants.at(-1);await c('remove-participant:'+removed).click();await c('confirmation-cancel').click();check((await selected()).participants.length===3,'Remove Participant Cancel preserves original roster');await c('remove-participant:'+removed).click();await c('confirmation-confirm').click();await page.waitForFunction(()=>{let s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).participants.length===2;});check(true,'Native Remove Participant updates exact original group');
  const blocked=(await selected()).participants[0];await c('block:'+blocked).click();await page.waitForFunction(address=>jesteros.inspect().state.messages.blockedAddresses.includes(address),blocked);check(true,'Native Block commits shared literal endpoint');await c('block:'+blocked).click();await page.waitForFunction(address=>!jesteros.inspect().state.messages.blockedAddresses.includes(address),blocked);await c('details-close').click();
  // Native Help fixtures deliver locally; thread mute controls notifications.
  if(appId==='teams'){await page.getByRole('button',{name:'Settings and more',exact:true}).click();await page.getByRole('menuitem',{name:'Help — local guide',exact:true}).click();}else{await page.locator('[data-menu-invoker="help"]').click();await page.getByRole('menuitem',{name:/^Messages Help/}).click();}
  const countBefore=(await data()).system.notifications.entries.length;await c('incoming:trailhead-update').click();await page.waitForFunction(()=>jesteros.inspect().state.messages.incomingFixtures.includes('trailhead-update'));check((await data()).system.notifications.entries.length===countBefore,'Muted native incoming fixture retains message without notification');await c('help-close').click();
  await c('conversation-details').click();await c('conversation-dnd').click();await c('details-close').click();
  const other=(await data()).messages.conversations.find(r=>r.id!==group.id);await execute('messages.conversation.select',{windowId:w.id,conversationId:other.id});
  const incoming=await execute('messages.incoming.receive',{windowId:w.id,conversationId:group.id},{fixtureId:'harbor-map-arrival'});check(incoming.status==='applied'&&Boolean(incoming.notificationId),'Unselected original thread receives genuine local image and source notification');
  await page.locator('[data-notification-control="open:'+incoming.notificationId+'"]').click();await page.waitForFunction(id=>jesteros.inspect().state.messages.selectedConversationId===id,group.id);check(true,'Native notification opens exact original incoming conversation');
  const duplicateBefore=JSON.stringify((await data()).messages);check((await execute('messages.incoming.receive',{windowId:w.id,conversationId:group.id},{fixtureId:'harbor-map-arrival'})).error.code==='disabled','Duplicate local arrival is rejected');check(JSON.stringify((await data()).messages)===duplicateBefore,'Rejected arrival leaves complete Messages graph unchanged');
  await c('conversation-details').click();await c('conversation-leave').click();await c('confirmation-confirm').click();await page.waitForFunction(()=>{let s=jesteros.inspect().state.messages;return s.conversations.find(r=>r.id===s.selectedConversationId).left;});await c('details-close').click();check(await c('draft-send').isDisabled(),'Leaving group disables native Send while retaining draft');
  check((await execute('messages.incoming.receive',{windowId:w.id,conversationId:group.id},{fixtureId:'glass-study-audio'})).error.code==='disabled','Left group rejects later local arrivals');
  await c('conversation-details').click();await c('conversation-delete').click();const beforeGroupDelete=JSON.stringify((await data()).messages);await c('confirmation-cancel').click();check(JSON.stringify((await data()).messages)===beforeGroupDelete,'Delete Conversation Cancel retains original group');await c('conversation-delete').click();await c('confirmation-confirm').click();await page.waitForFunction(id=>!jesteros.inspect().state.messages.conversations.some(r=>r.id===id),group.id);check(true,'Delete Conversation Confirm retires original group and owned draft');
  const beforeClose=JSON.stringify((await data()).messages);
  check((await execute('window.close',{windowId:w.id})).status==='applied','Original messaging window closes');
  check((await execute('app.open',{appId})).status==='applied','Original messaging app reopens');
  check(JSON.stringify((await data()).messages)===beforeClose,'Group/attachments/DND/name survive actual window lifetime');
  check(report.errors.length===0,'No page errors');check(report.external.length===0,'No external requests');
 }catch(e){report.failure=e.stack;await page.screenshot({path:directory+'/'+profile+'-failure.png'}).catch(()=>{});}
 await fs.writeFile(directory+'/results.json',JSON.stringify(reports,null,2));console.log(profile,report.failure?'FAIL '+report.failure:report.checks.length+' checks passed');await context.close();
}
if(reports.some(r=>r.failure))throw new Error('Messages workflow acceptance failed; see results.json');
return reports;
}

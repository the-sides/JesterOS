import fs from 'node:fs/promises';

// Run with an installed Playwright browser against the actual Rust-served build.
// Profile setup uses the public app command; all menu/preference actions are native.
const profiles=['macos-high-sierra-10.13','macos-mojave-10.14','macos-sonoma-14.0','macos-golden-gate-27.0.1','windows11-23h2-22631.2428'];
export async function runMessagesMenuAcceptance({ browser, baseURL, artifactDirectory: directory }) {
 await fs.mkdir(directory,{recursive:true});
const reports=[];
for(const profile of profiles){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.setDefaultTimeout(8000);const report={profile,checks:[],errors:[],external:[]};reports.push(report);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(baseURL+'/')&&!/^(data:|blob:)/.test(r.url()))report.external.push(r.url());});
 const control=id=>page.locator(`[data-messages-control="${id}"]`).filter({visible:true});
 const snapshot=()=>page.evaluate(()=>JSON.stringify(jesteros.inspect().state.messages));
 const check=(value,label)=>{if(!value)throw new Error(label);report.checks.push(label);};
 try{
  await page.goto(baseURL+'/?profile='+profile);
  await page.waitForFunction(()=>window.jesteros?.inspect().state.windows.length);
  const appId=profile.startsWith('windows')?'teams':'messages';
  let w=await page.evaluate(appId=>jesteros.inspect().state.windows.find(w=>w.appId===appId),appId);
  if(!w){await page.evaluate(appId=>jesteros.execute({command:'app.open',target:{appId}}),appId);w=await page.evaluate(appId=>jesteros.inspect().state.windows.find(w=>w.appId===appId),appId);}
  report.windowId=w.id;
  if(appId==='teams'){
    await page.getByRole('button',{name:'Open Teams',exact:true}).click();
    await control('draft-body').waitFor({state:'visible'});
  }
  const body=control('draft-body'); await body.fill('Menu acceptance café 東京 — retained draft');
  await page.waitForFunction(()=>jesteros.inspect().state.messages.drafts.some(d=>d.fields.body==='Menu acceptance café 東京 — retained draft'));
  await body.evaluate(n=>{n.focus();n.setSelectionRange(5,15,'backward');window.originalMessagesComposer=n;});
  const before=await snapshot();
  if(appId==='messages'){
    await page.locator('[data-menu-invoker="application"]').click();
    await page.getByRole('menuitem',{name:/^(Preferences|Settings)/}).click();
  }else{
    await page.getByRole('button',{name:'Settings and more',exact:true}).click();
    await page.getByRole('menuitem',{name:'Settings — local counterpart',exact:true}).click();
  }
  await page.locator('.messages-preferences').waitFor({state:'visible'});
  check(await snapshot()===before,'Native Settings open preserves complete canonical Messages');
  if(/sonoma|golden-gate/.test(profile)) await control('account-name').fill('Uncommitted local name café 東京');
  const panes=await page.locator('.messages-preference-tabs button').evaluateAll(nodes=>nodes.map(n=>n.dataset.messagesControl.split(':')[1]));report.panes=panes;
  for(const pane of panes){
    await control('preference-tab:'+pane).click();
    await page.waitForFunction(pane=>jesteros.describe().targets.messages.windows.some(w=>w.presentation.preferences?.pane===pane),pane);
    check(await control('preference-tab:'+pane).getAttribute('aria-current')==='page','Native pane '+pane+' uses command navigation');
  }
  await control('preference-tab:account').click();
  await control('account-tab:blocked').click();
  check(await page.evaluate(()=>jesteros.describe().targets.messages.windows.find(w=>w.available).presentation.preferences.section)==='blocked','Blocked section is discoverable');
  await control('account-tab:settings').click();
  if(appId==='messages'){
    const prior=await control('account-read-receipts').isChecked();
    await control('account-read-receipts').click();
    await page.waitForFunction(value=>jesteros.inspect().state.messages.account.readReceipts===value,!prior);
    await control('account-read-receipts').click();
  }
  await control('preference-tab:general').click();
  if(/sonoma|golden-gate/.test(profile)) check(await control('account-name').inputValue()==='Uncommitted local name café 東京','Uncommitted name survives pane and subsection navigation');
  const prior=await control('preference:playSounds').isChecked();
  await control('preference:playSounds').click();
  await page.waitForFunction(value=>jesteros.inspect().state.messages.preferences.playSounds===value,!prior);
  await control('preference:playSounds').click();
  if(appId==='messages'){
    await control('preference:keepMessages').selectOption('30days');
    await page.locator('.messages-rich-confirmation').waitFor({state:'visible'});
    await control('confirmation-cancel').click();
    check(await snapshot()===before,'Native destructive retention Cancel preserves entire Messages graph');
  }
  await page.screenshot({path:directory+'/'+profile+'-preferences.png'});
  await control('preferences-close').click();
  await page.waitForFunction(()=>!document.querySelector('.messages-preferences'));
  check(await snapshot()===before,'Closing Preferences preserves original draft/history/preferences');
  if(appId==='messages'){
    check(await page.evaluate(()=>document.activeElement===window.originalMessagesComposer&&document.activeElement.selectionStart===5&&document.activeElement.selectionEnd===15),'Preferences close restores same original composer and selection');
    await body.press('Meta+,');
    await page.locator('.messages-preferences').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.messages-preferences'));
    const menu = async (heading, label) => {
      await page.locator(`[data-menu-invoker="${heading}"]`).click();
      await page.getByRole('menuitem',{name:label}).click();
    };
    await menu('view', /^Make Text Bigger/);
    await page.waitForFunction(()=>jesteros.inspect().state.messages.preferences.textSize===14);
    await menu('view', /^Make Text Smaller/);
    await page.waitForFunction(()=>jesteros.inspect().state.messages.preferences.textSize===13);
    check(true,'Native View text controls mutate the canonical preference');
    await menu('help', /^Messages Help/);
    await control('help-close').waitFor({state:'visible'});
    await control('help-close').click();
    check(true,'Native Messages Help opens and closes locally');
    const beforePrint=await snapshot();
    await menu('file', /^Print/);
    await page.locator('[data-destination-kind="print"]').waitFor({state:'visible'});
    await page.locator('[data-destination-kind="print"] [data-destination-control="cancel"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-destination-kind="print"]'));
    check(await snapshot()===beforePrint,'Native File Print and Cancel preserve complete Messages');
    await body.evaluate(n=>{n.focus();n.setSelectionRange(0,4,'forward');});
    await menu('edit', /^Cut/);
    await page.waitForFunction(()=>jesteros.inspect().state.messages.drafts.some(d=>d.fields.body.startsWith(' acceptance')));
    await menu('edit', /^Undo/);
    await page.waitForFunction(()=>jesteros.inspect().state.messages.drafts.some(d=>d.fields.body==='Menu acceptance café 東京 — retained draft'));
    check(true,'Native Edit Cut/Undo restores exact Unicode draft');
    if(/sonoma|golden-gate/.test(profile)){
      await body.press('Control+Meta+4');
      await page.waitForFunction(()=>jesteros.inspect().state.messages.unreadOnly===true);
      await page.keyboard.press('Control+Meta+1');
      await page.waitForFunction(()=>jesteros.inspect().state.messages.unreadOnly===false);
      await body.click();await body.press('Shift+Meta+U');
      await page.waitForFunction(()=>{let s=jesteros.inspect().state.messages;return s.conversations.find(c=>c.id===s.selectedConversationId).unread;});
      check(true,'Native modern unread filter and mark-unread shortcuts apply');
    }
  }
  check(report.errors.length===0,'No browser page errors');check(report.external.length===0,'No external requests');
 }catch(error){report.failure=error.stack;await page.screenshot({path:directory+'/'+profile+'-failure.png'}).catch(()=>{});}
 await fs.writeFile(directory+'/results.json',JSON.stringify(reports,null,2));
 console.log(profile,report.failure?'FAIL '+report.failure:report.checks.length+' checks passed');
 await context.close();
}
return reports;
}

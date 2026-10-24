import fs from 'node:fs/promises';

const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];

// Supply the browser rather than installing or choosing one for the caller.
export async function runBrowserNavigationAcceptance({ browser, baseURL, artifactDirectory }) {
  await fs.mkdir(artifactDirectory, { recursive: true });
  const reports = [];
  for (const profileId of profiles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const report = { profileId, checks: [], errors: [], external: [] };
    reports.push(report);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(new URL(baseURL).origin + '/') && !/^(data:|blob:)/.test(request.url())) report.external.push(request.url());
    });
    const control = id => page.locator(`[data-browser-control=${JSON.stringify(id)}]`).filter({ visible: true });
    const check = (value, label) => { if (!value) throw Error(label); report.checks.push(label); };
    const state = () => page.evaluate(() => jesteros.inspect().state.browser);
    const tab = async () => { const s = await state(); const w = s.windows.find(w => !w.closed); return w.tabs.find(t => t.id === w.activeTabId); };
    const settled = () => page.waitForFunction(() => jesteros.inspect().state.browser.windows.find(w => !w.closed)?.tabs.every(t => t.phase !== 'loading'));
    const address = async value => {
      const token = (await tab()).loadToken;
      await control('address').fill(value);
      await control('address').press('Enter');
      await page.waitForFunction(token => { const s = jesteros.inspect().state.browser; const w = s.windows.find(w => !w.closed), t = w.tabs.find(t => t.id === w.activeTabId); return t.loadToken !== token && t.phase !== 'loading'; }, token);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    try {
      await page.goto(`${baseURL.replace(/\/$/, '')}/?profile=${profileId}`);
      await page.waitForFunction(() => window.jesteros?.inspect().state.windows.length);
      // No audio-producing interactions in this runner; mute any media as well.
      await page.evaluate(() => {
        document.querySelectorAll('audio,video').forEach(node => { node.muted = true; node.pause(); });
      });
      const opened = await page.evaluate(async appId => jesteros.execute({ command: 'app.open', target: { appId } }), profileId.startsWith('windows') ? 'edge' : 'safari');
      check(opened.status === 'applied', 'native browser opens');
      await control('address').waitFor();
      await address('jester://guide');
      check((await tab()).entries.at(-1).pageId === 'guide', 'native address submit resolves authored page');
      check(await page.locator('[data-browser-area="page"]').innerText().then(t => t.includes('Welcome to your production desktop')), 'actual guide text rendered');
      await control('page-link:jester://studio').click();
      await settled();
      check((await tab()).entries.at(-1).pageId === 'studio', 'rendered page link navigates locally');
      await control('back').click(); await settled();
      check((await tab()).entries[(await tab()).index].pageId === 'guide', 'Back restores guide');
      await control('forward').click(); await settled();
      check((await tab()).entries[(await tab()).index].pageId === 'studio', 'Forward restores studio');
      await address('coast');
      check(await page.locator('[data-browser-area="page"]').innerText().then(t => t.includes('Studio journal')), 'fictional search renders matching local results');
      await control('page-link:jester://journal').click(); await settled();
      check(await page.locator('[data-browser-area="page"]').innerText().then(t => t.includes('09:41')), 'search result opens actual journal');
      check(await control('forward').isDisabled(), 'new navigation discards forward branch');
      const length = (await tab()).entries.length;
      await control('reload').click(); await settled();
      check((await tab()).entries.length === length, 'Reload preserves navigation stack size');
      await address('https://unavailable.invalid/path');
      check((await tab()).phase === 'error', 'unknown address enters offline error state');
      check(await page.locator('[data-browser-area="page"]').innerText().then(t => t.includes('This page is not available offline')), 'offline error is actually rendered');
      await control('back').click(); await settled();
      check((await tab()).phase === 'idle', 'Back recovers from error');
      await address('zzzz_no_local_match');
      check(await page.locator('[data-browser-area="page"]').innerText().then(t => /no .*results|no .*matches/i.test(t)), 'unmatched search has visible empty state');
      const before = await tab(), history = (await state()).history.length;
      await control('address').fill('jester://downloads');
      await control('address').press('Enter');
      await control('stop').click(); await settled();
      check((await tab()).pending === null, 'Stop clears pending load');
      check((await tab()).entries.length === before.entries.length && (await state()).history.length === history, 'Stop adds no entry or visit');
      check((await tab()).address === before.entries[before.index].url, 'Stop restores committed address');
      const owner = (await state()).windows.find(w => !w.closed);
      const target = { windowId: owner.id, tabId: owner.activeTabId };
      const execute = (suffix, payload = {}) => page.evaluate(({ suffix, payload, target }) =>
        jesteros.execute({ command: `browser.${suffix}`, target, payload }), { suffix, payload, target });
      check((await execute('navigate', { address: 'jester://guide' })).status === 'applied', 'direct navigation uses same canonical browser');
      check((await execute('back')).status === 'applied', 'direct Back applied');
      check((await execute('forward')).status === 'applied', 'direct Forward applied');
      check((await execute('reload')).status === 'applied', 'direct Reload applied');
      check((await tab()).entries[(await tab()).index].pageId === 'guide', 'direct commands render original guide');
      const retained = await state();
      const closed = await page.evaluate(windowId => jesteros.execute({ command: 'window.close', target: { windowId } }), owner.id);
      const wasClosed = (await state()).windows.find(w => w.id === owner.id)?.closed === true;
      const reopenedResult = await page.evaluate(appId => jesteros.execute({ command: 'app.open', target: { appId } }), owner.nativeAppId);
      await control('address').waitFor();
      const reopened = await state();
      check(closed.status === 'applied' && wasClosed && reopenedResult.status === 'applied' && reopened.windows.some(w => !w.closed && w.tabs.some(t => t.entries[t.index].url === 'jester://guide')) && reopened.windows.find(w => w.id === owner.id)?.tabs[0].entries.length === retained.windows.find(w => w.id === owner.id).tabs[0].entries.length, 'closed history remains retained and new window opens the last page');
      await page.setViewportSize({ width: 390, height: 844 });
      check(await control('address').isVisible(), 'address remains present at narrow viewport');
      await page.screenshot({ path: `${artifactDirectory}/${profileId}-narrow.png` });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `${artifactDirectory}/${profileId}.png` });
      check(report.errors.length === 0, 'no page errors');
      check(report.external.length === 0, 'no external requests');
    } catch (error) { report.failure = error.stack; }
    finally { await context.close(); }
  }
  await fs.writeFile(`${artifactDirectory}/results.json`, JSON.stringify(reports, null, 2));
  if (reports.some(report => report.failure)) throw Error(JSON.stringify(reports, null, 2));
  return reports;
}

// Read-only smoke check against the real service. No sign-in, consent choice,
// account actions or video playback are automated here.
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
if (!process.env.TUBEVRA_TEST_PROFILE)
  throw new Error('Use the Electron test runner.');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
const output = path.resolve('out/verification/live');
fs.mkdirSync(output, { recursive: true });
const started = Date.now();
app
  .whenReady()
  .then(async () => {
    require('../../out/Tubevra-win32-x64/resources/app.asar/.vite/build/main.cjs');
    while (Date.now() - started < 45000) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.show();
        win.focus();
        const shell = win.webContents;
        const result = await shell
          .executeJavaScript('window.tubevra?.getState()')
          .catch(() => null);
        if (result?.ok && (!result.value.loading || result.value.error)) {
          const tv = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('https://www.youtube.com'),
            );
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const page = tv
            ? await tv
                .executeJavaScript(
                  `({url:location.href,title:document.title,client:window.ytcfg?.get?.('INNERTUBE_CLIENT_NAME'),text:document.body.innerText.slice(0,1800),controls:[...document.querySelectorAll('button,input,[role="button"]')].slice(0,30).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),text:e.textContent.slice(0,70)}))})`,
                )
                .catch((error) => ({ error: error.message }))
            : null;
          const report = {
            state: result.value,
            page,
            verified: ['real-service load attempt only'],
            unverified: [
              'live Leanback Back',
              'live playback',
              'physical IME',
              'macOS',
              'Linux',
            ],
          };
          fs.writeFileSync(
            path.join(output, 'report.json'),
            JSON.stringify(report, null, 2),
          );
          console.log(JSON.stringify(report, null, 2));
          app.exit(result.value.error ? 1 : 0);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      'Real YouTube TV did not finish loading within 45 seconds.',
    );
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

// Run with Electron, not Node. Uses only local test pages and its own profile.
const {
  app,
  BrowserWindow,
  WebContentsView,
  desktopCapturer,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('out/verification/glass');
fs.mkdirSync(output, { recursive: true });
if (!process.env.TUBEVRA_TEST_PROFILE)
  throw new Error('Use the Electron test runner to isolate user data.');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 940,
      height: 640,
      show: false,
      title: 'Tubevra glass probe',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const { width, height } = win.getContentBounds();
    const children = [];
    async function view(bounds, html, nativeBlur = 0) {
      const child = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      child.setBounds(bounds);
      child.setBackgroundColor(nativeBlur ? '#33101010' : '#00000000');
      if (nativeBlur) {
        child.setBorderRadius(24);
        child.setBackgroundBlur(nativeBlur);
      }
      win.contentView.addChildView(child);
      children.push(child);
      await child.webContents.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );
      return child;
    }
    try {
      await win.loadURL('data:text/html,<title>Tubevra glass probe</title>');
      await view(
        { x: 0, y: 0, width, height },
        '<body style="margin:0;background:repeating-linear-gradient(90deg,#0008 0 4px,#fff8 4px 8px),repeating-linear-gradient(90deg,#db3857 0 150px,#23ba96 150px 300px,#386be2 300px 450px)"></body>',
      );
      const page = (label, css = '') =>
        `<body style="margin:0;background:transparent;color:#ff5050;font:18px sans-serif;${css}"><div style="height:120px;box-sizing:border-box;padding:12px;${css}">${label}</div></body>`;
      await view(
        { x: 60, y: 100, width: 350, height: 120 },
        page('Native View.setBackgroundBlur(16)'),
        16,
      );
      await view(
        { x: 500, y: 100, width: 350, height: 120 },
        page(
          'CSS backdrop-filter: blur(16px)',
          'backdrop-filter:blur(16px);background:rgba(16,16,16,.2);',
        ),
      );
      await view(
        { x: 60, y: 300, width: 350, height: 120 },
        page('Control: tint without blur', 'background:rgba(16,16,16,.2);'),
      );
      win.setAlwaysOnTop(true);
      win.show();
      win.focus();
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1880, height: 1280 },
      });
      const source = sources.find(
        (entry) => entry.id === win.getMediaSourceId(),
      );
      if (!source || source.thumbnail.isEmpty())
        throw new Error('No composed window capture available.');
      fs.writeFileSync(
        path.join(output, 'native-window.png'),
        source.thumbnail.toPNG(),
      );
      console.log(
        JSON.stringify({
          electron: process.versions.electron,
          contentBounds: win.getContentBounds(),
          windowBounds: win.getBounds(),
          image: source.thumbnail.getSize(),
          output,
        }),
      );
    } finally {
      for (const child of children) child.webContents.close();
      win.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

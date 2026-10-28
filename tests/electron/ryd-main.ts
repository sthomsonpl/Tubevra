import {
  app,
  session,
  BrowserWindow,
  ipcMain,
  shell,
  webContents,
  screen,
  desktopCapturer,
} from 'electron';
import { createTVWindow } from '../../src/main/tv-window';
import { UserAgentStore } from '../../src/main/user-agent-store';
import { IPC, RYD_URL } from '../../src/shared/api';
import { RATINGS_IPC } from '../../src/shared/ratings';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  start,
  createRydStart,
} from '../../src/extensions/return-youtube-dislike/main';
import { starts } from '../../src/extensions/main/implementations';
import { createRydTransport } from '../../src/extensions/return-youtube-dislike/transport';
import type { Cleanup } from '../../src/extensions/types';

const output = process.env.TUBEVRA_TEST_RESULT
  ? path.dirname(process.env.TUBEVRA_TEST_RESULT)
  : 'out/verification/ryd';
const profile = process.env.TUBEVRA_TEST_PROFILE;
if (!profile) throw Error('Use the isolated Electron runner.');
app.setPath('userData', profile);
// Keep the harness alive until asynchronous child cleanup has been asserted.
app.on('window-all-closed', () => {});
void app
  .whenReady()
  .then(async () => {
    const sessions: Electron.Session[] = [];
    const fromPartition = session.fromPartition.bind(session);
    session.fromPartition = (partition, options) => {
      const isolated = fromPartition(partition, options);
      sessions.push(isolated);
      return isolated;
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      const abort = new AbortController();
      const cleanup: Cleanup[] = [];
      let service: any;
      const stop = await start({
        signal: abort.signal,
        onCleanup: (fn) => cleanup.push(fn),
        registerService: (value) => (service = value),
        reportDiagnostics: () => {},
        registerRule: () => {
          throw Error('Unexpected rule');
        },
        registerPageDiagnostics: () => {},
      });
      assert.equal(typeof service.get, 'function');
      assert.equal(
        (await service.get('invalid', new AbortController().signal)).kind,
        'invalid-data',
      );
      abort.abort();
      await stop();
      for (const release of cleanup.reverse()) await release();
      assert.equal(
        (await service.get('dQw4w9WgXcQ', new AbortController().signal)).kind,
        'cancelled',
      );
    }
    assert.equal(
      (await createRydTransport()('../bad', new AbortController().signal)).kind,
      'invalid-data',
    );
    assert.equal(sessions.length, 1);
    assert.notEqual(sessions[0], session.defaultSession);
    assert.equal(sessions[0].isPersistent(), false);
    session.fromPartition = fromPartition;
    // Production local renderer/preload and main handler; remote YouTube is a fixture.
    await session.fromPartition('persist:tubevra-tv').protocol.handle(
      'https',
      () =>
        new Response(
          `<!doctype html><div id="ytlr-player__player-container-player"></div><script>
        window.model={id:'dQw4w9WgXcQ',ad:false};
        const p=document.querySelector('div');
        p.getVideoData=()=>({video_id:model.id});
        p.getPlayerResponse=()=>({videoDetails:{videoId:model.id}});
        p.isInline=()=>false;p.getAdState=()=>model.ad?1:-1;
        location.hash='/watch?v='+model.id;
        </script>`,
          { headers: { 'content-type': 'text/html' } },
        ),
    );
    const handle = ipcMain.handle.bind(ipcMain);
    let openRyd: any;
    let getRatings: any;
    ipcMain.handle = (channel, listener) => {
      if (channel === IPC.openReturnYouTubeDislike) openRyd = listener;
      if (channel === RATINGS_IPC.get) getRatings = listener;
      return handle(channel, listener);
    };
    await createTVWindow(await UserAgentStore.open(profile));
    ipcMain.handle = handle;
    const win = BrowserWindow.getAllWindows()[0];
    // A packaged executable can inherit a hidden startup state from its runner.
    win.show();
    win.focus();
    win.setAlwaysOnTop(true); // Test-only: keep local fixture frames painted.
    const local = win.webContents;
    const event = { sender: local, senderFrame: local.mainFrame };
    const opened: string[] = [];
    const openExternal = shell.openExternal;
    shell.openExternal = async (url) => {
      opened.push(url);
    };
    assert.equal((await openRyd(event, 'https://evil.test')).ok, false);
    for (const foreign of [
      { sender: { mainFrame: local.mainFrame }, senderFrame: local.mainFrame },
      { sender: local, senderFrame: { url: local.mainFrame.url } },
    ])
      await assert.rejects(async () => openRyd(foreign), /Untrusted/);
    assert.equal(opened.length, 0);
    const link =
      '.extension-attribution-link[data-extension-id="return-youtube-dislike"]';
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await local.executeJavaScript(`!!document.querySelector('${link}')`))
        break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(
      await local.executeJavaScript(`document.querySelector('${link}').href`),
      RYD_URL,
    );
    await local.executeJavaScript(`document.querySelector('${link}').click()`);
    for (let attempt = 0; !opened.length && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(opened, [RYD_URL]);
    shell.openExternal = async () => {
      throw Error('Browser unavailable');
    };
    assert.deepEqual(await openRyd(event), {
      ok: false,
      error: 'Could not open Return YouTube Dislike.',
    });
    shell.openExternal = openExternal;
    const requested: string[] = [];
    let responseStatus = 200;
    let holdNext = false;
    let releaseRatings: (() => void) | undefined;
    (starts as Record<string, typeof start>)['return-youtube-dislike'] =
      createRydStart(() => async (id) => {
        requested.push(id);
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve) => {
            releaseRatings = resolve;
          });
        }
        return {
          kind: 'response',
          status: responseStatus,
          body: Buffer.from(JSON.stringify({ id, likes: 0, dislikes: 45 })),
        };
      });
    await local.executeJavaScript(
      `window.tubevra.setExtensionEnabled({id:'return-youtube-dislike',enabled:true})`,
    );
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      ready = await local.executeJavaScript(
        `window.tubevra.getState().then(result=>result.value.extensions.items.find(i=>i.id==='return-youtube-dislike')?.diagnostics?.main?.playback==='ready')`,
      );
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(
      ready,
      true,
      JSON.stringify(
        await local.executeJavaScript(`window.tubevra.getState()`),
      ),
    );
    const panel = webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('#ratings'))!;
    const remote = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('https://www.youtube.com/tv'))!;
    const panelView = win.contentView.children.find(
      (v: any) => v.webContents === panel,
    )!;
    const panelEvent = { sender: panel, senderFrame: panel.mainFrame };
    assert.equal(
      await panel.executeJavaScript('typeof window.tubevra'),
      'undefined',
    );
    assert.equal(
      await local.executeJavaScript('typeof window.ratings'),
      'undefined',
    );
    assert.throws(() => getRatings(event), /Untrusted/);
    assert.throws(
      () => getRatings({ sender: panel, senderFrame: { url: panel.getURL() } }),
      /Untrusted/,
    );
    assert.throws(() => getRatings(panelEvent, 'extra'), /Untrusted/);
    assert.equal(getRatings(panelEvent).kind, 'ready');
    assert.equal(getRatings(panelEvent).likes, 0);
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const wait = async (predicate: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await delay(30);
      }
      console.error(
        JSON.stringify({
          contentBounds: win.getContentBounds(),
          rootBounds: win.contentView.getBounds(),
          cursor: screen.getCursorScreenPoint(),
          windowVisible: win.isVisible(),
          minimized: win.isMinimized(),
          error: await local.executeJavaScript(
            'window.tubevra.getState().then(r=>r.value.error)',
          ),
          views: win.contentView.children.map((v: any) => ({
            url: v.webContents?.getURL(),
            loading: v.webContents?.isLoading(),
            type: v.constructor.name,
            visible: v.getVisible(),
            bounds: v.getBounds(),
            children: v.children?.map((p: any) => ({
              visible: p.getVisible(),
              bounds: p.getBounds(),
            })),
          })),
        }),
      );
      throw Error('Panel condition timed out');
    };
    await wait(async () =>
      (
        await panel.executeJavaScript(
          'document.querySelector(".ratings-counts").textContent',
        )
      ).includes('45'),
    );
    const originalCursor = screen.getCursorScreenPoint;
    let cursor = { x: -10000, y: -10000 };
    screen.getCursorScreenPoint = () => cursor;
    const reveal = () => {
      const b = win.getContentBounds();
      cursor = { x: b.x + b.width / 2, y: b.y + b.height - 2 };
    };
    const dockView = win.contentView.children.find((v: any) =>
      v.webContents?.getURL().endsWith('#toolbar'),
    )!;
    const animation = win.contentView.children.find(
      (v) => v.constructor.name === 'View',
    )!;
    const motionSamples: unknown[] = [];
    const sampleMotion = async (name: string) => {
      cursor = { x: -10000, y: -10000 };
      await wait(
        () =>
          !animation.getVisible() &&
          !dockView.getVisible() &&
          !panelView.getVisible(),
      );
      const sample = () => {
        const origin = animation.getBounds();
        const offsets = animation.children.map((picture, i) => {
          assert.equal(
            picture.getVisible(),
            true,
            name + ': both pictures participate',
          );
          const live = (i === 0 ? dockView : panelView).getBounds();
          return picture.getBounds().y - (live.y - origin.y);
        });
        assert.equal(
          offsets[0],
          offsets[1],
          name + ': equal displacement in the same frame',
        );
        assert.equal(dockView.getVisible(), false);
        assert.equal(panelView.getVisible(), false);
        motionSamples.push({ name, offsets });
        return offsets[0];
      };
      reveal();
      await wait(
        () =>
          animation.getVisible() &&
          animation.children.every((p) => p.getVisible()),
      );
      let previous = sample();
      for (let frame = 0; frame < 3; frame++) {
        await delay(25);
        const offset = sample();
        assert.ok(offset < previous, 'both pictures move upward');
        previous = offset;
      }
      const [width, height] = win.getSize();
      const source = (
        await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width, height },
        })
      ).find((s) => s.id === win.getMediaSourceId());
      assert.ok(source && !source.thumbnail.isEmpty());
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(output, name + '-motion.png'),
        source.thumbnail.toPNG(),
      );
      await wait(
        () =>
          dockView.getVisible() &&
          panelView.getVisible() &&
          !animation.getVisible(),
      );
      cursor = { x: -10000, y: -10000 };
      await wait(
        () =>
          animation.getVisible() &&
          animation.children.every((p) => p.getVisible()),
      );
      await delay(40);
      const hiding = sample();
      reveal();
      // The cursor is polled on the controller's next tick. Observe the turn
      // from its actual peak rather than comparing with a pre-input sample.
      let peak = hiding;
      let reversed = false;
      for (let i = 0; i < 10; i++) {
        await delay(10);
        const offset = sample();
        assert.ok(
          offset < animation.getBounds().height,
          'reversal never jumps to the hidden endpoint',
        );
        if (offset < peak) {
          reversed = true;
          break;
        }
        peak = offset;
      }
      assert.equal(reversed, true, 'reversal continues from the current frame');
      await wait(
        () =>
          dockView.getVisible() &&
          panelView.getVisible() &&
          !animation.getVisible(),
      );
    };
    reveal();
    await wait(() => panelView.getVisible());
    let beforeReveal = requested.length;
    cursor = { x: -10000, y: -10000 };
    await wait(() => !panelView.getVisible() && !animation.getVisible());
    await sampleMotion('wide');
    assert.equal(
      requested.length,
      beforeReveal,
      'dock motion does not fetch ratings',
    );
    // Delay only the private local bitmap read, while the real renderer and
    // player continue updating. This reproduces the formerly blank frames.
    cursor = { x: -10000, y: -10000 };
    await wait(
      () =>
        !animation.getVisible() &&
        !dockView.getVisible() &&
        !panelView.getVisible(),
    );
    const executePanel = panel.executeJavaScript.bind(panel);
    let releaseFrame: () => void;
    let delayedFrame: Promise<void> | null = null;
    let delayedReads = 0;
    panel.executeJavaScript = async (code, gesture) => {
      if (code.includes('canvas.toDataURL') && delayedFrame) {
        delayedReads++;
        await delayedFrame;
      }
      return executePanel(code, gesture);
    };
    reveal();
    await wait(
      () =>
        animation.getVisible() &&
        animation.children.every((p) => p.getVisible()),
    );
    delayedFrame = new Promise<void>((resolve) => {
      releaseFrame = resolve;
    });
    await remote.executeJavaScript(
      "model.id='DDDDDDDDDDD';location.hash='/watch?v='+model.id",
    );
    await wait(() => getRatings(panelEvent).videoId === 'DDDDDDDDDDD');
    await wait(() => delayedReads > 0);
    const assertContinuous = () => {
      assert.ok(
        dockView.getVisible() ||
          (animation.getVisible() && animation.children[0].getVisible()),
        'dock stays visible',
      );
      assert.ok(
        panelView.getVisible() ||
          (animation.getVisible() && animation.children[1].getVisible()),
        'RYD glass stays visible while frame is pending',
      );
    };
    for (let i = 0; i < 5; i++) {
      assertContinuous();
      await delay(20);
    }
    win.setSize(640, 540);
    await delay(40);
    reveal();
    assertContinuous();
    const [captureWidth, captureHeight] = win.getSize();
    const neutralSource = (
      await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: captureWidth, height: captureHeight },
      })
    ).find((s) => s.id === win.getMediaSourceId());
    assert.ok(neutralSource && !neutralSource.thumbnail.isEmpty());
    fs.writeFileSync(
      path.join(output, 'pending-frame.png'),
      neutralSource.thumbnail.toPNG(),
    );
    delayedFrame = null;
    releaseFrame!();
    await wait(
      () =>
        dockView.getVisible() &&
        panelView.getVisible() &&
        !animation.getVisible(),
    );
    panel.executeJavaScript = executePanel;
    await remote.executeJavaScript(
      "model.id='dQw4w9WgXcQ';location.hash='/watch?v='+model.id",
    );
    await wait(
      () =>
        getRatings(panelEvent).kind === 'ready' &&
        getRatings(panelEvent).videoId === 'dQw4w9WgXcQ',
    );
    win.setSize(1280, 800);
    await delay(50);
    beforeReveal = requested.length;
    reveal();
    await wait(() => panelView.getVisible());
    assert.equal(
      requested.length,
      beforeReveal,
      'reveal does not fetch ratings',
    );
    win.setSize(640, 540);
    await wait(() => {
      const p = panelView.getBounds(),
        d = dockView.getBounds();
      return (
        win.contentView.getBounds().width <= 640 && p.y + p.height + 12 <= d.y
      );
    });
    const bounds = panelView.getBounds();
    assert.ok(
      bounds.y + bounds.height + 12 <= dockView.getBounds().y,
      'narrow layout is above dock: ' +
        JSON.stringify({
          panel: bounds,
          dock: dockView.getBounds(),
          content: win.contentView.getBounds(),
        }),
    );
    await sampleMotion('narrow');
    cursor = {
      x: win.getContentBounds().x + bounds.x + 20,
      y: win.getContentBounds().y + bounds.y + 20,
    };
    await delay(2000);
    assert.equal(panelView.getVisible(), true, 'panel hover holds dock');
    await local.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    assert.equal(panelView.getVisible(), false);
    await local.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    reveal();
    await wait(() => panelView.getVisible());
    const oldVersion = getRatings(panelEvent).version;
    await local.executeJavaScript(
      "window.tubevra.setExtensionEnabled({id:'return-youtube-dislike',enabled:false})",
    );
    assert.equal(panelView.getVisible(), false);
    assert.equal(getRatings(panelEvent).kind, 'no-video');
    await wait(
      async () =>
        await local.executeJavaScript(
          "window.tubevra.getState().then(r=>r.value.extensions.items.find(i=>i.id==='return-youtube-dislike').layers.page==='disabled')",
        ),
    );
    await local.executeJavaScript(
      "window.tubevra.setExtensionEnabled({id:'return-youtube-dislike',enabled:true})",
    );
    await wait(() => getRatings(panelEvent).kind === 'ready');
    assert.ok(getRatings(panelEvent).version > oldVersion);
    // Keep the simulated cursor for the remaining visibility checks.
    assert.equal(
      await remote.executeJavaScript(`typeof window.tubevra`),
      'undefined',
    );
    cursor = { x: -10000, y: -10000 };
    await wait(
      () =>
        !animation.getVisible() &&
        !dockView.getVisible() &&
        !panelView.getVisible(),
    );
    holdNext = true;
    await remote.executeJavaScript(
      `model.id='abcdefghijk';history.replaceState(null,'','#/watch?v='+model.id)`,
    );
    for (
      let attempt = 0;
      attempt < 100 && !requested.includes('abcdefghijk');
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(
      requested.includes('abcdefghijk'),
      'sampling detects autoplay without hashchange: ' +
        JSON.stringify(requested) +
        ' ' +
        JSON.stringify(
          await remote.executeJavaScript(`({hash:location.hash,id:model.id})`),
        ),
    );
    await wait(
      () => getRatings(panelEvent).kind === 'loading' && panelView.getVisible(),
    );
    assert.equal(dockView.getVisible(), false, 'new video reveals only RYD');
    await delay(4200);
    assert.equal(
      panelView.getVisible(),
      true,
      'loading is not charged against result display time',
    );
    releaseRatings!();
    await wait(() => getRatings(panelEvent).kind === 'ready');
    await delay(3300);
    assert.equal(
      panelView.getVisible(),
      true,
      'result remains for four seconds',
    );
    const popupBounds = panelView.getBounds();
    cursor = {
      x: win.getContentBounds().x + popupBounds.x + 20,
      y: win.getContentBounds().y + popupBounds.y + 20,
    };
    await delay(1500);
    assert.equal(
      panelView.getVisible(),
      true,
      'hover holds the standalone popup past four seconds',
    );
    assert.equal(
      dockView.getVisible(),
      false,
      'popup hover does not reveal the dock',
    );
    cursor = { x: -10000, y: -10000 };
    await wait(() => !animation.getVisible() && !panelView.getVisible());
    assert.equal(dockView.getVisible(), false);
    await local.executeJavaScript(
      `window.tubevra.setExtensionEnabled({id:'sponsorblock',enabled:false})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(
      await local.executeJavaScript(
        `window.tubevra.getState().then(result=>result.value.extensions.items.find(i=>i.id==='return-youtube-dislike').diagnostics.main.playback)`,
      ),
      'ready',
    );
    assert.equal(
      panelView.getVisible(),
      false,
      'revision renewal for the same film does not replay the popup',
    );
    for (const [status, id, kind] of [
      [404, 'AAAAAAAAAAA', 'empty'],
      [500, 'BBBBBBBBBBB', 'error'],
      [429, 'CCCCCCCCCCC', 'rate-limited'],
    ] as const) {
      await delay(2100); // Replenish the real production token bucket.
      responseStatus = status;
      await remote.executeJavaScript(
        `model.id='${id}';location.hash='/watch?v='+model.id`,
      );
      await wait(() => getRatings(panelEvent).kind === kind);
      assert.equal('likes' in getRatings(panelEvent), false);
      if (status === 404) {
        await wait(() => panelView.getVisible());
        await remote.executeJavaScript(
          'document.documentElement.requestFullscreen()',
          true,
        );
        await wait(
          async () =>
            await local.executeJavaScript(
              'window.tubevra.getState().then(r=>r.value.playbackFullscreen)',
            ),
        );
        assert.equal(panelView.getVisible(), false);
        assert.equal(dockView.getVisible(), false);
        assert.equal(animation.getVisible(), false);
        await remote.executeJavaScript('document.exitFullscreen()');
        await wait(
          async () =>
            !(await local.executeJavaScript(
              'window.tubevra.getState().then(r=>r.value.playbackFullscreen)',
            )),
        );
        await delay(300);
        assert.equal(
          panelView.getVisible(),
          false,
          'fullscreen cancels the popup instead of replaying it',
        );
      }
    }
    await remote.executeJavaScript(`location.hash='/';`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(
      await local.executeJavaScript(
        `window.tubevra.getState().then(result=>result.value.extensions.items.find(i=>i.id==='return-youtube-dislike').diagnostics.main.playback)`,
      ),
      'no-video',
    );
    await local.executeJavaScript(
      `window.tubevra.setExtensionEnabled({id:'return-youtube-dislike',enabled:false})`,
    );
    assert.equal(panelView.getVisible(), false);
    screen.getCursorScreenPoint = originalCursor;
    win.destroy();
    await wait(() => panel.isDestroyed());
    assert.throws(() => getRatings(panelEvent), /Untrusted/);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      process.env.TUBEVRA_TEST_RESULT ?? path.join(output, 'result.json'),
      JSON.stringify({
        passed: true,
        checks: [
          'isolated IPC',
          'zero and paired counts',
          'hover reveal without HTTP',
          'narrow layout',
          'panel hover',
          'settings suppression',
          'disable/enable monotonic version',
          '404/500/429 clear counts',
          'no-video suppression',
          'shared frame displacement and reversal in both layouts',
          'standalone popup: loading then four seconds, hover, same-film renewal',
          'actual HTML fullscreen cancels popup',
          'autoplay during dock motion and resize with delayed local bitmap keep both surfaces visible',
        ],
        nativeHitTesting: false,
        motionSamples,
      }),
    );
    console.log(
      'RYD Electron lifecycle, attribution link and IPC validation passed. No public HTTP performed.',
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

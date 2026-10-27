import { sponsorMainContext } from '../../src/extensions/sponsorblock/main';
import {
  sponsorAvailability,
  sponsorPlayback,
} from '../../src/extensions/sponsorblock/diagnostics';
// Packaged Electron verification: production window, preloads, page adapter and
// private bridge; only the segment service and remote document are test doubles.
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell as systemShell,
  webContents,
} from 'electron';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTVWindow } from '../../src/main/tv-window';
import { UserAgentStore } from '../../src/main/user-agent-store';
import { starts } from '../../src/extensions/main/implementations';
import type { MainExtensionStart } from '../../src/extensions/types';
import type { SegmentResult } from '../../src/extensions/sponsorblock/contracts';

const profile = process.env.TUBEVRA_TEST_PROFILE;
const resultFile = process.env.TUBEVRA_TEST_RESULT;
if (!profile || !resultFile || process.env.TUBEVRA_TEST_PACKAGED !== '1')
  throw Error('Use the isolated packaged extension runner.');
app.setPath('userData', profile);
const checks: string[] = [];
const failures: string[] = [];
const requests: {
  id: string;
  signal: AbortSignal;
  finish?: (value: SegmentResult) => void;
}[] = [];
let mode:
  | 'segments'
  | 'hold'
  | 'error'
  | 'empty'
  | 'busy'
  | 'cached-segments'
  | 'cached-empty' = 'segments';
const segments: SegmentResult = {
  kind: 'segments',
  segments: [
    { start: 2, end: 4, videoDuration: 30 },
    { start: 3.5, end: 5.5, videoDuration: 30 },
  ],
};
const external: string[] = [];
systemShell.openExternal = async (url) => {
  external.push(url);
};
(starts as Record<string, MainExtensionStart>).sponsorblock = (context) => {
  const sponsor = sponsorMainContext(context);
  sponsor.registerSponsorSegments(async (id, signal) => {
    const request: (typeof requests)[number] = { id, signal };
    requests.push(request);
    if (mode === 'hold')
      return new Promise((resolve) => {
        request.finish = resolve;
      });
    // Cache hits leave the last HTTP diagnostic unchanged, as in production.
    if (mode !== 'cached-segments' && mode !== 'cached-empty')
      sponsor.reportSponsorAvailability(
        mode === 'error'
          ? 'network-error'
          : mode === 'busy'
            ? 'busy'
            : 'available',
      );
    return mode === 'error'
      ? { kind: 'network-error' }
      : mode === 'busy'
        ? { kind: 'busy' }
        : mode === 'empty' || mode === 'cached-empty'
          ? { kind: 'empty' }
          : segments;
  });
  return () => {};
};
const audio = Buffer.alloc(44 + 8000 * 2 * 30);
audio.write('RIFF', 0);
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(audio.length - 44, 40);
const fixture = `<!doctype html><style>body{background:#142837;color:white}video{width:400px;height:200px}</style>
<input id="search"><div id="ytlr-player__player-container-player"><video class="html5-main-video" preload="auto" src="/tv/fixture.wav"></video></div>
<script>
location.hash='/watch?v=fixture0001';
window.model={id:'fixture0001',response:'fixture0001',ad:false,live:false,inline:false};
const p=document.getElementById('ytlr-player__player-container-player');
window.video=()=>p.querySelector('video');
p.getVideoData=()=>({video_id:model.id,isLive:model.live,isWindowedLive:false});
p.getPlayerResponse=()=>({videoDetails:{videoId:model.response,isLiveContent:model.live,lengthSeconds:'30'},playabilityStatus:{status:'OK'}});
p.getProgressState=()=>({allowSeeking:true,offset:0});p.isInline=()=>model.inline;p.getAdState=()=>-1;
p.getPlayerState=()=>video().paused?2:1;p.getCurrentTime=()=>video().currentTime;p.getDuration=()=>video().duration;
window.select=(id)=>{model.id=id;model.response=id;location.hash='/watch?v='+id};
window.backCount=0;document.addEventListener('keydown',e=>{if(e.key==='Escape')backCount++});
</script>`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let inspect: (() => Promise<unknown>) | undefined;
async function wait(check: () => Promise<unknown> | unknown, label: string) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(50);
  }
  throw Error(`Timed out: ${label}; ${JSON.stringify(await inspect?.())}`);
}
app
  .whenReady()
  .then(async () => {
    assert.equal(app.isPackaged, true);
    app.on('web-contents-created', (_event, contents) => {
      contents.on('preload-error', (_e, _p, error) =>
        failures.push(String(error)),
      );
    });
    await session
      .fromPartition('persist:tubevra-tv')
      .protocol.handle('https', (request) => {
        if (!new URL(request.url).pathname.endsWith('.wav'))
          return new Response(fixture, {
            headers: { 'content-type': 'text/html' },
          });
        const range = /^bytes=(\d+)-(\d*)$/.exec(
          request.headers.get('range') ?? '',
        );
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2]
          ? Math.min(Number(range[2]), audio.length - 1)
          : audio.length - 1;
        return new Response(audio.subarray(start, end + 1), {
          status: range ? 206 : 200,
          headers: {
            'content-type': 'audio/wav',
            'accept-ranges': 'bytes',
            'content-length': String(end - start + 1),
            ...(range
              ? { 'content-range': `bytes ${start}-${end}/${audio.length}` }
              : {}),
          },
        });
      });
    await createTVWindow(await UserAgentStore.open(profile));
    const win = BrowserWindow.getAllWindows()[0];
    // Native input requires a foreground window, as in the existing UI suite.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    const local = win.webContents;
    const tv = webContents
      .getAllWebContents()
      .find((entry) =>
        entry.getURL().startsWith('https://www.youtube.com/tv'),
      )!;
    const state = async () =>
      (await local.executeJavaScript('window.tubevra.getExtensions()')).value;
    const sponsor = async () =>
      (await state()).items.find(
        (item: { id: string }) => item.id === 'sponsorblock',
      );
    const toggle = async (enabled: boolean) => {
      assert.equal(
        (
          await local.executeJavaScript(
            `window.tubevra.setExtensionEnabled({id:'sponsorblock',enabled:${enabled}})`,
          )
        ).ok,
        true,
      );
      await wait(
        async () =>
          (await sponsor()).status === (enabled ? 'active' : 'disabled'),
        'toggle',
      );
      assert.equal((await sponsor()).reloadRequired, false);
    };
    const run = (code: string) => tv.executeJavaScript(code, true);
    for (const surface of [local, tv]) {
      const preferences = surface.getLastWebPreferences();
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.sandbox, true);
      assert.equal(preferences.webSecurity, true);
      assert.equal(preferences.nodeIntegration, false);
    }
    inspect = async () => ({
      state: await state(),
      requests: requests.map((request) => ({
        id: request.id,
        cancelled: request.signal.aborted,
      })),
      media: await run(
        '({hash:location.hash,time:video().currentTime,duration:video().duration,ready:video().readyState,seeking:video().seeking,paused:video().paused})',
      ),
    });
    await wait(() => run('video().readyState>=2'), 'native media ready');
    assert.deepEqual(
      await run('[typeof window.tubevra,typeof require,typeof process]'),
      ['undefined', 'undefined', 'undefined'],
    );
    const originalURL = tv.getURL();
    await run('video().currentTime=3');
    await toggle(true);
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'ready',
      'segment ready',
    );
    assert.equal(await run('video().currentTime'), 3);
    await run('video().play()');
    await wait(() => run('video().currentTime>=5.5'), 'actual sponsor skip');
    assert.equal(tv.getURL(), originalURL);
    assert.equal(
      (await state()).items.find(
        (item: { id: string }) => item.id === 'adblock',
      ).status,
      'active',
    );
    checks.push(
      'native media skip, pause/resume, overlap union, late enable without reload and Adblock coexistence',
    );
    await run(`
      video().pause();
      window.interruptedSkip = false;
      video().addEventListener('seeking', function interrupt() {
        if (video().currentTime < 5.4) return;
        video().removeEventListener('seeking', interrupt);
        video().pause();
        video().currentTime = 1;
        window.interruptedSkip = true;
      });
      video().currentTime = 3;
      video().play();
    `);
    await wait(
      () =>
        run(
          'window.interruptedSkip && !video().seeking && video().currentTime === 1',
        ),
      'native seek interruption',
    );
    await delay(4500);
    assert.equal(sponsorPlayback(await sponsor()), 'ready');
    assert.equal(await run('video().currentTime'), 1);
    await run('video().currentTime=3;video().play()');
    await wait(
      () => run('video().currentTime>=5.5'),
      'skip after interruption',
    );
    checks.push(
      'native manual seek interruption preserves later skipping beyond the old deadline',
    );
    await run(
      'video().pause();p.classList.add("ad-showing");video().currentTime=3',
    );
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'ad',
      'ad gate',
    );
    await run('video().play()');
    await delay(150);
    assert.ok(await run('video().currentTime<4'));
    await run(
      'video().pause();p.classList.remove("ad-showing");model.live=true',
    );
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'live',
      'live gate',
    );
    await run('model.live=false;model.inline=true');
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'preview',
      'preview gate',
    );
    await run('model.inline=false');
    checks.push(
      'real media clock remains unskipped through synthetic ad/live/preview states',
    );
    mode = 'hold';
    await run('select("fixture0002");video().currentTime=3');
    await wait(
      () => requests.some((request) => request.id === 'fixture0002'),
      'pending next film',
    );
    const stale = requests.find((request) => request.id === 'fixture0002')!;
    mode = 'empty';
    await run('select("fixture0003")');
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'empty',
      'new empty film',
    );
    assert.equal(stale.signal.aborted, true);
    stale.finish!(segments);
    await delay(150);
    assert.equal(await run('video().currentTime'), 3);
    mode = 'error';
    await run('select("fixture0004")');
    await wait(
      async () => sponsorAvailability(await sponsor()) === 'network-error',
      'visible API error',
    );
    assert.equal((await sponsor()).status, 'active');
    assert.equal(await run('video().currentTime'), 3);
    checks.push(
      'same-document transition, stale response cancellation, empty film and recoverable service error',
    );
    mode = 'segments';
    await run('select("fixture0005")');
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'ready',
      'API recovery',
    );
    const count = requests.length;
    await run(
      'video().remove();p.insertAdjacentHTML("beforeend",\'<video class="html5-main-video" preload="auto" src="/tv/fixture.wav"></video>\')',
    );
    await wait(() => run('video().readyState>=2'), 'replacement ready');
    await wait(() => requests.length > count, 'replacement request');
    await run('video().currentTime=3;video().play()');
    await wait(() => run('video().currentTime>=5.5'), 'replacement skip');
    mode = 'hold';
    await run('video().pause();select("fixture0006");video().currentTime=3');
    await wait(
      () => requests.some((request) => request.id === 'fixture0006'),
      'pending disable',
    );
    const disabled = requests.find((request) => request.id === 'fixture0006')!;
    await toggle(false);
    assert.equal(disabled.signal.aborted, true);
    disabled.finish!(segments);
    await run('video().play()');
    await delay(150);
    assert.ok(await run('video().currentTime<4'));
    assert.equal(sponsorPlayback(await sponsor()), null);
    checks.push(
      'video replacement, disable during request, no stale seek or forced reload',
    );
    await run('video().pause()');
    mode = 'empty';
    await toggle(true);
    await local.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    await local.executeJavaScript(
      'document.querySelector("[data-section=extensions]").click()',
    );
    const widgetStatus = () =>
      local.executeJavaScript(`(()=>{
      const row = [...document.querySelectorAll('#panel-extensions .widget-row')]
        .find(row => row.querySelector('strong').textContent === 'SponsorBlock');
      const statuses = row.querySelectorAll('[role=status]');
      return {count: statuses.length, text: statuses[0]?.textContent ?? '', copy: row.textContent};
    })()`);
    await wait(
      async () => (await widgetStatus()).text === 'No sponsor segments',
      'compact empty status',
    );
    assert.equal((await widgetStatus()).count, 1);
    assert.doesNotMatch(
      (await widgetStatus()).copy,
      /Service:|Playback:|Runtime:/,
    );
    await run('location.hash="/"');
    await wait(
      async () => (await widgetStatus()).count === 0,
      'idle SponsorBlock has no waiting text or empty status row',
    );
    assert.doesNotMatch((await widgetStatus()).copy, /Waiting for video/);
    const idleLinkStyle = await local.executeJavaScript(`(() => {
      const link = document.querySelector('.extension-attribution-link');
      const style = getComputedStyle(link);
      return {color: style.color, underlineOffset: style.textUnderlineOffset};
    })()`);
    assert.equal(idleLinkStyle.color, 'rgb(148, 153, 166)');
    assert.equal(idleLinkStyle.underlineOffset, '3px');
    writeFileSync(
      path.resolve('out/verification/sponsorblock-settings.png'),
      (await local.capturePage()).toPNG(),
    );
    await run('select("fixture0006")');
    await wait(
      async () => (await widgetStatus()).text === 'No sponsor segments',
      'playback status returns after leaving idle',
    );
    mode = 'error';
    await run('select("fixture0008")');
    await wait(
      async () => (await widgetStatus()).text === 'Network error',
      'compact service error',
    );
    assert.equal((await widgetStatus()).count, 1);
    mode = 'cached-empty';
    await run('select("fixture0009")');
    await wait(
      async () => (await widgetStatus()).text === 'No sponsor segments',
      'cached empty result overrides a historical network error',
    );
    assert.equal(sponsorAvailability(await sponsor()), 'network-error');
    mode = 'busy';
    await run('select("fixture0010")');
    await wait(
      async () =>
        (await widgetStatus()).text === 'Temporarily busy. Try later.',
      'current busy request stays visible',
    );
    mode = 'cached-segments';
    await run('select("fixture0011")');
    await wait(
      async () => (await widgetStatus()).text === 'Ready',
      'cached segments override historical busy status',
    );
    assert.equal(sponsorAvailability(await sponsor()), 'busy');
    mode = 'hold';
    await run('select("fixture0012")');
    await wait(
      async () => (await widgetStatus()).text === 'Loading segments…',
      'pending film clears stale ready and historical busy status',
    );
    const pendingStatus = requests.find(
      (request) => request.id === 'fixture0012',
    )!;
    mode = 'error';
    await run('select("fixture0013")');
    await wait(
      async () => (await widgetStatus()).text === 'Network error',
      'new request failure remains visible after cached success',
    );
    assert.equal(pendingStatus.signal.aborted, true);
    pendingStatus.finish!(segments);
    await delay(150);
    assert.equal((await widgetStatus()).text, 'Network error');
    mode = 'empty';
    await run('select("fixture0014")');
    await wait(
      async () => (await widgetStatus()).text === 'No sponsor segments',
      'fresh request recovery',
    );
    checks.push(
      'current playback and pending requests override historical service errors; current failures stay visible',
    );
    const handler = (ipcMain as any)._invokeHandlers.get(
      'tubevra:open-sponsorblock',
    );
    for (const event of [
      { sender: tv, senderFrame: tv.mainFrame },
      { sender: local, senderFrame: { url: local.getURL() } },
    ])
      await assert.rejects(async () => handler(event), /Untrusted/);
    assert.equal(
      (
        await handler(
          { sender: local, senderFrame: local.mainFrame },
          'https://example.com',
        )
      ).ok,
      false,
    );
    const rect = await local.executeJavaScript(
      `(()=>{const link=document.querySelector('.extension-attribution-link');link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    win.focus();
    local.focus();
    for (const type of ['mouseDown', 'mouseUp'] as const)
      local.sendInputEvent({ type, ...rect, button: 'left', clickCount: 1 });
    await wait(() => external.length === 1, 'mouse link');
    await local.executeJavaScript(
      'document.querySelector(".extension-attribution-link").focus()',
    );
    // A playback diagnostic redraw must preserve the focused link.
    await run('model.live=true');
    await wait(
      async () => sponsorPlayback(await sponsor()) === 'live',
      'diagnostic redraw',
    );
    await wait(
      async () =>
        (await widgetStatus()).text ===
        'Skipping paused: live or unknown stream',
      'compact player status',
    );
    assert.equal(
      await local.executeJavaScript('document.activeElement.className'),
      'extension-attribution-link',
    );
    local.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    local.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await wait(() => external.length === 2, 'keyboard link');
    assert.deepEqual(external, [
      'https://sponsor.ajay.app/',
      'https://sponsor.ajay.app/',
    ]);
    systemShell.openExternal = async () => {
      throw Error('Browser unavailable');
    };
    await local.executeJavaScript(
      'document.querySelector(".extension-attribution-link").click()',
    );
    await wait(
      () =>
        local.executeJavaScript(
          'document.querySelector("#panel-extensions").textContent.includes("Could not open SponsorBlock.")',
        ),
      'visible external browser error',
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(profile, 'extensions.json'), 'utf8'))
        .enabled.sponsorblock,
      true,
    );
    assert.match(
      await local.executeJavaScript(
        'document.querySelector("#panel-extensions").textContent',
      ),
      /\(Using SponsorBlock\)/,
    );
    checks.push(
      'fixed external URL, sender/arity rejection, native mouse and Enter activation, focus preservation and attribution',
    );
    await local.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    win.focus();
    tv.focus();
    await wait(() => win.isFocused(), 'native window focus');
    await wait(() => tv.isFocused(), 'TV focus after closing settings');
    const rightClick = async (position = { x: 600, y: 400 }) => {
      for (const type of ['mouseDown', 'mouseUp'] as const)
        tv.sendInputEvent({
          type,
          ...position,
          button: 'right',
          clickCount: 1,
        });
      await delay(150);
    };
    await run('document.querySelector("#search").focus()');
    await wait(
      () =>
        run(
          'document.hasFocus() && document.activeElement === document.querySelector("#search")',
        ),
      'text input focus',
    );
    tv.sendInputEvent({ type: 'char', keyCode: 'a' });
    await wait(
      () => run('document.querySelector("#search").value === "a"'),
      'native text input',
    );
    await rightClick(
      await run(
        '(()=>{const r=document.querySelector("#search").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()',
      ),
    );
    assert.equal(await run('document.querySelector("#search").value'), 'a');
    assert.equal(await run('backCount'), 0);
    await run(
      'document.activeElement.blur();document.dispatchEvent(new CompositionEvent("compositionstart"))',
    );
    await rightClick();
    assert.equal(await run('backCount'), 0);
    await run('document.dispatchEvent(new CompositionEvent("compositionend"))');
    await rightClick();
    await wait(() => run('backCount===1'), 'TV right-click Back');
    await run('video().requestFullscreen()');
    await wait(
      async () =>
        (await local.executeJavaScript('window.tubevra.getState()')).value
          .playbackFullscreen,
      'fullscreen',
    );
    await run('document.exitFullscreen()');
    await wait(
      async () =>
        !(await local.executeJavaScript('window.tubevra.getState()')).value
          .playbackFullscreen,
      'exit fullscreen',
    );
    checks.push(
      'settings reopen, ordinary text input, simulated IME, TV right-click Back and native fullscreen',
    );
    await toggle(false);
    mode = 'hold';
    await run('model.live=false;select("fixture0007")');
    await toggle(true);
    await wait(
      () => requests.some((request) => request.id === 'fixture0007'),
      'document close request',
    );
    const closing = requests.find((request) => request.id === 'fixture0007')!;
    tv.close();
    await wait(() => closing.signal.aborted, 'document request aborted');
    closing.finish!(segments);
    checks.push('document destruction cancels pending work');
    assert.deepEqual(failures, []);
    writeFileSync(
      resultFile,
      JSON.stringify(
        {
          passed: true,
          environment: 'packaged-fixture-electron',
          checks,
          failures,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ checks }, null, 2));
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    writeFileSync(
      resultFile,
      JSON.stringify(
        { passed: false, checks, failures, error: String(error) },
        null,
        2,
      ),
    );
    app.exit(1);
  });

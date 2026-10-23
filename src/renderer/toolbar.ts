import type { AppState } from '../shared/api';

export function mountToolbar(root: HTMLElement) {
  document.body.className = 'toolbar-page';
  root.innerHTML = `<nav class="toolbar" aria-label="Tubevra">
    <button id="back" type="button" title="Back in YouTube TV" aria-label="Back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13"/></svg><span>Back</span>
    </button>
    <button id="home" type="button" title="YouTube TV home" aria-label="Home">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/></svg><span>Home</span>
    </button>
    <button id="settings" type="button" title="Tubevra settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/></svg><span>Settings</span>
    </button>
  </nav>`;
  const back = root.querySelector<HTMLButtonElement>('#back')!;
  const home = root.querySelector<HTMLButtonElement>('#home')!;
  const settings = root.querySelector<HTMLButtonElement>('#settings')!;
  let busy = false;
  let current: AppState | null = null;
  function render(state: AppState) {
    current = state;
    back.disabled =
      busy || (!state.settingsOpen && (state.loading || !!state.error));
    home.disabled = busy || state.loading;
    settings.disabled = busy;
    settings.setAttribute('aria-pressed', String(state.settingsOpen));
  }
  async function run(action: () => ReturnType<typeof window.tubevra.navigate>) {
    if (busy) return;
    busy = true;
    if (current) render(current);
    try {
      const result = await action();
      if (result.ok === false) {
        await window.tubevra.setSettingsOpen(true);
      } else render(result.value);
    } catch {
      root.textContent = 'Tubevra is unavailable.';
    } finally {
      busy = false;
      if (current) render(current);
    }
  }
  back.addEventListener('click', () => {
    if (current?.settingsOpen) {
      void run(() => window.tubevra.setSettingsOpen(false));
    } else {
      void run(() => window.tubevra.navigate('back'));
    }
  });
  home.addEventListener('click', () => {
    void run(async () => {
      if (current?.settingsOpen) {
        await window.tubevra.setSettingsOpen(false);
      }
      return window.tubevra.navigate('home');
    });
  });
  settings.addEventListener('click', () => {
    void run(() => window.tubevra.setSettingsOpen(!current?.settingsOpen));
  });
  window.tubevra.onStateChanged(render);
  window.tubevra
    .getState()
    .then((result) => {
      if (result.ok === true) render(result.value);
      else root.textContent = result.error;
    })
    .catch(() => {
      root.textContent = 'Tubevra is unavailable.';
    });
}

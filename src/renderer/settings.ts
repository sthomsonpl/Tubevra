import type { AppState, Result, UserAgentCommand } from '../shared/api';
import { PROJECT_GITHUB_URL } from '../shared/api';
import { mountExtensions } from './extensions/settings';
import { createWidgetToggle } from './widgets';

type SectionId = 'general' | 'tv' | 'user-agents' | 'extensions' | 'about';
type PresetTab = 'default' | 'user';

const SECTION_META: Record<SectionId, { title: string; subtitle: string }> = {
  about: {
    title: 'About',
    subtitle: 'Application version and project information.',
  },
  extensions: {
    title: 'Add-ons',
    subtitle: 'Manage built-in add-ons for YouTube TV.',
  },
  general: {
    title: 'General',
    subtitle: 'Application preferences and quick actions.',
  },
  tv: {
    title: 'TV',
    subtitle: 'YouTube Leanback interface settings.',
  },
  'user-agents': {
    title: 'User Agents',
    subtitle: 'Choose how Tubevra identifies itself to YouTube TV.',
  },
};

const PRESET_HINTS: Record<
  string,
  { kind: 'console' | 'tv' | 'box'; sub: string }
> = {
  ps4: { kind: 'console', sub: 'Console • Leanback Shell' },
  xbox: { kind: 'console', sub: 'Console • Cobalt Engine' },
  cobalt: { kind: 'box', sub: 'Chromecast • Android TV 14' },
  tizen: { kind: 'tv', sub: 'Samsung Smart TV • Tizen 7.0' },
  lg_webos: { kind: 'tv', sub: 'LG Smart TV • webOS' },
  firetv: { kind: 'box', sub: 'Amazon Fire TV • Fire OS' },
  apple_tv: { kind: 'box', sub: 'Apple TV • tvOS 17' },
};

function createDeviceIcon(presetId: string, builtIn: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const kind = builtIn ? (PRESET_HINTS[presetId]?.kind ?? 'tv') : 'custom';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (kind === 'console') {
    path.setAttribute(
      'd',
      'M6 9h12a4 4 0 0 1 3.9 4.9l-.7 3A2.5 2.5 0 0 1 18.8 19c-.7 0-1.4-.3-1.8-.8L15.2 16H8.8L7 18.2c-.4.5-1.1.8-1.8.8a2.5 2.5 0 0 1-2.4-2.1l-.7-3A4 4 0 0 1 6 9Zm2 2.5v3M6.5 13h3m6-.5h.01m2 1.5h.01',
    );
  } else if (kind === 'box') {
    path.setAttribute(
      'd',
      'M4 8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm4 7h4m4 0h.01',
    );
  } else if (kind === 'custom') {
    path.setAttribute('d', 'm8 9-4 3 4 3m8-6 4 3-4 3m-2-8-4 10');
  } else {
    path.setAttribute(
      'd',
      'M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5v-9ZM8 21h8',
    );
  }
  svg.append(path);
  return svg;
}

export function mountSettings(root: HTMLElement) {
  document.body.className = 'settings-page';
  root.innerHTML = `<main class="app-shell">
    <section id="connection" class="connection" aria-labelledby="connection-title">
      <div class="connection-card">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="3"/><path d="m10 9.5 5 3-5 3v-6Z"/><path d="M8 21h8"/></svg>
          </span>
          <span class="brand-text">Tubevra</span>
          <span class="brand-pill">TV Mode</span>
        </div>
        <h1 id="connection-title">Your big-screen YouTube.</h1>
        <p id="connection-status" class="connection-status" role="status">Connecting to YouTube TV…</p>
        <div class="actions">
          <button id="retry" class="primary" type="button">Try again</button>
          <button id="open-settings" class="secondary" type="button">Settings</button>
        </div>
      </div>
    </section>

    <section id="settings-screen" class="settings-screen" aria-labelledby="settings-title" hidden>
      <div class="settings-frame">
        <aside class="settings-sidebar" aria-label="Settings navigation">
          <div class="sidebar-top">
            <div class="brand">
              <span class="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="3"/><path d="m10 9.5 5 3-5 3v-6Z"/><path d="M8 21h8"/></svg>
              </span>
              <div class="brand-copy">
                <span class="brand-text">Tubevra</span>
                <span class="brand-sub">Settings</span>
              </div>
            </div>

            <nav class="sidebar-nav" aria-label="Settings sections">
              <button type="button" class="nav-item" data-section="general" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/></svg>
                </span>
                <span>General</span>
              </button>
              <button type="button" class="nav-item" data-section="tv" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M8 21h8"/></svg>
                </span>
                <span>TV</span>
              </button>
              <button type="button" class="nav-item is-current" data-section="user-agents" aria-current="page">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V7l-8-4Z"/><path d="m9.5 12 1.8 1.8 3.7-3.8"/></svg>
                </span>
                <span>User Agents</span>
                <span id="preset-count" class="nav-badge"></span>
              </button>
              <button type="button" class="nav-item" data-section="extensions" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4h2a3 3 0 0 1 0 6H3v4a2 2 0 0 0 2 2h4v-2a3 3 0 0 1 6 0v2h4a2 2 0 0 0 2-2v-4h-2a3 3 0 0 1 0-6h2V5a2 2 0 0 0-2-2h-4v2a3 3 0 0 1-6 0V3Z"/></svg>
                </span>
                <span>Add-ons</span>
              </button>
              <button type="button" class="nav-item" data-section="about" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>
                </span>
                <span>About</span>
              </button>
            </nav>
          </div>

          <div class="sidebar-footer">
            <div class="active-summary" aria-label="Active User-Agent">
              <div class="active-summary-top">
                <span class="live-dot" aria-hidden="true"></span>
                <span class="active-summary-label">Active preset</span>
                <span id="loading-note" class="loading-pill">TV Mode</span>
              </div>
              <strong id="active-name" class="active-summary-name">—</strong>
            </div>
          </div>
        </aside>

        <div class="settings-workspace">
          <header class="workspace-header">
            <div class="settings-heading">
              <h1 id="settings-title">User Agents</h1>
              <p id="section-subtitle" class="heading-subtitle">Choose how Tubevra identifies itself to YouTube TV.</p>
            </div>
            <button id="done" class="secondary done-button" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              <span>Back to TV</span>
            </button>
          </header>

          <p id="service-error" class="error-banner" role="alert" hidden></p>

          <div id="panel-extensions" class="section-panel" hidden></div>
          <div id="panel-about" class="section-panel" hidden>
            <div class="widget-box">
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>
                </span>
                <div class="row-copy">
                  <strong>Tubevra</strong>
                  <p>Version <span id="app-version">—</span></p>
                </div>
              </div>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M9 15 15 9m-5-3 1-1a5 5 0 0 1 7 7l-1 1m-3 5-1 1a5 5 0 0 1-7-7l1-1"/></svg>
                </span>
                <div class="row-copy">
                  <strong>GitHub</strong>
                  <p>sthomsonpl/Tubevra</p>
                </div>
                <a id="project-github" class="secondary compact-btn project-link" href="${PROJECT_GITHUB_URL}" aria-label="Open Tubevra on GitHub in your browser">Open GitHub ↗</a>
              </div>
            </div>
            <p id="about-feedback" class="feedback error" role="alert"></p>
          </div>
          <div id="panel-general" class="section-panel" hidden>
            <div class="widget-box">
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                </span>
                <div class="row-copy">
                  <strong>Hardware acceleration</strong>
                  <p id="hardware-acceleration-description">Enable hardware acceleration. Requires a restart.</p>
                </div>
                <span id="hardware-acceleration-control"></span>
              </div>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </span>
                <div class="row-copy">
                  <strong>Reload YouTube TV</strong>
                  <p>Reload the main Leanback interface while keeping your session</p>
                </div>
                <button id="reload-home" class="secondary compact-btn" type="button">Reload</button>
              </div>
            </div>
            <p id="general-feedback" class="feedback" role="status" aria-live="polite"></p>
            <div id="general-restart" class="widget-box general-restart" hidden>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>
                </span>
                <div class="row-copy">
                  <strong>Restart required</strong>
                  <p role="status">Restart Tubevra to apply the hardware acceleration setting.</p>
                </div>
                <button id="restart-app" class="secondary compact-btn" type="button">Restart Tubevra</button>
              </div>
            </div>
          </div>

          <div id="panel-tv" class="section-panel" hidden>
            <div class="widget-box">
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V7l-8-4Z"/><path d="m9.5 12 1.8 1.8 3.7-3.8"/></svg>
                </span>
                <div class="row-copy">
                  <strong>User-Agent Identity</strong>
                  <p id="tv-active-ua">Active: —</p>
                </div>
                <button id="go-user-agents" class="primary compact-btn" type="button">Configure</button>
              </div>
            </div>
          </div>

          <div id="panel-user-agents" class="section-panel ua-panel">
            <div class="settings-layout">
              <aside class="widget-box presets-panel" aria-label="User-Agent presets">
                <div class="presets-toolbar">
                  <div class="segmented-switch" role="tablist" aria-label="Preset category">
                    <button id="tab-default" type="button" class="seg-btn is-selected" data-tab="default" role="tab" aria-selected="true">
                      <span>Default</span>
                      <small id="default-count"></small>
                    </button>
                    <button id="tab-user" type="button" class="seg-btn" data-tab="user" role="tab" aria-selected="false">
                      <span>User</span>
                      <small id="user-count"></small>
                    </button>
                  </div>
                  <button id="new-preset" class="new-preset-button" type="button" title="Add custom preset">+ Add</button>
                </div>

                <div id="preset-list" class="preset-list-container">
                  <div id="default-preset-list" class="preset-scroll"></div>
                  <div id="user-preset-list" class="preset-scroll" hidden></div>
                </div>
              </aside>

              <section class="widget-box preset-details" aria-labelledby="detail-title">
                <div class="inspector-top">
                  <div class="inspector-identity">
                    <span id="inspector-icon" class="row-icon" aria-hidden="true"></span>
                    <div class="inspector-title-block">
                      <div class="detail-meta-row">
                        <h2 id="detail-title">—</h2>
                        <span id="active-badge" class="status-chip chip-active" hidden>
                          <span class="live-dot" aria-hidden="true"></span>
                          Active
                        </span>
                      </div>
                      <div class="inspector-sub-row">
                        <span id="preset-kind" class="meta-label">Default preset</span>
                        <span id="readonly-badge" class="readonly-pill" hidden>Read-only</span>
                      </div>
                    </div>
                  </div>
                  <button id="apply-preset" class="primary apply-btn" type="button">Apply preset</button>
                </div>

                <form id="preset-form">
                  <fieldset id="editor-fields">
                    <div class="form-row">
                      <label for="preset-name">Name</label>
                      <input id="preset-name" name="name" maxlength="100" required autocomplete="off" spellcheck="false" />
                    </div>
                    <div class="form-row form-row-grow">
                      <label for="preset-value">User-Agent string</label>
                      <textarea id="preset-value" name="userAgent" rows="4" maxlength="4096" required autocomplete="off" spellcheck="false"></textarea>
                    </div>
                    <div class="inspector-bottom">
                      <p id="editor-note" class="field-note"></p>
                      <div class="editor-actions">
                        <button id="delete-preset" class="danger-text" type="button" hidden>Delete preset</button>
                        <button id="discard" class="secondary" type="button" hidden>Discard changes</button>
                        <button id="save-preset" class="primary" type="submit">Save changes</button>
                      </div>
                    </div>
                  </fieldset>
                </form>

                <p id="feedback" class="feedback" role="status" aria-live="polite"></p>

                <section id="delete-confirmation" class="delete-confirmation" aria-label="Confirm deletion" hidden>
                  <div class="delete-header">
                    <h3>Delete this preset?</h3>
                    <p id="delete-note"></p>
                  </div>
                  <label id="replacement-label" for="replacement">Replacement preset</label>
                  <select id="replacement"><option value="">Choose a replacement…</option></select>
                  <div class="actions">
                    <button id="confirm-delete" class="danger" type="button">Delete preset</button>
                    <button id="cancel-delete" class="secondary" type="button">Cancel</button>
                  </div>
                </section>
              </section>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>`;
  const element = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const name = element<HTMLInputElement>('preset-name');
  const hardwareAcceleration = createWidgetToggle(
    'hardware acceleration',
    true,
  );
  hardwareAcceleration.input.id = 'hardware-acceleration';
  hardwareAcceleration.input.setAttribute(
    'aria-describedby',
    'hardware-acceleration-description',
  );
  element('hardware-acceleration-control').append(hardwareAcceleration.label);
  const extensions = mountExtensions(element('panel-extensions'));
  const value = element<HTMLTextAreaElement>('preset-value');
  const form = element<HTMLFormElement>('preset-form');
  const feedback = element('feedback');
  const replacement = element<HTMLSelectElement>('replacement');
  let current: AppState | null = null;
  let selectedId: string | null = null;
  let creating = false;
  let dirty = false;
  let busy = false;
  let activeSection: SectionId = 'user-agents';
  let activeTab: PresetTab = 'default';
  const selected = () =>
    current?.userAgents.presets.find((preset) => preset.id === selectedId);

  function showSection(section: SectionId) {
    activeSection = section;
    const meta = SECTION_META[section];
    element('settings-title').textContent = meta.title;
    element('section-subtitle').textContent = meta.subtitle;
    element('panel-general').hidden = section !== 'general';
    element('panel-tv').hidden = section !== 'tv';
    element('panel-extensions').hidden = section !== 'extensions';
    element('panel-about').hidden = section !== 'about';
    element('panel-user-agents').hidden = section !== 'user-agents';
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '.nav-item[data-section]',
    )) {
      const isCurrent = button.dataset.section === section;
      button.classList.toggle('is-current', isCurrent);
      button.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    }
  }

  function showTab(tab: PresetTab) {
    activeTab = tab;
    element('default-preset-list').hidden = tab !== 'default';
    element('user-preset-list').hidden = tab !== 'user';
    for (const btn of root.querySelectorAll<HTMLButtonElement>(
      '.seg-btn[data-tab]',
    )) {
      const isSelected = btn.dataset.tab === tab;
      btn.classList.toggle('is-selected', isSelected);
      btn.setAttribute('aria-selected', String(isSelected));
    }
  }

  function message(text: string, failure = false) {
    feedback.textContent = text;
    feedback.classList.toggle('error', failure);
  }
  function controls() {
    const preset = selected();
    const active = preset?.id === current?.userAgents.activeId;
    element<HTMLFieldSetElement>('editor-fields').disabled = busy;
    element<HTMLButtonElement>('new-preset').disabled = busy || dirty;
    element<HTMLButtonElement>('tab-default').disabled = busy || dirty;
    element<HTMLButtonElement>('tab-user').disabled = busy || dirty;
    element<HTMLButtonElement>('apply-preset').disabled =
      busy || dirty || !preset || active;
    element('apply-preset').textContent = active
      ? 'Active preset'
      : 'Apply preset';
    element<HTMLButtonElement>('save-preset').disabled =
      busy || (!creating && !dirty);
    element('save-preset').hidden = !!preset?.builtIn;
    element('discard').hidden = !dirty;
    element('active-badge').hidden = !active;
    element('readonly-badge').hidden = !preset?.builtIn;
    element('delete-preset').hidden = !preset || preset.builtIn || creating;
    element<HTMLButtonElement>('delete-preset').disabled = busy || dirty;
    element<HTMLButtonElement>('done').disabled = busy;
    element<HTMLButtonElement>('reload-home').disabled = busy;
    hardwareAcceleration.input.disabled = busy || !current;
    hardwareAcceleration.input.checked =
      current?.general.hardwareAcceleration ?? true;
    element<HTMLButtonElement>('restart-app').disabled = busy || dirty;
    element<HTMLButtonElement>('confirm-delete').disabled =
      busy || (active && !replacement.value);
    element<HTMLButtonElement>('cancel-delete').disabled = busy;
    replacement.disabled = busy;
    for (const button of element(
      'preset-list',
    ).querySelectorAll<HTMLButtonElement>('button.preset-option'))
      button.disabled = busy || dirty;
  }
  function list() {
    if (!current) return;
    const defaultContainer = element('default-preset-list');
    const userContainer = element('user-preset-list');
    defaultContainer.replaceChildren();
    userContainer.replaceChildren();

    const builtIns = current.userAgents.presets.filter((p) => p.builtIn);
    const customs = current.userAgents.presets.filter((p) => !p.builtIn);

    element('preset-count').textContent = String(
      current.userAgents.presets.length,
    );
    element('default-count').textContent = String(builtIns.length);
    element('user-count').textContent = String(customs.length);

    const makeOption = (preset: AppState['userAgents']['presets'][number]) => {
      const isActive = preset.id === current!.userAgents.activeId;
      const isSelected = !creating && preset.id === selectedId;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-option';
      button.classList.toggle('is-active', isActive);
      button.dataset.presetId = preset.id;
      button.setAttribute('aria-pressed', String(isSelected));

      const iconWrap = document.createElement('span');
      iconWrap.className = 'preset-icon';
      iconWrap.append(createDeviceIcon(preset.id, preset.builtIn));

      const copy = document.createElement('span');
      copy.className = 'preset-copy';
      const label = document.createElement('span');
      label.className = 'preset-option-name';
      label.textContent = preset.name;
      const sub = document.createElement('span');
      sub.className = 'preset-option-sub';
      sub.textContent = preset.builtIn
        ? (PRESET_HINTS[preset.id]?.sub ?? 'Default device')
        : 'Custom User-Agent';
      copy.append(label, sub);

      const meta = document.createElement('small');
      meta.className = isActive ? 'preset-tag is-active' : 'preset-tag';
      meta.textContent = isActive
        ? 'Active'
        : preset.builtIn
          ? 'Default'
          : 'User';

      button.append(iconWrap, copy, meta);
      button.addEventListener('click', () => showPreset(preset.id));
      return button;
    };

    for (const preset of builtIns) {
      defaultContainer.append(makeOption(preset));
    }

    if (customs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-user-list';
      empty.textContent = creating
        ? 'Creating new user preset…'
        : 'No user presets yet. Click + Add above.';
      userContainer.append(empty);
    } else {
      for (const preset of customs) {
        userContainer.append(makeOption(preset));
      }
    }
  }
  function showPreset(id: string | null) {
    selectedId = id;
    creating = id === null;
    dirty = false;
    const preset = selected();
    if (creating || (preset && !preset.builtIn)) {
      showTab('user');
    } else if (preset?.builtIn) {
      showTab('default');
    }
    name.value = preset?.name ?? '';
    value.value = preset?.userAgent ?? '';
    name.readOnly = value.readOnly = !!preset?.builtIn;
    element('detail-title').textContent = preset?.name ?? 'New preset';
    element('preset-kind').textContent = creating
      ? 'User preset (new)'
      : preset?.builtIn
        ? (PRESET_HINTS[preset.id]?.sub ?? 'Default preset')
        : 'User preset';
    const inspectorIcon = element('inspector-icon');
    inspectorIcon.replaceChildren(
      createDeviceIcon(preset?.id ?? 'custom', !!preset?.builtIn),
    );
    element('editor-note').textContent = preset?.builtIn
      ? 'Default preset is read-only.'
      : 'Saving an active preset reloads YouTube TV.';
    element('delete-confirmation').hidden = true;
    message('');
    list();
    controls();
    if (creating) name.focus();
  }
  function render(state: AppState) {
    const wasOpen = current?.settingsOpen;
    current = state;
    element('general-restart').hidden = !state.general.restartRequired;
    element('app-version').textContent = state.version;
    extensions.render(state.extensions);
    const showConnection =
      !state.settingsOpen && (state.loading || !!state.error);
    element('connection').hidden = !showConnection;
    element('settings-screen').hidden = showConnection;
    element('settings-screen').classList.toggle('is-open', state.settingsOpen);
    element('connection-status').textContent =
      state.error ??
      (state.loading ? 'Connecting to YouTube TV…' : 'Ready to watch.');
    element<HTMLButtonElement>('retry').disabled = state.loading || busy;
    element('service-error').hidden = !state.error;
    element('service-error').textContent = state.error ?? '';
    element('loading-note').textContent = state.loading
      ? 'Reloading…'
      : 'TV Mode';
    const activeName =
      state.userAgents.presets.find(
        (preset) => preset.id === state.userAgents.activeId,
      )?.name ?? state.userAgents.activeId;
    element('active-name').textContent = activeName;
    element('tv-active-ua').textContent = `Active: ${activeName}`;
    if (!selectedId && !creating) showPreset(state.userAgents.activeId);
    else {
      list();
      controls();
    }
    if (state.settingsOpen && !wasOpen) {
      showSection(activeSection);
      showTab(activeTab);
      element<HTMLButtonElement>('done').focus();
    }
  }
  async function run(
    action: () => Promise<Result<AppState>>,
    success?: (state: AppState) => void,
    successMessage = '',
    output = feedback,
  ) {
    if (busy) return;
    const report = (text: string, failure = false) => {
      output.textContent = text;
      output.classList.toggle('error', failure);
    };
    busy = true;
    controls();
    report('Working…');
    try {
      const result = await action();
      if (result.ok === false) report(result.error, true);
      else {
        render(result.value);
        success?.(result.value);
        if (successMessage && result.value.error) {
          report(
            'Saved. YouTube TV could not reload. See the error above.',
            true,
          );
        } else report(successMessage);
      }
    } catch {
      report('Cannot communicate with Tubevra. Your form has been kept.', true);
    } finally {
      busy = false;
      controls();
    }
  }
  const mutate = (
    command: UserAgentCommand,
    success?: (state: AppState) => void,
  ) => run(() => window.tubevra.updateUserAgents(command), success, 'Saved.');
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '.nav-item[data-section]',
  )) {
    button.addEventListener('click', () => {
      const target = button.dataset.section as SectionId | undefined;
      if (target) showSection(target);
    });
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>(
    '.seg-btn[data-tab]',
  )) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as PresetTab | undefined;
      if (!tab) return;
      showTab(tab);
      if (tab === 'user') {
        const firstCustom = current?.userAgents.presets.find((p) => !p.builtIn);
        if (firstCustom && selected()?.builtIn) showPreset(firstCustom.id);
      } else {
        const firstBuiltIn = current?.userAgents.presets.find((p) => p.builtIn);
        if (firstBuiltIn && !selected()?.builtIn) showPreset(firstBuiltIn.id);
      }
    });
  }
  element('go-user-agents').addEventListener('click', () =>
    showSection('user-agents'),
  );
  element('project-github').addEventListener('click', async (event) => {
    event.preventDefault();
    element('about-feedback').textContent = '';
    try {
      const result = await window.tubevra.openProjectGitHub();
      if (!result.ok) element('about-feedback').textContent = result.error;
    } catch {
      element('about-feedback').textContent =
        'Cannot communicate with Tubevra.';
    }
  });
  element('reload-home').addEventListener('click', () => {
    void run(() => window.tubevra.navigate('home'));
  });
  hardwareAcceleration.input.addEventListener('change', () => {
    const enabled = hardwareAcceleration.input.checked;
    void run(
      () => window.tubevra.setHardwareAcceleration(enabled),
      undefined,
      '',
      element('general-feedback'),
    );
  });
  element('restart-app').addEventListener('click', () => {
    void run(
      () => window.tubevra.restartApp(),
      undefined,
      '',
      element('general-feedback'),
    );
  });
  form.addEventListener('input', () => {
    dirty = true;
    message('Save or discard changes before choosing another preset.');
    controls();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity() || selected()?.builtIn) return;
    const ids = new Set(current?.userAgents.presets.map((preset) => preset.id));
    const command: UserAgentCommand = creating
      ? { type: 'add', name: name.value, userAgent: value.value }
      : {
          type: 'edit',
          id: selectedId!,
          name: name.value,
          userAgent: value.value,
        };
    void mutate(command, (state) =>
      showPreset(
        creating
          ? state.userAgents.presets.find((preset) => !ids.has(preset.id))!.id
          : selectedId,
      ),
    );
  });
  element('new-preset').addEventListener('click', () => showPreset(null));
  element('discard').addEventListener('click', () =>
    showPreset(creating ? current!.userAgents.activeId : selectedId),
  );
  element('apply-preset').addEventListener('click', () => {
    if (selectedId) void mutate({ type: 'select', id: selectedId });
  });
  element('delete-preset').addEventListener('click', () => {
    const active = selectedId === current?.userAgents.activeId;
    replacement.replaceChildren(new Option('Choose a replacement…', ''));
    for (const preset of current!.userAgents.presets)
      if (preset.id !== selectedId)
        replacement.add(new Option(preset.name, preset.id));
    replacement.hidden = element('replacement-label').hidden = !active;
    element('delete-note').textContent = active
      ? 'This preset is active. Choose its replacement explicitly before deleting.'
      : 'This removes the custom preset from this device.';
    element('delete-confirmation').hidden = false;
    controls();
    (active
      ? replacement
      : element<HTMLButtonElement>('cancel-delete')
    ).focus();
  });
  replacement.addEventListener('change', controls);
  element('cancel-delete').addEventListener('click', () => {
    element('delete-confirmation').hidden = true;
    element('delete-preset').focus();
  });
  element('confirm-delete').addEventListener('click', () => {
    if (!selectedId) return;
    void mutate(
      {
        type: 'remove',
        id: selectedId,
        ...(replacement.value ? { replacementId: replacement.value } : {}),
      },
      (state) => showPreset(state.userAgents.activeId),
    );
  });
  element('done').addEventListener('click', () => {
    void run(() => window.tubevra.setSettingsOpen(false));
  });
  element('open-settings').addEventListener('click', () => {
    void run(() => window.tubevra.setSettingsOpen(true));
  });
  element('retry').addEventListener('click', () => {
    void run(() => window.tubevra.navigate('home'));
  });
  window.tubevra.onStateChanged(render);
  window.tubevra
    .getState()
    .then((result) => {
      if (result.ok === true) render(result.value);
      else element('connection-status').textContent = result.error;
    })
    .catch(() => {
      element('connection-status').textContent =
        'Cannot communicate with Tubevra.';
    });
}

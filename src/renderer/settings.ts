import type {
  AppState,
  Result,
  SettingsSection,
  UserAgentCommand,
} from '../shared/api';
import { PROJECT_GITHUB_URL, PRIVACY_POLICY_URL } from '../shared/api';
import { mountExtensions } from './extensions/settings';
import { createWidgetToggle } from './widgets';
import { mountCodecSettings } from './codec-settings';
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  isLanguagePreference,
} from '../shared/i18n/language';
import type { Localization } from './localization';

const tubevraIcon = new URL('../../assets/icon/icon.ico', import.meta.url).href;

type PresetTab = 'default' | 'user';

const SECTION_KEYS: Record<SettingsSection, string> = {
  about: 'settings.about',
  extensions: 'addons',
  general: 'settings.general',
  tv: 'settings.tv',
  'user-agents': 'presets',
};

const PRESET_KINDS: Record<string, 'console' | 'tv' | 'box'> = {
  ps4: 'console',
  xbox: 'console',
  cobalt: 'box',
  tizen: 'tv',
  lg_webos: 'tv',
  firetv: 'box',
  apple_tv: 'box',
};

function createDeviceIcon(presetId: string, builtIn: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const kind = builtIn ? (PRESET_KINDS[presetId] ?? 'tv') : 'custom';
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

export function mountSettings(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  document.body.className = 'settings-page';
  root.innerHTML = `<main class="app-shell">
    <section id="connection" class="connection" aria-labelledby="connection-title">
      <div class="connection-card">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <img src="${tubevraIcon}" alt="" width="28" height="28" />
          </span>
          <span class="brand-text">Tubevra</span>
          <span class="brand-pill" data-i18n="common.tvMode"></span>
        </div>
        <h1 id="connection-title" data-i18n="connection.title"></h1>
        <p id="connection-status" class="connection-status" role="status" data-i18n="connection.connecting"></p>
        <div class="actions">
          <button id="retry" class="ui-button primary" type="button" data-i18n="connection.retry"></button>
          <button id="open-settings" class="ui-button secondary" type="button" data-i18n="common.settings"></button>
        </div>
      </div>
    </section>

    <section id="settings-screen" class="settings-screen" aria-labelledby="settings-title" hidden>
      <div class="settings-frame">
        <aside class="settings-sidebar" data-i18n-aria-label="settings.navigation">
          <div class="sidebar-top">
            <div class="brand">
              <span class="brand-mark" aria-hidden="true">
                <img src="${tubevraIcon}" alt="" width="28" height="28" />
              </span>
              <div class="brand-copy">
                <span class="brand-text">Tubevra</span>
                <span class="brand-sub" data-i18n="common.settings"></span>
              </div>
            </div>

            <nav class="sidebar-nav" data-i18n-aria-label="settings.sections">
              <button type="button" class="ui-button nav-item ui-nav-item" data-section="general" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/></svg>
                </span>
                <span data-i18n="settings.general.title"></span>
              </button>
              <button type="button" class="ui-button nav-item ui-nav-item" data-section="tv" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M8 21h8"/></svg>
                </span>
                <span data-i18n="settings.tv.title"></span>
              </button>
              <button type="button" class="ui-button nav-item ui-nav-item" data-section="user-agents" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V7l-8-4Z"/><path d="m9.5 12 1.8 1.8 3.7-3.8"/></svg>
                </span>
                <span data-i18n="presets.title"></span>
                <span id="preset-count" class="nav-badge"></span>
              </button>
              <button type="button" class="ui-button nav-item ui-nav-item" data-section="extensions" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4h2a3 3 0 0 1 0 6H3v4a2 2 0 0 0 2 2h4v-2a3 3 0 0 1 6 0v2h4a2 2 0 0 0 2-2v-4h-2a3 3 0 0 1 0-6h2V5a2 2 0 0 0-2-2h-4v2a3 3 0 0 1-6 0V3Z"/></svg>
                </span>
                <span data-i18n="addons.title"></span>
              </button>
              <button type="button" class="ui-button nav-item ui-nav-item" data-section="about" aria-current="false">
                <span class="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>
                </span>
                <span data-i18n="settings.about.title"></span>
              </button>
            </nav>
          </div>

          <div class="sidebar-footer">
            <div class="active-summary" data-i18n-aria-label="settings.activeUserAgent">
              <div class="active-summary-top">
                <span class="live-dot" aria-hidden="true"></span>
                <span class="active-summary-label" data-i18n="presets.activePreset"></span>
                <span id="loading-note" class="loading-pill" data-i18n="common.tvMode"></span>
              </div>
              <strong id="active-name" class="active-summary-name">—</strong>
            </div>
          </div>
        </aside>

        <div class="settings-workspace">
          <header class="workspace-header">
            <div class="settings-heading">
              <h1 id="settings-title"></h1>
              <p id="section-subtitle" class="heading-subtitle"></p>
            </div>
            <button id="done" class="ui-button secondary done-button" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              <span data-i18n="settings.backToTv"></span>
            </button>
          </header>

          <div id="service-error" class="error-banner" role="alert" hidden>
            <span class="banner-icon" aria-hidden="true"></span>
            <div class="banner-content">
              <strong class="banner-title"></strong>
              <p class="banner-description"></p>
            </div>
          </div>

          <div id="panel-extensions" class="section-panel" hidden></div>
          <div id="panel-about" class="section-panel" hidden>
            <div class="widget-box">
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>
                </span>
                <div class="row-copy">
                  <strong>Tubevra</strong>
                  <p><span data-i18n="settings.about.version"></span> <span id="app-version">—</span></p>
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
                <a id="project-github" class="secondary compact-btn project-link" href="${PROJECT_GITHUB_URL}" data-i18n-aria-label="settings.about.openGitHubLabel" data-i18n="settings.about.openGitHub"></a>
              </div>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></svg>
                </span>
                <div class="row-copy">
                  <strong data-i18n="settings.about.privacyPolicy"></strong>
                  <p data-i18n="settings.about.privacyDescription"></p>
                </div>
                <a id="privacy-policy" class="secondary compact-btn project-link" href="${PRIVACY_POLICY_URL}" data-i18n-aria-label="settings.about.openPrivacyLabel" data-i18n="settings.about.openPrivacy"></a>
              </div>
            </div>
            <p id="about-feedback" class="feedback error" role="alert"></p>
          </div>
          <div id="panel-general" class="section-panel" hidden>
            <div class="widget-box">
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/></svg>
                </span>
                <div class="row-copy"><label for="app-language" class="ui-label"><strong data-i18n="settings.general.language"></strong></label></div>
                <select id="app-language" class="ui-select" aria-describedby="language-feedback" disabled>
                  <option value="auto" data-i18n="settings.general.languageAuto"></option>
                  <option value="en" lang="en">English</option>
                  <option value="pl" lang="pl">Polski</option>
                </select>
              </div>
              <p id="language-feedback" class="feedback error" role="status"></p>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                </span>
                <div class="row-copy">
                  <strong data-i18n="settings.general.hardwareAcceleration"></strong>
                  <p id="hardware-acceleration-description" data-i18n="settings.general.hardwareDescription"></p>
                </div>
                <span id="hardware-acceleration-control"></span>
              </div>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
                </span>
                <div class="row-copy"><label for="playback-resolution" class="ui-label"><strong data-i18n="settings.general.playbackResolution"></strong></label></div>
                <select id="playback-resolution" class="ui-select">
                  <option value="auto" data-i18n="common.auto"></option>
                  <option value="1440p">1440p</option>
                  <option value="4k">2160p (4K)</option>
                  <option value="8k">4320p (8K)</option>
                </select>
              </div>
              <div id="codec-settings"></div>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </span>
                <div class="row-copy">
                  <strong data-i18n="common.reloadTv"></strong>
                  <p data-i18n="settings.general.reloadDescription"></p>
                </div>
                <button id="reload-home" class="ui-button secondary compact-btn reload-action ui-button--emphasized" type="button" data-i18n="settings.general.reload"></button>
              </div>
            </div>
            <p id="general-feedback" class="feedback" role="status" aria-live="polite"></p>
            <div id="general-restart" class="widget-box general-restart" hidden>
              <div class="widget-row">
                <span class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>
                </span>
                <div class="row-copy">
                  <strong data-i18n="settings.general.restartRequired"></strong>
                  <p role="status" data-i18n="settings.general.restartDescription"></p>
                </div>
                <button id="restart-app" class="ui-button secondary compact-btn" type="button" data-i18n="settings.general.restartApp"></button>
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
                  <strong data-i18n="settings.tv.userAgent"></strong>
                  <p id="tv-active-ua">—</p>
                </div>
                <button id="go-user-agents" class="ui-button primary compact-btn" type="button" data-i18n="settings.tv.configure"></button>
              </div>
            </div>
          </div>

          <div id="panel-user-agents" class="section-panel ua-panel" hidden>
            <div class="settings-layout">
              <aside class="widget-box presets-panel" data-i18n-aria-label="presets.list">
                <div class="presets-toolbar">
                  <div class="segmented-switch ui-tabs" role="tablist" data-i18n-aria-label="presets.category">
                    <button id="tab-default" type="button" class="ui-button seg-btn is-selected ui-tab" data-tab="default" role="tab" aria-selected="true">
                      <span data-i18n="presets.default"></span>
                      <small id="default-count"></small>
                    </button>
                    <button id="tab-user" type="button" class="ui-button seg-btn ui-tab" data-tab="user" role="tab" aria-selected="false">
                      <span data-i18n="presets.user"></span>
                      <small id="user-count"></small>
                    </button>
                  </div>
                  <button id="new-preset" class="ui-button new-preset-button ui-button--ghost" type="button" data-i18n-title="presets.addLabel" data-i18n="presets.add"></button>
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
                          <span data-i18n="presets.active"></span>
                        </span>
                      </div>
                      <div class="inspector-sub-row">
                        <span id="preset-kind" class="meta-label" data-i18n="presets.defaultPreset"></span>
                        <span id="readonly-badge" class="readonly-pill" hidden data-i18n="presets.readOnly"></span>
                      </div>
                    </div>
                  </div>
                  <button id="apply-preset" class="ui-button primary apply-btn ui-button--apply" type="button" data-i18n="presets.apply"></button>
                </div>

                <form id="preset-form">
                  <fieldset id="editor-fields">
                    <div class="form-row">
                      <label for="preset-name" class="ui-label" data-i18n="presets.name"></label>
                      <input id="preset-name" name="name" maxlength="100" required autocomplete="off" spellcheck="false" class="ui-input" />
                    </div>
                    <div class="form-row form-row-grow">
                      <label for="preset-value" class="ui-label" data-i18n="presets.userAgentString"></label>
                      <textarea id="preset-value" name="userAgent" rows="4" maxlength="4096" required autocomplete="off" spellcheck="false" class="ui-textarea"></textarea>
                    </div>
                    <div class="inspector-bottom">
                      <p id="editor-note" class="field-note"></p>
                      <div class="editor-actions">
                        <button id="delete-preset" class="ui-button danger-text" type="button" hidden data-i18n="presets.delete"></button>
                        <button id="discard" class="ui-button secondary" type="button" hidden data-i18n="presets.discard"></button>
                        <button id="save-preset" class="ui-button primary" type="submit" data-i18n="presets.save"></button>
                      </div>
                    </div>
                  </fieldset>
                </form>

                <p id="feedback" class="feedback" role="status" aria-live="polite"></p>

                <section id="delete-confirmation" class="delete-confirmation" data-i18n-aria-label="presets.confirmDeletion" hidden>
                  <div class="delete-header">
                    <h3 data-i18n="presets.deleteQuestion"></h3>
                    <p id="delete-note"></p>
                  </div>
                  <label id="replacement-label" for="replacement" class="ui-label" data-i18n="presets.replacement"></label>
                  <select id="replacement" class="ui-select"><option value="" data-i18n="presets.chooseReplacement"></option></select>
                  <div class="actions">
                    <button id="confirm-delete" class="ui-button danger" type="button" data-i18n="presets.delete"></button>
                    <button id="cancel-delete" class="ui-button secondary" type="button" data-i18n="common.cancel"></button>
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
  locale.apply(root);
  const name = element<HTMLInputElement>('preset-name');
  const hardwareAcceleration = createWidgetToggle(
    t('settings.general.hardwareToggle'),
    true,
  );
  hardwareAcceleration.input.id = 'hardware-acceleration';
  hardwareAcceleration.input.setAttribute(
    'aria-describedby',
    'hardware-acceleration-description',
  );
  element('hardware-acceleration-control').append(hardwareAcceleration.label);
  const extensions = mountExtensions(element('panel-extensions'), locale);
  const codecSettings = mountCodecSettings(
    element('codec-settings'),
    locale,
    (preferences) => {
      void run(
        () => window.tubevra.setCodecPreferences(preferences),
        undefined,
        '',
        codecSettings.feedback,
      );
    },
    () => {
      void run(
        () => window.tubevra.reloadTV(),
        undefined,
        t('common.applied'),
        codecSettings.feedback,
      );
    },
  );
  const value = element<HTMLTextAreaElement>('preset-value');
  const form = element<HTMLFormElement>('preset-form');
  const feedback = element('feedback');
  const replacement = element<HTMLSelectElement>('replacement');
  const language = element<HTMLSelectElement>('app-language');
  let current: AppState | null = null;
  let selectedId: string | null = null;
  let creating = false;
  let dirty = false;
  let busy = false;
  let activeSection: SettingsSection = 'general';
  let activeTab: PresetTab = 'default';
  const selected = () =>
    current?.userAgents.presets.find((preset) => preset.id === selectedId);

  function showSection(section: SettingsSection) {
    activeSection = section;
    const key = SECTION_KEYS[section];
    element('settings-title').textContent = t(key + '.title');
    element('section-subtitle').textContent = t(key + '.subtitle');
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

  async function selectSection(section: SettingsSection) {
    showSection(section);
    try {
      const result = await window.tubevra.setSettingsSection(section);
      if (!result.ok) throw new Error(result.error);
    } catch (cause) {
      console.error('Cannot remember the settings section:', cause);
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
    codecSettings.render(current, busy);
    const preset = selected();
    const active = preset?.id === current?.userAgents.activeId;
    element<HTMLFieldSetElement>('editor-fields').disabled = busy;
    element<HTMLButtonElement>('new-preset').disabled = busy || dirty;
    element<HTMLButtonElement>('tab-default').disabled = busy || dirty;
    element<HTMLButtonElement>('tab-user').disabled = busy || dirty;
    element<HTMLButtonElement>('apply-preset').disabled =
      busy || dirty || !preset || active;
    element('apply-preset').textContent = active
      ? t('presets.activePreset')
      : t('presets.apply');
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
    const resolution = element<HTMLSelectElement>('playback-resolution');
    resolution.disabled = busy || !current;
    resolution.value = current?.general.playbackResolution ?? 'auto';
    language.disabled = busy || !current;
    language.value =
      current?.general.languagePreference ?? DEFAULT_LANGUAGE_PREFERENCE;
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
    const focusedPreset = (document.activeElement as HTMLElement)?.dataset
      .presetId;
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
      button.className = 'ui-button preset-option ui-list-item';
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
        ? t('presets.device.' + preset.id, {
            defaultValue: t('presets.defaultDevice'),
          })
        : t('presets.customUserAgent');
      copy.append(label, sub);

      const meta = document.createElement('small');
      meta.className = isActive ? 'preset-tag is-active' : 'preset-tag';
      meta.textContent = isActive
        ? t('presets.active')
        : preset.builtIn
          ? t('presets.default')
          : t('presets.user');

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
      empty.textContent = creating ? t('presets.creating') : t('presets.empty');
      userContainer.append(empty);
    } else {
      for (const preset of customs) {
        userContainer.append(makeOption(preset));
      }
    }
    if (focusedPreset) {
      element('preset-list')
        .querySelector<HTMLElement>(
          `[data-preset-id="${CSS.escape(focusedPreset)}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  }
  function renderPresetCopy() {
    const preset = selected();
    element('detail-title').textContent =
      preset?.name ?? t('presets.newPreset');
    element('preset-kind').textContent = creating
      ? t('presets.newUserPreset')
      : preset?.builtIn
        ? t('presets.device.' + preset.id, {
            defaultValue: t('presets.defaultPreset'),
          })
        : t('presets.userPreset');
    element('editor-note').textContent = preset?.builtIn
      ? t('presets.readOnlyNote')
      : t('presets.reloadNote');
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
    renderPresetCopy();
    const inspectorIcon = element('inspector-icon');
    inspectorIcon.replaceChildren(
      createDeviceIcon(preset?.id ?? 'custom', !!preset?.builtIn),
    );
    element('delete-confirmation').hidden = true;
    message('');
    list();
    controls();
    if (creating) name.focus();
  }
  function render(state: AppState) {
    const firstRender = current === null;
    const wasOpen = current?.settingsOpen;
    current = state;
    const languageChanged = locale.setLanguage(state.general.language);
    if (languageChanged) {
      locale.apply(root);
      hardwareAcceleration.input.setAttribute(
        'aria-label',
        t('settings.general.hardwareToggle'),
      );
      renderPresetCopy();
      renderDeleteNote();
    }
    if (firstRender) showSection(state.settingsSection);
    else if (languageChanged) showSection(activeSection);
    document.body.classList.toggle('glass-active', state.settingsOpen);
    element('general-restart').hidden = !state.general.restartRequired;
    element('app-version').textContent = state.version;
    extensions.render(state.extensions);
    const showConnection =
      !state.settingsOpen && (state.loading || !!state.error);
    element('connection').hidden = !showConnection;
    element('settings-screen').hidden = showConnection;
    element('settings-screen').classList.toggle('is-open', state.settingsOpen);
    element('connection-status').textContent = state.error
      ? locale.error(state.error)
      : t(state.loading ? 'connection.connecting' : 'connection.ready');
    element<HTMLButtonElement>('retry').disabled = state.loading || busy;
    const forceCodecs = state.general.codecPreferences.mode === 'force';
    const serviceMessage = element('service-error');
    const isVisible = Boolean(state.error || state.codecWarning || forceCodecs);
    serviceMessage.hidden = !isVisible;
    if (isVisible) {
      const isError = Boolean(state.error);
      serviceMessage.classList.toggle('warning-banner', !isError);
      serviceMessage.setAttribute('role', isError ? 'alert' : 'status');
      const bannerIcon = serviceMessage.querySelector('.banner-icon');
      const bannerTitle = serviceMessage.querySelector('.banner-title');
      const bannerDesc = serviceMessage.querySelector('.banner-description');

      if (bannerIcon) {
        bannerIcon.innerHTML = isError
          ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>';
      }

      if (isError) {
        if (bannerTitle)
          bannerTitle.textContent = t('connection.applicationError');
        if (bannerDesc) bannerDesc.textContent = state.error;
      } else if (forceCodecs) {
        if (bannerTitle) bannerTitle.textContent = t('codecs.forceWarning');
        if (bannerDesc)
          bannerDesc.textContent = t('codecs.forceWarningDescription');
      } else {
        if (bannerTitle)
          bannerTitle.textContent = t('codecs.compatibilityWarning');
        if (bannerDesc)
          bannerDesc.textContent =
            t('codecs.compatibilityDescription') +
            (state.codecWarning ? ` ${state.codecWarning}` : '');
      }
    }
    element('loading-note').textContent = state.loading
      ? t('connection.reloading')
      : t('common.tvMode');
    const activeName =
      state.userAgents.presets.find(
        (preset) => preset.id === state.userAgents.activeId,
      )?.name ?? state.userAgents.activeId;
    element('active-name').textContent = activeName;
    element('tv-active-ua').textContent = t('settings.tv.activePreset', {
      name: activeName,
    });
    if (!selectedId && !creating) showPreset(state.userAgents.activeId);
    else {
      list();
      controls();
    }
    if (state.settingsOpen && !wasOpen) {
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
    report(t('common.working'));
    try {
      const result = await action();
      if (result.ok === false) report(locale.error(result.error), true);
      else {
        render(result.value);
        success?.(result.value);
        if (successMessage && result.value.error) {
          report(t('common.savedReloadFailed'), true);
        } else report(successMessage);
      }
    } catch {
      report(t('common.formKept'), true);
    } finally {
      busy = false;
      controls();
    }
  }
  const mutate = (
    command: UserAgentCommand,
    success?: (state: AppState) => void,
  ) =>
    run(
      () => window.tubevra.updateUserAgents(command),
      success,
      t('common.saved'),
    );
  language.addEventListener('change', async () => {
    const next = language.value;
    if (
      busy ||
      !current ||
      !isLanguagePreference(next) ||
      next === current.general.languagePreference
    )
      return;
    const focused = document.activeElement === language;
    const output = element('language-feedback');
    busy = true;
    controls();
    language.value = next;
    output.textContent = '';
    try {
      const result = await window.tubevra.setLanguage(next);
      if (result.ok) render(result.value);
      else
        output.textContent = t('settings.general.languageSaveErrorDetail', {
          detail: result.error,
        });
    } catch {
      output.textContent = t('settings.general.languageSaveError');
    } finally {
      busy = false;
      controls();
      if (focused && document.activeElement === document.body)
        language.focus({ preventScroll: true });
    }
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '.nav-item[data-section]',
  )) {
    button.addEventListener('click', () => {
      const target = button.dataset.section as SettingsSection | undefined;
      if (target) void selectSection(target);
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
  element('go-user-agents').addEventListener(
    'click',
    () => void selectSection('user-agents'),
  );
  element('project-github').addEventListener('click', async (event) => {
    event.preventDefault();
    element('about-feedback').textContent = '';
    try {
      const result = await window.tubevra.openProjectGitHub();
      if (!result.ok)
        element('about-feedback').textContent = locale.error(result.error);
    } catch {
      element('about-feedback').textContent = t('common.communicationError');
    }
  });
  element('privacy-policy').addEventListener('click', async (event) => {
    event.preventDefault();
    element('about-feedback').textContent = '';
    try {
      const result = await window.tubevra.openPrivacyPolicy();
      if (!result.ok)
        element('about-feedback').textContent = locale.error(result.error);
    } catch {
      element('about-feedback').textContent = t('common.communicationError');
    }
  });
  element('reload-home').addEventListener('click', () => {
    void run(() => window.tubevra.navigate('home'));
  });
  element<HTMLSelectElement>('playback-resolution').addEventListener(
    'change',
    () => {
      const value = element<HTMLSelectElement>('playback-resolution').value;
      if (
        value !== 'auto' &&
        value !== '1440p' &&
        value !== '4k' &&
        value !== '8k'
      )
        return;
      void run(
        () => window.tubevra.setPlaybackResolution(value),
        undefined,
        '',
        element('general-feedback'),
      );
    },
  );
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
    message(t('presets.dirty'));
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
  function renderDeleteNote() {
    element('delete-note').textContent =
      selectedId === current?.userAgents.activeId
        ? t('presets.deleteActive')
        : t('presets.deleteCustom');
  }
  element('delete-preset').addEventListener('click', () => {
    const active = selectedId === current?.userAgents.activeId;
    const placeholder = new Option(t('presets.chooseReplacement'), '');
    placeholder.dataset.i18n = 'presets.chooseReplacement';
    replacement.replaceChildren(placeholder);
    for (const preset of current!.userAgents.presets)
      if (preset.id !== selectedId)
        replacement.add(new Option(preset.name, preset.id));
    replacement.hidden = element('replacement-label').hidden = !active;
    renderDeleteNote();
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
      if (current) return;
      if (result.ok === true) render(result.value);
      else
        element('connection-status').textContent = locale.error(result.error);
    })
    .catch(() => {
      element('connection-status').textContent = t('common.communicationError');
    });
}

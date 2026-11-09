import type { ExtensionsState } from '../../extensions/types';
import { createWidgetRow, createWidgetToggle } from '../widgets';
import { SPONSORBLOCK_URL, RYD_URL } from '../../shared/api';
import {
  sponsorAvailability,
  sponsorPlayback,
  type SponsorAvailability,
} from '../../extensions/sponsorblock/diagnostics';
import type { SponsorPlayback } from '../../extensions/sponsorblock/player';
import type { Localization } from '../localization';

export function mountExtensions(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'widget-box';
  list.hidden = true;
  const empty = document.createElement('p');
  empty.className = 'extensions-empty';
  empty.hidden = true;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'ui-button secondary reload-action ui-button--emphasized';
  reload.hidden = true;
  root.append(feedback, empty, list, reload);
  let current: ExtensionsState | null = null;
  let busy = false;
  let operationError: string | null = '';
  const rydButton = document.createElement('button');
  rydButton.type = 'button';
  rydButton.className = 'ui-button secondary compact-btn';
  rydButton.dataset.controlId = 'ryd-settings';
  rydButton.setAttribute('aria-haspopup', 'dialog');
  const blocker = document.createElement('dialog');
  blocker.className = 'extension-settings-blocker';
  root.append(blocker);
  function translateControls() {
    empty.textContent = t('addons.empty');
    reload.textContent = t('common.reloadTv');
    rydButton.textContent = t('common.settings');
    rydButton.setAttribute(
      'aria-label',
      t('common.settingsFor', { name: 'Return YouTube Dislike' }),
    );
    blocker.setAttribute('aria-label', t('addons.ryd.settings'));
  }
  translateControls();
  window.extensionSettingsHost.onClosed((error) => {
    if (!blocker.open) return;
    blocker.close();
    if (error) {
      operationError = error;
      if (current) render(current);
    }
    rydButton.focus({ preventScroll: true });
  });
  blocker.addEventListener('cancel', (event) => {
    event.preventDefault();
    void window.extensionSettingsHost
      .close()
      .then((result) => {
        if (!result.ok) {
          operationError = result.error;
          if (current) render(current);
        }
      })
      .catch(() => {
        operationError = null;
        if (current) render(current);
      });
  });
  rydButton.addEventListener('click', async () => {
    blocker.showModal();
    try {
      const result = await window.extensionSettingsHost.open();
      if (!result.ok) {
        blocker.close();
        operationError = result.error;
        render(current!);
      }
    } catch {
      blocker.close();
      operationError = null;
      render(current!);
    }
  });
  const labels = {
    disabled: 'addons.status.disabled',
    starting: 'addons.status.starting',
    active: 'addons.status.active',
    error: 'addons.status.error',
  };
  const serviceLabels: Record<SponsorAvailability, string> = {
    unknown: '',
    available: 'addons.status.active',
    'network-error': 'addons.sponsor.networkError',
    'service-error': 'addons.sponsor.serviceError',
    timeout: 'addons.sponsor.timeout',
    'invalid-data': 'addons.sponsor.invalidData',
    'rate-limited': 'addons.sponsor.rateLimited',
    busy: 'addons.sponsor.busy',
  };
  const playbackLabels: Record<SponsorPlayback, string> = {
    retrying: 'addons.sponsor.retrying',
    'request-error': 'addons.sponsor.requestError',
    waiting: 'addons.sponsor.waiting',
    ready: 'addons.sponsor.ready',
    empty: 'addons.sponsor.empty',
    'player-api': 'addons.sponsor.playerApi',
    identity: '',
    media: '',
    live: 'addons.sponsor.live',
    preview: 'addons.sponsor.preview',
    ad: 'addons.sponsor.ad',
    timeline: 'addons.sponsor.timeline',
    'not-ready': 'addons.sponsor.notReady',
    'invalid-segments': 'addons.sponsor.invalidSegments',
    'seek-failed': 'addons.sponsor.seekFailed',
  };
  function render(state: ExtensionsState) {
    if (
      current &&
      (state.revision < current.revision ||
        (state.revision === current.revision &&
          state.stateVersion < current.stateVersion))
    )
      return;
    current = state;
    translateControls();
    const active = document.activeElement;
    const focusedId =
      active instanceof HTMLElement && list.contains(active)
        ? (active.dataset.controlId ?? active.dataset.extensionId)
        : undefined;
    const focusedLink = active instanceof HTMLAnchorElement;
    let restoreFocus: HTMLElement | undefined;
    list.replaceChildren();
    list.hidden = !state.items.length;
    empty.hidden = !!state.items.length;
    reload.hidden = !state.items.some((item) => item.reloadRequired);
    reload.disabled = busy;
    feedback.textContent = [
      state.error && locale.error(state.error),
      operationError === null
        ? t('common.communicationError')
        : operationError && locale.error(operationError),
    ]
      .filter(Boolean)
      .join(' ');
    for (const item of state.items) {
      const { row, copy } = createWidgetRow(
        item.name,
        t('addons.description.' + item.id, { defaultValue: item.description }),
      );
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = [
        item.id === 'sponsorblock'
          ? t(labels[item.status])
          : t('addons.runtime', { status: t(labels[item.status]) }),
        item.enabled && item.status === 'disabled' && item.reloadRequired
          ? t('addons.enabledAfterReload')
          : null,
        item.error && locale.error(item.error),
        item.reloadRequired
          ? t('addons.reloadRequired', {
              reason: item.reloadReason ?? t('addons.newDocumentRequired'),
            })
          : null,
      ]
        .filter(Boolean)
        .join(': ');
      if (
        item.id === 'sponsorblock' &&
        item.enabled &&
        item.status === 'active' &&
        !item.error &&
        !item.reloadRequired
      ) {
        const service = sponsorAvailability(item);
        const playback = sponsorPlayback(item);
        // Playback describes this film, including cached results. The service
        // remembers the last HTTP outcome, which may belong to a previous film.
        // Only a failed/retrying current request needs its detailed service error.
        const failedRequest =
          !playback || playback === 'retrying' || playback === 'request-error';
        const key =
          failedRequest &&
          service &&
          service !== 'unknown' &&
          service !== 'available'
            ? serviceLabels[service]
            : playback
              ? playbackLabels[playback]
              : serviceLabels[service ?? 'unknown'];
        status.textContent = key ? t(key) : '';
      }
      if (
        item.id === 'return-youtube-dislike' &&
        item.enabled &&
        item.diagnostics?.main?.playback
      ) {
        const messages: Record<string, string> = {
          'no-video': t('ratings.noVideo'),
          'unsupported-player': t('addons.ryd.unsupportedPlayer'),
          loading: t('ratings.loading'),
          ready: t('addons.ryd.ready'),
          empty: t('ratings.empty'),
          error: t('addons.ryd.error'),
          'rate-limited': t('addons.sponsor.rateLimited'),
        };
        status.textContent = [
          status.textContent,
          messages[item.diagnostics.main.playback],
        ]
          .filter(Boolean)
          .join(': ');
      }
      if (
        item.id === 'return-youtube-dislike' &&
        item.diagnostics?.page?.connection === 'error'
      )
        status.textContent = t('addons.ryd.connectionError');
      const { label, input: toggle } = createWidgetToggle(
        t('common.enable', { name: item.name }),
        item.enabled,
      );
      toggle.dataset.extensionId = item.id;
      toggle.disabled = busy || !item.modes.includes('tv');
      if (focusedId === item.id && !focusedLink && !toggle.disabled)
        restoreFocus = toggle;
      toggle.addEventListener('change', async () => {
        const enabled = toggle.checked;
        busy = true;
        operationError = '';
        render(current!);
        try {
          const result = await window.tubevra.setExtensionEnabled({
            id: item.id,
            enabled,
          });
          if (result.ok) render(result.value);
          else operationError = result.error;
        } catch {
          operationError = null;
        } finally {
          busy = false;
          render(current!);
        }
      });
      if (status.textContent) copy.append(status);
      if (item.id === 'sponsorblock' || item.id === 'return-youtube-dislike') {
        const isSponsorBlock = item.id === 'sponsorblock';
        const attribution = document.createElement('p');
        const link = document.createElement('a');
        link.textContent = isSponsorBlock
          ? 'SponsorBlock'
          : 'Return YouTube Dislike';
        link.href = isSponsorBlock ? SPONSORBLOCK_URL : RYD_URL;
        link.dataset.extensionId = item.id;
        link.className = 'extension-attribution-link';
        if (focusedId === item.id && focusedLink) restoreFocus = link;
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            const result = await (isSponsorBlock
              ? window.tubevra.openSponsorBlock()
              : window.tubevra.openReturnYouTubeDislike());
            if (!result.ok) operationError = result.error;
          } catch {
            operationError = null;
          }
          render(current!);
        });
        const marker = '\uFFFC';
        const [before, after] = t('addons.attribution', { name: marker }).split(
          marker,
        );
        attribution.append(before, link, after);
        if (!isSponsorBlock) {
          const privacy = document.createElement('p');
          privacy.textContent = t('addons.ryd.privacy');
          copy.append(privacy);
        }
        copy.append(attribution);
      }
      if (item.id === 'return-youtube-dislike') {
        rydButton.disabled = busy;
        row.append(rydButton);
        if (focusedId === 'ryd-settings' && !busy) restoreFocus = rydButton;
      }
      row.append(label);
      list.append(row);
    }
    restoreFocus?.focus({ preventScroll: true });
  }
  reload.addEventListener('click', async () => {
    busy = true;
    operationError = '';
    render(current!);
    try {
      const result = await window.tubevra.reloadTV();
      if (!result.ok) operationError = result.error;
    } catch {
      operationError = null;
    } finally {
      busy = false;
      render(current!);
    }
  });
  window.tubevra.onExtensionsStateChanged(render);
  void window.tubevra
    .getExtensions()
    .then((result) => {
      if (result.ok) render(result.value);
      else feedback.textContent = locale.error(result.error);
    })
    .catch(() => {
      feedback.textContent = t('common.communicationError');
    });
  return { render };
}

import type { ExtensionsState } from '../../extensions/types';
import { createWidgetRow, createWidgetToggle } from '../widgets';
import { createSettingsDialog } from '../settings-dialog';
import { SPONSORBLOCK_URL, RYD_URL } from '../../shared/api';
import {
  sponsorAvailability,
  sponsorPlayback,
  type SponsorAvailability,
} from '../../extensions/sponsorblock/diagnostics';
import type { SponsorPlayback } from '../../extensions/sponsorblock/player';

export function mountExtensions(root: HTMLElement) {
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'widget-box';
  list.hidden = true;
  const empty = document.createElement('p');
  empty.className = 'extensions-empty';
  empty.textContent = 'No add-ons are available yet.';
  empty.hidden = true;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'secondary reload-action';
  reload.textContent = 'Reload YouTube TV';
  reload.hidden = true;
  root.append(feedback, empty, list, reload);
  let current: ExtensionsState | null = null;
  let busy = false;
  let operationError = '';
  const rydContent = document.createElement('div');
  rydContent.className = 'settings-dialog-content';
  const rydOption = createWidgetRow(
    'Show with dock',
    'When disabled, ratings appear only after a video change.',
  );
  const rydToggle = createWidgetToggle('Show with dock', true);
  rydToggle.input.dataset.controlId = 'ryd-show-with-dock';
  rydOption.row.append(rydToggle.label);
  const rydFeedback = document.createElement('p');
  rydFeedback.className = 'feedback';
  rydFeedback.setAttribute('role', 'status');
  rydContent.append(rydOption.row, rydFeedback);
  let rydSaving = false;
  const rydSettings = createSettingsDialog(
    'Return YouTube Dislike',
    rydContent,
    {
      onOpen() {
        rydToggle.input.checked = current!.ryd.showWithDock;
        rydFeedback.textContent = '';
      },
      onSave() {
        if (rydSaving) return;
        void saveRydSettings();
      },
    },
  );
  rydSettings.button.dataset.controlId = 'ryd-settings';
  rydSettings.dialog.dataset.extensionId = 'return-youtube-dislike';
  // Keep the dialog mounted while diagnostic updates rebuild the add-on list.
  root.append(rydSettings.dialog);
  rydSettings.dialog
    .querySelector('form')!
    .addEventListener('submit', (event) => {
      event.preventDefault();
    });
  rydSettings.dialog.addEventListener('cancel', (event) => {
    if (rydSaving) event.preventDefault();
  });
  rydSettings.dialog.addEventListener('close', () => {
    rydSettings.button.focus({ preventScroll: true });
  });
  async function saveRydSettings() {
    const enabled = rydToggle.input.checked;
    rydSaving = true;
    rydFeedback.textContent = '';
    rydToggle.input.disabled = true;
    const buttons = rydSettings.dialog.querySelectorAll('button');
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await window.tubevra.setRydShowWithDock(enabled);
      if (result.ok) {
        render(result.value);
        rydSettings.dialog.close();
      } else {
        rydFeedback.textContent = result.error;
      }
    } catch {
      rydFeedback.textContent = 'Cannot communicate with Tubevra.';
    } finally {
      rydSaving = false;
      rydToggle.input.disabled = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }
  const labels = {
    disabled: 'Disabled',
    starting: 'Starting…',
    active: 'Active',
    error: 'Error',
  };
  const serviceLabels: Record<SponsorAvailability, string> = {
    unknown: '',
    available: 'Active',
    'network-error': 'Network error',
    'service-error': 'SponsorBlock unavailable',
    timeout: 'Request timed out',
    'invalid-data': 'Invalid segment data',
    'rate-limited': 'Request limit reached. Try later.',
    busy: 'Temporarily busy. Try later.',
  };
  const playbackLabels: Record<SponsorPlayback, string> = {
    retrying: 'Retrying segment download…',
    'request-error': 'Could not load segments. Reload YouTube TV to try again.',
    waiting: 'Loading segments…',
    ready: 'Ready',
    empty: 'No sponsor segments',
    'player-api': 'Skipping paused: unsupported player',
    identity: '',
    media: '',
    live: 'Skipping paused: live or unknown stream',
    preview: 'Skipping paused: preview or unknown mode',
    ad: 'Skipping paused: ad or unknown ad state',
    timeline: 'Skipping paused: incompatible timeline',
    'not-ready': 'Waiting for playback…',
    'invalid-segments': 'Segments do not match this video',
    'seek-failed': 'Skipping paused: seek failed',
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
    feedback.textContent = [state.error, operationError]
      .filter(Boolean)
      .join(' ');
    for (const item of state.items) {
      const { row, copy } = createWidgetRow(item.name, item.description);
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = [
        item.id === 'sponsorblock'
          ? labels[item.status]
          : `Runtime: ${labels[item.status]}`,
        item.enabled && item.status === 'disabled' && item.reloadRequired
          ? 'Enabled in settings. Starts after reload.'
          : null,
        item.error,
        item.reloadRequired
          ? `Reload required: ${item.reloadReason ?? 'New document required.'}`
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
        status.textContent =
          failedRequest &&
          service &&
          service !== 'unknown' &&
          service !== 'available'
            ? serviceLabels[service]
            : playback
              ? playbackLabels[playback]
              : serviceLabels[service ?? 'unknown'];
      }
      if (
        item.id === 'return-youtube-dislike' &&
        item.enabled &&
        item.diagnostics?.main?.playback
      ) {
        const messages: Record<string, string> = {
          'no-video': 'Waiting for a video',
          'unsupported-player': 'Unsupported YouTube TV player',
          loading: 'Loading ratings…',
          ready: 'Ratings ready',
          empty: 'No ratings available',
          error: 'Could not load ratings',
          'rate-limited': 'Request limit reached. Try later.',
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
        status.textContent = 'RYD private connection failed';
      const { label, input: toggle } = createWidgetToggle(
        item.name,
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
          operationError = 'Cannot communicate with Tubevra.';
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
            operationError = 'Cannot communicate with Tubevra.';
          }
          render(current!);
        });
        attribution.append('(Using ', link, ')');
        if (!isSponsorBlock) {
          const privacy = document.createElement('p');
          privacy.textContent =
            'When enabled, sends the current video ID and your IP address to RYD. Ratings are estimates. Disable this add-on to stop requests.';
          copy.append(privacy);
        }
        copy.append(attribution);
      }
      if (item.id === 'return-youtube-dislike') {
        rydSettings.button.disabled = busy;
        row.append(rydSettings.button);
        if (focusedId === 'ryd-settings' && !busy)
          restoreFocus = rydSettings.button;
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
      operationError = 'Cannot communicate with Tubevra.';
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
      else feedback.textContent = result.error;
    })
    .catch(() => {
      feedback.textContent = 'Cannot communicate with Tubevra.';
    });
  return { render };
}

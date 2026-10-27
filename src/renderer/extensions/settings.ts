import type { ExtensionsState } from '../../extensions/types';
import { createWidgetRow, createWidgetToggle } from '../widgets';
import { SPONSORBLOCK_URL } from '../../shared/api';
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
  reload.className = 'secondary';
  reload.textContent = 'Reload YouTube TV';
  reload.hidden = true;
  root.append(feedback, empty, list, reload);
  let current: ExtensionsState | null = null;
  let busy = false;
  let operationError = '';
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
        ? active.dataset.extensionId
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
      if (item.id === 'sponsorblock') {
        const attribution = document.createElement('p');
        const link = document.createElement('a');
        link.textContent = 'SponsorBlock';
        link.href = SPONSORBLOCK_URL;
        link.dataset.extensionId = item.id;
        link.className = 'extension-attribution-link';
        if (focusedId === item.id && focusedLink) restoreFocus = link;
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            const result = await window.tubevra.openSponsorBlock();
            if (!result.ok) operationError = result.error;
          } catch {
            operationError = 'Cannot communicate with Tubevra.';
          }
          render(current!);
        });
        attribution.append('(Using ', link, ')');
        copy.append(attribution);
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

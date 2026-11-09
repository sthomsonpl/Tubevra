import type { RatingsSnapshot } from '../shared/ratings';
import type { Localization } from './localization';

export function mountRatings(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  document.body.className = 'ratings-page';
  root.innerHTML =
    '<section class="ratings" data-i18n-aria-label="ratings.label"><canvas aria-hidden="true"></canvas><div class="ratings-counts" role="status"></div><small data-i18n="ratings.caption"></small></section>';
  const counts = root.querySelector<HTMLElement>('.ratings-counts')!;
  const canvas = root.querySelector('canvas')!;
  // The live panel and its animation use the same pixels, prepared even while
  // the native view is hidden. Native glass still blurs the real video below.
  function draw() {
    const width = 220,
      height = 68,
      scale = devicePixelRatio;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    const theme = getComputedStyle(document.documentElement);
    const token = (name: string) => theme.getPropertyValue(name).trim();
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.roundRect(
      0.5,
      0.5,
      width - 1,
      height - 1,
      parseFloat(token('--glass-radius')),
    );
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, token('--glass-start'));
    gradient.addColorStop(0.6, token('--glass-end'));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = token('--glass-edge');
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const family = getComputedStyle(document.documentElement).fontFamily;
    ctx.font = `14px ${family}`;
    ctx.fillStyle = token('--overlay-text');
    ctx.fillText(
      counts.textContent ?? '',
      width / 2,
      height / 2 - 7,
      width - 16,
    );
    ctx.font = `10px ${family}`;
    ctx.fillStyle = token('--overlay-muted');
    ctx.fillText(t('ratings.caption'), width / 2, height / 2 + 12);
    canvas.dataset.version = String(current?.version ?? -1);
  }
  let current: RatingsSnapshot | undefined;
  let snapshotFailed = false;
  function render() {
    locale.apply(root);
    const state = current;
    if (state?.kind === 'ready') {
      const compact = new Intl.NumberFormat(locale.language, {
        notation: 'compact',
        maximumFractionDigits: 1,
      });
      const full = new Intl.NumberFormat(locale.language);
      counts.textContent = `👍 ${compact.format(state.likes)}  👎 ${compact.format(state.dislikes)}`;
      counts.setAttribute(
        'aria-label',
        t('ratings.announcement', {
          likes: t('ratings.likes', {
            count: state.likes,
            formattedCount: full.format(state.likes),
          }),
          dislikes: t('ratings.dislikes', {
            count: state.dislikes,
            formattedCount: full.format(state.dislikes),
          }),
        }),
      );
    } else {
      counts.removeAttribute('aria-label');
      counts.textContent = state
        ? t(
            {
              'no-video': 'ratings.noVideo',
              'unsupported-player': 'ratings.unsupportedPlayer',
              loading: 'ratings.loading',
              empty: 'ratings.empty',
              error: 'ratings.error',
              'rate-limited': 'ratings.rateLimited',
            }[state.kind],
          )
        : snapshotFailed
          ? t('ratings.error')
          : '';
    }
    draw();
  }
  function receive(state: RatingsSnapshot) {
    if (current && state.version <= current.version) return;
    current = state;
    render();
  }
  render();
  window.addEventListener('resize', draw);
  const release = window.ratings.subscribe(receive);
  window.addEventListener('unload', release, { once: true });
  let receivedLanguage = false;
  const releaseLanguage = window.ratings.onLanguageChanged((language) => {
    receivedLanguage = true;
    if (locale.setLanguage(language)) render();
  });
  window.addEventListener('unload', releaseLanguage, { once: true });
  void window.ratings
    .getLanguage()
    .then((language) => {
      if (!receivedLanguage && locale.setLanguage(language)) render();
    })
    .catch((error) =>
      console.error('Cannot refresh the ratings language:', error),
    );
  void window.ratings
    .getSnapshot()
    .then(receive)
    .catch(() => {
      if (!current) {
        snapshotFailed = true;
        render();
      }
    });
}

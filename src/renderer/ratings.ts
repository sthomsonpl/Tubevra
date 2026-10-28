import type { RatingsSnapshot } from '../shared/ratings';

export function mountRatings(root: HTMLElement) {
  document.body.className = 'ratings-page';
  root.innerHTML =
    '<section class="ratings" aria-label="Return YouTube Dislike estimates"><canvas aria-hidden="true"></canvas><div class="ratings-counts" role="status"></div><small>RYD · Estimated ratings</small></section>';
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
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, height - 1, 26);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#ffffff17');
    gradient.addColorStop(0.6, '#ffffff03');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#ffffff38';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const family = getComputedStyle(document.documentElement).fontFamily;
    ctx.font = `14px ${family}`;
    ctx.fillStyle = '#f4f5f7';
    ctx.fillText(
      counts.textContent ?? '',
      width / 2,
      height / 2 - 7,
      width - 16,
    );
    ctx.font = `10px ${family}`;
    ctx.fillStyle = '#d4d8e1';
    ctx.fillText('RYD · Estimated ratings', width / 2, height / 2 + 12);
    canvas.dataset.version = String(version);
  }
  const compact = new Intl.NumberFormat(navigator.language, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const full = new Intl.NumberFormat(navigator.language);
  let version = -1;
  const render = (state: RatingsSnapshot) => {
    if (state.version <= version) return;
    version = state.version;
    if (state.kind === 'ready') {
      counts.textContent = `👍 ${compact.format(state.likes)}  👎 ${compact.format(state.dislikes)}`;
      counts.setAttribute(
        'aria-label',
        `${full.format(state.likes)} likes; ${full.format(state.dislikes)} dislikes. Estimates from Return YouTube Dislike.`,
      );
    } else {
      counts.removeAttribute('aria-label');
      counts.textContent = {
        'no-video': 'Waiting for a video',
        'unsupported-player': 'Unsupported player',
        loading: 'Loading ratings…',
        empty: 'No ratings available',
        error: 'Ratings unavailable',
        'rate-limited': 'Request limit reached',
      }[state.kind];
    }
    draw();
  };
  window.addEventListener('resize', draw);
  const release = window.ratings.subscribe(render);
  window.addEventListener('unload', release, { once: true });
  void window.ratings
    .getSnapshot()
    .then(render)
    .catch(() => {
      if (version < 0) {
        counts.textContent = 'Ratings unavailable';
        draw();
      }
    });
}

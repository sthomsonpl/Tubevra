// Status messages keep a text builder, so they can be translated again
// when the interface language changes.
const builders = new WeakMap<HTMLElement, () => string>();

// `failure` toggles the `error` class; leave it undefined to keep the class.
export function setStatus(
  output: HTMLElement,
  build: (() => string) | null,
  failure?: boolean,
) {
  if (build) builders.set(output, build);
  else builders.delete(output);
  output.textContent = build ? build() : '';
  if (failure !== undefined) output.classList.toggle('error', failure);
}

export function refreshStatuses(root: HTMLElement) {
  for (const output of root.querySelectorAll<HTMLElement>('.feedback')) {
    const build = builders.get(output);
    if (build) output.textContent = build();
  }
}

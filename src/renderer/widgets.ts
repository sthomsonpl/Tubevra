export function createWidgetRow(title: string, description: string) {
  const row = document.createElement('div');
  row.className = 'widget-row';
  const copy = document.createElement('div');
  copy.className = 'row-copy';
  const name = document.createElement('strong');
  name.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = description;
  copy.append(name, detail);
  row.append(copy);
  return { row, copy };
}

export function createWidgetToggle(name: string, checked: boolean) {
  const label = document.createElement('label');
  label.className = 'widget-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('aria-label', `Enable ${name}`);
  const track = document.createElement('span');
  track.className = 'widget-toggle-track';
  track.setAttribute('aria-hidden', 'true');
  label.append(input, track);
  return { label, input };
}

export function createWidgetRow(title: string, description?: string) {
  const row = document.createElement('div');
  row.className = 'widget-row';
  const copy = document.createElement('div');
  copy.className = 'row-copy';
  const name = document.createElement('strong');
  name.textContent = title;
  copy.append(name);
  if (description) {
    const detail = document.createElement('p');
    detail.textContent = description;
    copy.append(detail);
  }
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

export function createWidgetCheckbox(name: string, checked: boolean) {
  const label = document.createElement('label');
  label.className = 'widget-checkbox';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const box = document.createElement('span');
  box.className = 'widget-checkbox-box';
  box.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = name;
  label.append(input, box, text);
  return { label, input };
}

export function createWidgetNotice(text: string) {
  const notice = document.createElement('div');
  notice.className = 'ui-notice';
  const body = document.createElement('p');
  body.textContent = text;
  notice.append(body);
  return { notice, body };
}

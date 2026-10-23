import './index.css';
import { mountSettings } from './settings';
import { mountToolbar } from './toolbar';

const root = document.querySelector<HTMLElement>('#app')!;
if (location.hash === '#toolbar') mountToolbar(root);
else mountSettings(root);

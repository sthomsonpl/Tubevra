import './index.css';
import { mountSettings } from './settings';
import { mountToolbar } from './toolbar';
import { mountRatings } from './ratings';
import { mountRydSettings } from './extensions/ryd-settings';

const root = document.querySelector<HTMLElement>('#app')!;
if (location.hash === '#toolbar') mountToolbar(root);
else if (location.hash === '#ratings') mountRatings(root);
else if (location.hash === '#extension-settings') mountRydSettings(root);
else mountSettings(root);

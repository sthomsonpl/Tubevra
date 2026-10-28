import './index.css';
import { mountSettings } from './settings';
import { mountToolbar } from './toolbar';
import { mountRatings } from './ratings';

const root = document.querySelector<HTMLElement>('#app')!;
if (location.hash === '#toolbar') mountToolbar(root);
else if (location.hash === '#ratings') mountRatings(root);
else mountSettings(root);

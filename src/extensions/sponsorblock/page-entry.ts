import { ipcRenderer } from 'electron';
import { executeHookEntry } from '../hooks/adapter';
import { readPlayerSnapshot } from './player';
import { withSponsorConnection } from './page-transport';
import { start as startPlayback } from './page';

export const start = withSponsorConnection(
  startPlayback,
  (channel, payload) => ipcRenderer.invoke(channel, payload),
  () => executeHookEntry(readPlayerSnapshot),
);

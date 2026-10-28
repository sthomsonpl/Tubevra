import { ipcRenderer } from 'electron';
import { executeHookEntry } from '../hooks/adapter';
import { readRydPlayer } from './tv';
import { startPage } from './page';
export const start = startPage(
  (payload) => ipcRenderer.invoke('tubevra:ryd:control', payload),
  () => executeHookEntry(readRydPlayer),
);

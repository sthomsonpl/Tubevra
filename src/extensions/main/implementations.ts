import type { MainExtensionStart } from '../types';
import type { MainExtensionBridge } from './bridge';
// Assembled from catalog by the extension build plugin.
export const starts: Readonly<Record<string, MainExtensionStart>> = {};
export const connections: Readonly<Record<string, MainExtensionBridge>> = {};

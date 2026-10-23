import { contextBridge } from 'electron';

// The function body must contain its entire implementation after bundling.
// No eval, script elements, public window API or late-execution fallback.
export function executeHookEntry<T>(
  entry: (...args: any[]) => T,
  args: unknown[] = [],
): T {
  return contextBridge.executeInMainWorld({ func: entry, args });
}

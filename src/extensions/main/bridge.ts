import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { TubervaExtensions } from '../tuberva-extensions';

export interface ExtensionBridgeContext {
  ipc: IpcMain;
  engine: TubervaExtensions;
  trusted(event: IpcMainInvokeEvent): boolean;
  currentDocument(): string | null;
}
export interface ExtensionBridge {
  invalidate(): void;
  dispose(): void;
}
export type MainExtensionBridge = (
  context: ExtensionBridgeContext,
) => ExtensionBridge;

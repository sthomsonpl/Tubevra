export type ExtensionStatus = 'disabled' | 'starting' | 'active' | 'error';
export type ExtensionDiagnostics = Readonly<Record<string, string>>;
export interface ExtensionMetadata {
  id: string;
  name: string;
  description: string;
  modes: readonly ('tv' | 'desktop')[];
  defaultEnabled: boolean;
  main: boolean;
  page: boolean;
  hooks?: boolean;
}
export interface ExtensionState extends ExtensionMetadata {
  enabled: boolean;
  reloadRequired: boolean;
  reloadReason: string | null;
  layers: Partial<
    Record<
      'main' | 'page' | 'hooks',
      'disabled' | 'starting' | 'active' | 'error'
    >
  >;
  status: ExtensionStatus;
  error: string | null;
  /** Layer-owned diagnostic data never grants service authority. */
  diagnostics?: { main?: ExtensionDiagnostics; page?: ExtensionDiagnostics };
}
export interface ExtensionsState {
  revision: number;
  stateVersion: number;
  error: string | null;
  items: ExtensionState[];
}
export interface ExtensionCommand {
  id: string;
  enabled: boolean;
}
export interface RequestInfo {
  url: string;
  method: string;
  resourceType: string;
}
export type RequestRule = (request: Readonly<RequestInfo>) => 'allow' | 'block';
export type Cleanup = () => void | Promise<void>;
export interface MainExtensionContext {
  signal: AbortSignal;
  registerRule(rule: RequestRule): void;
  onCleanup(cleanup: Cleanup): void;
  /** Internal compiled-module service; never exposed as a renderer API. */
  registerService(service: unknown): void;
  registerPageDiagnostics(
    validate: (value: ExtensionDiagnostics) => boolean,
  ): void;
  reportDiagnostics(value: ExtensionDiagnostics): void;
}
export type MainExtensionStart = (
  context: MainExtensionContext,
) => Cleanup | Promise<Cleanup>;
export interface PageExtensionContext {
  document: Document;
  documentId: string;
  revision(): number;
  onRevision(listener: (revision: number) => void): void;
  signal: AbortSignal;
  onCleanup(cleanup: Cleanup): void;
  guard<T extends unknown[]>(
    callback: (...args: T) => unknown,
  ): (...args: T) => void;
  requireReload(): void;
  reportDiagnostics(value: ExtensionDiagnostics): void;
}
export type PageExtensionStart = (
  context: PageExtensionContext,
) => Cleanup | Promise<Cleanup>;

export interface PageConfiguration {
  document: string;
  revision: number;
  items: { id: string; enabled: boolean }[];
  hooks?: { id: string; enabled: boolean }[];
}
export interface PageReport {
  diagnostics?: ExtensionDiagnostics;
  layer: 'page';
  instance: string;
  reloadReason: string | null;
  document: string;
  revision: number;
  id: string;
  status: 'active' | 'disabled' | 'error';
  error: string | null;
}

// A hook must install synchronously. Cleanup's explicit undefined result excludes
// async functions; the runtime must also check results from untyped modules.
export type HookCleanup = () => undefined;
export interface HookExtensionContext {
  onCleanup(cleanup: HookCleanup): void;
  reportError(message: string): void;
  requireReload(reason: string): void;
  signal: AbortSignal;
  wrap(
    target: object,
    key: PropertyKey,
    intercept: (
      original: (...args: any[]) => any,
      receiver: unknown,
      args: unknown[],
    ) => unknown,
  ): void;
}
export type HookExtensionStart = (context: HookExtensionContext) => HookCleanup;

// All cross-world payloads are bounded, validated diagnostic data. They confer
// no authority to change configuration or issue application commands.
export interface HookReport {
  document: string;
  revision: number;
  id: string;
  instance: string;
  layer: 'hooks';
  status: 'active' | 'disabled' | 'error';
  error: string | null;
  reloadReason: string | null;
}

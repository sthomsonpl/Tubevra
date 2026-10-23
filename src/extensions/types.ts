export type ExtensionStatus =
  | 'disabled'
  | 'starting'
  | 'active'
  | 'error'
  | 'reload-required';
export interface ExtensionMetadata {
  id: string;
  name: string;
  description: string;
  modes: readonly ('tv' | 'desktop')[];
  defaultEnabled: boolean;
  main: boolean;
  page: boolean;
}
export interface ExtensionState extends ExtensionMetadata {
  enabled: boolean;
  status: ExtensionStatus;
  error: string | null;
}
export interface ExtensionsState {
  revision: number;
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
  registerRule(rule: RequestRule): void;
  onCleanup(cleanup: Cleanup): void;
}
export type MainExtensionStart = (
  context: MainExtensionContext,
) => Cleanup | Promise<Cleanup>;
// The document runtime will implement this contract in step 2.
export interface PageExtensionContext {
  document: Document;
  signal: AbortSignal;
  onCleanup(cleanup: Cleanup): void;
  guard<T extends unknown[]>(
    callback: (...args: T) => unknown,
  ): (...args: T) => void;
  requireReload(): void;
}
export type PageExtensionStart = (
  context: PageExtensionContext,
) => Cleanup | Promise<Cleanup>;

export interface PageConfiguration {
  document: string;
  revision: number;
  items: { id: string; enabled: boolean }[];
}
export interface PageReport {
  document: string;
  revision: number;
  id: string;
  status: 'active' | 'disabled' | 'error' | 'reload-required';
  error: string | null;
}

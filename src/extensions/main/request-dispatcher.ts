import type { RequestInfo, RequestRule } from '../types';

export interface RequestSource {
  onBeforeRequest(
    listener:
      | ((
          details: RequestInfo,
          callback: (response: { cancel: boolean }) => void,
        ) => void)
      | null,
  ): void;
}
export class RequestDispatcher {
  private rules = new Map<string, Set<RequestRule>>();
  constructor(
    private source: RequestSource,
    private onError: (id: string, error: unknown) => void,
  ) {
    source.onBeforeRequest((details, callback) => {
      let cancel = false;
      for (const [id, rules] of this.rules) {
        try {
          for (const rule of rules) {
            const decision = rule(
              Object.freeze({
                url: details.url,
                method: details.method,
                resourceType: details.resourceType,
              }),
            );
            if (decision !== 'allow' && decision !== 'block')
              throw new Error('Invalid request rule result.');
            if (decision === 'block') cancel = true;
          }
        } catch (cause) {
          this.remove(id);
          try {
            this.onError(id, cause);
          } catch (error) {
            console.error('Extension error reporting failed:', error);
          }
        }
      }
      callback({ cancel });
    });
  }
  register(id: string, rule: RequestRule) {
    if (!this.rules.has(id)) this.rules.set(id, new Set());
    this.rules.get(id)!.add(rule);
  }
  remove(id: string) {
    this.rules.delete(id);
  }
  dispose() {
    this.rules.clear();
    this.source.onBeforeRequest(null);
  }
}

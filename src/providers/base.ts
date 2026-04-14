import type { Provider, Session } from '../schema.js';

export interface ProviderAdapter {
  readonly provider: Provider;

  /**
   * Fast metadata extraction — reads at most ~200 lines from the file head.
   * Returns a Session with isFullyParsed=false and empty events[].
   */
  scanFile(filePath: string): Promise<Session>;

  /**
   * Full parse — populates the events array completely.
   * Returns a Session with isFullyParsed=true.
   */
  parseFile(filePath: string): Promise<Session>;
}

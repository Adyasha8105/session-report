import type { Provider } from '../schema.js';

export class ParseError extends Error {
  readonly filePath: string;
  readonly provider: Provider;
  override readonly cause: Error | undefined;

  constructor(filePath: string, provider: Provider, cause?: Error) {
    super(`Failed to parse ${provider} session: ${filePath}${cause ? ` — ${cause.message}` : ''}`);
    this.name = 'ParseError';
    this.filePath = filePath;
    this.provider = provider;
    this.cause = cause;
  }
}

export class DiscoveryError extends Error {
  readonly filePath: string;
  readonly provider: Provider;
  override readonly cause: Error | undefined;

  constructor(filePath: string, provider: Provider, cause?: Error) {
    super(`Discovery error for ${provider}: ${filePath}${cause ? ` — ${cause.message}` : ''}`);
    this.name = 'DiscoveryError';
    this.filePath = filePath;
    this.provider = provider;
    this.cause = cause;
  }
}

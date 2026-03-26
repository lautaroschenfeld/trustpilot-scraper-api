export const FetchMode = {
  HTTP: "http",
  BROWSER: "browser",
};

export const ScrapeErrorKind = {
  TIMEOUT: "timeout",
  RATE_LIMIT: "rate_limit",
  CLOUDFLARE: "cloudflare",
  HTML_CHANGED: "html_changed",
  PARSE_LOW_CONFIDENCE: "parse_low_confidence",
  NETWORK: "network",
  UNKNOWN: "unknown",
};

export class LiveScrapeException extends Error {
  constructor(message, { kind = ScrapeErrorKind.UNKNOWN, timedOut = false } = {}) {
    super(message);
    this.kind = kind;
    this.timedOut = timedOut;
  }
}

export class StrictDomainMatchError extends LiveScrapeException {}
export class SyncInProgressError extends Error {}


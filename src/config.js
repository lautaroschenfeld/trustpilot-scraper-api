const toNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  appName: process.env.APP_NAME || "Trustpilot Private API",
  appEnv: process.env.APP_ENV || "dev",
  port: toNumber(process.env.PORT, 8000),
  host: process.env.HOST || "0.0.0.0",
  apiBasePath: process.env.API_BASE_PATH || "/trustpilot",

  databaseUrl:
    process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/trustpilot",

  trustpilotBaseUrl: process.env.TRUSTPILOT_BASE_URL || "https://www.trustpilot.com",
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",

  httpTimeoutSeconds: toNumber(process.env.HTTP_TIMEOUT_SECONDS, 12),
  httpMaxRetries: toNumber(process.env.HTTP_MAX_RETRIES, 3),
  httpBackoffBaseSeconds: toFloat(process.env.HTTP_BACKOFF_BASE_SECONDS, 0.7),
  httpBackoffCapSeconds: toFloat(process.env.HTTP_BACKOFF_CAP_SECONDS, 8),

  circuitFailureThresholdHttp: toNumber(process.env.CIRCUIT_FAILURE_THRESHOLD_HTTP, 5),
  circuitFailureThresholdBrowser: toNumber(process.env.CIRCUIT_FAILURE_THRESHOLD_BROWSER, 3),
  circuitOpenSecondsHttp: toNumber(process.env.CIRCUIT_OPEN_SECONDS_HTTP, 900),
  circuitOpenSecondsBrowser: toNumber(process.env.CIRCUIT_OPEN_SECONDS_BROWSER, 600),

  profileMinConfidence: toFloat(process.env.PROFILE_MIN_CONFIDENCE, 0.82),
  reviewsMinConfidence: toFloat(process.env.REVIEWS_MIN_CONFIDENCE, 0.75),
  metricsMinConfidence: toFloat(process.env.METRICS_MIN_CONFIDENCE, 0.88),
  parserVersion: process.env.PARSER_VERSION || "2026-03-26.1",

  defaultPageSize: toNumber(process.env.DEFAULT_PAGE_SIZE, 50),
  maxPageSize: toNumber(process.env.MAX_PAGE_SIZE, 100),
};


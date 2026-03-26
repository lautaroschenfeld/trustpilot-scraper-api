import { config } from "../config.js";
import { FetchMode, ScrapeErrorKind } from "./types.js";

const detectCloudflare = ({ statusCode, headers, html }) => {
  const server = (headers.get("server") || "").toLowerCase();
  const hasCfRay = headers.has("cf-ray");
  if ((statusCode === 403 || statusCode === 503) && (hasCfRay || server === "cloudflare")) {
    return true;
  }
  const marker = (html || "").toLowerCase();
  return marker.includes("/cdn-cgi/") || marker.includes("just a moment");
};

const withTimeout = async (promiseFactory, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const buildProfileUrl = (domain) => `${config.trustpilotBaseUrl}/review/${domain}`;

export const buildReviewsUrl = (domain, page) =>
  page <= 1
    ? `${config.trustpilotBaseUrl}/review/${domain}`
    : `${config.trustpilotBaseUrl}/review/${domain}?page=${page}`;

export const fetchUrlHttp = async (url, timeoutSeconds) => {
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
  let response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch(url, {
          method: "GET",
          headers: {
            "user-agent": config.userAgent,
            "accept-language": "en-US,en;q=0.9",
          },
          redirect: "follow",
          signal,
        }),
      timeoutMs,
    );
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode: null,
      html: null,
      errorKind: isTimeout ? ScrapeErrorKind.TIMEOUT : ScrapeErrorKind.NETWORK,
      headers: new Map(),
      url,
    };
  }

  const html = await response.text();
  const statusCode = response.status;
  const headers = response.headers;

  if (statusCode === 429) {
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode,
      html,
      errorKind: ScrapeErrorKind.RATE_LIMIT,
      headers,
      url: response.url || url,
    };
  }

  if (detectCloudflare({ statusCode, headers, html })) {
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode,
      html,
      errorKind: ScrapeErrorKind.CLOUDFLARE,
      headers,
      url: response.url || url,
    };
  }

  if (statusCode >= 500) {
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode,
      html,
      errorKind: ScrapeErrorKind.NETWORK,
      headers,
      url: response.url || url,
    };
  }

  if (statusCode >= 400) {
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode,
      html,
      errorKind: ScrapeErrorKind.HTML_CHANGED,
      headers,
      url: response.url || url,
    };
  }

  return {
    ok: true,
    mode: FetchMode.HTTP,
    statusCode,
    html,
    errorKind: null,
    headers,
    url: response.url || url,
  };
};


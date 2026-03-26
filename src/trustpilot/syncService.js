import { config } from "../config.js";
import {
  getCompanyByDomain,
  markCompanyAttempt,
  markCompanyFailure,
  markCompanySuccess,
  upsertCompanyFromProfile,
} from "../db/repositories/companyRepository.js";
import {
  deleteMissingReviews,
  findExistingReviewIds,
  upsertReviews,
} from "../db/repositories/reviewRepository.js";
import { normalizeDomain } from "../normalization.js";
import { fetchUrlBrowser } from "./browserClient.js";
import { buildProfileUrl, buildReviewsUrl, fetchUrlHttp } from "./httpClient.js";
import { parseProfileHtml, parseReviewsHtml } from "./parsers.js";
import { CircuitBreaker, DomainSyncRegistry, retryBackoffDelayMs, sleep } from "./resilience.js";
import {
  FetchMode,
  LiveScrapeException,
  ScrapeErrorKind,
  StrictDomainMatchError,
  SyncInProgressError,
} from "./types.js";

export const globalBreaker = new CircuitBreaker();
export const globalSyncRegistry = new DomainSyncRegistry();

const extractDomainFromProfileUrl = (url) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "";
    if (!path.includes("/review/")) return null;
    const candidate = path.split("/review/")[1]?.split("/")[0];
    if (!candidate) return null;
    return normalizeDomain(candidate).normalizedDomain;
  } catch {
    return null;
  }
};

const isRetryable = (errorKind) =>
  errorKind === ScrapeErrorKind.TIMEOUT ||
  errorKind === ScrapeErrorKind.RATE_LIMIT ||
  errorKind === ScrapeErrorKind.CLOUDFLARE ||
  errorKind === ScrapeErrorKind.NETWORK;

export class TrustpilotSyncService {
  constructor({ db }) {
    this.db = db;
  }

  async refreshDomain({ domain, mode = "incremental", timeoutSeconds = 15, failIfLocked = false }) {
    const locked = await globalSyncRegistry.acquire(domain, failIfLocked);
    if (!locked) {
      throw new SyncInProgressError(`Sync already in progress for ${domain}`);
    }

    await markCompanyAttempt(this.db, domain);
    try {
      const output = await this.runSync({ domain, mode, timeoutSeconds });
      return {
        attempted: true,
        succeeded: true,
        errorKind: null,
        timedOut: false,
        profileUpdated: true,
        upsertedReviews: output.upsertedReviews,
        removedReviews: output.removedReviews,
        lastSuccessfulSyncAt: output.lastSuccessfulSyncAt,
      };
    } catch (error) {
      if (error instanceof StrictDomainMatchError) {
        await markCompanyFailure(this.db, domain, "failed_not_found");
        throw error;
      }
      if (error instanceof LiveScrapeException) {
        await markCompanyFailure(this.db, domain, `failed_${error.kind}`);
        const company = await getCompanyByDomain(this.db, domain);
        return {
          attempted: true,
          succeeded: false,
          errorKind: error.kind,
          timedOut: !!error.timedOut,
          profileUpdated: false,
          upsertedReviews: 0,
          removedReviews: 0,
          lastSuccessfulSyncAt: company?.lastSuccessfulSyncAt || null,
        };
      }

      await markCompanyFailure(this.db, domain, "failed_internal");
      const company = await getCompanyByDomain(this.db, domain);
      return {
        attempted: true,
        succeeded: false,
        errorKind: ScrapeErrorKind.UNKNOWN,
        timedOut: false,
        profileUpdated: false,
        upsertedReviews: 0,
        removedReviews: 0,
        lastSuccessfulSyncAt: company?.lastSuccessfulSyncAt || null,
      };
    } finally {
      globalSyncRegistry.release(domain);
    }
  }

  async runSync({ domain, mode, timeoutSeconds }) {
    const profileFetch = await this.fetchWithFallback({
      domain,
      url: buildProfileUrl(domain),
      timeoutSeconds,
    });

    if (!profileFetch.ok || !profileFetch.html) {
      if (profileFetch.statusCode === 404 || profileFetch.statusCode === 410) {
        throw new StrictDomainMatchError(
          "No exact Trustpilot profile match for the requested domain.",
          { kind: ScrapeErrorKind.HTML_CHANGED },
        );
      }
      throw new LiveScrapeException("Profile fetch failed.", {
        kind: profileFetch.errorKind || ScrapeErrorKind.NETWORK,
        timedOut: profileFetch.errorKind === ScrapeErrorKind.TIMEOUT,
      });
    }

    const fetchedDomain = extractDomainFromProfileUrl(profileFetch.url);
    if (fetchedDomain !== domain) {
      throw new StrictDomainMatchError("No exact Trustpilot profile match for the requested domain.", {
        kind: ScrapeErrorKind.HTML_CHANGED,
      });
    }

    const profile = parseProfileHtml({
      domain,
      rawHtml: profileFetch.html,
      finalUrl: profileFetch.url,
    });

    if (profile.confidence < config.profileMinConfidence) {
      throw new LiveScrapeException("Profile parser confidence is too low.", {
        kind: ScrapeErrorKind.PARSE_LOW_CONFIDENCE,
      });
    }
    if (profile.warnings.includes("domain_mismatch") || profile.warnings.includes("possible_not_found")) {
      throw new StrictDomainMatchError("No exact Trustpilot profile match for the requested domain.", {
        kind: ScrapeErrorKind.HTML_CHANGED,
      });
    }

    await upsertCompanyFromProfile(this.db, {
      domain,
      profilePayload: profile.data,
      parserVersion: profile.parserVersion,
      rawProfileHtml: profileFetch.html,
      rawProfileJson: profile.data,
    });

    const scrapedReviews = [];
    const keepIds = new Set();
    let seenKnown = false;
    const maxPages = mode === "full" ? 200 : 50;

    for (let page = 1; page <= maxPages; page += 1) {
      const pageFetch = await this.fetchWithFallback({
        domain,
        url: buildReviewsUrl(domain, page),
        timeoutSeconds,
      });
      if (!pageFetch.ok || !pageFetch.html) {
        if (page === 1) {
          throw new LiveScrapeException("Review fetch failed.", {
            kind: pageFetch.errorKind || ScrapeErrorKind.NETWORK,
            timedOut: pageFetch.errorKind === ScrapeErrorKind.TIMEOUT,
          });
        }
        break;
      }

      const parsed = parseReviewsHtml({ rawHtml: pageFetch.html, page });
      let pageReviews = parsed.data.reviews || [];
      if (pageReviews.length === 0) break;

      if (parsed.confidence < config.reviewsMinConfidence) {
        if (page === 1) {
          throw new LiveScrapeException("Reviews parser confidence is too low.", {
            kind: ScrapeErrorKind.PARSE_LOW_CONFIDENCE,
          });
        }
        break;
      }

      const pageIds = pageReviews.map((item) => item.review_id);
      const existingIds = await findExistingReviewIds(this.db, { domain, reviewIds: pageIds });
      if (mode === "incremental" && existingIds.size > 0) {
        seenKnown = true;
        pageReviews = pageReviews.filter((item) => !existingIds.has(item.review_id));
      }

      for (const review of pageReviews) {
        scrapedReviews.push(review);
        keepIds.add(review.review_id);
      }

      if (mode === "incremental" && seenKnown) break;
    }

    const upsertedReviews = await upsertReviews(this.db, {
      domain,
      reviews: scrapedReviews,
      parserVersion: config.parserVersion,
    });

    let removedReviews = 0;
    const parsedCountHint = profile.data.reputation?.review_count;
    const shouldPruneFull = keepIds.size > 0 || parsedCountHint === 0;
    if (mode === "full" && shouldPruneFull) {
      removedReviews = await deleteMissingReviews(this.db, { domain, keepIds });
    }

    await markCompanySuccess(this.db, domain, config.parserVersion);
    const company = await getCompanyByDomain(this.db, domain);
    return {
      upsertedReviews,
      removedReviews,
      lastSuccessfulSyncAt: company?.lastSuccessfulSyncAt || new Date(),
    };
  }

  async fetchWithFallback({ domain, url, timeoutSeconds }) {
    let lastResult = null;

    if (globalBreaker.allow(domain, FetchMode.HTTP)) {
      for (let attempt = 0; attempt < config.httpMaxRetries; attempt += 1) {
        const result = await fetchUrlHttp(url, timeoutSeconds);
        if (result.ok) {
          globalBreaker.recordSuccess(domain, FetchMode.HTTP);
          return result;
        }

        lastResult = result;
        if (result.statusCode === 404 || result.statusCode === 410) {
          return result;
        }

        if (attempt < config.httpMaxRetries - 1 && isRetryable(result.errorKind)) {
          await sleep(retryBackoffDelayMs(attempt));
          continue;
        }
        break;
      }
      globalBreaker.recordFailure(domain, FetchMode.HTTP);
    }

    if (globalBreaker.allow(domain, FetchMode.BROWSER)) {
      const browserResult = await fetchUrlBrowser(url, timeoutSeconds);
      if (browserResult.ok) {
        globalBreaker.recordSuccess(domain, FetchMode.BROWSER);
        return browserResult;
      }
      lastResult = browserResult;
      globalBreaker.recordFailure(domain, FetchMode.BROWSER);
    }

    if (lastResult) return lastResult;
    return {
      ok: false,
      mode: FetchMode.HTTP,
      statusCode: null,
      html: null,
      errorKind: ScrapeErrorKind.NETWORK,
      headers: new Map(),
      url,
    };
  }
}

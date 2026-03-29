import { config } from "../config.js";
import { conflictError, notFoundError, upstreamError, upstreamTimeoutError } from "../errors.js";
import { toIsoOrNull } from "../response.js";
import {
  getCompanyByDomain,
} from "../db/repositories/companyRepository.js";
import {
  buildMetrics,
  getReviewById,
  listReviews,
} from "../db/repositories/reviewRepository.js";
import { globalSyncRegistry, TrustpilotSyncService } from "./syncService.js";
import { StrictDomainMatchError, SyncInProgressError } from "./types.js";

const freshnessFrom = ({ liveResult, company }) => {
  let source = "database_cache";
  let servedFromCache = true;
  if (liveResult.attempted && liveResult.succeeded) {
    source = "database_after_live_refresh";
    servedFromCache = false;
  } else if (liveResult.attempted && liveResult.errorKind) {
    source = "database_fallback_after_live_failure";
    servedFromCache = true;
  }

  return {
    source,
    liveRefreshAttempted: !!liveResult.attempted,
    liveRefreshSucceeded: !!liveResult.succeeded,
    servedFromCache,
    lastSuccessfulSyncAt: company?.lastSuccessfulSyncAt || liveResult.lastSuccessfulSyncAt || null,
  };
};

const companyToProfile = (company) => ({
  name: company.name,
  domain: company.domain,
  profile: {
    url: company.trustpilotProfileUrl,
    claimed: company.claimed,
  },
  reputation: {
    trust_score: company.trustScore,
    rating_label: company.ratingLabel,
    review_count: company.reviewCount,
    rating_distribution: company.ratingDistribution || [],
  },
  about: {
    description: company.description,
    website: company.website,
    country: company.country,
    category: company.category,
  },
  contact: {
    website: company.website,
    email: null,
    country: company.country,
  },
});

export const countryCodeToFlagEmoji = (countryCode) => {
  if (typeof countryCode !== "string") return null;
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  const REGIONAL_INDICATOR_BASE = 127397;
  return String.fromCodePoint(
    ...normalized.split("").map((char) => char.charCodeAt(0) + REGIONAL_INDICATOR_BASE)
  );
};

const mapReviewPayload = (row, includeReplies) => {
  const reply =
    includeReplies && (row.replyBody || row.replyPublishedAt)
      ? {
          body: row.replyBody,
          published_at: toIsoOrNull(row.replyPublishedAt),
        }
      : null;
  return {
    review_id: row.reviewId,
    url: row.url,
    title: row.title,
    body: row.body,
    rating: row.rating,
    published_at: toIsoOrNull(row.publishedAt),
    experienced_at: row.experiencedAt ? String(row.experiencedAt) : null,
    reviewer: {
      display_name: row.reviewerDisplayName,
      country_code: row.reviewerCountryCode,
      country_emoji: countryCodeToFlagEmoji(row.reviewerCountryCode),
      review_count: row.reviewerReviewCount,
    },
    verification: {
      verified: row.verified,
      invited: row.invited,
      label: row.verified ? "Verified" : null,
    },
    reply: includeReplies ? reply : null,
  };
};

export class TrustpilotQueryService {
  constructor({ db }) {
    this.db = db;
    this.syncService = new TrustpilotSyncService({ db });
  }

  async refreshIfNeeded({ domain, refresh, waitForRefresh, timeoutSeconds }) {
    if (refresh === "cache_only") {
      const cachedCompany = await getCompanyByDomain(this.db, domain);
      return {
        attempted: false,
        succeeded: false,
        errorKind: null,
        timedOut: false,
        lastSuccessfulSyncAt: cachedCompany?.lastSuccessfulSyncAt || null,
      };
    }

    const cachedCompany = await getCompanyByDomain(this.db, domain);
    const mustWait = waitForRefresh || !cachedCompany;
    const mode = refresh === "force" ? "full" : "incremental";

    if (mustWait) {
      try {
        return await this.syncService.refreshDomain({
          domain,
          mode,
          timeoutSeconds,
        });
      } catch (error) {
        if (error instanceof StrictDomainMatchError) {
          throw notFoundError({
            code: "profile_not_found",
            message: "No exact Trustpilot profile match for this domain.",
          });
        }
        if (error instanceof SyncInProgressError) {
          throw conflictError({
            code: "sync_in_progress",
            message: "A sync for this domain is already in progress.",
          });
        }
        throw error;
      }
    }

    setImmediate(async () => {
      try {
        await this.syncService.refreshDomain({
          domain,
          mode,
          timeoutSeconds,
          failIfLocked: true,
        });
      } catch {
        // Background refresh is best effort.
      }
    });

    return {
      attempted: true,
      succeeded: false,
      errorKind: null,
      timedOut: false,
      lastSuccessfulSyncAt: cachedCompany?.lastSuccessfulSyncAt || null,
    };
  }

  async getProfile({ domain, refresh, waitForRefresh, timeoutSeconds }) {
    const liveResult = await this.refreshIfNeeded({
      domain,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });
    const company = await getCompanyByDomain(this.db, domain);
    if (!company) {
      if (refresh === "cache_only") {
        throw notFoundError({
          code: "cache_not_found",
          message: "No cached profile exists for this domain.",
        });
      }
      if (liveResult.timedOut) {
        throw upstreamTimeoutError();
      }
      throw upstreamError({
        code: "live_scrape_failed_no_cache",
        message: "Live scrape failed and no database snapshot exists.",
      });
    }
    const freshness = freshnessFrom({ liveResult, company });
    return { data: companyToProfile(company), freshness };
  }

  async getReviews({
    domain,
    filters,
    refresh,
    waitForRefresh,
    timeoutSeconds,
  }) {
    const liveResult = await this.refreshIfNeeded({
      domain,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });
    const company = await getCompanyByDomain(this.db, domain);
    const { rows, total } = await listReviews(this.db, {
      domain,
      page: filters.page,
      pageSize: filters.page_size,
      minRating: filters.min_rating,
      maxRating: filters.max_rating,
      hasReply: filters.has_reply,
      dateFrom: filters.date_from,
      dateTo: filters.date_to,
      sort: filters.sort,
    });
    if (!company && total === 0) {
      if (refresh === "cache_only") {
        throw notFoundError({
          code: "cache_not_found",
          message: "No cached reviews exist for this domain.",
        });
      }
      if (liveResult.timedOut) {
        throw upstreamTimeoutError();
      }
      throw upstreamError({
        code: "live_scrape_failed_no_cache",
        message: "Live scrape failed and no database snapshot exists.",
      });
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / filters.page_size);
    const pagination = {
      page: filters.page,
      page_size: filters.page_size,
      total_items: total,
      total_pages: totalPages,
      has_next_page: filters.page < totalPages,
    };
    const data = rows.map((row) => mapReviewPayload(row, filters.include_replies));
    const freshness = freshnessFrom({ liveResult, company });
    return { data, pagination, freshness };
  }

  async getReview({ reviewId, includeReply }) {
    const review = await getReviewById(this.db, reviewId);
    if (!review) {
      throw notFoundError({
        code: "review_not_found",
        message: "Review not found.",
      });
    }
    return mapReviewPayload(review, includeReply);
  }

  async getMetrics({ domain, refresh, waitForRefresh, timeoutSeconds }) {
    const liveResult = await this.refreshIfNeeded({
      domain,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });
    const company = await getCompanyByDomain(this.db, domain);
    const metrics = await buildMetrics(this.db, { domain });
    const hasAnyData = !!company || metrics.review_count > 0;
    if (!hasAnyData) {
      if (refresh === "cache_only") {
        throw notFoundError({
          code: "cache_not_found",
          message: "No cached metrics exist for this domain.",
        });
      }
      if (liveResult.timedOut) {
        throw upstreamTimeoutError();
      }
      throw upstreamError({
        code: "live_scrape_failed_no_cache",
        message: "Live scrape failed and no database snapshot exists.",
      });
    }
    if (company) {
      metrics.trust_score = company.trustScore;
      metrics.rating_label = company.ratingLabel;
      if (Array.isArray(company.ratingDistribution) && company.ratingDistribution.length > 0) {
        metrics.rating_distribution = company.ratingDistribution;
      }
    } else {
      metrics.trust_score = null;
      metrics.rating_label = null;
    }
    const freshness = freshnessFrom({ liveResult, company });
    return { data: metrics, freshness };
  }

  async syncNow({ domain, mode, wait, timeoutSeconds }) {
    if (wait) {
      try {
        const result = await this.syncService.refreshDomain({
          domain,
          mode,
          timeoutSeconds,
          failIfLocked: true,
        });
        if (!result.succeeded) {
          if (result.timedOut) {
            throw upstreamTimeoutError({
              message: "Live refresh timed out during sync and no fresh data is available.",
            });
          }
          throw upstreamError({
            code: "live_scrape_failed",
            message: "Live scrape failed during sync.",
          });
        }
        const company = await getCompanyByDomain(this.db, domain);
        const freshness = freshnessFrom({ liveResult: result, company });
        return {
          data: {
            domain,
            mode,
            status: "success",
            upserted_reviews: result.upsertedReviews,
            removed_reviews: result.removedReviews,
            profile_updated: result.profileUpdated,
          },
          freshness,
        };
      } catch (error) {
        if (error instanceof SyncInProgressError) {
          throw conflictError({
            code: "sync_in_progress",
            message: "A sync for this domain is already in progress.",
          });
        }
        if (error instanceof StrictDomainMatchError) {
          throw notFoundError({
            code: "profile_not_found",
            message: "No exact Trustpilot profile match for this domain.",
          });
        }
        throw error;
      }
    }

    if (globalSyncRegistry.isBusy(domain)) {
      throw conflictError({
        code: "sync_in_progress",
        message: "A sync for this domain is already in progress.",
      });
    }

    setImmediate(async () => {
      try {
        await this.syncService.refreshDomain({
          domain,
          mode,
          timeoutSeconds,
          failIfLocked: true,
        });
      } catch {
        // Best effort background sync.
      }
    });

    return {
      data: {
        domain,
        mode,
        status: "attempted",
        upserted_reviews: 0,
        removed_reviews: 0,
        profile_updated: false,
      },
      freshness: null,
    };
  }
}

export const validRefreshModes = new Set(["live", "force", "cache_only"]);
export const validSortModes = new Set(["newest", "oldest", "highest_rating", "lowest_rating"]);
export const validSyncModes = new Set(["incremental", "full"]);

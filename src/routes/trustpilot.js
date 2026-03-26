import { pool } from "../db/pool.js";
import { freshnessToPayload } from "../freshness.js";
import { normalizeDomain } from "../normalization.js";
import { buildMeta, buildResponse } from "../response.js";
import {
  TrustpilotQueryService,
  validRefreshModes,
  validSortModes,
  validSyncModes,
} from "../trustpilot/queryService.js";
import { unprocessableError, validationError } from "../errors.js";

const parseBoolean = (value, fallback, field, details) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (field && Array.isArray(details)) {
    details.push({ field, issue: "must_be_boolean" });
  }
  return fallback;
};

const parseInteger = (value, fallback, field, details) => {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    if (field && Array.isArray(details)) {
      details.push({ field, issue: "must_be_integer" });
    }
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  if (field && Array.isArray(details)) {
    details.push({ field, issue: "must_be_integer" });
  }
  return fallback;
};

const parseDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const asDate = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  return text;
};

const assertRefreshMode = (value) => {
  const mode = value || "live";
  if (!validRefreshModes.has(mode)) {
    throw unprocessableError({
      code: "invalid_filters",
      message: "Invalid refresh mode.",
      details: [{ field: "refresh", issue: "invalid_enum" }],
    });
  }
  return mode;
};

const assertTimeoutSeconds = (value, fallback, min, max) => {
  const details = [];
  const parsed = parseInteger(value, fallback, "timeout_seconds", details);
  if (details.length > 0) {
    throw unprocessableError({
      code: "invalid_filters",
      message: "Invalid timeout_seconds value.",
      details,
    });
  }
  if (parsed < min || parsed > max) {
    throw unprocessableError({
      code: "invalid_filters",
      message: "Invalid timeout_seconds value.",
      details: [{ field: "timeout_seconds", issue: `must_be_${min}_to_${max}` }],
    });
  }
  return parsed;
};

const defaultServiceFactory = () => new TrustpilotQueryService({ db: pool });

export async function trustpilotRoutes(fastify, opts = {}) {
  const serviceFactory = opts.serviceFactory || defaultServiceFactory;

  fastify.get("/profile", async (request, reply) => {
    const details = [];
    const domain = normalizeDomain(request.query?.domain || "").normalizedDomain;
    const refresh = assertRefreshMode(request.query?.refresh);
    const waitForRefresh = parseBoolean(request.query?.wait_for_refresh, true, "wait_for_refresh", details);
    const timeoutSeconds = assertTimeoutSeconds(request.query?.timeout_seconds, 12, 1, 60);
    if (details.length > 0) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid profile filters.",
        details,
      });
    }
    const service = serviceFactory();
    const { data, freshness } = await service.getProfile({
      domain,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });
    return reply.send(
      buildResponse({
        data,
        meta: buildMeta({
          requestId: request.id,
          source: freshness.source,
          extra: { freshness: freshnessToPayload(freshness) },
        }),
      }),
    );
  });

  fastify.get("/reviews", async (request, reply) => {
    const details = [];
    const domain = normalizeDomain(request.query?.domain || "").normalizedDomain;
    const page = parseInteger(request.query?.page, 1, "page", details);
    const pageSize = parseInteger(request.query?.page_size, 50, "page_size", details);
    const minRatingRaw = request.query?.min_rating;
    const maxRatingRaw = request.query?.max_rating;
    const minRating =
      minRatingRaw === undefined
        ? null
        : parseInteger(minRatingRaw, Number.NaN, "min_rating", details);
    const maxRating =
      maxRatingRaw === undefined
        ? null
        : parseInteger(maxRatingRaw, Number.NaN, "max_rating", details);
    const hasReply =
      request.query?.has_reply === undefined
        ? null
        : parseBoolean(request.query?.has_reply, null, "has_reply", details);
    const includeReplies = parseBoolean(
      request.query?.include_replies,
      true,
      "include_replies",
      details,
    );
    const dateFrom = parseDate(request.query?.date_from);
    const dateTo = parseDate(request.query?.date_to);
    const sort = request.query?.sort || "newest";
    const refresh = assertRefreshMode(request.query?.refresh);
    const waitForRefresh = parseBoolean(
      request.query?.wait_for_refresh,
      true,
      "wait_for_refresh",
      details,
    );
    const timeoutSeconds = assertTimeoutSeconds(request.query?.timeout_seconds, 15, 1, 60);

    if (page < 1) details.push({ field: "page", issue: "must_be_greater_than_or_equal_to_1" });
    if (pageSize < 1 || pageSize > 100) {
      details.push({ field: "page_size", issue: "must_be_1_to_100" });
    }
    if (minRating !== null && (!Number.isFinite(minRating) || minRating < 1 || minRating > 5)) {
      details.push({ field: "min_rating", issue: "must_be_1_to_5" });
    }
    if (maxRating !== null && (!Number.isFinite(maxRating) || maxRating < 1 || maxRating > 5)) {
      details.push({ field: "max_rating", issue: "must_be_1_to_5" });
    }
    if (
      minRating !== null &&
      maxRating !== null &&
      Number.isFinite(minRating) &&
      Number.isFinite(maxRating) &&
      maxRating < minRating
    ) {
      details.push({ field: "max_rating", issue: "must_be_greater_than_or_equal_to_min_rating" });
    }
    if (request.query?.date_from && !dateFrom) {
      details.push({ field: "date_from", issue: "invalid_date_format" });
    }
    if (request.query?.date_to && !dateTo) {
      details.push({ field: "date_to", issue: "invalid_date_format" });
    }
    if (dateFrom && dateTo && dateTo < dateFrom) {
      details.push({ field: "date_to", issue: "must_be_greater_than_or_equal_to_date_from" });
    }
    if (!validSortModes.has(sort)) {
      details.push({ field: "sort", issue: "invalid_enum" });
    }
    if (details.length > 0) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid review filters.",
        details,
      });
    }

    const service = serviceFactory();
    const filters = {
      page,
      page_size: pageSize,
      min_rating: minRating,
      max_rating: maxRating,
      has_reply: hasReply,
      include_replies: includeReplies,
      date_from: dateFrom,
      date_to: dateTo,
      sort,
    };
    const { data, pagination, freshness } = await service.getReviews({
      domain,
      filters,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });

    return reply.send(
      buildResponse({
        data,
        pagination,
        meta: buildMeta({
          requestId: request.id,
          extra: {
            applied_filters: {
              domain,
              min_rating: filters.min_rating,
              max_rating: filters.max_rating,
              has_reply: filters.has_reply,
              include_replies: filters.include_replies,
              date_from: filters.date_from,
              date_to: filters.date_to,
              sort: filters.sort,
            },
            freshness: freshnessToPayload(freshness),
          },
        }),
      }),
    );
  });

  fastify.get("/review", async (request, reply) => {
    const details = [];
    const reviewId = request.query?.review_id;
    if (!reviewId || String(reviewId).length > 64) {
      throw validationError({
        code: "invalid_input",
        message: "The 'review_id' query parameter is required and must be <= 64 chars.",
        details: [{ field: "review_id", issue: "required_or_invalid_length" }],
      });
    }
    const includeReply = parseBoolean(request.query?.include_reply, true, "include_reply", details);
    if (details.length > 0) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid review filters.",
        details,
      });
    }
    const service = serviceFactory();
    const data = await service.getReview({
      reviewId: String(reviewId),
      includeReply,
    });
    return reply.send(
      buildResponse({
        data,
        meta: buildMeta({ requestId: request.id }),
      }),
    );
  });

  fastify.get("/metrics", async (request, reply) => {
    const details = [];
    const domain = normalizeDomain(request.query?.domain || "").normalizedDomain;
    const refresh = assertRefreshMode(request.query?.refresh);
    const waitForRefresh = parseBoolean(
      request.query?.wait_for_refresh,
      true,
      "wait_for_refresh",
      details,
    );
    const timeoutSeconds = assertTimeoutSeconds(request.query?.timeout_seconds, 12, 1, 60);
    if (details.length > 0) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid metrics filters.",
        details,
      });
    }
    const service = serviceFactory();
    const { data, freshness } = await service.getMetrics({
      domain,
      refresh,
      waitForRefresh,
      timeoutSeconds,
    });
    return reply.send(
      buildResponse({
        data,
        meta: buildMeta({
          requestId: request.id,
          extra: { freshness: freshnessToPayload(freshness) },
        }),
      }),
    );
  });

  fastify.post("/sync", async (request, reply) => {
    const details = [];
    const domain = normalizeDomain(request.query?.domain || "").normalizedDomain;
    const mode = request.query?.mode || "incremental";
    const wait = parseBoolean(request.query?.wait, true, "wait", details);
    const timeoutSeconds = assertTimeoutSeconds(request.query?.timeout_seconds, 30, 1, 120);
    if (!validSyncModes.has(mode)) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid sync mode.",
        details: [{ field: "mode", issue: "invalid_enum" }],
      });
    }
    if (details.length > 0) {
      throw unprocessableError({
        code: "invalid_filters",
        message: "Invalid sync filters.",
        details,
      });
    }

    const service = serviceFactory();
    const { data, freshness } = await service.syncNow({
      domain,
      mode,
      wait,
      timeoutSeconds,
    });

    return reply.send(
      buildResponse({
        data,
        meta: buildMeta({
          requestId: request.id,
          extra: freshness ? { freshness: freshnessToPayload(freshness) } : undefined,
        }),
      }),
    );
  });
}

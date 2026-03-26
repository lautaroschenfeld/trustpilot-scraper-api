import test from "node:test";
import assert from "node:assert/strict";

import Fastify from "fastify";

import { trustpilotRoutes } from "../src/routes/trustpilot.js";
import { AppError, buildErrorPayload } from "../src/errors.js";

const buildTestApp = async () => {
  const app = Fastify();

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(buildErrorPayload(request.id, error));
      return;
    }
    const fallback = new AppError();
    reply.status(500).send(buildErrorPayload(request.id, fallback));
  });

  const fakeServiceFactory = () => ({
    async getProfile({ domain }) {
      return {
        data: {
          name: "Google",
          domain,
          profile: { url: `https://www.trustpilot.com/review/${domain}`, claimed: true },
          reputation: {
            trust_score: 4.2,
            rating_label: "Great",
            review_count: 10,
            rating_distribution: [],
          },
          about: { description: "desc", website: `https://${domain}`, country: "US", category: null },
          contact: { website: `https://${domain}`, email: null, country: "US" },
        },
        freshness: {
          source: "database_after_live_refresh",
          liveRefreshAttempted: true,
          liveRefreshSucceeded: true,
          servedFromCache: false,
          lastSuccessfulSyncAt: new Date(),
        },
      };
    },
    async getReviews() {
      return {
        data: [],
        pagination: { page: 1, page_size: 50, total_items: 0, total_pages: 0, has_next_page: false },
        freshness: {
          source: "database_cache",
          liveRefreshAttempted: false,
          liveRefreshSucceeded: false,
          servedFromCache: true,
          lastSuccessfulSyncAt: null,
        },
      };
    },
    async getReview({ reviewId }) {
      return {
        review_id: reviewId,
        url: `https://www.trustpilot.com/reviews/${reviewId}`,
        title: null,
        body: null,
        rating: null,
        published_at: null,
        experienced_at: null,
        reviewer: { display_name: null, country_code: null, review_count: null },
        verification: { verified: null, invited: null, label: null },
        reply: null,
      };
    },
    async getMetrics() {
      return {
        data: {
          review_count: 0,
          trust_score: null,
          rating_label: null,
          rating_distribution: [],
          reply_count: 0,
          verified_count: 0,
          unverified_count: 0,
          average_rating: 0,
        },
        freshness: {
          source: "database_cache",
          liveRefreshAttempted: false,
          liveRefreshSucceeded: false,
          servedFromCache: true,
          lastSuccessfulSyncAt: null,
        },
      };
    },
    async syncNow({ domain, mode }) {
      return {
        data: {
          domain,
          mode,
          status: "success",
          upserted_reviews: 1,
          removed_reviews: 0,
          profile_updated: true,
        },
        freshness: {
          source: "database_after_live_refresh",
          liveRefreshAttempted: true,
          liveRefreshSucceeded: true,
          servedFromCache: false,
          lastSuccessfulSyncAt: new Date(),
        },
      };
    },
  });

  await app.register(trustpilotRoutes, {
    prefix: "/trustpilot",
    serviceFactory: fakeServiceFactory,
  });
  await app.ready();
  return app;
};

test("profile missing domain returns 400", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/trustpilot/profile" });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error.code, "missing_domain");
  await app.close();
});

test("reviews invalid range returns 422", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "GET",
    url: "/trustpilot/reviews?domain=google.com&min_rating=5&max_rating=1",
  });
  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.error.code, "invalid_filters");
  await app.close();
});

test("sync contract shape", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/trustpilot/sync?domain=google.com&mode=incremental&wait=true",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.data.status, "success");
  assert.equal(typeof body.meta.request_id, "string");
  await app.close();
});

test("profile invalid boolean filter returns 422", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "GET",
    url: "/trustpilot/profile?domain=google.com&wait_for_refresh=abc",
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "invalid_filters");
  await app.close();
});

test("reviews invalid include_replies returns 422", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "GET",
    url: "/trustpilot/reviews?domain=google.com&include_replies=abc",
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "invalid_filters");
  await app.close();
});

test("reviews invalid date format returns 422", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "GET",
    url: "/trustpilot/reviews?domain=google.com&date_from=2026-1-1",
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "invalid_filters");
  await app.close();
});

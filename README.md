# Trustpilot Scraper API

Private API to fetch Trustpilot company data using only `domain` as public input.

Designed for high usage with a minimal Node stack and stable response contracts.

## Why this API

This project solves the hard parts behind Trustpilot scraping:

- strict domain normalization (dirty input -> registrable domain)
- strict profile matching (no guessing, no fuzzy fallback)
- scraper-first refresh + DB fallback
- retries with backoff + jitter
- temporary circuit breaker on repeated failures
- confidence-gated parsing to avoid corrupt DB writes
- latest-known-state persistence (no history versions)

## Minimal stack

Only the essentials:

- Node.js 20
- Fastify (HTTP API)
- pg (PostgreSQL driver)
- tldts (public suffix / registrable domain)
- Playwright (browser fallback only)

No ORM, no heavy validation framework, no queue framework by default.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Configure env

```bash
cp .env.example .env
```

3. Create DB tables

```bash
psql -d trustpilot -f scripts/init_schema.sql
```

4. Install browser fallback runtime

```bash
npx playwright install chromium
```

5. Run API

```bash
npm run dev
```

Production:

```bash
npm start
```

Base URL (default):

- `http://localhost:8000/trustpilot`

Health endpoint:

- `GET /health`

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8000` | HTTP port |
| `HOST` | No | `0.0.0.0` | Bind host |
| `API_BASE_PATH` | No | `/trustpilot` | API prefix |
| `DATABASE_URL` | No* | `postgresql://postgres:postgres@localhost:5432/trustpilot` | PostgreSQL connection |
| `TRUSTPILOT_BASE_URL` | No | `https://www.trustpilot.com` | Trustpilot base URL |
| `USER_AGENT` | No | Chrome-like UA | Scraper user-agent |
| `HTTP_TIMEOUT_SECONDS` | No | `12` | HTTP request timeout |
| `HTTP_MAX_RETRIES` | No | `3` | HTTP retries |
| `HTTP_BACKOFF_BASE_SECONDS` | No | `0.7` | Retry backoff base |
| `HTTP_BACKOFF_CAP_SECONDS` | No | `8` | Retry backoff cap |
| `CIRCUIT_FAILURE_THRESHOLD_HTTP` | No | `5` | HTTP breaker threshold |
| `CIRCUIT_FAILURE_THRESHOLD_BROWSER` | No | `3` | Browser breaker threshold |
| `CIRCUIT_OPEN_SECONDS_HTTP` | No | `900` | HTTP breaker cooldown |
| `CIRCUIT_OPEN_SECONDS_BROWSER` | No | `600` | Browser breaker cooldown |
| `PROFILE_MIN_CONFIDENCE` | No | `0.82` | Profile parser threshold |
| `REVIEWS_MIN_CONFIDENCE` | No | `0.75` | Reviews parser threshold |
| `METRICS_MIN_CONFIDENCE` | No | `0.88` | Metrics parser threshold |
| `PARSER_VERSION` | No | `2026-03-26.1` | Stored parser version |

\*Set explicit values in production.

## Public endpoints

- `GET /trustpilot/profile?domain=...`
- `GET /trustpilot/reviews?domain=...`
- `GET /trustpilot/review?review_id=...`
- `GET /trustpilot/metrics?domain=...`
- `POST /trustpilot/sync?domain=...&mode=incremental|full`

## Domain normalization

Accepted dirty input examples:

- `google.com`
- `www.google.com`
- `www.google.com/ads`
- `https://www.google.com/ads?x=1`

All normalize to:

- `google.com`

Rules:

1. trim + lowercase
2. remove protocol/path/query/hash/port
3. strip `www.`
4. convert IDN to ASCII
5. extract registrable domain via public suffix rules
6. reject IPs, wildcard, invalid labels, email-like input

Strict matching:

- exact registrable domain only
- no profile guessing
- no fuzzy matching

## Refresh behavior

For `profile`, `reviews`, `metrics`:

1. normalize `domain`
2. try live scrape first
3. if live success -> persist and respond latest DB state
4. if live fails -> serve latest DB snapshot
5. if no DB snapshot exists -> return error (`502`/`504`)

Refresh controls:

- `refresh=live|force|cache_only`
- `wait_for_refresh=true|false`
- `timeout_seconds`

## Response contract

No `ok: true` is used.

Success shape:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_xxx",
    "generated_at": "2026-03-26T21:10:00Z"
  }
}
```

Paginated success (`/reviews`):

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total_items": 0,
    "total_pages": 0,
    "has_next_page": false
  },
  "meta": {
    "request_id": "req_xxx",
    "generated_at": "2026-03-26T21:12:00Z"
  }
}
```

Error shape:

```json
{
  "error": {
    "type": "validation_error",
    "code": "missing_domain",
    "message": "The 'domain' query parameter is required.",
    "details": [
      { "field": "domain", "issue": "required" }
    ]
  },
  "meta": {
    "request_id": "req_xxx",
    "generated_at": "2026-03-26T21:16:00Z"
  }
}
```

## Freshness metadata

`meta.freshness` fields:

- `live_refresh_attempted`
- `live_refresh_succeeded`
- `served_from_cache`
- `last_successful_sync_at`

`meta.source` values:

- `database_after_live_refresh`
- `database_fallback_after_live_failure`
- `database_cache`

## Persistence policy

Database represents the latest known state only.

- no history tables
- no old versions
- existing review -> overwrite with latest scraped state
- new review -> insert
- changed reply -> overwrite reply
- full sync can remove reviews no longer present (with safety checks)

Tables:

- `companies`
- `reviews`

Schema file:

- `scripts/init_schema.sql`

## Reliability strategy

- HTTP first, Playwright fallback
- retry on transient failures
- jittered backoff
- circuit breaker by domain + mode
- parser confidence thresholds before critical writes
- graceful DB fallback on scrape failure

## HTTP statuses

- `200` success
- `400` invalid input
- `404` profile/review/cache not found
- `409` sync in progress
- `422` invalid filters
- `502` live scrape failed and no cache
- `504` refresh timeout and no cache
- `500` internal/database error

## Common error codes

- `missing_domain`
- `invalid_domain`
- `invalid_filters`
- `profile_not_found`
- `review_not_found`
- `cache_not_found`
- `sync_in_progress`
- `live_scrape_failed`
- `live_scrape_failed_no_cache`
- `refresh_timeout_no_cache`
- `database_error`

## Project structure

```text
src/
  app.js
  server.js
  config.js
  errors.js
  response.js
  freshness.js
  normalization.js
  db/
    pool.js
    repositories/
      companyRepository.js
      reviewRepository.js
  routes/
    trustpilot.js
  trustpilot/
    types.js
    resilience.js
    httpClient.js
    browserClient.js
    parsers.js
    syncService.js
    queryService.js
scripts/
  init_schema.sql
test/
  normalization.test.js
  routes.test.js
```

## QA

```bash
npm test
```

## Production notes

- run PostgreSQL with proper backups and monitoring
- set explicit env values (no implicit defaults)
- install Playwright browser in deployment image
- keep API behind reverse proxy with request timeouts
- if traffic grows, move in-memory sync lock/breaker to Redis
- add metrics/tracing dashboards for scrape health and fallback ratio

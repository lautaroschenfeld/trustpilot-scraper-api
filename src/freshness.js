import { toIsoOrNull } from "./response.js";

export const freshnessToPayload = (freshness) => ({
  live_refresh_attempted: !!freshness.liveRefreshAttempted,
  live_refresh_succeeded: !!freshness.liveRefreshSucceeded,
  served_from_cache: !!freshness.servedFromCache,
  last_successful_sync_at: toIsoOrNull(freshness.lastSuccessfulSyncAt),
});


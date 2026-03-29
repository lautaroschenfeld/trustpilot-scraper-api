import test from "node:test";
import assert from "node:assert/strict";

import { buildReviewsUrl } from "../src/trustpilot/httpClient.js";

test("buildReviewsUrl includes languages=all", () => {
  assert.equal(
    buildReviewsUrl("example.com", 1),
    "https://www.trustpilot.com/review/example.com?languages=all",
  );
  assert.equal(
    buildReviewsUrl("example.com", 3),
    "https://www.trustpilot.com/review/example.com?languages=all&page=3",
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  countryCodeToFlagEmoji,
  extractReviewerAvatarUrl,
} from "../src/trustpilot/queryService.js";

test("countryCodeToFlagEmoji converts ISO country code to flag emoji", () => {
  assert.equal(countryCodeToFlagEmoji("ES"), "🇪🇸");
  assert.equal(countryCodeToFlagEmoji("co"), "🇨🇴");
  assert.equal(countryCodeToFlagEmoji("US"), "🇺🇸");
});

test("countryCodeToFlagEmoji returns null for invalid values", () => {
  assert.equal(countryCodeToFlagEmoji(null), null);
  assert.equal(countryCodeToFlagEmoji(""), null);
  assert.equal(countryCodeToFlagEmoji("USA"), null);
  assert.equal(countryCodeToFlagEmoji("1S"), null);
});

test("extractReviewerAvatarUrl picks consumer avatar when present", () => {
  const raw = {
    consumer: {
      imageUrl: "https://images.trustpilot.com/u/avatar.png",
    },
  };

  assert.equal(
    extractReviewerAvatarUrl(raw),
    "https://images.trustpilot.com/u/avatar.png"
  );
});

test("extractReviewerAvatarUrl normalizes protocol-relative and root-relative URLs", () => {
  assert.equal(
    extractReviewerAvatarUrl({ author: { avatar_url: "//images.trustpilot.com/a.png" } }),
    "https://images.trustpilot.com/a.png"
  );

  assert.equal(
    extractReviewerAvatarUrl({ author: { avatar_url: "/users/avatar.png" } }),
    "https://www.trustpilot.com/users/avatar.png"
  );
});

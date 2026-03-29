import test from "node:test";
import assert from "node:assert/strict";

import { countryCodeToFlagEmoji } from "../src/trustpilot/queryService.js";

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

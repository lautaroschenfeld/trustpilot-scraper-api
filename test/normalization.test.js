import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDomain } from "../src/normalization.js";

test("normalize dirty domains", () => {
  assert.equal(normalizeDomain("google.com").normalizedDomain, "google.com");
  assert.equal(normalizeDomain("www.google.com").normalizedDomain, "google.com");
  assert.equal(normalizeDomain("www.google.com/ads").normalizedDomain, "google.com");
  assert.equal(normalizeDomain("https://www.google.com/ads?x=1").normalizedDomain, "google.com");
  assert.equal(normalizeDomain("münchen.de").normalizedDomain, "xn--mnchen-3ya.de");
});

test("reject invalid domain input", () => {
  const invalids = [
    "",
    "  ",
    "ftp://example.com",
    "127.0.0.1",
    "co.uk",
    "foo..bar.com",
    "hola example.com",
    "info@example.com",
  ];
  for (const value of invalids) {
    assert.throws(() => normalizeDomain(value));
  }
});


import test from "node:test";
import assert from "node:assert/strict";

import { DomainSyncRegistry } from "../src/trustpilot/resilience.js";

test("DomainSyncRegistry rejects when busy and failIfBusy=true", async () => {
  const registry = new DomainSyncRegistry();
  const first = await registry.acquire("google.com", false);
  assert.equal(first, true);
  const second = await registry.acquire("google.com", true);
  assert.equal(second, false);
  registry.release("google.com");
});

test("DomainSyncRegistry waits when busy and failIfBusy=false", async () => {
  const registry = new DomainSyncRegistry();
  const first = await registry.acquire("google.com", false);
  assert.equal(first, true);

  let resolved = false;
  const waiting = registry.acquire("google.com", false).then((value) => {
    resolved = true;
    return value;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, false);

  registry.release("google.com");
  const second = await waiting;
  assert.equal(second, true);
  registry.release("google.com");
});


import { config } from "../config.js";
import { FetchMode } from "./types.js";

class BreakerState {
  constructor() {
    this.failures = 0;
    this.openedUntil = null;
  }
}

export class CircuitBreaker {
  constructor() {
    this.states = new Map();
  }

  key(domain, mode) {
    return `${domain}::${mode}`;
  }

  allow(domain, mode) {
    const state = this.states.get(this.key(domain, mode));
    if (!state || !state.openedUntil) return true;
    return Date.now() >= state.openedUntil;
  }

  recordSuccess(domain, mode) {
    this.states.set(this.key(domain, mode), new BreakerState());
  }

  recordFailure(domain, mode) {
    const key = this.key(domain, mode);
    const state = this.states.get(key) || new BreakerState();
    state.failures += 1;
    const threshold =
      mode === FetchMode.HTTP
        ? config.circuitFailureThresholdHttp
        : config.circuitFailureThresholdBrowser;
    const cooldownSeconds =
      mode === FetchMode.HTTP ? config.circuitOpenSecondsHttp : config.circuitOpenSecondsBrowser;
    if (state.failures >= threshold) {
      state.failures = 0;
      state.openedUntil = Date.now() + cooldownSeconds * 1000;
    }
    this.states.set(key, state);
  }
}

export class DomainSyncRegistry {
  constructor() {
    this.active = new Set();
    this.waiters = new Map();
  }

  async acquire(domain, failIfBusy = false) {
    if (!this.active.has(domain)) {
      this.active.add(domain);
      return true;
    }

    if (failIfBusy) {
      return false;
    }

    await new Promise((resolve) => {
      const queue = this.waiters.get(domain) || [];
      queue.push(resolve);
      this.waiters.set(domain, queue);
    });

    this.active.add(domain);
    return true;
  }

  release(domain) {
    this.active.delete(domain);
    const queue = this.waiters.get(domain);
    if (!queue || queue.length === 0) return;
    const resolve = queue.shift();
    if (queue.length === 0) this.waiters.delete(domain);
    else this.waiters.set(domain, queue);
    resolve?.();
  }

  isBusy(domain) {
    return this.active.has(domain);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const retryBackoffDelayMs = (attempt) => {
  const max = Math.min(
    config.httpBackoffCapSeconds,
    config.httpBackoffBaseSeconds * 2 ** Math.max(attempt, 0),
  );
  return Math.random() * max * 1000;
};

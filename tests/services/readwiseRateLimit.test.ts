import assert from "node:assert/strict";
import test from "node:test";
import { getHttpErrorStatus, getRateLimitWaitMs } from "../../src/services/readwiseRateLimit";

test("getHttpErrorStatus reads structured and Obsidian-style errors", () => {
  assert.equal(getHttpErrorStatus({ status: 429 }), 429);
  assert.equal(getHttpErrorStatus(new Error("Request failed, status 429")), 429);
  assert.equal(getHttpErrorStatus(new Error("Network unavailable")), undefined);
});

test("getRateLimitWaitMs honors Retry-After seconds", () => {
  assert.equal(getRateLimitWaitMs({ headers: { "Retry-After": "7" } }), 7000);
  assert.equal(getRateLimitWaitMs({ response: { headers: { "retry-after": "2" } } }), 2000);
});

test("getRateLimitWaitMs falls back when headers are unavailable", () => {
  assert.equal(getRateLimitWaitMs(new Error("Request failed, status 429")), 5000);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompactName, normalizeSearchName } from "../../src/services/readwiseFileNames";

test("normalizeSearchName keeps word boundaries for UI search", () => {
  assert.equal(normalizeSearchName("Бег по правилу 80/20"), "бег по правилу 80 20");
});

test("normalizeCompactName matches sanitized file names", () => {
  assert.equal(
    normalizeCompactName("Бег по правилу 80/20"),
    normalizeCompactName("Бег По Правилу 8020"),
  );
});

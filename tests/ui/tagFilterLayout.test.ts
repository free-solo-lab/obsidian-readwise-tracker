import test from "node:test";
import assert from "node:assert/strict";
import { collapsedTagCount } from "../../src/ui/tagFilterLayout";

test("two rows that already fit do not need a disclosure", () => {
  assert.equal(collapsedTagCount([80, 80, 80, 80], 200, 6, 36), 4);
  assert.equal(collapsedTagCount([], 200, 6, 36), 0);
});
test("overflow reserves space for the disclosure on the second row", () => {
  assert.equal(collapsedTagCount([80, 80, 80, 80, 80, 80], 200, 6, 36), 3);
  assert.equal(collapsedTagCount([80, 80, 80, 80, 80, 80], 300, 6, 36), 6);
});
test("long tags and narrow panels still leave the disclosure within two rows", () => {
  assert.equal(collapsedTagCount([400, 400, 400], 200, 6, 36), 1);
  assert.equal(collapsedTagCount([80, 80, 80], 36, 6, 36), 1);
  assert.equal(collapsedTagCount([80], 0, 6, 36), 0);
});

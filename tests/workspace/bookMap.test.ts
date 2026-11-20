import test from "node:test";
import assert from "node:assert/strict";
import { markGroup } from "../../src/workspace/bookMapMarks";

test("one mark per note up to 99, then two from 100, three from 200", () => {
  assert.equal(markGroup(0), 1);
  assert.equal(markGroup(99), 1);
  assert.equal(markGroup(100), 2);
  assert.equal(markGroup(199), 2);
  assert.equal(markGroup(200), 3);
  assert.ok(Math.ceil(199 / markGroup(199)) <= 100);
});

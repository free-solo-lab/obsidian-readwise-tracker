import test from "node:test";
import assert from "node:assert/strict";
import { readerBookUrl } from "../../src/services/readerBookUrl";

test("Reader links use the synced Reader ID with a local ID fallback", () => {
  assert.equal(readerBookUrl({ id: "local", readwise_id: "01reader" }), "https://read.readwise.io/read/01reader");
  assert.equal(readerBookUrl({ id: "01reader" }), "https://read.readwise.io/read/01reader");
  assert.equal(readerBookUrl({ id: "  " }), null);
  assert.equal(readerBookUrl({ id: "local", readwise_id: " " }), "https://read.readwise.io/read/local");
});
test("document identifiers cannot replace the Reader host or inject URL fragments", () => {
  assert.equal(readerBookUrl({ id: "a/b#c?d" }), "https://read.readwise.io/read/a%2Fb%23c%3Fd");
});

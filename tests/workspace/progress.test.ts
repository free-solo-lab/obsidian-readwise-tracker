import test from "node:test";
import assert from "node:assert/strict";
import { ProgressMirror, mirrorsProgress, readingProgress } from "../../src/workspace/progress";

const mirror = () => {
  const sent: Array<[string, number]> = [],
    archived: string[] = [],
    errors: unknown[] = [];
  const m = new ProgressMirror(
    async (id, value) => void sent.push([id, value]),
    async (id) => void archived.push(id),
    (error) => errors.push(error),
    5,
  );
  return { m, sent, archived, errors };
};
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

test("progress is a rounded fraction of the text and only Reader documents other than PDFs are mirrored", () => {
  assert.equal(readingProgress(500, 2000), 0.25);
  assert.equal(readingProgress(5000, 2000), 1);
  assert.equal(readingProgress(10, 0), 0);
  assert.equal(mirrorsProgress({ readerId: "r", category: "article" }), true);
  assert.equal(mirrorsProgress({ readerId: "r", category: "pdf" }), false);
  assert.equal(mirrorsProgress({ category: "article" }), false);
});

test("progress is sent once after a pause, only forward, and small steps are ignored", async () => {
  const { m, sent } = mirror();
  m.note("r1", 0.2); m.note("r1", 0.3); m.note("r1", 0.31);
  await wait();
  assert.deepEqual(sent, [["r1", 0.31]]);
  m.note("r1", 0.1); m.note("r1", 0.315);
  await wait();
  assert.equal(sent.length, 1);
  m.note("r1", 0.5);
  await wait();
  assert.deepEqual(sent.at(-1), ["r1", 0.5]);
  m.dispose();
});

test("reading to the end sends 1 and archives the document once", async () => {
  const { m, sent, archived } = mirror();
  m.note("r1", 0.5); await wait();
  m.note("r1", 0.98); await wait();
  assert.deepEqual(sent.at(-1), ["r1", 1]);
  assert.deepEqual(archived, ["r1"]);
  m.note("r1", 1); await wait();
  assert.deepEqual(archived, ["r1"]);
  m.dispose();
});

test("a failed send is reported, not thrown, and is retried by the next movement", async () => {
  let fail = true;
  const errors: unknown[] = [], sent: number[] = [];
  const m = new ProgressMirror(async (_id, value) => { if (fail) throw new Error("429"); sent.push(value); }, async () => undefined, (e) => errors.push(e), 5);
  m.note("r", 0.4); await wait();
  assert.equal(errors.length, 1);
  fail = false;
  m.note("r", 0.45); await wait();
  assert.deepEqual(sent, [0.45]);
  m.dispose();
});

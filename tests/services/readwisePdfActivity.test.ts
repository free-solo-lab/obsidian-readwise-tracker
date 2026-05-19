import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfReadingActivity, extractHighlightDateKeysFromMarkdown } from "../../src/services/readwisePdfTimeline";

test("extractHighlightDateKeysFromMarkdown keeps multiple reading days from readwise export", () => {
  const markdown = `# PDF

## Highlights
> First
📅 2026-04-01, 10:30
---
> Second
📅 2026-04-02, 11:45
---
> Third
📅 2026-04-02, 20:10
`;

  assert.deepEqual(extractHighlightDateKeysFromMarkdown(markdown), [
    "2026-04-01",
    "2026-04-02",
    "2026-04-02",
  ]);
});

test("buildPdfReadingActivity distributes pdf progress across actual highlight days", () => {
  const activity = buildPdfReadingActivity(
    {
      words_count: 10000,
      reading_progress: 60,
    },
    ["2026-04-01", "2026-04-02", "2026-04-02"],
  );

  assert.ok(activity["2026-04-01"]);
  assert.ok(activity["2026-04-02"]);
  assert.equal(Object.keys(activity).length, 2);
  assert.ok(activity["2026-04-02"].minutes > activity["2026-04-01"].minutes);
  assert.equal(activity["2026-04-01"].events, 1);
  assert.equal(activity["2026-04-02"].events, 2);
  assert.ok(Math.abs(activity["2026-04-01"].progressPoints + activity["2026-04-02"].progressPoints - 60) < 0.0001);
});

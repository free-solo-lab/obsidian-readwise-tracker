import test from "node:test";
import assert from "node:assert/strict";
import {
  navigateWorkspace,
  readWorkspaceState,
} from "../../src/workspace/viewState";
test("returning through provenance restores the original focus, layout and independent scroll positions", () => {
  const original = {
    documentId: "book-a",
    right: "relation" as const,
    sourceOpen: false,
    notesCollapsed: false,
    split: 0.6,
    focused: "highlight-20",
    positions: { highlights: 1800, relation: 900 },
  };
  const next = navigateWorkspace(original, "book-b");
  assert.equal(next.sourceOpen, true);
  assert.equal(next.notesCollapsed, true);
  assert.equal(next.right, undefined);
  assert.deepEqual(next.history, ["book-a"]);
  original.positions.highlights = 0;
  const back = navigateWorkspace(
    {
      ...next,
      sourceOpen: true,
      notesCollapsed: true,
      positions: { source: 200 },
    },
    "book-a",
    true,
  );
  assert.equal(back.focused, "highlight-20");
  assert.equal(back.sourceOpen, false);
  assert.equal(back.notesCollapsed, false);
  assert.equal(back.positions?.highlights, 1800);
  assert.deepEqual(back.history, []);
});
test("restored view state ignores invalid offsets and retains valid navigation snapshots", () => {
  const state = readWorkspaceState({
    documentId: "book",
    split: NaN,
    positions: { a: 100, b: -1, c: "oops" },
    history: ["book-a", null],
    trail: [{ documentId: "book-a", positions: { highlights: 100 } }, null],
  });
  assert.equal(state.split, 0.5);
  assert.deepEqual(state.positions, { a: 100 });
  assert.deepEqual(state.history, ["book-a"]);
  assert.equal(state.trail?.length, 1);
});

test("saved scroll anchors keep valid entries and are reset when navigating forward", () => {
  const state = readWorkspaceState({
    documentId: "book-a",
    anchors: { highlights: { key: "h1", delta: 12 }, source: { key: 3, delta: 1 }, x: null },
  });
  assert.deepEqual(state.anchors, { highlights: { key: "h1", delta: 12 } });
  assert.deepEqual(navigateWorkspace(state, "book-b").anchors, {});
});

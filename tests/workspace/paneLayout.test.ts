import test from "node:test";
import assert from "node:assert/strict";
import { reducePaneLayout, type PaneLayout } from "../../src/workspace/paneLayout";

const base: PaneLayout = { right: undefined, sourceOpen: false, notesCollapsed: false, reading: false };
const reduce = (state: Partial<PaneLayout>, ...actions: Parameters<typeof reducePaneLayout>[1][]) =>
  actions.reduce(reducePaneLayout, { ...base, ...state });

test("opening the text closes the right pane and unfolds the notes", () => {
  assert.deepEqual(reduce({ right: "dialog", notesCollapsed: true }, { type: "toggleSource" }), {
    ...base,
    sourceOpen: true,
  });
  assert.deepEqual(reduce({ sourceOpen: true }, { type: "toggleSource" }), base);
});

test("the text rail never leaves the notes folded with nothing beside them", () => {
  assert.deepEqual(reduce({ sourceOpen: true, notesCollapsed: true }, { type: "toggleSourceRail" }), base);
  assert.deepEqual(
    reduce({ sourceOpen: true, notesCollapsed: true, right: "thought" }, { type: "toggleSourceRail" }),
    { ...base, notesCollapsed: true, right: "thought" },
  );
});

test("a right pane opens next to the notes and the same rail closes it", () => {
  const opened = reduce({ sourceOpen: true }, { type: "toggleRight", kind: "thought" });
  assert.deepEqual(opened, { ...base, right: "thought" });
  assert.deepEqual(reducePaneLayout(opened, { type: "toggleRight", kind: "thought" }), base);
  assert.deepEqual(reducePaneLayout(opened, { type: "toggleRight", kind: "dialog" }), { ...base, right: "dialog" });
});

test("folding the notes with nothing else open shows the text instead", () => {
  assert.deepEqual(reduce({}, { type: "collapseNotes" }), { ...base, notesCollapsed: true, sourceOpen: true });
  assert.deepEqual(reduce({ right: "relation" }, { type: "collapseNotes" }), {
    ...base,
    notesCollapsed: true,
    right: "relation",
  });
  assert.deepEqual(reduce({ right: "relation", notesCollapsed: true, sourceOpen: true }, { type: "expandNotes" }), {
    ...base,
    right: "relation",
  });
});

test("text alongside a right pane swaps the notes for the text and back", () => {
  const beside = reduce({ right: "dialog" }, { type: "toggleSourceBesideRight" });
  assert.deepEqual(beside, { ...base, right: "dialog", notesCollapsed: true, sourceOpen: true });
  assert.deepEqual(reducePaneLayout(beside, { type: "closeRight" }), base);
});

test("the text pane's own close button leaves the other panes alone", () => {
  assert.deepEqual(
    reduce({ right: "dialog", notesCollapsed: true, sourceOpen: true }, { type: "closeSource" }),
    { ...base, right: "dialog", notesCollapsed: true },
  );
});

test("full-screen reading always has the text open and leaves the rest untouched", () => {
  const reading = reduce({ right: "thought", notesCollapsed: true }, { type: "toggleReading" });
  assert.deepEqual(reading, { right: "thought", notesCollapsed: true, sourceOpen: true, reading: true });
  assert.deepEqual(reducePaneLayout(reading, { type: "exitReading" }), { ...reading, reading: false });
});

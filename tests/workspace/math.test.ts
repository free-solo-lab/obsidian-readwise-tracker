import test from "node:test";
import assert from "node:assert/strict";
import { latexToObsidianMath } from "../../src/workspace/math";
import { safeAssistantMarkdown } from "../../src/workspace/ai";

test("LaTeX display and inline delimiters become Obsidian math", () => {
  assert.equal(
    latexToObsidianMath("A row:\n\\[\n(1/3,\\;1/3,\\;0,\\dots)\n\\]\nThree letters."),
    "A row:\n\n$$\n(1/3,\\;1/3,\\;0,\\dots)\n$$\n\nThree letters.",
  );
  assert.equal(latexToObsidianMath("Here \\( P(A)=0.75 \\) and \\(x\\)."), "Here $P(A)=0.75$ and $x$.");
  assert.equal(latexToObsidianMath("\\[a\\]"), "\n$$\na\n$$\n");
});

test("code, existing dollar math and plain text are left alone", () => {
  const fenced = "```tex\n\\[x\\]\n```";
  assert.equal(latexToObsidianMath(fenced), fenced);
  assert.equal(latexToObsidianMath("use `\\(x\\)` literally"), "use `\\(x\\)` literally");
  assert.equal(latexToObsidianMath("$$x^2$$ and $y$"), "$$x^2$$ and $y$");
  assert.equal(latexToObsidianMath("array a\\\\[2pt] b"), "array a\\\\[2pt] b");
  assert.equal(latexToObsidianMath("no math here"), "no math here");
});

test("assistant answers are rendered with converted math", () => {
  assert.match(safeAssistantMarkdown("Result \\(a+b\\)"), /Result \$a\+b\$/);
});

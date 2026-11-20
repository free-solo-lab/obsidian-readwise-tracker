import test from "node:test";
import assert from "node:assert/strict";
import {
  keepManualAnchors,
  locateQuote,
  normalizedText,
  prepareQuoteIndex,
} from "../../src/workspace/anchors";
import type { SourceAnchor } from "../../src/workspace/types";

test("formatted quotes, entities and PDF line hyphens map to original Markdown offsets", () => {
  const text =
    "Читать **текст** — значит раз-\nвивать &quot;мысль&quot; и понимать её источник.";
  const anchor = locateQuote(
    text,
    'Читать текст - значит развивать "мысль" и понимать её источник.',
    "note",
    "v1",
  );
  assert.equal(anchor.status, "matched");
  assert.equal(anchor.start, 0);
  assert.equal(anchor.end, text.length);
});
test("links and soft hyphens do not prevent matching the highlighted words", () => {
  const text =
    "Это [важная мысль](https://example.com/source), которая позволяет со\u00adединить идеи.";
  const anchor = locateQuote(
    text,
    "Это важная мысль, которая позволяет соединить идеи.",
    "note",
    "v1",
  );
  assert.equal(anchor.status, "matched");
  assert.equal(anchor.end, text.length);
});
test("punctuation-only differences are accepted; missing words are not guessed", () => {
  const text = "О процессе чтения — и появлении новых связей.";
  assert.equal(
    locateQuote(
      text,
      "О процессе чтения, и появлении новых связей!",
      "note",
      "v1",
    ).status,
    "matched",
  );
  assert.equal(
    locateQuote(
      text,
      "О процессе чтения и появлении совершенно новых связей",
      "note",
      "v1",
    ).status,
    "missing",
  );
});
test("loose matches still require a choice when a passage is repeated", () => {
  const text =
    "О процессе чтения — и появлении новых связей.\n\nО процессе чтения: и появлении новых связей.";
  const result = locateQuote(
    text,
    "О процессе чтения, и появлении новых связей!",
    "note",
    "v1",
  );
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});
test("chunked preparation preserves entities at chunk boundaries and yields the same offsets", async () => {
  const text =
    "a".repeat(32766) + "&quot;\n" + "Читать осмысленно. ".repeat(4000);
  assert.deepEqual(await prepareQuoteIndex(text), normalizedText(text));
});
test("a changed highlight does not retain an obsolete manual selection", () => {
  const text = "Original passage.\n\nThe new quoted passage.";
  const old = {
    id: "anchor",
    nodePath: "note",
    quote: "old quote",
    revision: "v1",
    status: "matched" as const,
    start: 0,
    end: 17,
    selectedText: "Original passage.",
    manual: true,
    candidates: [],
  };
  const result = locateQuote(
    text,
    "The new quoted passage.",
    "note",
    "v1",
    old,
  );
  assert.equal(result.start, text.indexOf("The new"));
  assert.equal(result.manual, false);
  assert.equal(result.history?.[0].quote, "old quote");
});

test("a quote whose formulas are images in the book is anchored by its prose lines", () => {
  const book = [
    "## Перплексия",
    "_Перплексия_ — это экспонента от энтропии и кросс-энтропии. Перплексию часто сокращают как PPL. Для набора данных с истинным распределением _P_ перплексия определяется как:",
    "",
    "![](_Assets/a.png)",
    "",
    "Перплексия языковой модели (с выученным распределением _Q_) на этом наборе данных определяется как:",
    "",
    "Если кросс-энтропия измеряет сложность предсказания следующего токена моделью, то перплексия измеряет степень неопределенности при предсказании следующего токена.",
    "",
    "Совсем другой абзац про что-то иное и длинный достаточно.",
  ].join("\n");
  const quote = [
    "*Перплексия* — это экспонента от энтропии и кросс-энтропии. Перплексию часто сокращают как PPL. Для набора данных с истинным распределением *P* перплексия определяется как:",
    "P P L ( P ) = 2 H(P)",
    "Перплексия языковой модели (с выученным распределением *Q*) на этом наборе данных определяется как:",
    "P P L ( P , Q ) = 2 H(P,Q)",
    "Если кросс-энтропия измеряет сложность предсказания следующего токена моделью, то перплексия измеряет степень неопределенности при предсказании следующего токена.",
  ].join("\n");
  const anchor = locateQuote(book, quote, "n.md", "r");
  assert.equal(anchor.status, "matched");
  assert.match(book.slice(anchor.start, anchor.end), /^_?Перплексия_/);
  assert.ok(book.slice(anchor.start, anchor.end).endsWith("следующего токена."));
});

test("a hand-placed anchor saved while a re-match ran survives it; stale ones do not", () => {
  const base = { id: "x", candidates: [], revision: "r1" };
  const computed: SourceAnchor[] = [
    { ...base, nodePath: "a.md", quote: "перевод", status: "missing" },
    { ...base, nodePath: "b.md", quote: "exact", status: "matched", start: 0, end: 5 },
  ];
  const manual = (nodePath: string, quote: string, revision = "r1"): SourceAnchor => ({
    ...base,
    nodePath,
    quote,
    revision,
    status: "matched",
    start: 10,
    end: 40,
    manual: true,
    selectedText: "paragraph",
  });
  const kept = keepManualAnchors(
    computed,
    [manual("a.md", "перевод"), manual("b.md", "exact"), manual("new.md", "ещё"), manual("gone.md", "x"), manual("old.md", "y", "r0")],
    "r1",
    (path) => path !== "gone.md",
  );
  assert.deepEqual(kept.map((item) => [item.nodePath, item.status, item.manual ?? false]), [
    ["a.md", "matched", true],
    // Placed by hand while the pass ran: the reader's choice beats the automatic match.
    ["b.md", "matched", true],
    ["new.md", "matched", true],
  ]);
});

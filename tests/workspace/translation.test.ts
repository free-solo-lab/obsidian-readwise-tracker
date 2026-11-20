import test from "node:test";
import assert from "node:assert/strict";
import {
  TranslationRunner,
  batchBlocks,
  detectLanguage,
  translationTargets,
  parseTranslation,
  parseTranslationReply,
  translatedMarkdown,
  serializeTranslation,
  translationPrompt,
  type TextTranslator,
} from "../../src/workspace/translation";
import { textBlocks } from "../../src/workspace/focus";
import { MemoryVault, doc } from "./memory";

const text = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";
const blocks = textBlocks(text);

test("a translation round-trips through its Markdown file, keyed by block position", () => {
  const raw = serializeTranslation(doc, { revision: "r1", language: "ru", complete: true, blocks: { "0": "# Заголовок", "9": "Первый абзац." } });
  const back = parseTranslation(raw);
  assert.deepEqual(back, { revision: "r1", language: "ru", complete: true, blocks: { "0": "# Заголовок", "9": "Первый абзац." } });
  assert.equal(parseTranslation("---\nrwt_kind: \"source\"\n---\n\nx"), undefined);
});

test("blocks are batched by size and a reply must return every block exactly once", () => {
  assert.equal(batchBlocks(blocks, 10_000).length, 1);
  assert.ok(batchBlocks(blocks, 20).length > 1);
  const keys = blocks.map((b) => b.key);
  const good = keys.map((k) => `[[[BLOCK ${k}]]]\nперевод ${k}`).join("\n\n");
  assert.equal(Object.keys(parseTranslationReply(good, keys) ?? {}).length, keys.length);
  assert.equal(parseTranslationReply(good.replace(`[[[BLOCK ${keys[1]}]]]`, ""), keys), undefined);
  assert.equal(parseTranslationReply(good + `\n\n[[[BLOCK ${keys[0]}]]]\nещё`, keys), undefined);
  assert.match(translationPrompt(blocks), /^\[\[\[BLOCK 0\]\]\]\n# Title/);
});

function runner(translate: TextTranslator["translate"]) {
  const vault = new MemoryVault();
  const translator: TextTranslator = { unavailable: () => undefined, translate };
  return { vault, run: new TranslationRunner(vault, translator, () => undefined) };
}
const echo = (prompt: string) => prompt.replace(/^(?!\[\[\[BLOCK)(.+)$/gm, "RU $1");

test("the whole text is translated batch by batch and stored; a second run translates nothing", async () => {
  let calls = 0;
  const { run } = runner(async (prompt) => (calls++, echo(prompt)));
  await run.start(doc, blocks, "r1");
  const done = await run.load(doc);
  assert.equal(done?.complete, true);
  assert.equal(done?.blocks[blocks[1].key], "RU First paragraph.");
  assert.equal(run.job(doc.id), undefined);
  const before = calls;
  await run.start(doc, blocks, "r1");
  assert.equal(calls, before);
});

test("a stopped or failed run keeps its progress and continues where it ended; a changed text starts over", async () => {
  let fail = false;
  const { run } = runner(async (prompt) => {
    if (fail) throw new Error("Codex не ответил");
    return echo(prompt);
  });
  const small = textBlocks("A one.\n\nB two.\n\nC three.\n");
  await run.start(doc, small.slice(0, 1), "r1");
  fail = true;
  await run.start(doc, small, "r1");
  assert.equal(run.job(doc.id)?.status, "error");
  assert.equal(Object.keys((await run.load(doc))?.blocks ?? {}).length, 1);
  fail = false;
  await run.start(doc, small, "r1");
  assert.equal((await run.load(doc))?.complete, true);
  assert.equal(Object.keys((await run.load(doc))?.blocks ?? {}).length, 3);
  await run.start(doc, small, "r2");
  assert.equal((await run.load(doc))?.revision, "r2");
});

test("a reply without delimiters is asked again, then block by block", async () => {
  let calls = 0;
  const { run } = runner(async (prompt) => (++calls <= 2 ? "без разметки" : echo(prompt)));
  const two = textBlocks("A one.\n\nB two.\n");
  await run.start(doc, two, "r1");
  assert.equal((await run.load(doc))?.complete, true);
  assert.ok(calls > 2);
});

test("the published text keeps the original's order and falls back to the original where a block is untranslated", () => {
  const out = translatedMarkdown(blocks, { revision: "r", language: "ru", complete: false, blocks: { [blocks[0].key]: "# Заголовок", [blocks[2].key]: "Второй." } });
  assert.equal(out, "# Заголовок\n\nFirst paragraph.\n\nВторой.\n\nThird paragraph.");
});
test("the source language is detected and left out of the offered targets", () => {
  const en = "The quick brown fox jumps over the lazy dog and the reader is happy with this text for sure.";
  const ru = "Быстрая коричневая лиса прыгает через ленивую собаку, и читатель доволен этим текстом.";
  assert.equal(detectLanguage(en), "en");
  assert.equal(detectLanguage(ru), "ru");
  assert.equal(detectLanguage("这是一个用于测试语言检测的中文句子，应该被识别出来。"), "zh");
  assert.equal(translationTargets(en).some((item) => item.code === "en"), false);
  assert.equal(translationTargets(ru).some((item) => item.code === "ru"), false);
  assert.equal(translationTargets(en)[0].code, "ru");
  assert.equal(translationTargets("???").length, 5);
});

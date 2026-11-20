import test from "node:test";
import assert from "node:assert/strict";
import {
  readTranslationViewPreferences,
  rememberTranslationView,
  resolveTranslationView,
  translationLanguagesOf,
} from "../../src/workspace/translationView";

test("a book with a translation opens in it unless the reader last chose the original", () => {
  assert.deepEqual(resolveTranslationView(undefined, ["en"]), { language: "en", shown: true });
  assert.deepEqual(resolveTranslationView(undefined, []), { language: "ru", shown: false });
  assert.deepEqual(resolveTranslationView({ language: "en", translation: false }, ["en"]), {
    language: "en",
    shown: false,
  });
  assert.deepEqual(resolveTranslationView({ language: "ru", translation: true }, ["ru", "en"]), {
    language: "ru",
    shown: true,
  });
});

test("a remembered language whose translation is gone gives way to one that exists", () => {
  assert.deepEqual(resolveTranslationView({ language: "de", translation: true }, ["es"]), {
    language: "es",
    shown: true,
  });
  // Nothing translated yet: the remembered language stays as the picker's suggestion.
  assert.deepEqual(resolveTranslationView({ language: "de", translation: true }, []), {
    language: "de",
    shown: true,
  });
});

test("the existing translations of a book are listed in the picker's order", () => {
  const document = { workspacePath: "Readwise/Workspace/Book" };
  const files = new Set([
    "Readwise/Workspace/Book/Source/translation-en.md",
    "Readwise/Workspace/Book/Source/translation-ru.md",
  ]);
  assert.deepEqual(translationLanguagesOf(document, (path) => files.has(path)), ["ru", "en"]);
  assert.deepEqual(translationLanguagesOf(document, () => false), []);
});

test("remembering a view keeps the newest books and leaves the record alone when nothing changed", () => {
  const first = rememberTranslationView({}, "a", { language: "ru", shown: true });
  assert.deepEqual(first, { a: { language: "ru", translation: true } });
  assert.equal(rememberTranslationView(first, "a", { language: "ru", shown: true }), first);
  const second = rememberTranslationView(first, "b", { language: "en", shown: false }, 2);
  const third = rememberTranslationView(second, "a", { language: "ru", shown: false }, 2);
  assert.deepEqual(Object.keys(third), ["b", "a"]);
  const fourth = rememberTranslationView(third, "c", { language: "ru", shown: true }, 2);
  assert.deepEqual(Object.keys(fourth), ["a", "c"]);
});

test("stored preferences keep only well-formed entries", () => {
  assert.deepEqual(readTranslationViewPreferences(undefined), {});
  assert.deepEqual(readTranslationViewPreferences([1]), {});
  assert.deepEqual(
    readTranslationViewPreferences({
      a: { language: "ru", translation: true },
      b: { language: 3, translation: true },
      c: { language: "en" },
      d: null,
    }),
    { a: { language: "ru", translation: true } },
  );
});

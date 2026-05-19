import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReadwiseInboxNoteContent,
  buildReadwiseInboxNoteFileBaseName,
} from "../../src/services/readwiseInboxNoteTemplate";

test("buildReadwiseInboxNoteFileBaseName does not prefix notes with Заметка", () => {
  assert.equal(
    buildReadwiseInboxNoteFileBaseName("После достижения порога заработка деньги перестают мотивировать."),
    "После достижения порога заработка деньги перестают мотивировать.",
  );
});

test("buildReadwiseInboxNoteContent stores source metadata in frontmatter only", () => {
  const content = buildReadwiseInboxNoteContent({
    title: "После достижения порога заработка деньги перестают мотивировать.",
    created: "2026-03-26",
    bookLink: "[[Readwise/Books/Привычки на всю жизнь|Привычки на всю жизнь]]",
    sourceLink: "[[Readwise/Highlights/Привычки на всю жизнь — 038|Привычки на всю жизнь — 038]]",
    sourceDate: "2026-03-02",
    quote: "Исследование показало важную мысль.",
    description: "После достижения порога заработка начинается притупление.",
  });

  assert.match(content, /^---\ntype: inbox\n/m);
  assert.match(content, /created: 2026-03-26/);
  assert.doesNotMatch(content, /^title:/m);
  assert.match(content, /book: "\[\[Readwise\/Books\/Привычки на всю жизнь\|Привычки на всю жизнь\]\]"/);
  assert.match(content, /source: "\[\[Readwise\/Highlights\/Привычки на всю жизнь — 038\|Привычки на всю жизнь — 038\]\]"/);
  assert.match(content, /date: 2026-03-02/);
  assert.doesNotMatch(content, /^# /m);
  assert.doesNotMatch(content, /^Книга:/m);
  assert.doesNotMatch(content, /^Источник:/m);
  assert.doesNotMatch(content, /^Дата:/m);
  assert.match(content, /^> Исследование показало важную мысль\./m);
  assert.match(content, /После достижения порога заработка начинается притупление\./);
});

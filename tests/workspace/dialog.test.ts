import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRepository } from "../../src/workspace/repository";
import { DialogRunner } from "../../src/workspace/dialog";
import type { AiCallbacks, AiRequest, WorkspaceAiAdapter } from "../../src/workspace/types";
import { MemoryVault, doc } from "./memory";

function setup(generate: (request: AiRequest, callbacks: AiCallbacks) => Promise<string | { text: string; threadId?: string }>) {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({ highlights: "Highlights", inbox: "Inbox" }));
  const requests: AiRequest[] = [];
  let reason: string | undefined;
  const adapter: WorkspaceAiAdapter = {
    unavailable: () => reason,
    queued: () => 0,
    generate: async (request, callbacks) => {
      requests.push(request);
      const answer = await generate(request, callbacks);
      return typeof answer === "string" ? { text: answer } : answer;
    },
  };
  let saves = 0;
  const runner = new DialogRunner(repo, adapter, async () => [{ label: "075", quote: "q", comment: "c" }], () => saves++);
  return { vault, repo, runner, requests, saves: () => saves, block: (text?: string) => (reason = text) };
}
const draft = async (repo: WorkspaceRepository, node: Awaited<ReturnType<WorkspaceRepository["create"]>>, text: string) => repo.saveDraft(node, text);

test("a question is taken from the draft once, answered and stored with its context", async () => {
  const { repo, runner, requests, saves } = setup(async (_r, cb) => (cb.onText?.("par"), " Ответ "));
  const dialog = await repo.create(doc, "dialog", "", ["Highlights/Book A/A — 001.md"]);
  await draft(repo, dialog, "Что тут?");
  await runner.send(doc, dialog, "rev1");
  const messages = await repo.messages(dialog);
  assert.deepEqual(messages.map((m) => [m.role, m.content]), [["user", "Что тут?"], ["assistant", "Ответ"]]);
  assert.equal(messages[0].revision, "rev1");
  assert.deepEqual(requests[0].history, []);
  assert.equal(requests[0].question, "Что тут?");
  assert.equal(requests[0].notes[0].comment, "c");
  assert.equal(await repo.takeDraft(dialog), "");
  assert.equal(runner.job(dialog.path), undefined);
  assert.ok(saves() >= 2);
});

test("a failed answer keeps the question; retrying answers it without a duplicate", async () => {
  let fail = true;
  const { repo, runner, requests } = setup(async () => {
    if (fail) throw new Error("Sign in through Codex Bridge settings first.");
    return "ok";
  });
  const dialog = await repo.create(doc, "dialog", "", []);
  await draft(repo, dialog, "Вопрос");
  await runner.send(doc, dialog);
  assert.match(runner.job(dialog.path)?.error || "", /Sign in/);
  assert.equal((await repo.messages(dialog)).length, 1);
  fail = false;
  await runner.send(doc, dialog);
  const messages = await repo.messages(dialog);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(requests.length, 2);
  assert.equal(runner.job(dialog.path), undefined);
});

test("earlier messages are sent as history and cancelling leaves no error", async () => {
  let release!: () => void;
  const { repo, runner, requests } = setup((_r, cb) =>
    new Promise<string>((resolve, reject) => {
      cb.signal.addEventListener("abort", () => reject(new Error("Codex task cancelled.")));
      release = () => resolve("second answer");
    }),
  );
  const dialog = await repo.create(doc, "dialog", "", []);
  await repo.appendMessage(dialog, { id: "m1", role: "user", created: "t", content: "first", sources: [] });
  await repo.appendMessage(dialog, { id: "m2", role: "assistant", created: "t", content: "first answer", sources: [] });
  await draft(repo, dialog, "second");
  const sending = runner.send(doc, dialog);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runner.job(dialog.path)?.status, "running");
  assert.deepEqual(requests[0].history.map((m) => m.content), ["first", "first answer"]);
  runner.cancel(dialog.path);
  await sending;
  assert.equal(runner.job(dialog.path), undefined);
  assert.equal((await repo.messages(dialog)).length, 3);
  void release;
});

test("an unavailable Bridge refuses before touching the draft", async () => {
  const { repo, runner, block } = setup(async () => "x");
  const dialog = await repo.create(doc, "dialog", "", []);
  await draft(repo, dialog, "keep me");
  block("Включите Codex Bridge");
  await assert.rejects(runner.send(doc, dialog), /Codex Bridge/);
  assert.equal(await repo.takeDraft(dialog), "keep me");
});

test("note dialogs mirror into the book chat but are answered in their own thread, without the other dialogs' history", async () => {
  let counter = 0;
  const { repo, runner, requests } = setup(async (request) => ({ text: "answer to " + request.question, threadId: request.threadId ?? "thread-" + ++counter }));
  const first = await repo.create(doc, "dialog", "", ["Highlights/Book A/A — 001.md"]);
  const second = await repo.create(doc, "dialog", "", ["Highlights/Book A/A — 002.md"]);
  await repo.saveDraft(first, "one");
  await runner.send(doc, first);
  await repo.saveDraft(second, "two");
  await runner.send(doc, second);
  assert.equal(requests[0].threadId, undefined);
  assert.equal(requests[1].threadId, undefined);
  assert.deepEqual(requests[1].history.map((m) => m.content), []);
  assert.equal(await repo.chatThread(doc), undefined);
  assert.equal(await repo.dialogProperty(first, "rwt_thread"), "thread-1");
  assert.equal(await repo.dialogProperty(second, "rwt_thread"), "thread-2");
  const feed = await repo.messages(await repo.chat(doc));
  assert.deepEqual(feed.map((m) => [m.role, m.content, m.origin === first.path ? "first" : m.origin === second.path ? "second" : "?"]), [
    ["user", "one", "first"], ["assistant", "answer to one", "first"],
    ["user", "two", "second"], ["assistant", "answer to two", "second"],
  ]);
  await repo.saveDraft(first, "three");
  await runner.send(doc, first);
  assert.equal(requests[2].threadId, "thread-1");
});

test("a dialog switched to the whole book shares the book chat's thread and history", async () => {
  let counter = 0;
  const { repo, runner, requests } = setup(async (request) => ({ text: "answer to " + request.question, threadId: request.threadId ?? "thread-" + ++counter }));
  const first = await repo.create(doc, "dialog", "", ["Highlights/Book A/A — 001.md"]);
  const second = await repo.create(doc, "dialog", "", ["Highlights/Book A/A — 002.md"]);
  await repo.setDialogProperty(first, "rwt_scope", "book");
  await repo.setDialogProperty(second, "rwt_scope", "book");
  await repo.saveDraft(first, "one");
  await runner.send(doc, first);
  await repo.saveDraft(second, "two");
  await runner.send(doc, second);
  assert.equal(requests[1].threadId, "thread-1");
  assert.equal(await repo.chatThread(doc), "thread-1");
  assert.deepEqual(requests[1].history.map((m) => m.content), ["one", "answer to one"]);
});

test("a question asked in the chat itself is answered in its own thread without mirroring", async () => {
  const { repo, runner, requests } = setup(async (request) => ({ text: "ok", threadId: request.threadId ?? "t1" }));
  const chat = await repo.chat(doc);
  await repo.saveDraft(chat, "hello");
  await runner.send(doc, chat);
  await repo.saveDraft(await repo.chat(doc), "again");
  await runner.send(doc, await repo.chat(doc));
  const feed = await repo.messages(await repo.chat(doc));
  assert.deepEqual(feed.map((m) => m.content), ["hello", "ok", "again", "ok"]);
  assert.ok(feed.every((m) => m.origin === undefined));
  assert.equal(requests[1].threadId, "t1");
  assert.equal((await repo.source(doc)).anchors.length, 0);
});

test("an earlier question can be sent again: a copy is appended, the history is kept and it is answered", async () => {
  let n = 0;
  const { repo, runner, requests } = setup(async () => "ответ " + ++n);
  const dialog = await repo.create(doc, "dialog", "", []);
  await draft(repo, dialog, "Что тут?");
  await runner.send(doc, dialog);
  const [question] = await repo.messages(dialog);
  await runner.resend(doc, dialog, question, "rev2");
  const messages = await repo.messages(dialog);
  assert.deepEqual(messages.map((m) => [m.role, m.content]), [["user", "Что тут?"], ["assistant", "ответ 1"], ["user", "Что тут?"], ["assistant", "ответ 2"]]);
  assert.notEqual(messages[2].id, messages[0].id);
  assert.equal(messages[2].revision, "rev2");
  assert.equal(requests[1].history.length, 2);
});

test("documents Codex saved to Reader are linked after the answer, without the marker in the stored text", async () => {
  const { repo, vault, runner } = setup(async () => "Сохранил.\nrwt-reader: 01kabcdefghjk12345");
  const linked: string[][] = [];
  const withLink = new DialogRunner(repo, (runner as unknown as { adapter: WorkspaceAiAdapter }).adapter, async () => [], () => undefined, async (_d, _n, ids) => { linked.push(ids); });
  const dialog = await repo.create(doc, "dialog", "", []);
  await draft(repo, dialog, "Загрузи статью");
  await withLink.send(doc, dialog);
  assert.deepEqual(linked, [["01kabcdefghjk12345"]]);
  const messages = await repo.messages(dialog);
  assert.equal(messages[1].content, "Сохранил.");
  assert.ok(vault);
});

test("without a marker, Reader links in the answer are linked only after a request to save", async () => {
  const link = "Сохранил. [Открыть](https://read.readwise.io/read/01kabcdefghjk12345)";
  for (const [question, expected] of [["загрузи статью", [["01kabcdefghjk12345"]]], ["найди статью", []]] as const) {
    const { repo, runner } = setup(async () => link);
    const linked: string[][] = [];
    const withLink = new DialogRunner(repo, (runner as unknown as { adapter: WorkspaceAiAdapter }).adapter, async () => [], () => undefined, async (_d, _n, ids) => { linked.push(ids); });
    const dialog = await repo.create(doc, "dialog", "", []);
    await draft(repo, dialog, question);
    await withLink.send(doc, dialog);
    assert.deepEqual(linked, expected);
  }
});

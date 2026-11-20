import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkspaceImporter,
  UncertainImportError,
  type ImportTransport,
} from "../../src/workspace/import";
import type { ImportJob } from "../../src/workspace/types";

function setup(overrides: Partial<ImportTransport> = {}) {
  const jobs = new Map<string, ImportJob>();
  let uploads = 0,
    saves = 0,
    assets = 0;
  const importer = new WorkspaceImporter(
    {
      get: async (key) => jobs.get(key),
      put: async (job) => {
        jobs.set(job.key, structuredClone(job));
      },
    },
    {
      save: async () => {
        saves++;
        return "remote";
      },
      upload: async () => {
        uploads++;
        return ["remote"];
      },
      asset: async () => {
        assets++;
        return { path: "_Assets/hash.epub", hash: "hash" };
      },
      find: async () => [],
      tags: async () => undefined,
      bind: async () => undefined,
      sync: async () => undefined,
      ...overrides,
    },
  );
  return { importer, jobs, counts: () => ({ uploads, saves, assets }) };
}
const bytes = new TextEncoder().encode("epub bytes").buffer;
test("tag failure resumes using the committed ID without uploading or saving a second original", async () => {
  let fail = true;
  const { importer, jobs, counts } = setup({
    tags: async () => {
      if (fail) throw new Error("tag failure");
    },
  });
  await assert.rejects(
    importer.file("Book.epub", "application/epub+zip", bytes, ["topic"]),
    /tag failure/,
  );
  assert.equal([...jobs.values()][0].state, "registered");
  assert.deepEqual([...jobs.values()][0].readerIds, ["remote"]);
  fail = false;
  await importer.file("Renamed.epub", "application/epub+zip", bytes, ["other"]);
  assert.deepEqual(counts(), { uploads: 1, saves: 0, assets: 1 });
  assert.equal([...jobs.values()][0].state, "complete");
});
test("uncertain network outcome checks Reader and never blindly repeats an upload", async () => {
  let calls = 0,
    found = false;
  const { importer } = setup({
    upload: async () => {
      calls++;
      throw new Error("timeout");
    },
    find: async () => (found ? ["already-created"] : []),
  });
  await assert.rejects(
    importer.file("Book.pdf", "application/pdf", bytes),
    /timeout/,
  );
  await assert.rejects(
    importer.file("Book.pdf", "application/pdf", bytes),
    UncertainImportError,
  );
  assert.equal(calls, 1);
  found = true;
  const job = await importer.file("Book.pdf", "application/pdf", bytes);
  assert.deepEqual(job.readerIds, ["already-created"]);
  assert.equal(calls, 1);
});
test("concurrent imports share one request and plain text has a stable content URL", async () => {
  const urls: string[] = [];
  const { importer, counts } = setup({
    save: async (request) => {
      urls.push(request.url);
      return "text";
    },
  });
  await Promise.all([
    importer.file("Text.md", "text/markdown", bytes),
    importer.file("Text.md", "text/markdown", bytes),
  ]);
  await importer.file("Other name.md", "text/markdown", bytes);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /readwise-import\/[a-f0-9]{64}$/);
  assert.equal(counts().assets, 1);
});
test("Reader authentication failure leaves a local resumable import", async () => {
  let signedIn = false,
    calls = 0;
  const { importer, jobs } = setup({
    upload: async () => {
      calls++;
      if (!signedIn)
        throw Object.assign(new Error("login"), {
          name: "ReaderAuthenticationError",
        });
      return ["book"];
    },
  });
  await assert.rejects(
    importer.file("Book.epub", "application/epub+zip", bytes),
    /login/,
  );
  assert.equal([...jobs.values()][0].state, "local");
  signedIn = true;
  await importer.file("Book.epub", "application/epub+zip", bytes);
  assert.equal(calls, 2);
});

test("a completed import is uploaded again once its Reader document was deleted", async () => {
  let present = true;
  const { importer, counts } = setup({ exists: async () => present });
  await importer.file("Book.epub", "application/epub+zip", bytes);
  await importer.file("Book.epub", "application/epub+zip", bytes);
  assert.equal(counts().uploads, 1);
  present = false;
  await importer.file("Book.epub", "application/epub+zip", bytes);
  assert.equal(counts().uploads, 2);
});

import type {
  ReadwiseDocument,
  ReadwiseSaveDocumentRequest,
} from "../models/readwise";
import type { ImportJob } from "./types";
import { escapeHtml, sha256 } from "./content";
import { errorMessage, errorStatus } from "../utils/errors";

/** Reader needs a URL for every article; local files get a stable one derived from their content. */
const importUrl = (hash: string) => "https://obsidian.local/readwise-import/" + hash;
const categoryOf = (name: string): ImportJob["category"] =>
  /\.epub$/i.test(name) ? "epub" : /\.pdf$/i.test(name) ? "pdf" : "article";

export interface ImportJournal {
  get(key: string): Promise<ImportJob | undefined>;
  put(job: ImportJob): Promise<void>;
}
export interface ImportTransport {
  save(request: ReadwiseSaveDocumentRequest): Promise<string>;
  upload(
    name: string,
    contentType: string,
    bytes: ArrayBuffer,
  ): Promise<string[]>;
  find(job: ImportJob): Promise<string[]>;
  /** False only when Reader confirms every document is gone; errors count as "exists". */
  exists?(ids: string[]): Promise<boolean>;
  tags(ids: string[], tags: string[]): Promise<void>;
  bind(job: ImportJob): Promise<void>;
  sync(): Promise<void>;
  asset(
    name: string,
    bytes: ArrayBuffer,
  ): Promise<{ path: string; hash: string }>;
}
export class UncertainImportError extends Error {
  constructor() {
    super(
      "Reader may still be processing this upload. Retry later; the saved original will be reused. No second upload was sent.",
    );
  }
}

/** The journal only contains resumable import state; content and provenance live in the vault. */
export class WorkspaceImporter {
  private active = new Map<string, Promise<ImportJob>>();
  constructor(
    private readonly journal: ImportJournal,
    private readonly transport: ImportTransport,
  ) {}

  private exclusive(
    key: string,
    task: () => Promise<ImportJob>,
  ): Promise<ImportJob> {
    const pending = this.active.get(key);
    if (pending) return pending;
    const result = task().finally(() => this.active.delete(key));
    this.active.set(key, result);
    return result;
  }
  async file(
    name: string,
    contentType: string,
    bytes: ArrayBuffer,
    tags: string[] = [],
    title?: string,
  ): Promise<ImportJob> {
    const hash = await sha256(bytes),
      key = "file:" + hash;
    return this.exclusive(key, async () => {
      let job = await this.journal.get(key);
      if (!job) {
        const asset = await this.transport.asset(name, bytes);
        const category = categoryOf(name);
        job = {
          key,
          name,
          title: title || name.replace(/\.[^.]+$/, ""),
          category,
          originalPath: asset.path,
          readerIds: [],
          tags,
          state: "local",
          ...(category === "article" ? { sourceUrl: importUrl(hash) } : {}),
        };
        await this.journal.put(job);
      }
      const current: ImportJob = { ...job, tags: [...new Set([...job.tags, ...tags])] };
      return this.run(current, async () => {
        if (current.category !== "article")
          return this.transport.upload(name, contentType, bytes);
        const text = new TextDecoder().decode(bytes);
        const id = await this.transport.save({
          url: importUrl(hash),
          html: /\.html?$/i.test(name)
            ? text
            : `<article><pre>${escapeHtml(text)}</pre></article>`,
          should_clean_html: true,
          title: current.title,
          category: "article",
          location: "new",
          saved_using: "obsidian-readwise-tracker",
        });
        return [id];
      });
    });
  }
  async url(request: ReadwiseSaveDocumentRequest): Promise<ImportJob> {
    const url = new URL(request.url);
    url.hash = "";
    const key = "url:" + (await sha256(url.toString()));
    return this.exclusive(key, async () => {
      const existing = await this.journal.get(key);
      const job: ImportJob = existing || {
        key,
        name: request.title || request.url,
        title: request.title,
        category: request.category || "article",
        sourceUrl: url.toString(),
        readerIds: [],
        tags: [],
        state: "local",
      };
      job.tags = [...new Set([...job.tags, ...(request.tags || [])])];
      return this.run(job, async () => [
        await this.transport.save({ ...request, url: url.toString() }),
      ]);
    });
  }
  private async run(
    job: ImportJob,
    create: () => Promise<string[]>,
  ): Promise<ImportJob> {
    // A completed import is only reusable while its Reader document still exists;
    // otherwise deleting it in Reader would block re-importing the same file or URL.
    if (
      job.state === "complete" &&
      job.readerIds.length &&
      this.transport.exists &&
      !(await this.transport.exists(job.readerIds).catch(() => true))
    )
      job = { ...job, readerIds: [], state: "local", error: undefined };
    if (job.state === "uploading" || job.state === "uncertain") {
      const ids = await this.transport.find(job);
      if (!ids.length) {
        await this.journal.put({ ...job, state: "uncertain" });
        throw new UncertainImportError();
      }
      job = { ...job, readerIds: ids, state: "registered" };
      await this.journal.put(job);
    }
    if (!job.readerIds.length) {
      job = {
        ...job,
        state: "uploading",
        startedAt: new Date().toISOString(),
        error: undefined,
      };
      await this.journal.put(job);
      try {
        const ids = await create();
        if (!ids.length)
          throw new Error("Reader did not return a document ID.");
        // Commit IDs before tags, manifest creation or sync can fail.
        job = { ...job, readerIds: ids, state: "registered" };
        await this.journal.put(job);
      } catch (error) {
        // A rejected request never created anything; a dropped connection may have.
        const status = errorStatus(error);
        const safeToRetry =
          (error instanceof Error &&
            error.name === "ReaderAuthenticationError") ||
          (status >= 400 && status < 500 && status !== 408);
        await this.journal.put({
          ...job,
          state: safeToRetry ? "local" : "uncertain",
          error: errorMessage(error),
        });
        throw error;
      }
    }
    await this.transport.bind(job);
    await this.transport.tags(job.readerIds, job.tags);
    await this.transport.sync();
    job = { ...job, state: "complete", error: undefined };
    await this.journal.put(job);
    return job;
  }
}

export function importCandidates(
  job: ImportJob,
  documents: ReadwiseDocument[],
): ReadwiseDocument[] {
  if (job.sourceUrl)
    return documents.filter(
      (d) => d.source_url === job.sourceUrl || d.url === job.sourceUrl,
    );
  return documents.filter(
    (d) =>
      d.category === job.category &&
      (d.title === job.title || d.title === job.name),
  );
}

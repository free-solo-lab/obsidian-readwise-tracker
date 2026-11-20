import type {
  WorkspaceStorage,
  WorkspaceDocument,
} from "../../src/workspace/types";
import { linkPath, parseMarkdown } from "../../src/workspace/markdown";

export class MemoryVault implements WorkspaceStorage {
  texts = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  times = new Map<string, number>();
  clock = 1;
  metadataReady = true;
  files() {
    return [...this.texts.keys(), ...this.binaries.keys()].map((path) => ({
      path,
      basename: (path.split("/").pop() || "").replace(/\.md$/, ""),
      mtime: this.times.get(path) || 0,
      metadata: this.metadataReady
        ? parseMarkdown(this.texts.get(path) || "").metadata
        : undefined,
    }));
  }
  async read(path: string) {
    if (!this.texts.has(path)) throw new Error("Missing " + path);
    return this.texts.get(path) || "";
  }
  async create(path: string, content: string) {
    if (this.exists(path)) throw new Error("Exists " + path);
    this.texts.set(path, content);
    this.times.set(path, ++this.clock);
  }
  async process(path: string, update: (current: string) => string) {
    const old = await this.read(path),
      next = update(old);
    if (old !== next) {
      this.texts.set(path, next);
      this.times.set(path, ++this.clock);
    }
  }
  exists(path: string) {
    return this.texts.has(path) || this.binaries.has(path);
  }
  async remove(path: string) {
    this.texts.delete(path);
    this.times.delete(path);
  }
  async rename(from: string, to: string) {
    if (this.exists(to)) throw new Error("Exists " + to);
    this.texts.set(to, await this.read(from));
    this.texts.delete(from);
    this.times.set(to, ++this.clock);
  }
  mtime(path: string) {
    return this.exists(path) ? this.times.get(path) || 0 : undefined;
  }
  resolve(link: string) {
    const path = linkPath(link);
    const files = this.files().filter(
      (f) => f.path === path || f.path === path + ".md" || f.basename === path,
    );
    return files.length === 1 ? files[0].path : undefined;
  }
  async readBinary(path: string) {
    return (
      this.binaries.get(path) ||
      new TextEncoder().encode(await this.read(path)).buffer
    );
  }
  async createBinary(path: string, data: ArrayBuffer) {
    this.binaries.set(path, data);
    this.times.set(path, ++this.clock);
  }
}
export const doc: WorkspaceDocument = {
  id: "book-a",
  title: "Book A",
  author: "Author",
  category: "epub",
  readerId: "reader-a",
  notePath: "Books/Book A.md",
  highlightsFolder: "Highlights/Book A",
  workspacePath: "Highlights/Book A/Workspace",
};
export const other: WorkspaceDocument = {
  ...doc,
  id: "book-b",
  title: "Book B",
  notePath: "Books/Book B.md",
  highlightsFolder: "Highlights/Book B",
  workspacePath: "Highlights/Book B/Workspace",
};

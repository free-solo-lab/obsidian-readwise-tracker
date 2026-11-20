import { TFile, normalizePath, type App } from "obsidian";
import { linkPath } from "./markdown";
import type { WorkspaceFile, WorkspaceStorage } from "./types";

export class ObsidianWorkspaceStorage implements WorkspaceStorage {
  constructor(private readonly app: App) {}
  private snapshot: WorkspaceFile[] | undefined;
  /** Called on every vault/metadata event; the listing is rebuilt lazily, once per change. */
  invalidate(): void {
    this.snapshot = undefined;
  }
  files(): WorkspaceFile[] {
    return (this.snapshot ??= this.list());
  }
  private list(): WorkspaceFile[] {
    return this.app.vault.getFiles().map((file) => ({
      path: file.path,
      basename: file.basename,
      mtime: file.stat.mtime,
      metadata: this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined,
    }));
  }
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return file;
  }
  async folder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    parts.pop();
    let folder = "";
    for (const part of parts) {
      if (!part || part === "." || part === "..")
        throw new Error("Invalid vault path.");
      folder = folder ? folder + "/" + part : part;
      if (!this.app.vault.getAbstractFileByPath(folder))
        try {
          await this.app.vault.createFolder(folder);
        } catch (error) {
          if (!this.app.vault.getAbstractFileByPath(folder)) throw error;
        }
    }
  }
  read(path: string): Promise<string> {
    return this.app.vault.cachedRead(this.file(path));
  }
  async create(path: string, content: string): Promise<void> {
    await this.folder(path);
    await this.app.vault.create(normalizePath(path), content);
    this.invalidate();
  }
  async process(
    path: string,
    update: (current: string) => string,
  ): Promise<void> {
    await this.app.vault.process(this.file(path), update);
    this.invalidate();
  }
  exists(path: string): boolean {
    return (
      this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile
    );
  }
  async remove(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.file(path));
    this.invalidate();
  }
  async rename(from: string, to: string): Promise<void> {
    // fileManager keeps links to the note intact, like a rename in Obsidian itself.
    await this.app.fileManager.renameFile(this.file(from), normalizePath(to));
    this.invalidate();
  }
  mtime(path: string): number | undefined {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file.stat.mtime : undefined;
  }
  resolve(link: string, from: string): string | undefined {
    return this.app.metadataCache.getFirstLinkpathDest(linkPath(link), from)?.path;
  }
  readBinary(path: string): Promise<ArrayBuffer> {
    return this.app.vault.readBinary(this.file(path));
  }
  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.folder(path);
    await this.app.vault.createBinary(normalizePath(path), data);
    this.invalidate();
  }
}

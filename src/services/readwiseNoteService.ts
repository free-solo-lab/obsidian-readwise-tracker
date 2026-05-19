import { Notice, TFile, normalizePath, type App } from "obsidian";
import type { LocalBook } from "../models/store";
import type { ReadwiseTrackerSettings } from "../settings/types";
import {
  buildLinkedHighlightNoteContent,
  parseHighlightNote,
  parseReadwiseHighlightsFromMarkdown,
} from "./readwiseHighlightParsing";
import {
  buildReadwiseInboxNoteContent,
  buildReadwiseInboxNoteFileBaseName,
} from "./readwiseInboxNoteTemplate";
import { getCurrentLocale, t } from "../i18n";

export class ReadwiseNoteService {
  constructor(private readonly app: App) {}

  async createInboxNoteFromHighlight(
    settings: ReadwiseTrackerSettings,
    args: { highlightFile: TFile; book: LocalBook; bookFile?: TFile | null },
  ): Promise<TFile> {
    const inboxFolder = normalizePath(String(settings.readwiseInboxFolder || "Inbox/Readwise"))
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

    await this.ensureFolderExists(inboxFolder);

    const highlightCache = this.app.metadataCache.getFileCache(args.highlightFile);
    const frontmatter = highlightCache?.frontmatter as Record<string, unknown> | undefined;
    const highlightTitle =
      (typeof frontmatter?.title === "string" ? frontmatter.title : undefined) || args.highlightFile.basename;
    const highlightDate = typeof frontmatter?.date === "string" ? frontmatter.date : "";

    const highlightLink = `[[${args.highlightFile.path}|${args.highlightFile.basename}]]`;
    const bookLink = args.bookFile
      ? `[[${args.bookFile.path}|${args.bookFile.basename}]]`
      : `[[${args.book.title}]]`;

    const highlightText = await this.app.vault.cachedRead(args.highlightFile);
    const parsed = parseHighlightNote(highlightText);

    const baseName = buildReadwiseInboxNoteFileBaseName(highlightTitle);
    let outPath = normalizePath(`${inboxFolder}/${baseName}.md`);
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(outPath)) {
      outPath = normalizePath(`${inboxFolder}/${baseName} (${index}).md`);
      index += 1;
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const content = buildReadwiseInboxNoteContent({
      title: highlightTitle,
      created: todayKey,
      bookLink,
      sourceLink: highlightLink,
      sourceDate: highlightDate ? highlightDate.slice(0, 10) : undefined,
      quote: parsed.quote,
      description: parsed.description,
    });

    const created = await this.app.vault.create(outPath, content);
    await this.app.workspace.getLeaf(false)?.openFile(created);
    return created;
  }

  async migrateReadwiseBookNotesToLinkedHighlights(
    settings: ReadwiseTrackerSettings,
    debugLogging: boolean,
  ): Promise<void> {
    const sourceFolder = normalizePath(settings.readwiseBooksFolder || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const destRoot = normalizePath(settings.readwiseLinkedHighlightsFolder || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

    if (!sourceFolder || !destRoot) {
      new Notice(t("notice.setFolders"));
      return;
    }

    await this.ensureFolderExists(destRoot);

    const sourcePrefix = `${sourceFolder}/`;
    const sourceFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path === sourceFolder || file.path.startsWith(sourcePrefix));

    if (sourceFiles.length === 0) {
      new Notice(t("notice.noMarkdownFiles", { sourceFolder }));
      return;
    }

    new Notice(t("notice.migratingNotes", { count: sourceFiles.length }));
    const locale = getCurrentLocale();

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of sourceFiles) {
      try {
        const bookTitle = file.basename;
        const outDir = normalizePath(`${destRoot}/${bookTitle}`);
        await this.ensureFolderExists(outDir);

        const markdown = await this.app.vault.read(file);
        const highlights = parseReadwiseHighlightsFromMarkdown(markdown);
        const total = highlights.length;
        if (total === 0) {
          continue;
        }

        for (let index = 1; index <= total; index += 1) {
          const highlight = highlights[index - 1];
          const outPath = normalizePath(`${outDir}/${bookTitle} — ${String(index).padStart(3, "0")}.md`);
          const existing = this.app.vault.getAbstractFileByPath(outPath);
          if (existing instanceof TFile) {
            skipped += 1;
            continue;
          }

          const content = buildLinkedHighlightNoteContent({
            bookTitle,
            index,
            total,
            text: highlight.text,
            comment: highlight.comment,
            date: highlight.date,
            locale,
          });
          await this.app.vault.create(outPath, content);
          created += 1;
        }
      } catch (error) {
        errors += 1;
        if (debugLogging) {
          console.error(error);
        }
      }
    }

    new Notice(t("notice.migrationComplete", { created, skipped, errors }));
  }

  async ensureFolderExists(path: string): Promise<void> {
    const normalized = normalizePath(path).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalized) {
      return;
    }

    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}

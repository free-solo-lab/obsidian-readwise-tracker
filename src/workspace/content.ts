import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { unzip, strFromU8, gunzipSync } from "fflate";
import type { WorkspaceStorage } from "./types";
import { pathJoin } from "./markdown";
import { markdownTable, type PreparedTable, type TableCell } from "./tables";
import { HighlightTableIndex, readHighlightTables } from "./highlightTables";
import { yieldToEventLoop } from "../utils/timing";

export async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Strips scripts, embeds and forms from HTML that came from Reader or the model. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
  });
}
function converter(
  tables?: PreparedTable[],
  htmlTables = false,
): TurndownService {
  const options: TurndownService.Options = {
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  };
  const service = new TurndownService(options);
  service.addRule("workspaceTable", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll("tr")).filter(
        (row) => row.closest("table") === node,
      );
      const complex =
        htmlTables ||
        !!node.parentElement?.closest("li") ||
        !!node.querySelector(
          '[colspan]:not([colspan="1"]), [rowspan]:not([rowspan="1"]), table, ul, ol, pre',
        ) ||
        rows
          .slice(1)
          .some(
            (row) =>
              row.parentElement?.tagName === "THEAD" || row.querySelector("th"),
          );
      let markdown: string;
      let cells: TableCell[][] | undefined;
      const copy = node.cloneNode(true) as HTMLElement;
      for (const element of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
        element.removeAttribute("style");
        element.removeAttribute("class");
      }
      if (complex) {
        markdown = copy.outerHTML;
      } else {
        const caption = node.querySelector("caption");
        cells = rows.map((row) =>
          Array.from(row.children)
            .filter((cell) => /^(TH|TD)$/.test(cell.tagName))
            .map((cell) => ({
              text: service.turndown(cell.innerHTML),
              header:
                cell.tagName === "TH" || row.parentElement?.tagName === "THEAD",
              align:
                cell.getAttribute("align") ||
                (cell as HTMLElement).style.textAlign,
            })),
        );
        markdown =
          (caption ? service.turndown(caption.innerHTML) + "\n\n" : "") +
          markdownTable(cells);
      }
      if (tables && !node.parentElement?.closest("table")) {
        copy.querySelector("caption")?.remove();
        tables.push({
          legacy: new TurndownService(options).turndown(node.outerHTML),
          markdown,
          highlight: {
            text: new TurndownService(options).turndown(copy.outerHTML),
            markdown: cells ? markdownTable(cells) : copy.outerHTML,
            rows: cells,
          },
        });
      }
      return "\n\n" + markdown + "\n\n";
    },
  });
  return service;
}
export function htmlToMarkdown(
  html: string,
  tables?: PreparedTable[],
  htmlTables = false,
): string {
  return converter(tables, htmlTables).turndown(sanitizeHtml(html));
}
export async function prepareTableRepairs(
  html: string,
): Promise<PreparedTable[]> {
  const document = new DOMParser().parseFromString(html, "text/html"),
    tables: PreparedTable[] = [];
  let index = 0;
  for (const table of Array.from(document.querySelectorAll("table"))) {
    if (table.parentElement?.closest("table")) continue;
    htmlToMarkdown(
      table.outerHTML,
      tables,
      !!table.parentElement?.closest("li"),
    );
    if (++index % 8 === 0) await yieldToEventLoop();
  }
  return tables;
}
/** Reuse the prepared book, including raw HTML for tables with merged cells. */
export async function prepareHighlightTableIndex(
  markdown: string,
): Promise<HighlightTableIndex> {
  const { tables, html } = readHighlightTables(markdown);
  for (const fragment of html) {
    for (const prepared of await prepareTableRepairs(fragment))
      if (prepared.highlight) tables.push(prepared.highlight);
  }
  return new HighlightTableIndex(tables);
}
/** Convert independent HTML blocks in batches instead of running Turndown over
 * a whole book in one uninterrupted task. Containers are inert DOMParser nodes. */
export async function htmlToMarkdownAsync(
  html: string,
  tables?: PreparedTable[],
): Promise<string> {
  if (html.length < 64_000) return htmlToMarkdown(html, tables);
  const document = new DOMParser().parseFromString(html, "text/html"),
    result: string[] = [],
    stack = Array.from(document.body.childNodes).reverse();
  let batch = "",
    visited = 0;
  const flush = async () => {
    if (batch.trim()) result.push(htmlToMarkdown(batch, tables));
    batch = "";
    await yieldToEventLoop();
  };
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (
        ["DIV", "ARTICLE", "MAIN", "SECTION"].includes(element.tagName) &&
        Array.from(element.children).some((child) =>
          [
            "DIV",
            "P",
            "SECTION",
            "ARTICLE",
            "MAIN",
            "H1",
            "H2",
            "H3",
            "UL",
            "OL",
            "TABLE",
            "PRE",
            "BLOCKQUOTE",
          ].includes(child.tagName),
        )
      ) {
        stack.push(...Array.from(element.childNodes).reverse());
        continue;
      }
      batch += element.outerHTML;
    } else if (node.nodeType === Node.TEXT_NODE)
      batch += escapeHtml(node.textContent || "");
    if (batch.length >= 32_768) await flush();
    else if (++visited % 256 === 0) await yieldToEventLoop();
  }
  await flush();
  return result.filter(Boolean).join("\n\n");
}
function archivePath(base: string, href: string): string {
  const result: string[] = [];
  for (const part of (
    base +
    "/" +
    decodeURIComponent(href.split("#")[0])
  ).split("/")) {
    if (part === "..") result.pop();
    else if (part && part !== ".") result.push(part);
  }
  return result.join("/");
}
export async function extractEpub(
  data: ArrayBuffer,
  storage: WorkspaceStorage,
  assetsRoot: string,
  tables?: PreparedTable[],
): Promise<string> {
  const archive = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(
        new Uint8Array(data),
        { filter: (file) => file.originalSize < 64 * 1024 * 1024 },
        (error, files) => (error ? reject(error) : resolve(files)),
      );
    },
  );
  const xml = (path: string) => {
    const bytes = archive[path];
    if (!bytes) throw new Error(`EPUB resource missing: ${path}`);
    return new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  };
  const root = xml("META-INF/container.xml")
    .querySelector("rootfile")
    ?.getAttribute("full-path");
  if (!root) throw new Error("Invalid EPUB package.");
  const manifest = xml(root),
    base = root.split("/").slice(0, -1).join("/");
  const items = new Map(
    Array.from(manifest.querySelectorAll("manifest > item")).map((el) => [
      el.getAttribute("id"),
      el.getAttribute("href") || "",
    ]),
  );
  const chapters: string[] = [];
  for (const item of Array.from(manifest.querySelectorAll("spine > itemref"))) {
    const href = items.get(item.getAttribute("idref"));
    if (!href) continue;
    const path = archivePath(base, href),
      bytes = archive[path];
    if (!bytes) continue;
    const html = new DOMParser().parseFromString(strFromU8(bytes), "text/html");
    for (const image of Array.from(html.querySelectorAll("img"))) {
      const src = image.getAttribute("src");
      if (!src) continue;
      const imagePath = archivePath(
          path.split("/").slice(0, -1).join("/"),
          src,
        ),
        imageData = archive[imagePath];
      if (!imageData) {
        image.remove();
        continue;
      }
      const binary = Uint8Array.from(imageData).buffer,
        hash = await sha256(binary),
        extension =
          imagePath
            .split(".")
            .pop()
            ?.replace(/[^a-z0-9]/gi, "") || "bin";
      const saved = pathJoin(assetsRoot, hash + "." + extension);
      if (!storage.exists(saved)) await storage.createBinary(saved, binary);
      image.setAttribute("src", saved);
    }
    chapters.push(await htmlToMarkdownAsync(html.body.innerHTML, tables));
    await yieldToEventLoop();
  }
  return chapters.join("\n\n");
}
export async function extractPdf(data: ArrayBuffer): Promise<string> {
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerModule = await import("rwt-pdf-worker");
  const assetModule = await import("rwt-pdf-assets");
  const assets = assetModule.default;
  // The build gzips the worker and resources; they are unpacked only when a PDF is read.
  const decode = (value: string): Uint8Array =>
    gunzipSync(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
    ) as Uint8Array;
  class BinaryData {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      const value = (kind === "cMapUrl" ? assets.cmaps : assets.fonts)[
        filename
      ];
      if (!value) throw new Error("Missing bundled PDF resource");
      return decode(value);
    }
  }
  const url = URL.createObjectURL(
    new Blob([decode(workerModule.default)], { type: "text/javascript" }),
  );
  const port = new Worker(url, { type: "module" }),
    worker = pdf.PDFWorker.create({ port });
  const task = pdf.getDocument({
    data: new Uint8Array(data.slice(0)),
    worker,
    useWasm: false,
    useWorkerFetch: false,
    BinaryDataFactory: BinaryData,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_resolve, reject) => {
    port.addEventListener("error", (event) =>
      reject(new Error("PDF worker: " + (event.message || "could not start"))),
    );
    timeout = setTimeout(
      () =>
        reject(
          new Error(
            "PDF could not be prepared. Open the original or attach a text version.",
          ),
        ),
      45_000,
    );
  });
  try {
    const document = await Promise.race([task.promise, failed]),
      parts: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i),
        content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      if (text.trim()) parts.push(`<!-- rwt-page ${i} -->\n\n${text.trim()}`);
      page.cleanup();
      await yieldToEventLoop();
    }
    if (!parts.length)
      throw new Error(
        "PDF has no readable text layer. Open the original or attach an OCR text file.",
      );
    return parts.join("\n\n");
  } finally {
    if (timeout) clearTimeout(timeout);
    void task.destroy().catch(() => undefined);
    worker.destroy();
    port.terminate();
    URL.revokeObjectURL(url);
  }
}
export async function extractFile(
  name: string,
  data: ArrayBuffer,
  storage: WorkspaceStorage,
  assetsRoot: string,
  tables?: PreparedTable[],
): Promise<string> {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "epub")
    return extractEpub(data, storage, assetsRoot, tables);
  if (extension === "pdf") return extractPdf(data);
  const text = new TextDecoder().decode(data);
  return extension === "html" || extension === "htm"
    ? htmlToMarkdownAsync(text, tables)
    : text;
}

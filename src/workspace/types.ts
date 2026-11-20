export type WorkspaceNodeKind = "highlight" | "thought" | "dialog" | "relation";
export interface WorkspaceDocument {
  id: string;
  title: string;
  author: string;
  category: string;
  readerId?: string;
  notePath?: string;
  highlightsFolder: string;
  workspacePath: string;
}
export interface WorkspaceFile {
  path: string;
  basename: string;
  mtime: number;
  metadata?: Record<string, unknown>;
}
export interface WorkspaceStorage {
  files(): WorkspaceFile[];
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  process(path: string, update: (current: string) => string): Promise<void>;
  exists(path: string): boolean;
  /** Modification time, or undefined when the file does not exist. */
  mtime(path: string): number | undefined;
  rename(from: string, to: string): Promise<void>;
  /** Moves the file to the trash according to the user's Obsidian settings. */
  remove(path: string): Promise<void>;
  resolve(link: string, from: string): string | undefined;
  readBinary(path: string): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer): Promise<void>;
}
export interface WorkspaceNode {
  id: string;
  kind: WorkspaceNodeKind;
  path: string;
  documentId?: string;
  book?: string;
  body: string;
  quote: string;
  title: string;
  index?: number;
  /** Position among the book's highlights; fractional for notes inserted later. */
  order?: number;
  sources: string[];
  /** Marked by the reader to come back to later (`rwt_important`). */
  important?: boolean;
  target?: string;
  raw: string;
  mtime: number;
  /** Light graph entry: body, quote and raw are not loaded yet. */
  stub?: boolean;
}
export interface SourceAnchor {
  matcherVersion?: number;
  id: string;
  nodePath: string;
  quote: string;
  revision: string;
  status: "matched" | "ambiguous" | "missing";
  start?: number;
  end?: number;
  candidates: Array<{ start: number; end: number }>;
  readerUrl?: string;
  readerHighlightId?: string;
  readerOffset?: number;
  manual?: boolean;
  selectedText?: string;
  history?: Array<{
    revision: string;
    start?: number;
    end?: number;
    status: string;
    quote: string;
  }>;
}
export interface DocumentSource {
  documentId: string;
  readerId?: string;
  originalPath?: string;
  contentPath?: string;
  contentHash?: string;
  originalHash?: string;
  fetchedAt?: string;
  /** SHA-256 of resource identity -> SHA-256 of image bytes; rebuildable. */
  imageHashes?: Record<string, string>;
  tableFormat?: number;
  anchors: SourceAnchor[];
}
export interface ContentResolution {
  status: "ready" | "missing" | "processing" | "error";
  markdown: string;
  path?: string;
  originalPath?: string;
  revision: string;
  anchors: SourceAnchor[];
  message?: string;
}
export interface DialogMessage {
  id: string;
  role: "user" | "assistant";
  created: string;
  content: string;
  sources: string[];
  revision?: string;
  /** Note dialog this message was written in, when it also belongs to the book chat. */
  origin?: string;
}
/** What one question sends: the reader's notes, the dialog so far and the new question. */
export interface AiRequest {
  book: { title: string; author: string };
  notes: Array<{ label: string; quote: string; comment: string }>;
  /** Earlier messages; sent only when no Codex thread exists yet (it remembers them itself). */
  history: DialogMessage[];
  question: string;
  /** The book's Codex thread, when one was started before. */
  threadId?: string;
  /** Name for a newly started thread. */
  title?: string;
}
export interface AiAnswer {
  text: string;
  threadId?: string;
}
export interface AiCallbacks {
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  /** The answer so far (whole text each time). */
  onText?: (text: string) => void;
}
export interface WorkspaceAiAdapter {
  /** Why generation cannot run right now, or undefined when it can. */
  unavailable(): string | undefined;
  /** How many other tasks wait for the shared Bridge queue. */
  queued(): number;
  generate(request: AiRequest, callbacks: AiCallbacks): Promise<AiAnswer>;
}
export interface ImportJob {
  key: string;
  state: "local" | "uploading" | "uncertain" | "registered" | "complete";
  name: string;
  category: string;
  originalPath?: string;
  sourceUrl?: string;
  readerIds: string[];
  tags: string[];
  title?: string;
  error?: string;
  startedAt?: string;
}

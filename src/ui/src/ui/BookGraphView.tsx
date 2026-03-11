import { ItemView, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import type ReadwiseTrackerPlugin from '../../main';
import { LocalBook } from '../models/store';

export const BOOK_GRAPH_VIEW_TYPE = 'readwise-book-graph-view';

type ViewState = { bookId?: string };

export class BookGraphView extends ItemView {
    plugin: ReadwiseTrackerPlugin;
    root: ReactDOM.Root | null = null;
    state: ViewState = {};

    constructor(leaf: WorkspaceLeaf, plugin: ReadwiseTrackerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return BOOK_GRAPH_VIEW_TYPE;
    }

    getDisplayText() {
        return 'Граф книги';
    }

    async setState(state: ViewState) {
        this.state = state || {};
        this.render();
    }

    getState() {
        return this.state;
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        this.root = ReactDOM.createRoot(container);
        this.render();
    }

    async onClose() {
        if (this.root) this.root.unmount();
    }

    render() {
        if (!this.root) return;
        const state = (this.leaf.getViewState() as any)?.state as ViewState | undefined;
        const bookId = state?.bookId || this.state.bookId;
        this.root.render(<BookGraphComponent plugin={this.plugin} bookId={bookId} />);
    }
}

type HighlightItem = {
    file: TFile;
    title: string;
    index?: number;
    date?: string;
    dateTs?: number;
};

type Node = {
    id: string;
    label: string;
    kind: 'book' | 'highlight';
    file?: TFile;
    x: number;
    y: number;
    subtitle?: string;
};

type Edge = { from: string; to: string };

const BookGraphComponent: React.FC<{ plugin: ReadwiseTrackerPlugin; bookId?: string }> = ({ plugin, bookId }) => {
    const [books, setBooks] = React.useState<LocalBook[]>([]);
    const [highlightsSort, setHighlightsSort] = React.useState<'date' | 'index'>('date');
    const [highlightsSortDir, setHighlightsSortDir] = React.useState<'asc' | 'desc'>('asc');
    const [scale, setScale] = React.useState(1);
    const [pan, setPan] = React.useState({ x: 0, y: 0 });
    const [activeNodeId, setActiveNodeId] = React.useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
    const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null);
    const [tooltipData, setTooltipData] = React.useState<{ title: string; details: string; quote: string; description: string; path: string } | null>(null);
    const graphContainerRef = React.useRef<HTMLDivElement | null>(null);

    const loadData = React.useCallback(() => {
        const data = plugin.dataManager.getData();
        setBooks(Object.values(data.books));
    }, [plugin.dataManager]);

    React.useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, [loadData]);

    const currentBook = React.useMemo(() => {
        if (bookId) return books.find((b) => b.id === bookId) || null;
        const reading = books
            .filter((b) => b.status === 'reading')
            .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
        return reading[0] || null;
    }, [bookId, books]);

    const normalizeName = React.useCallback((s: string) =>
        s
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-z0-9а-я]+/gi, ' ')
            .trim()
            .replace(/\s+/g, ' ')
    , []);

    const booksFiles = React.useMemo(() => {
        const booksRaw = (plugin.settings as any)?.readwiseBooksFolder || 'Readwise/Books';
        const booksRoot = normalizePath(String(booksRaw)).replace(/^\/+/, '').replace(/\/+$/, '');
        const booksPrefix = booksRoot ? `${booksRoot}/` : '';
        return plugin.app.vault.getMarkdownFiles().filter((f) => (booksRoot ? (f.path === booksRoot || f.path.startsWith(booksPrefix)) : false));
    }, [plugin.app.vault, plugin.settings]);

    const bookNoteFile = React.useMemo(() => {
        if (!currentBook) return null;
        const id = String(currentBook.readwise_id || currentBook.id || '');
        for (const f of booksFiles) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmUrl = typeof fm?.url === 'string' ? fm.url : '';
            if (id && fmUrl && fmUrl.includes(id)) return f as TFile;
        }
        const wanted = normalizeName(currentBook.title);
        for (const f of booksFiles) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmTitle = typeof fm?.title === 'string' ? fm.title : '';
            if (normalizeName(fmTitle) === wanted || normalizeName(f.basename) === wanted) return f as TFile;
        }
        return null;
    }, [booksFiles, currentBook, normalizeName, plugin.app.metadataCache]);

    const highlightsFiles = React.useMemo(() => {
        if (!currentBook) return [];

        const rootRaw = (plugin.settings as any)?.readwiseLinkedHighlightsFolder || 'Readwise/Highlights';
        const root = normalizePath(String(rootRaw)).replace(/^\/+/, '').replace(/\/+$/, '');

        const booksRaw = (plugin.settings as any)?.readwiseBooksFolder || 'Readwise/Books';
        const booksRoot = normalizePath(String(booksRaw)).replace(/^\/+/, '').replace(/\/+$/, '');
        const booksPrefix = booksRoot ? `${booksRoot}/` : '';

        const id = String(currentBook.readwise_id || currentBook.id || '');
        const booksFilesLocal = plugin.app.vault.getMarkdownFiles().filter((f) => (booksRoot ? (f.path === booksRoot || f.path.startsWith(booksPrefix)) : false));

        let folderName: string | null = null;
        for (const f of booksFilesLocal) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmUrl = typeof fm?.url === 'string' ? fm.url : '';
            if (id && fmUrl && fmUrl.includes(id)) {
                folderName = f.basename;
                break;
            }
        }
        if (!folderName) {
            const wanted = normalizeName(currentBook.title);
            for (const f of booksFilesLocal) {
                const cache = plugin.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter as any;
                const fmTitle = typeof fm?.title === 'string' ? fm.title : '';
                if (normalizeName(fmTitle) === wanted || normalizeName(f.basename) === wanted) {
                    folderName = f.basename;
                    break;
                }
            }
        }

        const preferredFolderName = folderName || currentBook.title;
        const folder = normalizePath(`${root}/${preferredFolderName}`);
        const prefix = `${folder}/`;
        const inPreferredFolder = plugin.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix)).sort((a, b) => a.basename.localeCompare(b.basename, 'ru'));
        if (inPreferredFolder.length > 0) return inPreferredFolder;

        const rootPrefix = root ? `${root}/` : '';
        const wanted = normalizeName(currentBook.title);
        return plugin.app.vault
            .getMarkdownFiles()
            .filter((f) => (root ? f.path.startsWith(rootPrefix) : false))
            .filter((f) => {
                const cache = plugin.app.metadataCache.getFileCache(f);
                const bookField = (cache?.frontmatter as any)?.book;
                const bookText = typeof bookField === 'string' ? bookField : '';
                const normalizedBook = normalizeName(bookText.replace(/^\[\[|\]\]$/g, ''));
                if (normalizedBook && normalizedBook.includes(wanted)) return true;
                return normalizeName(f.path).includes(wanted);
            })
            .sort((a, b) => a.basename.localeCompare(b.basename, 'ru'));
    }, [currentBook, normalizeName, plugin.app.metadataCache, plugin.app.vault, plugin.settings]);

    const highlightItems = React.useMemo((): HighlightItem[] => {
        return highlightsFiles.map((f) => {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const title = (fm?.title as string | undefined) || f.basename;
            const index = typeof fm?.index === 'number' ? fm.index : undefined;
            const date = typeof fm?.date === 'string' ? fm.date : undefined;
            const dateTs = date ? new Date(date).getTime() : undefined;
            return { file: f as TFile, title, index, date, dateTs };
        });
    }, [highlightsFiles, plugin.app.metadataCache]);

    const sortedHighlights = React.useMemo(() => {
        const dir = highlightsSortDir === 'asc' ? 1 : -1;
        return [...highlightItems].sort((a, b) => {
            if (highlightsSort === 'index') {
                const ai = typeof a.index === 'number' ? a.index : Number.POSITIVE_INFINITY;
                const bi = typeof b.index === 'number' ? b.index : Number.POSITIVE_INFINITY;
                if (ai !== bi) return (ai - bi) * dir;
                const at = typeof a.dateTs === 'number' && Number.isFinite(a.dateTs) ? a.dateTs : Number.POSITIVE_INFINITY;
                const bt = typeof b.dateTs === 'number' && Number.isFinite(b.dateTs) ? b.dateTs : Number.POSITIVE_INFINITY;
                if (at !== bt) return (at - bt) * dir;
                return a.file.basename.localeCompare(b.file.basename, 'ru') * dir;
            }
            const at = typeof a.dateTs === 'number' && Number.isFinite(a.dateTs) ? a.dateTs : Number.POSITIVE_INFINITY;
            const bt = typeof b.dateTs === 'number' && Number.isFinite(b.dateTs) ? b.dateTs : Number.POSITIVE_INFINITY;
            if (at !== bt) return (at - bt) * dir;
            const ai = typeof a.index === 'number' ? a.index : Number.POSITIVE_INFINITY;
            const bi = typeof b.index === 'number' ? b.index : Number.POSITIVE_INFINITY;
            if (ai !== bi) return (ai - bi) * dir;
            return a.file.basename.localeCompare(b.file.basename, 'ru') * dir;
        });
    }, [highlightItems, highlightsSort, highlightsSortDir]);

    const graph = React.useMemo(() => {
        const nodes: Node[] = [];
        const edges: Edge[] = [];

        if (!currentBook) return { nodes, edges };

        const bookNodeId = `book:${currentBook.id}`;
        nodes.push({
            id: bookNodeId,
            label: currentBook.title,
            kind: 'book',
            file: bookNoteFile || undefined,
            x: 0,
            y: 0,
            subtitle: currentBook.author || undefined,
        });

        const max = Math.min(300, sortedHighlights.length);

        if (highlightsSort === 'date') {
            const baseY = 220;
            const stepY = 160;
            let prevId: string | null = null;
            for (let i = 0; i < max; i++) {
                const h = sortedHighlights[i];
                const id = `hl:${h.file.path}`;
                const subtitleParts: string[] = [];
                if (typeof h.index === 'number') subtitleParts.push(`#${h.index}`);
                if (h.date) subtitleParts.push(h.date.slice(0, 10));
                nodes.push({
                    id,
                    label: h.title,
                    kind: 'highlight',
                    file: h.file,
                    x: 0,
                    y: baseY + i * stepY,
                    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined,
                });
                if (prevId) {
                    edges.push({ from: prevId, to: id });
                } else {
                    edges.push({ from: bookNodeId, to: id });
                }
                prevId = id;
            }
        } else {
            const radius = Math.max(220, Math.min(520, 120 + max * 18));
            const startAngle = -Math.PI / 2;
            const step = max > 0 ? (Math.PI * 2) / max : Math.PI * 2;
            for (let i = 0; i < max; i++) {
                const h = sortedHighlights[i];
                const id = `hl:${h.file.path}`;
                const a = startAngle + i * step;
                const subtitleParts: string[] = [];
                if (typeof h.index === 'number') subtitleParts.push(`#${h.index}`);
                if (h.date) subtitleParts.push(h.date.slice(0, 10));
                nodes.push({
                    id,
                    label: h.title,
                    kind: 'highlight',
                    file: h.file,
                    x: Math.cos(a) * radius,
                    y: Math.sin(a) * radius,
                    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined,
                });
                edges.push({ from: bookNodeId, to: id });
            }
        }

        return { nodes, edges };
    }, [bookNoteFile, currentBook, highlightsSort, sortedHighlights]);

    const nodeById = React.useMemo(() => {
        const m = new Map<string, Node>();
        for (const n of graph.nodes) m.set(n.id, n);
        return m;
    }, [graph.nodes]);

    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const dragRef = React.useRef<{ dragging: boolean; lastX: number; lastY: number }>({ dragging: false, lastX: 0, lastY: 0 });

    const onWheel = React.useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.08 : 0.92;
        setScale((s) => Math.max(0.2, Math.min(2.5, s * factor)));
    }, []);

    const onMouseDown = React.useCallback((e: React.MouseEvent) => {
        dragRef.current.dragging = true;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
    }, []);

    const onMouseMove = React.useCallback((e: React.MouseEvent) => {
        if (!dragRef.current.dragging) return;
        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }, []);

    const onMouseUp = React.useCallback(() => {
        dragRef.current.dragging = false;
    }, []);

    const openFile = React.useCallback((file: TFile | undefined) => {
        if (!file) return;
        plugin.app.workspace.getLeaf(false).openFile(file);
    }, [plugin.app.workspace]);

    const nodeSize = React.useCallback((kind: Node['kind']) => {
        if (kind === 'book') return { w: 240, h: 86 };
        return { w: 260, h: 80 };
    }, []);

    const intersectRectFromCenter = React.useCallback((from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number }) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
        const halfW = Math.max(1, from.w / 2 - 2);
        const halfH = Math.max(1, from.h / 2 - 2);
        const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
        const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
        const t = Math.min(tx, ty);
        return { x: from.x + dx * t, y: from.y + dy * t };
    }, []);

    const parseHighlightNote = React.useCallback((text: string) => {
        const lines = text.split(/\r?\n/);
        let i = 0;
        if (lines[i] === '---') {
            i++;
            while (i < lines.length && lines[i] !== '---') i++;
            if (i < lines.length && lines[i] === '---') i++;
        }
        while (i < lines.length && lines[i].trim() === '') i++;

        let quote = '';
        if (i < lines.length && lines[i].trim().startsWith('>')) {
            const buf: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                buf.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            quote = buf.join('\n').trim();
        }

        while (i < lines.length && lines[i].trim() === '') i++;
        const descBuf: string[] = [];
        while (i < lines.length) {
            const line = lines[i];
            if (/^##\s+/.test(line)) break;
            if (line.trim() === '---') break;
            descBuf.push(line);
            i++;
        }
        const description = descBuf.join('\n').trim();

        return { quote, description };
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!hoveredNodeId) {
                setTooltipData(null);
                return;
            }
            const n = nodeById.get(hoveredNodeId);
            if (!n) {
                setTooltipData(null);
                return;
            }
            const size = nodeSize(n.kind);
            const details = n.subtitle || '';
            const path = n.file?.path || '';

            if (!n.file) {
                setTooltipData({ title: n.label, details, quote: '', description: '', path });
                return;
            }

            setTooltipData({ title: n.label, details, quote: '', description: '', path: n.file.path });
            const raw = await plugin.app.vault.cachedRead(n.file);
            if (cancelled) return;

            if (n.kind === 'highlight') {
                const parsed = parseHighlightNote(raw);
                setTooltipData({ title: n.label, details, quote: parsed.quote, description: parsed.description, path: n.file.path });
                return;
            }

            const lines = raw.split(/\r?\n/);
            let i = 0;
            if (lines[i] === '---') {
                i++;
                while (i < lines.length && lines[i] !== '---') i++;
                if (i < lines.length && lines[i] === '---') i++;
            }
            const body = lines.slice(i).join('\n').trim();
            const firstParagraph = body.split(/\n\s*\n/)[0]?.trim() || '';
            setTooltipData({ title: n.label, details, quote: '', description: firstParagraph, path: n.file.path });
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [hoveredNodeId, nodeById, nodeSize, parseHighlightNote, plugin.app.vault]);

    const viewBoxPadding = 220;
    const bounds = React.useMemo(() => {
        if (graph.nodes.length === 0) return { minX: -300, maxX: 900, minY: -300, maxY: 300 };
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const n of graph.nodes) {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y);
        }
        return {
            minX: minX - viewBoxPadding,
            maxX: maxX + viewBoxPadding,
            minY: minY - viewBoxPadding,
            maxY: maxY + viewBoxPadding,
        };
    }, [graph.nodes]);

    return (
        <div className="p-4" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Граф книги</h1>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {currentBook ? currentBook.title : 'Нет выбранной книги'}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                        onClick={() => setHighlightsSort('date')}
                        style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: highlightsSort === 'date' ? '1px solid rgba(59,130,246,0.9)' : '1px solid rgba(27,31,35,0.18)',
                            background: highlightsSort === 'date' ? 'rgba(59,130,246,0.08)' : 'transparent',
                            cursor: 'pointer',
                        }}
                    >
                        По дате
                    </button>
                    <button
                        onClick={() => setHighlightsSort('index')}
                        style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: highlightsSort === 'index' ? '1px solid rgba(59,130,246,0.9)' : '1px solid rgba(27,31,35,0.18)',
                            background: highlightsSort === 'index' ? 'rgba(59,130,246,0.08)' : 'transparent',
                            cursor: 'pointer',
                        }}
                    >
                        По индексу
                    </button>
                    <button
                        onClick={() => setHighlightsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                        style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: '1px solid rgba(27,31,35,0.18)',
                            background: 'transparent',
                            cursor: 'pointer',
                        }}
                        title="Поменять направление"
                    >
                        {highlightsSortDir === 'asc' ? '↑' : '↓'}
                    </button>
                    <button
                        onClick={() => {
                            setScale(1);
                            setPan({ x: 0, y: 0 });
                        }}
                        style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: '1px solid rgba(27,31,35,0.18)',
                            background: 'transparent',
                            cursor: 'pointer',
                        }}
                    >
                        Сброс
                    </button>
                </div>
            </div>

            {!currentBook ? (
                <div style={{ fontSize: 13, opacity: 0.75 }}>Нет текущей книги (status=reading) и не передан bookId.</div>
            ) : (
                <div
                    ref={graphContainerRef}
                    style={{
                        flex: '1 1 auto',
                        border: '1px solid rgba(27,31,35,0.12)',
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.02)',
                        overflow: 'hidden',
                        position: 'relative',
                    }}
                >
                    <svg
                        ref={svgRef}
                        width="100%"
                        height="100%"
                        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
                        style={{ display: 'block', cursor: dragRef.current.dragging ? 'grabbing' : 'grab' }}
                        onWheel={onWheel}
                        onMouseDown={onMouseDown}
                        onMouseMove={onMouseMove}
                        onMouseUp={onMouseUp}
                        onMouseLeave={onMouseUp}
                    >
                        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                            {graph.edges.map((e) => {
                                const from = graph.nodes.find((n) => n.id === e.from);
                                const to = graph.nodes.find((n) => n.id === e.to);
                                if (!from || !to) return null;
                                const fromSize = nodeSize(from.kind);
                                const toSize = nodeSize(to.kind);
                                const start = intersectRectFromCenter({ x: from.x, y: from.y, w: fromSize.w, h: fromSize.h }, { x: to.x, y: to.y });
                                const end = intersectRectFromCenter({ x: to.x, y: to.y, w: toSize.w, h: toSize.h }, { x: from.x, y: from.y });
                                const dx = end.x - start.x;
                                const dy = end.y - start.y;
                                const useHorizontal = Math.abs(dx) >= Math.abs(dy);
                                const c1x = useHorizontal ? start.x + dx * 0.5 : start.x;
                                const c1y = useHorizontal ? start.y : start.y + dy * 0.5;
                                const c2x = useHorizontal ? end.x - dx * 0.5 : end.x;
                                const c2y = useHorizontal ? end.y : end.y - dy * 0.5;
                                const path = `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
                                const active = activeNodeId === e.from || activeNodeId === e.to;
                                return (
                                    <path
                                        key={`${e.from}->${e.to}`}
                                        d={path}
                                        fill="none"
                                        stroke={active ? 'rgba(59,130,246,0.9)' : 'rgba(27,31,35,0.18)'}
                                        strokeWidth={active ? 2.5 : 1.5}
                                    />
                                );
                            })}

                            {graph.nodes.map((n) => {
                                const active = activeNodeId === n.id;
                                const { w, h } = nodeSize(n.kind);
                                const x = n.x - w / 2;
                                const y = n.y - h / 2;
                                const fill = n.kind === 'book' ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)';
                                const stroke = active ? 'rgba(59,130,246,0.9)' : 'rgba(27,31,35,0.18)';

                                return (
                                    <g
                                        key={n.id}
                                        transform={`translate(${x} ${y})`}
                                        onMouseEnter={(e) => {
                                            setActiveNodeId(n.id);
                                            setHoveredNodeId(n.id);
                                            const rect = graphContainerRef.current?.getBoundingClientRect();
                                            if (rect) setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
                                        }}
                                        onMouseMove={(e) => {
                                            const rect = graphContainerRef.current?.getBoundingClientRect();
                                            if (rect) setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
                                        }}
                                        onMouseLeave={() => {
                                            setActiveNodeId(null);
                                            setHoveredNodeId(null);
                                            setTooltipPos(null);
                                        }}
                                        onClick={() => openFile(n.file)}
                                        style={{ cursor: n.file ? 'pointer' : 'default' }}
                                    >
                                        <rect width={w} height={h} rx={12} ry={12} fill={fill} stroke={stroke} strokeWidth={active ? 2 : 1} />
                                        <text x={12} y={26} fontSize={13} fontWeight={700} fill="currentColor">
                                            {n.label.length > 36 ? `${n.label.slice(0, 36)}…` : n.label}
                                        </text>
                                        {n.subtitle ? (
                                            <text x={12} y={46} fontSize={11} fill="currentColor" opacity={0.7}>
                                                {n.subtitle.length > 44 ? `${n.subtitle.slice(0, 44)}…` : n.subtitle}
                                            </text>
                                        ) : null}
                                        <text x={12} y={66} fontSize={11} fill="currentColor" opacity={0.7}>
                                            {n.kind === 'book' ? 'Книга' : 'Хайлайт'}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    </svg>
                    {tooltipPos && tooltipData ? (
                        <div
                            style={{
                                position: 'absolute',
                                left: tooltipPos.x,
                                top: tooltipPos.y,
                                maxWidth: 420,
                                padding: 10,
                                borderRadius: 10,
                                border: '1px solid rgba(27,31,35,0.18)',
                                background: 'rgba(20, 20, 20, 0.92)',
                                color: 'rgba(255,255,255,0.92)',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                                fontSize: 12,
                                lineHeight: 1.35,
                                pointerEvents: 'none',
                                zIndex: 10,
                            }}
                        >
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, whiteSpace: 'pre-wrap' }}>{tooltipData.title}</div>
                            {tooltipData.details ? (
                                <div style={{ opacity: 0.8, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{tooltipData.details}</div>
                            ) : null}
                            {tooltipData.quote ? (
                                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginBottom: tooltipData.description ? 8 : 0, whiteSpace: 'pre-wrap' }}>
                                    {tooltipData.quote}
                                </div>
                            ) : null}
                            {tooltipData.description ? (
                                <div style={{ opacity: 0.9, whiteSpace: 'pre-wrap' }}>{tooltipData.description}</div>
                            ) : null}
                            {tooltipData.path ? (
                                <div style={{ opacity: 0.6, marginTop: 8, whiteSpace: 'pre-wrap' }}>{tooltipData.path}</div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
};

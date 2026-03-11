import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import type ReadwiseTrackerPlugin from '../../main';
import { LocalBook, ReadingActivityDay } from '../models/store';

export const STATS_VIEW_TYPE = 'readwise-stats-view';

export class StatsView extends ItemView {
    plugin: ReadwiseTrackerPlugin;
    root: ReactDOM.Root | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ReadwiseTrackerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return STATS_VIEW_TYPE;
    }

    getDisplayText() {
        return 'Readwise Stats';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        this.root = ReactDOM.createRoot(container);
        this.render();
        
        // Register for data changes to re-render
        // Ideally we would have an event emitter in DataManager
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }

    render() {
        if (!this.root) return;
        this.root.render(
            <StatsComponent plugin={this.plugin} />
        );
    }
}

const MarkdownBlock: React.FC<{ plugin: ReadwiseTrackerPlugin; markdown: string; sourcePath: string }> = ({ plugin, markdown, sourcePath }) => {
    const ref = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (!ref.current) return;
        const el = ref.current;
        el.empty();

        const component = new Component();
        void MarkdownRenderer.render(plugin.app, markdown, el, sourcePath, component);
        return () => {
            component.unload();
        };
    }, [markdown, plugin.app, sourcePath]);

    return <div ref={ref} />;
};

const StatsComponent: React.FC<{ plugin: ReadwiseTrackerPlugin }> = ({ plugin }) => {
    const [books, setBooks] = React.useState<LocalBook[]>([]);
    const [readingActivityByBook, setReadingActivityByBook] = React.useState<Record<string, Record<string, ReadingActivityDay>>>({});
    const [highlightsSort, setHighlightsSort] = React.useState<'date' | 'index'>('date');
    const [highlightsSortDir, setHighlightsSortDir] = React.useState<'asc' | 'desc'>('asc');
    const [expandedHighlightPaths, setExpandedHighlightPaths] = React.useState<Record<string, boolean>>({});
    const [highlightContentByPath, setHighlightContentByPath] = React.useState<Record<string, { quote: string; description: string }>>({});
    const [creatingInboxPath, setCreatingInboxPath] = React.useState<string | null>(null);
    const [selectedBookId, setSelectedBookId] = React.useState<string | null>(null);
    const [bookQuery, setBookQuery] = React.useState('');
    const [bookPickerOpen, setBookPickerOpen] = React.useState(false);

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

    const loadData = () => {
        const data = plugin.dataManager.getData();
        setBooks(Object.values(data.books));
        setReadingActivityByBook(data.readingActivityByBook || {});
    };

    React.useEffect(() => {
        loadData();
        // Poll for changes or subscribe if event system existed
        const interval = setInterval(loadData, 5000); 
        return () => clearInterval(interval);
    }, []);

    const readingBook = React.useMemo(() => {
        const reading = books
            .filter(b => b.status === 'reading')
            .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
        return reading[0] || null;
    }, [books]);

    React.useEffect(() => {
        if (!selectedBookId && readingBook) setSelectedBookId(readingBook.id);
    }, [readingBook, selectedBookId]);

    const activeBook = React.useMemo(() => {
        if (selectedBookId) return books.find((b) => b.id === selectedBookId) || null;
        return readingBook;
    }, [books, readingBook, selectedBookId]);

    React.useEffect(() => {
        if (selectedBookId && !books.some((b) => b.id === selectedBookId)) setSelectedBookId(null);
    }, [books, selectedBookId]);

    const formatRemaining = React.useCallback((minutesRaw: number) => {
        const minutes = Math.max(0, Math.round(minutesRaw));
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h <= 0) return `${m}м`;
        if (m === 0) return `${h}ч`;
        return `${h}ч ${m}м`;
    }, []);

    const getRemainingMinutes = React.useCallback((book: LocalBook) => {
        const wpm = 200;
        const totalWords = book.words_count || 0;
        if (totalWords <= 0) return null;
        const progressRatio = Math.min(100, Math.max(0, book.reading_progress || 0)) / 100;
        const remainingWords = totalWords * (1 - progressRatio);
        return remainingWords / wpm;
    }, []);

    const minutesFromDay = React.useCallback((day: ReadingActivityDay | undefined, totalWords: number) => {
        if (!day) return 0;
        if ((day.minutes || 0) > 0) return day.minutes || 0;
        if ((day.words || 0) > 0) return (day.words || 0) / 200;
        if ((day.progressPoints || 0) > 0 && totalWords > 0) {
            const deltaWords = (totalWords * (day.progressPoints || 0)) / 100;
            return deltaWords / 200;
        }
        return 0;
    }, []);

    const spentMinutes = React.useMemo(() => {
        if (!activeBook) return 0;
        const byDay = readingActivityByBook[activeBook.id] || {};
        const totalWords = activeBook.words_count || 0;
        let sum = 0;
        for (const day of Object.values(byDay)) sum += minutesFromDay(day, totalWords);
        return sum;
    }, [activeBook, minutesFromDay, readingActivityByBook]);

    const formatDate = React.useCallback((iso: string | undefined) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d);
    }, []);

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
        if (!activeBook) return null;
        const id = String(activeBook.readwise_id || activeBook.id || '');
        for (const f of booksFiles) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmUrl = typeof fm?.url === 'string' ? fm.url : '';
            if (id && fmUrl && fmUrl.includes(id)) return f as TFile;
        }
        const wanted = normalizeName(activeBook.title);
        for (const f of booksFiles) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmTitle = typeof fm?.title === 'string' ? fm.title : '';
            if (normalizeName(fmTitle) === wanted || normalizeName(f.basename) === wanted) return f as TFile;
        }
        return null;
    }, [activeBook, booksFiles, normalizeName, plugin.app.metadataCache]);

    const highlightsFiles = React.useMemo(() => {
        if (!activeBook) return [];
        const rootRaw = (plugin.settings as any)?.readwiseLinkedHighlightsFolder || 'Readwise/Highlights';
        const root = normalizePath(String(rootRaw)).replace(/^\/+/, '').replace(/\/+$/, '');

        const id = String(activeBook.readwise_id || activeBook.id || '');

        let folderName: string | null = null;
        for (const f of booksFiles) {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const fmUrl = typeof fm?.url === 'string' ? fm.url : '';
            if (id && fmUrl && fmUrl.includes(id)) {
                folderName = f.basename;
                break;
            }
        }
        if (!folderName) {
            const wanted = normalizeName(activeBook.title);
            for (const f of booksFiles) {
                const cache = plugin.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter as any;
                const fmTitle = typeof fm?.title === 'string' ? fm.title : '';
                if (normalizeName(fmTitle) === wanted || normalizeName(f.basename) === wanted) {
                    folderName = f.basename;
                    break;
                }
            }
        }

        const preferredFolderName = folderName || activeBook.title;
        const folder = normalizePath(`${root}/${preferredFolderName}`);
        const prefix = `${folder}/`;
        const inPreferredFolder = plugin.app.vault.getMarkdownFiles()
            .filter((f) => f.path.startsWith(prefix))
            .sort((a, b) => a.basename.localeCompare(b.basename, 'ru'));
        if (inPreferredFolder.length > 0) return inPreferredFolder;

        const rootPrefix = root ? `${root}/` : '';
        const wanted = normalizeName(activeBook.title);
        return plugin.app.vault.getMarkdownFiles()
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
    }, [activeBook, booksFiles, normalizeName, plugin.app.metadataCache, plugin.app.vault, plugin.settings]);

    const highlightItems = React.useMemo(() => {
        const items = highlightsFiles.map((f) => {
            const cache = plugin.app.metadataCache.getFileCache(f);
            const fm = cache?.frontmatter as any;
            const title = (fm?.title as string | undefined) || f.basename;
            const index = typeof fm?.index === 'number' ? fm.index : undefined;
            const date = typeof fm?.date === 'string' ? fm.date : '';
            const dateTs = date ? new Date(date).getTime() : Number.NaN;
            return { file: f as TFile, title, index, date, dateTs };
        });

        const dir = highlightsSortDir === 'asc' ? 1 : -1;
        const sorted = [...items].sort((a, b) => {
            if (highlightsSort === 'index') {
                const ai = typeof a.index === 'number' ? a.index : Number.POSITIVE_INFINITY;
                const bi = typeof b.index === 'number' ? b.index : Number.POSITIVE_INFINITY;
                if (ai !== bi) return (ai - bi) * dir;
                return a.file.basename.localeCompare(b.file.basename, 'ru') * dir;
            }
            const at = Number.isFinite(a.dateTs) ? a.dateTs : Number.POSITIVE_INFINITY;
            const bt = Number.isFinite(b.dateTs) ? b.dateTs : Number.POSITIVE_INFINITY;
            if (at !== bt) return (at - bt) * dir;
            const ai = typeof a.index === 'number' ? a.index : Number.POSITIVE_INFINITY;
            const bi = typeof b.index === 'number' ? b.index : Number.POSITIVE_INFINITY;
            if (ai !== bi) return (ai - bi) * dir;
            return a.file.basename.localeCompare(b.file.basename, 'ru') * dir;
        });

        return sorted;
    }, [highlightsFiles, highlightsSort, highlightsSortDir, plugin.app.metadataCache]);

    const bookMatches: LocalBook[] = React.useMemo(() => {
        const q = normalizeName(bookQuery);
        const list = books
            .slice()
            .sort((a, b) => a.title.localeCompare(b.title, 'ru'));

        if (!q) return list.slice(0, 20);

        const scored = list
            .map((b) => {
                const hay = normalizeName(`${b.title} ${b.author || ''}`);
                const idx = hay.indexOf(q);
                const score = idx === -1 ? Number.POSITIVE_INFINITY : idx;
                return { b, score };
            })
            .filter((x) => Number.isFinite(x.score))
            .sort((a, b) => a.score - b.score || a.b.title.localeCompare(b.b.title, 'ru'));

        return scored.slice(0, 20).map((x) => x.b);
    }, [bookQuery, books, normalizeName]);

    return (
        <div className="p-4">
            <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 240 }}>
                        <input
                            value={bookQuery}
                            onChange={(e) => {
                                setBookQuery(e.target.value);
                                setBookPickerOpen(true);
                            }}
                            onFocus={() => setBookPickerOpen(true)}
                            onBlur={() => {
                                window.setTimeout(() => setBookPickerOpen(false), 120);
                            }}
                            placeholder="Поиск книги…"
                            style={{
                                width: '100%',
                                fontSize: 13,
                                padding: '8px 10px',
                                borderRadius: 10,
                                border: '1px solid rgba(27,31,35,0.18)',
                                background: 'transparent',
                            }}
                        />

                        {bookPickerOpen && bookMatches.length > 0 ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    zIndex: 50,
                                    top: 'calc(100% + 6px)',
                                    left: 0,
                                    right: 0,
                                    maxHeight: 280,
                                    overflow: 'auto',
                                    borderRadius: 12,
                                    border: '1px solid rgba(27,31,35,0.18)',
                                    background: 'var(--background-primary)',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                                }}
                            >
                                {bookMatches.map((b) => (
                                    <div
                                        key={b.id}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            setSelectedBookId(b.id);
                                            setBookQuery('');
                                            setBookPickerOpen(false);
                                            setExpandedHighlightPaths({});
                                            setHighlightContentByPath({});
                                        }}
                                        style={{
                                            padding: '10px 12px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid rgba(27,31,35,0.08)',
                                        }}
                                    >
                                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{b.title}</div>
                                        {b.author ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{b.author}</div> : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <button
                        onClick={() => {
                            if (readingBook) {
                                setSelectedBookId(readingBook.id);
                                setBookQuery('');
                                setBookPickerOpen(false);
                                setExpandedHighlightPaths({});
                                setHighlightContentByPath({});
                            }
                        }}
                        disabled={!readingBook || !!(activeBook && readingBook && activeBook.id === readingBook.id)}
                        style={{
                            fontSize: 12,
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: '1px solid rgba(27,31,35,0.18)',
                            background: 'transparent',
                            cursor: !readingBook || !!(activeBook && readingBook && activeBook.id === readingBook.id) ? 'default' : 'pointer',
                            opacity: !readingBook || !!(activeBook && readingBook && activeBook.id === readingBook.id) ? 0.6 : 1,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        Читаю сейчас
                    </button>
                </div>

                {!activeBook ? (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                        Выберите книгу, чтобы посмотреть её заметки.
                    </div>
                ) : null}
            </div>

            {!activeBook ? null : (
                <div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: 12,
                            border: '1px solid rgba(27,31,35,0.12)',
                            borderRadius: 10,
                            background: 'rgba(255,255,255,0.03)',
                        }}
                    >
                        <div style={{ width: 46, height: 64, flex: '0 0 auto', borderRadius: 6, overflow: 'hidden', background: 'rgba(27,31,35,0.06)' }}>
                            {activeBook.cover_url ? (
                                <img
                                    src={activeBook.cover_url}
                                    alt={activeBook.title}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                />
                            ) : null}
                        </div>

                        <div style={{ flex: '1 1 auto', minWidth: 240 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                                {activeBook.title}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 3 }}>
                                {activeBook.author || ''}
                            </div>

                            {activeBook.tags && activeBook.tags.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    {activeBook.tags.slice(0, 20).map((t: string) => (
                                        <span
                                            key={t}
                                            style={{
                                                fontSize: 12,
                                                padding: '3px 8px',
                                                borderRadius: 999,
                                                border: '1px solid rgba(27,31,35,0.18)',
                                                opacity: 0.85,
                                            }}
                                        >
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            ) : null}

                            <div style={{ marginTop: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, opacity: 0.85 }}>
                                    <div>{Math.min(100, Math.max(0, activeBook.reading_progress || 0)).toFixed(1)}%</div>
                                    <div style={{ whiteSpace: 'nowrap' }}>
                                        ушло: {formatRemaining(spentMinutes)}
                                        {' · '}
                                        осталось: {(() => {
                                            const remaining = getRemainingMinutes(activeBook);
                                            return remaining === null ? '—' : formatRemaining(remaining);
                                        })()}
                                    </div>
                                </div>
                                <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: 'rgba(27,31,35,0.12)', overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.min(100, Math.max(0, activeBook.reading_progress || 0))}%`, height: '100%', background: '#3b82f6' }} />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 10 }}>Highlights</h2>
                        {highlightItems.length === 0 ? (
                            <div style={{ fontSize: 13, opacity: 0.75 }}>
                                Нет созданных хайлайтов в папке связок.
                            </div>
                        ) : (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                                    <button
                                        onClick={() => {
                                            (plugin as any).openBookGraph?.(activeBook.id);
                                        }}
                                        style={{
                                            fontSize: 12,
                                            padding: '6px 10px',
                                            borderRadius: 10,
                                            border: '1px solid rgba(27,31,35,0.18)',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Открыть граф
                                    </button>

                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
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
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {highlightItems.slice(0, 300).map((h) => {
                                        const isExpanded = !!expandedHighlightPaths[h.file.path];
                                        const cached = highlightContentByPath[h.file.path];
                                        return (
                                        <div
                                            key={h.file.path}
                                            style={{
                                                padding: 10,
                                                border: '1px solid rgba(27,31,35,0.12)',
                                                borderRadius: 10,
                                                background: 'rgba(255,255,255,0.02)',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
                                                    <button
                                                        onClick={async () => {
                                                            const nextExpanded = !isExpanded;
                                                            setExpandedHighlightPaths((prev) => ({ ...prev, [h.file.path]: nextExpanded }));

                                                            if (nextExpanded && !highlightContentByPath[h.file.path]) {
                                                                try {
                                                                    const text = await plugin.app.vault.cachedRead(h.file);
                                                                    const parsed = parseHighlightNote(text);
                                                                    setHighlightContentByPath((prev) => ({ ...prev, [h.file.path]: parsed }));
                                                                } catch (e) {
                                                                    setHighlightContentByPath((prev) => ({
                                                                        ...prev,
                                                                        [h.file.path]: {
                                                                            quote: '',
                                                                            description: `Ошибка чтения заметки: ${e instanceof Error ? e.message : String(e)}`,
                                                                        },
                                                                    }));
                                                                }
                                                            }
                                                        }}
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: 6,
                                                            border: '1px solid rgba(27,31,35,0.18)',
                                                            background: 'transparent',
                                                            cursor: 'pointer',
                                                            flex: '0 0 auto',
                                                            lineHeight: '20px',
                                                            textAlign: 'center',
                                                            padding: 0,
                                                            opacity: 0.9,
                                                        }}
                                                        title={isExpanded ? 'Схлопнуть' : 'Раскрыть'}
                                                    >
                                                        {isExpanded ? '▾' : '▸'}
                                                    </button>

                                                    <a
                                                        href="#"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            plugin.app.workspace.getLeaf(false).openFile(h.file);
                                                        }}
                                                        style={{
                                                            fontSize: 13,
                                                            textDecoration: 'underline',
                                                            color: 'inherit',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                        title={h.title}
                                                    >
                                                        {typeof h.index === 'number' ? `${String(h.index).padStart(3, '0')} · ${h.title}` : h.title}
                                                    </a>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                setCreatingInboxPath(h.file.path);
                                                                await plugin.createInboxNoteFromHighlight({ highlightFile: h.file, book: activeBook, bookFile: bookNoteFile });
                                                            } finally {
                                                                setCreatingInboxPath((cur) => (cur === h.file.path ? null : cur));
                                                            }
                                                        }}
                                                        disabled={creatingInboxPath === h.file.path}
                                                        style={{
                                                            fontSize: 12,
                                                            padding: '4px 8px',
                                                            borderRadius: 999,
                                                            border: '1px solid rgba(27,31,35,0.18)',
                                                            background: 'transparent',
                                                            cursor: creatingInboxPath === h.file.path ? 'default' : 'pointer',
                                                            opacity: creatingInboxPath === h.file.path ? 0.6 : 1,
                                                        }}
                                                        title="Создать заметку в inbox"
                                                    >
                                                        {creatingInboxPath === h.file.path ? 'Создаю…' : 'Создать'}
                                                    </button>
                                                </div>
                                            </div>

                                            {h.date ? (
                                                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                                    {formatDate(h.date)}
                                                </div>
                                            ) : null}

                                            {isExpanded ? (
                                                <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, opacity: 0.9 }}>
                                                    {!cached ? (
                                                        <div style={{ opacity: 0.7 }}>Загрузка…</div>
                                                    ) : (
                                                        <div>
                                                            <MarkdownBlock
                                                                plugin={plugin}
                                                                sourcePath={h.file.path}
                                                                markdown={[
                                                                    cached.quote ? cached.quote.split('\n').map((l) => `> ${l}`).join('\n') : '',
                                                                    cached.description || '',
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join('\n\n')}
                                                            />
                                                            {!cached.quote && !cached.description ? (
                                                                <div style={{ opacity: 0.7 }}>Пустая заметка.</div>
                                                            ) : null}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

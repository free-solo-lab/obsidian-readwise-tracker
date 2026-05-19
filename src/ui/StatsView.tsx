import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf, TFile } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import type { ReadwiseTrackerViewHost } from '../plugin/contracts';
import { LocalBook, ReadingActivityDay } from '../models/store';
import { findBookNoteFile, findHighlightFilesForBook, normalizeSearchName } from '../services/readwiseFiles';
import { parseHighlightNote } from '../services/readwiseHighlightParsing';
import { formatDurationCompact, getCurrentLocale, getDateLocale, getSortLocale, t } from '../i18n';

export const STATS_VIEW_TYPE = 'readwise-stats-view';

export class StatsView extends ItemView {
    plugin: ReadwiseTrackerViewHost;
    root: ReactDOM.Root | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ReadwiseTrackerViewHost) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return STATS_VIEW_TYPE;
    }

    getDisplayText() {
        return t('view.highlights');
    }

    getIcon() {
        return 'book-open';
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

const MarkdownBlock: React.FC<{ plugin: ReadwiseTrackerViewHost; markdown: string; sourcePath: string }> = ({ plugin, markdown, sourcePath }) => {
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

function getBookPlaceholderLabel(book: LocalBook): string {
    const source = `${book.title || ''} ${book.author || ''}`.trim();
    const letters = source
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
    return letters || 'B';
}

const StatsComponent: React.FC<{ plugin: ReadwiseTrackerViewHost }> = ({ plugin }) => {
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
    const locale = getCurrentLocale();
    const dateLocale = getDateLocale(locale);
    const sortLocale = getSortLocale(locale);

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
        return formatDurationCompact(minutesRaw, locale);
    }, [locale]);

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
        return new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short' }).format(d);
    }, [dateLocale]);

    const bookNoteFile = React.useMemo(() => {
        if (!activeBook) return null;
        return findBookNoteFile(plugin.app, plugin.settings, activeBook);
    }, [activeBook, plugin.app, plugin.settings]);

    const highlightsFiles = React.useMemo(() => {
        if (!activeBook) return [];
        return findHighlightFilesForBook(plugin.app, plugin.settings, activeBook);
    }, [activeBook, plugin.app, plugin.settings]);

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
                return a.file.basename.localeCompare(b.file.basename, sortLocale) * dir;
            }
            const at = Number.isFinite(a.dateTs) ? a.dateTs : Number.POSITIVE_INFINITY;
            const bt = Number.isFinite(b.dateTs) ? b.dateTs : Number.POSITIVE_INFINITY;
            if (at !== bt) return (at - bt) * dir;
            const ai = typeof a.index === 'number' ? a.index : Number.POSITIVE_INFINITY;
            const bi = typeof b.index === 'number' ? b.index : Number.POSITIVE_INFINITY;
            if (ai !== bi) return (ai - bi) * dir;
            return a.file.basename.localeCompare(b.file.basename, sortLocale) * dir;
        });

        return sorted;
    }, [highlightsFiles, highlightsSort, highlightsSortDir, plugin.app.metadataCache, sortLocale]);

    const bookMatches: LocalBook[] = React.useMemo(() => {
        const q = normalizeSearchName(bookQuery);
        const list = books
            .slice()
            .sort((a, b) => a.title.localeCompare(b.title, sortLocale));

        if (!q) return list.slice(0, 20);

        const scored = list
            .map((b) => {
                const hay = normalizeSearchName(`${b.title} ${b.author || ''}`);
                const idx = hay.indexOf(q);
                const score = idx === -1 ? Number.POSITIVE_INFINITY : idx;
                return { b, score };
            })
            .filter((x) => Number.isFinite(x.score))
            .sort((a, b) => a.score - b.score || a.b.title.localeCompare(b.b.title, sortLocale));

        return scored.slice(0, 20).map((x) => x.b);
    }, [bookQuery, books, sortLocale]);

    return (
        <div className="p-4">
            <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div className="readwise-book-search">
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
                            placeholder={t('stats.searchPlaceholder')}
                            className="readwise-book-search-input"
                        />

                        {bookPickerOpen && bookMatches.length > 0 ? (
                            <div className="readwise-book-picker">
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
                                        className="readwise-book-picker-item"
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
                        className="readwise-current-book-button"
                    >
                        {t('stats.currentlyReading')}
                    </button>
                </div>

                {!activeBook ? (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                        {t('stats.selectBook')}
                    </div>
                ) : null}
            </div>

            {!activeBook ? null : (
                <div>
                    <div className="readwise-selected-book-card">
                        <div className="readwise-selected-book-cover">
                            {activeBook.cover_url ? (
                                <img
                                    src={activeBook.cover_url}
                                    alt={activeBook.title}
                                    className="readwise-selected-book-cover-image"
                                />
                            ) : (
                                <span className="readwise-selected-book-cover-placeholder">
                                    {getBookPlaceholderLabel(activeBook)}
                                </span>
                            )}
                        </div>

                        <div className="readwise-selected-book-body">
                            <div className="readwise-selected-book-title">
                                {activeBook.title}
                            </div>
                            <div className="readwise-selected-book-author">
                                {activeBook.author || ''}
                            </div>

                            {activeBook.tags && activeBook.tags.length > 0 ? (
                                <div className="readwise-selected-book-tags">
                                    {activeBook.tags.slice(0, 20).map((t: string) => (
                                        <span key={t} className="readwise-selected-book-tag">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            ) : null}

                            <div className="readwise-selected-book-progress">
                                <div className="readwise-selected-book-progress-labels">
                                    <div>{Math.min(100, Math.max(0, activeBook.reading_progress || 0)).toFixed(1)}%</div>
                                    <div className="readwise-selected-book-progress-time">
                                        {t('stats.spent')}: {formatRemaining(spentMinutes)}
                                        {' · '}
                                        {t('stats.remaining')}: {(() => {
                                            const remaining = getRemainingMinutes(activeBook);
                                            return remaining === null ? '-' : formatRemaining(remaining);
                                        })()}
                                    </div>
                                </div>
                                <div className="readwise-selected-book-progress-bar">
                                    <div
                                        className="readwise-selected-book-progress-fill"
                                        style={{ width: `${Math.min(100, Math.max(0, activeBook.reading_progress || 0))}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 10 }}>{t('stats.highlights')}</h2>
                        {highlightItems.length === 0 ? (
                            <div style={{ fontSize: 13, opacity: 0.75 }}>
                                {t('stats.noHighlights')}
                            </div>
                        ) : (
                            <div>
                                <div className="readwise-highlights-toolbar">
                                    <button
                                        onClick={() => {
                                            void plugin.openBookGraph(activeBook.id);
                                        }}
                                        className="readwise-graph-button"
                                    >
                                        {t('stats.openGraph')}
                                    </button>

                                    <div className="readwise-sort-control" aria-label={t('stats.sortHighlights')}>
                                        <button
                                            onClick={() => setHighlightsSort('date')}
                                            className={`readwise-sort-option${highlightsSort === 'date' ? ' is-active' : ''}`}
                                        >
                                            {t('stats.sortByDate')}
                                        </button>
                                        <button
                                            onClick={() => setHighlightsSort('index')}
                                            className={`readwise-sort-option${highlightsSort === 'index' ? ' is-active' : ''}`}
                                        >
                                            {t('stats.sortByIndex')}
                                        </button>
                                        <button
                                            onClick={() => setHighlightsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                                            className="readwise-sort-direction"
                                            title={t('stats.toggleSortDirection')}
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
                                            className={`readwise-highlight-card${isExpanded ? ' is-expanded' : ''}`}
                                        >
                                            <div className="readwise-highlight-card-header">
                                                <div className="readwise-highlight-title-row">
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
                                                                            description: t('stats.readNoteError', {
                                                                                message: e instanceof Error ? e.message : String(e),
                                                                            }),
                                                                        },
                                                                    }));
                                                                }
                                                            }
                                                        }}
                                                        className="readwise-highlight-toggle"
                                                        title={isExpanded ? t('stats.collapse') : t('stats.expand')}
                                                    >
                                                        {isExpanded ? '▾' : '▸'}
                                                    </button>

                                                    <div className="readwise-highlight-title-stack">
                                                        <button
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            plugin.app.workspace.getLeaf(false).openFile(h.file);
                                                        }}
                                                            className="readwise-highlight-title"
                                                        title={h.title}
                                                    >
                                                        {typeof h.index === 'number' ? `${String(h.index).padStart(3, '0')} · ${h.title}` : h.title}
                                                        </button>
                                                        {h.date ? (
                                                            <div className="readwise-highlight-date">
                                                                {formatDate(h.date)}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="readwise-highlight-actions">
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
                                                        className="readwise-highlight-create"
                                                        aria-label={t('stats.createInboxNote')}
                                                        title={t('stats.createInboxNote')}
                                                    >
                                                        <span className="readwise-highlight-create-icon">
                                                            {creatingInboxPath === h.file.path ? '…' : '✎'}
                                                        </span>
                                                        <span className="readwise-highlight-create-label">{t('stats.inInbox')}</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {isExpanded ? (
                                                <div className="readwise-highlight-content">
                                                    {!cached ? (
                                                        <div className="readwise-highlight-muted">{t('stats.loading')}</div>
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
                                                                <div className="readwise-highlight-muted">{t('stats.emptyNote')}</div>
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

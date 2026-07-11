import { Component, ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, TFile } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import type { ReadwiseTrackerViewHost } from '../plugin/contracts';
import { LocalBook, ReadingActivityDay } from '../models/store';
import { findBookNoteFile, findHighlightFilesForBook, normalizeSearchName } from '../services/readwiseFiles';
import { parseHighlightNote } from '../services/readwiseHighlightParsing';
import { formatDurationCompact, getCurrentLocale, getDateLocale, getSortLocale, t } from '../i18n';
import { compareBooksByRecentActivity, getMinutesForDay, getRemainingMinutes } from './dashboardHelpers';

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

function getImportFileTitle(file: File): string {
    return file.name.replace(/\.[^.]+$/, '').trim() || file.name;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getReaderFileContentType(file: File): string | null {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (extension === 'epub') return 'application/epub+zip';
    if (extension === 'pdf') return 'application/pdf';
    if (extension === 'html' || extension === 'htm') return 'text/html';
    if (extension === 'txt') return 'text/plain';
    if (extension === 'md') return 'text/markdown';
    if (file.type) return file.type;
    return null;
}

function isReaderAuthenticationError(error: unknown): boolean {
    return error instanceof Error && error.name === 'ReaderAuthenticationError';
}

function mergeImportTags(tags: string[], pending = ''): string[] {
    const unique = new Map<string, string>();
    for (const raw of [...tags, ...pending.split(',')]) {
        const tag = raw.trim().replace(/^#+/, '');
        if (tag) unique.set(tag.toLocaleLowerCase(), tag);
    }
    return Array.from(unique.values());
}

const StatsComponent: React.FC<{ plugin: ReadwiseTrackerViewHost }> = ({ plugin }) => {
    const [books, setBooks] = React.useState<LocalBook[]>([]);
    const [readingActivityByBook, setReadingActivityByBook] = React.useState<Record<string, Record<string, ReadingActivityDay>>>({});
    const [highlightsSort, setHighlightsSort] = React.useState<'date' | 'index'>('date');
    const [highlightsSortDir, setHighlightsSortDir] = React.useState<'asc' | 'desc'>('asc');
    const [expandedHighlightPaths, setExpandedHighlightPaths] = React.useState<Record<string, boolean>>({});
    const [highlightContentByPath, setHighlightContentByPath] = React.useState<Record<string, { quote: string; description: string }>>({});
    const [creatingInboxPath, setCreatingInboxPath] = React.useState<string | null>(null);
    const [deletingBookId, setDeletingBookId] = React.useState<string | null>(null);
    const [bookDeleteConfirmationOpen, setBookDeleteConfirmationOpen] = React.useState(false);
    const [selectedBookId, setSelectedBookId] = React.useState<string | null>(
        () => plugin.getSelectedHighlightsBookId(),
    );
    const [bookQuery, setBookQuery] = React.useState('');
    const [bookPickerOpen, setBookPickerOpen] = React.useState(false);
    const [importMenuOpen, setImportMenuOpen] = React.useState(false);
    const [importDialog, setImportDialog] = React.useState<'url' | 'upload' | null>(null);
    const [importUrl, setImportUrl] = React.useState('');
    const [importTitle, setImportTitle] = React.useState('');
    const [selectedImportFile, setSelectedImportFile] = React.useState<File | null>(null);
    const [importStatus, setImportStatus] = React.useState<string | null>(null);
    const [importBusy, setImportBusy] = React.useState(false);
    const [readerLoginRequired, setReaderLoginRequired] = React.useState(false);
    const [readerEmail, setReaderEmail] = React.useState('');
    const [readerPassword, setReaderPassword] = React.useState('');
    const [importTags, setImportTags] = React.useState<string[]>([]);
    const [importTagInput, setImportTagInput] = React.useState('');
    const [importDragActive, setImportDragActive] = React.useState(false);
    const [bookTagEditorOpen, setBookTagEditorOpen] = React.useState(false);
    const [bookTagInput, setBookTagInput] = React.useState('');
    const [bookTagBusy, setBookTagBusy] = React.useState(false);
    const [bookTagStatus, setBookTagStatus] = React.useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const importControlRef = React.useRef<HTMLDivElement | null>(null);
    const locale = getCurrentLocale();
    const dateLocale = getDateLocale(locale);
    const sortLocale = getSortLocale(locale);

    const availableTags = React.useMemo(() => Array.from(new Set(
        books.flatMap((book) => book.tags || []).map((tag) => tag.trim()).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, sortLocale)), [books, sortLocale]);

    const suggestedImportTags = React.useMemo(() => {
        const query = importTagInput.trim().toLocaleLowerCase();
        const selected = new Set(importTags.map((tag) => tag.toLocaleLowerCase()));
        return availableTags
            .filter((tag) => !selected.has(tag.toLocaleLowerCase()))
            .filter((tag) => !query || tag.toLocaleLowerCase().includes(query))
            .slice(0, 12);
    }, [availableTags, importTagInput, importTags]);

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

    React.useEffect(() => plugin.onSelectedHighlightsBookChange((bookId) => {
        setSelectedBookId(bookId);
        setBookQuery('');
        setBookPickerOpen(false);
        setExpandedHighlightPaths({});
        setHighlightContentByPath({});
    }), [plugin]);

    React.useEffect(() => {
        if (!importMenuOpen) return;

        const closeImportMenuOnOutsideClick = (event: PointerEvent) => {
            if (!importControlRef.current?.contains(event.target as Node)) {
                setImportMenuOpen(false);
            }
        };

        document.addEventListener('pointerdown', closeImportMenuOnOutsideClick);
        return () => document.removeEventListener('pointerdown', closeImportMenuOnOutsideClick);
    }, [importMenuOpen]);

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

    const availableBookTags = React.useMemo(() => {
        const current = new Set((activeBook?.tags || []).map((tag) => tag.toLocaleLowerCase()));
        const query = bookTagInput.trim().toLocaleLowerCase();
        return availableTags
            .filter((tag) => !current.has(tag.toLocaleLowerCase()))
            .filter((tag) => !query || tag.toLocaleLowerCase().includes(query))
            .slice(0, 12);
    }, [activeBook, availableTags, bookTagInput]);

    React.useEffect(() => {
        setBookTagEditorOpen(false);
        setBookTagInput('');
        setBookTagStatus(null);
    }, [activeBook?.id]);

    React.useEffect(() => {
        if (selectedBookId && !books.some((b) => b.id === selectedBookId)) setSelectedBookId(null);
    }, [books, selectedBookId]);

    const formatRemaining = React.useCallback((minutesRaw: number) => {
        return formatDurationCompact(minutesRaw, locale);
    }, [locale]);

    const spentMinutes = React.useMemo(() => {
        if (!activeBook) return 0;
        const byDay = readingActivityByBook[activeBook.id] || {};
        let sum = 0;
        for (const day of Object.values(byDay)) sum += getMinutesForDay(day, activeBook);
        return sum;
    }, [activeBook, readingActivityByBook]);

    const addTagToActiveBook = React.useCallback(async (rawTag: string) => {
        const tag = mergeImportTags([], rawTag)[0];
        if (!activeBook || !tag || bookTagBusy) return;

        setBookTagBusy(true);
        setBookTagStatus(null);
        try {
            await plugin.addReaderDocumentTags(activeBook.id, [tag]);
            setBookTagInput('');
            setBookTagEditorOpen(false);
            loadData();
        } catch (error) {
            setBookTagStatus(t('stats.bookTagFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setBookTagBusy(false);
        }
    }, [activeBook, bookTagBusy, plugin]);

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
            const fm = cache?.frontmatter as Record<string, unknown> | undefined;
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
        const byRecentActivity = (a: LocalBook, b: LocalBook) =>
            compareBooksByRecentActivity(a, b, readingActivityByBook, sortLocale);
        const list = books
            .slice()
            .sort(byRecentActivity);

        if (!q) return list.slice(0, 20);

        const scored = list
            .map((b) => {
                const hay = normalizeSearchName(`${b.title} ${b.author || ''}`);
                const idx = hay.indexOf(q);
                const score = idx === -1 ? Number.POSITIVE_INFINITY : idx;
                return { b, score };
            })
            .filter((x) => Number.isFinite(x.score))
            .sort((a, b) => a.score - b.score || byRecentActivity(a.b, b.b));

        return scored.slice(0, 20).map((x) => x.b);
    }, [bookQuery, books, readingActivityByBook, sortLocale]);

    const closeImportDialog = React.useCallback(() => {
        if (importBusy) return;
        setImportDialog(null);
        setImportUrl('');
        setImportTitle('');
        setSelectedImportFile(null);
        setImportStatus(null);
        setReaderLoginRequired(false);
        setReaderEmail('');
        setReaderPassword('');
        setImportTags([]);
        setImportTagInput('');
        setImportDragActive(false);
    }, [importBusy]);

    const selectImportFile = React.useCallback((file: File | null) => {
        setSelectedImportFile(file);
        setImportTitle(file ? getImportFileTitle(file) : '');
        setImportStatus(null);
        setReaderLoginRequired(false);
        setImportDragActive(false);
    }, []);

    const saveUrlToReader = React.useCallback(async () => {
        const url = importUrl.trim();
        if (!url) {
            setImportStatus(t('stats.importUrlRequired'));
            return;
        }

        try {
            new URL(url);
        } catch {
            setImportStatus(t('stats.importUrlInvalid'));
            return;
        }

        setImportBusy(true);
        setImportStatus(t('stats.importSaving'));
        try {
            await plugin.saveReaderDocument({
                url,
                title: importTitle.trim() || undefined,
                tags: mergeImportTags(importTags, importTagInput),
                location: 'new',
                saved_using: 'obsidian-readwise-tracker',
            });
            setImportStatus(t('stats.importSaved'));
            loadData();
            window.setTimeout(() => closeImportDialog(), 700);
        } catch (error) {
            setImportStatus(t('stats.importFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setImportBusy(false);
        }
    }, [closeImportDialog, importTagInput, importTags, importTitle, importUrl, plugin]);

    const saveFileToReader = React.useCallback(async () => {
        const file = selectedImportFile;
        if (!file) {
            setImportStatus(t('stats.importFileRequired'));
            return;
        }

        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const contentType = getReaderFileContentType(file);
        if (!contentType) {
            setImportStatus(t('stats.importFileUnsupported'));
            return;
        }

        setImportBusy(true);
        setImportStatus(t('stats.importSaving'));
        try {
            if (extension === 'epub' || extension === 'pdf') {
                await plugin.uploadReaderFile(
                    file.name,
                    contentType,
                    await file.arrayBuffer(),
                    mergeImportTags(importTags, importTagInput),
                );
            } else {
                const text = await file.text();
                const isHtml = extension === 'html' || extension === 'htm' || file.type === 'text/html';
                await plugin.saveReaderDocument({
                    url: `https://obsidian.local/readwise-import/${encodeURIComponent(file.name)}#${Date.now()}`,
                    html: isHtml ? text : `<article><pre>${escapeHtml(text)}</pre></article>`,
                    should_clean_html: true,
                    title: importTitle.trim() || getImportFileTitle(file),
                    tags: mergeImportTags(importTags, importTagInput),
                    location: 'new',
                    category: 'article',
                    saved_using: 'obsidian-readwise-tracker',
                });
            }
            setImportStatus(t('stats.importSaved'));
            loadData();
            window.setTimeout(() => closeImportDialog(), 700);
        } catch (error) {
            if (isReaderAuthenticationError(error)) {
                setReaderLoginRequired(true);
                setImportStatus(t('stats.importLoginRequired'));
            } else {
                setImportStatus(t('stats.importFailed', {
                    message: error instanceof Error ? error.message : String(error),
                }));
            }
        } finally {
            setImportBusy(false);
        }
    }, [closeImportDialog, importTagInput, importTags, importTitle, plugin, selectedImportFile]);

    const loginAndRetryFileUpload = React.useCallback(async () => {
        const file = selectedImportFile;
        const contentType = file ? getReaderFileContentType(file) : null;
        if (!file || !contentType) {
            setImportStatus(t('stats.importFileRequired'));
            return;
        }
        if (!readerEmail.trim() || !readerPassword) {
            setImportStatus(t('stats.importLoginFieldsRequired'));
            return;
        }

        setImportBusy(true);
        setImportStatus(t('stats.importLoginInProgress'));
        try {
            await plugin.loginToReader(readerEmail.trim(), readerPassword);
            setReaderPassword('');
            setImportStatus(t('stats.importRetryingUpload'));
            await plugin.uploadReaderFile(
                file.name,
                contentType,
                await file.arrayBuffer(),
                mergeImportTags(importTags, importTagInput),
            );
            setImportStatus(t('stats.importSaved'));
            setReaderLoginRequired(false);
            loadData();
            window.setTimeout(() => closeImportDialog(), 700);
        } catch (error) {
            setImportStatus(t('stats.importLoginFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setImportBusy(false);
        }
    }, [closeImportDialog, importTagInput, importTags, plugin, readerEmail, readerPassword, selectedImportFile]);

    return (
        <div className="readwise-stats-root p-4">
            <div className="readwise-book-picker-shell">
                <div className="readwise-book-picker-row">
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
                                        <div className="readwise-book-picker-title">{b.title}</div>
                                        {b.author ? <div className="readwise-book-picker-author">{b.author}</div> : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div ref={importControlRef} className="readwise-import-control">
                        <button
                            onClick={() => setImportMenuOpen((open) => !open)}
                            className="readwise-import-trigger"
                            aria-label={t('stats.importOpen')}
                            title={t('stats.importOpen')}
                        >
                            <span className="readwise-import-trigger-glyph">+</span>
                        </button>
                        {importMenuOpen ? (
                            <div className="readwise-import-menu">
                                <button
                                    onClick={() => {
                                        setImportDialog('url');
                                        setImportMenuOpen(false);
                                        setImportStatus(null);
                                    }}
                                    className="readwise-import-menu-item"
                                >
                                    <span className="readwise-import-menu-icon">↗</span>
                                    <span>{t('stats.importUrl')}</span>
                                    <span className="readwise-import-shortcut">A</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setImportDialog('upload');
                                        setImportMenuOpen(false);
                                        setImportStatus(null);
                                    }}
                                    className="readwise-import-menu-item"
                                >
                                    <span className="readwise-import-menu-icon">⇧</span>
                                    <span>{t('stats.importUpload')}</span>
                                    <span className="readwise-import-shortcut">U</span>
                                </button>
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
                    <div className="readwise-book-picker-helper">
                        {t('stats.selectBook')}
                    </div>
                ) : null}
            </div>

            {!activeBook ? null : (
                <div>
                    <div className="readwise-selected-book-card">
                        <button
                            type="button"
                            className="readwise-selected-book-delete"
                            aria-label={t('stats.deleteBook')}
                            title={t('stats.deleteBook')}
                            disabled={deletingBookId !== null}
                            onClick={() => setBookDeleteConfirmationOpen(true)}
                        >
                            {deletingBookId === activeBook.id ? (
                                <span aria-hidden="true">…</span>
                            ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                                </svg>
                            )}
                        </button>
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

                            <div className="readwise-selected-book-tags">
                                    {(activeBook.tags || []).slice(0, 20).map((t: string) => (
                                        <span key={t} className="readwise-selected-book-tag">
                                            {t}
                                        </span>
                                    ))}
                                <div className="readwise-book-tag-control">
                                    <button
                                        type="button"
                                        className="readwise-book-tag-add"
                                        aria-label={t('stats.bookTagAdd')}
                                        title={t('stats.bookTagAdd')}
                                        onClick={() => {
                                            setBookTagEditorOpen((open) => !open);
                                            setBookTagStatus(null);
                                        }}
                                    >
                                        <span className="readwise-book-tag-add-glyph" aria-hidden="true">+</span>
                                    </button>
                                    {bookTagEditorOpen ? (
                                        <div className="readwise-book-tag-popover">
                                            <div className="readwise-book-tag-popover-header">
                                                <div className="readwise-book-tag-popover-title">
                                                    {t('stats.bookTagTitle')}
                                                </div>
                                                <button
                                                    type="button"
                                                    className="readwise-book-tag-close"
                                                    aria-label={t('stats.importClose')}
                                                    title={t('stats.importClose')}
                                                    onClick={() => {
                                                        setBookTagEditorOpen(false);
                                                        setBookTagInput('');
                                                        setBookTagStatus(null);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                            <div className="readwise-book-tag-input-row">
                                                <input
                                                    autoFocus
                                                    value={bookTagInput}
                                                    onChange={(event) => setBookTagInput(event.target.value)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') {
                                                            event.preventDefault();
                                                            void addTagToActiveBook(bookTagInput);
                                                        }
                                                        if (event.key === 'Escape') setBookTagEditorOpen(false);
                                                    }}
                                                    placeholder={t('stats.bookTagPlaceholder')}
                                                    disabled={bookTagBusy}
                                                    className="readwise-book-tag-input"
                                                />
                                                <button
                                                    type="button"
                                                    className="readwise-book-tag-submit"
                                                    disabled={bookTagBusy || !bookTagInput.trim()}
                                                    onClick={() => void addTagToActiveBook(bookTagInput)}
                                                >
                                                    {t('stats.bookTagSubmit')}
                                                </button>
                                            </div>
                                            {availableBookTags.length > 0 ? (
                                                <div className="readwise-book-tag-options">
                                                    {availableBookTags.map((tag) => (
                                                        <button
                                                            key={tag}
                                                            type="button"
                                                            disabled={bookTagBusy}
                                                            onClick={() => void addTagToActiveBook(tag)}
                                                            className="readwise-book-tag-option"
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : null}
                                            {bookTagStatus ? (
                                                <div className="readwise-book-tag-status">{bookTagStatus}</div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

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

                    <div className="readwise-highlights-section">
                        <h2 className="readwise-highlights-title">{t('stats.highlights')}</h2>
                        {highlightItems.length === 0 ? (
                            <div className="readwise-highlights-empty">
                                {t('stats.noHighlights')}
                            </div>
                        ) : (
                            <div>
                                <div className="readwise-highlights-toolbar">
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

                                <div className="readwise-highlight-list">
                                    {highlightItems.slice(0, 300).map((h) => {
                                        const isExpanded = !!expandedHighlightPaths[h.file.path];
                                        const cached = highlightContentByPath[h.file.path];
                                        const toggleHighlight = async () => {
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
                                        };
                                        return (
                                        <div
                                            key={h.file.path}
                                            className={`readwise-highlight-card${isExpanded ? ' is-expanded' : ''}`}
                                            role="button"
                                            tabIndex={0}
                                            onClick={(event) => {
                                                const target = event.target as HTMLElement;
                                                if (target.closest('button, a, input, textarea, select')) {
                                                    return;
                                                }
                                                void toggleHighlight();
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    void toggleHighlight();
                                                }
                                            }}
                                        >
                                            <div className="readwise-highlight-card-header">
                                                <div className="readwise-highlight-title-row">
                                                    <span className="readwise-highlight-toggle" aria-hidden="true">
                                                        {isExpanded ? '▾' : '▸'}
                                                    </span>

                                                    <div className="readwise-highlight-title-stack">
                                                        <button
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                event.preventDefault();
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
                                                        onClick={async (event) => {
                                                            event.stopPropagation();
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

            {bookDeleteConfirmationOpen && activeBook ? (
                <div
                    className="readwise-import-modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget && !deletingBookId) {
                            setBookDeleteConfirmationOpen(false);
                        }
                    }}
                >
                    <div
                        className="readwise-delete-confirmation"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="readwise-delete-confirmation-title"
                    >
                        <div id="readwise-delete-confirmation-title" className="readwise-delete-confirmation-title">
                            {t('stats.deleteBookConfirmTitle')}
                        </div>
                        <div className="readwise-delete-confirmation-text">
                            {t('stats.deleteBookConfirmText', { title: activeBook.title })}
                        </div>
                        <div className="readwise-delete-confirmation-actions">
                            <button
                                type="button"
                                className="readwise-delete-confirmation-cancel"
                                disabled={deletingBookId !== null}
                                onClick={() => setBookDeleteConfirmationOpen(false)}
                            >
                                {t('stats.deleteBookCancel')}
                            </button>
                            <button
                                type="button"
                                className="readwise-delete-confirmation-submit"
                                disabled={deletingBookId !== null}
                                onClick={async () => {
                                    if (deletingBookId) return;
                                    try {
                                        setDeletingBookId(activeBook.id);
                                        await plugin.deleteReaderBook(activeBook.readwise_id || activeBook.id);
                                        await plugin.dataManager.removeBooks([activeBook.id]);
                                        setBookDeleteConfirmationOpen(false);
                                        setSelectedBookId(null);
                                        setExpandedHighlightPaths({});
                                        setHighlightContentByPath({});
                                        loadData();
                                    } catch (error) {
                                        new Notice(t('stats.deleteBookFailed', {
                                            message: error instanceof Error ? error.message : String(error),
                                        }));
                                    } finally {
                                        setDeletingBookId(null);
                                    }
                                }}
                            >
                                {deletingBookId ? t('stats.deleteBookDeleting') : t('stats.deleteBookConfirm')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {importDialog ? (
                <div
                    className="readwise-import-modal-backdrop"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeImportDialog();
                        }
                    }}
                >
                    <div className="readwise-import-modal" role="dialog" aria-modal="true">
                        <div className="readwise-import-modal-header is-upload">
                            <button
                                onClick={closeImportDialog}
                                className="readwise-import-close"
                                aria-label={t('stats.importClose')}
                                disabled={importBusy}
                            >
                                ×
                            </button>
                        </div>

                        <div className="readwise-import-modal-body">
                            {importDialog === 'url' ? (
                                <label className="readwise-import-field">
                                    <span>{t('stats.importUrl')}</span>
                                    <input
                                        value={importUrl}
                                        onChange={(event) => setImportUrl(event.target.value)}
                                        placeholder="https://..."
                                        disabled={importBusy}
                                        className="readwise-import-input"
                                    />
                                </label>
                            ) : (
                                <div
                                    className={`readwise-import-dropzone${importDragActive ? ' is-dragging' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => fileInputRef.current?.click()}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            fileInputRef.current?.click();
                                        }
                                    }}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        setImportDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = 'copy';
                                        setImportDragActive(true);
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                            setImportDragActive(false);
                                        }
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        selectImportFile(event.dataTransfer.files?.[0] || null);
                                    }}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".html,.htm,.txt,.md,.pdf,.epub,text/*"
                                        className="readwise-import-file-input"
                                        onChange={(event) => {
                                            selectImportFile(event.currentTarget.files?.[0] || null);
                                        }}
                                    />
                                    <div className="readwise-import-dropzone-icon" aria-hidden="true">↑</div>
                                    <div className="readwise-import-dropzone-title">
                                        {selectedImportFile ? selectedImportFile.name : t('stats.importDropTitle')}
                                    </div>
                                    <div className="readwise-import-dropzone-hint">
                                        {selectedImportFile ? t('stats.importDropReplace') : t('stats.importDropHint')}
                                    </div>
                                </div>
                            )}

                            <label className="readwise-import-field">
                                <span>{t('stats.importTitleLabel')}</span>
                                <input
                                    value={importTitle}
                                    onChange={(event) => setImportTitle(event.target.value)}
                                    placeholder={t('stats.importTitlePlaceholder')}
                                    disabled={importBusy}
                                    className="readwise-import-input"
                                />
                            </label>

                            <div className="readwise-import-field">
                                <span>{t('stats.importTagsLabel')}</span>
                                <div className="readwise-import-tag-editor">
                                    {importTags.length > 0 ? (
                                        <div className="readwise-import-selected-tags">
                                            {importTags.map((tag) => (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    className="readwise-import-tag is-selected"
                                                    disabled={importBusy}
                                                    onClick={() => setImportTags((current) => current.filter((item) => item !== tag))}
                                                    title={t('stats.importTagRemove')}
                                                >
                                                    {tag}<span aria-hidden="true"> ×</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    <input
                                        value={importTagInput}
                                        onChange={(event) => setImportTagInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ',') {
                                                event.preventDefault();
                                                setImportTags((current) => mergeImportTags(current, importTagInput));
                                                setImportTagInput('');
                                            }
                                        }}
                                        placeholder={t('stats.importTagsPlaceholder')}
                                        disabled={importBusy}
                                        className="readwise-import-input"
                                    />
                                    {suggestedImportTags.length > 0 ? (
                                        <div className="readwise-import-tag-suggestions">
                                            {suggestedImportTags.map((tag) => (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    className="readwise-import-tag"
                                                    disabled={importBusy}
                                                    onClick={() => {
                                                        setImportTags((current) => mergeImportTags(current, tag));
                                                        setImportTagInput('');
                                                    }}
                                                >
                                                    {tag}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {importDialog === 'upload' && readerLoginRequired ? (
                                <div className="readwise-import-login">
                                    <div className="readwise-import-login-title">
                                        {t('stats.importLoginTitle')}
                                    </div>
                                    <div className="readwise-import-login-help">
                                        {t('stats.importLoginHelp')}
                                    </div>
                                    <label className="readwise-import-field">
                                        <span>{t('stats.importLoginEmail')}</span>
                                        <input
                                            type="email"
                                            autoComplete="username"
                                            value={readerEmail}
                                            onChange={(event) => setReaderEmail(event.target.value)}
                                            disabled={importBusy}
                                            className="readwise-import-input"
                                        />
                                    </label>
                                    <label className="readwise-import-field">
                                        <span>{t('stats.importLoginPassword')}</span>
                                        <input
                                            type="password"
                                            autoComplete="current-password"
                                            value={readerPassword}
                                            onChange={(event) => setReaderPassword(event.target.value)}
                                            disabled={importBusy}
                                            className="readwise-import-input"
                                        />
                                    </label>
                                </div>
                            ) : null}

                            {importStatus ? (
                                <div className="readwise-import-status">
                                    {importStatus}
                                </div>
                            ) : null}
                        </div>

                        <div className="readwise-import-modal-actions">
                            <button
                                onClick={importDialog === 'url'
                                    ? saveUrlToReader
                                    : readerLoginRequired
                                        ? loginAndRetryFileUpload
                                        : saveFileToReader}
                                disabled={importBusy}
                                className="readwise-import-primary"
                            >
                                {importBusy
                                    ? t('stats.importSaving')
                                    : readerLoginRequired
                                        ? t('stats.importLoginSubmit')
                                        : t('stats.importSave')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

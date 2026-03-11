import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import type ReadwiseTrackerPlugin from '../../main';
import { LocalBook, ReadingActivityDay } from '../models/store';

export const DASHBOARD_VIEW_TYPE = 'readwise-dashboard-view';

export class DashboardView extends ItemView {
    plugin: ReadwiseTrackerPlugin;
    root: ReactDOM.Root | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ReadwiseTrackerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return DASHBOARD_VIEW_TYPE;
    }

    getDisplayText() {
        return 'Reading Heatmap';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        this.root = ReactDOM.createRoot(container);
        this.render();
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }

    render() {
        if (!this.root) return;
        this.root.render(
            <DashboardComponent plugin={this.plugin} />
        );
    }
}

const DashboardComponent: React.FC<{ plugin: ReadwiseTrackerPlugin }> = ({ plugin }) => {
    const [books, setBooks] = React.useState<LocalBook[]>([]);
    const [readingActivity, setReadingActivity] = React.useState<Record<string, ReadingActivityDay>>({});
    const [readingActivityByBook, setReadingActivityByBook] = React.useState<Record<string, Record<string, ReadingActivityDay>>>({});
    const [selectedBookId, setSelectedBookId] = React.useState<string | null>(null);
    const [completedCollapsed, setCompletedCollapsed] = React.useState(true);
    const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
    const [selectedDateKey, setSelectedDateKey] = React.useState<string | null>(null);

    const loadData = React.useCallback(() => {
        const data = plugin.dataManager.getData();
        setBooks(Object.values(data.books));
        setReadingActivity(data.readingActivity || {});
        setReadingActivityByBook(data.readingActivityByBook || {});
    }, [plugin]);

    React.useEffect(() => {
        loadData();
        const interval = window.setInterval(loadData, 3000);
        return () => window.clearInterval(interval);
    }, [loadData]);

    const toDateKey = React.useCallback((iso: string) => {
        const d = new Date(iso);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }, []);

    const selectedBook = React.useMemo(() => {
        if (!selectedBookId) return null;
        return books.find(b => b.id === selectedBookId) || null;
    }, [books, selectedBookId]);

    const allTags = React.useMemo(() => {
        const s = new Set<string>();
        for (const b of books) {
            if (!b.tags) continue;
            for (const t of b.tags) {
                const trimmed = typeof t === 'string' ? t.trim() : '';
                if (trimmed) s.add(trimmed);
            }
        }
        return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'));
    }, [books]);

    const isBookMatchingTags = React.useCallback((book: LocalBook) => {
        if (selectedTags.length === 0) return true;
        const tags = book.tags || [];
        if (tags.length === 0) return false;
        const set = new Set(tags.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean));
        return selectedTags.some(t => set.has(t));
    }, [selectedTags]);

    const filteredBooks = React.useMemo(() => {
        if (selectedTags.length === 0) return books;
        return books.filter(isBookMatchingTags);
    }, [books, isBookMatchingTags, selectedTags.length]);

    React.useEffect(() => {
        if (!selectedBookId) return;
        const b = books.find(x => x.id === selectedBookId);
        if (!b) return;
        if (!isBookMatchingTags(b)) setSelectedBookId(null);
    }, [books, isBookMatchingTags, selectedBookId]);

    React.useEffect(() => {
        if (!selectedDateKey) return;
        if (selectedBookId) setSelectedBookId(null);
    }, [selectedBookId, selectedDateKey]);

    const dayHasActivity = React.useCallback((day: ReadingActivityDay | undefined) => {
        if (!day) return false;
        if ((day.minutes || 0) > 0.01) return true;
        if ((day.words || 0) > 0.01) return true;
        if ((day.progressPoints || 0) > 0.01) return true;
        if ((day.events || 0) > 0) return true;
        return false;
    }, []);

    const activeBookIdsForSelectedDate = React.useMemo(() => {
        if (!selectedDateKey) return null;
        const s = new Set<string>();
        for (const book of filteredBooks) {
            const byDay = readingActivityByBook[book.id];
            if (byDay && dayHasActivity(byDay[selectedDateKey])) {
                s.add(book.id);
                continue;
            }
            const iso = book.updated_at || book.created_at;
            if (iso && toDateKey(iso) === selectedDateKey) s.add(book.id);
        }
        return s;
    }, [dayHasActivity, filteredBooks, readingActivityByBook, selectedDateKey, toDateKey]);

    const fallbackUpdatesByDate = React.useMemo(() => {
        const counts: Record<string, number> = {};
        const sourceBooks = selectedBookId
            ? books.filter(b => b.id === selectedBookId)
            : filteredBooks;
        for (const book of sourceBooks) {
            const iso = book.updated_at || book.created_at;
            if (!iso) continue;
            const key = toDateKey(iso);
            counts[key] = (counts[key] || 0) + 1;
        }
        return counts;
    }, [books, filteredBooks, selectedBookId, toDateKey]);

    const activitySource = React.useMemo(() => {
        if (selectedBookId) return readingActivityByBook[selectedBookId] || {};
        if (selectedTags.length > 0) {
            const acc: Record<string, ReadingActivityDay> = {};
            for (const book of filteredBooks) {
                const byDay = readingActivityByBook[book.id];
                if (!byDay) continue;
                for (const [dateKey, day] of Object.entries(byDay)) {
                    const existing = acc[dateKey] || { minutes: 0, words: 0, progressPoints: 0, events: 0 };
                    acc[dateKey] = {
                        minutes: existing.minutes + (day.minutes || 0),
                        words: existing.words + (day.words || 0),
                        progressPoints: existing.progressPoints + (day.progressPoints || 0),
                        events: existing.events + (day.events || 0),
                    };
                }
            }
            return acc;
        }
        return readingActivity || {};
    }, [filteredBooks, readingActivity, readingActivityByBook, selectedBookId, selectedTags.length]);

    const getEstimatedTotalWords = React.useCallback((book: LocalBook | null) => {
        if (!book) return 0;
        if ((book.words_count || 0) > 0) return book.words_count || 0;
        if ((book.total_pages || 0) > 0) return (book.total_pages || 0) * 280;
        return 0;
    }, []);

    const getMinutesForDay = React.useCallback((day: ReadingActivityDay | undefined) => {
        if (!day) return 0;
        if ((day.minutes || 0) > 0) return day.minutes || 0;
        if ((day.words || 0) > 0) return (day.words || 0) / 200;
        const estimatedWords = getEstimatedTotalWords(selectedBook);
        if ((day.progressPoints || 0) > 0 && estimatedWords > 0) {
            const deltaWords = (estimatedWords * (day.progressPoints || 0)) / 100;
            return deltaWords / 200;
        }
        return 0;
    }, [getEstimatedTotalWords, selectedBook]);

    const heatmapMode = React.useMemo(() => {
        const values = Object.values(activitySource);
        if (values.some(v => (v.minutes || 0) > 0.01 || (v.words || 0) > 0.01)) return 'minutes' as const;
        const selectedBookHasEstimatedWords = selectedBookId ? getEstimatedTotalWords(selectedBook) > 0 : false;
        if (selectedBookHasEstimatedWords && values.some(v => (v.progressPoints || 0) > 0.01)) return 'minutes' as const;
        if (values.some(v => (v.progressPoints || 0) > 0.01)) return 'progressPoints' as const;
        return 'updates' as const;
    }, [activitySource, getEstimatedTotalWords, selectedBook, selectedBookId]);

    const heatmapValueByDate = React.useCallback((dateKey: string) => {
        if (heatmapMode === 'minutes') return getMinutesForDay(activitySource[dateKey]);
        if (heatmapMode === 'progressPoints') return activitySource[dateKey]?.progressPoints || 0;
        return fallbackUpdatesByDate[dateKey] || 0;
    }, [activitySource, fallbackUpdatesByDate, getMinutesForDay, heatmapMode]);

    const { weeks, rangeStart, rangeEnd, maxValue, totalValue, avgValue, activeDays, legendLabel } = React.useMemo(() => {
        const today = new Date();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const start = new Date(end);
        start.setDate(start.getDate() - 364);

        const gridStart = new Date(start);
        while (gridStart.getDay() !== 0) gridStart.setDate(gridStart.getDate() - 1);

        const gridEnd = new Date(end);
        while (gridEnd.getDay() !== 6) gridEnd.setDate(gridEnd.getDate() + 1);

        const days: Date[] = [];
        for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
            days.push(new Date(d));
        }

        const weeks: Date[][] = [];
        for (let i = 0; i < days.length; i += 7) {
            weeks.push(days.slice(i, i + 7));
        }

        let maxValue = 0;
        let totalValue = 0;
        let activeDays = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const v = heatmapValueByDate(key);
            totalValue += v;
            if (v > maxValue) maxValue = v;
            if (v > 0) activeDays += 1;
        }

        const avgValue = activeDays > 0 ? totalValue / activeDays : 0;

        const legendLabel =
            heatmapMode === 'minutes'
                ? 'Минуты чтения'
                : heatmapMode === 'progressPoints'
                    ? 'Прогресс (п.п.)'
                    : 'Книги (обновления)';

        return { weeks, rangeStart: start, rangeEnd: end, maxValue, totalValue, avgValue, activeDays, legendLabel };
    }, [heatmapMode, heatmapValueByDate]);

    const selectedDayValue = React.useMemo(() => {
        if (!selectedDateKey) return null;
        return heatmapValueByDate(selectedDateKey);
    }, [heatmapValueByDate, selectedDateKey]);

    const selectedDayLabel = React.useMemo(() => {
        if (!selectedDateKey) return null;
        const [y, m, d] = selectedDateKey.split('-').map((x) => Number(x));
        const dt = new Date(y, (m || 1) - 1, d || 1);
        if (Number.isNaN(dt.getTime())) return selectedDateKey;
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(dt);
    }, [selectedDateKey]);

    const statsPanel = React.useMemo(() => {
        if (!selectedDateKey) {
            return {
                periodLabel: 'За 365 дней',
                total: totalValue,
                max: maxValue,
                avg: avgValue,
                active: activeDays,
            };
        }

        const v = selectedDayValue || 0;
        const active = v > 0 ? 1 : 0;
        const suffix = selectedDayLabel ? ` (${selectedDayLabel})` : '';
        return {
            periodLabel: `За 1 день${suffix}`,
            total: v,
            max: v,
            avg: active ? v : 0,
            active,
        };
    }, [activeDays, avgValue, maxValue, selectedDateKey, selectedDayLabel, selectedDayValue, totalValue]);

    const heatmapLevel = React.useCallback((value: number) => {
        if (value <= 0) return 0;
        if (heatmapMode === 'minutes') {
            if (value < 10) return 1;
            if (value < 30) return 2;
            if (value < 60) return 3;
            return 4;
        }
        if (heatmapMode === 'progressPoints') {
            if (value < 1) return 1;
            if (value < 3) return 2;
            if (value < 7) return 3;
            return 4;
        }
        if (value < 1) return 1;
        if (value < 2) return 2;
        if (value < 4) return 3;
        return 4;
    }, [heatmapMode]);

    const heatmapColors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    const heatmapValueFormat = React.useCallback((value: number) => {
        if (heatmapMode === 'minutes') return `${value.toFixed(1)} мин`;
        if (heatmapMode === 'progressPoints') return `${value.toFixed(1)} п.п.`;
        return `${value.toFixed(0)} книг`;
    }, [heatmapMode]);

    const heatmapCellSize = 11;
    const heatmapCellGap = 2;
    const heatmapLabelGap = 6;
    const heatmapDayLabelWidth = 26;

    const heatmapViewportRef = React.useRef<HTMLDivElement | null>(null);
    const [visibleWeekCount, setVisibleWeekCount] = React.useState<number>(weeks.length);

    React.useEffect(() => {
        const el = heatmapViewportRef.current;
        if (!el) return;

        const colW = heatmapCellSize + heatmapCellGap;
        const compute = () => {
            const w = el.clientWidth;
            const available = w - (heatmapDayLabelWidth + heatmapLabelGap);
            const cols = Math.max(1, Math.floor((available + heatmapCellGap) / colW));
            setVisibleWeekCount(prev => (prev === cols ? prev : cols));
        };

        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(el);
        return () => ro.disconnect();
    }, [heatmapCellGap, heatmapCellSize, heatmapDayLabelWidth, heatmapLabelGap]);

    const displayedWeeks = React.useMemo(() => {
        const count = Math.max(1, Math.min(weeks.length, visibleWeekCount || weeks.length));
        return weeks.slice(Math.max(0, weeks.length - count));
    }, [visibleWeekCount, weeks]);

    const showMonthRow = displayedWeeks.length >= 16;

    const monthLabelByWeekIndex: Array<string | null> = React.useMemo(() => {
        const monthText = (d: Date) => new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(d).replace('.', '');
        const labels: Array<string | null> = new Array(displayedWeeks.length).fill(null);
        const minPx = 34;

        let lastShownX = Number.NEGATIVE_INFINITY;
        let prevMonth: number | null = null;

        for (let wi = 0; wi < displayedWeeks.length; wi++) {
            const week = displayedWeeks[wi];
            const firstInRange =
                week.find((d) => d >= rangeStart && d <= rangeEnd) ||
                week.find((d) => d <= rangeEnd) ||
                week[0];

            const month = firstInRange.getMonth();
            const candidate = wi === 0 || prevMonth === null || month !== prevMonth ? monthText(firstInRange) : null;
            prevMonth = month;
            if (!candidate) continue;

            const x = wi * (heatmapCellSize + heatmapCellGap);
            if (x - lastShownX < minPx) continue;
            lastShownX = x;
            labels[wi] = candidate;
        }

        return labels;
    }, [displayedWeeks, heatmapCellGap, heatmapCellSize, rangeEnd, rangeStart]);

    const readingBooks = React.useMemo(() => {
        return filteredBooks
            .filter(b => b.status === 'reading')
            .filter(b => (activeBookIdsForSelectedDate ? activeBookIdsForSelectedDate.has(b.id) : true))
            .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    }, [activeBookIdsForSelectedDate, filteredBooks]);

    const completedBooks = React.useMemo(() => {
        return filteredBooks
            .filter(b => b.status === 'completed')
            .filter(b => (activeBookIdsForSelectedDate ? activeBookIdsForSelectedDate.has(b.id) : true))
            .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    }, [activeBookIdsForSelectedDate, filteredBooks]);

    const formatRemaining = React.useCallback((minutesRaw: number) => {
        const minutes = Math.max(0, Math.round(minutesRaw));
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h <= 0) return `${m}м осталось`;
        if (m === 0) return `${h}ч осталось`;
        return `${h}ч ${m}м осталось`;
    }, []);

    const getRemainingMinutes = React.useCallback((book: LocalBook) => {
        const wpm = 200;
        const totalWords = book.words_count || 0;
        if (totalWords <= 0) return null;
        const progressRatio = Math.min(100, Math.max(0, book.reading_progress || 0)) / 100;
        const remainingWords = totalWords * (1 - progressRatio);
        return remainingWords / wpm;
    }, []);

    const formatDate = React.useCallback((iso: string | undefined) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d);
    }, []);

    return (
        <div className="p-4">
            {allTags.length > 0 ? (
                <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {allTags.slice(0, 40).map((t) => {
                            const selected = selectedTags.includes(t);
                            return (
                                <button
                                    key={t}
                                    onClick={() => setSelectedTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))}
                                    style={{
                                        fontSize: 12,
                                        padding: '4px 8px',
                                        borderRadius: 999,
                                        border: selected ? '1px solid rgba(59,130,246,0.9)' : '1px solid rgba(27,31,35,0.18)',
                                        background: selected ? 'rgba(59,130,246,0.08)' : 'transparent',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                    }}
                                    title={t}
                                >
                                    {t}
                                </button>
                            );
                        })}
                    </div>
                    {selectedTags.length > 0 ? (
                        <button
                            onClick={() => setSelectedTags([])}
                            style={{
                                fontSize: 12,
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid rgba(27,31,35,0.18)',
                                background: 'transparent',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Сбросить теги
                        </button>
                    ) : null}
                </div>
            ) : null}
            <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div
                        ref={heatmapViewportRef}
                        style={{ overflow: 'hidden', paddingBottom: 4, maxWidth: '100%', flex: '1 1 0', minWidth: 0 }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {showMonthRow ? (
                                <div style={{ display: 'flex', gap: heatmapCellGap, paddingLeft: heatmapDayLabelWidth + heatmapLabelGap, overflow: 'hidden' }}>
                                    {displayedWeeks.map((_, wi) => {
                                        const label = monthLabelByWeekIndex[wi];
                                        return (
                                            <div key={wi} style={{ width: heatmapCellSize, height: 14, position: 'relative' }}>
                                                {label ? (
                                                    <div style={{ position: 'absolute', left: 0, top: 0, fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap' }}>
                                                        {label}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: heatmapLabelGap }}>
                                <div style={{ width: heatmapDayLabelWidth, display: 'flex', flexDirection: 'column', gap: heatmapCellGap }}>
                                    {Array.from({ length: 7 }).map((_, di) => {
                                        const label = di === 1 ? 'Пн' : di === 3 ? 'Ср' : di === 5 ? 'Пт' : '';
                                        return (
                                            <div
                                                key={di}
                                                style={{
                                                    height: heatmapCellSize,
                                                    fontSize: 12,
                                                    opacity: 0.8,
                                                    lineHeight: `${heatmapCellSize}px`,
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {label}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div style={{ display: 'flex', gap: heatmapCellGap }}>
                                    {displayedWeeks.map((week, wi) => (
                                        <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: heatmapCellGap }}>
                                            {week.map((d, di) => {
                                                const isInRange = d >= rangeStart && d <= rangeEnd;
                                                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                const value = isInRange ? heatmapValueByDate(key) : 0;
                                                const level = isInRange ? heatmapLevel(value) : 0;
                                                const background = isInRange ? heatmapColors[level] : 'transparent';
                                                const title = isInRange ? `${key}: ${heatmapValueFormat(value)}` : '';
                                                const isSelectedDay = selectedDateKey === key;
                                                return (
                                                    <div
                                                        key={`${wi}-${di}`}
                                                        title={title}
                                                        onClick={() => {
                                                            if (!isInRange) return;
                                                            setSelectedDateKey(prev => (prev === key ? null : key));
                                                            setSelectedBookId(null);
                                                            setCompletedCollapsed(false);
                                                        }}
                                                        style={{
                                                            width: heatmapCellSize,
                                                            height: heatmapCellSize,
                                                            borderRadius: 2,
                                                            background,
                                                            border: isInRange ? '1px solid rgba(27,31,35,0.06)' : '1px solid transparent',
                                                            boxSizing: 'border-box',
                                                            cursor: isInRange ? 'pointer' : 'default',
                                                            outline: isSelectedDay ? '2px solid rgba(59,130,246,0.9)' : 'none',
                                                            outlineOffset: 1,
                                                            boxShadow: 'none',
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ minWidth: 220 }}>
                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>{legendLabel}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                            <span style={{ fontSize: 12, opacity: 0.8 }}>Меньше</span>
                            <div style={{ display: 'flex', gap: 3 }}>
                                {heatmapColors.map((c, idx) => (
                                    <div
                                        key={idx}
                                        style={{
                                            width: 11,
                                            height: 11,
                                            borderRadius: 2,
                                            background: c,
                                            border: '1px solid rgba(27,31,35,0.06)',
                                            boxSizing: 'border-box',
                                        }}
                                    />
                                ))}
                            </div>
                            <span style={{ fontSize: 12, opacity: 0.8 }}>Больше</span>
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                            <div>{statsPanel.periodLabel}: {heatmapValueFormat(statsPanel.total)}</div>
                            <div>Макс. за день: {heatmapValueFormat(statsPanel.max)}</div>
                            <div>Среднее (активный день): {heatmapValueFormat(statsPanel.avg)}</div>
                            <div>Дней с чтением: {statsPanel.active}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Сейчас читаю</h2>
                    {selectedBookId ? (
                        <button
                            onClick={() => setSelectedBookId(null)}
                            style={{
                                fontSize: 12,
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid rgba(27,31,35,0.18)',
                                background: 'transparent',
                                cursor: 'pointer',
                            }}
                        >
                            Показать все
                        </button>
                    ) : null}
                </div>
                {readingBooks.length === 0 ? (
                    <div style={{ fontSize: 13, opacity: 0.75 }}>Нет активных книг.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {readingBooks.map(book => {
                            const progress = Math.min(100, Math.max(0, book.reading_progress || 0));
                            const remainingMinutes = getRemainingMinutes(book);
                            const rightDate = formatDate(book.updated_at || book.created_at);
                            const isSelected = selectedBookId === book.id;
                            return (
                                <div
                                    key={book.id}
                                    onClick={() => setSelectedBookId(prev => (prev === book.id ? null : book.id))}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: 12,
                                        border: isSelected ? '2px solid rgba(59,130,246,0.9)' : '1px solid rgba(27,31,35,0.12)',
                                        borderRadius: 10,
                                        background: 'rgba(255,255,255,0.03)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ width: 46, height: 64, flex: '0 0 auto', borderRadius: 6, overflow: 'hidden', background: 'rgba(27,31,35,0.06)' }}>
                                        {book.cover_url ? (
                                            <img
                                                src={book.cover_url}
                                                alt={book.title}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                            />
                                        ) : null}
                                    </div>

                                    <div style={{ flex: '1 1 auto', minWidth: 240 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                                                {book.title}
                                            </div>
                                            <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'nowrap' }}>
                                                {rightDate}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 3 }}>
                                            {book.author || ''}
                                        </div>

                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, opacity: 0.85 }}>
                                                <div>{progress.toFixed(1)}%</div>
                                                <div style={{ whiteSpace: 'nowrap' }}>
                                                    {remainingMinutes === null ? 'осталось: —' : formatRemaining(remainingMinutes)}
                                                </div>
                                            </div>
                                            <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: 'rgba(27,31,35,0.12)', overflow: 'hidden' }}>
                                                <div style={{ width: `${progress}%`, height: '100%', background: '#3b82f6' }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setCompletedCollapsed(v => !v)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') setCompletedCollapsed(v => !v);
                        }}
                        style={{
                            fontSize: 18,
                            fontWeight: 700,
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 8,
                            boxShadow: 'none',
                            outline: 'none',
                            appearance: 'none',
                            WebkitAppearance: 'none',
                        }}
                    >
                        <span>{completedCollapsed ? '▶' : '▼'}</span>
                        <span>Прочитано</span>
                        <span style={{ fontSize: 12, opacity: 0.7 }}>({completedBooks.length})</span>
                    </div>
                    {selectedBookId && selectedBook?.status === 'completed' ? (
                        <button
                            onClick={() => setSelectedBookId(null)}
                            style={{
                                fontSize: 12,
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                boxShadow: 'none',
                                outline: 'none',
                                appearance: 'none',
                                WebkitAppearance: 'none',
                            }}
                        >
                            Показать все
                        </button>
                    ) : null}
                </div>

                {completedCollapsed ? null : (
                    completedBooks.length === 0 ? (
                        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>Пока нет прочитанных книг.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                            {completedBooks.slice(0, 50).map(book => {
                                const progress = book.reading_progress ? Math.min(100, Math.max(0, book.reading_progress || 0)) : 100;
                                const rightDate = formatDate(book.updated_at || book.created_at);
                                const isSelected = selectedBookId === book.id;
                                return (
                                    <div
                                        key={book.id}
                                        onClick={() => setSelectedBookId(prev => (prev === book.id ? null : book.id))}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: 12,
                                            border: isSelected ? '2px solid rgba(59,130,246,0.9)' : '1px solid rgba(27,31,35,0.12)',
                                            borderRadius: 10,
                                            background: 'rgba(255,255,255,0.03)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{ width: 46, height: 64, flex: '0 0 auto', borderRadius: 6, overflow: 'hidden', background: 'rgba(27,31,35,0.06)' }}>
                                            {book.cover_url ? (
                                                <img
                                                    src={book.cover_url}
                                                    alt={book.title}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                                />
                                            ) : null}
                                        </div>

                                        <div style={{ flex: '1 1 auto', minWidth: 240 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                                                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                                                    {book.title}
                                                </div>
                                                <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'nowrap' }}>
                                                    {rightDate}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 3 }}>
                                                {book.author || ''}
                                            </div>

                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, opacity: 0.85 }}>
                                                    <div>{progress.toFixed(1)}%</div>
                                                    <div style={{ whiteSpace: 'nowrap' }}>прочитано</div>
                                                </div>
                                                <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: 'rgba(27,31,35,0.12)', overflow: 'hidden' }}>
                                                    <div style={{ width: `${progress}%`, height: '100%', background: '#22c55e' }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

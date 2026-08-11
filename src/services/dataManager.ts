import type { Plugin } from 'obsidian';
import { PluginData, DEFAULT_DATA, LocalBook, Topic, ReadingPlan, ReadingActivityDay } from '../models/store';
import { isPluginDataRecord, updatePluginData } from './pluginDataPersistence';

export class DataManager {
    private plugin: Plugin;
    private data: PluginData;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.data = this.createData();
    }

    public async loadData(): Promise<void> {
        const loaded: unknown = await this.plugin.loadData();
        this.data = this.createData(isPluginDataRecord(loaded) ? loaded : {});
    }

    public saveData(): Promise<void> {
        return updatePluginData(
            this.plugin,
            (existing) => Object.assign({}, existing, this.data) as Record<string, unknown>,
        );
    }

    public getData(): PluginData {
        return this.data;
    }

    public getBook(id: string): LocalBook | undefined {
        return this.data.books[id];
    }

    public saveBook(book: LocalBook): Promise<void> {
        this.data.books[book.id] = book;
        return this.saveData();
    }

    public saveReaderLocationChange(
        documentId: string,
        location: 'new' | 'later' | 'archive',
        book?: LocalBook,
    ): Promise<void> {
        this.data.pendingReaderLocations[documentId] = location;
        if (book) this.data.books[documentId] = book;
        return this.saveData();
    }

    public async removeBooks(bookIds: string[]) {
        for (const id of bookIds) {
            delete this.data.books[id];
            delete this.data.readingActivityByBook[id];
            delete this.data.pendingReaderLocations[id];
        }
        this.rebuildGlobalReadingActivity();
        await this.saveData();
    }

    public getTopics(): Topic[] {
        return Object.values(this.data.topics).sort((a, b) => a.order_index - b.order_index);
    }

    public saveTopic(topic: Topic): Promise<void> {
        this.data.topics[topic.id] = topic;
        return this.saveData();
    }

    public getPlans(): ReadingPlan[] {
        return Object.values(this.data.plans);
    }

    public savePlan(plan: ReadingPlan): Promise<void> {
        this.data.plans[plan.id] = plan;
        return this.saveData();
    }
    
    public addReadingActivity(
        dateKey: string,
        delta: Partial<Pick<ReadingActivityDay, 'minutes' | 'words' | 'progressPoints' | 'events'>>,
        bookId?: string
    ): Promise<void> {
        if (bookId) {
            const byBook = this.data.readingActivityByBook[bookId] || {};
            const existingBook = byBook[dateKey] || { minutes: 0, words: 0, progressPoints: 0, events: 0 };
            byBook[dateKey] = {
                minutes: existingBook.minutes + (delta.minutes || 0),
                words: existingBook.words + (delta.words || 0),
                progressPoints: existingBook.progressPoints + (delta.progressPoints || 0),
                events: existingBook.events + (delta.events || 0),
            };
            this.data.readingActivityByBook[bookId] = byBook;
        }

        this.rebuildGlobalReadingActivity();
        return this.saveData();
    }

    public replaceBookReadingActivity(
        bookId: string,
        activityByDate: Record<string, ReadingActivityDay>,
    ): Promise<void> {
        this.data.readingActivityByBook[bookId] = activityByDate;
        this.rebuildGlobalReadingActivity();
        return this.saveData();
    }

    public updateLastSync(): Promise<void> {
        this.data.lastSync = new Date().toISOString();
        return this.saveData();
    }

    private createData(loaded: Partial<PluginData> | Record<string, unknown> = {}): PluginData {
        const stored = loaded as Partial<PluginData>;
        return {
            ...DEFAULT_DATA,
            ...stored,
            books: { ...(stored.books || {}) },
            topics: { ...(stored.topics || {}) },
            plans: { ...(stored.plans || {}) },
            readingActivity: { ...(stored.readingActivity || {}) },
            readingActivityByBook: { ...(stored.readingActivityByBook || {}) },
            pendingReaderLocations: { ...(stored.pendingReaderLocations || {}) },
        };
    }

    private rebuildGlobalReadingActivity(): void {
        const aggregated: Record<string, ReadingActivityDay> = {};
        for (const byBook of Object.values(this.data.readingActivityByBook)) {
            for (const [dateKey, day] of Object.entries(byBook || {})) {
                const existing = aggregated[dateKey] || { minutes: 0, words: 0, progressPoints: 0, events: 0 };
                aggregated[dateKey] = {
                    minutes: existing.minutes + (day.minutes || 0),
                    words: existing.words + (day.words || 0),
                    progressPoints: existing.progressPoints + (day.progressPoints || 0),
                    events: existing.events + (day.events || 0),
                };
            }
        }
        this.data.readingActivity = aggregated;
    }
}

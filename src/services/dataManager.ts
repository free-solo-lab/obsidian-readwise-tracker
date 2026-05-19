import { Plugin } from 'obsidian';
import { PluginData, DEFAULT_DATA, LocalBook, Topic, ReadingPlan, ReadingActivityDay } from '../models/store';

export class DataManager {
    private plugin: Plugin;
    private data: PluginData;
    private saveChain: Promise<void> = Promise.resolve();

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.data = DEFAULT_DATA;
    }

    public async loadData() {
        this.data = Object.assign({}, DEFAULT_DATA, await this.plugin.loadData());
    }

    public async saveData() {
        this.saveChain = this.saveChain
            .catch(() => undefined)
            .then(async () => {
                const existing = (await this.plugin.loadData()) ?? {};
                await this.plugin.saveData(Object.assign({}, existing, this.data));
            });
        return this.saveChain;
    }

    public getData(): PluginData {
        return this.data;
    }

    public getBook(id: string): LocalBook | undefined {
        return this.data.books[id];
    }

    public saveBook(book: LocalBook) {
        this.data.books[book.id] = book;
        this.saveData();
    }

    public async removeBooks(bookIds: string[]) {
        for (const id of bookIds) {
            delete this.data.books[id];
            delete this.data.readingActivityByBook[id];
        }
        this.rebuildGlobalReadingActivity();
        await this.saveData();
    }

    public getTopics(): Topic[] {
        return Object.values(this.data.topics).sort((a, b) => a.order_index - b.order_index);
    }

    public saveTopic(topic: Topic) {
        this.data.topics[topic.id] = topic;
        this.saveData();
    }

    public getPlans(): ReadingPlan[] {
        return Object.values(this.data.plans);
    }

    public savePlan(plan: ReadingPlan) {
        this.data.plans[plan.id] = plan;
        this.saveData();
    }
    
    public addReadingActivity(
        dateKey: string,
        delta: Partial<Pick<ReadingActivityDay, 'minutes' | 'words' | 'progressPoints' | 'events'>>,
        bookId?: string
    ) {
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
        this.saveData();
    }

    public replaceBookReadingActivity(bookId: string, activityByDate: Record<string, ReadingActivityDay>) {
        this.data.readingActivityByBook[bookId] = activityByDate;
        this.rebuildGlobalReadingActivity();
        this.saveData();
    }

    public updateLastSync() {
        this.data.lastSync = new Date().toISOString();
        this.saveData();
    }

    private rebuildGlobalReadingActivity() {
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

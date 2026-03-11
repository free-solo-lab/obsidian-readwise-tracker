import { DataManager } from './dataManager';
import { LocalBook } from '../models/store';

export class StatsEngine {
    private dataManager: DataManager;

    constructor(dataManager: DataManager) {
        this.dataManager = dataManager;
    }

    public getReadingStats() {
        const books = Object.values(this.dataManager.getData().books);
        
        const totalBooks = books.length;
        const completedBooks = books.filter(b => b.status === 'completed').length;
        const readingBooks = books.filter(b => b.status === 'reading').length;
        const plannedBooks = books.filter(b => b.status === 'planned').length;
        const trackedDenominator = completedBooks + readingBooks;
        const completionPercent = trackedDenominator > 0 ? (completedBooks / trackedDenominator) * 100 : 0;

        const wpm = 200;

        const completedMinutes = books
            .filter(b => b.status === 'completed')
            .reduce((sum, b) => sum + ((b.words_count || 0) / wpm), 0);

        const remainingMinutes = books
            .filter(b => b.status === 'reading')
            .reduce((sum, b) => {
                const totalWords = b.words_count || 0;
                const progressRatio = Math.min(100, Math.max(0, b.reading_progress || 0)) / 100;
                const remainingWords = totalWords * (1 - progressRatio);
                return sum + (remainingWords / wpm);
            }, 0);
        
        return {
            totalBooks,
            completedBooks,
            readingBooks,
            plannedBooks,
            completionPercent,
            completedMinutes,
            remainingMinutes
        };
    }

    public getBooksByStatus(status: LocalBook['status']): LocalBook[] {
        return Object.values(this.dataManager.getData().books)
            .filter(b => b.status === status);
    }

    public getPlanProgress(planId: string) {
        const plan = this.dataManager.getData().plans[planId];
        if (!plan) return null;

        const totalBooks = plan.book_ids.length;
        if (totalBooks === 0) return 0;

        const completedInPlan = plan.book_ids
            .map(id => this.dataManager.getBook(id))
            .filter(book => book && book.status === 'completed')
            .length;

        return (completedInPlan / totalBooks) * 100;
    }
}

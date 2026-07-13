export interface LocalBook {
    id: string;
    title: string;
    author: string;
    category: string;
    total_pages?: number;
    words_count?: number;
    source: 'readwise';
    readwise_id?: string;
    tags?: string[];
    created_at: string;
    updated_at: string;
    cover_url?: string;
    reading_progress: number; // 0-100
    status: 'planned' | 'reading' | 'completed' | 'skipped';
    location?: 'new' | 'later' | 'shortlist' | 'archive' | 'feed';
    notes_count?: number;
}

export interface Topic {
    id: string;
    name: string;
    parent_id?: string;
    color: string;
    order_index: number;
}

export interface ReadingPlan {
    id: string;
    topic_id: string;
    plan_name: string;
    start_date: string;
    target_date?: string;
    status: 'active' | 'completed' | 'paused';
    book_ids: string[]; // List of LocalBook IDs in this plan
}

export interface ReadingActivityDay {
    minutes: number;
    words: number;
    progressPoints: number;
    events: number;
}

export interface PluginData {
    books: Record<string, LocalBook>;
    topics: Record<string, Topic>;
    plans: Record<string, ReadingPlan>;
    readingActivity: Record<string, ReadingActivityDay>;
    readingActivityByBook: Record<string, Record<string, ReadingActivityDay>>;
    lastSync: string | null;
}

export const DEFAULT_DATA: PluginData = {
    books: {},
    topics: {},
    plans: {},
    readingActivity: {},
    readingActivityByBook: {},
    lastSync: null
};

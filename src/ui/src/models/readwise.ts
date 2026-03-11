export interface ReadwiseDocument {
    id: string;
    title?: string;
    author?: string;
    category?: string;
    location?: string;
    source?: string;
    url?: string;
    source_url?: string;
    image_url?: string;
    created_at?: string;
    updated_at?: string;
    reading_progress?: number;
    word_count?: number;
    num_highlights?: number;
    tags?: Record<string, any>;
    summary?: string;
    parent_id?: string | null;
    readable_title?: string;
    site_name?: string;
}

export interface ReadwiseListResponse {
    count: number;
    nextPageCursor: string | null;
    results: ReadwiseDocument[];
}

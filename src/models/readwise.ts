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

export type ReadwiseSaveDocumentCategory =
    | 'article'
    | 'email'
    | 'rss'
    | 'highlight'
    | 'note'
    | 'pdf'
    | 'epub'
    | 'tweet'
    | 'video';

export interface ReadwiseSaveDocumentRequest {
    url: string;
    html?: string;
    should_clean_html?: boolean;
    title?: string;
    author?: string;
    summary?: string;
    published_date?: string;
    image_url?: string;
    location?: 'new' | 'later' | 'archive' | 'feed';
    category?: ReadwiseSaveDocumentCategory;
    saved_using?: string;
    tags?: string[];
    notes?: string;
}

export interface ReadwiseSaveDocumentResponse {
    id: string;
    url: string;
}

export interface ReadwiseSignS3Response {
    url: string;
    file_id: number;
}

export interface ReadwiseUploadFileResponse {
    docs_ids: string[];
}

export interface ReadwiseReaderLoginResponse {
    sessionCookie: string;
}

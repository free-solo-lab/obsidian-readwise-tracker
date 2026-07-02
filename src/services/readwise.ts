import { requestUrl, RequestUrlParam } from 'obsidian';
import { ReadwiseDocument, ReadwiseListResponse } from '../models/readwise';

export type ReaderLocation = 'new' | 'later' | 'shortlist' | 'archive' | 'feed';

export class ReadwiseService {
    private token: string;
    private baseUrl = 'https://readwise.io/api/v3';
    private debug = false;
    private requestDelayMs = 0;
    private maxRetries = 5;

    constructor(token: string) {
        this.token = token;
    }

    public updateToken(token: string) {
        this.token = token;
    }

    public setDebug(debug: boolean) {
        this.debug = debug;
    }

    public setRequestDelayMs(ms: number) {
        this.requestDelayMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    }

    public setMaxRetries(retries: number) {
        this.maxRetries = Number.isFinite(retries) ? Math.max(1, Math.floor(retries)) : 5;
    }

    public async validateToken(): Promise<void> {
        if (!this.token) {
            throw new Error('Readwise API token is not set.');
        }

        const requestParams: RequestUrlParam = {
            url: 'https://readwise.io/api/v2/auth/',
            method: 'GET',
            headers: {
                'Authorization': `Token ${this.token}`,
            },
        };

        const response = await requestUrl(requestParams);
        if (this.debug) {
            console.log('[Readwise] validateToken status', response.status);
            console.log('[Readwise] validateToken headers', response.headers);
        }
        if (response.status !== 204) {
            throw new Error(`Readwise token validation failed: ${response.status}`);
        }
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
        if (!this.token) {
            throw new Error('Readwise API token is not set.');
        }

        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const requestParams: RequestUrlParam = {
            url: url.toString(),
            method: 'GET',
            headers: {
                'Authorization': `Token ${this.token}`,
                'Content-Type': 'application/json',
            },
        };

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            const response = await requestUrl(requestParams);

            if (this.debug) {
                console.log('[Readwise] GET', requestParams.url, 'status', response.status);
                console.log('[Readwise] headers', response.headers);
            }

            if (response.status === 429) {
                const retryAfterRaw = (response.headers?.['Retry-After'] ?? response.headers?.['retry-after']) as string | undefined;
                const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : 5;
                const waitMs = Number.isFinite(retryAfterSeconds) ? Math.max(1, retryAfterSeconds) * 1000 : 5000;
                if (this.debug) {
                    console.warn('[Readwise] rate limited, retry in', waitMs, 'ms');
                }
                await this.sleep(waitMs);
                continue;
            }

            if (response.status !== 200) {
                const message = typeof response.text === 'string' && response.text.length > 0
                    ? `Readwise API request failed: ${response.status} ${response.text.slice(0, 200)}`
                    : `Readwise API request failed: ${response.status}`;
                throw new Error(message);
            }

            if (this.debug) {
                console.log('[Readwise] response json', response.json);
            }

            return response.json as T;
        }

        throw new Error('Readwise API request failed: too many retries after rate limiting.');
    }

    public async getDocuments(
        location?: ReaderLocation,
        category?: string,
        updatedAfter?: string,
        pageCursor?: string
    ): Promise<ReadwiseListResponse> {
        const params: Record<string, string> = {};
        
        if (location) params['location'] = location;
        if (category) params['category'] = category;
        if (updatedAfter) params['updatedAfter'] = updatedAfter;
        if (pageCursor) params['pageCursor'] = pageCursor;

        return this.request<ReadwiseListResponse>('/list/', params);
    }

    public async getAllDocuments(
        location?: ReaderLocation,
        category?: string,
        updatedAfter?: string
    ): Promise<ReadwiseDocument[]> {
        let allDocuments: ReadwiseDocument[] = [];
        let nextPageCursor: string | null = null;

        do {
            const response: ReadwiseListResponse = await this.getDocuments(location, category, updatedAfter, nextPageCursor || undefined);
            allDocuments = allDocuments.concat(response.results);
            nextPageCursor = response.nextPageCursor;
            if (nextPageCursor && this.requestDelayMs > 0) {
                await this.sleep(this.requestDelayMs);
            }
        } while (nextPageCursor);

        return allDocuments;
    }
}

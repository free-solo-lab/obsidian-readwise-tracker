import { requestUrl, RequestUrlParam } from 'obsidian';
import * as https from 'https';
import {
    ReadwiseDocument,
    ReadwiseListResponse,
    ReadwiseSaveDocumentRequest,
    ReadwiseSaveDocumentResponse,
    ReadwiseSignS3Response,
    ReadwiseUploadFileResponse,
    ReadwiseReaderLoginResponse,
} from '../models/readwise';
import { getHttpErrorStatus, getRateLimitWaitMs } from './readwiseRateLimit';

export type ReaderLocation = 'new' | 'later' | 'shortlist' | 'archive' | 'feed';

export class ReaderAuthenticationError extends Error {
    constructor(message = 'Reader authentication is required.') {
        super(message);
        this.name = 'ReaderAuthenticationError';
    }
}

interface NodeHttpResponse {
    status: number;
    headers: Record<string, unknown>;
    text: string;
    url: string;
}

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
        this.requestDelayMs = Number.isFinite(ms) ? Math.min(60_000, Math.max(0, ms)) : 0;
    }

    public setMaxRetries(retries: number) {
        this.maxRetries = Number.isFinite(retries)
            ? Math.min(20, Math.max(0, Math.floor(retries)))
            : 5;
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

    private getHeader(headers: Record<string, unknown>, name: string): unknown {
        const expected = name.toLowerCase();
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === expected) {
                return value;
            }
        }
        return undefined;
    }

    private getHeaderString(headers: Record<string, unknown>, name: string): string | undefined {
        const raw = this.getHeader(headers, name);
        if (typeof raw === 'string') {
            return raw;
        }
        if (Array.isArray(raw) && typeof raw[0] === 'string') {
            return raw[0];
        }
        return undefined;
    }

    private extractCookieHeader(headers: Record<string, unknown>): string {
        const raw = this.getHeader(headers, 'set-cookie');
        if (!raw) {
            return '';
        }

        const rawCookies = Array.isArray(raw)
            ? raw.filter((item): item is string => typeof item === 'string')
            : typeof raw === 'string'
                ? raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g)
                : Object.values(raw as Record<string, unknown>)
                    .filter((item): item is string => typeof item === 'string');

        return rawCookies
            .map((cookie) => cookie.split(';')[0]?.trim())
            .filter(Boolean)
            .join('; ');
    }

    private mergeCookies(...cookies: string[]): string {
        const byName = new Map<string, string>();
        for (const cookieHeader of cookies) {
            for (const part of cookieHeader.split(';')) {
                const cookie = part.trim();
                const eq = cookie.indexOf('=');
                if (eq <= 0) continue;
                byName.set(cookie.slice(0, eq), cookie.slice(eq + 1));
            }
        }
        return Array.from(byName.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    }

    private getCookieValue(cookieHeader: string, name: string): string | undefined {
        for (const part of cookieHeader.split(';')) {
            const cookie = part.trim();
            const eq = cookie.indexOf('=');
            if (eq <= 0) continue;
            if (cookie.slice(0, eq) === name) {
                return cookie.slice(eq + 1);
            }
        }
        return undefined;
    }

    private extractLoginCsrfToken(html: string): string | undefined {
        const inputMatch = html.match(/<input[^>]+name=["']csrfmiddlewaretoken["'][^>]*>/i);
        const input = inputMatch?.[0];
        const valueMatch = input?.match(/\svalue=["']([^"']+)["']/i);
        return valueMatch?.[1];
    }

    private async nodeRequest(
        url: string,
        options: {
            method: 'GET' | 'POST';
            headers?: Record<string, string>;
            body?: string;
        },
    ): Promise<NodeHttpResponse> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const request = https.request(
                {
                    method: options.method,
                    hostname: parsed.hostname,
                    path: `${parsed.pathname}${parsed.search}`,
                    headers: options.headers,
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });
                    response.on('end', () => {
                        resolve({
                            status: response.statusCode || 0,
                            headers: response.headers as Record<string, unknown>,
                            text: Buffer.concat(chunks).toString('utf8'),
                            url,
                        });
                    });
                },
            );
            request.on('error', reject);
            if (options.body) {
                request.write(options.body);
            }
            request.end();
        });
    }

    private isRedirect(status: number): boolean {
        return status >= 300 && status < 400;
    }

    private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
        return this.requestJson<T>(endpoint, {
            method: 'GET',
            params,
            okStatuses: [200],
        });
    }

    private async requestJson<T>(
        endpoint: string,
        options: {
            method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
            params?: Record<string, string>;
            body?: unknown;
            okStatuses: number[];
        },
    ): Promise<T> {
        if (!this.token) {
            throw new Error('Readwise API token is not set.');
        }

        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.keys(options.params || {}).forEach(key => url.searchParams.append(key, options.params![key]));

        const requestParams: RequestUrlParam = {
            url: url.toString(),
            method: options.method,
            headers: {
                'Authorization': `Token ${this.token}`,
                'Content-Type': 'application/json',
            },
        };

        if (typeof options.body !== 'undefined') {
            requestParams.body = JSON.stringify(options.body);
        }

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            let response;
            try {
                response = await requestUrl(requestParams);
            } catch (error) {
                if (getHttpErrorStatus(error) !== 429 || attempt === this.maxRetries) {
                    throw error;
                }

                const waitMs = getRateLimitWaitMs(error);
                if (this.debug) {
                    console.warn('[Readwise] rate limited, retry in', waitMs, 'ms');
                }
                await this.sleep(waitMs);
                continue;
            }

            if (this.debug) {
                console.log('[Readwise]', options.method, requestParams.url, 'status', response.status);
                console.log('[Readwise] headers', response.headers);
            }

            if (response.status === 429) {
                if (attempt === this.maxRetries) {
                    break;
                }
                const waitMs = getRateLimitWaitMs(response);
                if (this.debug) {
                    console.warn('[Readwise] rate limited, retry in', waitMs, 'ms');
                }
                await this.sleep(waitMs);
                continue;
            }

            if (!options.okStatuses.includes(response.status)) {
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

    public async saveDocument(document: ReadwiseSaveDocumentRequest): Promise<ReadwiseSaveDocumentResponse> {
        return this.requestJson<ReadwiseSaveDocumentResponse>('/save/', {
            method: 'POST',
            body: document,
            okStatuses: [200, 201],
        });
    }

    public async updateDocumentTags(documentIds: string[], tags: string[]): Promise<void> {
        if (documentIds.length === 0 || tags.length === 0) return;

        const response = await this.requestJson<{
            results?: Array<{ id: string; success: boolean; error?: string }>;
        }>('/bulk_update/', {
            method: 'PATCH',
            body: {
                updates: documentIds.map((id) => ({ id, tags })),
            },
            okStatuses: [200, 207],
        });
        const failures = response.results?.filter((result) => !result.success) || [];
        if (failures.length > 0) {
            throw new Error(failures.map((failure) => failure.error || failure.id).join(', '));
        }
    }

    public async updateDocumentLocation(documentId: string, location: 'new' | 'later' | 'archive'): Promise<void> {
        if (!documentId) return;

        const response = await this.requestJson<{
            results?: Array<{ id: string; success: boolean; error?: string }>;
        }>('/bulk_update/', {
            method: 'PATCH',
            body: { updates: [{ id: documentId, location }] },
            okStatuses: [200, 207],
        });
        const failure = response.results?.find((result) => !result.success);
        if (failure) throw new Error(failure.error || failure.id);
    }

    public async updateNewDocumentTagsWhenReady(documentIds: string[], tags: string[]): Promise<void> {
        if (documentIds.length === 0 || tags.length === 0) return;

        const retryDelaysMs = [500, 1_000, 2_000, 3_000, 4_000, 4_000];
        for (let attempt = 0; ; attempt++) {
            try {
                await this.updateDocumentTags(documentIds, tags);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const canRetry = /document not found/i.test(message) && attempt < retryDelaysMs.length;
                if (!canRetry) throw error;
                await this.sleep(retryDelaysMs[attempt]);
            }
        }
    }

    public async addDocumentTags(documentId: string, tags: string[]): Promise<void> {
        if (!documentId || tags.length === 0) return;

        const documentResponse = await this.request<ReadwiseListResponse>('/list/', { id: documentId });
        const existingTags = Object.keys(documentResponse.results[0]?.tags || {});
        const mergedTags = Array.from(new Map(
            [...existingTags, ...tags]
                .map((tag) => tag.trim())
                .filter(Boolean)
                .map((tag) => [tag.toLocaleLowerCase(), tag]),
        ).values());
        await this.updateDocumentTags([documentId], mergedTags);
    }

    public async deleteReaderDocument(documentId: string, sessionCookie: string): Promise<void> {
        if (!sessionCookie) {
            throw new ReaderAuthenticationError('Sign in to Reader before deleting a book.');
        }

        const createEventId = (): string => {
            const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
            let timestamp = Date.now();
            let timePart = '';
            for (let index = 0; index < 10; index++) {
                timePart = alphabet[timestamp % 32] + timePart;
                timestamp = Math.floor(timestamp / 32);
            }
            const random = new Uint8Array(16);
            crypto.getRandomValues(random);
            return timePart + Array.from(random, (value) => alphabet[value % 32]).join('');
        };

        const now = Date.now();
        const body = JSON.stringify({
            events: [{
                correlationId: createEventId(),
                dataUpdates: {
                    forwardPatch: [{ op: 'remove', path: `/documents/${documentId}` }],
                    itemsUpdated: [{ id: documentId, type: 'documents' }],
                    reversePatch: [],
                },
                environment: {
                    agent: { category: 'desktop-app', version: 'unknown' },
                    app: { category: 'obsidian-plugin', version: 'unknown' },
                    channel: 'production',
                },
                id: createEventId(),
                name: 'full-document-deleted',
                timestamp: now,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                userInteraction: { name: 'click' },
            }],
            schemaVersion: 10,
            isChunkingSupported: true,
        });

        const response = await requestUrl({
            url: 'https://readwise.io/reader/api/state/update/',
            method: 'POST',
            body,
            contentType: 'text/plain;charset=UTF-8',
            throw: false,
            headers: {
                'Cookie': sessionCookie,
                'Content-Type': 'text/plain;charset=UTF-8',
                'Origin': 'https://read.readwise.io',
                'Referer': 'https://read.readwise.io/',
                ...(this.getCookieValue(sessionCookie, 'csrftoken')
                    ? { 'X-CSRFToken': this.getCookieValue(sessionCookie, 'csrftoken')! }
                    : {}),
            },
        });

        if (response.status === 401 || response.status === 403) {
            throw new ReaderAuthenticationError();
        }
        if (response.status !== 200) {
            throw new Error(`Readwise delete failed: ${response.status} ${response.text.slice(0, 200)}`);
        }
    }

    public async loginToReader(email: string, password: string): Promise<ReadwiseReaderLoginResponse> {
        const loginUrl = 'https://readwise.io/accounts/login/?next=/read/authed';
        const initial = await this.nodeRequest(loginUrl, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://readwise.io/accounts/login/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Readwise Tracker',
            },
        });
        const initialCookie = this.extractCookieHeader(initial.headers);
        const csrfToken = this.extractLoginCsrfToken(initial.text);
        if (!csrfToken) {
            throw new Error('Readwise login page did not contain a CSRF token.');
        }
        if (!this.getCookieValue(initialCookie, 'csrftoken')) {
            throw new Error('Readwise login did not return the csrftoken cookie.');
        }

        const body = new URLSearchParams();
        body.set('csrfmiddlewaretoken', csrfToken);
        body.set('login', email);
        body.set('password', password);

        const response = await this.nodeRequest(loginUrl, {
            method: 'POST',
            body: body.toString(),
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': String(Buffer.byteLength(body.toString())),
                'Cookie': initialCookie,
                'Cache-Control': 'max-age=0',
                'Referer': loginUrl,
                'Origin': 'https://readwise.io',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'X-CSRFToken': csrfToken,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Readwise Tracker',
            },
        });

        const sessionCookie = this.mergeCookies(initialCookie, this.extractCookieHeader(response.headers));
        const location = this.getHeaderString(response.headers, 'location');
        const redirectedToReader = this.isRedirect(response.status)
            && Boolean(location)
            && new URL(location!, loginUrl).pathname.startsWith('/read/authed');

        if (!redirectedToReader) {
            const hasPasswordError = /password|incorrect|invalid|captcha|csrf|two-factor|2fa|verification/i.test(response.text);
            const hint = hasPasswordError
                ? ' Readwise returned the login page with an error.'
                : location
                    ? ` Redirected to ${location} instead of /read/authed.`
                    : ' The expected /read/authed redirect was not returned.';
            throw new Error(`Readwise login failed: ${response.status}.${hint} Check credentials, 2FA, or CAPTCHA.`);
        }

        return { sessionCookie };
    }

    public async uploadFile(
        fileName: string,
        contentType: string,
        body: ArrayBuffer,
        sessionCookie: string,
    ): Promise<ReadwiseUploadFileResponse> {
        if (!sessionCookie) {
            throw new ReaderAuthenticationError();
        }

        const signUrl = new URL('https://readwise.io/reader/api/sign_s3');
        signUrl.searchParams.set('file_name', fileName);
        signUrl.searchParams.set('type', contentType);

        const signResponse = await requestUrl({
            url: signUrl.toString(),
            method: 'GET',
            throw: false,
            headers: {
                'Cookie': sessionCookie,
                'Origin': 'https://read.readwise.io',
                'Referer': 'https://read.readwise.io/',
            },
        });

        if (signResponse.status === 401 || signResponse.status === 403) {
            throw new ReaderAuthenticationError();
        }
        if (signResponse.status !== 200) {
            throw new Error(`Readwise upload signing failed: ${signResponse.status}`);
        }

        const signed = signResponse.json as ReadwiseSignS3Response;
        if (!signed?.url || typeof signed.file_id !== 'number') {
            throw new Error('Readwise upload signing returned an invalid response.');
        }

        const uploadResponse = await requestUrl({
            url: signed.url,
            method: 'PUT',
            body,
            contentType,
            throw: false,
            headers: {
                'Content-Type': contentType,
            },
        });

        if (uploadResponse.status !== 200) {
            throw new Error(`Readwise file upload failed: ${uploadResponse.status}`);
        }

        const registerResponse = await requestUrl({
            url: 'https://readwise.io/reader/upload_files/',
            method: 'POST',
            body: JSON.stringify({
                content_type: contentType,
                reader_file_id: signed.file_id,
                file_name: fileName,
            }),
            contentType: 'text/plain;charset=UTF-8',
            throw: false,
            headers: {
                'Cookie': sessionCookie,
                'Content-Type': 'text/plain;charset=UTF-8',
                'Origin': 'https://read.readwise.io',
                'Referer': 'https://read.readwise.io/',
                ...(this.getCookieValue(sessionCookie, 'csrftoken')
                    ? { 'X-CSRFToken': this.getCookieValue(sessionCookie, 'csrftoken')! }
                    : {}),
            },
        });

        if (registerResponse.status === 401 || registerResponse.status === 403) {
            throw new ReaderAuthenticationError();
        }
        if (registerResponse.status !== 200) {
            throw new Error(`Readwise upload registration failed: ${registerResponse.status}`);
        }

        return registerResponse.json as ReadwiseUploadFileResponse;
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

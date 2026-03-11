import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import { ReadwiseService } from './src/services/readwise';
import { DataManager } from './src/services/dataManager';
import { StatsEngine } from './src/services/stats';
import { LocalBook } from './src/models/store';
import { StatsView, STATS_VIEW_TYPE } from './src/ui/StatsView';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './src/ui/DashboardView';
import { BookGraphView, BOOK_GRAPH_VIEW_TYPE } from './src/ui/BookGraphView';

// Interface for Plugin Settings
interface ReadwiseTrackerSettings {
	readwiseToken: string;
	debugLogging: boolean;
	readwiseBooksFolder: string;
	readwiseLinkedHighlightsFolder: string;
	readwiseInboxFolder: string;
}

const DEFAULT_SETTINGS: ReadwiseTrackerSettings = {
	readwiseToken: '',
	debugLogging: false,
	readwiseBooksFolder: 'Readwise/Books',
	readwiseLinkedHighlightsFolder: 'Readwise/Highlights',
	readwiseInboxFolder: 'Inbox/Readwise',
}

export default class ReadwiseTrackerPlugin extends Plugin {
	settings!: ReadwiseTrackerSettings;
    readwiseService!: ReadwiseService;
    dataManager!: DataManager;
    statsEngine!: StatsEngine;

	async onload() {
		await this.loadSettings();

        // Initialize Services
        this.dataManager = new DataManager(this);
        await this.dataManager.loadData();
        
		this.readwiseService = new ReadwiseService(this.settings.readwiseToken);
		this.readwiseService.setDebug(this.settings.debugLogging);
        this.statsEngine = new StatsEngine(this.dataManager);

        // Register Views
        this.registerView(
            STATS_VIEW_TYPE,
            (leaf) => new StatsView(leaf, this)
        );

        this.registerView(
            DASHBOARD_VIEW_TYPE,
            (leaf) => new DashboardView(leaf, this)
        );

        this.registerView(
            BOOK_GRAPH_VIEW_TYPE,
            (leaf) => new BookGraphView(leaf, this)
        );

		// Add Settings Tab
		this.addSettingTab(new ReadwiseTrackerSettingTab(this.app, this));

		// Add Commands
		this.addCommand({
			id: 'readwise-stats',
			name: 'Open Readwise Stats',
			callback: async () => {
				await this.activateView(STATS_VIEW_TYPE);
			}
		});

        this.addCommand({
			id: 'readwise-dashboard',
			name: 'Open Progress Dashboard',
			callback: async () => {
				await this.activateView(DASHBOARD_VIEW_TYPE);
			}
		});

        this.addCommand({
            id: 'readwise-sync',
            name: 'Sync Readwise Data',
            callback: async () => {
                await this.syncReadwiseData();
            }
        });

		this.addCommand({
			id: 'readwise-sync-all',
			name: 'Sync All (Official + Tracker)',
			callback: async () => {
				let officialOk = false;
				try {
					await this.triggerReadwiseOfficialSyncAndWait();
					officialOk = true;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					new Notice(`Readwise Official sync skipped/failed: ${message}`);
				}

				await this.syncReadwiseData();
				await this.migrateReadwiseBookNotesToLinkedHighlights();

				new Notice(officialOk ? 'All sync steps completed.' : 'Tracker sync steps completed.');
			}
		});

		this.addCommand({
			id: 'readwise-test-token',
			name: 'Test Readwise Token',
			callback: async () => {
				await this.testReadwiseToken();
			}
		});

		this.addCommand({
			id: 'readwise-migrate-linked-highlights',
			name: 'Migrate Readwise book notes to linked highlights',
			callback: async () => {
				await this.migrateReadwiseBookNotesToLinkedHighlights();
			}
		});
	}

	onunload() {

	}

    async activateView(viewType: string) {
        const { workspace } = this.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for stats/dashboard, or main for planner
            if (viewType === STATS_VIEW_TYPE) {
                leaf = workspace.getRightLeaf(false);
            } else {
                leaf = workspace.getLeaf(false);
            }
            
            if (leaf) {
                await leaf.setViewState({ type: viewType, active: true });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async openBookGraph(bookId?: string) {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(BOOK_GRAPH_VIEW_TYPE);
        const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: BOOK_GRAPH_VIEW_TYPE, active: true, state: { bookId } } as any);
        workspace.revealLeaf(leaf);
    }

	private findReadwiseOfficialSyncCommandId() {
		const commands = (this.app as any)?.commands?.commands;
		if (!commands || typeof commands !== 'object') return null;

		const entries = Object.entries(commands) as Array<[string, any]>;
		for (const [id, cmd] of entries) {
			const name = typeof cmd?.name === 'string' ? cmd.name : '';
			const lname = name.toLowerCase();
			if (lname.includes('readwise') && lname.includes('sync') && lname.includes('official')) return id;
		}
		for (const [id, cmd] of entries) {
			const name = typeof cmd?.name === 'string' ? cmd.name : '';
			const lname = name.toLowerCase();
			if (lname.includes('readwise') && lname.includes('sync')) return id;
			if (id.toLowerCase().includes('readwise') && lname.includes('sync')) return id;
		}
		return null;
	}

	private async triggerReadwiseOfficialSyncAndWait() {
		const id = this.findReadwiseOfficialSyncCommandId();
		if (!id) throw new Error('Readwise Official command not found');

		const normalizeFolder = (v: string | undefined) =>
			normalizePath(String(v || '')).replace(/^\/+/, '').replace(/\/+$/, '');

		const roots = new Set<string>();
		const booksFolder = normalizeFolder(this.settings.readwiseBooksFolder) || 'Readwise/Books';
		const highlightsFolder = normalizeFolder(this.settings.readwiseLinkedHighlightsFolder) || 'Readwise/Highlights';
		roots.add(booksFolder.split('/')[0] || booksFolder);
		roots.add(highlightsFolder.split('/')[0] || highlightsFolder);
		roots.add(booksFolder);
		roots.add(highlightsFolder);
		roots.add('Readwise');

		const prefixes = Array.from(roots).filter(Boolean);
		const matches = (path: string) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

		let lastActivityAt = Date.now();
		let seenActivity = false;

		const onCreate = this.app.vault.on('create', (f) => {
			if (!(f instanceof TFile)) return;
			if (!matches(f.path)) return;
			seenActivity = true;
			lastActivityAt = Date.now();
		});
		const onModify = this.app.vault.on('modify', (f) => {
			if (!(f instanceof TFile)) return;
			if (!matches(f.path)) return;
			seenActivity = true;
			lastActivityAt = Date.now();
		});

		try {
			new Notice('Readwise Official: syncing...');
			await Promise.resolve((this.app as any).commands.executeCommandById(id));

			const startedAt = Date.now();
			const timeoutMs = 5 * 60 * 1000;
			const idleMs = 2000;
			const noActivityMaxMs = 15000;
			while (true) {
				const now = Date.now();
				if (seenActivity && now - lastActivityAt > idleMs) return;
				if (!seenActivity && now - startedAt > noActivityMaxMs) return;
				if (now - startedAt > timeoutMs) throw new Error('Timeout waiting for Readwise Official sync');
				await new Promise((r) => window.setTimeout(r, 250));
			}
		} finally {
			this.app.vault.offref(onCreate);
			this.app.vault.offref(onModify);
		}
	}

	async createInboxNoteFromHighlight(args: { highlightFile: TFile; book: LocalBook; bookFile?: TFile | null }) {
		const inboxRaw = this.settings.readwiseInboxFolder || 'Inbox/Readwise';
		const inboxFolder = normalizePath(String(inboxRaw)).replace(/^\/+/, '').replace(/\/+$/, '');

		const sanitizeFileName = (s: string) =>
			s
				.replace(/[\\/:*?"<>|]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 140);

		const ensureFolder = async (path: string) => {
			if (!path) return;
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing) return;
			const parts = path.split('/').filter(Boolean);
			let cur = '';
			for (const p of parts) {
				cur = cur ? `${cur}/${p}` : p;
				const e = this.app.vault.getAbstractFileByPath(cur);
				if (!e) await this.app.vault.createFolder(cur);
			}
		};

		const parseHighlightNote = (text: string) => {
			const lines = text.split(/\r?\n/);
			let i = 0;
			if (lines[i] === '---') {
				i++;
				while (i < lines.length && lines[i] !== '---') i++;
				if (i < lines.length && lines[i] === '---') i++;
			}
			while (i < lines.length && lines[i].trim() === '') i++;

			let quote = '';
			if (i < lines.length && lines[i].trim().startsWith('>')) {
				const buf: string[] = [];
				while (i < lines.length && lines[i].trim().startsWith('>')) {
					buf.push(lines[i].replace(/^\s*>\s?/, ''));
					i++;
				}
				quote = buf.join('\n').trim();
			}

			while (i < lines.length && lines[i].trim() === '') i++;
			const descBuf: string[] = [];
			while (i < lines.length) {
				const line = lines[i];
				if (/^##\s+/.test(line)) break;
				if (line.trim() === '---') break;
				descBuf.push(line);
				i++;
			}
			const description = descBuf.join('\n').trim();

			return { quote, description };
		};

		await ensureFolder(inboxFolder);

		const highlightCache = this.app.metadataCache.getFileCache(args.highlightFile);
		const highlightFm = highlightCache?.frontmatter as any;
		const highlightTitle = (highlightFm?.title as string | undefined) || args.highlightFile.basename;
		const highlightDate = (highlightFm?.date as string | undefined) || '';

		const highlightLink = `[[${args.highlightFile.path}|${args.highlightFile.basename}]]`;
		const bookLink = args.bookFile ? `[[${args.bookFile.path}|${args.bookFile.basename}]]` : `[[${args.book.title}]]`;

		const highlightText = await this.app.vault.cachedRead(args.highlightFile);
		const parsed = parseHighlightNote(highlightText);

		const title = sanitizeFileName(highlightTitle) || 'Заметка';
		const baseName = sanitizeFileName(`Заметка — ${title}`) || 'Заметка';
		let outPath = normalizePath(`${inboxFolder}/${baseName}.md`);
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(outPath)) {
			outPath = normalizePath(`${inboxFolder}/${baseName} (${n}).md`);
			n++;
		}

		const today = new Date();
		const y = today.getFullYear();
		const m = String(today.getMonth() + 1).padStart(2, '0');
		const d = String(today.getDate()).padStart(2, '0');
		const todayKey = `${y}-${m}-${d}`;

		const contentParts: string[] = [];
		contentParts.push('---');
		contentParts.push('type: inbox');
		contentParts.push(`created: ${todayKey}`);
		contentParts.push(`book: "${args.book.title.replace(/"/g, '\\"')}"`);
		contentParts.push('---');
		contentParts.push('');
		contentParts.push(`# ${highlightTitle}`);
		contentParts.push('');
		contentParts.push(`Книга: ${bookLink}`);
		contentParts.push(`Источник: ${highlightLink}`);
		if (highlightDate) contentParts.push(`Дата: ${highlightDate.slice(0, 10)}`);
		if (parsed.quote) {
			contentParts.push('');
			for (const line of parsed.quote.split('\n')) contentParts.push(`> ${line}`);
		}
		if (parsed.description) {
			contentParts.push('');
			contentParts.push(parsed.description);
		}
		contentParts.push('');

		const created = await this.app.vault.create(outPath, contentParts.join('\n'));
		this.app.workspace.getLeaf(false).openFile(created);
		return created;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		const existing = (await this.loadData()) ?? {};
		await this.saveData(Object.assign({}, existing, this.settings));
        // Update services if settings changed
		if (this.readwiseService) {
			this.readwiseService.updateToken(this.settings.readwiseToken);
			this.readwiseService.setDebug(this.settings.debugLogging);
		}
	}

	async testReadwiseToken() {
		if (!this.settings.readwiseToken) {
			new Notice('Please set Readwise API Token in settings.');
			return;
		}

		try {
			await this.readwiseService.validateToken();
			new Notice('Readwise token is valid (204).');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Readwise token test failed: ${message}`);
			console.error(error);
		}
	}

    async syncReadwiseData() {
        if (!this.settings.readwiseToken) {
            new Notice('Please set Readwise API Token in settings.');
            return;
        }

        new Notice('Syncing Readwise data...');
        try {
			await this.readwiseService.validateToken();
			const documents = await this.readwiseService.getAllDocuments();
			const filteredDocuments = documents.filter((doc) => this.isTopLevelReadingDocument(doc));
			const filteredIdSet = new Set(filteredDocuments.map((d) => d.id));
			const toRemove: string[] = [];
			for (const book of Object.values(this.dataManager.getData().books)) {
				if (book.source !== 'readwise') continue;
				if (!filteredIdSet.has(book.id)) toRemove.push(book.id);
			}
			if (toRemove.length > 0) {
				await this.dataManager.removeBooks(toRemove);
				if (this.settings.debugLogging) {
					console.log('[Readwise] removed stale books', toRemove.length);
				}
			}
			if (this.settings.debugLogging) {
				console.log('[Readwise] fetched documents', documents.length);
				console.log('[Readwise] filtered documents', filteredDocuments.length);
				if (documents.length > 0) console.log('[Readwise] sample document', documents[0]);
				if (filteredDocuments.length > 0) console.log('[Readwise] sample filtered document', filteredDocuments[0]);
			}
            const data = this.dataManager.getData();
            let newCount = 0;
            let updateCount = 0;

			const toDateKey = (iso: string) => {
				const d = new Date(iso);
				const y = d.getFullYear();
				const m = String(d.getMonth() + 1).padStart(2, '0');
				const day = String(d.getDate()).padStart(2, '0');
				return `${y}-${m}-${day}`;
			};

			for (const doc of filteredDocuments) {
                const existingBook = data.books[doc.id];
				const title = this.getDocumentTitle(doc);
				const tags = doc && typeof doc === 'object' && doc.tags && typeof doc.tags === 'object'
					? Object.keys(doc.tags).filter((t) => typeof t === 'string' && t.trim().length > 0)
					: undefined;
                const book: LocalBook = {
                    id: doc.id,
					title,
					author: doc.author || '',
					category: doc.category || 'reader',
                    source: 'readwise',
                    readwise_id: doc.id,
					tags,
					created_at: doc.created_at || new Date().toISOString(),
					updated_at: doc.updated_at || new Date().toISOString(),
                    cover_url: doc.image_url,
                    reading_progress: (doc.reading_progress || 0) * 100,
                    words_count: doc.word_count,
                    notes_count: doc.num_highlights || 0,
					status: doc.location === 'archive'
						? 'completed'
						: ((doc.reading_progress || 0) > 0 ? 'reading' : 'planned')
                };

                if (!existingBook) {
                    newCount++;
					const nextProgress = Math.max(0, Math.min(100, book.reading_progress || 0));
					if (nextProgress > 0.01) {
						const dateKey = toDateKey(book.updated_at);
						const totalWords = Math.max(0, book.words_count || 0);
						if (totalWords > 0) {
							const deltaWords = (totalWords * nextProgress) / 100;
							const deltaMinutes = deltaWords / 200;
							this.dataManager.addReadingActivity(dateKey, {
								words: deltaWords,
								minutes: deltaMinutes,
								progressPoints: nextProgress,
								events: 1,
							}, book.id);
						} else {
							this.dataManager.addReadingActivity(dateKey, {
								progressPoints: nextProgress,
								events: 1,
							}, book.id);
						}
					}
                } else {
                    updateCount++;
					const prevProgress = Math.max(0, Math.min(100, existingBook.reading_progress || 0));
					const nextProgress = Math.max(0, Math.min(100, book.reading_progress || 0));
					const deltaProgress = nextProgress - prevProgress;
					if (deltaProgress > 0.01) {
						const dateKey = toDateKey(book.updated_at);
						const totalWords = Math.max(0, book.words_count || 0);
						if (totalWords > 0) {
							const deltaWords = (totalWords * deltaProgress) / 100;
							const deltaMinutes = deltaWords / 200;
							this.dataManager.addReadingActivity(dateKey, {
								words: deltaWords,
								minutes: deltaMinutes,
								progressPoints: deltaProgress,
								events: 1,
							}, book.id);
						} else {
							this.dataManager.addReadingActivity(dateKey, {
								progressPoints: deltaProgress,
								events: 1,
							}, book.id);
						}
					}
                }
                this.dataManager.saveBook(book);
            }
            
            this.dataManager.updateLastSync();
            new Notice(`Sync complete. Added ${newCount} books, updated ${updateCount} books.`);
        } catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(error);
			new Notice(`Failed to sync Readwise data: ${message}`);
        }
    }

	isTopLevelReadingDocument(doc: any): boolean {
		const category = typeof doc?.category === 'string' ? doc.category.toLowerCase() : '';
		if (category === 'highlight' || category === 'note') return false;
		if (doc?.parent_id) return false;
		const title = this.getDocumentTitle(doc);
		if (!title) return false;
		if (title.toLowerCase() === 'readwise & reader changelog') return false;
		return true;
	}

	getDocumentTitle(doc: any): string {
		const candidates: unknown[] = [doc?.title, doc?.readable_title, doc?.site_name];
		for (const value of candidates) {
			if (typeof value !== 'string') continue;
			const trimmed = value.trim();
			if (trimmed.length > 0) return trimmed;
		}

		const sourceUrl = typeof doc?.source_url === 'string' ? doc.source_url.trim() : '';
		if (sourceUrl) {
			try {
				const u = new URL(sourceUrl);
				if (u.hostname) return u.hostname;
			} catch {
				return sourceUrl;
			}
		}

		return '';
	}

	private async ensureFolderExists(path: string) {
		const normalized = normalizePath(path).replace(/^\/+/, '').replace(/\/+$/, '');
		if (!normalized) return;
		const parts = normalized.split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private parseReadwiseHighlightsFromMarkdown(markdown: string) {
		const split = markdown.split('## Highlights');
		if (split.length < 2) {
			throw new Error('Не найден раздел ## Highlights');
		}
		const highlightsBlock = split[1];
		const blocks = highlightsBlock.split(/\r?\n---\r?\n/);
		const highlights: Array<{ text: string; comment: string; date: string }> = [];

		for (const block of blocks) {
			const lines = block.split(/\r?\n/);
			const quoteLines: string[] = [];
			const commentLines: string[] = [];
			for (const rawLine of lines) {
				const line = rawLine.trimEnd();
				if (line.startsWith('>>')) {
					const t = line.replace(/^>>\s*/, '').trim();
					if (t) commentLines.push(t);
					continue;
				}
				if (line.startsWith('>') && !line.startsWith('>>')) {
					const t = line.replace(/^>\s*/, '').trimEnd();
					if (t) quoteLines.push(t);
				}
			}

			if (quoteLines.length === 0) continue;

			const dateMatch = block.match(/📅\s*\*?(\d{4}-\d{2}-\d{2}),\s*([0-2]\d:[0-5]\d)\*?/);
			const date = dateMatch ? `${dateMatch[1]}T${dateMatch[2]}:00` : '';
			highlights.push({
				text: quoteLines.join('\n').trim(),
				comment: commentLines.join('\n').trim(),
				date,
			});
		}

		return highlights;
	}

	private buildLinkedHighlightNoteContent(params: {
		bookTitle: string;
		index: number;
		total: number;
		text: string;
		comment: string;
		date: string;
	}) {
		const pad = String(params.index).padStart(3, '0');
		const prevLink = params.index > 1 ? `[[${params.bookTitle} — ${String(params.index - 1).padStart(3, '0')}]]` : '';
		const nextLink = params.index < params.total ? `[[${params.bookTitle} — ${String(params.index + 1).padStart(3, '0')}]]` : '';
		const titleRaw = (params.comment || params.text.slice(0, 50)).trim();
		const title = titleRaw.replace(/\r?\n/g, ' ').slice(0, 200);
		const quote = params.text
			.split('\n')
			.map(l => l.trimEnd())
			.filter(l => l.length > 0)
			.map(l => `> ${l}`)
			.join('\n');

		let content = `---\n` +
			`type: highlight\n` +
			`book: [[${params.bookTitle}]]\n` +
			`index: ${params.index}\n` +
			`date: ${params.date}\n` +
			`title: ${title}\n` +
			`---\n\n` +
			`${quote}\n`;

		if (params.comment) {
			content += `\n\n${params.comment}\n\n## Связи\n`;
			if (prevLink) content += `← ${prevLink}\n`;
			if (nextLink) content += `→ ${nextLink}\n`;
			content += `[[${params.bookTitle}]]\n`;
		}

		return content.trim();
	}

	async migrateReadwiseBookNotesToLinkedHighlights() {
		const sourceFolder = normalizePath(this.settings.readwiseBooksFolder || '').replace(/^\/+/, '').replace(/\/+$/, '');
		const destRoot = normalizePath(this.settings.readwiseLinkedHighlightsFolder || '').replace(/^\/+/, '').replace(/\/+$/, '');
		if (!sourceFolder || !destRoot) {
			new Notice('Please set Readwise folders in settings.');
			return;
		}

		await this.ensureFolderExists(destRoot);

		const allMarkdown = this.app.vault.getMarkdownFiles();
		const sourcePrefix = `${sourceFolder}/`;
		const sourceFiles = allMarkdown.filter((f) => f.path === sourceFolder || f.path.startsWith(sourcePrefix));

		if (sourceFiles.length === 0) {
			new Notice(`No markdown files found in ${sourceFolder}`);
			return;
		}

		new Notice(`Migrating Readwise notes: ${sourceFiles.length} files...`);

		let created = 0;
		let skipped = 0;
		let errors = 0;

		for (const file of sourceFiles) {
			try {
				const bookTitle = file.basename;
				const outDir = normalizePath(`${destRoot}/${bookTitle}`);
				await this.ensureFolderExists(outDir);

				const md = await this.app.vault.read(file);
				const highlights = this.parseReadwiseHighlightsFromMarkdown(md);
				const total = highlights.length;
				if (total === 0) continue;

				for (let i = 1; i <= total; i++) {
					const h = highlights[i - 1];
					const outPath = normalizePath(`${outDir}/${bookTitle} — ${String(i).padStart(3, '0')}.md`);
					const existing = this.app.vault.getAbstractFileByPath(outPath);
					if (existing instanceof TFile) {
						skipped++;
						continue;
					}
					const content = this.buildLinkedHighlightNoteContent({
						bookTitle,
						index: i,
						total,
						text: h.text,
						comment: h.comment,
						date: h.date,
					});
					await this.app.vault.create(outPath, content);
					created++;
				}
			} catch (e) {
				errors++;
				if (this.settings.debugLogging) console.error(e);
			}
		}

		new Notice(`Migration complete. Created ${created}, skipped ${skipped}, errors ${errors}.`);
	}
}

class ReadwiseTrackerSettingTab extends PluginSettingTab {
	plugin: ReadwiseTrackerPlugin;

	constructor(app: App, plugin: ReadwiseTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Readwise Tracker Settings'});

		new Setting(containerEl)
			.setName('Readwise Access Token')
			.setDesc('Your API token from https://readwise.io/access_token')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.readwiseToken)
				.onChange(async (value) => {
					this.plugin.settings.readwiseToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debug logging')
			.setDesc('Log Readwise requests and statuses to the developer console')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugLogging)
				.onChange(async (value) => {
					this.plugin.settings.debugLogging = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Readwise books folder')
			.setDesc('Folder with markdown files created by the Readwise official plugin (books).')
			.addText(text => text
				.setPlaceholder('Readwise/Books')
				.setValue(this.plugin.settings.readwiseBooksFolder)
				.onChange(async (value) => {
					this.plugin.settings.readwiseBooksFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Linked highlights folder')
			.setDesc('Destination folder for linked highlight notes (one subfolder per book).')
			.addText(text => text
				.setPlaceholder('Readwise/Highlights')
				.setValue(this.plugin.settings.readwiseLinkedHighlightsFolder)
				.onChange(async (value) => {
					this.plugin.settings.readwiseLinkedHighlightsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Inbox folder')
			.setDesc('Destination folder for notes created from highlights in Readwise Stats.')
			.addText(text => text
				.setPlaceholder('Inbox/Readwise')
				.setValue(this.plugin.settings.readwiseInboxFolder)
				.onChange(async (value) => {
					this.plugin.settings.readwiseInboxFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test Readwise Token')
			.setDesc('Performs GET https://readwise.io/api/v2/auth/ (expects 204)')
			.addButton((btn) =>
				btn
					.setButtonText('Test')
					.onClick(async () => {
						await this.plugin.testReadwiseToken();
					})
			);
	}
}

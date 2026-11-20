# Book workspace

Open it with **Detailed review** on a selected book in the highlights sidebar, or with the command **Readwise Reading Tracker: Open book workspace**.

## Working in the workspace

- The note at the reading line becomes active as you scroll. Thoughts, dialogs and links are shown as continuous lists; scrolling any area brings the related notes and text into view in the others. Programmatic scrolling never hands control back.
- The reading line runs through the middle of the area. The first note starts centered; padding at the edges lets you return to the first and last note. Highlight cards are spaced 104 px apart.
- The full text opens on the left; one of three panels opens on the right. A divider changes the width. You can collapse the notes and keep the text and a thought side by side. On a narrow screen the open areas stack vertically.
- Vertical rails are labelled "Text", "Thoughts", "AI" and "Links"; collapsed notes are labelled "Notes". The text rail stays visible while a book is open: pressing it again collapses the text. The right panels work the same way.
- The `+` button creates a thought or a dialog for the current note. A thought contains only text. The link button turns on selection of additional sources; there are no checkboxes in normal mode. You can add a source from another part of the vault and remove an existing one.
- A link to another text carries its title, author and your own explanation of the connection. Following it opens the workspace of the chosen text; the arrow at the top returns to the previous one. Obsidian files are used in place.
- Going back restores the original note in focus, the open panels, their widths and the list positions. Incoming links show the text they came from.
- The star on a thought or dialog card marks it as important so you can return to it later: a yellow bar appears on the left, and the star in the panel header leaves only the important items in the list. The mark is stored in the `rwt_important: true` property and is removed by pressing the star again.
- Dialogs are read from Markdown. A question is saved as a draft and sent through the Codex Bridge plugin (Cmd/Ctrl+Enter). All questions about a book go to one persistent Codex thread: it remembers earlier questions and answers, and only quotes and comments are passed from the notes. The thread is kept in the Codex history; its id is stored in `Workspace/Chat.md`, which also holds the whole feed: questions and answers from note dialogs are duplicated into it with a link to the source dialog. The feed opens with the "Book chat" button in the "AI" panel. If the thread is lost, a new one is created and the feed is retold to it. Codex Bridge with `runInThread` is required; with an older Bridge the previous mode without thread memory still works. Old Q/A remain inside the highlights.
- Changes are saved after a 450 ms delay, on losing focus and before switching to another document. If an external edit conflicts, a separate `— conflict-<id>.md` file is saved and the original is left untouched.

## Data

Paths come from the current settings. Old highlights and the Inbox are not migrated. New objects are stored in the book's existing highlights folder:

```text
Workspace/
  Thoughts/<first line> — <short ID>.md
  Dialogs/<name> — <short ID>.md
  Links/<name> — <short ID>.md
  Source/source.md
  Source/content.md
```

If a new document has no folder yet or its title is ambiguous, the folder gets a document-identity suffix. Its path is then stored in `source.md`. Editing the first line of a thought does not rename the file.

`rwt_id` is the UUID of the new object, `rwt_kind` is `thought`, `dialog` or `relation`, and `rwt_document` is the document identity. `rwt_sources` holds the full set of wikilinks, and `source` keeps the first source for compatibility. `book`, `type` and `created` keep their previous meaning. A link carries `rwt_target`. A thought spanning several books physically stays where it was created and is found from the other books through backlinks. The index is rebuilt from Markdown; mirror links are not written into the original highlights.

Dialog messages have readable headings with the role and time, a stable block ID, visible links and a service comment with a per-message snapshot of the sources and the text version. Changing a dialog's sources does not change the origin of older messages. `rwt_draft` holds an unsent question.

`source.md` contains the Reader ID, wikilinks to the original and to the readable text, a SHA-256 hash and quote locators. An ambiguous quote requires choosing a match or binding it to a paragraph manually. Reader offsets only rank the candidates; they are never used as Markdown offsets. When the text changes, earlier binding information is kept in the locator history. Renames update managed links through vault events.

`data.json` keeps the settings, statistics and `workspaceImports`, an import-state log with the hash, original path and received Reader IDs. The text of thoughts, dialogs and persistent links is not written there. The owners of settings, statistics and the log save only their own fields through a shared write queue.

## Full text and import

The source is resolved on demand: a text or original linked in the vault → the `Full Document` link of the official export → Reader API with `withHtmlContent`/`withRawSourceUrl` → manual file choice. A fetched text is available offline. A temporary source URL is not saved as a source link.

The text, the prepared quote index and the link graph are reused while scrolling. The cache is refreshed when the file, a quote or a manual binding changes. A book that is already open stays visible during the background check. Initial processing of long HTML and normalisation run in chunks; a hung Reader network request is abandoned by the interface after 15 seconds. A retry does not create a parallel request while the previous one is still running.

Search accounts for Markdown formatting, links, typographic quotes, HTML entities and PDF word hyphenation. For differences in punctuation only, a continuous sequence of all the words of the quote is checked; words are never skipped. Repeated fragments stay ambiguous and require a choice.

Highlights made of images alone are matched by address, and when Reader addresses differ, by the SHA-256 of the file content. The figure caption and neighbouring quotes only set the search order. The check runs in the background for the current note and stops when focus changes; the book stays visible. Verified hashes (`rwt_image_hashes`) and found locators are saved in `Source/source.md`, so jumping again needs no image downloads. An unavailable or changed image can be bound manually. After late image loading the position of the active fragment is corrected; manual scrolling cancels this immediately.

When you scroll manually up and down, the position of the text being read is preserved while blocks above the screen change height. An empty intermediate Markdown render does not replace a block's known height; the sizes of already loaded images are reused within the session. Changing the active note does not pull a manually scrolled book to its quote.

Simple tables from HTML and EPUB are saved as Markdown tables; merged cells and complex structure are saved as cleaned HTML inside Markdown. A table is never split into virtual paragraphs, however large. Wide tables scroll horizontally inside the panel. In previously prepared text, tables are restored by exact unique matches with the original or Reader; other edits are kept. A new version of the text is created, the previous file stays in place, and `rwt_table_format` marks the processing version. Restoration runs in the background and is cancelled by manual scrolling of the book; it can be repeated with the "Refresh text and tables" button. Ordinary user Markdown files are not regenerated.

Originals of new uploads are saved to `<highlights folder>/_Assets/<sha256>.<ext>`. An existing original with the same content is reused, including when it was previously linked from another vault folder. Attaching a file to a book does not create a new Reader document. Ready Markdown/TXT is read directly from the source file.

The existing context menu uses the same import. Reader IDs are written before tags and synchronisation. A retry after an error continues processing the document that was already created. After an unknown request result, Reader is checked first: for a file the source hash is confirmed, for a link its URL. While creation is unconfirmed, no second upload request is sent. The local original stays available. TXT/Markdown/HTML get a stable URL based on the content hash.

HTML is sanitised with DOMPurify and converted with Turndown. EPUB is unpacked asynchronously and read in spine order; images are saved to `_Assets`. PDF.js extracts text page by page in a local worker; the worker, CMaps and fonts are bundled into `main.js`, so no internet access is needed to load them. A PDF without a text layer can be opened in its original form or supplemented with a text file; OCR is not part of this release. A modified full text is saved as a new version instead of overwriting manual edits.

## Verification

`npm run check` runs ESLint, the tests and the build. The tests cover compatibility with old YAML, graph recovery, several books and sources, renames, deletion, conflicting drafts, preservation of message snapshots, the source cache, export priority, deduplication of originals and resuming an import after an error.

AI answers use the installed Codex Bridge plugin: without it, viewing and editing work, but sending is unavailable. There are no new API keys and no separate server. Quotes and comments from notes are sent to OpenAI through Codex.

The question field, the attached notes and the action button are gathered in one block. Send, stop and retry occupy the same place on the right; after an error the question stays available for resending. A long draft scrolls inside the field. In the shared book feed the field is pinned to the bottom and the history scrolls separately, without forcibly returning to the newest answer. A finished answer can be copied or saved as a thought. When a dialog is created, the quote is passed through the linked sources and is not duplicated in the question field.

When new highlights are sorted out and a copy is created in the Inbox, the flat text of a table is matched with the prepared book text. Markdown keeps the whole table or exactly the selected complete rows, without adding unselected values. Plain text, corrected values and ambiguous structure stay as they were. Existing highlight files are not rewritten; while the book text is open, the workspace may show their tables in restored form.

## Web and Readwise for Codex

By default Codex answers only from the text it is sent. To let it open links and sources itself:

1. In Codex Bridge, turn on **Allow full access for plugins** and, if you need Readwise, enter the name of its MCP server in **MCP servers allowed for full access** (in the Bridge settings, the **MCP servers** section: **Add Readwise** adds the official Readwise server, **Sign in** signs in through the browser).
2. In the tracker settings, turn on **Let AI search the web and use Readwise**.

Only web search and the listed MCP servers are enabled; other MCP servers (browser, computer control and the like), shell and files stay off, and use of a forbidden tool stops the request. The text of books and web pages can try to steer Codex, so this mode is off by default.

# Book space

Interactive mock-ups of a new Readwise Reading Tracker mode. This is an interface proposal for discussion and later implementation, not an installed plugin feature. The books, authors, fragments and AI answers in the example are made up. The mock-up does not call Reader, an Obsidian vault or an external model.

Open `index.html` in a browser. Nine buttons above the window switch between ready-made states; inside each screen the rails, two-way scrolling, source adding, fragment links, thought editors, demo dialogs and jumps between texts all work. Drafts are saved locally in the browser. Created thoughts are not written to a vault.

| Screen | What it shows |
| --- | --- |
| Notes | The note closest to the centre of the reading area is active. Focus changes automatically while scrolling. |
| Context | The book text and the notes share the width equally. The book fragment follows the note in focus. |
| Thoughts | A continuous list of text areas without headings. Scrolling works in both directions. |
| Focus on a thought | Notes are collapsed on the left, the editor takes the main area. |
| Text + thought | The book text is open instead of the notes; the editor stays on the right. |
| AI dialog | A continuous list of conversations. The dialog in focus brings the related notes into view on the left. |
| Linked texts | Short cards for an article, a book and an Obsidian note, without the full text. |
| Another text | A new current text, updated notes and a visible path back to the source link. |
| Add notes | The binding mode is switched on from a thought. Checkboxes appear only here; already linked sources are kept. |

Also: the origin chain, a compact screen, the light theme, adding to an AI dialog, adding to a linked book, and a right-hand scroll bringing the note on the left into view. [Validation results](VALIDATION.md).

## Layout rules

Initial state: `Text [rail] | Notes [main area] | Thoughts [rail] | AI [rail] | Links [rail]`.

When the text is expanded: `Text [½] | Notes [½] | Thoughts | AI | Links`. The halves are computed after subtracting the width of the rails.

When a right-hand section is expanded: `Text | Notes [½] | Right section [½] | other rails`. One of "Thoughts", "AI" and "Links" is open at a time. Opening a new section collapses the previous one while keeping its data. Ordinary expansion on the right collapses the text on the left: the basic scenario has two working panels.

The expand button on the right collapses the notes into a separate left rail. The two-column icon or a link to the source replaces the notes with the text: `Notes [rail] | Text [½] | Right section [½] | other rails`. Returning through the "Notes" rail restores the notes next to the right panel. Closing the right panel returns to the initial view. The three actions on the right are shown as icons only: expand, open the text alongside, close. They keep accessible names and tooltips.

On a large screen a rail is 45 px wide, in the compact variant 34 px. Resizing between two open areas is expected in the implementation. In the mock-up the ratio can be changed through the visual preview settings, if available. On a narrow screen the rails become horizontal buttons and the open panel sits above the notes. This is an adaptation for viewing the concept; the main target is desktop Obsidian.

## Two-way scrolling

Each right-hand panel holds a continuous list of objects of the current book: all thoughts, all dialogs or all linked texts. Neighbouring objects stay in the list so they can be browsed with ordinary scrolling. The active object is marked with a thin line; there are no extra switches or mode labels.

Scrolling the notes on the left brings the corresponding object on the right into view. Scrolling any right-hand panel picks the object at the reading line in the upper third of the area, changes the shared active note and smoothly brings it into view on the left. An open book text updates to the matching fragment, including in "Text + thought" mode. Collapsed panels keep their layout and receive the current context when expanded.

If an object has several sources, the current note is kept when it belongs to that link. Otherwise the nearest source in the order of the book's notes is chosen. Moving between two right-hand objects with the same source does not move the left area unnecessarily. Scrolling never adds or removes links.

The last area in which the user started scrolling becomes the leader. Driven programmatic scrolls are marked and do not trigger a reverse synchronisation. A wheel, touch, scrollbar drag or keyboard scroll in another area hands control to it and interrupts the previous motion. This prevents a "right → left → right" loop and lets the direction change immediately. With `prefers-reduced-motion`, driven areas jump to the source without animation.

## Working with notes and thoughts

In ordinary reading there is no need to pick a note by hand. While scrolling, the visible note whose centre is closest to the middle of the notes area becomes active; at the start and end of the list the first and last notes are reachable. Activity is shown by a thin accent line. The book text, thoughts, AI dialogs and linked texts all follow the focus at once. Ordinary reading has no checkboxes, focus labels or preselection actions.

The "+" icon in the notes creates a thought whose only source is the current note. A thought contains just a text area and is saved as you type. There is no separate title field, no save button and no repeated explanations. All thoughts are available in the right-hand list, including several thoughts of one note. Scrolling on the left brings the linked thought into view; scrolling on the right brings the source note into view. The text fields themselves stay in the DOM and keep their content and cursor.

The "+" icon next to the sources of a thought, dialog or text card turns on adding notes to exactly that object. If the notes were collapsed, they expand alongside. The meaning of the buttons is available through tooltips and screen-reader names.

Already linked notes are marked by checkboxes that cannot be chosen again. New marks are only a preselection. The "Add · N" button merges them with the existing sources without duplicates; "Cancel" removes the preselection without changes. After finishing, the checkboxes disappear. Only during this mode does scrolling not switch the right-hand object: this lets you choose its additional sources. After finishing, ordinary following of focus resumes. A thought, a dialog and each link have independent sets of sources.

You can jump to any of the sources while still seeing the editor on the right. The text is kept when collapsing, changing the panel, reloading and moving on to other work. Autofocus, a thought's sources and the temporary set being added are separate states.

The mock-up uses a collection of thoughts with stable IDs, text and an array of sources. A shared thought is available from every linked note. Adding a source keeps the same object and makes it chosen for the new note; when moving between sources of one thought, the editor is not recreated. The previous mock-up state migrates into the new collection with text and links preserved. In the plugin, a Markdown file can be named after the first line of the text without a separate input field. File conflicts and vault synchronisation are not modelled.

Panels keep their sizes, and the lists of notes and right-hand objects stay the same DOM nodes. The active highlight adds no lines and does not change object heights. A small 24 px threshold and a 75 ms delay prevent flipping back and forth at a boundary. Driven areas scroll smoothly; only the book fragment changes with a short opacity transition and a 4–5 px shift. The animation respects `prefers-reduced-motion`; old layers are removed. Positions and drafts are saved.

## AI and linked texts

A dialog belongs to a note and may have several sources. Each conversation is a separate block in the shared list, with its own history and question field. Moving within a long conversation keeps its sources; moving to another conversation by scrolling changes the active note on the left. The text of an unsent question and the history are saved separately for each conversation. An additional note gains access to the same dialog, and other conversations are kept. Compact links to all sources are visible before the conversation. Saving an answer as a thought inherits the full set of sources and a link to the original conversation. Answers in the mock-up are generated locally from a template.

In "Links" every item has a type, a title, an author, a short description, the reason for the link and links to the sources. There is no full text here. All items of the current book are in one list. The card in focus guides the left area to the source notes; scrolling the notes brings the linked card on the right into view. Adding sources starts from a specific card: its title is shown above the notes list, and the card itself is marked with an accent line. Until confirmed the object is pinned; neighbouring links do not change.

"Work with the text" makes an item the current document: the text, notes, thoughts, dialogs and links all change. The original book and the link through which the jump was made appear at the top. Returning restores focus, the scroll position and the open panel. The navigation stack allows several consecutive jumps. Navigation history and persistent links are different entities: closing a window must not delete the origin.

## End-to-end provenance

The path icon in the book header or next to the editor reveals the provenance chain. The permanent text line listing the whole chain has been removed. A thought made from several notes shows separate branches, each with its own fragment and position in the book. The recommended model for implementation:

```ts
type SourceAnchor = {
  id: string;
  documentId: string;
  highlightId?: string;
  vaultPath?: string;
  blockId?: string;
  locator?: { type: 'epub-cfi' | 'pdf-page' | 'reader-location'; value: string };
  quote: string;
  prefix?: string;
  suffix?: string;
};

type Thought = {
  id: string;
  documentId: string;
  vaultPath: string;
  sourceAnchorIds: string[];
  parentThoughtIds: string[];
  conversationId?: string;
};

type TextRelation = {
  id: string;
  fromDocumentId: string;
  toDocumentId: string;
  fromThoughtIds: string[];
  sourceAnchorIds: string[];
  kind: 'develops' | 'contrasts' | 'applies' | 'associates';
  explanation: string;
};
```

A link to a book does not replace a link to a fragment. The position together with the quote and the surrounding text makes it possible to restore the context after changes. With several sources an array of links is stored. When the source note is deleted, the thought keeps the ID, the quote and the book details; the interface shows the unavailable source and lets you rebind it.

## Implementation in the current plugin

- Entry point: a "Work with the book" action in the current book list and notes view. Open the new space in the main `WorkspaceLeaf` using a separate `ItemView`, and keep the current view on the right available.
- The notes view and the Markdown rendering can be reused from `src/ui/StatsView.tsx`; layout state should be separated from the data of thoughts and links. The open right-hand panel is a single field `thought | ai | links | null`, not three independent flags.
- Separate `activeNoteId`, the sources of each object and `pendingSourceIds`. Compute autofocus relative to the notes scroll container, updating only the dependent context. Do not recreate the list, the editor or the input on every scroll event; keep the position and the typed text. The adding mode must store the ID of the object and of the source dialog independently of the note currently in focus.
- For two-way synchronisation, store the leading area and the marks of programmatic scrolls. Updating a driven area must not become a user action again. Hand over control on a new gesture, clear the pending focus of the previous area and keep the original object IDs regardless of their position on screen.
- The existing template `src/services/readwiseInboxNoteTemplate.ts` stores a single `book` and `source`. For the new scenario, add arrays of sources and stable IDs while keeping old notes readable. Do not silently replace existing properties.
- The current `LocalBook` limits the source to Readwise. Articles and local texts need a document adapter with sources `readwise | obsidian` and a shared stable ID. Do not tie every kind of material to a mandatory `readwise_id`.
- The full text of a book and an exact jump to a fragment need a separate content adapter and locators. A Reader link on its own does not mean the plugin can already read the full text inline. Until a way of obtaining the content is chosen, this remains a separate technical task.
- When the full text is unavailable, keep two panels and an explicit "Text unavailable" state with an "Open in Reader" action; the quote must not be substituted for the full text. For PDF and EPUB, provide different locators and views.
- Store thoughts as vault Markdown files; index links by stable IDs and Obsidian block links. Resolve renames through the metadata cache. Store navigation and panel sizes separately from the content.
- The AI provider, the amount of context sent and the model connection are not chosen in the mock-up. Before requests are sent, the interface must clearly show the sources used. States for running, errors and resending with the typed question kept are needed.

## Visual direction

Flat surfaces, thin dividers, narrow rails without decorative cards. A calm green accent marks the active context and links. The interface and the editor use the system font; book fragments and item titles use Georgia. The general labels "Workspace" and "End-to-end links", scrolling instructions, repeated source captions and the thought title field have been removed. The light and dark palettes are defined through `light-dark`; in the plugin they need to be mapped to Obsidian variables. Icons are available without hovering; buttons have names for the keyboard and screen readers, and tooltips.

## Files

- `workspace.fragment.html` — the editable source of all screens, styles and demo interactions.
- `index.html` — the standalone preview; after changing the fragment, rebuild it with `node docs/design/book-workspace/build.mjs` from the project root.
- `icons.js` — a local build of the Lucide icons in use (ISC); `LUCIDE-LICENSE.txt` is the licence.

This proposal does not change the plugin's working files.

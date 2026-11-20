# Readwise Reading Tracker 1.3.3

Follow-up to 1.3.2 after the Obsidian plugin review.

- The note editor no longer assigns inline styles directly: it measures its height through a CSS class and publishes the result as a CSS variable (`--rwt-editor-height`), so the text area still grows with its content.
- The timer helper no longer touches `globalThis`; it uses the plugin's window (or Node's timers in tests).
- Release assets keep their GitHub build-provenance attestations (`gh attestation verify main.js --repo free-solo-lab/obsidian-readwise-tracker`).

## Installation

Download `main.js`, `manifest.json` and `styles.css` from this release and place them in:

```text
.obsidian/plugins/readwise-reading-tracker/
```

Restart Obsidian or reload the plugin after replacing the files.

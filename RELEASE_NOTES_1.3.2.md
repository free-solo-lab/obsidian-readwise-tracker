# Readwise Reading Tracker 1.3.2

Maintenance release following the Obsidian plugin review.

- The submit shortcut hint uses Obsidian's `Platform` API instead of sniffing the browser.
- Timers and animation frames use the window the plugin is running in, so the workspace works in popout windows.
- The note editor sizes itself with `setCssProps`; table wrappers are created with Obsidian's DOM helpers; selection checks work across windows.
- Sync errors are always thrown as `Error` objects.
- Releases are now built and published by GitHub Actions from the committed lockfile, with build-provenance attestations (`gh attestation verify main.js --repo free-solo-lab/obsidian-readwise-tracker`).
- Math formulas in AI answers render without regex lookbehind, so they also work on older iOS.
- AI features look for Codex Bridge under its new id, `free-solo-codex-bridge` (see 1.3.1).

## Installation

Download `main.js`, `manifest.json` and `styles.css` from this release and place them in:

```text
.obsidian/plugins/readwise-reading-tracker/
```

Restart Obsidian or reload the plugin after replacing the files.

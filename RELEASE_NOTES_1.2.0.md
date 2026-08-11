# Readwise Reading Tracker 1.2.0

Version 1.2.0 adds a complete reading-focus and planning workflow on top of the existing progress dashboard.

## Reading focus and planning board

- A new Board view groups books by direction and Reader state: **To Read**, **In Progress**, and **Done**.
- Every direction row shows its book count in each state, even while collapsed.
- Expand a direction to put it in focus and reveal its books. Several directions can be focused at the same time.
- Non-focused directions remain compact, keeping large libraries easy to scan.
- Drag directions to set their global priority.
- Drag books within a direction to set their reading priority—no manual priority fields are needed.
- Move books between columns to update Reader Later, Inbox, and Archive.

![Planning board](https://raw.githubusercontent.com/free-solo-lab/obsidian-readwise-tracker/1.2.0/assets/img/planning-board.png)

## Gantt reading plan

- A new Gantt view turns focused directions into a sequential reading plan.
- Scheduling uses each book's remaining reading time and an observed or manually configured daily reading pace.
- The start date and minutes per day can be changed directly above the timeline.
- Direction and book order are shared with the Board, so drag-and-drop priority immediately affects the schedule.
- Books already in **Done** are excluded from the Gantt plan.
- Collapsed directions stay out of focus until expanded.

![Gantt reading plan](https://raw.githubusercontent.com/free-solo-lab/obsidian-readwise-tracker/1.2.0/assets/img/gantt-plan.png)

## Dashboard improvements

- Added a one-click **Clear filters** action.
- Added date-range filtering.
- Added subtle inactivity labels such as `Unread · 20 days` for in-progress books with no reading activity for more than two weeks.
- Improved alignment, compact direction rows, and state counts across planning views.

## Reader synchronization and reliability

- Reader location changes are now persisted locally until confirmed by synchronization.
- Moving a book to Done no longer allows stale sync data to return it to In Progress after reopening Obsidian.
- Plugin data writes are serialized to prevent settings and book updates from overwriting one another.

## Release quality

- Removed unused `axios`, `uuid`, and `builtin-modules` dependencies.
- Replaced the Node.js HTTPS implementation with Obsidian's `requestUrl` API.
- Fixed Promise handling, popout-window compatibility, unsafe typing, and callback binding warnings reported by Obsidian Review.
- Removed CSS `!important` declarations and strengthened pre-release lint checks.
- Production dependency audit reports zero known vulnerabilities.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from this release and place them in:

```text
.obsidian/plugins/readwise-reading-tracker/
```

Restart Obsidian or reload the plugin after replacing the files.

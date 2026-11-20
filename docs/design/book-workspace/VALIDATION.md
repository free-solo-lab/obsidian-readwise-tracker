# Mock-up validation

Local standalone preview, headless Chromium.

- All three right panels are continuous lists. Scrolling on the right changes focus and smoothly scrolls the notes on the left; scrolling on the left brings the related object into view on the right.
- Editors are not recreated during synchronised scrolling; the text of thoughts and the current position survive navigation and reload.
- With several sources, the current note is kept if it is already linked; otherwise the nearest one in order is chosen. Navigation never changes the links themselves.
- In "Text + thought" mode, scrolling on the right changes the book fragment on the left while keeping the chosen layout.
- The dialog list keeps separate histories and unsent questions; sending in one conversation does not affect the others.
- The source-adding mode temporarily pins the object and does not rebind it while scrolling. After confirmation, two-way synchronisation resumes.
- Real wheel scrolling down and up was checked. Driven scrolls do not trigger a reverse synchronisation: the panels do not loop and do not take control from each other.
- Checked at 1440, 1024, 736, 390 and 320 px, in the light theme and with reduced motion. There is no horizontal overflow.

JavaScript errors: 0. AI answers are a local demonstration.

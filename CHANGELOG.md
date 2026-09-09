# Changelog

Release notes for Headway. Each version gets one `## <version>` section, written
during the release; the GitHub release body and the in-app "What's new" dialog
both come from the matching section here. Newest first.

Format: short sections, bullets, one bold title per notable change —
`**Feature title**: a short, impactful description and use case.`

## Unreleased

### New

- **Story numbers**: every story has a # from the same pool as features; it shows on every row and card and edits in the story panel.
- **Story dependencies**: a story can depend on any other story. Add one in the story panel's Dependencies section (by # or name) or drag a story bar's edge circle onto another story; arrows and order warnings work like features; links push to Jira and the Stories sheet carries them.
- **Flags**: right-click any feature or story → **Flag…** (optional reason) to mark it for attention; an orange flag takes the alert slot on the row (hover for the reason) and shows on Prioritizing cards, Sprinting rows and the panel header. **Edit flag…** / **Unflag** from the same menu. The AI assistant can set `flag` too.
- **Titles rename on double-click**: on Planning and Prioritizing the feature and story titles are text, like Sprinting. Double-click one, or pick **Rename…** from its context menu, to edit; a single click just selects, and dragging from the title moves the row. Scoping keeps its spreadsheet cells.
- AI assistant: Markdown tables in replies render as tables.
- ⌘B / ⌘I (Ctrl+B / Ctrl+I) bold and italicise inside every rich text field.
- Prioritizing: the board is full width; **Columns → Unset column** hides or shows the catch-all column; clicking a card opens the detail panel on it and clicking the same card again puts the panel away.
- Sprinting: the main content area is capped at a readable width.
- Prioritizing swimlanes: the catch-all lanes (the default workstream, "No epic") sit last.
- Prioritizing: an empty column or swimlane cell says "No items".
- Right-clicking the app background no longer opens the theme menu (the theme lives in Settings and the app menu).

## 1.0.12 — 2026-09-09

### New

- **Item types and hierarchy**: every epic, feature and story carries a type (Feature, Bug, Task, Story, Subtask, Epic by default). Add your own types and colors in Setup → Hierarchy, rename the three levels, choose which types each level accepts, or allow any type anywhere. Pick a type from the panel, the context menu or Edit epic; rows show an icon for non-default types.
- **Type glyphs and color by type**: the colored square left of every title is now the item's type icon (Feature keeps the filled square, Story is a bookmark) in the active color. **View → Color by item type** colors bars by type.
- **Tags**: features and stories carry free-form labels, edited in the panel's Tags section (Enter or a comma adds one; the box suggests tags already in the document). Filter by tag with `#tag`. Tags survive the Excel round trip, push to Jira as labels, and the AI assistant can read and set them.
- **Links in rich text**: any URL typed into a description or scope field renders as a link; ⌘-click (Ctrl-click on Windows/Linux) opens it in the browser. The stored text stays plain.
- **Insert story above / below**: right-click a story on the row, the card, the sprint row or the panel to insert a blank story next to it, ready to edit. Features had this already.
- **Duplicate story**: every story context menu can copy a story in place.
- **Zero and half-point stories**: the story Fibonacci scale starts at 0 and 0.5. A 0-point story is real work with no effort (a placeholder, a spike already done, tracking-only) — it counts 0 toward sprint totals but still takes a day on the timeline.
- **Jira issue types per Headway type**: sync and CSV export use each type's Jira issue type. The three fixed type fields in Setup → Jira become a per-type table; existing documents keep their previous names.

### Improved

- **Sprinting rows belong to one sprint**: a row sits only in the sprint it starts in, with an ⓘ glyph saying how many sprints it carries over. Rows wear sprint number, epic, workstream and assignee chips and drop the duration, date-range and phase columns; empty sprints at either end are hidden.
- **Sprinting context menu**: right-click a feature or story for **Move to sprint…** and **Assign…**. Titles are plain text; double-click or Rename to edit.
- **Add only where empty**: the Add feature / Add story buttons and rows show only in an empty phase, sprint section, Prioritizing column or story list. Everywhere else, right-click and use Insert above/below, so full lists stay compact.
- **Prioritizing board**: the Fields menu can hide any card chip (Size, Priority, Risk, Duration, Epic, Workstream) and always offers Priority and Risk even when the columns are by that field; the toolbar filters by phase like Sprinting; milestones no longer appear on the board.
- **AI assistant edits only what changed**: a write applies just the items the assistant added, edited, deleted or reordered, so the screen no longer flashes a reload and edits you are making are never overwritten. The assistant can also read and set item types.
- **AI model picker**: the drawer loads the gateway's models when opened and the effort levels a model supports when you pick one, switching to Medium when the current level is not offered.
- **Right panel order**: Estimate, then People, then Tags.
- **Milestones carry no size or priority**: converting an item to a milestone clears both, and the panel, timeline and Scoping table show no size or priority controls on milestone rows.
- **Desktop reload only with Auto save on**: the open file reloads after external changes only while Auto save is on, so unsaved edits are never replaced.
- Settings → Jira: issue-type icons match the rest of the UI.

### Fixed

- The story panel's Size, Priority and Risk buttons did nothing.
- Sprint totals show story counts until a story is sized, instead of a misleading 0.
- Reporting's Delivery-by-sprint counts a feature in every sprint it spans.
- Focusing and leaving a rich-text field that contains a URL no longer records a spurious edit.
- Story-view sprints whose features have no visible stories no longer render empty.
- Size day repair handles null values; story-only sizes fall back correctly in the size order.
- Excel export: the band fill no longer covers the Tags column.

## 1.0.11 — 2026-09-08

### New

- **Automatic updates**: the desktop app checks for a new release on launch and every hour, downloads it in the background, and offers an Update button in the header and on the start page — one click installs and relaunches. A **Check for updates** button on the start page checks on demand.
- **What's new dialog**: release notes open once after each update so you see what changed; click the version number on the start page to read them again.
- **Apps switch**: Setup → Apps turns each header tab on or off per project, so a plan that never budgets or scopes shows only the views it uses. Planning always stays and hidden data is kept.
- **Prioritizing by field**: a Columns dropdown lays feature cards out by Priority, Size or Risk instead of phase, plus an Unset column — drag a card between columns to set the value.
- **Story board**: the Prioritizing page's Story level shows one card per story, with its feature named above the title, in columns of Priority, Size or Risk. Drag to set the field; Group, Sort and the filters all work per story.
- **Sprinting filters**: narrow the sprint page by text, phase, epic and workstream; sidebar and section counts follow.
- **Acceptance criteria column**: a built-in column right after Description that shows on stories only by default, so criteria live next to the story instead of in a custom field.
- **Priority colors**: Must/Critical reads bright red, Should/High orange, Could/Medium green and Won't/Low gray — in chips, the panel's picker and dropdown dots, and on bars when coloring by priority.

### Improved

- **Disk reload keeps your place**: when the open file changes on disk, only the data refreshes — your view, selection, scroll position, open dialogs and focused field all survive.
- **AI effort follows the model**: the drawer offers only the effort levels the gateway says the model supports and hides the control for models without any; long gateway model ids show as short names with the full id in a tooltip.
- **Hollow milestone markers**: diamond, star and circle markers are now outlines that stay legible in any color, and milestone titles read bold in the left pane.
- **Unscheduled last**: the Sprinting sidebar lists every sprint first and Unscheduled at the end.

### Fixed

- **Corporate TLS inspection**: the desktop app now trusts the OS certificate store, so AI, Jira and update checks work behind Netskope or Zscaler proxies.

### Removed

- **Timeline-only preview**: the expand button in the phase lane is gone; collapse the left pane and the panel instead.

## 1.0.10 — 2026-09-07

### New

- **AI assistant**: ask questions about your roadmap and let the assistant draft, resize, and reschedule work for you from a chat panel — it reads the open plan and proposes edits you approve.
- **Jira Cloud sync**: link a plan to a Jira project so features and stories push to Jira issues and pull status back, keeping the roadmap and the tracker in step.
- **Per-kind sizing and priority schemes**: features and stories can carry their own size scales and priority ladders, so estimates read naturally at both levels.

### Improved

- **Role removal**: delete a team role from Setup and every assignment cleans up with it.
- **Inline holiday editing**: add and remove holiday dates straight from the Setup table.

## 1.0.9 — 2026-09-02

### New

- **Sprinting page**: sprint-by-sprint rows with drag to move and reorder work across sprints.
- **Group-level Add feature**: add a feature straight from a group row.

### Improved

- **Sticky panel header** and a **collapsible left pane** keep context while scrolling long plans.
- **Column scoping by kind**: Scoping columns can apply to features only or stories only.
- **Milestone marker styles** and filter chips that wear the epic icon or workstream dot.

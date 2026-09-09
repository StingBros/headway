# Changelog

Release notes for Headway. Each version gets one `## <version>` section, written
during the release; the GitHub release body and the in-app "What's new" dialog
both come from the matching section here. Newest first.

Format: short sections, bullets, one bold title per notable change —
`**Feature title**: a short, impactful description and use case.`

## Unreleased

- Tags: features and stories carry free-form labels, edited in the detail panel's **Tags** section (Enter or a comma adds one, the box suggests tags already in the document). Filter by tag with `#tag`; tags ride along in the Excel round trip, push to Jira as labels, and the AI assistant can read and set them.
- Item types: every epic, feature and story carries a type (Feature, Bug, Task, Story, Subtask, Epic by default; add your own in Setup → Hierarchy). Rows show the icon for non-default types; pick a type from the panel, the context menu or Edit epic.
- Hierarchy settings: rename the three levels, choose which types each accepts, or allow any type at any level.
- Jira: sync and CSV export use each type's Jira issue type; the three fixed type fields in Setup → Jira are replaced by a per-type table. Existing documents keep their previous names.
- AI assistant can set and read item types.
- Type glyphs: the colored square left of every title is now the item's type icon (Feature keeps the filled square; Story is a bookmark) in the active color. **View → Color by item type** colors bars by type; each type's color lives in Setup → Hierarchy.
- Prioritizing: milestones no longer appear on the board.
- Sprinting: a row belongs only to the sprint it starts in (an ⓘ glyph says how many sprints it carries over), wears its sprint number, epic, workstream and assignees, and drops the duration, date range and phase columns; story-view headings show priority, size and duration; empty sprints at either end are hidden; right-click for **Move to sprint…** (features and stories) and **Assign…**.
- Settings → Jira: issue-type icons match the rest of the UI.
- AI assistant: the drawer loads the gateway's models when opened and the effort levels a model supports when you pick one, switching to Medium when the current level is not offered.
- Prioritizing: the Fields menu always offers the Priority and Risk chips (even when the columns are by that field), and the toolbar filters by phase like Sprinting.
- Desktop: the open file reloads from disk after external changes only while Auto save is on, so unsaved edits are never replaced.
- **Links in rich text**: any URL typed into a description or scope field renders as a link; ⌘-click (Ctrl-click on Windows/Linux) opens it in the browser. The stored text stays plain.

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

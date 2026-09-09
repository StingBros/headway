# Changelog

Release notes for Headway. Each version gets one `## <version>` section, written
during the release; the GitHub release body and the in-app "What's new" dialog
both come from the matching section here. Newest first.

Format: short sections, bullets, one bold title per notable change —
`**Feature title**: a short, impactful description and use case.`

## Unreleased

- Item types: every epic, feature and story carries a type (Feature, Bug, Task, Story, Subtask, Epic by default; add your own in Setup → Hierarchy). Rows show the icon for non-default types; pick a type from the panel, the context menu or Edit epic.
- Hierarchy settings: rename the three levels, choose which types each accepts, or allow any type at any level.
- Jira: sync and CSV export use each type's Jira issue type; the three fixed type fields in Setup → Jira are replaced by a per-type table. Existing documents keep their previous names.
- AI assistant can set and read item types.

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

# Type glyphs, Color by type, Sprinting cleanup, AI model loading — design

Second batch after item types (cd4a787). Everything here is UI-level except
type colors and the `type` color mode, which live in core so exports agree.

## Type glyph replaces the workstream square

- Every row/card that showed the 8px colored square (`.r-dot`) left of a
  title now shows the item's **type glyph** in the same slot, colored by the
  active color mode (`RM.colorForItem`). Sites: Planning/Scoping feature
  rows and story rows, Prioritizing feature cards and story cards, Sprinting
  feature rows, story rows and story-view feature headings.
- Feature type keeps the existing look: a filled, slightly rounded square.
  Its icon key is `square`; the renderer draws `square` as the old `.r-dot`
  span rather than a Lucide outline. Story = filled `bookmark` (Lucide
  bookmark with `fill: currentColor`). Task stays `check-square`, Bug stays
  `bug`, Epic `layers`, Subtask `corner-down-right`.
- Milestones keep their diamond/star/circle mask glyph whatever their type.
- Default-icon migration: a stored `feature` type whose icon is still the old
  default `rows-3` becomes `square`; a stored `story` type still on
  `list-tree` becomes `bookmark`. Custom icons are untouched.
- The icon picker (Hierarchy card) offers `square` and `bookmark`.
- Stories in `type` color mode take their own type's color; in every other
  mode they take the owning feature's color (as bars do today).

## Color by item type

- Type records gain `color` (6-hex, always resolved by `normalizeTypes`;
  default = `RM.HASH_PALETTE[index]` in list order). `RM.setItemTypeColor`.
- `RM.COLOR_MODES` gains `'type'`; `RM.colorForType(state, key)`;
  `RM.colorForItem` and `RM.colorLegend` handle it (legend = type labels).
- App: `COLOR_MODES` gains `['type', 'Item type']` → View menu "Color by
  item type", prefs "Color bars by" segment, AI `colorBy` pref accepts it.
- Hierarchy card types table gains a native `<input type="color">` per type
  (`data-suhtcolor`), committed on change.

## Prioritizing

- Milestones never appear on the board: `prMatches` returns false for them.

## Sprinting

- Membership: an item belongs only to the sprint containing its start day.
  Stories with their own timeline likewise. Stories without one follow their
  feature. No row appears in two sprints.
- Carry-over: when a scheduled row's end falls in a later sprint than its
  start, an info glyph (`.spv-info`, Lucide `info`) follows the title with
  the tooltip `Expecting to carryover for N sprints (through sprint Y)` where
  N = last − first and Y = last. When sprints are off the wording is
  `through week Y`.
- The `from S/to S/with feature` tag slot becomes a sprint-number tag
  (`S3`, or `W3` when sprints are off) for every row in a sprint section.
- Row chips: size, priority, risk, **assignees** (avatar stack or user-plus,
  opens the assignee menu; stories use story assignees). Duration chip,
  date range and phase columns are removed from rows and from the story-view
  feature heading.
- Feature rows in a workstream-enabled document show a workstream chip next
  to the epic chip (`data-spact="ws"`), opening the workstream menu.
- Story-view feature headings show the feature's priority, size and
  duration chips (interactive, same handlers as feature rows).
- Empty sprint sections (no rows after filters) are dropped from the start
  and end of the timeline; the current sprint is always kept so a drop
  target exists. Unscheduled always trails.
- Context menu (feature rows): **Move to sprint… ▸** lists every sprint of
  the timeline (current membership checked) and Unscheduled; plus
  **Assign…**, existing Move to phase / Set epic / Set workstream /
  Unschedule / Delete. Story rows gain a context menu with Move to sprint…
  (gives the story its own timeline) and Unschedule (drops it).

## Settings → Jira issue-types table

- Icons render at 14px like every other icon (`.jr-types td svg.lucide`).

## AI assistant: models and effort levels

- `AI.ensureModels(s)`: for the LiteLLM provider with a gateway URL, when no
  model list is cached for that URL, GET `/v1/models`, cache
  (`AI.modelCache`, `AI.modelCacheBase`), rebuild the drawer header. Errors
  toast `Could not list models: …` and leave the typed model in place.
  Called from `AI.open` (non-blocking).
- `AI.pickEffort(s)`: returns the effort to use — the current one when the
  model offers it, else `medium` when offered, else the first offered level,
  else the current value (no effort support → selector hidden as today).
- On model change: save the model, ensure model info is loaded for the
  gateway (fetch when the map lacks the model), then apply `pickEffort`,
  save, rebuild the header.
- Claude subscription provider: unchanged fixed lists.

## Tests

core: type colors/defaults/migration, `type` color mode + legend, removal
keeps colors consistent. ai: `pickEffort` table, `ensureModels` with a fake
fetch (fetches once, caches per base, error path). smoke: glyph markup at
each site, Color by item type in View menu/prefs, milestone absent from
board, sprint dedupe + carry-over tooltip + sprint tag + trimmed sections,
assignee/workstream chips, heading chips, context Move to sprint (feature
and story), Jira icon rule.

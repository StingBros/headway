# Item types and a configurable hierarchy

Date: 2026-09-08. Adds a type to every item at every level (epic, feature,
story), a Setup card that defines the hierarchy (level labels, which types
each level accepts, an "any type at any level" switch), and maps each type
to a Jira issue type for sync and CSV export.

Decisions taken during brainstorming:

- Levels hold allowed types. The hierarchy is an ordered list of levels;
  each level lists the types it accepts; each type maps to one Jira issue
  type. The switch removes the per-level restriction.
- Depth stays at three. Epic (string tag on items) > Feature (`state.items`)
  > Story (`item.stories`) remains the storage model. Level keys are fixed
  (`epic`, `feature`, `story`); only labels and allowed types change.
- Type is label + icon + Jira mapping only. Behavior (timeline bar, sizing
  and priority schemes, column scoping) still follows the level. Milestone
  stays a separate flag on features.

## 1. Data model (`js/core.js`)

### Types

`meta.itemTypes` is an ordered array of `{ key, label, icon, jira }`:

- `key`: stable id, slug of the label at creation (`bug`, `feature`, …),
  unique, never changes on rename.
- `label`: display name.
- `icon`: Lucide icon name.
- `jira`: Jira issue type name used by sync and CSV export.

Defaults for a new document (and for a legacy document with no
`meta.itemTypes`):

| key | label | icon | jira |
|---|---|---|---|
| epic | Epic | layers | Epic |
| feature | Feature | rows-3 | Story |
| bug | Bug | bug | Bug |
| task | Task | check-square | Task |
| story | Story | list-tree | Sub-task |
| subtask | Subtask | corner-down-right | Sub-task |

Story → Sub-task looks odd but reproduces today's sync exactly (the Story
level's default Jira type is `Sub-task`).

Legacy migration: when `meta.itemTypes` is absent and `meta.jira` carries
`epicType` / `featureType` / `storyType`, those names seed the `jira`
field of the `epic`, `feature` and `story` types. After that the three
old keys are ignored (left in place, never read again).

### Hierarchy

`meta.hierarchy = { levels: [...], anyTypeAnyLevel: false }` where `levels`
is exactly three entries in order:

```
{ key: 'epic',    label: 'Epic',    types: ['epic'] }
{ key: 'feature', label: 'Feature', types: ['feature', 'bug', 'task'] }
{ key: 'story',   label: 'Story',   types: ['story', 'subtask', 'bug'] }
```

Normalize always rebuilds the array with those three keys in that order,
taking labels and `types` from the document when present. `types` is
filtered to keys that exist in `meta.itemTypes`; an empty list falls back
to the default for that level; the first entry is the level's default type.

### Item fields

- `item.type` and `story.type`: a type key. Normalize sets a missing or
  unknown key to the level's default type. A stored type that is not
  allowed at its level is KEPT (turning the switch off never rewrites
  data); validation warns instead (see §5).
- `state.epicTypes[epicName]`: type key per epic, like `epicIcons`.
  Missing = `epic`. Normalize drops unknown keys.

### Helpers

- `RM.DEFAULT_ITEM_TYPES`, `RM.DEFAULT_HIERARCHY_LEVELS`.
- `RM.itemTypes(state)` → the array.
- `RM.itemType(state, key)` → record or null.
- `RM.levelOf(state, kind)` → level record (`kind` = `epic|feature|story`).
- `RM.levelLabel(state, kind, plural?)` → label; plural adds `s` unless the
  label already ends in `s`.
- `RM.typesFor(state, kind)` → allowed type records: every type when
  `anyTypeAnyLevel`, else the level's list.
- `RM.defaultTypeFor(state, kind)` → first allowed type key.
- `RM.typeOf(state, obj, kind)` → the record for `obj.type` (an epic name
  string when `kind === 'epic'`), falling back to the level default.
- `RM.jiraTypeName(state, typeKey)` → `jira` string.
- `RM.addItemType(state, label, icon, jira)`, `RM.renameItemType(state,
  key, label)`, `RM.removeItemType(state, key)`: remove reassigns every
  item/story/epic of that type to its level default and pulls the key out
  of every level's list. A type cannot be removed while it is the only
  type at some level.
- `RM.setTypeAllowed(state, kind, key, on)`: toggling off the last type
  of a level is refused.

Sizing (`RM.sizeKeys`), priority (`prioKey`) and column scope keep their
`kind` parameter untouched.

## 2. Setup UI (`js/app.js`, `css/app.css`)

New **Hierarchy** card in the Project group, right after **Epics**:

- One row per level: an editable label input, then one toggle chip per
  type (icon + label). Chips are hidden while "any type at any level" is
  on, replaced by the hint "Every type is allowed at every level".
- Types table: label (editable), icon (button opening the existing
  `iswatches` icon picker used by Edit epic), Jira issue type (text
  input), remove button. **Add type** appends a row with label "New type",
  icon `tag`, blank Jira name.
- Checkbox **Allow any type at any level** (`meta.hierarchy.anyTypeAnyLevel`).
- Every edit goes through `commit('hierarchy')`.

Level labels replace the hard-coded words in prominent strings:
**Add feature** rows (group and phase level), the panel header kind chip,
the Prioritizing and Sprinting Features/Stories toggles, row context menu
entries (Insert feature above/below, Convert to feature, Add story), the
Setup card titles ("Feature sizing", "Story sizing", "Feature priority",
"Story priority", "Story size options"), and the Scoping column-scope
menu. Sentence-case helper hints keep their generic wording.

Type picking:

- Panel header: a type chip (icon + label) next to the milestone chip for
  features and stories; clicking opens a dropdown of `RM.typesFor`. The
  current type shows even if it is no longer allowed (marked "not
  allowed here" in the dropdown).
- Row context menu: a **Type ▸** submenu with the same list; applies to
  the whole multi-selection when the row is part of one.
- Edit epic modal: a **Type** dropdown (`state.epicTypes`).
- Rows in Planning, Scoping, Prioritizing cards and Sprinting show the type
  icon before the title only when the type is not the level default.

Version history: `type` diffs show as a "Type" field with type labels;
`epicTypes` diffs as "Epic type — <name>".

## 3. Jira sync (`js/jira.js`) and CSV export (`js/export-jira.js`)

- `JR.DEFAULTS` loses `epicType`, `featureType`, `storyType`. The Setup →
  Jira card replaces the three inputs with a **Issue types** table listing
  every Headway type: label, editable Jira issue type (writes
  `meta.itemTypes[].jira`, the same field as the Hierarchy card), and after
  a successful preview/test the project's resolved name with a "falls back
  to …" note where the configured name is missing.
- `JR.resolveTypes(issueTypes, state)` returns `{ byKey: { <typeKey>:
  { name, subtask } }, known }`. Resolution per type: exact name match,
  else a level-aware fallback: types allowed at the epic level → the type
  with `hierarchyLevel === 1` or "Epic"; types allowed at the story level
  → the first `subtask` type, then "Story", then "Task"; everything else →
  "Story", "Task", then the first non-subtask non-epic type. Each fallback
  adds a note naming the Headway type.
- Issue creation uses `RM.typeOf` per epic, feature and story and looks up
  `byKey`. The former `storyIsSubtask` flag becomes per story: a story
  whose resolved type is a subtask nests via `parent`; otherwise the
  existing non-subtask nesting path applies.
- CSV export: the wizard drops the Feature type / Story type inputs.
  `JR.rows` writes `Issue Type` from `RM.jiraTypeName(state, type)` per
  row. `opts.featureType`/`opts.storyType` are removed.

## 4. AI assistant (`js/ai.js`)

- `add_items` and `update_items` accept `type` (a type key or label,
  matched case-insensitively) on features and stories.
- `update_project` documents `meta/itemTypes`, `meta/hierarchy` and
  `epicTypes/<name>` paths.
- System prompt gains one line: items carry a type (Feature, Bug, …)
  defined in Setup → Hierarchy; type maps to the Jira issue type.

## 5. Validation

New warning `TYPE_LEVEL`: "<Level> #12 is a <Type>, which is not allowed at
the <Level> level" for every item, story or epic whose type is not in
`RM.typesFor` for its level. Suppressed while `anyTypeAnyLevel` is on.

## 6. Excel

The hidden `_RoadmapTool` JSON sheet carries `meta.itemTypes`,
`meta.hierarchy`, `item.type`, `story.type` and `state.epicTypes` with no
change. No visible columns are added.

## 7. Docs

README: add a **Types & hierarchy** row to the feature table; update the
Jira row (types mapped in Setup → Hierarchy). CHANGELOG: new unreleased
section.

## 8. Tests

`tests/core.test.js`:
- normalize seeds default types/hierarchy and level-default `type` on
  items, stories and epics;
- legacy `meta.jira.*Type` names migrate into the `jira` field once;
- `typesFor` with the switch off and on; `removeItemType` reassigns and
  refuses the last type of a level; `setTypeAllowed` refuses emptying a
  level;
- validation emits `TYPE_LEVEL` only when the switch is off.

`tests/jira.test.js`:
- `resolveTypes` resolves per key and notes fallbacks;
- a feature typed `bug` creates a Bug issue; a story typed `subtask`
  nests via parent while a story typed `bug` (non-subtask) takes the
  non-subtask path;
- CSV rows carry the mapped Jira type per row.

`tests/smoke.test.js` (jsdom): the Hierarchy card renders, toggling a chip
commits, and the panel type chip changes an item's type.

# Story dependencies — design

**Request:** "Allow stories to have dependencies between each other now."

Features already carry `deps` (feature numbers). Stories get the same idea:
a story can depend on any other story in the document, in its own feature or
another one. Feature ↔ story links are out of scope.

## Model

- `story.deps: string[]` — ids of the stories this one depends on. Ids
  (not numbers) because stories have no user-facing number and ids survive
  the Excel round trip through the embedded JSON.
- `RM.normalizeState` keeps deps as unique strings, drops the story's own
  id, and **drops ids that resolve to no story** (unlike feature deps, a
  dangling story id has no meaning a user could repair, so it is pruned).
- `duplicateItem` regenerates story ids; deps between stories of the copied
  feature are remapped to the new ids. Deps that pointed outside the feature
  keep pointing at the originals.

## Core API (js/core.js)

```js
RM.storyRef(state, stId)            // -> { it, st } | null
RM.storyLabel(state, ref)           // '#12 · Story title' (feature num + title)
RM.storyWindow(state, it, st)       // { startDay, endDay } from the story's own
                                    // timeline, else the feature's bar; null if neither
RM.resolveStoryDeps(state, st)      // { deps: [{ it, st }] }  (unknown ids never survive normalize)
RM.storyDepEdges(state)             // [[depRef, ref], …] every explicit edge
RM.storyCycleMembers(state)         // { storyId: true } for stories in a cycle
RM.storyDependents(state, stId)     // [{ it, st }] stories that list stId
```

`RM.validate` adds per-story entries to `global` (stories have no byItem
bucket today) with codes:

| code | level | when |
|---|---|---|
| `STORY_CYCLE` | error | the story is in a story-dependency cycle |
| `STORY_DEP_ORDER` | warn | the story's window starts before a not-done dependency's window ends |
| `STORY_DEP_UNSCHEDULED` | info | the story has a window, a not-done dependency has none |

Messages name both ends: `Story "A" under #3 starts before "B" under #5 finishes`.

## UI (js/app.js)

- **Story panel** gets a `Dependencies` section (`sec2('st-deps', …)`)
  between Timeline and Integrations: chips for each dependency
  (`#num · title`, click opens that story, × removes), a "Depended on by"
  chip list (× removes the link from the other side), and a search box that
  matches story titles and feature titles across the document and adds the
  picked story. Same look as the feature section (`dep-chip`, `dep-sug`).
- **Planning arrows**: `renderArrows` also draws story edges between two
  visible story bars (`[data-stbar]`), same curve, same classes (`viol`
  dashed when the dependent starts before the dependency's window end and
  the dependency is not done, `sel-related` when the selected story is an
  end). A story edge carries `data-sfrom` / `data-sto` (story ids). Clicking
  an edge and pressing Delete removes it, like feature edges.
- **Ports on story bars**: story bars get the same in/out circles; dragging
  one onto another story bar or story row links the two stories. Dropping
  on a feature bar does nothing (feature ↔ story links are out of scope) and
  says so in a toast.
- Deleting a story (five sites) relies on normalize pruning: no extra work.
- Version history diffs show `stories/<id>/deps` like any story field.

## Excel (js/excel.js)

Stories sheet gains a trailing **Depends on** column (after Tags): the
dependencies as `#num · title` joined with `; `. Export only — the embedded
JSON is the source of truth on import, and a Stories sheet edited by hand
keeps whatever deps the JSON has. Header-guarded like Tags.

## Jira

- `js/jira.js`: when stories are pushed, `plan.links` also gets one entry
  per story dependency whose two stories both end up with keys
  (`blockerId` / `blockedId` are story ids; `keyOf` already maps story ids).
- `js/export-jira.js`: story rows fill **Blocked By** with the Jira keys of
  their dependencies (stories with a `jiraKey`).

## AI (js/ai.js)

- `itemFull` story objects carry `deps` (ids) when non-empty.
- `mergeFields` accepts `deps` on stories (array of story ids; unknown ids
  are dropped by normalize).
- Tool descriptions and the guide mention story deps: "Stories can depend
  on other stories (deps = story ids, see get_project items)".

## Docs

README Dependencies row and CHANGELOG Unreleased bullet.

## Out of scope

Auto-schedule / snap-earliest / critical path for stories; feature ↔ story
links; ripple moves through story deps; Reporting.

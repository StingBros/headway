# Story numbers and story dependencies — design

**Requests:**
- "Allow stories to have dependencies between each other now."
- "All stories should have id #s as well. Same #ing system as features, sharing the same incrementing number pool."

## Story numbers

- `story.num` is an integer, unique across **features and stories together**
  (one pool). A document with features #1–#8 and three stories numbers the
  stories #9, #10, #11; the next feature is #12.
- `RM.normalizeState` keeps every existing number and assigns missing or
  colliding ones in document order: features first (today's pass, unchanged),
  then stories. `RM.nextNum(state)` is the max over both plus one.
- Lookup: `RM.itemByNum` stays feature-only (dozens of callers rely on it).
  New: `RM.storyByNum(state, n) -> {it, st}|null` and
  `RM.byNum(state, n) -> {kind:'feature', it} | {kind:'story', it, st} | null`.
- Renumbering: `RM.renumberItem` treats story numbers as taken;
  `RM.renumberStory(state, itemId, stId, wanted)` mirrors it (falls back to
  `nextNum` when taken) and rewrites story deps that pointed at the old
  number.
- Duplicating a feature gives the copied stories fresh numbers;
  dependencies among the copied stories are remapped to the new numbers.
- Display: every place a story title appears in a list shows `#num` in the
  same `r-num` style features use: Planning and Scoping story rows,
  Prioritizing story rows inside cards and story cards, Sprinting story rows,
  the feature panel's story list, and the story panel header, where the
  number is editable exactly like the feature number.

## Story dependencies

- `story.deps: number[]` — numbers of the stories this one depends on (any
  feature). Same shape as feature deps, so users type `#14` in the panel
  and the Excel column, and Jira/AI carry plain numbers.
- Normalize keeps numeric, unique values and drops the story's own number.
  Unknown numbers stay (like feature deps) so a hand-typed Excel value can
  be repaired; validation warns. A number that resolves to a **feature** is
  reported as unknown (`#n is a feature, not a story`) — feature ↔ story
  links stay out of scope.

## Core API (js/core.js)

```js
RM.storyByNum(state, n)             // -> { it, st } | null
RM.byNum(state, n)                  // -> { kind, it, st? } | null
RM.renumberStory(state, itemId, stId, wanted) // -> the number used
RM.remapStoryDeps(stories, numMap)  // old num -> new num inside a copy
RM.storyLabel(state, ref)           // '#14 · Story title'
RM.storyWindow(state, it, st)       // { startDay, endDay } (own timeline, else the feature bar) | null
RM.resolveStoryDeps(state, st)      // { deps: [{ it, st }], unknown: [n] }
RM.storyDepEdges(state)             // [[depRef, ref], …]
RM.storyCycleMembers(state)         // { storyId: true }
RM.storyDependents(state, st)       // [{ it, st }] stories listing st.num
```

`RM.validate` pushes per-story entries to `global` (with `storyId` and
`itemId` fields; consumers read only level/msg) using codes:

| code | level | when |
|---|---|---|
| `STORY_UNKNOWN_DEP` | warn | a dep number matches no story (or matches a feature) |
| `STORY_CYCLE` | error | the story is in a story-dependency cycle |
| `STORY_DEP_ORDER` | warn | its window starts before a not-done dependency's window ends |
| `STORY_DEP_UNSCHEDULED` | info | it has a window, a not-done dependency has none |

Messages read `Story #14 "A" starts before #9 "B" finishes`.

## UI (js/app.js)

- **Story panel** gets a `Dependencies` section between Timeline and
  Integrations: dependency chips (`#num · title`, click opens that story,
  × removes), a "Depended on by" list (× removes the link from that side),
  and a search box matching `#n` / `n` / story title / feature title across
  the document.
- **Planning arrows** between two visible story bars, same curve and classes
  as feature arrows (`viol` when the dependent starts before the
  dependency's window end and the dependency is not done, `sel-related`
  when the selected story is an end). Story edges carry `data-sfrom` /
  `data-sto` (story ids). Click + Delete removes the dependency.
- **Ports on story bars**: same in/out circles; drag onto another story bar
  or story row to link. Dropping on a feature bar toasts "Stories link to
  stories" and does nothing.
- Version history diffs show `stories/<id>/num` and `stories/<id>/deps`
  like any story field.

## Excel (js/excel.js)

Stories sheet gains two trailing columns after Tags: **#** (the story
number) and **Depends on** (numbers joined with `, `). Both are read back
when the header says so (older workbooks without them still import; numbers
are then assigned by normalize).

## Jira

- `js/jira.js`: when stories are pushed, `plan.links` also gets one entry per
  story dependency whose two stories both end up with keys (`story: true`,
  `blockerId` / `blockedId` are story ids). Apply step 4 resolves story keys.
- `js/export-jira.js`: story rows fill **Blocked By** with the Jira keys of
  their dependencies.

## AI (js/ai.js)

- Summary item lines add `storyNums: [n, …]`; `itemFull` stories carry
  `num` and `deps`.
- `update_items`: `num` may be a story number (the target is that story;
  the old `story: <id>` form still works). Story `deps` accepts numbers.
- Guide and tool text: "Stories have their own #number from the same pool
  as features; refer to a story by its number. Stories can depend on other
  stories (deps = story numbers)."

## Docs

README Dependencies row and Detail panel row; CHANGELOG Unreleased.

## Out of scope

Auto-schedule / snap-earliest / critical path for stories; feature ↔ story
links; ripple moves through story deps; Reporting.

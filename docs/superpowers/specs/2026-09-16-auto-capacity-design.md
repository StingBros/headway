# Auto features, typed capacity, and sticky group bands — design

Date: 2026-09-16

## Goal

Make the timeline plan itself. Two "auto" behaviours apply as soon as a
document loads and whenever they are switched on:

- **Auto-order** (exists today): rows follow the timeline's start order.
- **Auto timeline** (new): a phase flagged Auto keeps its items laid out by
  dependencies under a capacity limit derived from the roster. Any single
  feature or story can also be placed on demand from its context menu.

Capacity becomes a first-class model: every unit of work drains a capacity
type, every person supplies one, and the limit per type per week comes from
the people's full-time hours (holidays included), not a hand-typed weekly
number. All capacity settings move to their own Setup tab. Story rows in the
Planning left pane show their capacity type. Second-level group bands (epic /
workstream) pin under the phase band while scrolling.

## Non-goals

- No change to the Sprinting, Prioritizing, Budgeting, Reports or Jira views
  beyond what the removed settings force.
- No per-person skill matrix: a person supplies exactly one capacity type.
- No daily-resolution capacity. The ledger is weekly, matching the capacity
  row, so what shows red is exactly what the scheduler refuses to do.

## 1. Data model

### meta

| Field | Values | Notes |
|---|---|---|
| `capacityEnabled` | bool | exists |
| `planLevel` | `feature` (default) / `story` | exists; which units carry demand |
| `capMode` | `person` (default) / `points` | new; what one unit demands |
| `defaultPoints` | number ≥ 0, default 10 | new; a person's points per sprint when their own is unset |
| `capRowTypes` | `'all'` or `string[]` | new; which types the capacity row aggregates; default `'all'` |

Removed: `capLimit`, `capBasis`, `capUnit`. `normalizeState` deletes them
from loaded documents; nothing migrates because the row now shows demand vs
supply instead of counts.

### story

| Field | Values | Notes |
|---|---|---|
| `capType` | string, `''` = untyped | exists |
| `capMult` | number > 0, default 1 | new; person mode only |

### item (feature)

| Field | Values | Notes |
|---|---|---|
| `capType` | string, `''` = untyped | new; used at Features level only |
| `capMult` | number > 0, default 1 | new; Features level, person mode |

A new feature gets `capType` = the document's first capacity type
("Development" by default) so the default document already plans against
Development at Features level. Milestones carry no capacity fields.

Effective feature type at Features level (`RM.itemCapType(state, it)`): if the
feature has stories and every typed story shares one type, that type;
otherwise the feature's own `capType`.

### team member

| Field | Values | Notes |
|---|---|---|
| `capType` | string | exists; what they supply |
| `capacity` | number ≥ 0, default 1 | exists; heads in person mode |
| `points` | number ≥ 0 or null | new; points per sprint in points mode; null = `meta.defaultPoints` |

### phase

| Field | Values | Notes |
|---|---|---|
| `auto` | bool, default false | new; Auto timeline on for this phase |

`normalizeState` forces `auto = false` when `capacityEnabled` is off or the
phase is a bucket, so the flag can never be on in a state where it cannot run.

## 2. Capacity math (core)

All in `js/core.js`. Existing `wipWeight` / `storyWipWeight` / `availForWeek`
/ `availByTypeForWeek` are replaced by the functions below; callers
(`RM.capacity`, `RM.validate`, scheduler) move to them. `RM.pointsOf` stays.

### Units

`RM.capUnits(state)` returns the list of demand units:

- Stories level: every story of a non-done, non-milestone item. A scheduled
  item with no stories contributes one unit of its own (type = its `capType`,
  span = its bar).
- Features level: every non-done, non-milestone item.

Each unit: `{ id, itemId, storyId|null, capType, mult, points, startDay,
durDays, riskDays, deps: [unitIds], locked, done, phaseId, order }`. `order` is
the item's row index then the story index. `deps` at Stories level are the
story's own deps plus every unit of each feature the parent item depends on;
at Features level, the item's deps.

### Supply per type per week

```
holidayFactor(w) = workingDaysInWeek(w) / workDaysPerWeek   (0 on blackout weeks)
memberHeads(m, w) = memberHoursForWeek(m, w) / weekHours * capacity
person mode : supply[T][w] = Σ_{m.capType = T} memberHeads(m, w) * holidayFactor(w)
points mode : supply[T][w] = Σ_{m.capType = T} memberHeads(m, w) * pointsOf(m) / sprintWeeks * holidayFactor(w)
```

`pointsOf(m)` = `m.points ?? meta.defaultPoints`. `sprintWeeks` =
`weeksPerSprint`, or 2 when sprints are off (`weeksPerSprint === 0`).
`RM.capSupply(state)` returns `{ [type]: number[numWeeks + horizon] }`.
The set of supplied types is the keys.

### Demand per unit per week

```
person mode : demand = mult                       for each in-flight week
points mode : demand = points / workingWeeks(span) for each in-flight week
```

`workingWeeks(span)` counts the non-blackout weeks the unit's bar covers
(min 1). Risk buffers book no demand. Units with no points in points mode
demand 0 and are scheduled by dependencies only.

### Matching

Only a unit whose type is in the supplied-types set is capacity-constrained.
Untyped units and units of a type nobody supplies are placed by dependencies
alone. `RM.validate` emits `CAP_TYPE_UNSUPPLIED` (warn, once per type) when a
scheduled, non-done unit has a type nobody supplies. `OVER_CAP` now means:
for some supplied type, demand > supply in that week; the message names the
type, e.g. "Design: 2 people asked, 1 available (week of Nov 16)".

### The capacity row

`RM.capacity(state)` returns per week `{ demand, supply, over, blackout,
byType: { T: { demand, supply } } }` where `demand`/`supply` aggregate the
types in `meta.capRowTypes` (all supplied types when `'all'`; untyped units
count under `'all'` only, with no supply). The cell reads `d / s` (people or
points, one decimal), red when any selected type is over, amber above 85 %,
idle when 0. The row tooltip lists each selected type's `d / s`. The
resources panel hint changes to say the limit comes from the roster.

## 3. Scheduler

### `RM.autoTimeline(state, opts) → { state, changed, notes }`

Mutates a clone. `opts.phaseIds` defaults to every phase with `auto` on.
Returns `changed = 0` and the input state untouched when capacity planning is
off or no phase qualifies.

1. Build units. **Movable** = units in a target phase whose item is not
   locked, not done, and not a dependency-free milestone. Everything else is
   **fixed** and pre-books the ledger.
2. Milestones with dependencies in a target phase are movable and land at the
   latest dependency end (no capacity). Milestones without dependencies keep
   their day.
3. Topological order over movable units; ties broken by phase order then
   `order`. Cycles break at the lowest-priority entry with a note, as today.
4. For each unit in order: `est = max(latest dependency end, floor)`.
   `floor` = today's day index if the unit's current start is null or after
   today, else its current start (work already begun never jumps). Walk `s`
   forward from `est` one day at a time, skipping off days, until the
   stretched span fits: for every non-blackout week the span covers,
   `ledger[T][w] + demand ≤ supply[T][w]`. If the unit's demand exceeds the
   peak supply of its type in any week, leave it where it is and add a note
   (never overallocate, never loop).
5. Book the ledger, set `startDay`, `durDays = stretchSpan(s, workingDays)`,
   restretch `riskDays`. Working days are preserved
   (`workInSpan` of the old bar, or the sized effort when unscheduled).
6. After placement at Stories level, each item's bar becomes the hull of its
   stories (start = min story start, end = max story end); `riskDays`
   restretches after the new end. Items with no stories keep their own placed
   bar.
7. Extend `numWeeks` if the plan spills, as today.

### `RM.placeUnit(state, itemId, storyId|null) → { state, changed, note }`

The single-unit action. Same ledger with everything else fixed; the unit's
own current booking is released first. `floor` = today. Works in any phase,
Auto or not, as long as capacity planning is on. Replaces `RM.snapEarliest`.

### `RM.autoSchedule`

Removed, along with the Auto-schedule dialog.

## 4. App behaviour

### Triggers

- **On document load** (every path that installs a new state: open, import,
  reload, option switch, history restore): if `autoOrder`, sort; then run
  `RM.autoTimeline`. If anything changed, replace state silently under the
  history label `auto` and mark the document dirty. A toast reports
  "Auto timeline moved N item(s)".
- **After every commit / replaceState** while any phase is Auto: run
  `RM.autoTimeline` on the new state inside the same history entry, then the
  auto-order sort. No toast (it would fire on every keystroke); the moved
  bars simply redraw. Guard against re-entry.
- **Toggling a phase to Auto**: run immediately for that phase and toast the
  count.
- **Toggling capacity planning off**: clears every phase's `auto` (with the
  normalize rule) and toasts that Auto timeline was switched off.

### Phase flag UI

- Phase dialog: a checkbox "Auto timeline — items follow dependencies and
  capacity" under the Backlog bucket one. Disabled with the hint "Enable
  capacity planning in Setup → Capacity" when capacity is off; hidden for
  bucket phases.
- Phase band right-click menu: "Auto timeline" toggle item with the same
  enablement.
- Band tag: `AUTO` pill after the phase name (`.band-auto`), same styling
  family as `.band-bucket-tag`.
- Setup → Phases rows show the same pill.

### Context menus

Feature rows, story rows (Planning / Scoping left pane and bars) gain
"Place at earliest slot" (icon `zap`) when capacity planning is on. Locked
or done items show it disabled. Runs `RM.placeUnit`, commits with label
`place`, toasts the note when nothing could move.

### View menu

The "Auto-schedule…" entry goes. "Auto-order rows by start" stays. A new
disabled-looking hint line under it reads "Auto timeline is set per phase"
only when capacity planning is on.

### Left pane chips

With capacity planning on, in the Planning view:

- Story rows: a `cap` chip (`.r-cap`) showing the type or "—", opening the
  existing story capacity-type dropdown; in person mode a `×N` chip
  (`.r-mult`) that opens a small inline number input (same pattern as the duration chip) —
  hidden when N is 1 unless hovered.
- Feature rows at Features level: the same two chips, driving `item.capType`
  / `item.capMult`. Hidden at Stories level.

Both columns are added to the planning column set (`plColOrder` /
`plColHide`) so they can be hidden like the other chips.

The panel keeps its existing story capacity dropdown and gains the
multiplier field (person mode) and the feature type / multiplier at Features
level.

### Setup → Capacity tab

New tab in `SETUP_SECTIONS` → Project, after Team, icon `gauge`. Cards:

1. **Capacity planning**: the enable checkbox (moved from Team).
2. **Planning level**: the Features / Stories scheme picker (moved).
3. **Demand**: scheme picker `Per person` ("a unit in flight uses one person
   of its type, times its multiplier") / `Story points` ("a unit's points
   spread over its weeks; each person supplies points per sprint"), plus the
   default points input in points mode.
4. **Capacity types**: the list, add box and hint (moved from Team).
5. **Capacity row**: "Show" — `All types` radio or a checkbox per type.

Team tab keeps Roles and Work week. The removed Capacity row total / weekly
limit controls are gone.

### Resources panel

Person rows gain a `Points` column (points mode only) editing `m.points`;
blank shows the default in grey. The existing `capacity` column stays for
person mode.

### Sticky group bands

`.row.eband` becomes `position: sticky; top: calc(var(--hdr-h) +
var(--band-real-h)); z-index: 13` with an opaque `var(--paper-2)` background
on both cells; `.row.eband.sub` sits one band lower
(`+ var(--eband-real-h)`). Lane grid lines are drawn on the sticky cell
background so they still align. The next band of the same level slides over
the stuck one, exactly as phase bands do.

## 5. Excel / exports / AI

- `js/excel.js`: hidden JSON carries the new fields automatically. The
  visible Stories sheet gains a "Capacity type" and "Multiplier" column;
  the Team sheet gains "Points". `reconcileVisibleEdits` reads them back.
- `js/export-png.js`: the capacity row renders the new `d / s` text.
- `js/ai.js`: the state summary lists the demand mode and each phase's auto
  flag; the tool schema drops `capLimit`.

## 6. Tests

`tests/core.test.js`:

- Supply: part-time hours, `capacity` 0.5, a week with two holidays, a
  blackout week, points mode with sprints on and off.
- Demand: person mode multiplier; points spread across a holiday-stretched
  span.
- `RM.capacity`: row aggregation for `'all'` vs a subset; untyped units.
- `RM.autoTimeline`: dependency order; three stories, cap 2 → third slides;
  a locked item pre-books; a dependency-free milestone is untouched; a
  milestone with deps lands at the dep end; non-auto phases untouched; the
  floor rule (started work keeps its start); never overallocates; hull
  rebuild at Stories level; working days preserved over holidays.
- `RM.placeUnit`: releases its own booking; note when infeasible.
- `normalizeState`: removed fields stripped; `auto` cleared when capacity
  is off; defaults for `capMult`, `points`, feature `capType`.

`tests/smoke.test.js` (jsdom): Capacity tab renders and toggles; phase
dialog checkbox enablement; AUTO pill; chips appear only with capacity on;
context menu item; load trigger moves an over-cap story; eband sticky
style computed.

## 7. Changelog

One "Unreleased" entry per user-visible change: Auto timeline, Place at
earliest slot, Setup → Capacity tab, demand modes, capacity row change,
weekly limit removed, story chips, sticky group bands.

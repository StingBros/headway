# Auto Timeline, Typed Capacity and Sticky Group Bands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phases flagged Auto keep their items laid out by dependencies under a per-capacity-type limit derived from the roster; capacity settings move to their own Setup tab; story rows show their capacity type; epic/workstream group bands stick under the phase band.

**Architecture:** One typed weekly capacity ledger in `js/core.js` (`RM.capSupply`, `RM.capUnits`, `RM.capacity`) feeds the capacity row, validation, the whole-phase scheduler `RM.autoTimeline` and the single-unit `RM.placeUnit`. `js/app.js` runs the scheduler on load and inside every commit while a phase is Auto, and adds the Setup → Capacity tab, row chips, band tag and context-menu entries. CSS makes `.row.eband` sticky.

**Tech Stack:** Vanilla ES5 browser JS (no build step), `js/core.js` is also a CommonJS module for Node tests. Tests: `NODE_PATH=./node_modules node tests/core.test.js` and `NODE_PATH=./node_modules node tests/smoke.test.js` (jsdom). Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-16-auto-capacity-design.md`

## Global Constraints

- ES5 syntax only in `js/*.js` (`var`, `function`, no arrow functions, no template literals, no `const`/`let`) — the files load unbundled in old WebViews.
- Every `commit(label, fn)` label is short lowercase; toasts are sentence case.
- Removed meta fields: `capLimit`, `capBasis`, `capUnit`. Removed functions: `RM.wipWeight`, `RM.storyWipWeight`, `RM.availForWeek`, `RM.availByTypeForWeek`, `RM.autoSchedule`, `RM.snapEarliest`.
- Defaults: `meta.capMode = 'person'`, `meta.defaultPoints = 10`, `meta.capRowTypes = 'all'`, `story.capMult = 1`, `item.capMult = 1`, `item.capType = ''` in normalize (the app sets a new feature's `capType` to the first capacity type), `member.points = null`, `phase.auto = false`.
- Points mode divides a person's points by `weeksPerSprint`, or by 2 when sprints are off (`weeksPerSprint === 0`).
- `RM.autoTimeline` never overallocates and never loops: a unit that can never fit stays put with a note.
- Every task ends with both test suites passing and a commit ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Add one line per user-visible change under `## Unreleased` in `CHANGELOG.md` in the task that ships it.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `js/core.js` | normalize (new fields, removals), capacity helpers, `RM.capacity`, `RM.validate` messages, `RM.autoTimeline`, `RM.placeUnit`, `RM.todayDay` |
| `tests/core.test.js` | replaces the old capacity / autoSchedule / snapEarliest sections |
| `js/app.js` | commit/adopt hooks, Setup → Capacity tab, phase flag UI, context menus, row chips, capacity row text, resources Points column, panel fields |
| `css/app.css` | sticky ebands, `.band-auto`, `.r-cap`, `.r-mult`, `.res-pts` |
| `js/excel.js` | Stories sheet columns 10–11, Team sheet column 9 |
| `js/ai.js` | summary fields; tool description text |
| `tests/smoke.test.js` | replace the removed capacity-row assertions; new UI checks |
| `CHANGELOG.md` | Unreleased entries |

---

### Task 1: Normalize the new fields and drop the old ones

**Files:**
- Modify: `js/core.js:1289-1298` (meta capacity block), `js/core.js:1566-1580` (phases), `js/core.js:1640-1660` (item fields near `headcount`), `js/core.js:1705` (story `capType`), `js/core.js:1900-1908` (member `capType`/`capacity`)
- Test: `tests/core.test.js`

**Interfaces:**
- Produces: `meta.capMode`, `meta.defaultPoints`, `meta.capRowTypes`, `story.capMult`, `item.capType`, `item.capMult`, `member.points`, `phase.auto`; `RM.memberPoints(state, m)`.

- [ ] **Step 1: Write the failing tests** (append before the `regressions` section in `tests/core.test.js`)

```js
// ------------------------------------------------------------- capacity fields
section('capacity fields');
var sF = RM.normalizeState({
  meta: { timelineStart: '2026-07-27', numWeeks: 8, capLimit: 3, capBasis: 'stories', capUnit: 'points', capacityEnabled: true, capMode: 'points', defaultPoints: 8, capRowTypes: ['Design'] },
  phases: [{ id: 'p1', auto: true }, { id: 'p2', bucket: true, auto: true }],
  items: [{ num: 1, feature: 'f', capType: 'Design', capMult: 2, stories: [{ title: 's', capMult: 0 }] }],
  team: [{ name: 'A', points: 12 }, { name: 'B' }]
});
ok(sF.meta.capLimit === undefined && sF.meta.capBasis === undefined && sF.meta.capUnit === undefined, 'weekly limit and row basis/unit fields are gone');
eq(sF.meta.capMode, 'points', 'capMode kept');
eq(sF.meta.defaultPoints, 8, 'defaultPoints kept');
eq(sF.meta.capRowTypes, ['Design'], 'capRowTypes list kept');
eq(RM.normalizeState({ meta: {}, phases: [{ id: 'p' }], items: [] }).meta.capMode, 'person', 'capMode defaults to person');
eq(RM.normalizeState({ meta: {}, phases: [{ id: 'p' }], items: [] }).meta.defaultPoints, 10, 'defaultPoints defaults to 10');
eq(RM.normalizeState({ meta: {}, phases: [{ id: 'p' }], items: [] }).meta.capRowTypes, 'all', 'capRowTypes defaults to all');
eq(sF.items[0].capType, 'Design', 'feature capType kept');
eq(sF.items[0].capMult, 2, 'feature capMult kept');
eq(sF.items[0].stories[0].capMult, 1, 'story capMult below or at 0 falls back to 1');
eq(sF.team[0].points, 12, 'member points kept');
eq(sF.team[1].points, null, 'member points default null');
eq(RM.memberPoints(sF, sF.team[1]), 8, 'memberPoints falls back to the document default');
ok(sF.phases[0].auto === true, 'phase auto kept when capacity is on');
ok(sF.phases[1].auto === false, 'bucket phase can never be auto');
var sF2 = RM.normalizeState({ meta: { capacityEnabled: false }, phases: [{ id: 'p1', auto: true }], items: [] });
ok(sF2.phases[0].auto === false, 'phase auto cleared when capacity planning is off');
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js`
Expected: several `✗` lines in `capacity fields` (fields undefined / `RM.memberPoints is not a function`).

- [ ] **Step 3: Implement in `js/core.js`**

Replace the meta block at lines 1293-1296 (`capBasis` / `capUnit` / `capLimit`) with:

```js
    // demand model: a unit in flight costs one person (× its multiplier) or
    // its story points spread over its weeks against each person's points
    m.capMode = m.capMode === 'points' ? 'points' : 'person';
    m.defaultPoints = m.defaultPoints != null && isFinite(+m.defaultPoints) && +m.defaultPoints >= 0 ? +m.defaultPoints : 10;
    // which capacity types the header row aggregates: 'all' or a list
    m.capRowTypes = Array.isArray(m.capRowTypes)
      ? m.capRowTypes.filter(function (t) { return typeof t === 'string' && t; }) : 'all';
    delete m.capLimit; delete m.capBasis; delete m.capUnit;
```

In the phases map (line ~1576) add after `bucket: !!p.bucket,`:

```js
        // Auto timeline: items follow dependencies under the roster's
        // capacity. Needs capacity planning; buckets are never auto
        auto: !!p.auto && !!m.capacityEnabled && !p.bucket,
```

In the item map, after `teamType:` add:

```js
        // capacity type / multiplier used when planning at the feature level
        capType: it.capType != null ? String(it.capType) : '',
        capMult: it.capMult != null && isFinite(+it.capMult) && +it.capMult > 0 ? +it.capMult : 1,
```

In the story map, after `capType:` add:

```js
            capMult: s.capMult != null && isFinite(+s.capMult) && +s.capMult > 0 ? +s.capMult : 1,
```

In the member map, after `capacity:` add:

```js
        // story points per sprint this person supplies (points mode);
        // null = the document default
        points: mbr.points != null && mbr.points !== '' && isFinite(+mbr.points) && +mbr.points >= 0 ? +mbr.points : null,
```

After the `state.items.forEach` that pushes unknown story capTypes (line ~1925) add the feature types to the same guard:

```js
    state.items.forEach(function (it) {
      if (it.capType && state.capTypes.indexOf(it.capType) === -1) state.capTypes.push(it.capType);
    });
```

Next to `RM.capTypesOf` (line ~316) add:

```js
  RM.memberPoints = function (state, m) {
    return m.points != null ? m.points : (state.meta || state).defaultPoints;
  };
```

Also remove `meta.capLimit` from the `RM.capacity` weeks loop (`if (meta.capLimit != null && ...)`) — that whole function is rewritten in Task 2, so for this task only delete the two `capLimit` references there so the file still runs.

- [ ] **Step 4: Run tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js`
Expected: `capacity fields` all pass. Older `capacity` / `autoSchedule` sections still pass (untouched yet).

- [ ] **Step 5: Commit**

```bash
git add js/core.js tests/core.test.js
git commit -m "feat(core): capacity mode, points, multipliers and phase auto fields; drop the weekly limit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Typed capacity supply, units, demand and the capacity row

**Files:**
- Modify: `js/core.js:2276-2410` (replace `memberHoursForWeek`… through the end of `RM.capacity`; keep `memberHoursForWeek`, `memberOffWeek`, `pointsOf`)
- Modify: `js/core.js:2656-2668` (`RM.validate` OVER_CAP block)
- Test: `tests/core.test.js` (replace the `capacity` section at lines 162-178)

**Interfaces:**
- Produces:
  - `RM.holidayFactor(meta, week, set) → number` in [0,1]
  - `RM.memberHeads(state, m, week) → number`
  - `RM.capSupply(state, horizonWeeks?) → { types: string[], weeks: number, byType: { [T]: number[] } }`
  - `RM.itemCapType(state, it) → string`
  - `RM.capUnits(state) → Unit[]`, `Unit = { id, itemId, storyId, capType, mult, points, startDay, durDays, riskDays, deps: string[], locked, done, milestone, phaseId, order: [itemIdx, storyIdx] }`; `id` is `'i:' + item.id` or `'s:' + story.id`
  - `RM.unitWeekDemand(state, unit, startDay, durDays) → number` (per in-flight week)
  - `RM.unitWorkDays(state, unit) → number`
  - `RM.capacity(state) → { weeks: Cell[], teamTotal, types: string[] }`, `Cell = { demand, supply, over, blackout, byType: { [T]: { demand, supply } }, items: string[] }`

- [ ] **Step 1: Replace the `capacity` test section**

Delete lines 162-178 (`section('capacity')` through `XL clamps at 2 focus units`) and put this in their place:

```js
// ------------------------------------------------------------- capacity
section('capacity');
// person mode: a unit in flight costs one person of its type × multiplier;
// supply is the typed roster in people-equivalents, cut by holidays
var sCap = mkState([
  { num: 1, feature: 'big', startDay: 0, durDays: 20, capType: 'Development' },
  { num: 2, feature: 'mid', startDay: 5, durDays: 10, capType: 'Development', capMult: 2 },
  { num: 3, feature: 'design', startDay: 5, durDays: 5, capType: 'Design' }
], { team: [{ name: 'X', capType: 'Development' }, { name: 'Y', capType: 'Development', capacity: 0.5 }] });
var sup = RM.capSupply(sCap);
eq(sup.types, ['Development'], 'supplied types come from the roster');
eq(sup.byType.Development[0], 1.5, 'week 0 supply = 1 + 0.5 heads');
eq(RM.holidayFactor(META, 16), 0, 'blackout week factor 0');
var METAF = JSON.parse(JSON.stringify(META)); METAF.holidays = ['2026-08-05'];
eq(RM.holidayFactor(METAF, 1), 0.8, 'one holiday in a 5-day week = 0.8');
eq(RM.capSupply(mkState([], { meta: METAF, team: [{ name: 'X', capType: 'Development' }] })).byType.Development[1], 0.8, 'supply scales by the holiday factor');
var cap = RM.capacity(sCap);
eq(cap.weeks[0].demand, 1, 'week 0: one Development unit');
eq(cap.weeks[1].demand, 3, 'week 1: 1 + 2 (multiplier) Development');
eq(cap.weeks[0].supply, 1.5, 'row supply aggregates all supplied types');
ok(cap.weeks[1].over, 'week 1 over: 3 asked, 1.5 available');
ok(!cap.weeks[0].over, 'week 0 fits');
ok(cap.weeks[1].byType.Design.demand === 1 && cap.weeks[1].byType.Design.supply === 0, 'a type nobody supplies is listed with zero supply but never marks over');
ok(cap.weeks[1].items.indexOf(sCap.items[2].id) !== -1, 'items in flight listed');
// row type filter
sCap.meta.capRowTypes = ['Design'];
var capD = RM.capacity(sCap);
eq(capD.weeks[1].demand, 1, 'filtered row shows only the selected type');
ok(!capD.weeks[1].over, 'and only the selected types decide over');
sCap.meta.capRowTypes = 'all';
// story level: stories carry the demand; the feature bar is ignored
var sCapS = mkState([
  { num: 1, feature: 'f', startDay: 0, durDays: 20, capType: 'Development', stories: [
    { title: 'a', startDay: 0, durDays: 5, capType: 'Design' },
    { title: 'b', capType: 'Development' }
  ] }
], { team: [{ name: 'D', capType: 'Design' }] });
sCapS.meta.planLevel = 'story';
var capS = RM.capacity(sCapS);
eq(capS.weeks[0].demand, 1, 'story level: only the scheduled story counts');
eq(capS.weeks[1].demand, 0, 'unscheduled stories and the feature bar add nothing');
eq(RM.capUnits(sCapS).length, 2, 'one unit per story');
eq(RM.capUnits(mkState([{ num: 1, feature: 'lonely', startDay: 0, durDays: 5 }], { meta: Object.assign({}, META, { planLevel: 'story' }) })).length, 1, 'a story-less feature is one unit of its own at story level');
// points mode: points spread over the unit's working weeks vs points per sprint
var sPts = mkState([
  { num: 1, feature: 'eight', startDay: 0, durDays: 10, size: 8, capType: 'Development' }
], { team: [{ name: 'X', capType: 'Development' }, { name: 'Y', capType: 'Development', points: 6 }] });
sPts.meta.capMode = 'points'; sPts.meta.sizeScheme = 'points';
var capP = RM.capacity(sPts);
eq(capP.weeks[0].demand, 4, '8 points over 2 weeks = 4 per week');
eq(capP.weeks[0].supply, 8, '(10 + 6) points per 2-week sprint = 8 per week');
sPts.meta.weeksPerSprint = 0;
eq(RM.capacity(sPts).weeks[0].supply, 8, 'sprints off: points are per two weeks');
// feature type rolls up from stories when they agree
var sRoll = mkState([{ num: 1, feature: 'f', capType: 'Development', stories: [{ title: 'a', capType: 'Design' }, { title: 'b', capType: 'Design' }] }]);
eq(RM.itemCapType(sRoll, sRoll.items[0]), 'Design', 'all stories Design → feature plans as Design');
sRoll.items[0].stories[1].capType = 'QA';
eq(RM.itemCapType(sRoll, sRoll.items[0]), 'Development', 'mixed stories → the feature keeps its own type');
// validation names the type
var vCap = RM.validate(sCap).global.filter(function (v) { return v.code === 'OVER_CAP'; });
ok(vCap.length && /Development/.test(vCap[0].msg), 'OVER_CAP names the type');
ok(RM.validate(sCap).global.some(function (v) { return v.code === 'CAP_TYPE_UNSUPPLIED' && /Design/.test(v.msg); }), 'CAP_TYPE_UNSUPPLIED for a type nobody supplies');
```

Note: `mkState` merges `extras.meta` only when the test passes a full meta; add this helper change at the top of `mkState` so `extras.meta` overrides field by field:

```js
  if (extras && extras.meta) { Object.keys(extras.meta).forEach(function (k) { base.meta[k] = extras.meta[k]; }); delete extras.meta; }
```

(Put it right after `var base = {...};` and before the generic `extras` loop.) Check `RM.pointsOf` reads `size` as a number: with `sizeScheme = 'points'` a numeric `size` survives normalize — confirm by reading `RM.normalizeState`'s size handling (`grep -n "sizeScheme" js/core.js`); if numeric sizes are only kept under a points scheme, the test's `sizeScheme: 'points'` line is required, else drop it.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js`
Expected: `RM.capSupply is not a function`.

- [ ] **Step 3: Implement in `js/core.js`**

Delete `RM.availForWeek`, `RM.wipWeight`, `RM.availByTypeForWeek`, `RM.storyWipWeight` and the whole `RM.capacity` (lines ~2290-2410). Keep `memberHoursForWeek`, `memberOffWeek`, `pointsOf`. Insert:

```js
  // share of a week's working days that are not holidays (0 on blackout weeks)
  RM.holidayFactor = function (meta, week, set) {
    var S = RM.slotsOf(meta);
    if (!S) return 0;
    return (S - RM.holidaysInWeek(meta, week, set)) / S;
  };

  // one person's people-equivalents in a week: hours ÷ the full-time week ×
  // their capacity (a 0.5 seat is half a head even at 40 h)
  RM.memberHeads = function (state, m, week) {
    var full = RM.weekHoursOf(state.meta);
    return (RM.memberHoursForWeek(state.meta, m, week) / full) * (m.capacity != null ? m.capacity : 1);
  };

  RM.sprintWeeksForPoints = function (meta) {
    return meta.weeksPerSprint > 0 ? meta.weeksPerSprint : 2;
  };

  // supply per capacity type per week. Person mode: heads. Points mode:
  // points per sprint ÷ sprint weeks. Both cut by the holiday factor.
  RM.capSupply = function (state, horizonWeeks) {
    var meta = state.meta;
    var weeks = horizonWeeks || meta.numWeeks;
    var set = RM.holidayDaySet(meta);
    var points = meta.capMode === 'points';
    var sw = RM.sprintWeeksForPoints(meta);
    var byType = {};
    var types = [];
    state.team.forEach(function (m) {
      var t = m.capType || '';
      if (!t) return; // untyped people supply nothing in the typed model
      if (!byType[t]) { byType[t] = new Array(weeks); for (var i = 0; i < weeks; i++) byType[t][i] = 0; types.push(t); }
      for (var w = 0; w < weeks; w++) {
        var heads = RM.memberHeads(state, m, w);
        if (heads <= 0) continue;
        var unit = points ? heads * RM.memberPoints(state, m) / sw : heads;
        byType[t][w] += unit * RM.holidayFactor(meta, w, set);
      }
    });
    return { types: types, weeks: weeks, byType: byType };
  };

  // the type a feature plans as at the feature level: its stories' shared
  // type when they all agree, else its own
  RM.itemCapType = function (state, it) {
    var t = null;
    var mixed = false;
    (it.stories || []).forEach(function (st) {
      if (!st.capType) return;
      if (t == null) t = st.capType;
      else if (t !== st.capType) mixed = true;
    });
    return (t != null && !mixed) ? t : (it.capType || '');
  };

  // demand units: stories (story level) or features (feature level).
  // Milestones and done things carry no demand and are not units.
  RM.capUnits = function (state) {
    var storyLevel = RM.planLevel(state) === 'story';
    var units = [];
    var storyUnitByNum = {};
    var unitsByItem = {};
    state.items.forEach(function (it, idx) {
      if (it.milestone) return;
      if (!storyLevel) {
        var u = { id: 'i:' + it.id, itemId: it.id, storyId: null, capType: RM.itemCapType(state, it),
          mult: it.capMult || 1, points: RM.pointsOf(it), startDay: it.startDay, durDays: it.durDays,
          riskDays: it.riskDays || 0, deps: [], locked: !!it.locked, done: !!it.done, milestone: false,
          phaseId: it.phaseId, order: [idx, 0] };
        units.push(u);
        unitsByItem[it.id] = [u];
        return;
      }
      var mine = [];
      (it.stories || []).forEach(function (st, si) {
        var su = { id: 's:' + st.id, itemId: it.id, storyId: st.id, capType: st.capType || '',
          mult: st.capMult || 1, points: RM.pointsOf(st), startDay: st.startDay, durDays: st.durDays,
          riskDays: 0, deps: [], locked: !!it.locked, done: !!it.done || !!st.done, milestone: false,
          phaseId: it.phaseId, order: [idx, si], _st: st };
        if (st.num != null) storyUnitByNum[st.num] = su;
        units.push(su); mine.push(su);
      });
      if (!mine.length) {
        var lone = { id: 'i:' + it.id, itemId: it.id, storyId: null, capType: it.capType || '',
          mult: it.capMult || 1, points: RM.pointsOf(it), startDay: it.startDay, durDays: it.durDays,
          riskDays: it.riskDays || 0, deps: [], locked: !!it.locked, done: !!it.done, milestone: false,
          phaseId: it.phaseId, order: [idx, 0] };
        units.push(lone); mine.push(lone);
      }
      unitsByItem[it.id] = mine;
    });
    // milestones are units too (zero work) so dependents can chain on them
    state.items.forEach(function (it, idx) {
      if (!it.milestone) return;
      var mu = { id: 'i:' + it.id, itemId: it.id, storyId: null, capType: '', mult: 0, points: 0,
        startDay: it.startDay, durDays: 0, riskDays: 0, deps: [], locked: !!it.locked, done: !!it.done,
        milestone: true, phaseId: it.phaseId, order: [idx, 0] };
      units.push(mu);
      unitsByItem[it.id] = [mu];
    });
    // dependencies: feature deps expand to every unit of the dependency
    // feature; story deps point at the story's unit
    units.forEach(function (u) {
      var it = RM.itemById(state, u.itemId);
      RM.resolveDeps(state, it).deps.forEach(function (dep) {
        (unitsByItem[dep.id] || []).forEach(function (du) { if (u.deps.indexOf(du.id) === -1) u.deps.push(du.id); });
      });
      if (u._st) {
        RM.resolveStoryDeps(state, u._st).deps.forEach(function (ref) {
          var du = storyUnitByNum[ref.st.num];
          if (du && u.deps.indexOf(du.id) === -1) u.deps.push(du.id);
        });
        delete u._st;
      }
    });
    return units;
  };

  // working days a unit needs: its current bar's work, else its estimate
  RM.unitWorkDays = function (state, u) {
    if (u.milestone) return 0;
    var meta = state.meta;
    if (u.startDay != null && u.durDays != null) return Math.max(1, RM.workInSpan(meta, u.startDay, u.durDays));
    if (u.storyId) {
      var it = RM.itemById(state, u.itemId);
      var st = it && (it.stories || []).filter(function (s) { return s.id === u.storyId; })[0];
      return Math.max(1, st ? RM.storyEffortDays(state, st) : RM.sprintDays(meta));
    }
    return Math.max(1, RM.effortDays(state, RM.itemById(state, u.itemId)));
  };

  // non-blackout weeks a bar covers (min 1)
  RM.workingWeeksInSpan = function (meta, startDay, durDays) {
    var S = RM.slotsOf(meta);
    var w0 = Math.floor(startDay / S), w1 = Math.floor((startDay + Math.max(1, durDays) - 1) / S);
    var n = 0;
    for (var w = w0; w <= w1; w++) if (!RM.isBlackoutWeek(meta, w)) n += 1;
    return Math.max(1, n);
  };

  // what a unit asks of its type in each in-flight week
  RM.unitWeekDemand = function (state, u, startDay, durDays) {
    if (u.milestone) return 0;
    if (state.meta.capMode === 'points') {
      return u.points > 0 ? u.points / RM.workingWeeksInSpan(state.meta, startDay, durDays) : 0;
    }
    return u.mult > 0 ? u.mult : 1;
  };

  // the header row: per week, demand vs supply for the selected types
  RM.capacity = function (state) {
    var meta = state.meta;
    var S = RM.slotsOf(meta);
    var sup = RM.capSupply(state);
    var sel = meta.capRowTypes === 'all' ? null : meta.capRowTypes;
    function selected(t) { return sel == null || sel.indexOf(t) !== -1; }
    var weeks = [];
    for (var w = 0; w < meta.numWeeks; w++) {
      var cell = { demand: 0, supply: 0, over: false, blackout: RM.isBlackoutWeek(meta, w), byType: {}, items: [] };
      sup.types.forEach(function (t) {
        if (!selected(t)) return;
        cell.byType[t] = { demand: 0, supply: sup.byType[t][w] };
        cell.supply += sup.byType[t][w];
      });
      weeks.push(cell);
    }
    RM.capUnits(state).forEach(function (u) {
      if (u.done || u.milestone || u.startDay == null || u.durDays == null) return;
      var t = u.capType || '';
      if (t && !selected(t)) return;
      if (!t && sel != null) return; // untyped work shows under 'all' only
      var d = RM.unitWeekDemand(state, u, u.startDay, u.durDays);
      var w0 = Math.floor(u.startDay / S), w1 = Math.floor((u.startDay + Math.max(1, u.durDays) - 1) / S);
      for (var wk = Math.max(0, w0); wk <= Math.min(meta.numWeeks - 1, w1); wk++) {
        var cell = weeks[wk];
        if (cell.blackout) continue;
        cell.demand += d;
        if (cell.items.indexOf(u.itemId) === -1) cell.items.push(u.itemId);
        if (!cell.byType[t]) cell.byType[t] = { demand: 0, supply: 0 };
        cell.byType[t].demand += d;
      }
    });
    weeks.forEach(function (cell) {
      Object.keys(cell.byType).forEach(function (t) {
        // only a supplied type can be over-asked; untyped and unsupplied work
        // is dependency-only
        if (sup.types.indexOf(t) === -1) return;
        if (cell.byType[t].demand > cell.byType[t].supply + 1e-9) cell.over = true;
      });
    });
    return { weeks: weeks, teamTotal: state.team.length, types: sup.types };
  };
```

Replace the `OVER_CAP` block in `RM.validate` (lines ~2656-2668) with:

```js
    var cap = RM.capacity(state);
    function r1(x) { return Math.round(x * 10) / 10; }
    var unitWord = state.meta.capMode === 'points' ? 'points' : 'people';
    if (state.meta.capacityEnabled) {
      cap.weeks.forEach(function (cell, w) {
        if (!cell.over) return;
        var d = RM.weekStartDate(state.meta, w);
        Object.keys(cell.byType).forEach(function (t) {
          var bt = cell.byType[t];
          if (cap.types.indexOf(t) === -1 || bt.demand <= bt.supply + 1e-9) return;
          global.push({
            level: 'warn', code: 'OVER_CAP', week: w, capType: t,
            msg: t + ': ' + r1(bt.demand) + ' ' + unitWord + ' asked, ' + r1(bt.supply) + ' available (week of ' + RM.fmtShort(d) + ')',
            items: cell.items
          });
        });
      });
      // a type that scheduled work drains but nobody supplies
      var unsupplied = {};
      RM.capUnits(state).forEach(function (u) {
        if (u.done || u.milestone || u.startDay == null || !u.capType) return;
        if (cap.types.indexOf(u.capType) === -1) unsupplied[u.capType] = true;
      });
      Object.keys(unsupplied).forEach(function (t) {
        global.push({ level: 'warn', code: 'CAP_TYPE_UNSUPPLIED', capType: t,
          msg: 'Nobody on the roster supplies "' + t + '" — its work is planned by dependencies only' });
      });
    }
```

`RM.autoSchedule` and `RM.snapEarliest` reference the deleted `wipWeight` / `availForWeek`. Delete both functions now, together with their tests (`tests/core.test.js` lines 181-246, the `autoSchedule` + `snapEarliest` sections, and the `snapEarliest` / `autoSchedule` regressions at lines 300-330). Task 3 brings the replacements with new tests. Also delete `doAuto` (`js/app.js:8404-8420`) and its `Auto-schedule…` menu entry (`js/app.js:8503`) so the app keeps loading.

- [ ] **Step 4: Run tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js && NODE_PATH=./node_modules node tests/smoke.test.js`
Expected: core passes. Smoke fails only in the capacity-row block (`tests/smoke.test.js:3905-3932`) — fix it in Task 6; for now note the failures and continue (the commit below is core-only).

- [ ] **Step 5: Commit**

```bash
git add js/core.js js/app.js tests/core.test.js
git commit -m "feat(core): typed weekly capacity supply, units and demand; capacity row aggregates selected types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `RM.autoTimeline` and `RM.placeUnit`

**Files:**
- Modify: `js/core.js` (scheduling section, where `autoSchedule` was)
- Test: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `RM.todayDay(meta, now?) → number` (clamped ≥ 0)
  - `RM.autoTimeline(state, opts?) → { state, changed, notes }`, `opts = { phaseIds?: string[], today?: number }`
  - `RM.placeUnit(state, itemId, storyId?, opts?) → { state, changed, note }`
  - `RM.applyUnitPlacement(state, unit, startDay, durDays)` (internal helper, exported for tests)
  - `RM.rebuildHulls(state, itemIds)` sets each listed item's bar to the hull of its scheduled stories

- [ ] **Step 1: Write the failing tests** (append before `regressions`)

```js
// ------------------------------------------------------------- auto timeline
section('autoTimeline');
function autoMeta(extra) {
  var m = JSON.parse(JSON.stringify(META));
  m.holidays = []; m.capacityEnabled = true;
  if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
  return m;
}
function autoState(items, team, extraMeta, phases) {
  return mkState(items, { meta: autoMeta(extraMeta), team: team || [],
    phases: phases || [{ id: 'p1', name: 'Alpha', bucket: false, auto: true }, { id: 'p2', name: 'Later', bucket: false, auto: false }, { id: 'p3', name: 'Next', bucket: true }] });
}
function byNum(st) { var o = {}; st.items.forEach(function (it) { o[it.num] = it; }); return o; }
// feature level, person mode, one Development head: three features serialize, deps hold
var sT = autoState([
  { num: 1, feature: 'a', phaseId: 'p1', durDays: 5, capType: 'Development' },
  { num: 2, feature: 'b', phaseId: 'p1', durDays: 5, capType: 'Development', deps: [1] },
  { num: 3, feature: 'c', phaseId: 'p1', durDays: 5, capType: 'Development' },
  { num: 8, feature: 'other phase', phaseId: 'p2', startDay: 40, durDays: 5, capType: 'Development' },
  { num: 9, feature: 'parked', phaseId: 'p3', durDays: 5 }
], [{ name: 'Solo', capType: 'Development' }]);
var rT = RM.autoTimeline(sT, { today: 0 });
var T = byNum(rT.state);
eq(T[1].startDay, 0, 'first unit starts today');
eq(T[3].startDay, 5, 'third slides to week 1 (cap 1)');
eq(T[2].startDay, 10, 'dependent lands after its dep and after the busy week');
eq(T[8].startDay, 40, 'non-auto phase untouched');
ok(T[9].startDay == null, 'bucket untouched');
ok(!RM.capacity(rT.state).weeks.some(function (c) { return c.over; }), 'never overallocates');
eq(RM.autoTimeline(sT, { today: 0, phaseIds: [] }).changed, 0, 'no target phases → nothing changes');
var sOff = autoState([{ num: 1, feature: 'a', phaseId: 'p1', durDays: 5 }], [], { capacityEnabled: false });
eq(RM.autoTimeline(sOff, { today: 0 }).changed, 0, 'capacity off → nothing changes');
// cap 2: two run together, third waits
var s2 = autoState([
  { num: 1, feature: 'a', phaseId: 'p1', durDays: 5, capType: 'Development' },
  { num: 2, feature: 'b', phaseId: 'p1', durDays: 5, capType: 'Development' },
  { num: 3, feature: 'c', phaseId: 'p1', durDays: 5, capType: 'Development' }
], [{ name: 'X', capType: 'Development' }, { name: 'Y', capType: 'Development' }]);
var R2 = byNum(RM.autoTimeline(s2, { today: 0 }).state);
ok(R2[1].startDay === 0 && R2[2].startDay === 0 && R2[3].startDay === 5, 'cap 2 lets two run at once');
// locked pre-books; unlocked flows around; untyped is dependency-only
var sLk = autoState([
  { num: 1, feature: 'rock', phaseId: 'p1', startDay: 5, durDays: 5, locked: true, capType: 'Development' },
  { num: 2, feature: 'water', phaseId: 'p1', durDays: 10, capType: 'Development' },
  { num: 3, feature: 'free', phaseId: 'p1', durDays: 5, capType: '' }
], [{ name: 'Solo', capType: 'Development' }]);
var Lk = byNum(RM.autoTimeline(sLk, { today: 0 }).state);
eq(Lk[1].startDay, 5, 'locked stays');
eq(Lk[2].startDay, 10, 'a 2-week unit cannot straddle the locked week, so it waits');
eq(Lk[3].startDay, 0, 'untyped work is placed by dependencies only');
// milestones: dependency-free stays; with deps lands at the dep end
var sMs = autoState([
  { num: 1, feature: 'work', phaseId: 'p1', durDays: 5, capType: 'Development' },
  { num: 2, feature: 'gate', phaseId: 'p1', milestone: true, startDay: 30, durDays: 0, deps: [1] },
  { num: 3, feature: 'fixed date', phaseId: 'p1', milestone: true, startDay: 30, durDays: 0 },
  { num: 4, feature: 'after gate', phaseId: 'p1', durDays: 5, capType: 'Development', deps: [2] }
], [{ name: 'Solo', capType: 'Development' }]);
var Ms = byNum(RM.autoTimeline(sMs, { today: 0 }).state);
eq(Ms[2].startDay, 5, 'milestone with deps moves to the dep end');
eq(Ms[3].startDay, 30, 'dependency-free milestone stays');
eq(Ms[4].startDay, 5, 'dependents may start on the milestone day');
// floor: started work keeps its start; future work may move earlier
var sFl = autoState([
  { num: 1, feature: 'in progress', phaseId: 'p1', startDay: 2, durDays: 5, capType: 'Development' },
  { num: 2, feature: 'far future', phaseId: 'p1', startDay: 60, durDays: 5, capType: 'Development' }
], [{ name: 'X', capType: 'Development' }, { name: 'Y', capType: 'Development' }]);
var Fl = byNum(RM.autoTimeline(sFl, { today: 4 }).state);
eq(Fl[1].startDay, 2, 'started work keeps its start');
eq(Fl[2].startDay, 4, 'future work pulls in to today');
// holidays stretch, working days preserved
var sHo = autoState([
  { num: 1, feature: 'spanner', phaseId: 'p1', startDay: 75, durDays: 10, capType: 'Development' }
], [{ name: 'Solo', capType: 'Development' }], { holidays: META.holidays });
var rHo = RM.autoTimeline(sHo, { today: 75 });
var Ho = byNum(rHo.state);
eq(Ho[1].startDay, 75, 'starts at the floor');
eq(Ho[1].durDays, 20, '10 working days stretch over two blackout weeks');
eq(RM.workInSpan(rHo.state.meta, Ho[1].startDay, Ho[1].durDays), 10, 'net work preserved');
// infeasible: demand above peak supply stays put with a note
var sInf = autoState([
  { num: 1, feature: 'crowd', phaseId: 'p1', startDay: 10, durDays: 5, capType: 'Development', capMult: 3 }
], [{ name: 'X', capType: 'Development' }]);
var rInf = RM.autoTimeline(sInf, { today: 0 });
eq(byNum(rInf.state)[1].startDay, 10, 'infeasible unit keeps its start');
ok(rInf.notes.length === 1 && /never/.test(rInf.notes[0]), 'and explains itself');
// story level: stories move, feature bar becomes their hull
var sSt = autoState([
  { num: 1, feature: 'f', phaseId: 'p1', startDay: 0, durDays: 40, capType: 'Development', stories: [
    { num: 101, title: 'a', durDays: 5, capType: 'Development' },
    { num: 102, title: 'b', durDays: 5, capType: 'Development', deps: [101] },
    { num: 103, title: 'c', durDays: 5, capType: 'Development' }
  ] },
  { num: 2, feature: 'g', phaseId: 'p1', capType: 'Development', deps: [1], stories: [{ num: 201, title: 'd', durDays: 5, capType: 'Development' }] }
], [{ name: 'Solo', capType: 'Development' }], { planLevel: 'story' });
var rSt = RM.autoTimeline(sSt, { today: 0 });
var St = byNum(rSt.state);
var sts = {}; St[1].stories.forEach(function (s) { sts[s.num] = s; });
eq(sts[101].startDay, 0, 'story a first');
eq(sts[103].startDay, 5, 'story c waits for capacity');
eq(sts[102].startDay, 10, 'story b after a and after c took week 1');
eq(St[1].startDay, 0, 'feature hull start');
eq(St[1].durDays, 15, 'feature hull spans its stories');
eq(St[2].stories[0].startDay, 15, 'feature dep expands to every story of the dependency');
ok(rSt.state.items.every(function (it) { return it.stories.every(function (s) { return s.startDay != null; }); }), 'every story placed');
// points mode
var sPm = autoState([
  { num: 1, feature: 'ten', phaseId: 'p1', durDays: 5, size: 10, capType: 'Development' },
  { num: 2, feature: 'six', phaseId: 'p1', durDays: 5, size: 6, capType: 'Development' }
], [{ name: 'X', capType: 'Development', points: 20 }], { capMode: 'points', sizeScheme: 'points' });
var Pm = byNum(RM.autoTimeline(sPm, { today: 0 }).state);
ok(Pm[1].startDay === 0 && Pm[2].startDay === 5, '10 + 6 points in one week exceed 10 per week (20 per 2-week sprint) → serialized');
// cycles do not hang
var sCy2 = autoState([
  { num: 1, feature: 'a', phaseId: 'p1', durDays: 5, deps: [2], capType: 'Development' },
  { num: 2, feature: 'b', phaseId: 'p1', durDays: 5, deps: [1], capType: 'Development' }
], [{ name: 'Solo', capType: 'Development' }]);
var rCy2 = RM.autoTimeline(sCy2, { today: 0 });
ok(rCy2.state.items.every(function (it) { return it.startDay != null; }) && rCy2.notes.some(function (n) { return /cycle/.test(n); }), 'cycle members placed, note added');
// horizon grows
var sHz = autoState([{ num: 1, feature: 'late', phaseId: 'p1', startDay: 48 * 5 + 5, durDays: 5, capType: 'Development' }], [{ name: 'Solo', capType: 'Development' }]);
ok(RM.autoTimeline(sHz, { today: 48 * 5 + 5 }).state.meta.numWeeks >= 50, 'timeline extends to fit');

// placeUnit
section('placeUnit');
var sPl = autoState([
  { num: 1, feature: 'base', phaseId: 'p2', startDay: 0, durDays: 10, capType: 'Development' },
  { num: 2, feature: 'placeme', phaseId: 'p2', deps: [1], startDay: 0, durDays: 5, capType: 'Development' }
], [{ name: 'Solo', capType: 'Development' }]);
var rPl = RM.placeUnit(sPl, sPl.items[1].id, null, { today: 0 });
eq(RM.itemByNum(rPl.state, 2).startDay, 10, 'placeUnit lands right after its dep, in a non-auto phase');
eq(rPl.changed, 1, 'one change');
var rPl2 = RM.placeUnit(rPl.state, sPl.items[1].id, null, { today: 0 });
eq(rPl2.changed, 0, 'already there → no change (its own booking is released first)');
var sPlS = autoState([
  { num: 1, feature: 'f', phaseId: 'p2', startDay: 0, durDays: 10, stories: [
    { num: 101, title: 'a', startDay: 0, durDays: 5, capType: 'Development' },
    { num: 102, title: 'b', startDay: 0, durDays: 5, capType: 'Development' }
  ] }
], [{ name: 'Solo', capType: 'Development' }], { planLevel: 'story' });
var rPlS = RM.placeUnit(sPlS, sPlS.items[0].id, sPlS.items[0].stories[1].id, { today: 0 });
eq(RM.itemByNum(rPlS.state, 1).stories[1].startDay, 5, 'a story places after the week its sibling fills');
var rPlI = RM.placeUnit(autoState([{ num: 1, feature: 'crowd', phaseId: 'p2', startDay: 10, durDays: 5, capType: 'Development', capMult: 3 }], [{ name: 'X', capType: 'Development' }]), null, null, { today: 0 });
eq(rPlI.changed, 0, 'missing item → no change');
eq(RM.todayDay(META, new Date(Date.UTC(2026, 6, 20))), 0, 'today before the timeline clamps to 0');
eq(RM.todayDay(META, new Date(Date.UTC(2026, 7, 4))), 6, 'today maps to its working-day index');
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js`
Expected: `RM.autoTimeline is not a function`.

- [ ] **Step 3: Implement in `js/core.js`** (scheduling section)

```js
  // ------------------------------------------------------------ scheduling
  // today's working-day index on the grid (never negative)
  RM.todayDay = function (meta, now) {
    now = now || new Date();
    var d = RM.dateToDay(meta, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
    return d == null || !isFinite(d) ? 0 : Math.max(0, d);
  };

  // typed weekly ledger shared by autoTimeline and placeUnit
  function capLedger(state, horizonWeeks) {
    var meta = state.meta;
    var S = RM.slotsOf(meta);
    var sup = RM.capSupply(state, horizonWeeks);
    var used = {};
    sup.types.forEach(function (t) { used[t] = new Array(horizonWeeks); for (var i = 0; i < horizonWeeks; i++) used[t][i] = 0; });
    var set = RM.holidayDaySet(meta);
    function weeksOf(startDay, durDays) {
      return [Math.floor(startDay / S), Math.floor((startDay + Math.max(1, durDays) - 1) / S)];
    }
    function constrained(u) { return !u.milestone && !!u.capType && sup.types.indexOf(u.capType) !== -1; }
    return {
      types: sup.types,
      constrained: constrained,
      peak: function (t) { var p = 0; for (var w = 0; w < horizonWeeks; w++) if (sup.byType[t][w] > p) p = sup.byType[t][w]; return p; },
      book: function (u, startDay, durDays, sign) {
        if (!constrained(u) || startDay == null || durDays == null) return;
        var d = RM.unitWeekDemand(state, u, startDay, durDays) * (sign || 1);
        var ww = weeksOf(startDay, durDays);
        for (var w = Math.max(0, ww[0]); w <= ww[1] && w < horizonWeeks; w++) {
          if (RM.isBlackoutWeek(meta, w, set)) continue;
          used[u.capType][w] += d;
        }
      },
      fits: function (u, startDay, durDays) {
        if (!constrained(u)) return true;
        var d = RM.unitWeekDemand(state, u, startDay, durDays);
        var ww = weeksOf(startDay, durDays);
        for (var w = ww[0]; w <= ww[1]; w++) {
          if (w >= horizonWeeks) return true;
          if (RM.isBlackoutWeek(meta, w, set)) continue;
          if (used[u.capType][w] + d > sup.byType[u.capType][w] + 1e-9) return false;
        }
        return true;
      },
      set: set
    };
  }

  // write a unit's new window back onto its story or item
  RM.applyUnitPlacement = function (state, u, startDay, durDays) {
    var it = RM.itemById(state, u.itemId);
    if (!it) return false;
    var changed = false;
    if (u.storyId) {
      (it.stories || []).forEach(function (st) {
        if (st.id !== u.storyId) return;
        if (st.startDay !== startDay || st.durDays !== durDays) changed = true;
        st.startDay = startDay; st.durDays = durDays;
      });
      return changed;
    }
    if (it.milestone) {
      if (it.startDay !== startDay) changed = true;
      it.startDay = startDay; it.durDays = 0;
      return changed;
    }
    var riskSpan = RM.stretchSpan(state.meta, startDay + durDays, RM.riskEffortDays(state, it));
    if (it.startDay !== startDay || it.durDays !== durDays || (it.riskDays || 0) !== riskSpan) changed = true;
    if (it.startDay != null && RM.planLevel(state) !== 'story') RM.shiftStories(it, startDay - it.startDay);
    it.startDay = startDay; it.durDays = durDays; it.riskDays = riskSpan;
    return changed;
  };

  // story level: a feature bar is the hull of its scheduled stories
  RM.rebuildHulls = function (state, itemIds) {
    var changed = 0;
    state.items.forEach(function (it) {
      if (itemIds && itemIds.indexOf(it.id) === -1) return;
      if (it.milestone) return;
      var lo = null, hi = null;
      (it.stories || []).forEach(function (st) {
        if (st.startDay == null || st.durDays == null) return;
        if (lo == null || st.startDay < lo) lo = st.startDay;
        var e = st.startDay + Math.max(1, st.durDays);
        if (hi == null || e > hi) hi = e;
      });
      if (lo == null) return;
      var riskSpan = RM.stretchSpan(state.meta, hi, RM.riskEffortDays(state, it));
      if (it.startDay !== lo || it.durDays !== hi - lo || (it.riskDays || 0) !== riskSpan) changed += 1;
      it.startDay = lo; it.durDays = hi - lo; it.riskDays = riskSpan;
    });
    return changed;
  };

  // Lay out the Auto phases: dependency order, earliest start from today (or
  // the unit's own start once begun), under the typed weekly ledger. Fixed
  // units (other phases, locked, done, dependency-free milestones) pre-book.
  RM.autoTimeline = function (inputState, opts) {
    opts = opts || {};
    var state = RM.clone(inputState);
    var meta = state.meta;
    var notes = [];
    var out = { state: state, changed: 0, notes: notes };
    if (!meta.capacityEnabled) return out;
    var targets = {};
    var phaseIdx = {};
    state.phases.forEach(function (p, i) { phaseIdx[p.id] = i; });
    (opts.phaseIds || state.phases.filter(function (p) { return p.auto && !p.bucket; }).map(function (p) { return p.id; }))
      .forEach(function (id) { targets[id] = true; });
    if (!Object.keys(targets).length) return out;
    var today = opts.today != null ? opts.today : RM.todayDay(meta);
    var HORIZON = meta.numWeeks + 104;
    var S = RM.slotsOf(meta);
    var ledger = capLedger(state, HORIZON);
    var units = RM.capUnits(state);
    var byId = {};
    units.forEach(function (u) { byId[u.id] = u; });
    function movable(u) {
      if (!targets[u.phaseId] || u.locked || u.done) return false;
      if (u.milestone) return u.deps.length > 0;
      return true;
    }
    var endOf = {};
    units.forEach(function (u) {
      if (movable(u)) return;
      if (u.startDay != null && u.durDays != null) {
        endOf[u.id] = u.startDay + u.durDays + (u.riskDays || 0);
        if (!u.done) ledger.book(u, u.startDay, u.durDays, 1);
      }
    });
    var pending = {}, dependents = {};
    var mov = units.filter(movable);
    var movIds = {};
    mov.forEach(function (u) { movIds[u.id] = true; });
    mov.forEach(function (u) {
      var n = 0;
      u.deps.forEach(function (d) { if (movIds[d]) { n += 1; (dependents[d] = dependents[d] || []).push(u); } });
      pending[u.id] = n;
    });
    function prio(a, b) {
      var pa = phaseIdx[a.phaseId], pb = phaseIdx[b.phaseId];
      if (pa !== pb) return pa - pb;
      return a.order[0] - b.order[0] || a.order[1] - b.order[1];
    }
    var ready = mov.filter(function (u) { return pending[u.id] === 0; }).sort(prio);
    var remaining = mov.filter(function (u) { return pending[u.id] > 0; });
    var maxDay = 0;
    var touchedItems = {};
    function release(u) {
      (dependents[u.id] || []).forEach(function (c) {
        pending[c.id] -= 1;
        if (pending[c.id] === 0) { ready.push(c); ready.sort(prio); remaining = remaining.filter(function (r) { return r.id !== c.id; }); }
      });
    }
    function place(u) {
      var est = 0;
      u.deps.forEach(function (d) {
        var e = endOf[d];
        if (e == null && byId[d] && byId[d].startDay != null && byId[d].durDays != null) e = byId[d].startDay + byId[d].durDays + (byId[d].riskDays || 0);
        if (e != null && e > est) est = e;
      });
      if (u.milestone) {
        if (RM.applyUnitPlacement(state, u, est, 0)) out.changed += 1;
        endOf[u.id] = est;
        release(u);
        return;
      }
      var floor = (u.startDay != null && u.startDay <= today) ? u.startDay : today;
      if (floor > est) est = floor;
      var work = RM.unitWorkDays(state, u);
      var s = est;
      var dur = RM.stretchSpan(meta, s, work);
      if (ledger.constrained(u) && RM.unitWeekDemand(state, u, s, dur) > ledger.peak(u.capType) + 1e-9) {
        var it0 = RM.itemById(state, u.itemId);
        notes.push('#' + it0.num + ' (' + it0.feature + ') asks more ' + u.capType + ' than the roster can ever give in a week — left where it is.');
        if (u.startDay != null && u.durDays != null) endOf[u.id] = u.startDay + u.durDays + (u.riskDays || 0);
        release(u);
        return;
      }
      var guard = 0;
      while (guard < HORIZON * S) {
        if (!RM.offDay(meta, s, ledger.set) && ledger.fits(u, s, dur)) break;
        s += 1; dur = RM.stretchSpan(meta, s, work); guard += 1;
      }
      if (RM.applyUnitPlacement(state, u, s, dur)) out.changed += 1;
      touchedItems[u.itemId] = true;
      ledger.book(u, s, dur, 1);
      var e2 = s + dur + (u.storyId ? 0 : RM.stretchSpan(meta, s + dur, RM.riskEffortDays(state, RM.itemById(state, u.itemId))));
      endOf[u.id] = e2;
      if (e2 > maxDay) maxDay = e2;
      release(u);
    }
    var guard2 = 0;
    while ((ready.length || remaining.length) && guard2 < 10000) {
      guard2 += 1;
      if (!ready.length) {
        remaining.sort(prio);
        var forced = remaining.shift();
        notes.push('#' + RM.itemById(state, forced.itemId).num + ' is in a dependency cycle; placed by row order.');
        pending[forced.id] = 0;
        ready.push(forced);
      }
      place(ready.shift());
    }
    if (RM.planLevel(state) === 'story') out.changed += RM.rebuildHulls(state, Object.keys(touchedItems));
    var neededWeeks = Math.ceil(maxDay / S);
    if (neededWeeks > meta.numWeeks) {
      meta.numWeeks = neededWeeks;
      RM.syncEndDate(meta);
      notes.push('Timeline extended to ' + neededWeeks + ' weeks to fit the schedule.');
    }
    return out;
  };

  // one unit at its earliest dependency- and capacity-valid slot, everything
  // else fixed (its own booking is released first). Any phase.
  RM.placeUnit = function (inputState, itemId, storyId, opts) {
    opts = opts || {};
    var state = RM.clone(inputState);
    var meta = state.meta;
    var res = { state: state, changed: 0, note: null };
    var it = RM.itemById(state, itemId);
    if (!it) return res;
    var uid = storyId ? 's:' + storyId : 'i:' + it.id;
    var units = RM.capUnits(state);
    var u = units.filter(function (x) { return x.id === uid; })[0];
    if (!u) return res;
    var HORIZON = meta.numWeeks + 104;
    var S = RM.slotsOf(meta);
    var ledger = capLedger(state, HORIZON);
    var byId = {};
    units.forEach(function (x) { byId[x.id] = x; if (x.id !== uid && !x.done && x.startDay != null && x.durDays != null) ledger.book(x, x.startDay, x.durDays, 1); });
    var today = opts.today != null ? opts.today : RM.todayDay(meta);
    var est = today;
    u.deps.forEach(function (d) {
      var du = byId[d];
      if (!du || du.startDay == null || du.durDays == null) return;
      var e = du.startDay + du.durDays + (du.riskDays || 0);
      if (e > est) est = e;
    });
    if (u.milestone) {
      if (RM.applyUnitPlacement(state, u, est, 0)) res.changed = 1;
      return res;
    }
    var work = RM.unitWorkDays(state, u);
    var s = est, dur = RM.stretchSpan(meta, s, work);
    if (ledger.constrained(u) && RM.unitWeekDemand(state, u, s, dur) > ledger.peak(u.capType) + 1e-9) {
      res.note = 'Asks more ' + u.capType + ' than the roster can ever give in a week — left unchanged.';
      return res;
    }
    var guard = 0;
    while (guard < HORIZON * S) {
      if (!RM.offDay(meta, s, ledger.set) && ledger.fits(u, s, dur)) break;
      s += 1; dur = RM.stretchSpan(meta, s, work); guard += 1;
    }
    if (RM.applyUnitPlacement(state, u, s, dur)) res.changed = 1;
    if (storyId && RM.planLevel(state) === 'story') RM.rebuildHulls(state, [it.id]);
    var end = s + dur;
    var need = Math.ceil(end / S);
    if (need > meta.numWeeks) { meta.numWeeks = need; RM.syncEndDate(meta); }
    return res;
  };
```

- [ ] **Step 4: Run tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js`
Expected: all pass. If `story a first` fails because unscheduled stories have no `startDay`, confirm `RM.unitWorkDays` uses `storyEffortDays` (durDays 5 → 5). If `feature hull spans its stories` reads 15 but the hull test wants 15 and you get 20, check that story c (no deps) was placed in week 1 and b in week 2 (`sts[102].startDay === 10`).

- [ ] **Step 5: Commit**

```bash
git add js/core.js tests/core.test.js
git commit -m "feat(core): autoTimeline lays out Auto phases under the typed ledger; placeUnit for one item or story

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: App hooks — run auto features on load, on commit, and the phase flag UI

**Files:**
- Modify: `js/app.js:492-530` (`commit`, `replaceState`, `adoptState`), `js/app.js:8735-8790` (phase modal), `js/app.js:6231-6240` (band context menu), `js/app.js:4013-4020` (band row), `js/app.js:9824-9832` (Setup phases rows), `js/app.js:10154-10158` (`suCapEnable` handler), `js/app.js:8503` (edit menu, confirm `doAuto` is gone), `js/app.js:8574-8580` (view menu auto-order)
- Modify: `css/app.css:696` (add `.band-auto` next to `.band-bucket-tag`)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Produces: `applyAutoRules()` (app-local): sorts when `autoOrder`, then runs `RM.autoTimeline` when any phase is Auto; returns the number of moved units. `anyAutoPhase()` helper. Exposed for tests as `window.HeadwayApp.ai.autoTimelineNow()` returning the count.

- [ ] **Step 1: Write the failing smoke tests** (append near the other capacity tests, before the standalone-HTML block, ~line 3930)

```js
  // auto timeline: a phase flagged Auto re-lays its items on every commit
  {
    window.HeadwayApp.ai.commit('auto setup', (s) => {
      s.meta.capacityEnabled = true; s.meta.planLevel = 'feature'; s.meta.capMode = 'person';
      s.team = [{ id: 'solo', name: 'Solo', capType: 'Development', weekHours: {}, capacity: 1 }];
      s.phases[0].auto = true;
      s.items.forEach((it) => { if (it.phaseId === s.phases[0].id) { it.locked = false; it.capType = 'Development'; it.capMult = 1; } });
    });
    const st = window.HeadwayApp.ai.state();
    const cap = window.RM.capacity(st);
    ok(!cap.weeks.some((c) => c.over), 'after the commit no week of the Auto phase is over capacity');
    ok(/AUTO/.test(doc.querySelector('.row.band .band-auto')?.textContent || ''), 'the phase band shows an AUTO tag');
    // toggling capacity off clears the flag
    window.HeadwayApp.ai.commit('cap off', (s) => { s.meta.capacityEnabled = false; });
    ok(window.HeadwayApp.ai.state().phases[0].auto === false, 'capacity off clears the Auto flag');
    undo(); undo();
  }
```

Check `window.HeadwayApp.ai.state` exists (`grep -n "state: function" js/app.js` in the `ai` export block near line 11650); if the accessor has another name, use that.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js`
Expected: `✗ the phase band shows an AUTO tag` (and possibly the over-capacity check).

- [ ] **Step 3: Implement**

In `js/app.js` above `function commit(` add:

```js
  function anyAutoPhase() {
    return !!state.meta.capacityEnabled && state.phases.some(function (p) { return p.auto && !p.bucket; });
  }
  // the auto features: rows follow the timeline (auto-order) and Auto phases
  // follow dependencies + capacity (auto timeline). Runs inside a commit so
  // the moves share its history entry. Returns the number of moved units.
  var applyingAuto = false;
  function applyAutoRules() {
    if (applyingAuto) return 0;
    applyingAuto = true;
    var moved = 0;
    try {
      if (anyAutoPhase()) {
        var r = RM.autoTimeline(state);
        if (r.changed) { state = r.state; moved = r.changed; }
      }
      if (autoOrder && moved) RM.sortItemsByStart(state);
    } finally { applyingAuto = false; }
    return moved;
  }
```

In `commit`, after `if (mutate) mutate(state);` add `applyAutoRules();`. In `replaceState`, after `multiSel = null;` add `applyAutoRules();`. In `adoptState`, after `sessionEdited = false;` (so the block below can flip the saved flags) add:

```js
    // auto features apply on open: order the rows, lay out the Auto phases
    var prevJson = JSON.stringify(state);
    if (autoOrder) RM.sortItemsByStart(state);
    var moved = applyAutoRules();
    if (JSON.stringify(state) !== prevJson) {
      undoStack.length = 0; redoStack.length = 0;
      recordHistory('auto', prevJson);
      docSaved = false;
      sessionEdited = true;
      if (moved) toast('Auto timeline moved ' + moved + ' item' + (moved === 1 ? '' : 's'));
    }
```

and keep the rest of `adoptState` unchanged after it (`validation = RM.validate(state); saveLocal(); render();`).

Phase modal (`phaseModal`): after the Backlog bucket checkbox line add:

```js
      (phase && phase.bucket ? '' :
        '<div class="m-sec"><label class="p-check' + (state.meta.capacityEnabled ? '' : ' disabled') + '"><input type="checkbox" id="phAuto"' +
        (phase && phase.auto ? ' checked' : '') + (state.meta.capacityEnabled ? '' : ' disabled') + '> Auto timeline — items follow dependencies and capacity</label>' +
        (state.meta.capacityEnabled ? '' : '<div class="m-hint">Enable capacity planning in Setup → Capacity first.</div>') + '</div>') +
```

In `#phSave`: `var auto = !bucket && state.meta.capacityEnabled && !!($('#phAuto', host) && $('#phAuto', host).checked);` and write `auto: auto` into the new-phase object and `p.auto = auto;` in the edit branch. After the commit, when `auto` turned on for an existing phase that was off: `toast('Auto timeline on — ' + moved + ' moved')` is not available from `commit`; instead compute before/after: keep it simple — `if (auto && !(phase && phase.auto)) toast('Auto timeline on for ' + name);`.

Band context menu (`rowEl.dataset.kind === 'band'` branch): after `Edit phase…` insert:

```js
        (function () {
          var ph = state.phases.filter(function (p) { return p.id === phaseId; })[0];
          if (!ph || ph.bucket) return null;
          return { icon: 'zap', label: 'Auto timeline', checked: !!ph.auto, disabled: !state.meta.capacityEnabled,
            fn: function () {
              var on = !ph.auto;
              commit('auto timeline', function (s) { s.phases.forEach(function (p) { if (p.id === phaseId) p.auto = on; }); });
              toast('Auto timeline ' + (on ? 'on — ' + ph.name + ' follows dependencies and capacity' : 'off for ' + ph.name));
            } };
        })(),
```

(and `.filter(Boolean)` the items array if it is not already filtered — check `openContextMenu(cx, cy, items)` below; add `.filter(Boolean)` there.) Confirm the menu renderer honours `disabled` (`grep -n "m.disabled" js/app.js`).

Band row (line 4018): after the bucket tag add `(p.auto ? '<span class="band-bucket-tag band-auto" title="Auto timeline: items follow dependencies and capacity">auto</span>' : '') +`. Setup phases rows (line 9828): same span after the bucket tag.

`suCapEnable` handler: replace the commit with

```js
      commit('capacity feature', function (s2) {
        s2.meta.capacityEnabled = on;
        if (!on) s2.phases.forEach(function (p) { p.auto = false; });
      });
      toast('Capacity planning ' + (on ? 'enabled' : 'disabled' + (state.phases.some(function (p) { return p.auto; }) ? ' — Auto timeline switched off' : '')));
```

(compute the "any auto" check before the commit, since normalize clears it.)

View menu: after the `Auto-order rows by start` entry add `state.meta.capacityEnabled ? { icon: 'zap', label: 'Auto timeline is set per phase (right-click a phase band)', disabled: true, fn: function () {} } : null,`.

Expose for tests in the `ai` export object (near `openSetup:` at line ~11653): `autoTimelineNow: function () { var n = 0; commit('auto', function () { n = applyAutoRules(); }); return n; },`.

CSS after `.band-bucket-tag {...}`:

```css
.band-auto { border-color: var(--blue); color: var(--blue); }
.p-check.disabled { opacity: .55; }
```

Changelog (Unreleased):

```
- **Auto timeline**: flag a phase as Auto (phase dialog or right-click its band) and its items follow their dependencies under the roster's capacity — on open, when the flag goes on, and after every change. Needs capacity planning.
- Auto-order rows by start now also applies when a document opens.
- The Auto-schedule dialog is gone; Auto timeline and Place at earliest slot replace it.
```

- [ ] **Step 4: Run tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js && NODE_PATH=./node_modules node tests/smoke.test.js`
Expected: new smoke checks pass; the old capacity-row block (Task 6) still fails — that is expected until Task 6.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css tests/smoke.test.js CHANGELOG.md
git commit -m "feat: Auto timeline per phase — applies on open, on toggle and after every commit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: "Place at earliest slot" context-menu entry

**Files:**
- Modify: `js/app.js:6250-6300` (story and item branches of the planning row context menu); the bar context menu if separate (`grep -n "contextmenu" js/app.js | sed -n 1,40p` and find the handler for `.bar`)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: `RM.placeUnit(state, itemId, storyId, opts)`.
- Produces: `placeEntry(itemId, storyId) → menu item | null`.

- [ ] **Step 1: Write the failing smoke test**

```js
  // Place at earliest slot: right-click a feature row
  {
    window.HeadwayApp.ai.commit('cap on', (s) => { s.meta.capacityEnabled = true; });
    const row = doc.querySelector('#rows .row.item');
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const entry = [...doc.querySelectorAll('.menu .mi, .ctx .mi, [data-menu-item]')].find((el) => /Place at earliest slot/.test(el.textContent));
    ok(!!entry, 'feature context menu offers Place at earliest slot when capacity planning is on');
    doc.body.click();
    undo();
  }
```

Adjust the selector to the real menu item class (`grep -n "class=\"mi" js/app.js`).

- [ ] **Step 2: Run to verify failure**

Expected: `✗ feature context menu offers Place at earliest slot…`.

- [ ] **Step 3: Implement**

Add near `flagMenuEntries`:

```js
  // one item or story to its earliest dependency- and capacity-valid slot
  function placeEntry(itemId, storyId) {
    if (!state.meta.capacityEnabled) return null;
    var it = RM.itemById(state, itemId);
    if (!it) return null;
    return { icon: 'zap', label: 'Place at earliest slot', disabled: !!it.locked || !!it.done, fn: function () {
      var r = RM.placeUnit(state, itemId, storyId || null);
      if (r.note) { toast(r.note, 'err'); return; }
      if (!r.changed) { toast('Already at its earliest slot'); return; }
      replaceState('place', r.state);
      toast('Placed at the earliest slot');
    } };
  }
```

Insert `placeEntry(stmItemId, stmId),` into the story branch after the `Remove timeline` entry, and `placeEntry(itemId, null),` into the item branch after `Move to phase…`. Both arrays end with `.filter(Boolean)` — confirm for the item branch and add it if missing.

Changelog: `- **Place at earliest slot**: right-click any feature or story → Place at earliest slot moves just that one to the first slot its dependencies and the roster's capacity allow (any phase, capacity planning on).`

- [ ] **Step 4: Run tests** — both suites; the new check passes.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/smoke.test.js CHANGELOG.md
git commit -m "feat: Place at earliest slot on feature and story context menus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Capacity row text and the Setup → Capacity tab

**Files:**
- Modify: `js/app.js:3374-3456` (capacity row), `js/app.js:9981-10012` (Team tab: remove the Capacity types and Capacity cards), `js/app.js:10118-10128` (`SETUP_SECTIONS`), `js/app.js:10229-10245` (`suCapBasis`/`suCapUnit`/`suCapLimit` handlers → replace), `js/app.js:10429` (`suplan` click handler stays), Setup tab bodies object (add `capacity:`)
- Modify: `tests/smoke.test.js:3905-3932` (replace the old row assertions)
- Modify: `js/export-png.js` only if it reads `capLimit` (grep says no — skip)

**Interfaces:**
- Consumes: `RM.capacity(state)` cells `{ demand, supply, over, blackout, byType }`.

- [ ] **Step 1: Replace the smoke assertions** at lines 3905-3932 with

```js
  {
    const s = window.RM.clone(window.HeadwayApp.ai.state());
    s.meta.capacityEnabled = true; s.meta.planLevel = 'story'; s.meta.capMode = 'person'; s.meta.capRowTypes = 'all';
    s.team = [{ id: 'p1', name: 'A', capType: 'Design', weekHours: {}, capacity: 1 }];
    const it = s.items.find((i) => i.startDay != null && !i.milestone);
    it.stories = [{ title: 'design it', startDay: it.startDay, durDays: 5, capType: 'Design' }, { title: 'later', capType: 'Design' }];
    const capS = window.RM.capacity(window.RM.normalizeState(s));
    const wk = Math.floor(it.startDay / 5);
    ok(capS.weeks[wk].demand === 1 && capS.weeks[wk].supply === 1, 'story level: one Design story vs one Design person');
    s.items.find((i) => i.id === it.id).stories[0].capMult = 2;
    ok(window.RM.capacity(window.RM.normalizeState(s)).weeks[wk].over, 'a ×2 story over-asks a one-person pool');
    s.meta.capRowTypes = ['Development'];
    ok(!window.RM.capacity(window.RM.normalizeState(s)).weeks[wk].over, 'the row only judges the selected types');
  }
  // the header row shows demand / supply for the selected types
  window.HeadwayApp.ai.commit('cap row', (s) => {
    s.meta.capacityEnabled = true; s.meta.planLevel = 'feature'; s.meta.capMode = 'person'; s.meta.capRowTypes = 'all';
    s.team = [{ id: 'p1', name: 'A', capType: 'Development', weekHours: {}, capacity: 1 }];
    s.items.forEach((i) => { if (!i.milestone) { i.capType = 'Development'; i.capMult = 1; } });
    s.phases.forEach((p) => { p.auto = false; });
  });
  const cells = [...doc.querySelectorAll('#hdrCap .cap-cell')];
  const busy = cells.find((c) => c.classList.contains('over'));
  ok(!!busy && /Development/.test(busy.getAttribute('title')), 'an over-asked week reads over and names the type in its tooltip');
  ok(/\d+(\.\d)? \/ \d+(\.\d)?/.test(busy.textContent), 'the cell reads demand / supply');
  ok(/people|points/.test(doc.querySelector('#capTypeCell').textContent), 'the row label says the unit');
  undo();
```

- [ ] **Step 2: Run to verify failure** — `NODE_PATH=./node_modules node tests/smoke.test.js` → the cell text / title checks fail.

- [ ] **Step 3: Implement**

Capacity row (`renderHeader`, lines 3374-3456): replace from `// capacity row:` through the `$('#capTypeCell')` assignment with:

```js
    // capacity row: each week's demand vs supply for the selected capacity
    // types (Setup → Capacity), in people or points
    var cap = validation.capacity;
    var unitWord = meta.capMode === 'points' ? 'points' : 'people';
    var selTypes = meta.capRowTypes === 'all' ? cap.types : meta.capRowTypes;
    for (var w = 0; w < meta.numWeeks; w++) {
      var cell = cap.weeks[w];
      var hn = RM.holidaysInWeek(meta, w, hset);
      var cls, txt2 = '', title;
      if (cell.blackout) { cls = 'blackout'; txt2 = weekPx >= 24 ? '✕' : ''; title = 'Holiday week'; }
      else {
        var ratio = cell.supply > 0 ? cell.demand / cell.supply : (cell.demand > 0 ? Infinity : 0);
        cls = cell.over ? 'over' : (cell.demand === 0 ? 'idle' : (cell.supply > 0 && ratio > 0.85 ? 'mid' : 'ok'));
        txt2 = weekPx >= 34 ? fmtPe(cell.demand) + ' / ' + fmtPe(cell.supply) : (weekPx >= 20 ? fmtPe(cell.demand) : '');
        title = fmtPe(cell.demand) + ' ' + unitWord + ' asked · ' + fmtPe(cell.supply) + ' available';
        Object.keys(cell.byType).forEach(function (ct) {
          var bt = cell.byType[ct];
          title += ' · ' + (ct || 'untyped') + ' ' + fmtPe(bt.demand) + '/' + fmtPe(bt.supply);
        });
        if (!cap.types.length) title += ' · nobody on the roster supplies a capacity type yet';
      }
      hc.push('<div class="cap-cell ' + cls + (hn && !cell.blackout ? ' part' : '') + '" tabindex="0" data-w="' + w +
        '" style="left:' + (w * weekPx + 1) + 'px;width:' + (weekPx - 2) + 'px" title="' +
        esc('Week of ' + RM.fmtShort(RM.weekStartDate(meta, w)) + ': ' + title +
          (hn ? ' · ' + hn + ' holiday day(s)' : '') + ' · click to toggle holiday week') + '">' + txt2 + '</div>');
    }
```

and after `$('#hdrCap').innerHTML = hc.join('');`:

```js
    $('#capTypeCell').innerHTML =
      '<span class="cap-lab" title="' + esc('Each week: ' + unitWord + ' asked / available for ' +
        (meta.capRowTypes === 'all' ? 'all capacity types' : selTypes.join(', ')) + ' — Setup → Capacity') + '">' + unitWord + '</span>';
```

Keep the phase-lane code between them untouched. Remove the `loadWhat`/`unitPts`/`storyLvl` variables.

Setup tab: in `SETUP_SECTIONS` insert `['capacity', 'Capacity', 'gauge'],` after `['team', 'Team', 'users'],`. In the Team tab body delete the `Capacity types` and `Capacity` `<section>` cards (keep Roles and Work week; keep the `capTypeRows` computation — it moves). Add a `capacity:` body to `tabBodies`:

```js
      capacity:
        '<section class="su-card"><h2>Capacity planning</h2>' +
        '<label class="p-check" title="The roster limits scheduling and validation; shows the capacity row"><input type="checkbox" id="suCapEnable"' + (m.capacityEnabled ? ' checked' : '') + '> Enable capacity planning</label>' +
        '<div class="m-hint">People, their capacity type and weekly hours live in the Resources panel under the timeline. Auto timeline (per phase) and Place at earliest slot need this on.</div>' +
        '</section>' +
        '<section class="su-card"><h2>Planning level</h2><div class="su-schemes">' +
        [['feature', esc(lvl('feature', true)), 'Capacity follows the ' + esc(lvl('feature', true).toLowerCase()) + ' and their capacity type; ' + esc(lvl('story', true).toLowerCase()) + ' need no details'],
         ['story', esc(lvl('story', true)), esc(lvl('feature')) + ' bars become the hull of their ' + esc(lvl('story', true).toLowerCase()) + ' — work is planned on the ' + esc(lvl('story', true).toLowerCase()) + ' and their capacity types']].map(function (o) {
          var on = RM.planLevel(state) === o[0];
          return '<button class="su-scheme' + (on ? ' on' : '') + '" data-suplan="' + o[0] + '">' +
            '<span class="su-scheme-check"><i data-lucide="' + (on ? 'circle-check' : 'circle') + '"></i></span>' +
            '<span class="su-scheme-main"><b>' + o[1] + '</b><span>' + o[2] + '</span></span></button>';
        }).join('') + '</div></section>' +
        '<section class="su-card"><h2>Demand</h2><div class="su-schemes">' +
        [['person', 'Per person', 'A unit in flight uses one person of its capacity type, times its multiplier'],
         ['points', 'Story points', 'A unit’s points spread over its weeks; each person supplies points per sprint']].map(function (o) {
          var on = (m.capMode || 'person') === o[0];
          return '<button class="su-scheme' + (on ? ' on' : '') + '" data-sucapmode="' + o[0] + '">' +
            '<span class="su-scheme-check"><i data-lucide="' + (on ? 'circle-check' : 'circle') + '"></i></span>' +
            '<span class="su-scheme-main"><b>' + o[1] + '</b><span>' + o[2] + '</span></span></button>';
        }).join('') + '</div>' +
        (m.capMode === 'points'
          ? '<div style="margin-top:10px"><label class="p-lab">Default points per person per sprint</label>' +
            '<input type="number" id="suDefPoints" min="0" step="1" value="' + m.defaultPoints + '" style="width:140px">' +
            '<div class="m-hint">Each person can override this in the Resources panel. With sprints off, points are per two weeks.</div></div>'
          : '') +
        '</section>' +
        '<section class="su-card"><h2>Capacity types</h2>' +
        '<div class="su-rows" data-sulist="captype">' + capTypeRows + '</div>' +
        '<div class="p-row" style="margin-top:8px"><input id="suCapTypeAdd" placeholder="New capacity type, e.g. Data"><button id="suCapTypeAddBtn" class="fixed">Add</button></div>' +
        '<div class="m-hint">A ' + esc(lvl('story').toLowerCase()) + '’s capacity type says what it drains and who can take it; a person’s says what they supply. Drag the grips to reorder.</div>' +
        '</section>' +
        '<section class="su-card"><h2>Capacity row</h2>' +
        '<label class="p-check"><input type="radio" name="suCapRow" id="suCapRowAll"' + (m.capRowTypes === 'all' ? ' checked' : '') + '> All capacity types</label>' +
        '<label class="p-check"><input type="radio" name="suCapRow" id="suCapRowSome"' + (m.capRowTypes !== 'all' ? ' checked' : '') + '> Only these:</label>' +
        '<div style="margin-left:22px">' + RM.capTypesOf(state).map(function (t) {
          var on = m.capRowTypes !== 'all' && m.capRowTypes.indexOf(t) !== -1;
          return '<label class="p-check"><input type="checkbox" data-sucaprow="' + esc(t) + '"' + (on ? ' checked' : '') + (m.capRowTypes === 'all' ? ' disabled' : '') + '> ' + esc(t) + '</label>';
        }).join('') + '</div>' +
        '<div class="m-hint">The row under the header shows each week’s demand against what the roster supplies for these types.</div>' +
        '</section>',
```

Handlers: in the Setup `change` handler replace the `suCapBasis`/`suCapUnit`/`suCapLimit` blocks with

```js
    if (t.id === 'suDefPoints') {
      var dp = parseFloat(t.value);
      if (!isFinite(dp) || dp < 0) { render(); return; }
      commit('default points', function (s2) { s2.meta.defaultPoints = dp; });
      return;
    }
    if (t.id === 'suCapRowAll' || t.id === 'suCapRowSome') {
      var all = t.id === 'suCapRowAll';
      commit('capacity row types', function (s2) { s2.meta.capRowTypes = all ? 'all' : (Array.isArray(s2.meta.capRowTypes) ? s2.meta.capRowTypes : []); });
      return;
    }
    if (t.dataset.sucaprow != null) {
      var rt = t.dataset.sucaprow, rtOn = t.checked;
      commit('capacity row types', function (s2) {
        var list = Array.isArray(s2.meta.capRowTypes) ? s2.meta.capRowTypes.slice() : [];
        list = list.filter(function (x) { return x !== rt; });
        if (rtOn) list.push(rt);
        s2.meta.capRowTypes = list;
      });
      return;
    }
```

and in the Setup `click` handler next to `t.dataset.suplan`:

```js
    if (t.dataset.sucapmode) {
      var cmV = t.dataset.sucapmode;
      commit('capacity mode', function (s2) { s2.meta.capMode = cmV; });
      toast('Demand: ' + (cmV === 'points' ? 'story points' : 'per person'));
      return;
    }
```

(`t` in the click handler may be a child span — use `e.target.closest('[data-sucapmode]')` the same way `suplan` does; read that handler first.)

Update every `openSetup('team')` / `setupTab = 'team'` that pointed at capacity settings: `grep -n "'team'" js/app.js` — the Resources panel "Capacity…" entry (line ~10989) should now open `'capacity'`.

Changelog:
```
- **Setup → Capacity**: capacity planning, the planning level, the demand model, capacity types and the capacity row's types now live on their own Setup tab (Team keeps roles and the work week).
- **Demand models**: Per person (a unit in flight uses one person of its type × its multiplier) or Story points (points spread over the unit's weeks against each person's points per sprint, default 10).
- **Capacity row** reads demand / supply per week for the chosen capacity types; the hand-typed weekly limit and the count/points basis are gone — the limit is the roster.
```

- [ ] **Step 4: Run tests** — both suites pass.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/smoke.test.js CHANGELOG.md
git commit -m "feat: Setup → Capacity tab; capacity row shows demand / supply for the selected types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Capacity chips on story and feature rows, panel fields, Resources Points column

**Files:**
- Modify: `js/app.js:8896-8903` (`PL_COL_DEFS`, `PL_KEYS`), `js/app.js:8914-8921` (`plColsVisible`), `js/app.js:1979-2030` (`storyChipHtml`, `storyChipAction`), `js/app.js:2066-2080` (`itemChipAction`), `js/app.js:3878-3893` (feature row chips), `js/app.js:3915-3925` (story row chips: already map `plColsVisible()` through `storyChipHtml` — nothing to add there beyond the chip keys), `js/app.js:4680-4683` (panel People section), `js/app.js:5296-5316` (panel `stcap` dropdown — add `stmult`, `icap`, `imult`), `js/app.js:10640-10650` (`renderResources` row), `js/app.js:11013-11040` (`data-rcap` editor — add `data-rpts`)
- Modify: `css/app.css` (after `.r-size` rules)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Produces: `storyCapMenuItems(itemId, stId)`, `itemCapMenuItems(itemId)`, `inlineMultEditor(chip, cur, onSave)`.

- [ ] **Step 1: Write the failing smoke test**

```js
  // capacity chips in the Planning left pane
  {
    window.HeadwayApp.ai.commit('chips on', (s) => { s.meta.capacityEnabled = true; s.meta.planLevel = 'story'; s.meta.capMode = 'person'; });
    window.HeadwayApp.setDetailMode ? window.HeadwayApp.setDetailMode('story') : null;
    const stRow = doc.querySelector('#rows .row.story');
    ok(!!stRow && !!stRow.querySelector('.r-cap[data-act="st-cap"]'), 'story rows show a capacity type chip');
    ok(!!stRow.querySelector('.r-mult[data-act="st-mult"]'), 'and a multiplier chip in person mode');
    window.HeadwayApp.ai.commit('feature level', (s) => { s.meta.planLevel = 'feature'; });
    const itRow = doc.querySelector('#rows .row.item');
    ok(!!itRow.querySelector('.r-cap[data-act="cap"]'), 'feature rows show the chip at Features level');
    window.HeadwayApp.ai.commit('cap off', (s) => { s.meta.capacityEnabled = false; });
    ok(!doc.querySelector('#rows .r-cap'), 'no chips with capacity planning off');
    undo(); undo(); undo();
  }
```

(Find how the suite expands stories: `grep -n "detailMode\|Expand all" tests/smoke.test.js`; use the same call.)

- [ ] **Step 2: Run to verify failure** — the chip checks fail.

- [ ] **Step 3: Implement**

`PL_COL_DEFS` add `cap: ['Cap', 'Capacity type', 58], mult: ['×', 'Capacity multiplier (per-person demand)', 26]`; `PL_KEYS = ['size', 'pri', 'risk', 'dur', 'asg', 'cap', 'mult']`. In `plColsVisible`: `if (k === 'cap') return !!state.meta.capacityEnabled; if (k === 'mult') return !!state.meta.capacityEnabled && state.meta.capMode !== 'points';`.

`storyChipHtml` add:

```js
    if (key === 'cap') {
      if (!state.meta.capacityEnabled) return '';
      return '<span class="r-cap' + (st.capType ? '' : ' empty') + '" tabindex="0" role="button" ' + attr + '="st-cap" title="' +
        esc('Capacity type' + (st.capType ? '\nNow: ' + st.capType : '')) + '">' + (st.capType ? esc(shorten(st.capType, 8)) : blank) + '</span>';
    }
    if (key === 'mult') {
      if (!state.meta.capacityEnabled || state.meta.capMode === 'points') return '';
      var mv = st.capMult || 1;
      return '<span class="r-mult editable' + (mv === 1 ? ' one' : '') + '" tabindex="0" role="button" ' + attr + '="st-mult" title="Capacity multiplier — people this story needs at once">×' + fmtPe(mv) + '</span>';
    }
```

`storyChipAction`: `else if (act === 'st-cap') openDropdown(anchor, storyCapMenuItems(itemId, stId)); else if (act === 'st-mult') { var stM = storyById(RM.itemById(state, itemId) || {}, stId); inlineMultEditor(anchor, stM ? stM.capMult : 1, function (v) { commit('story multiplier', function (s) { var st2 = storyById(RM.itemById(s, itemId) || {}, stId); if (st2) st2.capMult = v; }); }); }`.

Add helpers near `storyChipAction`:

```js
  function storyCapMenuItems(itemId, stId) {
    var cur = (storyById(RM.itemById(state, itemId) || {}, stId) || {}).capType || '';
    return [{ label: '<i>— general —</i>', checked: !cur, fn: function () {
      commit('story capacity type', function (s) { var st2 = storyById(RM.itemById(s, itemId) || {}, stId); if (st2) st2.capType = ''; });
    } }].concat(RM.capTypesOf(state).map(function (t) {
      return { label: esc(t), checked: cur === t, fn: function () {
        commit('story capacity type', function (s) { var st2 = storyById(RM.itemById(s, itemId) || {}, stId); if (st2) st2.capType = t; });
      } };
    }));
  }
  function itemCapMenuItems(itemId) {
    var cur = (RM.itemById(state, itemId) || {}).capType || '';
    return [{ label: '<i>— general —</i>', checked: !cur, fn: function () {
      commit('capacity type', function (s) { RM.itemById(s, itemId).capType = ''; });
    } }].concat(RM.capTypesOf(state).map(function (t) {
      return { label: esc(t), checked: cur === t, fn: function () {
        commit('capacity type', function (s) { RM.itemById(s, itemId).capType = t; });
      } };
    }));
  }
  // × multiplier chip edits in place like the duration chip
  function inlineMultEditor(chip, cur, onSave) {
    if (chip.querySelector('input')) return;
    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0.1'; inp.step = '0.5';
    inp.value = cur != null ? cur : 1;
    inp.className = 'hc-edit'; inp.style.width = '30px';
    chip.textContent = '';
    chip.appendChild(inp);
    inp.focus(); inp.select();
    var done = false;
    var fin = function (saveIt) {
      if (done) return; done = true;
      if (!saveIt) { render(); return; }
      var v = parseFloat(inp.value);
      onSave(isFinite(v) && v > 0 ? v : 1);
    };
    inp.addEventListener('blur', function () { fin(true); });
    inp.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') fin(true);
      if (ev.key === 'Escape') fin(false);
    });
  }
```

Panel `stcap` branch: replace its inline list with `openDropdown(dd, storyCapMenuItems(it.id, stCapId));`.

Feature row `chips` object add:

```js
          cap: state.meta.capacityEnabled && RM.planLevel(state) === 'feature' && !it.milestone
            ? '<span class="r-cap' + (RM.itemCapType(state, it) ? '' : ' empty') + '" tabindex="0" role="button" data-act="cap" title="' + esc('Capacity type' + (RM.itemCapType(state, it) ? '\nNow: ' + RM.itemCapType(state, it) : '')) + '">' + (RM.itemCapType(state, it) ? esc(shorten(RM.itemCapType(state, it), 8)) : '·') + '</span>'
            : '<span class="r-cap r-blank"></span>',
          mult: state.meta.capacityEnabled && RM.planLevel(state) === 'feature' && !it.milestone && state.meta.capMode !== 'points'
            ? '<span class="r-mult editable' + ((it.capMult || 1) === 1 ? ' one' : '') + '" tabindex="0" role="button" data-act="mult" title="Capacity multiplier — people this needs at once">×' + fmtPe(it.capMult || 1) + '</span>'
            : '<span class="r-mult r-blank"></span>'
```

`itemChipAction`: `else if (act === 'cap') openDropdown(anchor, itemCapMenuItems(itemId)); else if (act === 'mult') inlineMultEditor(anchor, itA.capMult, function (v) { commit('multiplier', function (s) { RM.itemById(s, itemId).capMult = v; }); });`.

Panel (feature panel People section — find `sec2('people'` for the FEATURE panel, distinct from the story one): when `state.meta.capacityEnabled && RM.planLevel(state) === 'feature' && !it.milestone` prepend `'<label class="p-lab">Capacity type</label>' + ddButton('icap', RM.itemCapType(state, it) ? esc(RM.itemCapType(state, it)) : '<i>— general —</i>', null, 'What this feature drains at the feature planning level')` and, in person mode, `'<label class="p-lab" style="margin-top:10px">Multiplier</label><input type="number" min="0.1" step="0.5" data-if="capMult" value="' + (it.capMult || 1) + '" style="width:80px">'`. Story panel: after the `stcap` dropdown add the same multiplier input with `data-stf="capMult"`. Check how `data-if` / `data-stf` numeric fields are committed (`grep -n "dataset.stf\b" js/app.js`) and add `capMult` to the numeric whitelist there. Panel dropdown handler: add `if (which === 'icap') { openDropdown(dd, itemCapMenuItems(it.id)); return; }`.

Feature creation: in `addFeatureNear` and the other `RM.normalizeState({ ... items: [{` creation sites (lines ~6635, ~8685 — `grep -n "num: RM.nextNum(s)" js/app.js`), add `capType: s.capTypes[0] || ''` to the new item literal.

Resources panel: after the `res-cap` span add

```js
        (state.meta.capacityEnabled && state.meta.capMode === 'points'
          ? '<span class="res-cap res-pts' + (m.points == null ? ' dflt' : '') + '" tabindex="0" role="button" data-rpts="' + m.id +
            '" title="Story points per sprint (blank = document default)">' + fmtPe(RM.memberPoints(state, m)) + ' pt</span>'
          : '') +
```

Duplicate the `data-rcap` click editor as a `data-rpts` editor that writes `x.points = v` (blank → `null`) with label `'role points'`. Both handlers live in the same `resGrid` click listener; add the branch right after the `rcap` one.

CSS after `.r-size.missing`:

```css
.r-cap {
  width: 58px; flex: 0 0 58px; text-align: center;
  font-size: 10px; font-weight: 600; color: var(--ink-2);
  border: 1px solid transparent; border-radius: 5px; padding: 1px 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.r-cap:hover { border-color: var(--line-2); background: var(--surface); }
.r-cap.empty { color: var(--ink-3); }
.r-mult { width: 26px; flex: 0 0 26px; text-align: center; font-family: var(--mono); font-size: 10.5px; color: var(--ink-2); border-radius: 5px; }
.r-mult.one { color: var(--ink-3); opacity: .55; }
.row:hover .r-mult.one { opacity: 1; }
.res-pts.dflt { color: var(--ink-3); }
```

Changelog: `- Story rows in the Planning left pane show a capacity type chip and, in per-person mode, a × multiplier (feature rows too at the Features planning level); both are columns you can hide or reorder. The Resources panel gains a points column in story-points mode.`

- [ ] **Step 4: Run tests** — both suites pass.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css tests/smoke.test.js CHANGELOG.md
git commit -m "feat: capacity type and multiplier chips on rows and in the panel; points per person in Resources

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Sticky epic / workstream group bands

**Files:**
- Modify: `css/app.css:1403-1418` (`.row.eband` rules)
- Modify: `js/app.js:1439-1448` (`syncHdrH` — already sets `--band-real-h` and `--eband-real-h`)
- Test: `tests/smoke.test.js`

- [ ] **Step 1: Write the failing smoke test**

```js
  // second-level group bands pin under the phase band
  {
    window.HeadwayApp.ai.setView ? window.HeadwayApp.ai.setView('planning') : null;
    window.HeadwayApp.ai.commit('group', () => {});
    const btnOn = () => { const m = window.HeadwayApp.ai; if (m.toggleGroupEpic) m.toggleGroupEpic(true); };
    btnOn();
    const eb = doc.querySelector('#rows .row.eband');
    ok(!!eb, 'an epic band renders with group-by-epic on');
    const cs = window.getComputedStyle(eb);
    ok(cs.position === 'sticky', 'epic band is sticky');
    ok(/var\(--hdr-h\)/.test(fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8').match(/\.row\.eband\s*\{[^}]*\}/)[0]), 'sticky offset stacks under the phase band');
  }
```

Look up how the suite toggles group-by (`grep -n "groupEpic" tests/smoke.test.js`) and use that; if there is no accessor, add `setGroupEpic: function (on) { groupEpic = !!on; saveLocal(); render(); }` to the `ai` export block.

- [ ] **Step 2: Run to verify failure** — `epic band is sticky` fails.

- [ ] **Step 3: Implement CSS**

Replace the `.row.eband` block (lines 1403-1418) with:

```css
/* epic / workstream group bands pin under the phase band while their rows
   scroll; nested epics (.sub) sit one band lower under their workstream band.
   The next band of the same level slides over the stuck one. */
.row.eband { height: 26px; position: sticky; top: calc(var(--hdr-h) + var(--band-real-h, var(--band-h))); z-index: 13; }
.row.eband.sub { top: calc(var(--hdr-h) + var(--band-real-h, var(--band-h)) + var(--eband-real-h, 26px)); z-index: 12; }
.row.eband .row-left {
  background: var(--paper-2);
  border-bottom: 1px solid var(--line-2);
  padding-left: 40px;
}
.row.eband .row-lane {
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  background-image: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px var(--week-px));
}
.row.eband.wsband .row-left { padding-left: 30px; }
.row.eband.wsband .eb-name { color: var(--ink); }
.row.eband.sub .row-left { padding-left: 52px; }
```

Check `--band-h` exists in `:root` (grep); the fallback keeps the offset sane before `syncHdrH` runs. Verify visually in headless Chrome per the `headway-verification-workflow` memory: open the fixture with group-by-epic on, scroll, screenshot — the epic band must sit right under the phase band, not overlap it, and the sprint grid lines must line up with the rows.

Changelog: `- Epic and workstream group rows now stay pinned under their phase band while you scroll, like the phase band itself.`

- [ ] **Step 4: Run tests** — both suites pass.

- [ ] **Step 5: Commit**

```bash
git add css/app.css js/app.js tests/smoke.test.js CHANGELOG.md
git commit -m "feat: epic and workstream group bands stick under the phase band

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Excel columns, AI summary, and clean-up

**Files:**
- Modify: `js/excel.js:297-322` (Stories sheet), `js/excel.js:328-345` (Team sheet), `js/excel.js:514-535` (Stories read-back), `js/excel.js:750-780` (Team read-back)
- Modify: `js/ai.js:310`, `js/ai.js:313-316`, `js/ai.js:410`, `js/ai.js:806`
- Modify: `README.md` if it documents the weekly limit (`grep -n -i "weekly limit\|capacity" README.md`)
- Test: `tests/core.test.js` (Excel round-trip section — it self-skips without exceljs; `node_modules` has it)

- [ ] **Step 1: Write the failing test** (in the Excel section of `tests/core.test.js`; find `section('excel')` or the round-trip block and append)

```js
if (RMExcel) {
  var sX = mkState([{ num: 1, feature: 'f', stories: [{ title: 'a', capType: 'Design', capMult: 2 }] }],
    { team: [{ name: 'P', capType: 'Design', points: 7 }] });
  sX.meta.capMode = 'points';
  RMExcel.exportWorkbook(sX).then(function (buf) {
    return RMExcel.importWorkbook(buf);
  }).then(function (r) {
    eq(r.state.items[0].stories[0].capMult, 2, 'story multiplier survives the round trip');
    eq(r.state.team[0].points, 7, 'member points survive the round trip');
    eq(r.state.meta.capMode, 'points', 'capMode survives the round trip');
  });
}
```

Follow the existing async pattern in that section (the suite reports asynchronous results at the end — read how the existing Excel test awaits before `process.exit`).

- [ ] **Step 2: Run** — passes already if the hidden JSON carries everything (it does). Keep the test as a guard; the visible-sheet work below is for humans reading the sheet.

- [ ] **Step 3: Implement**

Stories sheet: headers gain `'Capacity type', 'Multiplier'` (columns 10, 11; widths 16 and 10); each row appends `st.capType || null, st.capMult != null && st.capMult !== 1 ? st.capMult : null`. Read-back: nothing (positional title/done only — leave as is).

Team sheet: header gains `'Points per sprint'` (column 9, width 16); row appends `m.points != null ? m.points : null`. Read-back in `parseTemplate`'s Team loop: `points: (function () { var c9 = cellText(tws.getCell(tr, 9)); return c9 !== '' && isFinite(parseFloat(c9)) ? parseFloat(c9) : null; })(),` — only if that loop builds member objects from a template (it does: `team.push({...})`). Also read `capType` there if a column exists — check whether the Team sheet writes the capacity type today; if not, leave it.

`js/ai.js`: in `schemes` add `capMode: m.capMode, defaultPoints: m.defaultPoints, planLevel: m.planLevel`; in `phases` add `auto: !!p.auto`; in `team` add `capType: t.capType || '', points: t.points`; in the tool description at line 410 replace `meta/capacityEnabled` with `meta/capacityEnabled, meta/capMode ('person'|'points'), meta/defaultPoints, meta/planLevel, phases/@id/auto (Auto timeline)`; at line 806 append ` capType = what they supply; points = story points per sprint (points mode). Capacity checks only run when meta.capacityEnabled; phases with auto=true are re-laid out by dependencies and capacity after every change.`

Grep once more for leftovers: `grep -n "capLimit\|capBasis\|capUnit\|wipWeight\|availForWeek\|autoSchedule\|snapEarliest\|focus units" js/ css/ tests/ README.md docs/*.md` — everything left must be in the changelog history or the old spec files only.

- [ ] **Step 4: Run tests** — both suites pass; then open the app in headless Chrome and export an .xlsx to confirm the new columns render.

- [ ] **Step 5: Commit**

```bash
git add js/excel.js js/ai.js tests/core.test.js README.md
git commit -m "feat: capacity fields on the Stories and Team sheets; AI summary knows the demand model and Auto phases

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §1 data model → Task 1. §2 math and row → Task 2. §3 scheduler → Task 3. §4 triggers, phase flag UI, context menus, view menu → Tasks 4–5. §4 Setup tab and row text → Task 6. §4 chips, panel, Resources points → Task 7. §4 sticky bands → Task 8. §5 Excel/AI → Task 9. §6 tests are distributed per task. §7 changelog per task.
- Names used across tasks: `RM.capSupply`, `RM.capUnits`, `RM.unitWeekDemand`, `RM.unitWorkDays`, `RM.itemCapType`, `RM.memberPoints`, `RM.capacity` (`{ weeks, teamTotal, types }`), `RM.autoTimeline`, `RM.placeUnit`, `RM.rebuildHulls`, `RM.applyUnitPlacement`, `RM.todayDay`; app-local `applyAutoRules`, `anyAutoPhase`, `placeEntry`, `storyCapMenuItems`, `itemCapMenuItems`, `inlineMultEditor`.
- `RM.riskEffortDays` returns 0 today, so `riskDays` always restretches to 0; the calls stay so a future risk buffer keeps following the bar.

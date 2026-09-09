# Story Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stories can depend on other stories (any feature), with a panel editor, timeline arrows and ports, validation, Excel/Jira/AI support.

**Architecture:** `story.deps` holds story ids. `js/core.js` owns lookup, windows, edges, cycles and validation; `js/app.js` renders the panel section, arrows and ports; `js/excel.js`, `js/jira.js`, `js/export-jira.js`, `js/ai.js` carry the field outward.

**Tech Stack:** No-build ES5 vanilla JS, jsdom smoke tests, `make test` (core / jira / ai / smoke).

**Spec:** `docs/superpowers/specs/2026-09-09-story-dependencies-design.md`

## Global Constraints

- ES5 only (no arrow functions, `let`/`const`, template strings, lookbehind regex, spread) in `js/*.js`. Tests may use modern syntax.
- Every user string that reaches `innerHTML` goes through `esc()`.
- Every document mutation in app.js goes through `commit(label, fn)`.
- Feature ↔ story links are out of scope; only story → story.
- Never `git stash` / reset; another session may edit the tree. Work only in your assigned worktree.
- Task 1 must land before Tasks 2–5 start (they consume its API).

---

### Task 1: Core model, helpers, validation

**Files:**
- Modify: `js/core.js` (normalize ~1564-1600 story object; dependencies section after `RM.depEdges` ~1955; validate ~2228-2275; `duplicateItem` lives in app.js — see Task 2)
- Test: `tests/core.test.js` (append a `section('story deps')` block before the final summary lines)

**Interfaces:**
- Produces: `RM.storyRef(state, stId) -> {it, st}|null`; `RM.storyLabel(state, ref) -> '#<num> · <title>'`; `RM.storyWindow(state, it, st) -> {startDay, endDay}|null`; `RM.resolveStoryDeps(state, st) -> {deps: [{it, st}]}`; `RM.storyDepEdges(state) -> [[depRef, ref]]`; `RM.storyCycleMembers(state) -> {stId: true}`; `RM.storyDependents(state, stId) -> [{it, st}]`; `RM.remapStoryDeps(stories, idMap)`; validation codes `STORY_CYCLE` (error), `STORY_DEP_ORDER` (warn), `STORY_DEP_UNSCHEDULED` (info) pushed to `global` with `storyId` and `itemId` fields.

- [ ] **Step 1: Failing tests**

```js
section('story deps');
{
  var sSD = mkState([
    { id: 'f1', num: 1, phaseId: 'p1', feature: 'One', startDay: 0, durDays: 5,
      stories: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', deps: ['a', 'a', 'b', 'zzz'] }] },
    { id: 'f2', num: 2, phaseId: 'p1', feature: 'Two', startDay: 10, durDays: 5,
      stories: [{ id: 'c', title: 'C', deps: ['b'], startDay: 2, durDays: 3 }] }
  ]);
  eq(sSD.items[0].stories[1].deps, ['a'], 'normalize dedupes, drops self and unknown story ids');
  eq(RM.storyRef(sSD, 'c').it.num, 2, 'storyRef finds the owning feature');
  eq(RM.storyRef(sSD, 'nope'), null, 'unknown id → null');
  eq(RM.storyLabel(sSD, RM.storyRef(sSD, 'c')), '#2 · C', 'label is feature number and story title');
  eq(RM.storyWindow(sSD, sSD.items[0], sSD.items[0].stories[0]), { startDay: 0, endDay: 5 }, 'a story without a timeline takes the feature bar');
  eq(RM.storyWindow(sSD, sSD.items[1], sSD.items[1].stories[0]), { startDay: 2, endDay: 5 }, 'a story with a timeline uses it');
  eq(RM.resolveStoryDeps(sSD, sSD.items[1].stories[0]).deps.map(function (r) { return r.st.id; }), ['b'], 'resolveStoryDeps returns refs');
  eq(RM.storyDepEdges(sSD).map(function (e) { return e[0].st.id + '>' + e[1].st.id; }), ['a>b', 'b>c'], 'every explicit edge, dep first');
  eq(RM.storyDependents(sSD, 'b').map(function (r) { return r.st.id; }), ['c'], 'dependents are the stories listing this one');
  var vSD = RM.validate(sSD);
  ok(vSD.global.some(function (g) { return g.code === 'STORY_DEP_ORDER' && g.storyId === 'c' && /"C" under #2 starts before "B" under #1/.test(g.msg); }),
    'STORY_DEP_ORDER: c (days 2–5) starts before b (feature window 0–5) finishes');
  var sCyc = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', stories: [{ id: 'x', title: 'X', deps: ['y'] }, { id: 'y', title: 'Y', deps: ['x'] }] }]);
  eq(RM.storyCycleMembers(sCyc), { x: true, y: true }, 'cycle members');
  ok(RM.validate(sCyc).global.filter(function (g) { return g.code === 'STORY_CYCLE'; }).length === 2, 'both cycle members get STORY_CYCLE');
  var sUn = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', startDay: 0, durDays: 5, stories: [{ id: 'p', title: 'P', startDay: null, durDays: null }] },
    { id: 'g', num: 2, phaseId: 'p2', feature: 'G', stories: [{ id: 'q', title: 'Q', deps: ['p'], startDay: 3, durDays: 2 }] }]);
  // p rides on f's bar (0–5) so it IS scheduled; move f off the timeline to test the info
  sUn.items[0].startDay = null; sUn.items[0].durDays = null;
  ok(RM.validate(sUn).global.some(function (g) { return g.code === 'STORY_DEP_UNSCHEDULED' && g.storyId === 'q'; }), 'a scheduled story depending on an unscheduled one gets the info');
  var sDone = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', startDay: 0, durDays: 5, stories: [{ id: 'd', title: 'D', done: true }, { id: 'e', title: 'E', deps: ['d'], startDay: 1, durDays: 1 }] }]);
  ok(!RM.validate(sDone).global.some(function (g) { return g.code === 'STORY_DEP_ORDER'; }), 'a done dependency never violates order');
  var mapped = [{ id: 'n1', title: 'A', deps: ['o2', 'ext'] }, { id: 'n2', title: 'B', deps: [] }];
  RM.remapStoryDeps(mapped, { o1: 'n1', o2: 'n2' });
  eq(mapped[0].deps, ['n2', 'ext'], 'remapStoryDeps rewrites ids inside the copy and keeps outside ids');
}
```

- [ ] **Step 2: Run** `node tests/core.test.js` — expect failures on every new assertion (`RM.storyRef is not a function`, deps not normalized).

- [ ] **Step 3: Implement** in `js/core.js`.

In the story normalizer (the object literal built inside `stories: (it.stories || []).map(function (s) { … })`), add after `tags:`:

```js
            // story → story dependencies: ids of other stories (any feature);
            // self and duplicates drop here, ids that resolve to no story are
            // pruned in a second pass once every story id is known
            deps: (function () {
              var seen = {}, out = [];
              (Array.isArray(s.deps) ? s.deps : []).forEach(function (d) {
                var id = d == null ? '' : String(d);
                if (!id || id === s.id || seen[id]) return;
                seen[id] = true;
                out.push(id);
              });
              return out;
            })(),
```

After the items map completes (before `return state;` at the end of `normalizeState`, next to the other cross-item passes), add the prune:

```js
    // story deps may only point at stories that exist
    var storyIds = {};
    state.items.forEach(function (it) { it.stories.forEach(function (st) { storyIds[st.id] = true; }); });
    state.items.forEach(function (it) {
      it.stories.forEach(function (st) { st.deps = st.deps.filter(function (d) { return storyIds[d]; }); });
    });
```

After `RM.depEdges`:

```js
  // ------------------------------------------------------------ story dependencies
  // stories depend on stories (any feature) by id
  RM.storyRef = function (state, stId) {
    for (var i = 0; i < state.items.length; i++) {
      var sts = state.items[i].stories || [];
      for (var j = 0; j < sts.length; j++) if (sts[j].id === stId) return { it: state.items[i], st: sts[j] };
    }
    return null;
  };
  RM.storyLabel = function (state, ref) {
    return '#' + ref.it.num + ' · ' + (ref.st.title || '(untitled)');
  };
  // the days a story occupies: its own timeline, else its feature's bar
  RM.storyWindow = function (state, it, st) {
    if (st.startDay != null && st.durDays != null) return { startDay: st.startDay, endDay: st.startDay + Math.max(1, st.durDays) };
    if (it.startDay != null && it.durDays != null) return { startDay: it.startDay, endDay: it.startDay + RM.itemSpan(it) };
    return null;
  };
  RM.resolveStoryDeps = function (state, st) {
    var out = { deps: [] };
    (st.deps || []).forEach(function (id) {
      var ref = RM.storyRef(state, id);
      if (ref && ref.st.id !== st.id) out.deps.push(ref);
    });
    return out;
  };
  RM.storyDepEdges = function (state) {
    var edges = [];
    state.items.forEach(function (it) {
      (it.stories || []).forEach(function (st) {
        RM.resolveStoryDeps(state, st).deps.forEach(function (dep) { edges.push([dep, { it: it, st: st }]); });
      });
    });
    return edges;
  };
  RM.storyDependents = function (state, stId) {
    var out = [];
    state.items.forEach(function (it) {
      (it.stories || []).forEach(function (st) { if ((st.deps || []).indexOf(stId) !== -1) out.push({ it: it, st: st }); });
    });
    return out;
  };
  RM.storyCycleMembers = function (state) {
    var adj = {};
    state.items.forEach(function (it) { (it.stories || []).forEach(function (st) { adj[st.id] = (st.deps || []).slice(); }); });
    var color = {}, members = {};
    function visit(id, stack) {
      if (color[id] === 2) return;
      if (color[id] === 1) { for (var k = stack.indexOf(id); k < stack.length; k++) members[stack[k]] = true; return; }
      color[id] = 1; stack.push(id);
      (adj[id] || []).forEach(function (d) { if (adj[d]) visit(d, stack); });
      stack.pop(); color[id] = 2;
    }
    Object.keys(adj).forEach(function (id) { visit(id, []); });
    return members;
  };
  // after duplicating a feature: stories got fresh ids, deps among them follow
  RM.remapStoryDeps = function (stories, idMap) {
    stories.forEach(function (st) {
      st.deps = (st.deps || []).map(function (d) { return idMap[d] || d; });
    });
  };
```

Check the existing `RM.cycleMembers` first and mirror its exact algorithm if it differs from the sketch above (same semantics: every node on a cycle is a member).

In `RM.validate`, inside the `state.items.forEach(function (it) { … })` loop after the feature dep checks, add:

```js
      var stCyc = storyCycles || (storyCycles = RM.storyCycleMembers(state));
      (it.stories || []).forEach(function (st) {
        var sl = '"' + (st.title || '(untitled)') + '" under #' + it.num;
        if (stCyc[st.id]) global.push({ level: 'error', code: 'STORY_CYCLE', storyId: st.id, itemId: it.id, msg: RM.levelLabel(state, 'story') + ' ' + sl + ' is part of a dependency cycle' });
        var win = RM.storyWindow(state, it, st);
        if (!win) return;
        RM.resolveStoryDeps(state, st).deps.forEach(function (dep) {
          if (dep.st.done) return;
          var dl = '"' + (dep.st.title || '(untitled)') + '" under #' + dep.it.num;
          var dw = RM.storyWindow(state, dep.it, dep.st);
          if (!dw) global.push({ level: 'info', code: 'STORY_DEP_UNSCHEDULED', storyId: st.id, itemId: it.id, msg: RM.levelLabel(state, 'story') + ' ' + sl + ' depends on ' + dl + ', which is not scheduled' });
          else if (win.startDay < dw.endDay) global.push({ level: 'warn', code: 'STORY_DEP_ORDER', storyId: st.id, itemId: it.id, msg: RM.levelLabel(state, 'story') + ' ' + sl + ' starts before ' + dl + ' finishes' });
        });
      });
```

Declare `var storyCycles = null;` next to `cyclic` at the top of `validate`. Confirm `global` entries with extra fields do not break `v.counts` or the validation report rendering (grep `global.forEach` / `.global` in app.js).

- [ ] **Step 4: Run** `node tests/core.test.js` — all pass. Then `make test` — all four suites pass (the smoke fixture has no story deps; nothing else should move).

- [ ] **Step 5: Commit** `feat(core): story-to-story dependencies — model, windows, cycles, validation`

---

### Task 2: Story panel Dependencies section + duplicate remap

**Files:**
- Modify: `js/app.js` — story panel builder (~4440-4480, the `sec2(...)` chain), panel click handler (~4945-4980 where `data-deprm` / `data-rdep` / `data-depgo` are handled), dep search (`$('#panel').addEventListener('input', …)` for `data-f="depsearch"` ~6180), `duplicateItem` (~6240)
- Test: `tests/smoke.test.js` (append a block before the `story panel estimate buttons` block)

**Interfaces:**
- Consumes: Task 1 API.
- Produces: panel markup `sec2('st-deps', 'Dependencies', …)` with `.dep-chip[data-stdepgo="<stId>"]`, `button.x[data-stdeprm="<stId>"]`, `button.x[data-strdep="<stId>"]`, `input[data-stf="stdepsearch"]` + `.dep-sug` with `button[data-addstdep="<stId>"]`.

- [ ] **Step 1: Failing smoke test**

```js
// ---------------------------------------------------------------- story dependencies in the panel
{
  const hosts = state().items.filter(i => !i.milestone).slice(0, 2);
  window.HeadwayApp.ai.commit('story dep fixture', (s) => {
    const f0 = window.RM.itemById(s, hosts[0].id), f1 = window.RM.itemById(s, hosts[1].id);
    f0.stories = f0.stories || []; f1.stories = f1.stories || [];
    f0.stories.push({ id: 'sd_a', title: 'Dep story alpha', done: false });
    f1.stories.push({ id: 'sd_b', title: 'Dep story beta', done: false });
  });
  window.__headway.selectItem(hosts[1].id);
  click(doc.querySelector('#panel [data-pst-edit="sd_b"]'));
  const sec = doc.querySelector('#panel .p-sec[data-sec="st-deps"]');
  ok(!!sec, 'the story panel has a Dependencies section');
  const secs = [...doc.querySelectorAll('#panel .p-sec')].map(e => e.dataset.sec);
  ok(secs.indexOf('st-deps') > secs.indexOf('st-schedule') && secs.indexOf('st-deps') < secs.indexOf('st-integrations'), 'it sits between Timeline and Integrations');
  if (!sec.classList.contains('open')) click(doc.querySelector('#panel [data-sectoggle="st-deps"]'));
  const search = doc.querySelector('#panel input[data-stf="stdepsearch"]');
  ok(!!search, 'the section offers a search box');
  search.value = 'alpha';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  const hit = doc.querySelector('#panel .dep-sug button[data-addstdep="sd_a"]');
  ok(!!hit && /#\d+/.test(hit.textContent) && /alpha/.test(hit.textContent), 'typing a story title suggests it with its feature number');
  click(hit);
  const depsOf = (id) => window.RM.storyRef(state(), id).st.deps;
  ok(String(depsOf('sd_b')) === 'sd_a', 'picking the suggestion adds the dependency');
  ok(!!doc.querySelector('#panel .dep-chip[data-stdepgo="sd_a"]'), 'the dependency shows as a chip');
  click(doc.querySelector('#panel .dep-chip[data-stdepgo="sd_a"]'));
  ok(!!doc.querySelector('#panel .p-crumb') && /alpha/.test(doc.querySelector('#panel textarea[data-stf="title"]').value), 'clicking the chip opens that story');
  ok(!!doc.querySelector('#panel .dep-chip button[data-strdep="sd_b"]'), 'the other side lists the dependent');
  click(doc.querySelector('#panel .dep-chip button[data-strdep="sd_b"]'));
  ok(depsOf('sd_b').length === 0, 'removing from the dependent side clears the link');
  window.HeadwayApp.ai.commit('story dep fixture cleanup', (s) => {
    [hosts[0].id, hosts[1].id].forEach((id) => { const f = window.RM.itemById(s, id); f.stories = f.stories.filter(x => x.id !== 'sd_a' && x.id !== 'sd_b'); });
  });
}
{
  // duplicating a feature keeps story deps inside the copy pointing at the copy
  const host = state().items.find(i => !i.milestone);
  window.HeadwayApp.ai.commit('dup dep fixture', (s) => {
    const f = window.RM.itemById(s, host.id);
    f.stories.push({ id: 'dd_1', title: 'first', done: false }, { id: 'dd_2', title: 'second', done: false, deps: ['dd_1'] });
  });
  const nBefore = state().items.length;
  const row = doc.querySelector('#rows .row.item[data-id="' + host.id + '"]');
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  click([...doc.querySelectorAll('#popover .menu-list button')].find(b => /^Duplicate$/.test(b.textContent.trim())));
  const copy = state().items[state().items.findIndex(i => i.id === host.id) + 1];
  ok(state().items.length === nBefore + 1 && copy && copy.id !== host.id, 'the feature is duplicated');
  const c1 = copy.stories.find(s => s.title === 'first'), c2 = copy.stories.find(s => s.title === 'second');
  ok(c1 && c2 && String(c2.deps) === c1.id && c1.id !== 'dd_1', 'the copied story depends on the copied story, not the original');
  window.HeadwayApp.ai.commit('dup dep cleanup', (s) => {
    s.items = s.items.filter(i => i.id !== copy.id);
    const f = window.RM.itemById(s, host.id); f.stories = f.stories.filter(x => x.id !== 'dd_1' && x.id !== 'dd_2');
  });
}
```

Confirm the real `data-sec` keys of the story panel (they are `st-` prefixed: check `sec2` — it prefixes `st-`) and the exact Duplicate label before relying on them.

- [ ] **Step 2: Run smoke** — new assertions fail.

- [ ] **Step 3: Implement.** In the story panel builder, before `sec2('schedule', 'Timeline', timeline)` build:

```js
    var stDepChips = RM.resolveStoryDeps(state, st).deps.map(function (ref) {
      return '<span class="dep-chip" data-stdepgo="' + ref.st.id + '" title="' + esc(ref.st.title) + '"><i>#' + ref.it.num + '</i> ' +
        esc(shorten(ref.st.title || '(untitled)', 26)) + '<button class="x" data-stdeprm="' + ref.st.id + '"><i data-lucide="x"></i></button></span>';
    }).join('');
    var stDependentChips = RM.storyDependents(state, st.id).map(function (ref) {
      return '<span class="dep-chip" data-stdepgo="' + ref.st.id + '" title="' + esc(ref.st.title) + '"><i>#' + ref.it.num + '</i> ' +
        esc(shorten(ref.st.title || '(untitled)', 26)) + '<button class="x" data-strdep="' + ref.st.id + '" title="Remove this link"><i data-lucide="x"></i></button></span>';
    }).join('');
    var stDeps =
      '<label class="p-lab">Depends on</label>' +
      '<div class="chips">' + stDepChips + (stDepChips ? '' : '<span class="p-none">none</span>') + '</div>' +
      '<div class="dep-search"><input data-stf="stdepsearch" placeholder="Add a ' + esc(lvl('story').toLowerCase()) + ' by name…" autocomplete="off"><div class="dep-sug" hidden></div></div>' +
      '<label class="p-lab" style="margin-top:10px">Depended on by</label>' +
      '<div class="chips">' + stDependentChips + (stDependentChips ? '' : '<span class="p-none">none</span>') + '</div>';
```

Insert `sec2('deps', 'Dependencies', stDeps) +` between the Timeline and Integrations sections (check what key `sec2` turns into `data-sec` — the test expects `st-deps`). Mirror the feature section's markup for `.dep-search` (look at the feature panel's search markup near `data-f="depsearch"` and copy its wrapper classes).

Panel click handler (inside the block that already resolves `stf`, before the generic `return`): handle `[data-stdepgo]` → `selectStory(ref.it.id, ref.st.id)`; `[data-stdeprm]` → commit `remove story dep` filtering `st.deps`; `[data-strdep]` → commit `remove story dependent` filtering the other story's deps. Put these checks **before** the generic `[data-stf]` early return (same lesson as the estimate buttons).

Search input handler: extend the existing `$('#panel').addEventListener('input', …)`: if `e.target.dataset.stf === 'stdepsearch'` and `selStory`, collect hits over every story of every item (skip itself and ids already in deps), matching story title or feature title, up to 8, render `<button data-addstdep="<id>"><i>#<num></i> <title> <em><feature></em></button>`, or `.dep-sug-none` "No match". Click on `[data-addstdep]` → `addStoryDep(itemId, selStory, id)`:

```js
  function addStoryDep(itemId, stId, depId) {
    var ref = RM.storyRef(state, depId);
    if (!ref || depId === stId) return;
    var me = storyById(RM.itemById(state, itemId) || {}, stId);
    if (!me) return;
    if (me.deps.indexOf(depId) !== -1) { toast('Already depends on ' + RM.storyLabel(state, ref)); return; }
    commit('add story dep', function (s) {
      var st2 = storyById(RM.itemById(s, itemId) || {}, stId);
      if (st2) st2.deps.push(depId);
    });
    toast('“' + (me.title || 'Story') + '” now depends on ' + RM.storyLabel(state, ref));
  }
```

`duplicateItem`: build `idMap` old → new while regenerating story ids, then `RM.remapStoryDeps(copy.stories, idMap)`.

- [ ] **Step 4: Run** `make test` — all pass.

- [ ] **Step 5: Commit** `feat: story panel Dependencies section; duplicate keeps story deps inside the copy`

---

### Task 3: Planning arrows and ports for story bars

**Files:**
- Modify: `js/app.js` — `renderArrows` (~3990), `barRect` (~3980), `deleteSelectedEdge` (~4035), story bar markup (~3846), `portDragMove` / `portDragEnd` / `startPortDrag` (~6767-6830), pointerdown (~6720)
- Modify: `css/app.css` — `.st-bar .port` sizing if the feature port rules do not apply to story bars
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: Task 1 API.
- Produces: `g.edge[data-sfrom][data-sto]` story edges in `#arrowPaths`; ports `.st-bar .port[data-port]`.

- [ ] **Step 1: Failing smoke test**

```js
// ---------------------------------------------------------------- story dependency arrows and ports
{
  click(doc.querySelector('#viewTabs [data-view="planning"]'));
  const host = state().items.find(i => !i.milestone && i.startDay != null);
  window.HeadwayApp.ai.commit('story arrow fixture', (s) => {
    const f = window.RM.itemById(s, host.id);
    f.stories.push({ id: 'ar_1', title: 'arrow one', done: false, startDay: f.startDay, durDays: 2 },
      { id: 'ar_2', title: 'arrow two', done: false, startDay: f.startDay, durDays: 2, deps: ['ar_1'] });
  });
  click(doc.querySelector('#detailBtn'));
  click(doc.querySelector('#popover .menu-list [data-mi="1"]')); // story detail: bars visible
  ok(!!doc.querySelector('#rows .st-bar[data-stbar="ar_1"] .port[data-port="out"]') && !!doc.querySelector('#rows .st-bar[data-stbar="ar_2"] .port[data-port="in"]'),
    'story bars carry in/out ports');
  const edge = doc.querySelector('#arrowPaths g.edge[data-sfrom="ar_1"][data-sto="ar_2"]');
  ok(!!edge, 'a story dependency draws an arrow between the two story bars');
  ok(edge.classList.contains('viol'), 'starting on the same day as the dependency marks the arrow as a violation');
  click(edge.querySelector('path.hit'));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  ok(window.RM.storyRef(state(), 'ar_2').st.deps.length === 0, 'selecting the arrow and pressing Delete removes the story dependency');
  window.HeadwayApp.ai.commit('story arrow cleanup', (s) => { const f = window.RM.itemById(s, host.id); f.stories = f.stories.filter(x => x.id !== 'ar_1' && x.id !== 'ar_2'); });
  click(doc.querySelector('#detailBtn'));
  click(doc.querySelector('#popover .menu-list [data-mi="0"]'));
}
```

jsdom has no layout, so `getBoundingClientRect` returns zeros — check how the existing arrow tests cope (grep `g.edge` in the smoke test) and follow the same approach (arrows render even at zero geometry; if `barRect` returns null for a missing element, that is the only guard).

- [ ] **Step 2: Run smoke** — fails.

- [ ] **Step 3: Implement.**

`storyBarRect(stId)`: same as `barRect` but `[data-stbar="…"]`.

In `renderArrows`, after the feature edges loop:

```js
    RM.storyDepEdges(state).forEach(function (e) {
      var dep = e[0], ref = e[1];
      var a = storyBarRect(dep.st.id), b = storyBarRect(ref.st.id);
      if (!a || !b) return; // only between two visible story bars
      var dw = RM.storyWindow(state, dep.it, dep.st), w = RM.storyWindow(state, ref.it, ref.st);
      var viol = w && dw && w.startDay < dw.endDay && !dep.st.done;
      var related = selStory && (selStory === dep.st.id || selStory === ref.st.id);
      var edgeSel = selectedEdge && selectedEdge.sfrom === dep.st.id && selectedEdge.sto === ref.st.id;
      var d = curvePath(a.right + 1, a.cy, b.left - 3, b.cy);
      out.push('<g class="edge story' + (viol ? ' viol' : '') + (related ? ' sel-related' : '') + (edgeSel ? ' hot' : '') +
        '" data-sfrom="' + dep.st.id + '" data-sto="' + ref.st.id + '" data-explicit="true">' +
        '<path class="hit" d="' + d + '"></path><path class="vis" d="' + d + '"></path></g>');
    });
```

Arrow click: if `g.dataset.sfrom` set `selectedEdge = { sfrom, sto }` else the feature shape. `deleteSelectedEdge`: when `selectedEdge.sfrom`, commit `remove story dep` on the `sto` story; toast with `RM.storyLabel`.

Story bar markup: append the same two port spans as feature bars (`ports` string near ~3564 — reuse it) inside the `.st-bar` div after the label. CSS: check `.bar .port` rules and add `.st-bar .port` equivalents scaled to the bar height (story bars are shorter — look at `.st-bar` height in css).

Pointerdown: before the `[data-stbar]` drag branch, if `portEl && stBarEl` → `startPortDrag(e, stBarEl.dataset.stbar, portEl.dataset.port, 'story')`. `startPortDrag` gains a `kind2` argument stored as `drag.story = true`; `portDragMove` uses `storyBarRect` when `drag.story`, and resolves the target from `under.closest('[data-stbar],.row.story[data-story]')` → `tid = dataset.stbar || dataset.story`; highlight `.st-bar.link-target`. `portDragEnd`: when `drag.story`, resolve both ends with `RM.storyRef`, refuse self, refuse a feature target with `toast('Stories link to stories — drop on a story bar or row')`, else push the dep on the dependent story (`commit('link stories', …)`) and toast with labels.

`cancelPortDrag` clears `.st-bar.link-target` too.

- [ ] **Step 4: Run** `make test` — all pass.

- [ ] **Step 5: Commit** `feat: story dependency arrows and ports on the Planning timeline`

---

### Task 4: Excel column, Jira links, Jira CSV

**Files:**
- Modify: `js/excel.js` (Stories sheet write ~293-315; read ~712-732 header guard only), `js/jira.js` (~364-375 links; apply step 4 keyOf ~764-768), `js/export-jira.js` (~104 story `Blocked By`)
- Test: `tests/jira.test.js` (plan + apply sections), `tests/smoke.test.js` (export round-trip block; find where the Stories sheet Tags column is asserted, grep `Tags` around the ExcelJS export test, and extend)

**Interfaces:**
- Consumes: Task 1 API (`RM.resolveStoryDeps`, `RM.storyLabel`).
- Produces: Stories sheet column 8 `Depends on`; `plan.links` entries `{ blockerId: <storyId>, blockedId: <storyId>, story: true }`; CSV `Blocked By` for stories.

- [ ] **Step 1: Failing tests.** In `tests/jira.test.js` the fixture `state` has stories `s1`, `s2` (keyed `HW-20`), `s3`. Add a dep `s3.deps = ['s2']` in the fixture (check the fixture builder near the top) and assert:

```js
ok(plan.links.some(function (l) { return l.story && l.blockerId === 's2' && l.blockedId === 's3'; }), 'a story dependency plans a story link');
```

and in the apply section (where `links` are collected from `calls`), assert a second `issueLink` call with `outwardIssue HW-20` and the created key of `s3` (look at how the test fakes the created keys). If the milestone-dependency assertion `plan.links.length === 1` now sees 2, change it to count feature links only (`!l.story`).

Smoke: after the existing workbook export assertions, add a check that the Stories sheet header cell (1,8) is `Depends on` and that a story with a dep exports `#<num> · <title>`.

- [ ] **Step 2: Run** `node tests/jira.test.js` and smoke — fail.

- [ ] **Step 3: Implement.**

excel.js write: header gains `'Depends on'`, `sws.getColumn(8).width = 30`, row value `RM.resolveStoryDeps(state, st).deps.map(function (r) { return RM.storyLabel(state, r); }).join('; ') || null`. Read: nothing to parse (ids live in the JSON); leave a comment saying so next to the Tags guard.

jira.js plan: after the feature links loop, when `cfg.pushStories`:

```js
      work.forEach(function (it) {
        if (!cfg.pushStories) return;
        it.stories.forEach(function (st) {
          RM.resolveStoryDeps(state, st).deps.forEach(function (dep) {
            if (!workId[dep.it.id]) return;
            plan.links.push({ story: true, blockerId: dep.st.id, blockedId: st.id, blockerTitle: dep.st.title, blockedTitle: st.title });
          });
        });
      });
```

apply step 4: add `plan.stories.forEach(function (s) { if (s.key) keyOf[s.id] = s.key; })` and `plan.updates.forEach(function (u) { if (u.kind === 'story') keyOf[u.id] = u.key; })` so story ids resolve (feature and story ids never collide: `i` vs `s` prefixes).

export-jira.js: story rows `'Blocked By': RM.resolveStoryDeps(state, s).deps.map(function (r) { return r.st.jiraKey; }).filter(Boolean).join(' ')`.

- [ ] **Step 4: Run** `make test` — all pass.

- [ ] **Step 5: Commit** `feat: story dependencies in the Stories sheet, Jira links and Jira CSV`

---

### Task 5: AI tools and docs

**Files:**
- Modify: `js/ai.js` (`itemFull` ~276; `mergeFields` `deps` branch ~477; tool descriptions ~383/395; GUIDE story line ~759), `README.md` (Dependencies row ~101), `CHANGELOG.md` (Unreleased)
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: Task 1 API.

- [ ] **Step 1: Failing tests** (in the `— tools` area, after the update_items assertions; `freshState` has story `s1` under #1 — add a second story `s2` to #2 in `freshState` if there is none, or create one via `add_items`):

```js
  var stDep = AI.runTool('update_items', { updates: [{ num: 1, story: 's1', fields: { deps: ['s2', 'nope'] } }] }, A);
  eq(RM.storyRef(st, 's1').st.deps, ['s2'], 'story deps are set from ids; unknown ids drop');
  var fullSt = AI.runTool('get_project', { part: 'items', nums: [1] }, A).items[0].stories[0];
  eq(fullSt.deps, ['s2'], 'get_project items reports story deps');
  ok(/deps.*story ids/i.test(AI.toolByName('update_items').description), 'the update tool documents story deps');
```

- [ ] **Step 2: Run** `node tests/ai.test.js` — fail.

- [ ] **Step 3: Implement.** `mergeFields` `deps` branch: `if (isStory) target.deps = (Array.isArray(v) ? v : [v]).map(String); else …existing…`. `itemFull` story map: `if (s.deps && s.deps.length) so.deps = s.deps.slice();` (clone already copies it; verify and keep just the assertion). Tool descriptions: story fields list gains `deps (story ids this one depends on)`. GUIDE story line gains `deps (ids of stories it depends on, any feature)`. README Dependencies row: append "Stories depend on stories the same way: the story panel's Dependencies section, ports on story bars, arrows between them." CHANGELOG Unreleased: `- **Story dependencies**: a story can depend on any other story. Add one in the story panel's Dependencies section or drag a story bar's edge circle onto another story; arrows and order warnings work like features; links push to Jira.`

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat(ai): story deps in tools; docs`

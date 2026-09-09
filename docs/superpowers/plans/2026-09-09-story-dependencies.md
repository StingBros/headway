# Story Numbers and Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stories get numbers from the feature pool and can depend on other stories, with a panel editor, timeline arrows and ports, validation, Excel/Jira/AI support.

**Architecture:** `story.num` (shared pool) and `story.deps` (story numbers). `js/core.js` owns numbering, lookup, windows, edges, cycles and validation; `js/app.js` shows numbers everywhere a story is listed and renders the panel section, arrows and ports; `js/excel.js`, `js/jira.js`, `js/export-jira.js`, `js/ai.js` carry the fields outward.

**Tech Stack:** No-build ES5 vanilla JS, jsdom smoke tests, `make test` (core / jira / ai / smoke).

**Spec:** `docs/superpowers/specs/2026-09-09-story-dependencies-design.md`

## Global Constraints

- ES5 only in `js/*.js` (no arrow functions, `let`/`const`, template strings, lookbehind regex, spread). Tests may use modern syntax.
- Every user string that reaches `innerHTML` goes through `esc()`.
- Every document mutation in app.js goes through `commit(label, fn)`.
- Feature ↔ story links are out of scope; only story → story.
- Never `git stash` / reset; another session may edit the tree. Work only in your assigned worktree.
- Task 1 lands before Tasks 2–6; Task 2 lands before Tasks 3–4 (they show story numbers). Tasks 3, 4, 5, 6 can run in parallel worktrees branched from the Task 2 commit.
- `tests/core.test.js`: new blocks go INSIDE `finish()` (before its final summary `console.log`, ~line 1436); code after `finish()`'s closing brace runs before it.

---

### Task 1: Core — story numbers, dependency model, validation

**Files:**
- Modify: `js/core.js` — story normalizer (~1564-1600), unique-num pass (~1610-1622), `RM.nextNum` (~1820), `RM.itemByNum` area (~1810), `RM.renumberItem` (~2565-2582), dependencies section after `RM.depEdges` (~1955), `RM.validate` (~2228-2275)
- Test: `tests/core.test.js` (inside `finish()`)

**Interfaces:**
- Produces: everything under "Core API" in the spec, plus validation codes `STORY_UNKNOWN_DEP`, `STORY_CYCLE`, `STORY_DEP_ORDER`, `STORY_DEP_UNSCHEDULED`.

- [ ] **Step 1: Failing tests** (paste inside `finish()` before the summary line):

```js
section('story numbers');
{
  var sN = mkState([
    { id: 'f1', num: 1, phaseId: 'p1', feature: 'One', stories: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', num: 7 }] },
    { id: 'f2', num: 3, phaseId: 'p1', feature: 'Two', stories: [{ id: 'c', title: 'C', num: 3 }] }
  ]);
  eq(sN.items[0].stories.map(function (s) { return s.num; }), [4, 7], 'stories without a number get the next free ones after the features');
  eq(sN.items[1].stories[0].num, 8, 'a story number that collides with a feature is reassigned');
  eq(RM.nextNum(sN), 9, 'nextNum spans features and stories');
  eq(RM.storyByNum(sN, 7).st.id, 'b', 'storyByNum finds a story');
  eq(RM.storyByNum(sN, 1), null, 'a feature number is not a story');
  eq(RM.byNum(sN, 1).kind, 'feature', 'byNum: feature');
  eq(RM.byNum(sN, 8).kind + ':' + RM.byNum(sN, 8).st.id, 'story:c', 'byNum: story');
  eq(RM.byNum(sN, 99), null, 'byNum: nothing');
  eq(RM.renumberItem(sN, 'f2', 7), 9, 'renumbering a feature onto a story number falls back to the next free one');
  sN.items[1].stories[0].deps = [7];
  eq(RM.renumberStory(sN, 'f1', 'b', 20), 20, 'renumberStory takes a free number');
  eq(sN.items[1].stories[0].deps, [20], 'story deps follow the renumbered story');
  eq(RM.renumberStory(sN, 'f1', 'a', 20), 21, 'a taken number falls back to nextNum');
}
section('story deps');
{
  var sSD = mkState([
    { id: 'f1', num: 1, phaseId: 'p1', feature: 'One', startDay: 0, durDays: 5,
      stories: [{ id: 'a', title: 'A', num: 10 }, { id: 'b', title: 'B', num: 11, deps: [10, '10', 11, 99, 1] }] },
    { id: 'f2', num: 2, phaseId: 'p1', feature: 'Two', startDay: 10, durDays: 5,
      stories: [{ id: 'c', title: 'C', num: 12, deps: [11], startDay: 2, durDays: 3 }] }
  ]);
  eq(sSD.items[0].stories[1].deps, [10, 99, 1], 'normalize keeps numeric unique deps, drops self, keeps unknown');
  var rb = RM.resolveStoryDeps(sSD, sSD.items[0].stories[1]);
  eq(rb.deps.map(function (r) { return r.st.id; }), ['a'], 'resolveStoryDeps returns refs');
  eq(rb.unknown, [99, 1], 'unknown numbers — including a feature number — are reported');
  eq(RM.storyLabel(sSD, RM.storyRef(sSD, 'c')), '#12 · C', 'label is the story number and title');
  eq(RM.storyWindow(sSD, sSD.items[0], sSD.items[0].stories[0]), { startDay: 0, endDay: 5 }, 'a story without a timeline takes the feature bar');
  eq(RM.storyWindow(sSD, sSD.items[1], sSD.items[1].stories[0]), { startDay: 2, endDay: 5 }, 'a story with a timeline uses it');
  eq(RM.storyDepEdges(sSD).map(function (e) { return e[0].st.id + '>' + e[1].st.id; }), ['a>b', 'b>c'], 'every explicit edge, dep first');
  eq(RM.storyDependents(sSD, sSD.items[0].stories[1]).map(function (r) { return r.st.id; }), ['c'], 'dependents list this story');
  var vSD = RM.validate(sSD);
  ok(vSD.global.some(function (g) { return g.code === 'STORY_DEP_ORDER' && g.storyId === 'c' && /#12 "C" starts before #11 "B"/.test(g.msg); }), 'STORY_DEP_ORDER names both ends by number');
  ok(vSD.global.filter(function (g) { return g.code === 'STORY_UNKNOWN_DEP' && g.storyId === 'b'; }).length === 2, 'each unknown dep warns');
  ok(vSD.global.some(function (g) { return g.code === 'STORY_UNKNOWN_DEP' && /#1 is a feature/.test(g.msg); }), 'a feature number says so');
  var sCyc = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', stories: [{ id: 'x', title: 'X', num: 2, deps: [3] }, { id: 'y', title: 'Y', num: 3, deps: [2] }, { id: 'z', title: 'Z', num: 4, deps: [2] }] }]);
  eq(RM.storyCycleMembers(sCyc), { x: true, y: true }, 'cycle members (z hangs off the cycle, not in it)');
  ok(RM.validate(sCyc).global.filter(function (g) { return g.code === 'STORY_CYCLE'; }).length === 2, 'both cycle members get STORY_CYCLE');
  var sUn = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', stories: [{ id: 'p', title: 'P', num: 5 }] },
    { id: 'g', num: 2, phaseId: 'p1', feature: 'G', startDay: 0, durDays: 5, stories: [{ id: 'q', title: 'Q', num: 6, deps: [5], startDay: 3, durDays: 2 }] }]);
  ok(RM.validate(sUn).global.some(function (g) { return g.code === 'STORY_DEP_UNSCHEDULED' && g.storyId === 'q'; }), 'a scheduled story depending on an unscheduled one gets the info');
  var sDone = mkState([{ id: 'f', num: 1, phaseId: 'p1', feature: 'F', startDay: 0, durDays: 5, stories: [{ id: 'd', title: 'D', num: 2, done: true }, { id: 'e', title: 'E', num: 3, deps: [2], startDay: 1, durDays: 1 }] }]);
  ok(!RM.validate(sDone).global.some(function (g) { return g.code === 'STORY_DEP_ORDER'; }), 'a done dependency never violates order');
  var mapped = [{ id: 'n1', title: 'A', num: 30, deps: [21, 5] }, { id: 'n2', title: 'B', num: 31, deps: [] }];
  RM.remapStoryDeps(mapped, { 20: 30, 21: 31 });
  eq(mapped[0].deps, [31, 5], 'remapStoryDeps rewrites numbers inside the copy and keeps outside ones');
}
```

- [ ] **Step 2: Run** `node tests/core.test.js` — expect the new assertions to fail.

- [ ] **Step 3: Implement** in `js/core.js`.

Story normalizer: add `num: s.num != null && isFinite(s.num) ? Math.round(s.num) : null,` and

```js
            // story → story dependencies by story number (same pool as
            // features); unknown numbers stay so validation can point at them
            deps: (function () {
              var seen = {}, out = [];
              (Array.isArray(s.deps) ? s.deps : []).forEach(function (d) {
                var n = parseInt(d, 10);
                if (!isFinite(n) || n < 1 || seen[n]) return;
                seen[n] = true; out.push(n);
              });
              return out;
            })(),
```

then a self-drop after both num and deps exist (the story's own number may be assigned later — do the self-drop in the unique-num pass below).

Unique-num pass: after the items loop, extend to stories:

```js
    state.items.forEach(function (it) {
      it.stories.forEach(function (st) {
        if (st.num == null || seen[st.num]) { maxNum += 1; st.num = maxNum; }
        seen[st.num] = 'used';
        maxNum = Math.max(maxNum, st.num);
      });
    });
    state.items.forEach(function (it) {
      it.stories.forEach(function (st) { st.deps = st.deps.filter(function (n) { return n !== st.num; }); });
    });
```

(Check the existing pass: features mark `seen[num] = 'used'`; a story number equal to a feature number is a collision and gets reassigned; keep first-come order: features first, then stories in document order.)

`RM.nextNum`: include `it.stories` numbers in the max.

Lookup, next to `RM.itemByNum`:

```js
  RM.storyByNum = function (state, num) {
    for (var i = 0; i < state.items.length; i++) {
      var sts = state.items[i].stories || [];
      for (var j = 0; j < sts.length; j++) if (sts[j].num === num) return { it: state.items[i], st: sts[j] };
    }
    return null;
  };
  RM.byNum = function (state, num) {
    var it = RM.itemByNum(state, num);
    if (it) return { kind: 'feature', it: it };
    var ref = RM.storyByNum(state, num);
    return ref ? { kind: 'story', it: ref.it, st: ref.st } : null;
  };
  RM.storyRef = function (state, stId) { /* by id, as before: { it, st } | null */ };
```

`RM.renumberItem`: the `taken` map also covers every story number. Add:

```js
  RM.renumberStory = function (state, itemId, stId, wanted) {
    var it = RM.itemById(state, itemId);
    var st = it && (it.stories || []).filter(function (s) { return s.id === stId; })[0];
    if (!st) return null;
    var old = st.num;
    var n = parseInt(wanted, 10);
    var taken = {};
    state.items.forEach(function (x) { taken[x.num] = true; (x.stories || []).forEach(function (s) { if (s.id !== stId) taken[s.num] = true; }); });
    if (!isFinite(n) || n < 1 || taken[n]) n = RM.nextNum(state);
    if (n === old) return n;
    st.num = n;
    state.items.forEach(function (x) {
      (x.stories || []).forEach(function (s) { s.deps = s.deps.map(function (d) { return d === old ? n : d; }); });
    });
    return n;
  };
  RM.remapStoryDeps = function (stories, numMap) {
    stories.forEach(function (st) { st.deps = (st.deps || []).map(function (d) { return numMap[d] != null ? numMap[d] : d; }); });
  };
```

Dependencies section (after `RM.depEdges`): `RM.storyLabel` (`'#' + ref.st.num + ' · ' + (ref.st.title || '(untitled)')`), `RM.storyWindow` (own `startDay/durDays` → `{startDay, endDay: startDay + Math.max(1, durDays)}`, else the feature's `{startDay, startDay + RM.itemSpan(it)}`, else null), `RM.resolveStoryDeps` (`{ deps: [refs], unknown: [n] }` — a number that hits a feature is unknown), `RM.storyDepEdges`, `RM.storyDependents(state, st)` (stories whose deps include `st.num`), and `RM.storyCycleMembers`: build `adj` keyed by story id from `RM.storyDepEdges` and run the **same iterative Tarjan** that `RM.cycleMembers` uses (`js/core.js` ~1963) — extract the SCC walk into a shared local `sccCycles(ids, adj)` helper used by both, rather than a fresh DFS.

`RM.validate`: inside the items loop, after the feature dep checks:

```js
      (it.stories || []).forEach(function (st) {
        var sl = '#' + st.num + ' "' + (st.title || '(untitled)') + '"';
        var lv = RM.levelLabel(state, 'story');
        var rs = RM.resolveStoryDeps(state, st);
        rs.unknown.forEach(function (n) {
          var isFeat = !!RM.itemByNum(state, n);
          global.push({ level: 'warn', code: 'STORY_UNKNOWN_DEP', storyId: st.id, itemId: it.id, msg: lv + ' ' + sl + ' depends on #' + n + ', which ' + (isFeat ? 'is a feature, not a ' + lv.toLowerCase() : 'does not exist') });
        });
        if (storyCyc[st.id]) global.push({ level: 'error', code: 'STORY_CYCLE', storyId: st.id, itemId: it.id, msg: lv + ' ' + sl + ' is part of a dependency cycle' });
        var win = RM.storyWindow(state, it, st);
        if (!win) return;
        rs.deps.forEach(function (dep) {
          if (dep.st.done) return;
          var dl = '#' + dep.st.num + ' "' + (dep.st.title || '(untitled)') + '"';
          var dw = RM.storyWindow(state, dep.it, dep.st);
          if (!dw) global.push({ level: 'info', code: 'STORY_DEP_UNSCHEDULED', storyId: st.id, itemId: it.id, msg: lv + ' ' + sl + ' depends on ' + dl + ', which is not scheduled' });
          else if (win.startDay < dw.endDay) global.push({ level: 'warn', code: 'STORY_DEP_ORDER', storyId: st.id, itemId: it.id, msg: lv + ' ' + sl + ' starts before ' + dl + ' finishes' });
        });
      });
```

with `var storyCyc = RM.storyCycleMembers(state);` computed once next to `cyclic`.

- [ ] **Step 4: Run** `node tests/core.test.js`, then `make test` (all four suites; smoke fixtures gain story numbers silently — if any smoke assertion compares whole story objects or counts `r-num`, fix the assertion, not the feature).

- [ ] **Step 5: Commit** `feat(core): story numbers from the shared pool; story-to-story dependencies with validation`

---

### Task 2: Story numbers in the UI, number editor, duplicate remap

**Files:**
- Modify: `js/app.js` — Planning/Scoping story rows (~3776-3790), Prioritizing story rows in cards (~2108-2114) and story cards (~2210-2220), Sprinting story rows (~2858-2866) and story-view feature heading (~2870-2878, unchanged), feature panel story list (~4270-4276), story panel header (~4438-4446), story panel change handler (the `data-stf` `change` path ~5100, where `title`/`done` commit), `duplicateItem` (~6240), `addStoryNear`/`duplicateStory` (new stories get `num: RM.nextNum(s)` inside the commit)
- Modify: `css/app.css` — `.st-num` sizing next to `.r-num` (~449)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `.r-num.st-num` spans on every story row/card, `input.p-num-edit[data-stf="num"]` in the story panel.

- [ ] **Step 1: Failing smoke test** (append before the `story panel estimate buttons` block):

```js
// ---------------------------------------------------------------- story numbers everywhere
{
  click(doc.querySelector('#viewTabs [data-view="planning"]'));
  const host = state().items.find(i => !i.milestone && i.stories && i.stories.length);
  const st0 = host.stories[0];
  ok(typeof st0.num === 'number' && !state().items.some(i => i.num === st0.num), 'stories carry a number that no feature uses');
  click(doc.querySelector('#detailBtn'));
  click(doc.querySelector('#popover .menu-list [data-mi="1"]'));
  const rowNum = doc.querySelector('#rows .row.story[data-story="' + st0.id + '"] .r-num');
  ok(!!rowNum && rowNum.textContent.trim() === '#' + st0.num, 'Planning story rows show the story number');
  click(doc.querySelector('#detailBtn'));
  click(doc.querySelector('#popover .menu-list [data-mi="0"]'));
  window.__headway.selectItem(host.id);
  const listNum = doc.querySelector('#panel .p-story[data-pst="' + st0.id + '"] .r-num, #panel .p-story .r-num');
  ok(!!listNum && /#\d+/.test(listNum.textContent), 'the feature panel story list shows numbers');
  click(doc.querySelector('#panel [data-pst-edit="' + st0.id + '"]'));
  const numIn = doc.querySelector('#panel input.p-num-edit[data-stf="num"]');
  ok(!!numIn && numIn.value === String(st0.num), 'the story panel header shows the editable number');
  const free = window.RM.nextNum(state()) + 5;
  numIn.value = String(free); numIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(window.RM.storyRef(state(), st0.id).st.num === free, 'changing the number renumbers the story');
  const feat = state().items.find(i => i.id !== host.id && !i.milestone);
  numIn2 = doc.querySelector('#panel input.p-num-edit[data-stf="num"]');
  numIn2.value = String(feat.num); numIn2.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(window.RM.storyRef(state(), st0.id).st.num !== feat.num, 'a feature number is refused (falls back to a free one)');
  click(doc.querySelector('#viewTabs [data-view="sprints"]'));
  click(doc.querySelector('#sprintView [data-splevel="story"]') || doc.querySelector('#sprintView .spv-lvl [data-mi="1"]'));
  ok([...doc.querySelectorAll('#sprintView .spv-row.spv-st .r-num')].length > 0, 'Sprinting story rows show numbers');
  click(doc.querySelector('#viewTabs [data-view="prio"]'));
  ok([...doc.querySelectorAll('#prioView .pr-story .r-num, #prioView .pr-stcard .pr-head .r-num')].length > 0, 'Prioritizing story rows/cards show numbers');
  click(doc.querySelector('#viewTabs [data-view="planning"]'));
}
{
  // duplicating a feature gives the copied stories fresh numbers and remaps deps among them
  const host = state().items.find(i => !i.milestone);
  window.HeadwayApp.ai.commit('dup num fixture', (s) => {
    const f = window.RM.itemById(s, host.id);
    const n1 = window.RM.nextNum(s);
    f.stories.push({ id: 'dn_1', title: 'first', done: false, num: n1 }, { id: 'dn_2', title: 'second', done: false, num: n1 + 1, deps: [n1] });
  });
  const nBefore = state().items.length;
  const row = doc.querySelector('#rows .row.item[data-id="' + host.id + '"]');
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  click([...doc.querySelectorAll('#popover .menu-list button')].find(b => /^Duplicate$/.test(b.textContent.trim())));
  const copy = state().items[state().items.findIndex(i => i.id === host.id) + 1];
  ok(state().items.length === nBefore + 1 && copy && copy.id !== host.id, 'the feature is duplicated');
  const c1 = copy.stories.find(s => s.title === 'first'), c2 = copy.stories.find(s => s.title === 'second');
  const orig1 = window.RM.storyRef(state(), 'dn_1').st;
  ok(c1 && c2 && c1.num !== orig1.num && String(c2.deps) === String(c1.num), 'the copied story depends on the copied story’s new number');
  window.HeadwayApp.ai.commit('dup num cleanup', (s) => {
    s.items = s.items.filter(i => i.id !== copy.id);
    const f = window.RM.itemById(s, host.id); f.stories = f.stories.filter(x => x.id !== 'dn_1' && x.id !== 'dn_2');
  });
}
```

Verify the Sprinting level toggle selector and the Prioritizing story-mode selector against the code (`grep -n "splevel\|prioLevel" js/app.js`) and adjust the test; it must exercise real controls or set the level through the existing UI-state path used by neighbouring tests.

- [ ] **Step 2: Run smoke** — fails.

- [ ] **Step 3: Implement.** Add `'<span class="r-num st-num">#' + st.num + '</span>'` right after `typeGlyphHtml(st, 'story', it)` in: Planning/Scoping story rows, Prioritizing card story rows, story cards (`pr-head`), Sprinting story rows; in the feature panel story list put it before the title input and add `data-pst="' + st.id + '"` on `.p-story`. Story panel header: before the type chip, `'<span class="p-lead"><span class="p-num">#<input class="p-num-edit" data-stf="num" value="' + st.num + '" style="width:' + (String(st.num).length + 1.6) + 'ch" title="' + esc(lvl('story')) + ' #"></span></span>'`; in the story `change` handler add `if (stfk === 'num') { commit('renumber story', function (s) { newNum = RM.renumberStory(s, it.id, selStory, val); }); toast when it differs — same wording as the feature path }`. Every place app.js creates a story object (`addStoryNear`, `duplicateStory`, the `storyadd` input, `st-add` Enter handler, AI-side is Task 6) sets `num: RM.nextNum(s)` inside the commit (normalize would assign one anyway, but only on the next load — the UI needs it now). `duplicateItem`: build `numMap` old → `RM.nextNum` (incrementing) while regenerating ids, then `RM.remapStoryDeps(copy.stories, numMap)`. CSS: `.st-num { … }` if the default `.r-num` width misaligns story rows (check `.st-pad`).

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat: story numbers shown everywhere, editable in the story panel; duplicate remaps story deps`

---

### Task 3: Story panel Dependencies section

**Files:**
- Modify: `js/app.js` — story panel builder (`sec2` chain ~4460-4480), panel click handler (~4945-4980), dep search input handler (`data-f="depsearch"` ~6180) and click handler for `[data-addep]`
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `sec2('deps', 'Dependencies', …)` (renders `data-sec="st-deps"` — confirm the prefix in `sec2`), `.dep-chip[data-stdepgo="<stId>"]`, `button.x[data-stdeprm="<num>"]`, `button.x[data-strdep="<stId>"]`, `input[data-stf="stdepsearch"]`, `.dep-sug button[data-addstdep="<num>"]`.

- [ ] **Step 1: Failing smoke test**

```js
// ---------------------------------------------------------------- story dependencies in the panel
{
  const hosts = state().items.filter(i => !i.milestone).slice(0, 2);
  window.HeadwayApp.ai.commit('story dep fixture', (s) => {
    const f0 = window.RM.itemById(s, hosts[0].id), f1 = window.RM.itemById(s, hosts[1].id);
    f0.stories.push({ id: 'sd_a', title: 'Dep story alpha', done: false, num: window.RM.nextNum(s) });
    f1.stories.push({ id: 'sd_b', title: 'Dep story beta', done: false, num: window.RM.nextNum(s) + 1 });
  });
  const numA = window.RM.storyRef(state(), 'sd_a').st.num;
  window.__headway.selectItem(hosts[1].id);
  click(doc.querySelector('#panel [data-pst-edit="sd_b"]'));
  const sec = doc.querySelector('#panel .p-sec[data-sec="st-deps"]');
  ok(!!sec, 'the story panel has a Dependencies section');
  const secs = [...doc.querySelectorAll('#panel .p-sec')].map(e => e.dataset.sec);
  ok(secs.indexOf('st-deps') > secs.indexOf('st-schedule') && secs.indexOf('st-deps') < secs.indexOf('st-integrations'), 'it sits between Timeline and Integrations');
  if (!sec.classList.contains('open')) click(doc.querySelector('#panel [data-sectoggle="st-deps"]'));
  const search = doc.querySelector('#panel input[data-stf="stdepsearch"]');
  ok(!!search, 'the section offers a search box');
  search.value = '#' + numA; search.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok(!!doc.querySelector('#panel .dep-sug button[data-addstdep="' + numA + '"]'), 'typing #number suggests that story');
  search.value = 'alpha'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
  const hit = doc.querySelector('#panel .dep-sug button[data-addstdep="' + numA + '"]');
  ok(!!hit && hit.textContent.indexOf('#' + numA) !== -1, 'typing a title suggests it with its number');
  click(hit);
  const depsOf = (id) => window.RM.storyRef(state(), id).st.deps;
  ok(String(depsOf('sd_b')) === String(numA), 'picking the suggestion adds the dependency');
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
```

- [ ] **Step 2: Run smoke** — fails.

- [ ] **Step 3: Implement.** Build in the story panel before the Timeline section:

```js
    var rsP = RM.resolveStoryDeps(state, st);
    var stDepChips = rsP.deps.map(function (ref) {
      return '<span class="dep-chip" data-stdepgo="' + ref.st.id + '" title="' + esc(ref.st.title) + '"><i>#' + ref.st.num + '</i> ' +
        esc(shorten(ref.st.title || '(untitled)', 26)) + '<button class="x" data-stdeprm="' + ref.st.num + '"><i data-lucide="x"></i></button></span>';
    }).concat(rsP.unknown.map(function (n) {
      return '<span class="dep-chip unknown" title="No ' + esc(lvl('story').toLowerCase()) + ' #' + n + '"><i>#' + n + '</i> missing<button class="x" data-stdeprm="' + n + '"><i data-lucide="x"></i></button></span>';
    })).join('');
    var stDependentChips = RM.storyDependents(state, st).map(function (ref) {
      return '<span class="dep-chip" data-stdepgo="' + ref.st.id + '" title="' + esc(ref.st.title) + '"><i>#' + ref.st.num + '</i> ' +
        esc(shorten(ref.st.title || '(untitled)', 26)) + '<button class="x" data-strdep="' + ref.st.id + '" title="Remove this link"><i data-lucide="x"></i></button></span>';
    }).join('');
```

and the section body mirroring the feature panel's Dependencies markup (copy its `.dep-search` wrapper; input `data-stf="stdepsearch"`, placeholder `Add a story by # or name…`). Insert `sec2('deps', 'Dependencies', stDeps) +` between Timeline and Integrations.

Click handler (before the generic `[data-stf]` return): `[data-stdepgo]` → `var ref = RM.storyRef(state, id); if (ref) selectStory(ref.it.id, ref.st.id)`; `[data-stdeprm]` → commit `remove story dep` removing the number from `st.deps`; `[data-strdep]` → commit `remove story dependent` removing `st.num` from that story's deps.

Search: in the panel `input` listener, when `e.target.dataset.stf === 'stdepsearch' && selStory`: `q` trimmed; if `/^#?\d+$/` — the story with that number (not itself, not already a dep) is the single hit; else match story title or owning feature title (case-insensitive), skip itself and current deps, first 8; render `<button data-addstdep="<num>"><i>#<num></i> <title> <em><feature title></em></button>` or the `dep-sug-none` line. Panel click on `[data-addstdep]` → `addStoryDep(it.id, selStory, num)` (commit `add story dep`, toast `“<title>” now depends on #n`; refuse duplicates with a toast).

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat: story panel Dependencies section`

---

### Task 4: Planning arrows and ports for story bars

**Files:**
- Modify: `js/app.js` — `renderArrows` (~3990), `barRect` (~3980), arrow click + `deleteSelectedEdge` (~4030-4050), story bar markup (~3846), `startPortDrag` / `cancelPortDrag` / `portDragMove` / `portDragEnd` (~6767-6830), pointerdown (~6720)
- Modify: `css/app.css` — `.st-bar .port` if the feature rules do not fit the shorter bar
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `g.edge.story[data-sfrom][data-sto]`; `.st-bar .port[data-port]`.

- [ ] **Step 1: Failing smoke test**

```js
// ---------------------------------------------------------------- story dependency arrows and ports
{
  click(doc.querySelector('#viewTabs [data-view="planning"]'));
  const host = state().items.find(i => !i.milestone && i.startDay != null);
  window.HeadwayApp.ai.commit('story arrow fixture', (s) => {
    const f = window.RM.itemById(s, host.id);
    const n = window.RM.nextNum(s);
    f.stories.push({ id: 'ar_1', title: 'arrow one', done: false, num: n, startDay: f.startDay, durDays: 2 },
      { id: 'ar_2', title: 'arrow two', done: false, num: n + 1, startDay: f.startDay, durDays: 2, deps: [n] });
  });
  click(doc.querySelector('#detailBtn'));
  click(doc.querySelector('#popover .menu-list [data-mi="1"]'));
  ok(!!doc.querySelector('#rows .st-bar[data-stbar="ar_1"] .port[data-port="out"]') && !!doc.querySelector('#rows .st-bar[data-stbar="ar_2"] .port[data-port="in"]'), 'story bars carry in/out ports');
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

jsdom has no layout: check how existing arrow tests cope (`grep -n "g.edge" tests/smoke.test.js`) and follow them.

- [ ] **Step 2: Run smoke** — fails.

- [ ] **Step 3: Implement.** `storyBarRect(stId)` like `barRect` for `[data-stbar]`. In `renderArrows` after the feature loop, one `<g class="edge story …" data-sfrom data-sto data-explicit="true">` per `RM.storyDepEdges` edge whose two bars are visible: `viol` when `w && dw && w.startDay < dw.endDay && !dep.st.done` (`RM.storyWindow`), `sel-related` when `selStory` is an end, `hot` when `selectedEdge.sfrom/sto` match. Arrow click stores `{ sfrom, sto }` for story edges; `deleteSelectedEdge` handles that shape (commit `remove story dep`, filter the dependency's number out of the `sto` story's deps, toast with `RM.storyLabel`). Story bars get the same `ports` markup as feature bars. Pointerdown: `portEl && stBarEl` → `startPortDrag(e, stBarEl.dataset.stbar, portEl.dataset.port, true)`; `drag.story = true`; `portDragMove` uses `storyBarRect` and targets `[data-stbar],.row.story[data-story]` (highlight `.st-bar.link-target`; a feature bar/row under the pointer is not a target); `portDragEnd` with `drag.story`: resolve both by `RM.storyRef`, refuse self and already-linked (toast), a feature target toasts `Stories link to stories — drop on a story bar or row`, else commit `link stories` pushing the dependency's `num` and toast `#a now depends on #b`. `cancelPortDrag` clears `.st-bar.link-target`.

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat: story dependency arrows and ports on the Planning timeline`

---

### Task 5: Excel columns, Jira links, Jira CSV

**Files:**
- Modify: `js/excel.js` (Stories sheet write ~293-315, read ~712-732), `js/jira.js` (plan links ~364-375, apply step 4 keyOf ~764-768), `js/export-jira.js` (story `Blocked By` ~104)
- Test: `tests/jira.test.js`, `tests/smoke.test.js` (the ExcelJS export round-trip block)

**Interfaces:**
- Consumes: Task 1.
- Produces: Stories sheet columns 8 `#`, 9 `Depends on`; `plan.links` entries `{ story: true, blockerId, blockedId }`; CSV `Blocked By` on story rows.

- [ ] **Step 1: Failing tests.** `tests/jira.test.js`: in the fixture, give `s3` `deps: [<s2's num>]` (assign nums explicitly in the fixture so the test is stable) and assert `plan.links.some(l => l.story && l.blockerId === 's2' && l.blockedId === 's3')`; change the existing `plan.links.length === 1` assertion to count `!l.story` links; in the apply section assert an `issueLink` call with `outwardIssue { key: 'HW-20' }` and the created key for `s3`. Smoke: after the workbook export, assert header cells (1,8) = `#`, (1,9) = `Depends on`, a story row carries its number and its deps as `n, n`; re-import via the existing round-trip helper and assert the numbers and deps survive when the embedded JSON is stripped (if the test harness has such a path; otherwise assert the parsed sheet values only).

- [ ] **Step 2: Run** — fail.

- [ ] **Step 3: Implement.** excel.js write: headers `…, 'Tags', '#', 'Depends on'`, widths 8/16, values `st.num` and `st.deps.join(', ') || null`. Read: `var storyNumCol = /^#$/.test(cellText(sws.getCell(1, 8))) ? 8 : 0, storyDepCol = /^depends on$/i.test(cellText(sws.getCell(1, 9))) ? 9 : 0;` and push `num: storyNumCol ? parseInt(cellText(...), 10) || null : null, deps: storyDepCol ? cellText(...).split(/[,\s;]+/).filter(Boolean) : []` (normalize cleans). jira.js plan: after feature links, when `cfg.pushStories`, for every story dep whose both ends' features are in `work`, push `{ story: true, blockerId: dep.st.id, blockedId: st.id, blockerTitle, blockedTitle }`; apply step 4: `plan.stories.forEach(s => if (s.key) keyOf[s.id] = s.key)` and `plan.updates.forEach(u => if (u.kind === 'story') keyOf[u.id] = u.key)`. export-jira.js story rows: `'Blocked By': RM.resolveStoryDeps(state, s).deps.map(r => r.st.jiraKey).filter(Boolean).join(' ')` (ES5!).

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat: story numbers and dependencies in the Stories sheet, Jira links and Jira CSV`

---

### Task 6: AI tools and docs

**Files:**
- Modify: `js/ai.js` (`itemLine` ~258, `itemFull` ~276, `mergeFields` deps ~477 and story creation in `stories`/`addStories` ~487 (`num: RM.nextNum(...)` — note mergeFields gets `meta`, not state: thread a `nextNum` through or assign in `runTool` after merge by walking the new stories), `add_items` story creation ~647, `update_items` target resolution ~666 (accept a story number), tool descriptions ~383/395, GUIDE ~758-759), `README.md` (rows Dependencies ~101, Detail panel ~95), `CHANGELOG.md` (Unreleased)
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: Task 1.

- [ ] **Step 1: Failing tests** (after the update_items assertions; give `freshState` stories explicit nums, e.g. `s1` num 10 and add `s2` num 11 under #2):

```js
  AI.runTool('update_items', { updates: [{ num: 11, fields: { deps: [10, 99] } }] }, A);
  eq(RM.storyRef(st, 's2').st.deps, [10, 99], 'a story number targets the story; deps are numbers');
  eq(AI.runTool('get_project', { part: 'items', nums: [2] }, A).items[0].stories[0].deps, [10, 99], 'get_project items reports story deps');
  ok(AI.summary(st).items.some(function (l) { return l.storyNums && l.storyNums.indexOf(10) !== -1; }), 'the summary lists story numbers');
  var addedSt = AI.runTool('update_items', { updates: [{ num: 1, fields: { addStories: [{ title: 'New one' }] } }] }, A);
  ok(RM.itemById(st, 'a').stories.slice(-1)[0].num === RM.nextNum(st) - 1, 'a story added by the AI gets a number at once');
  ok(/story number/i.test(AI.toolByName('update_items').description), 'the update tool documents story numbers');
```

Adjust `AI.summary` shape to what the code returns (read it first).

- [ ] **Step 2: Run** `node tests/ai.test.js` — fail.

- [ ] **Step 3: Implement.** `update_items`: `var hit = RM.byNum(st2, +u.num)`; feature → as today; story → `target = hit.st`, `it = hit.it`, `isStory = true` (the `story: <id>` form still works). `mergeFields` story `deps`: numbers (`map(Number).filter(isFinite)`); new stories from `stories`/`addStories`/`add_items` get `num: RM.nextNum(stateClone)` — since `mergeFields` receives only `meta`, assign numbers in `runTool` right after merging (walk `target.stories`, give every story with `num == null` the next number). `itemLine`: `storyNums`. `itemFull`: stories already clone `num` and `deps`. Descriptions and GUIDE per the spec. README: Dependencies row gains "Stories depend on stories the same way (panel section, ports on story bars, arrows)"; Detail panel row mentions the story number is editable. CHANGELOG Unreleased: `- **Story numbers**: every story has a # from the same pool as features; it shows on every row and card and edits in the story panel.` and `- **Story dependencies**: a story can depend on any other story. Add one in the story panel's Dependencies section (by # or name) or drag a story bar's edge circle onto another story; arrows and order warnings work like features; links push to Jira and the Stories sheet carries them.`

- [ ] **Step 4: Run** `make test`.

- [ ] **Step 5: Commit** `feat(ai): story numbers and deps in tools; docs`

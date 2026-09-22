# Item Types & Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every epic, feature and story carries a type (Feature, Bug, Task, …) chosen from a Setup-defined hierarchy, and each type maps to a Jira issue type for sync and CSV export.

**Architecture:** The three storage levels (epic string tag on items → `state.items` → `item.stories`) stay untouched. `meta.itemTypes` (type records) and `meta.hierarchy` (level labels + allowed types + the any-level switch) live in core with pure helpers; `item.type` / `story.type` / `state.epicTypes[name]` hold type keys. Jira sync and CSV export read the Jira name off the type record instead of three fixed config strings. UI reads level labels from the hierarchy.

**Tech Stack:** Vanilla ES5-style JS (IIFE modules, no build), Lucide icons, Node test scripts run via `make test` (`NODE_PATH=./node_modules node tests/<file>.js`), jsdom smoke test.

**Spec:** `docs/superpowers/specs/2026-09-08-item-types-hierarchy-design.md`

## Global Constraints

- No build step: files under `js/` run directly in the browser and in Node (`core.js`, `jira.js`, `export-jira.js`, `ai.js` export via `module.exports`). Keep ES5 syntax (`var`, `function`), no arrow functions, no template literals, matching the existing files.
- Every document mutation in `app.js` goes through `commit(label, fn)` so it lands in undo and Version history.
- Level keys are exactly `epic`, `feature`, `story`, in that order, always.
- Default type table (key / label / icon / jira): epic/Epic/layers/Epic · feature/Feature/rows-3/Story · bug/Bug/bug/Bug · task/Task/check-square/Task · story/Story/list-tree/Sub-task · subtask/Subtask/corner-down-right/Sub-task.
- Default level types: epic → `['epic']`; feature → `['feature','bug','task']`; story → `['story','subtask','bug']`.
- A stored type that is not allowed at its level is never rewritten by normalize; validation warns (`TYPE_LEVEL`) instead.
- Run `make test` before every commit; all four suites must pass (the counts printed at the end of each must show 0 failed).
- Other Claude sessions may edit this tree concurrently: never `git stash`; commit only the files you touched.

---

### Task 1: Core — type & hierarchy defaults, normalize, read helpers

**Files:**
- Modify: `js/core.js` (constants near line 251 next to `RM.MS_STYLES`; normalize at ~line 1204 just before `var riskOrder = …`; item/story mapping ~1206–1300; `state.epicJira` block ~1337)
- Test: `tests/core.test.js` (append a new section before the final summary print)

**Interfaces:**
- Produces: `RM.DEFAULT_ITEM_TYPES`, `RM.DEFAULT_HIERARCHY_LEVELS`, `RM.itemTypes(state)`, `RM.itemType(state,key)`, `RM.levelOf(state,kind)`, `RM.levelLabel(state,kind,plural)`, `RM.typesFor(state,kind)`, `RM.defaultTypeFor(state,kind)`, `RM.typeOf(state,obj,kind)`, `RM.jiraTypeName(state,typeKey)`, `RM.normalizeTypes(state)`; normalized `meta.itemTypes`, `meta.hierarchy`, `item.type`, `story.type`, `state.epicTypes`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core.test.js` right before the final line that prints the pass/fail summary (search for `console.log('\n' + passed` or the last `section(` call and add after the last test block):

```js
section('item types & hierarchy');
{
  var sT = mkState([
    { num: 1, feature: 'A', epic: 'E1', stories: [{ id: 'sa', title: 'x' }, { id: 'sb', title: 'y', type: 'bug' }] },
    { num: 2, feature: 'B', type: 'bug' },
    { num: 3, feature: 'C', type: 'nope' }
  ]);
  eq(sT.meta.itemTypes.map(function (t) { return t.key; }), ['epic', 'feature', 'bug', 'task', 'story', 'subtask'], 'default types seeded');
  eq(sT.meta.hierarchy.levels.map(function (l) { return l.key; }), ['epic', 'feature', 'story'], 'three fixed levels');
  eq(sT.meta.hierarchy.levels[1].types, ['feature', 'bug', 'task'], 'feature level default types');
  eq(sT.meta.hierarchy.anyTypeAnyLevel, false, 'switch off by default');
  eq(sT.items[0].type, 'feature', 'missing item type -> level default');
  eq(sT.items[1].type, 'bug', 'known item type kept');
  eq(sT.items[2].type, 'feature', 'unknown item type -> level default');
  eq(sT.items[0].stories[0].type, 'story', 'missing story type -> level default');
  eq(sT.items[0].stories[1].type, 'bug', 'story type kept');
  eq(sT.epicTypes, {}, 'epicTypes seeded empty');
  eq(RM.typeOf(sT, 'E1', 'epic').key, 'epic', 'epic without a stored type resolves to epic');
  eq(RM.levelLabel(sT, 'feature'), 'Feature', 'level label');
  eq(RM.levelLabel(sT, 'story', true), 'Stories', 'plural label');
  eq(RM.typesFor(sT, 'story').map(function (t) { return t.key; }), ['story', 'subtask', 'bug'], 'allowed types at story level');
  eq(RM.defaultTypeFor(sT, 'epic'), 'epic', 'default type for epic level');
  eq(RM.jiraTypeName(sT, 'story'), 'Sub-task', 'story type maps to Sub-task by default');
  eq(RM.typeOf(sT, sT.items[1], 'feature').icon, 'bug', 'typeOf returns the record');

  // a disallowed stored type survives normalize
  var sT2 = mkState([{ num: 1, feature: 'A', type: 'subtask' }]);
  eq(sT2.items[0].type, 'subtask', 'disallowed type kept on normalize');
  // the switch opens every type at every level
  sT2.meta.hierarchy.anyTypeAnyLevel = true;
  eq(RM.typesFor(sT2, 'epic').length, 6, 'any type any level lists all types');

  // legacy Jira names migrate into the type records once
  var sT3 = mkState([{ num: 1, feature: 'A' }], { meta: Object.assign(JSON.parse(JSON.stringify(META)), { jira: { epicType: 'Initiative', featureType: 'Task', storyType: 'Subtask' } }) });
  eq(RM.jiraTypeName(sT3, 'epic'), 'Initiative', 'legacy epicType migrates');
  eq(RM.jiraTypeName(sT3, 'feature'), 'Task', 'legacy featureType migrates');
  eq(RM.jiraTypeName(sT3, 'story'), 'Subtask', 'legacy storyType migrates');
  sT3.meta.jira.featureType = 'Bug';
  eq(RM.jiraTypeName(RM.normalizeState(sT3), 'feature'), 'Task', 'legacy names are read only when itemTypes is absent');

  // custom labels and lists round-trip; empty level list falls back
  var sT4 = mkState([{ num: 1, feature: 'A' }], { meta: Object.assign(JSON.parse(JSON.stringify(META)), {
    itemTypes: [{ key: 'epic', label: 'Theme', icon: 'layers', jira: 'Epic' }, { key: 'feature', label: 'Feature', icon: 'rows-3', jira: 'Story' }, { key: 'story', label: 'Story', icon: 'list-tree', jira: 'Sub-task' }],
    hierarchy: { levels: [{ key: 'feature', label: 'Capability', types: ['feature', 'ghost'] }, { key: 'story', label: 'Task', types: [] }], anyTypeAnyLevel: true } }) });
  eq(sT4.meta.hierarchy.levels.map(function (l) { return l.label; }), ['Epic', 'Capability', 'Task'], 'missing level gets default label, order fixed');
  eq(sT4.meta.hierarchy.levels[1].types, ['feature'], 'unknown type keys are dropped from a level');
  eq(sT4.meta.hierarchy.levels[2].types, ['story'], 'empty level list falls back to defaults filtered to existing types');
  eq(sT4.meta.hierarchy.anyTypeAnyLevel, true, 'switch round-trips');
  eq(RM.levelLabel(sT4, 'story', true), 'Tasks', 'plural of a custom label');
}
```

`mkState(items, extras)` already exists at the top of the file; `extras.meta` replaces the whole meta, which is why the tests copy `META`.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | tail -30`
Expected: the new section's assertions fail (e.g. `✗ default types seeded`) or a TypeError on `RM.typeOf`.

- [ ] **Step 3: Add constants and read helpers to core.js**

Insert directly after the `RM.msStyleOf` function (line ~254):

```js
  // ---- item types & hierarchy. Three fixed storage levels (epic tag →
  // item → story); each level lists the types it accepts. A type is a
  // label + icon + Jira issue type name; behavior always follows the level.
  RM.LEVEL_KEYS = ['epic', 'feature', 'story'];
  RM.DEFAULT_ITEM_TYPES = [
    { key: 'epic', label: 'Epic', icon: 'layers', jira: 'Epic' },
    { key: 'feature', label: 'Feature', icon: 'rows-3', jira: 'Story' },
    { key: 'bug', label: 'Bug', icon: 'bug', jira: 'Bug' },
    { key: 'task', label: 'Task', icon: 'check-square', jira: 'Task' },
    { key: 'story', label: 'Story', icon: 'list-tree', jira: 'Sub-task' },
    { key: 'subtask', label: 'Subtask', icon: 'corner-down-right', jira: 'Sub-task' }
  ];
  RM.DEFAULT_HIERARCHY_LEVELS = [
    { key: 'epic', label: 'Epic', types: ['epic'] },
    { key: 'feature', label: 'Feature', types: ['feature', 'bug', 'task'] },
    { key: 'story', label: 'Story', types: ['story', 'subtask', 'bug'] }
  ];
  RM.itemTypes = function (state) {
    var m = state && state.meta;
    return (m && Array.isArray(m.itemTypes) && m.itemTypes.length) ? m.itemTypes : RM.DEFAULT_ITEM_TYPES;
  };
  RM.itemType = function (state, key) {
    var list = RM.itemTypes(state);
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  };
  RM.levelOf = function (state, kind) {
    var h = state && state.meta && state.meta.hierarchy;
    var levels = (h && Array.isArray(h.levels) && h.levels.length) ? h.levels : RM.DEFAULT_HIERARCHY_LEVELS;
    kind = kind || 'feature';
    for (var i = 0; i < levels.length; i++) if (levels[i].key === kind) return levels[i];
    return RM.DEFAULT_HIERARCHY_LEVELS[RM.LEVEL_KEYS.indexOf(kind) === -1 ? 1 : RM.LEVEL_KEYS.indexOf(kind)];
  };
  RM.levelLabel = function (state, kind, plural) {
    var lbl = RM.levelOf(state, kind).label || kind;
    if (!plural) return lbl;
    return /s$/i.test(lbl) ? lbl : lbl + 's';
  };
  RM.anyTypeAnyLevel = function (state) {
    var h = state && state.meta && state.meta.hierarchy;
    return !!(h && h.anyTypeAnyLevel);
  };
  RM.typesFor = function (state, kind) {
    var all = RM.itemTypes(state);
    if (RM.anyTypeAnyLevel(state)) return all.slice();
    var keys = RM.levelOf(state, kind).types || [];
    return keys.map(function (k) { return RM.itemType(state, k); }).filter(Boolean);
  };
  RM.defaultTypeFor = function (state, kind) {
    var lv = RM.levelOf(state, kind).types || [];
    var first = lv.length ? RM.itemType(state, lv[0]) : null;
    if (first) return first.key;
    var dflt = RM.DEFAULT_HIERARCHY_LEVELS[RM.LEVEL_KEYS.indexOf(kind)] || RM.DEFAULT_HIERARCHY_LEVELS[1];
    return RM.itemType(state, dflt.types[0]) ? dflt.types[0] : RM.itemTypes(state)[0].key;
  };
  // the type record of an item, story, or (kind 'epic') an epic NAME
  RM.typeOf = function (state, obj, kind) {
    kind = kind || 'feature';
    var key = kind === 'epic'
      ? (state && state.epicTypes ? state.epicTypes[obj] : null)
      : (obj && obj.type);
    return RM.itemType(state, key) || RM.itemType(state, RM.defaultTypeFor(state, kind)) || RM.itemTypes(state)[0];
  };
  RM.jiraTypeName = function (state, typeKey) {
    var t = RM.itemType(state, typeKey);
    return t ? (t.jira || t.label) : String(typeKey || '');
  };
  // normalize meta.itemTypes / meta.hierarchy in place (called from
  // normalizeState before items are mapped; safe to call again any time)
  RM.normalizeTypes = function (state) {
    var m = state.meta;
    var legacy = m.jira && typeof m.jira === 'object' ? m.jira : null;
    var hadTypes = Array.isArray(m.itemTypes) && m.itemTypes.length > 0;
    var seenKey = {};
    var types = (hadTypes ? m.itemTypes : RM.DEFAULT_ITEM_TYPES).map(function (t) {
      if (!t || typeof t !== 'object') return null;
      var key = String(t.key || '').trim();
      if (!key || seenKey[key]) return null;
      seenKey[key] = true;
      return { key: key, label: String(t.label || key), icon: String(t.icon || 'tag'), jira: String(t.jira || '') };
    }).filter(Boolean);
    if (!types.length) types = RM.DEFAULT_ITEM_TYPES.map(function (t) { return { key: t.key, label: t.label, icon: t.icon, jira: t.jira }; });
    if (!hadTypes && legacy) {
      // one-time migration of the old three Jira type names
      var mig = { epic: legacy.epicType, feature: legacy.featureType, story: legacy.storyType };
      types.forEach(function (t) { if (mig[t.key]) t.jira = String(mig[t.key]); });
    }
    m.itemTypes = types;
    var h = m.hierarchy && typeof m.hierarchy === 'object' ? m.hierarchy : {};
    var given = {};
    (Array.isArray(h.levels) ? h.levels : []).forEach(function (l) { if (l && l.key) given[l.key] = l; });
    m.hierarchy = {
      levels: RM.DEFAULT_HIERARCHY_LEVELS.map(function (d) {
        var g = given[d.key] || {};
        var list = (Array.isArray(g.types) ? g.types : []).filter(function (k) { return !!seenKey[k]; });
        if (!list.length) list = d.types.filter(function (k) { return !!seenKey[k]; });
        if (!list.length) list = [types[0].key];
        return { key: d.key, label: String(g.label || d.label), types: list };
      }),
      anyTypeAnyLevel: !!h.anyTypeAnyLevel
    };
    var et = {};
    if (state.epicTypes && typeof state.epicTypes === 'object') {
      Object.keys(state.epicTypes).forEach(function (name) { if (seenKey[state.epicTypes[name]]) et[name] = state.epicTypes[name]; });
    }
    state.epicTypes = et;
  };
```

- [ ] **Step 4: Call normalizeTypes and default item/story types in normalizeState**

In `RM.normalizeState`, insert `RM.normalizeTypes(state);` on its own line immediately before `var riskOrder = RM.RISK_SCHEMES[m.riskScheme].order || RM.RISK_ORDER;` (~line 1204). Then, in the item mapping object, add after the `milestone: !!it.milestone,` line:

```js
        // item type (Feature / Bug / …): a key into meta.itemTypes. Unknown
        // keys fall back to the level default; a known-but-disallowed key
        // is kept (validation warns) so turning the switch off is lossless
        type: RM.itemType(state, it.type) ? it.type : RM.defaultTypeFor(state, 'feature'),
```

and in the story mapping object, after `id: s.id || RM.uid('s'), title: s.title || '', done: !!s.done,` add:

```js
            type: RM.itemType(state, s.type) ? s.type : RM.defaultTypeFor(state, 'story'),
```

`RM.itemType(state, …)` works here because `state.meta.itemTypes` is already normalized by the call above.

- [ ] **Step 5: Run tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | tail -30`
Expected: all pass, `0 failed`. Also run `make test` to confirm the other suites still pass (the fixture and smoke suite exercise normalize).

- [ ] **Step 6: Commit**

```bash
git add js/core.js tests/core.test.js
git commit -m "feat(core): item types and hierarchy model with defaults and migration"
```

---

### Task 2: Core — type mutations and TYPE_LEVEL validation

**Files:**
- Modify: `js/core.js` (after `RM.normalizeTypes`; `RM.validate` ~line 1918)
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `RM.addItemType(state, label, icon, jira)` → new key; `RM.renameItemType(state, key, label)`; `RM.setItemTypeIcon(state, key, icon)`; `RM.setItemTypeJira(state, key, jira)`; `RM.removeItemType(state, key)` → boolean; `RM.setTypeAllowed(state, kind, key, on)` → boolean; `RM.setLevelLabel(state, kind, label)`; `RM.setAnyTypeAnyLevel(state, on)`; validation code `TYPE_LEVEL` (warn, per item) and `TYPE_LEVEL` entries in the global list for stories/epics.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core.test.js` after the Task 1 block:

```js
section('item type mutations & validation');
{
  var sM = mkState([
    { num: 1, feature: 'A', type: 'bug', epic: 'E', stories: [{ id: 's1', title: 'x', type: 'bug' }] }
  ]);
  var nk = RM.addItemType(sM, 'Spike', 'zap', 'Spike');
  eq(nk, 'spike', 'addItemType slugs the label into a key');
  eq(RM.addItemType(sM, 'Spike', 'zap', 'Spike'), 'spike-2', 'duplicate labels get a suffixed key');
  ok(RM.setTypeAllowed(sM, 'feature', 'spike', true), 'allow a type at a level');
  eq(RM.levelOf(sM, 'feature').types.slice(-1)[0], 'spike', 'allowed list grows');
  ok(!RM.setTypeAllowed(sM, 'epic', 'epic', false), 'cannot remove the last type of a level');
  ok(RM.setTypeAllowed(sM, 'feature', 'spike', false), 'disallow again');
  RM.renameItemType(sM, 'spike', 'Research');
  eq(RM.itemType(sM, 'spike').label, 'Research', 'rename keeps the key');
  RM.setItemTypeJira(sM, 'spike', 'Research task');
  eq(RM.jiraTypeName(sM, 'spike'), 'Research task', 'jira name edit');
  RM.setItemTypeIcon(sM, 'spike', 'flask-conical');
  eq(RM.itemType(sM, 'spike').icon, 'flask-conical', 'icon edit');
  RM.setLevelLabel(sM, 'story', 'Task');
  eq(RM.levelLabel(sM, 'story'), 'Task', 'level label edit');
  ok(!RM.removeItemType(sM, 'epic'), 'cannot remove the only type of a level');
  ok(RM.removeItemType(sM, 'bug'), 'remove a type');
  eq(sM.items[0].type, 'feature', 'items of the removed type fall back to the level default');
  eq(sM.items[0].stories[0].type, 'story', 'stories too');
  eq(RM.levelOf(sM, 'story').types, ['story', 'subtask'], 'removed key leaves every level list');
  ok(!RM.itemType(sM, 'bug'), 'record gone');

  var sV2 = mkState([{ num: 1, feature: 'A', type: 'subtask', epic: 'E', stories: [{ id: 's1', title: 'x', type: 'task' }] }], { epicTypes: { E: 'feature' } });
  var vv = RM.validate(sV2);
  ok((vv.byItem[sV2.items[0].id] || []).some(function (f) { return f.code === 'TYPE_LEVEL' && /Subtask/.test(f.msg); }), 'item with a disallowed type warns');
  ok(vv.global.some(function (f) { return f.code === 'TYPE_LEVEL' && /story/i.test(f.msg) && /Task/.test(f.msg); }), 'story with a disallowed type warns globally');
  ok(vv.global.some(function (f) { return f.code === 'TYPE_LEVEL' && /Epic/.test(f.msg) && /Feature/.test(f.msg); }), 'epic with a disallowed type warns globally');
  RM.setAnyTypeAnyLevel(sV2, true);
  var vv2 = RM.validate(sV2);
  ok(!(vv2.byItem[sV2.items[0].id] || []).some(function (f) { return f.code === 'TYPE_LEVEL'; }) && !vv2.global.some(function (f) { return f.code === 'TYPE_LEVEL'; }), 'switch on silences TYPE_LEVEL');
}
```

Check what `RM.validate` returns before writing: look at the end of `RM.validate` for the returned object (`byItem` and `global`). If the global list uses a different key name, adjust the test to that name.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | tail -30`
Expected: `RM.addItemType is not a function`.

- [ ] **Step 3: Implement the mutators**

Insert after `RM.normalizeTypes` in `js/core.js`:

```js
  function typeSlug(label) {
    return String(label || 'type').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'type';
  }
  RM.addItemType = function (state, label, icon, jira) {
    RM.normalizeTypes(state);
    var base = typeSlug(label), key = base, n = 2;
    while (RM.itemType(state, key)) key = base + '-' + (n++);
    state.meta.itemTypes.push({ key: key, label: String(label || 'New type'), icon: String(icon || 'tag'), jira: String(jira || '') });
    return key;
  };
  RM.renameItemType = function (state, key, label) {
    var t = RM.itemType(state, key);
    if (t && String(label || '').trim()) t.label = String(label).trim();
  };
  RM.setItemTypeIcon = function (state, key, icon) {
    var t = RM.itemType(state, key);
    if (t) t.icon = String(icon || 'tag');
  };
  RM.setItemTypeJira = function (state, key, jira) {
    var t = RM.itemType(state, key);
    if (t) t.jira = String(jira || '').trim();
  };
  RM.setLevelLabel = function (state, kind, label) {
    RM.normalizeTypes(state);
    var lv = RM.levelOf(state, kind);
    if (String(label || '').trim()) lv.label = String(label).trim();
  };
  RM.setAnyTypeAnyLevel = function (state, on) {
    RM.normalizeTypes(state);
    state.meta.hierarchy.anyTypeAnyLevel = !!on;
  };
  // allow / disallow a type at a level; refuses to empty a level
  RM.setTypeAllowed = function (state, kind, key, on) {
    RM.normalizeTypes(state);
    if (!RM.itemType(state, key)) return false;
    var lv = RM.levelOf(state, kind);
    var i = lv.types.indexOf(key);
    if (on) { if (i === -1) lv.types.push(key); return true; }
    if (i === -1) return true;
    if (lv.types.length === 1) return false;
    lv.types.splice(i, 1);
    return true;
  };
  // remove a type: refused while it is the only type of some level;
  // otherwise items, stories and epics of that type fall back to their
  // level default and the key leaves every level list
  RM.removeItemType = function (state, key) {
    RM.normalizeTypes(state);
    if (!RM.itemType(state, key)) return false;
    var levels = state.meta.hierarchy.levels;
    if (levels.some(function (l) { return l.types.length === 1 && l.types[0] === key; })) return false;
    levels.forEach(function (l) { l.types = l.types.filter(function (k) { return k !== key; }); });
    state.meta.itemTypes = state.meta.itemTypes.filter(function (t) { return t.key !== key; });
    var fF = RM.defaultTypeFor(state, 'feature'), fS = RM.defaultTypeFor(state, 'story'), fE = RM.defaultTypeFor(state, 'epic');
    (state.items || []).forEach(function (it) {
      if (it.type === key) it.type = fF;
      (it.stories || []).forEach(function (s) { if (s.type === key) s.type = fS; });
    });
    Object.keys(state.epicTypes || {}).forEach(function (name) {
      if (state.epicTypes[name] === key) { if (fE === 'epic') delete state.epicTypes[name]; else state.epicTypes[name] = fE; }
    });
    return true;
  };
```

- [ ] **Step 4: Add the validation warning**

In `RM.validate`, inside the `state.items.forEach(function (it) { … })` loop, directly after the `if (!it.feature.trim()) add(it, 'warn', 'NO_TITLE', …)` line, add:

```js
      if (!RM.anyTypeAnyLevel(state)) {
        var okTypes = RM.levelOf(state, 'feature').types;
        if (okTypes.indexOf(it.type) === -1) {
          add(it, 'warn', 'TYPE_LEVEL', RM.levelLabel(state, 'feature') + ' #' + it.num + ' is a ' + RM.typeOf(state, it, 'feature').label +
            ', which is not allowed at the ' + RM.levelLabel(state, 'feature') + ' level');
        }
        var okStory = RM.levelOf(state, 'story').types;
        (it.stories || []).forEach(function (st) {
          if (okStory.indexOf(st.type) === -1) {
            global.push({ level: 'warn', code: 'TYPE_LEVEL', msg: RM.levelLabel(state, 'story') + ' “' + (st.title || '(untitled)') + '” under #' + it.num +
              ' is a ' + RM.typeOf(state, st, 'story').label + ', which is not allowed at the ' + RM.levelLabel(state, 'story') + ' level' });
          }
        });
      }
```

And after the items loop closes (before whatever global checks follow — find the first `global.push` after the loop, or the `return` of `validate`), add:

```js
    if (!RM.anyTypeAnyLevel(state)) {
      var okEpic = RM.levelOf(state, 'epic').types;
      Object.keys(state.epicTypes || {}).forEach(function (name) {
        if (okEpic.indexOf(state.epicTypes[name]) === -1) {
          global.push({ level: 'warn', code: 'TYPE_LEVEL', msg: RM.levelLabel(state, 'epic') + ' “' + name + '” is a ' + RM.typeOf(state, name, 'epic').label +
            ', which is not allowed at the ' + RM.levelLabel(state, 'epic') + ' level' });
        }
      });
    }
```

Confirm the global list's variable is named `global` in `RM.validate` (line 1920) and how it is returned; match the shape of existing global entries (look at the `OVER_CAP` push at ~line 1975 for the field names used).

- [ ] **Step 5: Run tests, then commit**

Run: `make test` — expected all suites `0 failed`.

```bash
git add js/core.js tests/core.test.js
git commit -m "feat(core): item type mutations and TYPE_LEVEL validation"
```

---

### Task 3: Jira CSV export uses per-row types

**Files:**
- Modify: `js/export-jira.js` (`JR.DEFAULTS` line 22; `'Issue Type'` at lines 63 and 87; header comment line 12)
- Modify: `js/app.js` (export wizard ~lines 10735–10756: remove `#jxFeatureType` / `#jxStoryType` inputs and the `featureType`/`storyType` keys of the options object)
- Test: `tests/core.test.js` (~lines 1499, 1518–1523)

**Interfaces:**
- Consumes: `RM.jiraTypeName`, `RM.typeOf`.
- Produces: `JR.rows(state, { features, stories })` writes `Issue Type` from each row's type.

- [ ] **Step 1: Update the tests**

In `tests/core.test.js` change the fixture and assertions:

```js
var sJc = mkState([
  { num: 1, feature: 'Login page', epic: 'Login', workstream: 'Product', size: 'M',
    startDay: 0, durDays: 5, deadline: '2026-09-04', jiraKey: 'HW-12',
    description: '<p>Hi <b>there</b></p>', enables: 'Checkout', notes: '',
    stories: [{ title: 's1', done: true }, { title: 's2', jiraKey: 'HW-13', type: 'bug' }] },
  { num: 2, feature: 'Search, "fast"', deps: [1], phaseId: 'p2', type: 'bug' },
  { num: 3, feature: 'Orphan', deps: [2] }
], { epicJira: { Login: 'HW-1' } });
```

Replace `eq(r1['Issue Type'], 'Story', 'feature issue type defaults to Story');` with:

```js
eq(r1['Issue Type'], 'Story', 'feature type Feature maps to Jira Story');
eq(jr[1]['Issue Type'], 'Bug', 'a Bug feature maps to Jira Bug');
```

Replace the block starting `var jrs = RMJira.rows(sJc, { features: true, stories: true, featureType: 'Task', storyType: 'Sub-task' });` so it reads:

```js
var jrs = RMJira.rows(sJc, { features: true, stories: true });
eq(jrs.length, 5, 'features and stories: a row per story too');
eq(jrs[0]['Issue Type'], 'Story', 'feature row type from the type record');
ok(jrs[0]['Description'].indexOf('[x]') === -1, 'checklist omitted when stories are rows');
eq(jrs[1]['Summary'], 's1', 'story row summary');
eq(jrs[1]['Issue Type'], 'Sub-task', 'story issue type from the type record');
eq(jrs[2]['Issue Type'], 'Bug', 'a Bug story maps to Jira Bug');
```

Keep the rest of the assertions (`Parent`, `Labels`, `Jira Key`, stories-only, csv) unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | grep -A2 '✗'`
Expected: `✗ a Bug feature maps to Jira Bug` and `✗ a Bug story maps to Jira Bug`.

- [ ] **Step 3: Implement**

`js/export-jira.js`:
- Line 12 comment: `* opts: features (bool), stories (bool). Issue types come from each row's type (Setup → Hierarchy).`
- Line 22: `JR.DEFAULTS = { features: true, stories: false };`
- Line 63: `'Issue Type': RM.jiraTypeName(state, RM.typeOf(state, it, 'feature').key),`
- Line 87: `'Issue Type': RM.jiraTypeName(state, RM.typeOf(state, s, 'story').key),`

Check the top of the file for how `RM` is resolved in Node (`var RM = root.RM || require('./core.js')` or similar); if it is not already available, add the same pattern `js/jira.js` uses.

`js/app.js` export wizard (~10735): delete the two `<div><label class="p-lab">Features</label><input id="jxFeatureType" …` and `Stories … #jxStoryType` lines and the `featureType:` / `storyType:` entries in the options object at ~10753–10754. If the surrounding grid becomes empty, drop its wrapper too. Add a hint under the Features/Stories checkboxes: `'<div class="m-hint">Issue types follow each item’s type (Setup → Hierarchy).</div>'`.

- [ ] **Step 4: Run tests, commit**

Run: `make test` — expected `0 failed` everywhere.

```bash
git add js/export-jira.js js/app.js tests/core.test.js
git commit -m "feat(export): Jira CSV issue type follows each item's type"
```

---

### Task 4: Jira sync resolves and pushes per-type issue types

**Files:**
- Modify: `js/jira.js` — `JR.DEFAULTS` (35), `typeName` (131), `featureFields` (155), `storyFields` (182), `epicFields` (215), `JR.plan` (258–345), `JR.resolveTypes` (482–497), `JR.discover` (538–544), preview lines (1359–1363), settings HTML (1195–1197) and `mapping()`/wire list (1244–1246, 1253)
- Test: `tests/jira.test.js`

**Interfaces:**
- Consumes: `RM.typeOf`, `RM.jiraTypeName`, `RM.itemTypes`, `RM.levelOf`, `RM.setItemTypeJira`.
- Produces: `JR.resolveTypes(issueTypes, state)` → `{ byKey: { <typeKey>: { name, subtask } }, known, notes: [] }`; `info.types` has that shape; plan story entries carry `nest` per story.

- [ ] **Step 1: Write the failing tests**

In `tests/jira.test.js`, extend the fixture: give item `a` a `type: 'bug'`, give story `s1` `type: 'subtask'` and story `s2` `type: 'bug'`. Then add a section right after the `— adf` section:

```js
console.log('— resolveTypes');
var projTypes = [{ name: 'Epic', hierarchyLevel: 1 }, { name: 'Story' }, { name: 'Bug' }, { name: 'Sub-task', subtask: true }];
var rt = JR.resolveTypes(projTypes, state);
eq(rt.byKey.epic.name, 'Epic', 'epic resolves by name');
eq(rt.byKey.bug.name, 'Bug', 'bug resolves by name');
eq(rt.byKey.story, { name: 'Sub-task', subtask: true }, 'story type resolves to Sub-task and is flagged subtask');
eq(rt.byKey.task.name, 'Story', 'a missing feature-level type falls back to Story');
ok(rt.notes.some(function (n) { return /Task.*not in the project.*Story/.test(n); }), 'fallback is noted');
var rt2 = JR.resolveTypes([{ name: 'Epic', hierarchyLevel: 1 }, { name: 'Task' }], state);
eq(rt2.byKey.subtask, { name: 'Task', subtask: false }, 'no subtask type in the project: story-level types fall back to Task');
eq(JR.resolveTypes([], state).known, false, 'empty project type list is unknown');
```

In the existing plan tests, find the assertions that check created feature/story `issuetype` names (search `issuetype` in the test file) and update: feature `a` now creates with `issuetype.name === 'Bug'`; story `s1` nests (`fields.parent` set, `nest === true`) with `issuetype.name === 'Sub-task'`; story `s2` (type bug, already keyed HW-20) is an update. Add after the plan is built:

```js
var pa = plan.features.filter(function (f) { return f.id === 'a'; })[0];
eq(pa.fields.issuetype.name, 'Bug', 'a Bug feature is created as Bug');
var ps1 = plan.stories.filter(function (s) { return s.id === 's1'; })[0];
eq(ps1.fields.issuetype.name, 'Sub-task', 'a Subtask story is created as Sub-task');
ok(ps1.nest === true, 'subtask stories nest');
```

Add a second flat-type test: in the `— stories without a sub-task type` section replace the `flat` object's `types` with `{ byKey: { epic: { name: 'Epic', subtask: false }, feature: { name: 'Story', subtask: false }, bug: { name: 'Bug', subtask: false }, task: { name: 'Task', subtask: false }, story: { name: 'Story', subtask: false }, subtask: { name: 'Story', subtask: false } }, known: true, notes: [] }` and keep its assertions. Then add:

```js
console.log('— mixed nesting');
var mixed = { remote: info.remote, types: rt, startField: null, accounts: {}, board: null, notes: [] };
var pm = JR.plan(state, cfg, mixed);
var bugStory = pm.updates.filter(function (u) { return u.id === 's2'; })[0];
ok(bugStory && bugStory.kind === 'story', 'the Bug story (non-subtask) is planned');
ok(pm.storyLinks.some(function (l) { return l.storyId === 's2'; }), 'a non-subtask story gets a feature link instead of a parent');
ok(!pm.storyLinks.some(function (l) { return l.storyId === 's1'; }), 'a subtask story does not');
```

Also update the `dclient` project response at ~line 240 to include `{ name: 'Bug' }`, and any discover-note assertions that reference the old `Feature type “…” is not in the project` wording to the new per-type wording (`Type “Task” is not in the project; using “Story”`).

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/jira.test.js 2>&1 | grep '✗' | head`
Expected: failures on `byKey` (undefined).

- [ ] **Step 3: Implement resolution**

Replace `JR.resolveTypes` with:

```js
  // the project's issue types resolved per Headway type key:
  // { byKey: { key: { name, subtask } }, known, notes }
  JR.resolveTypes = function (issueTypes, state) {
    var list = Array.isArray(issueTypes) ? issueTypes : [];
    function byName(n) { return n ? list.filter(function (t) { return lc(t.name) === lc(n); })[0] : null; }
    function first(pred) { return list.filter(pred)[0]; }
    var epicKeys = RM.levelOf(state, 'epic').types, storyKeys = RM.levelOf(state, 'story').types;
    var out = { byKey: {}, known: list.length > 0, notes: [] };
    RM.itemTypes(state).forEach(function (t) {
      var want = t.jira || t.label;
      var hit = byName(want);
      if (!hit && list.length) {
        if (epicKeys.indexOf(t.key) !== -1) hit = first(function (x) { return x.hierarchyLevel === 1; }) || byName('Epic');
        else if (storyKeys.indexOf(t.key) !== -1) hit = first(function (x) { return !!x.subtask; }) || byName('Story') || byName('Task');
        if (!hit) hit = byName('Story') || byName('Task') || first(function (x) { return !x.subtask && x.hierarchyLevel !== 1 && lc(x.name) !== 'epic'; });
        if (hit) out.notes.push('Type “' + want + '” (' + t.label + ') is not in the project; using “' + hit.name + '”');
      }
      out.byKey[t.key] = { name: hit ? hit.name : want, subtask: !!(hit && hit.subtask) };
    });
    return out;
  };
```

Replace `typeName`:

```js
  // the Jira issue type for an epic name / item / story
  function typeName(info, state, obj, kind) {
    var key = RM.typeOf(state, obj, kind).key;
    var r = info && info.types && info.types.byKey && info.types.byKey[key];
    return r ? r.name : RM.jiraTypeName(state, key);
  }
  function isSubtask(info, state, st) {
    var key = RM.typeOf(state, st, 'story').key;
    var r = info && info.types && info.types.byKey && info.types.byKey[key];
    // no project info yet: assume the default Sub-task nesting
    return r ? !!r.subtask : true;
  }
```

Update the three field builders: `featureFields` → `issuetype: { name: typeName(info, state, it, 'feature') }`; `storyFields` → `issuetype: { name: typeName(info, state, st, 'story') }`; `epicFields(name, cfg, info, state)` → `issuetype: { name: typeName(info, state, name, 'epic') }` (it already receives `state`; make sure every caller passes it — `JR.plan` does).

`JR.DEFAULTS`: remove `epicType`, `featureType`, `storyType`.

In `JR.plan`: delete the `var nest = …` line and the `if (cfg.pushStories && info.types && !info.types.storyIsSubtask) { plan.notes.push(…) }` block. Replace with:

```js
    var anyFlat = false;
```

Inside the stories loop, compute per story:

```js
          var nest = isSubtask(info, state, st);
          if (!nest) anyFlat = true;
          var sf = JR.storyFields(state, it, st, cfg, nest ? (it.jiraKey || null) : null, info);
```

and change the sprint placement condition from `if (!(info.types && info.types.storyIsSubtask))` to `if (!nest)`. After the `work.forEach` loop add:

```js
    if (cfg.pushStories && anyFlat && info.types && info.types.known) {
      plan.notes.push('Some ' + RM.levelLabel(state, 'story', true).toLowerCase() + ' use a type that is not a sub-task in Jira; they are created beside their ' +
        RM.levelLabel(state, 'feature').toLowerCase() + ', linked to it and labelled feature-….');
    }
```

In `JR.discover`, replace the four lines `info.types = JR.resolveTypes(…)` through the three `info.notes.push` lines with:

```js
          info.types = JR.resolveTypes((p && p.issueTypes) || [], state);
          info.types.notes.forEach(function (n) { info.notes.push(n); });
```

Check the top of `JR.discover` for `cfg` uses of the removed keys and grep the whole file for `epicType|featureType|storyType|storyIsSubtask|info.types.feature|info.types.story|info.types.epic` — every hit must go.

Preview (~1359–1363): replace the three `line(…)` calls with

```js
          line(plan.epics.length, RM.levelLabel(state, 'epic', plan.epics.length !== 1).toLowerCase() + ' to create in ' + esc(cfg.project)) +
          line(plan.features.length, RM.levelLabel(state, 'feature', plan.features.length !== 1).toLowerCase() + ' to create') +
          line(plan.stories.length, RM.levelLabel(state, 'story', plan.stories.length !== 1).toLowerCase() + ' to create') +
```

and delete `var t = info.types || {};` if nothing else uses `t`.

- [ ] **Step 4: Settings card**

In `JR.settingsHtml`, remove the three `Epic type` / `Feature type` / `Story type` `m-sec` blocks. After the `</div>` that closes the `p-grid2`, insert a types table:

```js
      '<h2 style="margin-top:18px">Issue types</h2>' +
      '<div class="m-hint">Each Headway type becomes this Jira issue type. Types are defined in Setup → Hierarchy; the Jira name can be edited here or there.</div>' +
      '<table class="hol-table jr-types"><thead><tr><th>Headway type</th><th>Jira issue type</th><th>In project</th></tr></thead><tbody>' +
      RM.itemTypes(st).map(function (t) {
        var r = JR.lastTypes && JR.lastTypes.byKey && JR.lastTypes.byKey[t.key];
        var res = !r ? '' : (lc(r.name) === lc(t.jira || t.label) ? '✓' : 'falls back to ' + esc(r.name));
        return '<tr><td><i data-lucide="' + esc(t.icon) + '"></i> ' + esc(t.label) + '</td>' +
          '<td><input data-jrtype="' + esc(t.key) + '" value="' + esc(t.jira || '') + '" placeholder="' + esc(t.label) + '"></td>' +
          '<td class="m-hint">' + res + '</td></tr>';
      }).join('') + '</tbody></table>' +
```

where `st` is `app().ai.state()` (read it at the top of `settingsHtml` the way `peopleHtml` does). Add `JR.lastTypes = null;` near `JR.DEFAULTS`, and set `JR.lastTypes = info.types;` at the end of `JR.discover` (after the project read succeeds) and in the Test connection handler if it reads the project — check `#jrTest`'s handler (~1265) and, if it only pings `/myself`, extend it to also `client.get('/rest/api/3/project/' + cfg.project)` and store `JR.lastTypes = JR.resolveTypes(p.issueTypes, st)` then re-render the settings host.

In `JR.wireSettings`: remove `#jrEpicType`, `#jrFeatureType`, `#jrStoryType` from `mapping()` and from the selector list, and add:

```js
    host.addEventListener('change', function (ev) {
      var inp = ev.target.closest && ev.target.closest('[data-jrtype]');
      if (!inp) return;
      var key = inp.dataset.jrtype, val = inp.value;
      app().ai.commit('jira issue type', function (s) { RM.setItemTypeJira(s, key, val); });
    });
```

- [ ] **Step 5: Run tests, commit**

Run: `make test` — expected `0 failed`. Also `grep -n "epicType\|featureType\|storyType\|storyIsSubtask" js/*.js tests/*.js` must return only the legacy-migration line in `core.js` and its test.

```bash
git add js/jira.js tests/jira.test.js
git commit -m "feat(jira): resolve and push issue types per Headway type"
```

---

### Task 5: Setup → Hierarchy card

**Files:**
- Modify: `js/app.js` — `renderSetup` tab bodies (`project` group, after the Epics card ~8802–8804); click handler `$('#setupView').addEventListener('click', …)` (~8951 or 9111); change handler (~8962)
- Modify: `css/app.css` — new `.su-hier-*` rules
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: Task 1–2 helpers.
- Produces: Setup card markup with `data-suhier*` hooks used by the smoke test: `input[data-suhlabel="<kind>"]`, `button[data-suhtype="<kind>:<key>"]`, `input[data-suhtlabel="<key>"]`, `button[data-suhticon="<key>"]`, `input[data-suhtjira="<key>"]`, `button[data-suhtrm="<key>"]`, `#suHierAny`, `#suHierAdd`.

- [ ] **Step 1: Write the failing smoke test**

Find the block in `tests/smoke.test.js` that switches to the Setup view (search `setupTab` or `data-sutab`). After it, add:

```js
{
  window.__headway.setView && window.__headway.setView('setup');
  // fall back to the Setup menu entry if there is no direct setter
  const tab = doc.querySelector('.su-tab[data-sutab="project"]');
  if (tab) click(tab);
  const card = [...doc.querySelectorAll('#setupView .su-card h2')].find(h => h.textContent === 'Hierarchy');
  ok(!!card, 'Hierarchy card renders in the Project tab');
  const bugChip = doc.querySelector('button[data-suhtype="feature:bug"]');
  ok(bugChip && bugChip.classList.contains('on'), 'Bug is allowed at the Feature level by default');
  click(bugChip);
  ok(state().meta.hierarchy.levels[1].types.indexOf('bug') === -1, 'clicking a chip disallows the type');
  click(doc.querySelector('button[data-suhtype="feature:bug"]'));
  ok(state().meta.hierarchy.levels[1].types.indexOf('bug') !== -1, 'clicking again re-allows it');
  const lbl = doc.querySelector('input[data-suhlabel="story"]');
  lbl.value = 'Task'; lbl.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(state().meta.hierarchy.levels[2].label === 'Task', 'level label edit commits');
  click(doc.querySelector('#suHierAdd'));
  ok(state().meta.itemTypes.some(t => t.label === 'New type'), 'Add type appends a record');
  const any = doc.querySelector('#suHierAny');
  any.checked = true; any.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(state().meta.hierarchy.anyTypeAnyLevel === true && !doc.querySelector('button[data-suhtype]'), 'the switch hides the chips');
  any.checked = false; any.dispatchEvent(new window.Event('change', { bubbles: true }));
}
```

Look at how the existing smoke test reaches the Setup view (search for `'setup'` in the file) and use that same mechanism instead of the `setView` guess if it differs.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗'`
Expected: `✗ Hierarchy card renders in the Project tab`.

- [ ] **Step 3: Render the card**

In `renderSetup`, before `var tabBodies = {`, build the markup:

```js
    var hier = m.hierarchy, anyLvl = RM.anyTypeAnyLevel(state);
    var levelRows = hier.levels.map(function (lv) {
      var chips = anyLvl ? '' : RM.itemTypes(state).map(function (t) {
        var on = lv.types.indexOf(t.key) !== -1;
        return '<button class="su-hchip' + (on ? ' on' : '') + '" data-suhtype="' + esc(lv.key + ':' + t.key) + '" title="' + (on ? 'Allowed' : 'Not allowed') + ' at this level">' +
          '<i data-lucide="' + esc(t.icon) + '"></i>' + esc(t.label) + '</button>';
      }).join('');
      return '<div class="su-hlevel"><input data-suhlabel="' + lv.key + '" value="' + esc(lv.label) + '" aria-label="Level label">' +
        '<div class="su-hchips">' + chips + '</div></div>';
    }).join('');
    var typeRows = RM.itemTypes(state).map(function (t) {
      return '<tr><td><button class="su-hicon" data-suhticon="' + esc(t.key) + '" title="Icon"><i data-lucide="' + esc(t.icon) + '"></i></button></td>' +
        '<td><input data-suhtlabel="' + esc(t.key) + '" value="' + esc(t.label) + '" aria-label="Type label"></td>' +
        '<td><input data-suhtjira="' + esc(t.key) + '" value="' + esc(t.jira) + '" placeholder="Jira issue type" aria-label="Jira issue type"></td>' +
        '<td class="hol-x"><button data-suhtrm="' + esc(t.key) + '" title="Remove type"><i data-lucide="x"></i></button></td></tr>';
    }).join('');
    var hierCard =
      '<section class="su-card"><h2>Hierarchy</h2>' +
      '<div class="m-hint">Three levels, top to bottom. Name each level and pick which types it accepts; the first allowed type is the default for new items.</div>' +
      '<div class="su-hlevels">' + levelRows + '</div>' +
      (anyLvl ? '<div class="m-hint">Every type is allowed at every level.</div>' : '') +
      '<label class="p-check" style="margin-top:10px"><input type="checkbox" id="suHierAny"' + (anyLvl ? ' checked' : '') + '> Allow any type at any level</label>' +
      '<h3 class="su-sub">Types</h3>' +
      '<table class="hol-table su-htypes"><thead><tr><th></th><th>Label</th><th>Jira issue type</th><th></th></tr></thead><tbody>' + typeRows + '</tbody></table>' +
      '<button id="suHierAdd" style="margin-top:8px"><i data-lucide="plus"></i> Add type</button>' +
      '<div class="m-hint">Behavior follows the level, not the type: a Bug at the ' + esc(RM.levelLabel(state, 'feature')) + ' level is a bar on the timeline like any other. The Jira name is what sync and the CSV export use.</div>' +
      '</section>';
```

Then insert `hierCard +` right after the Epics `</section>' +` in the `project` tab body.

- [ ] **Step 4: Wire events**

In the setup `click` handler (the one containing `if (t.dataset.suepedit)`), add before that line:

```js
    if (t.dataset.suhtype) {
      var parts = t.dataset.suhtype.split(':'), hk = parts[0], tk = parts[1];
      var wasOn = t.classList.contains('on');
      var okT = true;
      commit(wasOn ? 'disallow type' : 'allow type', function (s2) { okT = RM.setTypeAllowed(s2, hk, tk, !wasOn); });
      if (!okT) toast('A level needs at least one type');
      return;
    }
    if (t.dataset.suhtrm) {
      var rmKey = t.dataset.suhtrm, okR = true;
      commit('remove type', function (s2) { okR = RM.removeItemType(s2, rmKey); });
      if (!okR) toast('That type is the only one allowed at a level');
      return;
    }
    if (t.dataset.suhticon) { typeIconMenu(t, t.dataset.suhticon); return; }
    if (t.id === 'suHierAdd') {
      commit('add type', function (s2) { RM.addItemType(s2, 'New type', 'tag', ''); });
      requestAnimationFrame(function () { var inp = $('#setupView input[data-suhtlabel]:last-of-type'); if (inp) { inp.focus(); inp.select(); } });
      return;
    }
```

Note: `commit` may skip history when nothing changed; if it re-renders regardless that is fine. Check `commit`'s signature at line 476 — if it compares before/after and the refusal leaves state unchanged, the toast still shows because `okT` was set inside the mutator.

Define `typeIconMenu` next to `msStyleItems`:

```js
  function typeIconMenu(anchor, key) {
    var t = RM.itemType(state, key);
    openDropdown(anchor, EPIC_ICONS.map(function (ic) {
      return { icon: ic, label: ic, checked: !!t && t.icon === ic, fn: function () {
        commit('type icon', function (s2) { RM.setItemTypeIcon(s2, key, ic); });
      } };
    }));
  }
```

`EPIC_ICONS` is defined at ~line 4287; add `'bug', 'check-square', 'list-tree', 'rows-3', 'corner-down-right'` to that array so the defaults appear in the picker.

In the setup `change` handler (~8962), add:

```js
    if (t.dataset.suhlabel) { var hk2 = t.dataset.suhlabel, hv = t.value; commit('level label', function (s2) { RM.setLevelLabel(s2, hk2, hv); }); return; }
    if (t.dataset.suhtlabel) { var tk2 = t.dataset.suhtlabel, tv = t.value; commit('rename type', function (s2) { RM.renameItemType(s2, tk2, tv); }); return; }
    if (t.dataset.suhtjira) { var tk3 = t.dataset.suhtjira, jv = t.value; commit('type jira name', function (s2) { RM.setItemTypeJira(s2, tk3, jv); }); return; }
    if (t.id === 'suHierAny') { var on = t.checked; commit('any type at any level', function (s2) { RM.setAnyTypeAnyLevel(s2, on); }); return; }
```

- [ ] **Step 5: CSS**

Append to `css/app.css` near the other `.su-` rules:

```css
.su-hlevels { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.su-hlevel { display: grid; grid-template-columns: 160px 1fr; gap: 10px; align-items: center; }
.su-hchips { display: flex; flex-wrap: wrap; gap: 6px; }
.su-hchip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--well); color: var(--ink-2); font-size: 12.5px; cursor: pointer; }
.su-hchip.on { background: var(--surface); color: var(--ink); border-color: var(--blue); box-shadow: 0 0 0 1px var(--blue) inset; }
.su-hchip i { width: 13px; height: 13px; }
.su-sub { font-size: 13px; font-weight: 600; margin: 16px 0 6px; }
.su-hicon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; }
.su-htypes td:first-child { width: 36px; }
```

Use the CSS variable names already present in `app.css` (`grep -o -- '--[a-z0-9-]*' css/app.css | sort -u | head -40`) and substitute if `--line-2`, `--well`, `--ink-2`, `--surface`, `--blue` differ.

- [ ] **Step 6: Run tests, commit**

Run: `make test` — expected `0 failed`.

```bash
git add js/app.js css/app.css tests/smoke.test.js
git commit -m "feat(setup): Hierarchy card for level labels, allowed types and type records"
```

---

### Task 6: Level labels in prominent UI strings

**Files:**
- Modify: `js/app.js` at: 913–914 (`DM_MODES`), 1955, 2633, 3558, 3624, 5421, 5467, 5475–5476, 5502, 5559, 7424, 7448 (`Features`/`Stories` snap labels), 8861, 8864, 8872, 8876, `sizingCardsFor` label at ~8631 (`'Story size options'`), 4063 (`sec('stories', 'Stories', …)`), 4007 panel `placeholder="Feature name"`, 4142 `placeholder="Story title"`, Scoping column-scope menu (search `'Features only'`/`'Stories only'`/`'both'` near line 6472 or `scope:` menu builder).
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: `RM.levelLabel(state, kind, plural)`.
- Produces: helper `lvl(kind, plural)` in app.js returning `RM.levelLabel(state, kind, plural)`.

- [ ] **Step 1: Write the failing smoke test**

Append to the Task 5 smoke block (before its closing brace, after the switch is turned back off), then re-enter Planning:

```js
  const sl = doc.querySelector('input[data-suhlabel="story"]');
  sl.value = 'Task'; sl.dispatchEvent(new window.Event('change', { bubbles: true }));
  const fl = doc.querySelector('input[data-suhlabel="feature"]');
  fl.value = 'Capability'; fl.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(doc.querySelector('.tab[data-view="planning"]') || doc.querySelector('[data-view="planning"]'));
  ok([...doc.querySelectorAll('.addrow-lab')].some(el => /Add Capability/.test(el.textContent)), 'Add-row wording follows the level label');
  fl.value = 'Feature'; sl.value = 'Story';
```

Reset the labels at the end through the state instead if the inputs are gone after the view switch: `window.__headway` exposes `getState`; check for a `commit`/`setState` hook in the `__headway` object at ~line 10874 and use it, otherwise navigate back to Setup and change the inputs again.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗'`
Expected: `✗ Add-row wording follows the level label`.

- [ ] **Step 3: Add the helper and replace strings**

Near `DM_MODES` (~912) add:

```js
  function lvl(kind, plural) { return RM.levelLabel(state, kind, plural); }
```

`DM_MODES` and `LEVEL_MODES` are static arrays; make them functions of state: rename to `function dmModes() { return [['feature', lvl('feature'), 'rows-3'], ['story', lvl('story'), 'list-tree']]; }` and update the six use sites (946, 947, 951, 2180, 2277, 2671, 2764) to call `dmModes()`.

Replace each string:
- 1955 `Add story` → `'Add ' + lvl('story')`
- 2633 `Add feature` → `'Add ' + lvl('feature')`
- 3558 `placeholder="Add story…"` → `placeholder="Add ' + esc(lvl('story').toLowerCase()) + '…"`
- 3624 `Add a feature to ` → `'Add a ' + esc(lvl('feature').toLowerCase()) + ' to '`, and ` Add feature</span>` → `' Add ' + esc(lvl('feature')) + '</span>'`
- 5421 `Add feature here` → `'Add ' + lvl('feature').toLowerCase() + ' here'`
- 5467 `Add story` → `'Add ' + lvl('story').toLowerCase()`
- 5475/5476 `Insert feature above/below` → `'Insert ' + lvl('feature').toLowerCase() + ' above'` / `' below'`
- 5502 and 5559 `Convert to feature` → `'Convert to ' + lvl('feature').toLowerCase()`
- 7424 `Add feature` → `'Add ' + lvl('feature').toLowerCase()`
- 7448 `[['feature', 'Features'], ['story', 'Stories']]` → `[['feature', lvl('feature', true)], ['story', lvl('story', true)]]`
- 8861/8864/8872/8876 card titles → `lvl('feature') + ' sizing'`, `lvl('story') + ' sizing'`, `lvl('feature') + ' priority'`, `lvl('story') + ' priority'` (use `esc(...)`)
- `sizingCardsFor`: `kind === 'story' ? lvl('story') + ' size options' : 'Size options'`
- 4063 `sec('stories', 'Stories', …)` → `sec('stories', esc(lvl('story', true)), …)`
- 4007 `placeholder="Feature name"` → `placeholder="' + esc(lvl('feature')) + ' name"`; 4142 similarly with `lvl('story')`
- Column-scope menu: grep `Features only\|Stories only\|features and stories` and substitute `lvl('feature', true)` / `lvl('story', true)`.

Every replacement is inside a string concatenation; keep quotes balanced and wrap with `esc()` where the value lands in HTML.

- [ ] **Step 4: Run tests, commit**

Run: `make test` — expected `0 failed`. Then boot the page headlessly per the verification memory (jsdom smoke already covers rendering) and eyeball `grep -n "'Add feature\|Insert feature\|Convert to feature\|Feature sizing\|Story sizing" js/app.js` returns nothing.

```bash
git add js/app.js tests/smoke.test.js
git commit -m "feat(ui): level labels drive add-row, menu, toggle and setup wording"
```

---

### Task 7: Type pickers, row icons, epic type, history

**Files:**
- Modify: `js/app.js` — feature panel header (~4004–4010) and its click handler (~4520); story panel header (`renderStoryPanel` ~4087–4145) and its click handler; row context menu (~5467–5510) and `bulkMenuItems`; `epicEditModal` (~4291–4340); Planning/Scoping row title (3439–3440), story row (3478–3479), Prioritizing cards (1958, 2049), Sprinting rows (2594, 2608); history diff (~300–330); `__headway` export object (~10874)
- Modify: `css/app.css`
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: `RM.typeOf`, `RM.typesFor`, `RM.defaultTypeFor`, `state.epicTypes`.
- Produces: `setItemType(itemId, key)`, `setStoryType(itemId, storyId, key)`, `typeMenuItems(kind, current, onPick)`, `typeIconHtml(state, obj, kind)` (empty string when the type is the level default), panel chip `[data-act="itype"]`, story panel chip `[data-act="stype"]`.

- [ ] **Step 1: Write the failing smoke test**

Add a block after the Task 6 block, back in Planning with an item selected (find how existing smoke tests select a row and open the panel: search `.p-top` or `selectItem` in the file):

```js
{
  const first = state().items[0];
  window.__headway.selectItem ? window.__headway.selectItem(first.id) : click(doc.querySelector('.row.item[data-id="' + first.id + '"]'));
  const chip = doc.querySelector('#panel [data-act="itype"]');
  ok(chip && /Feature/.test(chip.textContent), 'panel shows the type chip');
  click(chip);
  const bug = [...doc.querySelectorAll('.menu-list .menu-item, .dd-item, [data-ddi]')].find(el => /^Bug$/.test(el.textContent.trim()));
  ok(!!bug, 'type dropdown lists Bug');
  click(bug);
  ok(state().items[0].type === 'bug', 'picking Bug sets the item type');
  ok(!!doc.querySelector('.row.item[data-id="' + first.id + '"] .r-type'), 'a non-default type shows its icon on the row');
  window.__headway.setItemType(first.id, 'feature');
  ok(!doc.querySelector('.row.item[data-id="' + first.id + '"] .r-type'), 'the default type shows no icon');
}
```

Match the dropdown item selector to what `openDropdown` renders (read its markup at ~4193–4260 and use its item class).

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗'`
Expected: `✗ panel shows the type chip`.

- [ ] **Step 3: Implement helpers**

Next to `msStyleItems` add:

```js
  function setItemType(itemId, key) {
    commit('type', function (s) { var t = RM.itemById(s, itemId); if (t && RM.itemType(s, key)) t.type = key; });
  }
  function setStoryType(itemId, storyId, key) {
    commit('story type', function (s) {
      var t = RM.itemById(s, itemId); if (!t) return;
      t.stories.forEach(function (st) { if (st.id === storyId && RM.itemType(s, key)) st.type = key; });
    });
  }
  function setEpicType(name, key) {
    commit('epic type', function (s) {
      if (!RM.itemType(s, key) || key === RM.defaultTypeFor(s, 'epic')) delete s.epicTypes[name];
      else s.epicTypes[name] = key;
    });
  }
  // dropdown / submenu entries for a level's types; the current type is
  // listed even when it is no longer allowed there
  function typeMenuItems(kind, currentKey, onPick) {
    var list = RM.typesFor(state, kind).slice();
    var cur = RM.itemType(state, currentKey);
    if (cur && !list.some(function (t) { return t.key === cur.key; })) list.push(cur);
    var allowed = RM.typesFor(state, kind).map(function (t) { return t.key; });
    return list.map(function (t) {
      var off = allowed.indexOf(t.key) === -1;
      return { icon: t.icon, label: t.label + (off ? ' (not allowed here)' : ''), checked: t.key === currentKey, fn: function () { onPick(t.key); } };
    });
  }
  function typeChipHtml(act, kind, obj) {
    var t = RM.typeOf(state, obj, kind);
    return '<button class="p-typechip" data-act="' + act + '" title="Type"><i data-lucide="' + esc(t.icon) + '"></i> ' + esc(t.label) + '</button>';
  }
  function typeIconHtml(obj, kind) {
    var t = RM.typeOf(state, obj, kind);
    if (t.key === RM.defaultTypeFor(state, kind)) return '';
    return '<span class="r-type" title="' + esc(t.label) + '"><i data-lucide="' + esc(t.icon) + '"></i></span>';
  }
```

- [ ] **Step 4: Panel chips**

Feature panel (~4007): after the `#<input class="p-num-edit" …></span>` fragment and before the milestone chip, insert `typeChipHtml('itype', 'feature', it) +`. In the panel click handler next to `var msChip = e.target.closest('[data-act="msstyle"]');` add:

```js
    var tyChip = e.target.closest('[data-act="itype"]');
    if (tyChip) { openDropdown(tyChip, typeMenuItems('feature', it.type, function (k) { setItemType(it.id, k); })); return; }
```

(`it` is the panel's current item in that handler; confirm the variable name used there.)

Story panel (`renderStoryPanel`): in its header `p-top` add `typeChipHtml('stype', 'story', st)` next to the story's number/lead, and in its click handler:

```js
    var stChip = e.target.closest('[data-act="stype"]');
    if (stChip) { openDropdown(stChip, typeMenuItems('story', st.type, function (k) { setStoryType(it.id, st.id, k); })); return; }
```

- [ ] **Step 5: Context menus**

In the item context menu items array, after the `Set epic…` entry add:

```js
        { icon: RM.typeOf(state, it, 'feature').icon, label: 'Type: ' + RM.typeOf(state, it, 'feature').label + '…', fn: function () {
          openContextMenu(cx, cy, typeMenuItems('feature', it.type, function (k) { setItemType(itemId, k); }));
        } },
```

In `bulkMenuItems(ids, cx, cy)` add an equivalent entry whose `onPick` loops `ids` inside one `commit('type', …)`. In the story row context menu (search `rowEl.classList.contains('story')` in the same handler), add the same with `typeMenuItems('story', st.type, function (k) { setStoryType(itemId, st.id, k); })`.

- [ ] **Step 6: Epic modal and epic rows**

In `epicEditModal`, after the Icon `m-sec` add:

```js
      '<div class="m-sec"><label>Type</label><select id="epType" style="width:100%">' +
      typeMenuItems('epic', RM.typeOf(state, epicName, 'epic').key, function () {}).map(function (o) {
        return '<option value="' + esc(o.label.replace(/ \(not allowed here\)$/, '')) + '"' + (o.checked ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select></div>' +
```

Simpler and more robust: build the options directly from `RM.typesFor(state, 'epic')` plus the current record, using `t.key` as the option value; in `#epSave`'s handler read `$('#epType', host).value` and inside the existing `commit('edit epic', …)` apply the same logic as `setEpicType` (delete when default, else set) under `name2`. Also carry `epicTypes` across a rename: `if (s.epicTypes[epicName] != null) { s.epicTypes[name2] = s.epicTypes[epicName]; delete s.epicTypes[epicName]; }`.

Also handle epic deletion (`deleteEpicConfirm`) and the AI/other places that rename epics: grep `epicIcons\[` in `app.js` and mirror each rename/delete for `epicTypes`.

- [ ] **Step 7: Row icons**

- 3439/3440: prefix the title markup with `typeIconHtml(it, 'feature') +`.
- 3478/3479: prefix with `typeIconHtml(st, 'story') +`.
- 1958 and 2594 (feature cards/rows): prefix the title input with `typeIconHtml(it, 'feature') +`.
- 2049 and 2608 (story cards/rows): prefix with `typeIconHtml(st, 'story') +`.

CSS:

```css
.r-type { display: inline-flex; align-items: center; margin-right: 4px; color: var(--ink-2); flex: 0 0 auto; }
.r-type i { width: 13px; height: 13px; }
.p-typechip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--well); color: var(--ink-2); margin-left: 6px; cursor: pointer; }
.p-typechip i { width: 12px; height: 12px; }
```

- [ ] **Step 8: History diff**

In the per-item diff (~300–330), after the `Epic` push add:

```js
      push('scope', lbl + ' — Type', RM.typeOf(a, p, 'feature').label, RM.typeOf(b, it, 'feature').label);
```

and inside the stories loop after the `Size` push:

```js
        push('scope', sl + ' — Type', RM.typeOf(a, sp, 'story').label, RM.typeOf(b, st, 'story').label);
```

After `genericDiff('setup', 'Workstream color — ', a.wsColors, b.wsColors);` add:

```js
    genericDiff('setup', 'Epic type — ', a.epicTypes, b.epicTypes);
```

`genericDiff('setup', 'Setup — ', a.meta, b.meta)` will already report `itemTypes`/`hierarchy` as raw JSON; that matches how other meta objects show today. Leave it.

- [ ] **Step 9: Expose for tests**

In the `window.__headway = { … }` object add `setItemType: setItemType,` and, if there is no existing `selectItem`, whatever the panel-opening function is named (search `function selectItem` / `function openPanel`).

- [ ] **Step 10: Run tests, commit**

Run: `make test` — expected `0 failed`.

```bash
git add js/app.js css/app.css tests/smoke.test.js
git commit -m "feat(ui): type chips, context-menu type picker, epic type, row icons, history"
```

---

### Task 8: AI assistant knows about types

**Files:**
- Modify: `js/ai.js` — tool descriptions (369, 381, ~395), `itemLine` (~231), `mergeFields` (search `function mergeFields`), `add_items` handler (~575–585), system prompt (~687)
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: `RM.itemType`, `RM.itemTypes`, `RM.defaultTypeFor`.
- Produces: `type` accepted on features and stories in `add_items`/`update_items` (key or label, case-insensitive); `itemLine` includes `type` when not the level default.

- [ ] **Step 1: Write the failing test**

Look at how `tests/ai.test.js` invokes tools (search `add_items` there) and mirror its harness. Add:

```js
console.log('— item types');
{
  var rA = runTool('add_items', { items: [{ feature: 'Crash on save', type: 'Bug', stories: [{ title: 'repro', type: 'subtask' }] }] });
  var stA = currentState();
  var added = stA.items.filter(function (x) { return x.feature === 'Crash on save'; })[0];
  ok(added && added.type === 'bug', 'add_items accepts a type label');
  ok(added.stories[0].type === 'subtask', 'story type on add');
  runTool('update_items', { updates: [{ num: added.num, fields: { type: 'task' } }] });
  ok(currentState().items.filter(function (x) { return x.num === added.num; })[0].type === 'task', 'update_items sets type by key');
  var threw = false;
  try { runTool('update_items', { updates: [{ num: added.num, fields: { type: 'nope' } }] }); } catch (e) { threw = /unknown type/.test(e.message); }
  ok(threw, 'unknown type is rejected');
  var line = JSON.stringify(runTool('get_project', { part: 'items' }));
  ok(/"type":"task"/.test(line), 'itemLine reports a non-default type');
}
```

Replace `runTool` / `currentState` with the names the file already uses.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/ai.test.js 2>&1 | grep '✗'`
Expected: `✗ add_items accepts a type label`.

- [ ] **Step 3: Implement**

In `mergeFields(meta, target, f, isStory)` (find it; it takes the meta and merges known fields), add handling — since it receives `meta` not `state`, resolve types through `RM.itemTypes({ meta: meta })`:

```js
    if (f.type != null) {
      var want = String(f.type).trim().toLowerCase();
      var hit = RM.itemTypes({ meta: meta }).filter(function (t) { return t.key.toLowerCase() === want || t.label.toLowerCase() === want; })[0];
      if (!hit) throw new Error('unknown type "' + f.type + '"');
      target.type = hit.key; changed.push('type'); delete f.type;
    }
```

Match the local variable that tracks changed field names in that function. In `add_items`, stories inside `spec.stories` go through `mergeFields(..., true)` already or are copied directly — check; if copied directly, map `type` the same way for each story.

`itemLine`: after `if (it.milestone) o.milestone = true;` add `if (it.type && it.type !== RM.defaultTypeFor(state, 'feature')) o.type = it.type;`.

Tool descriptions: add `type (Feature, Bug, Task, … — a type label or key from Setup → Hierarchy)` to the feature field list in `add_items` and `update_items`, and to the story field list. In `update_project`'s path list add `meta/itemTypes (array of {key,label,icon,jira}), meta/hierarchy/levels/<i>/types, meta/hierarchy/anyTypeAnyLevel, epicTypes/<name>`.

System prompt line 687: append `, type (Feature / Bug / Task …; types and the per-level allowed list live in meta.itemTypes and meta.hierarchy, and each type's jira field is the Jira issue type used by sync)`.

- [ ] **Step 4: Run tests, commit**

Run: `make test` — expected `0 failed`.

```bash
git add js/ai.js tests/ai.test.js
git commit -m "feat(ai): item types in tools and prompt"
```

---

### Task 9: Docs

**Files:**
- Modify: `README.md` (feature table: Jira row; add a Types & hierarchy row after Milestones), `CHANGELOG.md` (new top section)

- [ ] **Step 1: README**

Add after the Milestones row:

```
| Types & hierarchy | Every epic, feature and story has a **type** (Feature, Bug, Task, Story, Subtask, Epic by default — add your own). Setup → **Hierarchy** names the three levels, picks which types each level accepts (the first is the default for new items), and holds each type's **Jira issue type**. "Allow any type at any level" lifts the per-level restriction (off by default; a type outside its level only raises a validation warning). Pick a type from the panel chip, the row's context menu, or Edit epic; rows show the type icon when it isn't the level default |
```

Update the Jira row: replace "with the issue type names you choose" with "with each item's type mapped to a Jira issue type in Setup → Hierarchy", and in the AI row nothing changes.

- [ ] **Step 2: CHANGELOG**

Read the top of `CHANGELOG.md` for the section format, then add a new `## Unreleased` (or next version per the file's convention) section:

```
- Item types: every epic, feature and story carries a type (Feature, Bug, Task, Story, Subtask, Epic by default; add your own in Setup → Hierarchy). Rows show the icon for non-default types; pick a type from the panel, the context menu or Edit epic.
- Hierarchy settings: rename the three levels, choose which types each accepts, or allow any type at any level.
- Jira: sync and CSV export use each type's Jira issue type; the three fixed type fields in Setup → Jira are replaced by a per-type table. Existing documents keep their previous names.
- AI assistant can set and read item types.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: item types and hierarchy"
```

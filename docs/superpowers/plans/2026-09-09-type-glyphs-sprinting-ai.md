# Type Glyphs, Color by Type, Sprinting Cleanup, AI Model Loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type icons replace the workstream square everywhere, a "Color by item type" mode, milestones off the Prioritizing board, a deduplicated and slimmer Sprinting page with a Move-to-sprint context menu, 14px Jira table icons, and an AI drawer that loads models and effort levels on its own.

**Architecture:** Headway is a no-build vanilla ES5 app: `js/core.js` (`RM`, pure model + validation), `js/ai.js` (`AI`), `js/jira.js` (`JR`), `js/app.js` (all UI, ~11k lines, delegated handlers, `commit(label, fn)` for every mutation), `css/app.css`. Type colors and the `type` color mode live in core so exports agree; everything else is app.js rendering plus CSS.

**Tech Stack:** ES5 JavaScript (no build, no modules, IIFEs), Lucide icons via `<i data-lucide="…">`, Node test scripts (`tests/core.test.js`, `tests/ai.test.js`, `tests/smoke.test.js` with jsdom). Run everything with `make test` (needs `NODE_PATH=./node_modules`).

**Spec:** `docs/superpowers/specs/2026-09-09-type-glyphs-sprinting-ai-design.md`

## Global Constraints

- ES5 only in `js/*.js`: `var`, `function`, no arrow functions, template literals, `const`/`let`, spread, or `Array.prototype.includes`. Tests may use modern syntax (smoke uses `const`/arrows already).
- Every document mutation goes through `commit('label', function (s) { … })` in app.js; core mutators take `state` first.
- Every user string that lands in `innerHTML` passes through `esc()`.
- Icons: `<i data-lucide="name">` only; `esc()` icon names that come from documents.
- Do not touch `.impeccable/hook.cache.json`; do not `git stash` or reset — other sessions edit this tree. Work on the worktree branch `feat/type-glyphs` (see Task 0).
- Run the relevant suite after each task; all four suites must pass before merge. Baseline on main: core 579, jira 165, ai 155, smoke 832 passed, 0 failed.
- Keep existing test names passing unless the plan says to change one.

---

### Task 0: Worktree branch

**Files:** none

- [ ] **Step 1: Create the branch worktree**

```bash
cd /Users/arthur.pachachura/git/headway
git worktree add ../headway-glyphs -b feat/type-glyphs main
cd ../headway-glyphs && ln -s ../headway/node_modules node_modules 2>/dev/null; make test 2>&1 | tail -4
```

Expected: four suites run, `0 failed` each. All later tasks run inside `../headway-glyphs`.

---

### Task 1: Core — type colors, new default icons, `type` color mode

**Files:**
- Modify: `js/core.js:260-267` (defaults), `js/core.js:327-366` (`normalizeTypes`), `js/core.js:368-373` (`addItemType`), `js/core.js:379-382` (after `setItemTypeIcon`), `js/core.js:490` (`COLOR_MODES`), `js/core.js:574-609` (`colorForItem`, `colorLegend`)
- Test: `tests/core.test.js` (append to the `item types & hierarchy` section that starts at line 1253)

**Interfaces:**
- Produces: type records `{ key, label, icon, jira, color }` where `color` is always a resolved 6-hex string; `RM.setItemTypeColor(state, key, hex)`; `RM.colorForType(state, key)` → hex; `RM.COLOR_MODES` includes `'type'`; `RM.colorForItem` / `RM.colorLegend` support it.

- [ ] **Step 1: Write the failing tests**

Append inside the `item types & hierarchy` section of `tests/core.test.js` (after the last `}` block of that section, before the next `section(`):

```js
{
  var sC = RM.normalizeState({ meta: { title: 'C', timelineStart: '2026-07-27', numWeeks: 8 }, phases: [{ id: 'p', name: 'P' }], team: [], items: [] });
  var tF = RM.itemType(sC, 'feature'), tS = RM.itemType(sC, 'story');
  eq(tF.icon, 'square', 'feature default icon is the filled square glyph');
  eq(tS.icon, 'bookmark', 'story default icon is the bookmark');
  eq(RM.itemType(sC, 'task').icon, 'check-square', 'task icon unchanged');
  ok(RM.itemTypes(sC).every(function (t) { return /^[0-9A-F]{6}$/.test(t.color); }), 'every type carries a resolved 6-hex color');
  eq(RM.itemTypes(sC).map(function (t) { return t.color; }), RM.HASH_PALETTE.slice(0, RM.itemTypes(sC).length), 'default colors follow the hash palette in list order');
  eq(RM.colorForType(sC, 'bug'), RM.HASH_PALETTE[2], 'colorForType reads the record');
  eq(RM.colorForType(sC, 'nope'), RM.PALETTE.neutral, 'unknown type is neutral');
  RM.setItemTypeColor(sC, 'bug', '#ff0000');
  eq(RM.itemType(sC, 'bug').color, 'FF0000', 'setItemTypeColor stores an upper-case hex without #');
  RM.setItemTypeColor(sC, 'bug', 'not a color');
  eq(RM.itemType(sC, 'bug').color, 'FF0000', 'a bad color is ignored');
  var kNew = RM.addItemType(sC, 'Spike', 'zap', 'Spike');
  ok(/^[0-9A-F]{6}$/.test(RM.itemType(sC, kNew).color), 'a new type gets a palette color at once');
  // stored documents on the old default icons migrate; custom icons stay
  var sM = RM.normalizeState({ meta: { title: 'M', timelineStart: '2026-07-27', numWeeks: 8,
    itemTypes: [{ key: 'feature', label: 'Feature', icon: 'rows-3', jira: 'Story' }, { key: 'story', label: 'Story', icon: 'list-tree', jira: 'Sub-task' }, { key: 'bug', label: 'Bug', icon: 'flame', jira: 'Bug', color: '123456' }] },
    phases: [{ id: 'p', name: 'P' }], team: [], items: [] });
  eq(RM.itemType(sM, 'feature').icon, 'square', 'old feature default icon migrates to square');
  eq(RM.itemType(sM, 'story').icon, 'bookmark', 'old story default icon migrates to bookmark');
  eq(RM.itemType(sM, 'bug').icon, 'flame', 'a custom icon survives');
  eq(RM.itemType(sM, 'bug').color, '123456', 'a stored color survives');
  // color mode 'type'
  ok(RM.COLOR_MODES.indexOf('type') !== -1, "'type' is a color mode");
  var sT3 = RM.normalizeState({ meta: { title: 'T', timelineStart: '2026-07-27', numWeeks: 8 }, phases: [{ id: 'p', name: 'P' }], team: [],
    items: [{ id: 'x', num: 1, phaseId: 'p', feature: 'X', type: 'bug' }, { id: 'y', num: 2, phaseId: 'p', feature: 'Y' }] });
  RM.setColorMode('type');
  eq(RM.colorForItem(sT3, sT3.items[0]), RM.colorForType(sT3, 'bug'), 'type mode colors an item by its type');
  eq(RM.colorForItem(sT3, sT3.items[1]), RM.colorForType(sT3, 'feature'), 'an item without a type takes the level default type color');
  eq(RM.colorLegend(sT3, sT3.items).map(function (e) { return e.name; }), ['Bug', 'Feature'], 'type legend names the types in first-seen order');
  RM.setColorMode('workstream');
}
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | tail -30`
Expected: failures on the new names (`feature default icon is the filled square glyph`, `colorForType reads the record` throws → the suite may abort with `RM.colorForType is not a function`; that is the expected failure).

- [ ] **Step 3: Implement**

In `js/core.js` change the defaults (line 260):

```js
  RM.DEFAULT_ITEM_TYPES = [
    { key: 'epic', label: 'Epic', icon: 'layers', jira: 'Epic' },
    { key: 'feature', label: 'Feature', icon: 'square', jira: 'Story' },
    { key: 'bug', label: 'Bug', icon: 'bug', jira: 'Bug' },
    { key: 'task', label: 'Task', icon: 'check-square', jira: 'Task' },
    { key: 'story', label: 'Story', icon: 'bookmark', jira: 'Sub-task' },
    { key: 'subtask', label: 'Subtask', icon: 'corner-down-right', jira: 'Sub-task' }
  ];
  // icons the first release shipped as defaults; stored documents still on
  // them pick up the new default glyphs
  RM.LEGACY_TYPE_ICONS = { feature: 'rows-3', story: 'list-tree' };
```

In `normalizeTypes`, replace the mapping and the fallback so each record carries `color` and legacy icons migrate:

```js
    var types = (hadTypes ? m.itemTypes : RM.DEFAULT_ITEM_TYPES).map(function (t) {
      if (!t || typeof t !== 'object') return null;
      var key = String(t.key || '').trim();
      if (!key || seenKey[key]) return null;
      seenKey[key] = true;
      var icon = String(t.icon || 'tag');
      if (RM.LEGACY_TYPE_ICONS[key] === icon) icon = RM.DEFAULT_ITEM_TYPES.filter(function (d) { return d.key === key; })[0].icon;
      return { key: key, label: String(t.label || key), icon: icon, jira: String(t.jira || ''), color: resolveColor(t.color) || '' };
    }).filter(Boolean);
    if (!types.length) types = RM.DEFAULT_ITEM_TYPES.map(function (t) { return { key: t.key, label: t.label, icon: t.icon, jira: t.jira, color: '' }; });
    types.forEach(function (t, i) { if (!t.color) t.color = RM.HASH_PALETTE[i % RM.HASH_PALETTE.length]; });
```

`resolveColor` and `RM.HASH_PALETTE` are defined later in the file (lines 465 and 495) but only called at runtime, so this is fine.

In `addItemType`, push with a color:

```js
    var n = state.meta.itemTypes.length;
    state.meta.itemTypes.push({ key: key, label: String(label || 'New type'), icon: String(icon || 'tag'), jira: String(jira || ''), color: RM.HASH_PALETTE[n % RM.HASH_PALETTE.length] });
```

(rename the existing `n` counter in that function to `sfx` first: `var base = typeSlug(label), key = base, sfx = 2; while (RM.itemType(state, key)) key = base + '-' + (sfx++);`).

After `RM.setItemTypeIcon` add:

```js
  RM.setItemTypeColor = function (state, key, color) {
    var t = RM.itemType(state, key);
    var hex = resolveColor(color);
    if (t && hex) t.color = hex;
  };
  RM.colorForType = function (state, key) {
    var t = RM.itemType(state, key);
    return (t && resolveColor(t.color)) || RM.PALETTE.neutral;
  };
```

Color modes (line 490): `RM.COLOR_MODES = ['workstream', 'epic', 'assignee', 'priority', 'type'];`

In `RM.colorForItem`, before the `priority` line:

```js
    if (colorMode === 'type') return RM.colorForType(state, RM.typeOf(state, it, 'feature').key);
```

In `RM.colorLegend`, before the `else add(it.workstream …` branch:

```js
      } else if (colorMode === 'type') {
        var ty = RM.typeOf(state, it, 'feature');
        add(ty.label, RM.colorForType(state, ty.key));
```

- [ ] **Step 4: Run core tests**

Run: `NODE_PATH=./node_modules node tests/core.test.js 2>&1 | tail -3`
Expected: `0 failed`, passed count ≥ 579 + 21. Also run jira/ai suites: `NODE_PATH=./node_modules node tests/jira.test.js | tail -1; NODE_PATH=./node_modules node tests/ai.test.js | tail -1` — both `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add js/core.js tests/core.test.js
git commit -m "feat(core): type colors, square/bookmark default icons, color by type"
```

---

### Task 2: Type glyph replaces the workstream square; Color by item type in the UI

**Files:**
- Modify: `js/app.js:123` (`COLOR_MODES`), `js/app.js:1310-1318` (`typeChipHtml`/`typeIconHtml`), call sites `js/app.js:2027`, `2120`, `2678` (+ the `r-dot` at 2677), `2693`, `2706` (story-view heading `r-dot`), `3520` + `3524` (planning row), `3565` (planning story row); `js/app.js:4381-4384` (`EPIC_ICONS`); `js/app.js:8899-8903` (Hierarchy types table) and the `change` handler near `js/app.js:9149`
- Modify: `css/app.css:2094-2095` (`.r-type`), `css/app.css:1469`, `css/app.css:2456`, `css/app.css:2485`, `.pr-card` block near `css/app.css:2640`
- Test: `tests/smoke.test.js` (the `type pickers, row icons, epic type` block at ~3457, plus new assertions)

**Interfaces:**
- Consumes: `RM.colorForType`, `RM.setItemTypeColor`, `RM.colorMode()`, `RM.msStyleOf`, `RM.typeOf`.
- Produces: `typeGlyphHtml(obj, kind, owner)` — the only row/card glyph renderer; `typeIconHtml` is deleted. Markup: default feature → `<span class="r-dot" …>`; milestone → `<span class="r-dot msdot …">`; other → `<span class="r-type[ fill]" style="color:#hex"><i data-lucide="…"></i></span>`. Prioritizing cards wrap glyph + title in `<div class="pr-head">`.

- [ ] **Step 1: Update and add smoke tests**

In the `type pickers, row icons, epic type` block, replace the two `.r-type` assertions:

```js
    ok(!!doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-type'), 'a non-default type shows its icon on the row');
    ok(!doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-dot'), 'the type icon replaces the colored square');
    window.__headway.setItemType(first.id, 'feature');
    ok(!doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-type') &&
      !!doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-dot'), 'the default Feature type draws the filled square');
```

Then append a new block right after that `{ … }` block:

```js
// type glyphs everywhere + color by item type
{
  const firstRow = doc.querySelector('#rows .row.item[data-id]');
  const first = state().items.find(i => i.id === firstRow.dataset.id);
  window.__headway.setItemType(first.id, 'bug');
  const glyph = doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-type');
  ok(glyph && glyph.querySelector('[data-lucide="bug"]') && /color:\s*#/.test(glyph.getAttribute('style') || ''),
    'a Bug row draws the bug icon in a color');
  ok(/#/.test(glyph.getAttribute('style')) && glyph.getAttribute('style').toUpperCase().indexOf(window.RM.colorForItem(state(), first).toUpperCase()) !== -1,
    'the glyph wears the item color of the active color mode');
  // a story row draws the bookmark, filled
  window.HeadwayApp.ai.commit('story', (s) => { const it = window.RM.itemById(s, first.id); it.stories = it.stories || []; it.stories.unshift({ id: 'glyph-st', title: 'Glyph story' }); });
  window.HeadwayApp.ai.setView('planning');
  click(doc.querySelector('#rows .row.item[data-id="' + first.id + '"] [data-act="stories"]'));
  const stGlyph = doc.querySelector('#rows .row.story[data-story="glyph-st"] .r-type');
  ok(stGlyph && stGlyph.classList.contains('fill') && stGlyph.querySelector('[data-lucide="bookmark"]'), 'a story row draws the filled bookmark glyph');
  // prioritizing cards carry the glyph in a head row beside the title
  click(doc.querySelector('#viewTabs [data-view="prio"]'));
  const card = doc.querySelector('#prioView .pr-card[data-prcard="' + first.id + '"]');
  ok(card && card.querySelector('.pr-head .r-type [data-lucide="bug"]') && card.querySelector('.pr-head .pr-title'),
    'a prioritizing card shows the type glyph beside its title');
  // sprinting rows and story-view headings
  click(doc.querySelector('#viewTabs [data-view="sprints"]'));
  ok(!!doc.querySelector('#sprintView .spv-row[data-spid="' + first.id + '"] .r-type [data-lucide="bug"]'), 'a sprinting row shows the type glyph');
  ok(!doc.querySelector('#sprintView .spv-row .r-dot:not(.msdot) + .r-type'), 'sprinting rows no longer stack a square before the glyph');
  window.__headway.setItemType(first.id, 'feature');
  ok(!!doc.querySelector('#sprintView .spv-row[data-spid="' + first.id + '"] .r-dot'), 'a Feature sprinting row draws the square');
  // View menu offers Color by item type; picking it recolors the glyph by type
  click(doc.querySelector('#viewTabs [data-view="planning"]'));
  click(doc.querySelector('#btnView'));
  const cbt = [...doc.querySelectorAll('#popover .menu-list button')].find(b => /Color by item type/.test(b.textContent));
  ok(!!cbt, 'View menu offers Color by item type');
  click(cbt);
  ok(window.RM.colorMode() === 'type', 'picking it switches the color mode');
  const sq = doc.querySelector('#rows .row.item[data-id="' + first.id + '"] .r-dot');
  ok(sq && sq.getAttribute('style').toUpperCase().indexOf(window.RM.colorForType(state(), 'feature')) !== -1, 'the square takes the Feature type color');
  ok([...doc.querySelectorAll('#legend .lg, #legend [data-lg], #legend span')].some(el => /Feature/.test(el.textContent)) || /Feature/.test((doc.querySelector('#legend') || {}).textContent || ''),
    'the legend lists type labels');
  // prefs segment carries the mode too
  click(doc.querySelector('#btnSettings') || doc.querySelector('[data-open-settings]'));
  ok(!!doc.querySelector('#modalHost [data-pref-color="type"]'), 'Settings offers Color bars by item type');
  click(doc.querySelector('#modalHost [data-pref-color="workstream"]'));
  ok(window.RM.colorMode() === 'workstream', 'the prefs segment switches back');
  const closeBtn = doc.querySelector('#modalHost [data-m="x"]');
  if (closeBtn) click(closeBtn);
  // Hierarchy card: a color input per type commits the type color
  window.HeadwayApp.ai.setView('setup');
  const suTab = doc.querySelector('#setupView [data-sutab="workstreams"]');
  if (suTab) click(suTab);
  const cin = doc.querySelector('#setupView input[type="color"][data-suhtcolor="bug"]');
  ok(!!cin, 'Hierarchy types table has a color input per type');
  cin.value = '#112233';
  cin.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(state().meta.itemTypes.find(t => t.key === 'bug').color === '112233', 'changing the color input sets the type color');
  window.HeadwayApp.ai.setView('planning');
}
```

Before running, check the real ids used above: `grep -n 'id="btnView"\|id="legend"\|data-sutab=\|id="btnSettings"' index.html js/app.js | head` and adjust the selectors to the actual View-menu button, legend host, settings opener and setup tab attribute (the smoke suite already opens the View menu somewhere — `grep -n "Color by" tests/smoke.test.js` and copy that opener).

- [ ] **Step 2: Run smoke to see the new assertions fail**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗' | head`
Expected: the new glyph/color assertions fail (e.g. `the type icon replaces the colored square`, `View menu offers Color by item type`).

- [ ] **Step 3: Implement the glyph renderer**

Replace `typeIconHtml` (app.js ~1314) with:

```js
  // Lucide icons drawn filled rather than stroked when used as a type glyph
  var TYPE_FILL_ICONS = { bookmark: 1 };
  // the glyph left of a title: the item's type icon in the active color-mode
  // color. The Feature default (`square`) is the filled rounded square the
  // rows always had; milestones keep their diamond/star/circle mask.
  // `owner` is the feature a story belongs to (stories borrow its color
  // except in the type color mode).
  function typeGlyphHtml(obj, kind, owner) {
    var it = owner || obj;
    var t = RM.typeOf(state, obj, kind);
    var color = '#' + (kind === 'story' && RM.colorMode() === 'type' ? RM.colorForType(state, t.key) : RM.colorForItem(state, it));
    var title = ' title="' + esc(t.label) + '"';
    if (kind !== 'story' && it.milestone) return '<span class="r-dot msdot ' + RM.msStyleOf(it) + '" style="background:' + color + '"' + title + '></span>';
    if (t.icon === 'square') return '<span class="r-dot" style="background:' + color + '"' + title + '></span>';
    return '<span class="r-type' + (TYPE_FILL_ICONS[t.icon] ? ' fill' : '') + '" style="color:' + color + '"' + title + '><i data-lucide="' + esc(t.icon) + '"></i></span>';
  }
```

Call sites:
- `2027` (prio feature card): replace `typeIconHtml(it, 'feature') + '<input class="pr-title" … value="' + esc(it.feature) + '">'` with `'<div class="pr-head">' + typeGlyphHtml(it, 'feature') + '<input class="pr-title" data-prf="feature" placeholder="Name" value="' + esc(it.feature) + '"></div>'`.
- `2120` (prio story card): `typeIconHtml(st, 'story') + '<input class="pr-title pr-st-title" …>'` → `'<div class="pr-head">' + typeGlyphHtml(st, 'story', it) + '<input class="pr-title pr-st-title" data-prstf="title" placeholder="Story" value="' + esc(st.title || '') + '"></div>'`.
- `2677-2678` (sprint feature row): delete the `r-dot` span line and change `typeIconHtml(it, 'feature')` → `typeGlyphHtml(it, 'feature')`. The `var color` at the top of `sprRowHtml` becomes unused; delete it.
- `2693` (sprint story row): `typeGlyphHtml(st, 'story', it)`.
- `2706` (story-view heading): replace the `r-dot` span with `typeGlyphHtml(f.it, 'feature')`.
- `3520` + `3524` (planning row): delete the `r-dot` span line at 3520; at 3524 `typeGlyphHtml(it, 'feature')`. Keep `var color` if it is still used by the bar further down (grep `color` inside that function); otherwise delete it.
- `3565` (planning story row): `typeGlyphHtml(st, 'story', it)`.

`EPIC_ICONS` (4381): append `'square', 'bookmark'` to the list so the type icon picker offers them.

Color modes (123): `var COLOR_MODES = [['workstream', 'Workstream'], ['epic', 'Epic'], ['assignee', 'Assignee'], ['priority', 'Priority'], ['type', 'Item type']];` and update the comment on line 124. The View menu (7623), prefs segment (10067) and the AI pref (10621) all iterate `COLOR_MODES` / `RM.COLOR_MODES`, so nothing else changes.

Hierarchy types table (8900): add a color cell after the icon cell:

```js
      return '<tr><td><button class="su-hicon" data-suhticon="' + esc(t.key) + '" title="Icon"><i data-lucide="' + esc(t.icon) + '"></i></button>' +
        '<input type="color" class="su-hcolor" data-suhtcolor="' + esc(t.key) + '" value="#' + esc(t.color) + '" title="Color (Color by item type)"></td>' +
```

and in the setup `change` handler next to the `suhtlabel` line (~9149):

```js
    if (t.dataset.suhtcolor) { var tk4 = t.dataset.suhtcolor, cv = t.value; commit('type color', function (s2) { RM.setItemTypeColor(s2, tk4, cv); }); return; }
```

CSS (`css/app.css`):

```css
.r-type { display: inline-flex; align-items: center; justify-content: center; width: 13px; margin-right: 7px; color: var(--ink-2); flex: 0 0 13px; }
.r-type i, .r-type svg { width: 13px; height: 13px; }
.r-type.fill svg { fill: currentColor; }
.su-hcolor { width: 22px; height: 22px; padding: 0; border: 1px solid var(--line-2); border-radius: 6px; margin-left: 4px; vertical-align: middle; background: none; }
.pr-head { display: flex; align-items: center; gap: 2px; }
.pr-head .pr-title { flex: 1; min-width: 0; width: auto; margin: 0 -5px 0 0; }
```

Replace the existing `.r-type` rules at 2094-2095 with the first three lines. Extend `css/app.css:1469` to `body[data-view="scoping"] .row.item .row-left .r-dot, body[data-view="scoping"] .row.item .row-left .r-type { margin-top: 9px; }`, `css/app.css:2456` to `.spv-row .r-dot, .spv-row .r-type { margin-right: 0; }`, and `2485` to `.spv-feat .r-dot, .spv-feat .r-type { margin-right: 0; }`.

- [ ] **Step 4: Run smoke**

Run: `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep -c '✓'; NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗'`
Expected: no `✗`. If an older test asserted a `.r-dot` on planning rows for a non-default type, update it to the new markup (state which one in the commit).

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css tests/smoke.test.js
git commit -m "feat: type glyph replaces the workstream square; Color by item type"
```

---

### Task 3: Prioritizing hides milestones; Jira table icons at 14px

**Files:**
- Modify: `js/app.js:1984-1989` (`prMatches`)
- Modify: `css/app.css` (after the `.hol-table td` rule at line 2229)
- Test: `tests/smoke.test.js`

- [ ] **Step 1: Write the failing tests** (append a block after the Task 2 block):

```js
// milestones stay off the prioritizing board; Jira issue-type icons are 14px
{
  const feat = state().items.find(i => !i.milestone && i.stories && i.stories.length === 0) || state().items.find(i => !i.milestone);
  window.HeadwayApp.ai.commit('milestone', (s) => { const it = window.RM.itemById(s, feat.id); it.milestone = true; it.durDays = it.startDay == null ? null : 1; });
  click(doc.querySelector('#viewTabs [data-view="prio"]'));
  ok(!doc.querySelector('#prioView [data-prcard="' + feat.id + '"]'), 'a milestone has no card on the prioritizing board');
  window.HeadwayApp.ai.commit('milestone', (s) => { window.RM.itemById(s, feat.id).milestone = false; });
  ok(!!doc.querySelector('#prioView [data-prcard="' + feat.id + '"]'), 'clearing the flag brings the card back');
  const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
  ok(/\.jr-types td svg\.lucide\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/.test(css), 'Jira issue-type table icons are sized like every other icon');
}
```

- [ ] **Step 2: Run** `NODE_PATH=./node_modules node tests/smoke.test.js 2>&1 | grep '✗'` — expected: `a milestone has no card…` and the CSS assertion fail.

- [ ] **Step 3: Implement**

`prMatches`:

```js
  function prMatches(it) {
    if (it.milestone) return false; // milestones are dates, not work to rank
    if (!matchesFilter(it)) return false;
```

`css/app.css` after line 2229:

```css
.jr-types td svg.lucide { width: 14px; height: 14px; vertical-align: -3px; margin-right: 4px; color: var(--ink-2); }
```

- [ ] **Step 4: Run smoke** — expected no `✗`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css tests/smoke.test.js
git commit -m "feat: prioritizing hides milestones; Jira type icons at 14px"
```

---

### Task 4: Sprinting membership, carry-over glyph, sprint-number tag, trimmed sections

**Files:**
- Modify: `js/app.js:1665-1670` (`itemsInSprint`), `2605-2611` (`sprStoriesOf`), `2621-2651` (`sprSections`), `2652-2661` (`sprTag` → replaced), `2671-2698` (row html)
- Modify: `css/app.css` after `.spv-tag` (2464)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Produces: `sprFirstNum(x)`, `sprLastNum(x)` (sprint numbers for a scheduled item or story), `sprNumTag(num)`, `sprCarryHtml(x)`. Sections from `sprSections()` are trimmed of empty leading/trailing sprints (current sprint always kept).

- [ ] **Step 1: Write the failing tests** (append):

```js
// sprinting: one sprint per row, carry-over glyph, sprint-number tag, trimmed ends
{
  click(doc.querySelector('#viewTabs [data-view="sprints"]'));
  const meta = state().meta;
  const nums = [...doc.querySelectorAll('#sprintView .spv-sec')].map(s => s.dataset.spsec).filter(k => k !== 'u').map(Number);
  const startNum = nums[0];
  const it = state().items.find(i => !i.milestone);
  const perSprint = window.RM.sprintDays(meta);
  window.HeadwayApp.ai.commit('span', (s) => {
    const t = window.RM.itemById(s, it.id);
    t.startDay = window.RM.sprintStartDay(s.meta, startNum); t.durDays = perSprint * 3; t.riskDays = 0; t.locked = false;
  });
  const rows = doc.querySelectorAll('#sprintView .spv-row[data-spid="' + it.id + '"]');
  ok(rows.length === 1 && rows[0].dataset.spsec === String(startNum), 'a three-sprint item lists once, under the sprint it starts in');
  const info = rows[0].querySelector('.spv-info');
  ok(info && info.getAttribute('title') === 'Expecting to carryover for 2 sprints (through sprint ' + (startNum + 2) + ')',
    'the carry-over glyph says how many sprints it runs on and the last one');
  ok(!rows[0].querySelector('.spv-tag:not(.spv-snum)') && rows[0].querySelector('.spv-snum').textContent === 'S' + startNum,
    'the from/to tags are gone; the slot shows the sprint number');
  ok(!rows[0].querySelector('.spv-dates') && !rows[0].querySelector('.spv-phase'), 'rows carry no date range or phase column');
  window.HeadwayApp.ai.commit('span', (s) => { const t = window.RM.itemById(s, it.id); t.durDays = perSprint; });
  ok(!doc.querySelector('#sprintView .spv-row[data-spid="' + it.id + '"] .spv-info'), 'an item inside one sprint has no carry-over glyph');
  // empty sprints at either end are hidden (the current sprint always stays)
  const secs = [...doc.querySelectorAll('#sprintView .spv-sec')].filter(s => s.dataset.spsec !== 'u');
  const sideKeys = [...doc.querySelectorAll('#sprintView .spv-sbtn')].map(b => b.dataset.spside);
  const nonEmpty = s => s.querySelectorAll('.spv-row').length > 0 || doc.querySelector('.spv-sbtn.today[data-spside="' + s.dataset.spsec + '"]');
  ok(nonEmpty(secs[0]) && nonEmpty(secs[secs.length - 1]), 'the first and last sprint sections shown have rows (or are today)');
  ok(sideKeys.length === secs.length + 1 && sideKeys[sideKeys.length - 1] === 'u', 'the sidebar mirrors the trimmed sections plus Unscheduled');
  // push one item far out: the tail extends only to that sprint
  const lastShown = Number(secs[secs.length - 1].dataset.spsec);
  const allNums = [];
  for (let w = 0; w < meta.numWeeks; w++) { const n = window.RM.sprintNumForWeek(meta, w); if (allNums.indexOf(n) === -1) allNums.push(n); }
  const far = allNums[allNums.length - 1];
  if (far > lastShown) {
    window.HeadwayApp.ai.commit('span', (s) => { const t = window.RM.itemById(s, it.id); t.startDay = window.RM.sprintStartDay(s.meta, far); t.durDays = perSprint; });
    const secs2 = [...doc.querySelectorAll('#sprintView .spv-sec')].filter(s => s.dataset.spsec !== 'u');
    ok(secs2[secs2.length - 1].dataset.spsec === String(far), 'scheduling into the last sprint reveals it');
    window.HeadwayApp.ai.commit('span', (s) => { const t = window.RM.itemById(s, it.id); t.startDay = window.RM.sprintStartDay(s.meta, startNum); });
  } else ok(true, 'timeline already ends at the last shown sprint');
}
```

- [ ] **Step 2: Run** — expected failures on `a three-sprint item lists once…`, the glyph, tag and column assertions.

- [ ] **Step 3: Implement**

Add after `sprHasOwn` (2602):

```js
  // the sprint an item or story starts in / ends in (numbers, timeline-clamped)
  function sprFirstNum(x) {
    var meta = state.meta;
    return RM.sprintNumForWeek(meta, Math.max(0, Math.min(meta.numWeeks - 1, Math.floor(x.startDay / SPW()))));
  }
  function sprLastNum(x) {
    var meta = state.meta, end = RM.itemEnd(x);
    if (end == null) return sprFirstNum(x);
    return RM.sprintNumForWeek(meta, Math.max(0, Math.min(meta.numWeeks - 1, Math.ceil(end / SPW()) - 1)));
  }
```

`itemsInSprint` (1665): membership is the first sprint only:

```js
  function itemsInSprint(num) {
    return state.items.filter(function (it) {
      return it.startDay != null && sprFirstNum(it) === num && matchesFilter(it);
    });
  }
```

`storiesInSprint` (1673) — same rule for stories with their own timeline: replace `RM.itemInWeeks(meta, st, r.w0, r.w1)` with `sprFirstNum(st) === num` (drop the now-unused `meta`/`r` vars). `sprStoriesOf` (2605): `if (sprHasOwn(st)) return num != null && sprFirstNum(st) === num;`.

Replace `sprTag` and `sprDates` with:

```js
  // the sprint-number tag every row in a sprint section wears
  function sprNumTag(num) {
    if (num == null) return '';
    return '<span class="spv-tag spv-snum" title="' + esc(sprintLabel(num)) + '">' + (RM.sprintsEnabled(state.meta) ? 'S' : 'W') + num + '</span>';
  }
  // rows whose span runs past their sprint get an info glyph saying how far
  function sprCarryHtml(x) {
    if (!isScheduled(x)) return '';
    var s0 = sprFirstNum(x), s1 = sprLastNum(x);
    if (s1 <= s0) return '';
    var n = s1 - s0, unit = RM.sprintsEnabled(state.meta) ? 'sprint' : 'week';
    return '<span class="spv-info" title="Expecting to carryover for ' + n + ' ' + unit + (n === 1 ? '' : 's') + ' (through ' + unit + ' ' + s1 + ')"><i data-lucide="info"></i></span>';
  }
```

`sprRowHtml`: after the title input emit `sprCarryHtml(it) + sprNumTag(num)`; delete the `spv-dates` and `spv-phase` spans. `sprStoryRowHtml`: after the title emit `(own ? sprCarryHtml(st) : '') + sprNumTag(num)`; delete the `spv-dates` span. Story-view heading (`sprSectionHtml`): delete the `spv-phase` span. `sprPhaseName` stays (used by tooltips elsewhere? if now unused, delete it).

`sprSections`: after `nums.map(...)` builds `secs`, trim:

```js
    var cur = RM.sprintsEnabled(meta) ? currentSprintNum() : null;
    var keep = function (s) { return s.num == null || s.num === cur || s.items.length || s.feats.length; };
    var first = -1, last = -1;
    secs.forEach(function (s, i) { if (s.num != null && keep(s)) { if (first === -1) first = i; last = i; } });
    var un = secs[secs.length - 1];
    return (first === -1 ? [] : secs.slice(first, last + 1)).concat([un]);
```

(where `secs` is the array the existing `return nums.map(...)` produced — assign it to `var secs` first).

CSS after `.spv-tag` block:

```css
.spv-snum { border-style: solid; color: var(--ink-2); }
.spv-info { display: inline-flex; flex: none; color: var(--ink-3); cursor: help; }
.spv-info svg { width: 13px; height: 13px; }
```

Delete the `.spv-dates` and `.spv-phase` rules (2476, 2479).

- [ ] **Step 4: Run smoke**

Expected: no `✗`. The existing block at 2097-2200 may need small updates: `sidebar lists Unscheduled plus every sprint` (keep the name, assertion `side.length > 2` still holds if the fixture schedules across ≥2 sprints; if not, loosen to `side.length >= 2`); `spv-sbtn[2]` drag target — if fewer than 3 buttons remain, use `[1]`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css tests/smoke.test.js
git commit -m "feat(sprinting): one sprint per row, carry-over glyph, sprint tag, trimmed empty ends"
```

---

### Task 5: Sprinting row chips — assignees, workstream, heading chips

**Files:**
- Modify: `js/app.js:1939-1950` (`itemChipAction`), `1884-1892` (`storyChipAction`), `5184-5198` (story assignee dropdown → shared function), `sprRowHtml` / `sprStoryRowHtml` / `sprSectionHtml` heading, click handler at ~2887
- Test: `tests/smoke.test.js`

**Interfaces:**
- Produces: `storyAssignMenuItems(itemId, stId)`; chips `data-spact="asg"`, `"st-asg"`, `"ws"`; heading `spv-feat` carries `data-spid` and an `.spv-est` chip group.

- [ ] **Step 1: Write the failing tests** (append):

```js
// sprinting chips: assignees replace duration, workstream chip, heading chips
{
  click(doc.querySelector('#viewTabs [data-view="sprints"]'));
  const row = doc.querySelector('#sprintView .spv-sec:not([data-spsec="u"]) .spv-row');
  const id = row.dataset.spid;
  ok(!!row.querySelector('[data-spact="asg"]') && !row.querySelector('[data-spact="dur"]'), 'feature rows show an assignee chip instead of duration');
  ok(!!row.querySelector('[data-spact="ws"]'), 'feature rows carry a workstream chip');
  click(row.querySelector('[data-spact="asg"]'));
  const member = state().team[0];
  const mBtn = [...doc.querySelectorAll('#popover .menu-list button')].find(b => b.textContent.indexOf(window.RM.memberLabel(member)) !== -1);
  ok(!!mBtn, 'the assignee chip opens the roster');
  click(mBtn);
  ok((state().items.find(i => i.id === id).assignees || []).indexOf(member.id) !== -1, 'picking a person assigns them');
  ok(!!doc.querySelector('#sprintView .spv-row[data-spid="' + id + '"] [data-spact="asg"] .avatar'), 'the chip shows their avatar');
  const wsChip = doc.querySelector('#sprintView .spv-row[data-spid="' + id + '"] [data-spact="ws"]');
  click(wsChip);
  const wsBtn = [...doc.querySelectorAll('#popover .menu-list button')].filter(b => !/default|Other/.test(b.textContent))[0];
  const wsName = wsBtn.textContent.trim();
  click(wsBtn);
  ok(state().items.find(i => i.id === id).workstream === wsName, 'the workstream chip sets the workstream');
  // story level: heading chips and story assignee chip
  click(doc.querySelector('#sprintView [data-spdd="level"]'));
  click([...doc.querySelectorAll('#popover .menu-list button')].find(b => /Story/.test(b.textContent)));
  const head = doc.querySelector('#sprintView .spv-feat');
  ok(head && head.querySelector('.spv-est [data-spact="priority"]') && head.querySelector('.spv-est [data-spact="size"]') && head.querySelector('.spv-est [data-spact="dur"]'),
    'story-view feature headings show priority, size and duration chips');
  ok(!head.querySelector('.spv-phase'), 'headings drop the phase column');
  const stRow = doc.querySelector('#sprintView .spv-row.spv-st');
  ok(stRow && stRow.querySelector('[data-spact="st-asg"]') && !stRow.querySelector('[data-spact="st-wk"]'), 'story rows show a story assignee chip instead of duration');
  click(stRow.querySelector('[data-spact="st-asg"]'));
  const mBtn2 = [...doc.querySelectorAll('#popover .menu-list button')].find(b => b.textContent.indexOf(window.RM.memberLabel(member)) !== -1);
  click(mBtn2);
  const stIt = state().items.find(i => i.id === stRow.dataset.spid);
  ok((stIt.stories.find(s => s.id === stRow.dataset.spst).assignees || []).indexOf(member.id) !== -1, 'picking a person assigns them to the story');
  click(doc.querySelector('#sprintView [data-spdd="level"]'));
  click([...doc.querySelectorAll('#popover .menu-list button')].find(b => /Feature/.test(b.textContent)));
}
```

- [ ] **Step 2: Run** — expected failures on the chip assertions.

- [ ] **Step 3: Implement**

Extract the story assignee menu (5184-5198) into a function placed right after `assignMenuItems` (5446):

```js
  function storyAssignMenuItems(itemId, stId) {
    var it = RM.itemById(state, itemId);
    return state.team.map(function (mm) {
      var onSA = ((storyById(it, stId) || {}).assignees || []).indexOf(mm.id) !== -1;
      return { label: esc(mLabel(mm)) + (mSub(mm) ? ' <small>' + esc(mSub(mm)) + '</small>' : ''), checked: onSA, fn: function () {
        commit('story assignees', function (s) {
          var st2 = storyById(RM.itemById(s, itemId) || {}, stId);
          if (!st2) return;
          st2.assignees = st2.assignees || [];
          var atA = st2.assignees.indexOf(mm.id);
          if (atA === -1) st2.assignees.push(mm.id);
          else st2.assignees.splice(atA, 1);
        });
      } };
    });
  }
```

and make the 5184 branch `openDropdown(act, storyAssignMenuItems(itemId, stId));` (keep its team-empty toast).

`itemChipAction`: add before `else return false;`:

```js
    else if (act === 'asg') {
      if (!state.team.length) { toast('Add people in the Resources panel first'); return true; }
      openDropdown(anchor, assignMenuItems(itemId));
    }
```

`storyChipAction`: add before `else return false;`:

```js
    else if (act === 'st-asg') {
      if (!state.team.length) { toast('Add people in the Resources panel first'); return true; }
      openDropdown(anchor, storyAssignMenuItems(itemId, stId));
    }
```

Chip renderers next to `sprNumTag`:

```js
  function sprAsgChip(obj, act) {
    return '<span class="r-asg" tabindex="0" role="button" data-spact="' + act + '" title="Assignees">' +
      (avatarStack(obj.assignees, 2) || '<i data-lucide="user-plus"></i>') + '</span>';
  }
  function sprWsChip(it) {
    if (!state.meta.workstreamsEnabled) return '';
    return '<span class="spv-chip" tabindex="0" role="button" data-spact="ws" title="Workstream">' +
      '<span class="dd-dot" style="background:#' + RM.colorForWs(state, it.workstream) + '"></span>' + esc(it.workstream || RM.defaultWsName(state)) + '</span>';
  }
```

`sprRowHtml`: after the epic chip emit `sprWsChip(it)`; the est group becomes `['size', 'pri', 'risk'].map(...).join('') + sprAsgChip(it, 'asg')`. `sprStoryRowHtml`: est group `['size', 'pri', 'risk'].map(...).join('') + sprAsgChip(st, 'st-asg')`. Story-view heading in `sprSectionHtml`:

```js
        return '<div class="spv-feat" data-spfeat="' + f.it.id + '" data-spid="' + f.it.id + '">' +
          '<span class="r-num">#' + f.it.num + '</span>' +
          typeGlyphHtml(f.it, 'feature') +
          '<span class="spv-featname">' + esc(f.it.feature || '(untitled)') + '</span>' +
          '<span class="spv-est">' + ['pri', 'size', 'dur'].map(function (k) { return itemChipHtml(k, f.it, 'data-spact'); }).join('') + '</span></div>' +
```

Click handler (~2887): the `chip && row` branch already dispatches by `row.dataset.spst`; add the workstream chip before the `else itemChipAction` line:

```js
      else if (chip.dataset.spact === 'ws') openDropdown(chip, wsMenuItems(cid, function () { return chip; }));
```

Check `sprDragMove`'s pointerdown guard (`closest('input,textarea,button,select,[data-spact]')`) still skips chips — it does.

- [ ] **Step 4: Run smoke** — expected no `✗`. The older assertion `rows carry an inline title, epic and size chips` still holds.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/smoke.test.js
git commit -m "feat(sprinting): assignee and workstream chips, heading chips, no date/phase columns"
```

---

### Task 6: Sprinting context menu — Move to sprint (features and stories), Assign

**Files:**
- Modify: `js/app.js:2904-2925` (contextmenu handler); new `moveSprintMenu`, `moveStorySprintMenu` next to `movePhaseMenu` (5814)
- Test: `tests/smoke.test.js`

- [ ] **Step 1: Write the failing tests** (append):

```js
// sprinting context menu: Move to sprint for features and stories, Assign
{
  click(doc.querySelector('#viewTabs [data-view="sprints"]'));
  const menu = () => [...doc.querySelectorAll('#popover .menu-list button, #ctxMenu .menu-list button, .menu-list button')];
  const row = doc.querySelector('#sprintView .spv-sec:not([data-spsec="u"]) .spv-row');
  const id = row.dataset.spid;
  const secNums = [...doc.querySelectorAll('#sprintView .spv-sec')].map(s => s.dataset.spsec).filter(k => k !== 'u').map(Number);
  row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
  const mv = menu().find(b => /Move to sprint/.test(b.textContent));
  ok(!!mv && menu().some(b => /Assign/.test(b.textContent)), 'the row menu offers Move to sprint and Assign');
  click(mv);
  const target = secNums.find(n => n !== Number(row.dataset.spsec)) || secNums[0] + 1;
  const tBtn = menu().find(b => new RegExp('^Sprint ' + target + '\\b').test(b.textContent.trim()));
  ok(!!tBtn && menu().some(b => /Unscheduled/.test(b.textContent)), 'the submenu lists the sprints and Unscheduled');
  click(tBtn);
  const moved = state().items.find(i => i.id === id);
  ok(moved.startDay === window.RM.sprintStartDay(state().meta, target), 'picking a sprint moves the item there');
  ok(doc.querySelector('#sprintView .spv-row[data-spid="' + id + '"]').dataset.spsec === String(target), 'and it lists under that sprint');
  // story rows: Move to sprint gives the story its own timeline
  click(doc.querySelector('#sprintView [data-spdd="level"]'));
  click(menu().find(b => /Story/.test(b.textContent)));
  const stRow = doc.querySelector('#sprintView .spv-row.spv-st');
  stRow.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }));
  const mv2 = menu().find(b => /Move to sprint/.test(b.textContent));
  ok(!!mv2, 'story rows have a context menu with Move to sprint');
  click(mv2);
  const t2 = secNums[0];
  click(menu().find(b => new RegExp('^Sprint ' + t2 + '\\b').test(b.textContent.trim())));
  const st = state().items.find(i => i.id === stRow.dataset.spid).stories.find(s => s.id === stRow.dataset.spst);
  ok(st.startDay === window.RM.sprintStartDay(state().meta, t2) && st.durDays != null, 'the story gets its own timeline in that sprint');
  const stRow2 = doc.querySelector('#sprintView .spv-row[data-spst="' + st.id + '"]');
  stRow2.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }));
  click(menu().find(b => /With feature/.test(b.textContent)));
  const st2 = state().items.find(i => i.id === stRow.dataset.spid).stories.find(s => s.id === st.id);
  ok(st2.startDay == null, 'With feature drops the story timeline again');
  click(doc.querySelector('#sprintView [data-spdd="level"]'));
  click(menu().find(b => /Feature/.test(b.textContent)));
}
```

Check where `openContextMenu` renders (`grep -n "function openContextMenu" -A12 js/app.js`) and narrow the `menu()` selector to that host.

- [ ] **Step 2: Run** — expected failures on `the row menu offers Move to sprint…` and the story menu.

- [ ] **Step 3: Implement**

After `movePhaseMenu` add:

```js
  // Sprinting context menu: every sprint of the timeline, then Unscheduled
  function moveSprintMenu(itemId) {
    var it = RM.itemById(state, itemId);
    var cur = it && isScheduled(it) ? sprFirstNum(it) : null;
    return sprintNums().map(function (n) {
      return { label: esc(sprintLabel(n)), checked: cur === n, fn: function () {
        commit('move to sprint', function (s) { RM.moveItemToSprint(s, itemId, n, null); });
      } };
    }).concat([{ sep: true }, { icon: 'inbox', label: 'Unscheduled', checked: cur == null, fn: function () {
      commit('unschedule', function (s) { RM.moveItemToSprint(s, itemId, null, null); });
    } }]);
  }
  // story variant: a sprint gives the story its own timeline; "With feature" drops it
  function moveStorySprintMenu(itemId, stId) {
    var st = storyById(RM.itemById(state, itemId) || {}, stId);
    var cur = st && sprHasOwn(st) ? sprFirstNum(st) : null;
    return sprintNums().map(function (n) {
      return { label: esc(sprintLabel(n)), checked: cur === n, fn: function () {
        commit('move story to sprint', function (s) { RM.moveStoryToSprint(s, itemId, stId, n, stId); });
      } };
    }).concat([{ sep: true }, { icon: 'corner-down-right', label: 'With feature', checked: cur == null, fn: function () {
      commit('story with feature', function (s) { RM.moveStoryToSprint(s, itemId, stId, null, stId); });
    } }]);
  }
```

(`RM.moveStoryToSprint(state, itemId, stId, num, beforeStId)` — passing `beforeStId = stId` leaves the story order alone.)

Replace the contextmenu handler:

```js
  $('#sprintView').addEventListener('contextmenu', function (e) {
    var row = e.target.closest('[data-spid]');
    if (!row || e.target.closest('input,textarea,select')) return;
    e.preventDefault();
    e.stopPropagation();
    var cid = row.dataset.spid;
    var itX = RM.itemById(state, cid);
    if (!itX) return;
    var cx = e.clientX, cy = e.clientY;
    if (row.dataset.spst) {
      var sid = row.dataset.spst;
      openContextMenu(cx, cy, [
        { icon: 'calendar-range', label: 'Move to sprint…', fn: function () { openContextMenu(cx, cy, moveStorySprintMenu(cid, sid)); } },
        state.team.length ? { icon: 'users', label: 'Assign…', fn: function () { openContextMenu(cx, cy, storyAssignMenuItems(cid, sid)); } } : null
      ].filter(Boolean));
      return;
    }
    openContextMenu(cx, cy, [
      { icon: 'calendar-range', label: 'Move to sprint…', fn: function () { openContextMenu(cx, cy, moveSprintMenu(cid)); } },
      { icon: 'folder-input', label: 'Move to phase…', fn: function () { openContextMenu(cx, cy, movePhaseMenu(cid)); } },
      { icon: 'tag', label: 'Set epic…', fn: function () { openContextMenu(cx, cy, setEpicMenu(cid, false)); } },
      state.meta.workstreamsEnabled
        ? { icon: 'layers', label: 'Set workstream…', fn: function () { openContextMenu(cx, cy, wsMenuItems(cid, function () { return null; })); } }
        : null,
      state.team.length ? { icon: 'users', label: 'Assign…', fn: function () { openContextMenu(cx, cy, assignMenuItems(cid)); } } : null,
      isScheduled(itX) ? { icon: 'calendar-off', label: 'Unschedule', fn: function () {
        commit('unschedule', function (s) { RM.moveItemToSprint(s, cid, null, null); });
      } } : null,
      { sep: true },
      { icon: 'trash-2', label: 'Delete…', danger: true, fn: function () { deleteItemConfirm(cid); } }
    ].filter(Boolean));
  });
```

Note the story-view heading now carries `data-spid` (Task 5) and no `data-spst`, so right-clicking a heading opens the feature menu — intended.

- [ ] **Step 4: Run smoke** — expected no `✗`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/smoke.test.js
git commit -m "feat(sprinting): Move to sprint and Assign in the row context menu, story row menu"
```

---

### Task 7: AI drawer loads models on open and effort levels on model change

**Files:**
- Modify: `js/ai.js:36-37` (state vars), after `AI.effortAllowed` (~57), after `AI.refreshModelInfo` (~1035), `1411-1414` (Setup Load), `1623-1631` (model change), `1685-1696` (`AI.open`)
- Test: `tests/ai.test.js` (the `model labels + effort levels` block inside `done()`, plus a new async block)

**Interfaces:**
- Produces: `AI.modelCache` (array|null), `AI.modelCacheBase` (string), `AI.ensureModels(s)` → Promise<ids|null>, `AI.pickEffort(s)` → effort key, `AI.ensureModelInfo(s)` → Promise.

- [ ] **Step 1: Write the failing tests**

In the `model labels + effort levels` block (after the `effortAllowed` lines, before `AI.modelInfo = null;`):

```js
    eq(AI.pickEffort({ provider: 'litellm', model: 'bedrock/x', effort: 'high' }), 'high', 'pickEffort keeps a level the model offers');
    eq(AI.pickEffort({ provider: 'litellm', model: 'bedrock/x', effort: 'max' }), 'medium', 'pickEffort falls back to medium when the pick is not offered');
    eq(AI.pickEffort({ provider: 'litellm', model: 'plain', effort: 'max' }), 'max', 'a model without effort keeps the stored value (selector hidden)');
    AI.GATEWAY_EFFORTS_SAVE = AI.GATEWAY_EFFORTS; AI.GATEWAY_EFFORTS = [['low', 'Low']];
    eq(AI.pickEffort({ provider: 'litellm', model: 'bedrock/x', effort: 'max' }), 'low', 'without medium the first offered level wins');
    AI.GATEWAY_EFFORTS = AI.GATEWAY_EFFORTS_SAVE; delete AI.GATEWAY_EFFORTS_SAVE;
```

Then, still inside `done()` before `console.log('— desktop transport')`, add a new async block and move the final summary/exit into its completion (the file currently prints the summary synchronously at the end of `done()`; wrap the `desktop transport` block and the summary in a function `finish()` called from the promise chain):

```js
  console.log('— model list on open');
  var calls = [];
  AI.fetchImpl = function (url) {
    calls.push(url);
    if (/\/v1\/models$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ data: [{ id: 'zeta' }, { id: 'alpha' }] }); } });
    return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } });
  };
  AI.modelCache = null; AI.modelCacheBase = '';
  var gw = { provider: 'litellm', baseUrl: 'https://gw.test', apiKey: 'k', model: 'alpha', effort: 'medium' };
  AI.ensureModels(gw).then(function (ids) {
    eq(ids, ['alpha', 'zeta'], 'ensureModels fetches and sorts the gateway models');
    eq([AI.modelCache, AI.modelCacheBase], [['alpha', 'zeta'], 'https://gw.test'], 'the list is cached per gateway');
    eq(calls.filter(function (u) { return /models$/.test(u); }).length, 1, 'one models request');
    return AI.ensureModels(gw);
  }).then(function () {
    eq(calls.filter(function (u) { return /models$/.test(u); }).length, 1, 'a second open reuses the cache');
    return AI.ensureModels({ provider: 'litellm', baseUrl: 'https://other.test', apiKey: 'k' });
  }).then(function () {
    eq(calls.filter(function (u) { return /models$/.test(u); }).length, 2, 'a different gateway fetches again');
    return AI.ensureModels({ provider: 'claude' });
  }).then(function (r) {
    eq(r, null, 'the Claude provider never lists gateway models');
    AI.fetchImpl = function () { return Promise.resolve({ ok: false, status: 500, text: function () { return Promise.resolve('boom'); } }); };
    return AI.ensureModels({ provider: 'litellm', baseUrl: 'https://down.test', apiKey: 'k' });
  }).then(function (r) {
    eq(r, null, 'a failing gateway resolves null instead of throwing');
    AI.fetchImpl = null; AI.modelCache = null; AI.modelCacheBase = '';
    finish();
  }, function (err) { failed++; console.error('  ✗ ensureModels threw: ' + err.message); AI.fetchImpl = null; finish(); });
}

function finish() {
  console.log('— desktop transport');
  { … existing block unchanged … }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 2: Run** `NODE_PATH=./node_modules node tests/ai.test.js 2>&1 | tail -8` — expected: `AI.pickEffort is not a function` (or ✗ lines for the new names).

- [ ] **Step 3: Implement**

State vars (after line 37):

```js
  // the gateway's model list, fetched once per gateway URL (drawer open or
  // Setup → Load); null until fetched
  AI.modelCache = null;
  AI.modelCacheBase = '';
```

After `AI.effortAllowed`:

```js
  // the effort to run with after a model change: the current pick when the
  // model offers it, else Medium, else the first level it does offer; a
  // model with no effort support keeps the stored value (the selector hides)
  AI.pickEffort = function (s) {
    var eff = AI.effortsFor(s);
    if (!eff.length || eff.some(function (e) { return e[0] === s.effort; })) return s.effort;
    return eff.some(function (e) { return e[0] === 'medium'; }) ? 'medium' : eff[0][0];
  };
```

After `AI.refreshModelInfo`:

```js
  // the model list for the drawer's selector: fetched when nothing is cached
  // for this gateway; resolves to the ids, or null when not applicable or
  // the gateway failed (a toast says so and the typed model stays)
  AI.ensureModels = function (s) {
    if (!s || s.provider !== 'litellm' || !s.baseUrl) return Promise.resolve(null);
    if (AI.modelCache && AI.modelCacheBase === s.baseUrl) return Promise.resolve(AI.modelCache);
    return openai.models(s).then(function (ids) {
      AI.modelCache = ids;
      AI.modelCacheBase = s.baseUrl;
      if (drawer) rebuildHeader();
      return ids;
    }, function (err) {
      var a = app();
      if (a && a.toast) a.toast('Could not list models: ' + err.message, 'err');
      return null;
    });
  };
  // per-model facts for the effort selector: refetch when the map has not
  // heard of this model (a model added to the gateway since the last load)
  AI.ensureModelInfo = function (s) {
    var force = !!(AI.modelInfo && s.model && !AI.modelInfo[s.model]);
    return AI.refreshModelInfo(force);
  };
```

Setup Load (1413): after `AI.modelCache = ids;` add `AI.modelCacheBase = s.baseUrl;`.

Model change handler (1623):

```js
    d.querySelector('#aiModelSel').addEventListener('change', function (e) {
      var s = AI.loadSettings();
      if (s.provider === 'claude') s.claudeModel = e.target.value; else s.model = e.target.value;
      // the effort list follows the model: keep a still-valid pick, else fall back
      s.effort = AI.pickEffort(s);
      AI.saveSettings(s);
      rebuildHeader();
      if (s.provider !== 'litellm') return;
      AI.ensureModelInfo(s).then(function () {
        var s2 = AI.loadSettings();
        var e2 = AI.pickEffort(s2);
        if (e2 !== s2.effort) { s2.effort = e2; AI.saveSettings(s2); }
        rebuildHeader();
      });
    });
```

`AI.open`: after `AI.refreshModelInfo();` add `AI.ensureModels(AI.loadSettings());`.

- [ ] **Step 4: Run ai and smoke suites** — `NODE_PATH=./node_modules node tests/ai.test.js | tail -1` → `0 failed`; smoke `0 failed` (the drawer opens in smoke; `ensureModels` returns null there since no gateway is configured).

- [ ] **Step 5: Commit**

```bash
git add js/ai.js tests/ai.test.js
git commit -m "feat(ai): load gateway models on open, effort levels on model change"
```

---

### Task 8: Docs and full suite

**Files:**
- Modify: `README.md` (rows `Sprinting` ~94, `Types & hierarchy` ~99, the view/color row that mentions "Color by"), `CHANGELOG.md` (`## Unreleased`)

- [ ] **Step 1: README**

Sprinting row: replace the sentence from "Rows carry inline title…" with: "Every row belongs to the sprint it starts in — an ⓘ glyph says how many sprints it carries over — and wears its sprint number, epic and workstream chips, size, priority, risk and assignees; story-view headings show the feature's priority, size and duration. Empty sprints at either end of the timeline are hidden. Right-click a row for **Move to sprint…**, phase, epic, workstream, assignees; story rows get their own timeline the same way. The toolbar filters by text, phase, epic and workstream; each section ends with **Add feature**".

Types row: replace "rows show the type icon when it isn't the level default" with "every row and card shows its type glyph (Feature = filled square, Story = bookmark, Bug, Task…) in the active color; each type has a color for **View → Color by item type**". Add "item type" to wherever the README lists the color modes (`grep -n "Color by" README.md`). Milestones: add "Milestones never appear on the Prioritizing board" to the Prioritizing row. AI row: add "The drawer loads the gateway's models when it opens and the effort levels a model supports when you pick one, falling back to Medium."

- [ ] **Step 2: CHANGELOG** — under `## Unreleased` append:

```
- Type glyphs: the colored square left of every title is now the item's type icon (Feature keeps the filled square; Story is a bookmark) in the active color. **View → Color by item type** colors bars by type; each type's color lives in Setup → Hierarchy.
- Prioritizing: milestones no longer appear on the board.
- Sprinting: a row belongs only to the sprint it starts in (an ⓘ glyph says how many sprints it carries over), wears its sprint number, epic, workstream and assignees, and drops the duration, date range and phase columns; story-view headings show priority, size and duration; empty sprints at either end are hidden; right-click for **Move to sprint…** (features and stories) and **Assign…**.
- Settings → Jira: issue-type icons match the rest of the UI.
- AI assistant: the drawer loads the gateway's models when opened and the effort levels a model supports when you pick one, switching to Medium when the current level is not offered.
```

- [ ] **Step 3: Full suite** — `make test 2>&1 | grep -E "passed|✗"` → four `0 failed` lines.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: type glyphs, color by type, sprinting cleanup, AI model loading"
```

---

### Task 9: Merge back to main

- [ ] **Step 1:** In `/Users/arthur.pachachura/git/headway` check `git status --short` — if another session has uncommitted changes to files this branch touched, wait (do not stash) and tell the user.
- [ ] **Step 2:** `git merge feat/type-glyphs` (resolve conflicts by keeping both sides' intent), `make test`, then `git worktree remove ../headway-glyphs`.

## Self-review

- Spec coverage: glyphs (T2), color by type core+UI (T1, T2), Prioritizing milestones (T3), Jira icons (T3), Sprinting membership/carry-over/tag/columns/trim (T4), chips/headings/workstream (T5), context menu (T6), AI (T7), docs (T8). Covered.
- Placeholders: the ai.test `finish()` step says "existing block unchanged" for code that already exists in the file — the executor moves it verbatim.
- Names consistent: `typeGlyphHtml`, `sprFirstNum`, `sprLastNum`, `sprNumTag`, `sprCarryHtml`, `sprAsgChip`, `sprWsChip`, `storyAssignMenuItems`, `moveSprintMenu`, `moveStorySprintMenu`, `AI.ensureModels`, `AI.pickEffort`, `AI.ensureModelInfo`, `RM.colorForType`, `RM.setItemTypeColor` used identically across tasks.

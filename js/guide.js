/*
 * Headway — in-app "How to use" guide.
 *
 * Content for the start page's How-to area: a short tutorial (Start here),
 * one line per view, the keyboard shortcuts and a features list.
 * Pure data + HTML builders, no DOM access — app.js renders it and wires the
 * tabs. Keep entries short: this is a field guide, not the manual (README.md
 * and DESIGN.md hold the detail).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeadwayGuide = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  var MOD = mac ? '⌘' : 'Ctrl';   // the app accepts both; show the viewer's own key

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // inline `key` → <kbd>, **bold** → <b>
  function rich(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, function (m, k) { return '<kbd class="kbd">' + k.replace(/Mod/g, MOD) + '</kbd>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  var TABS = [
    { id: 'start', label: 'Start here', icon: 'rocket' },
    { id: 'views', label: 'Views', icon: 'layout-grid' },
    { id: 'keys', label: 'Shortcuts', icon: 'keyboard' },
    { id: 'ideas', label: 'Features', icon: 'sparkles' }
  ];

  // Start here — the one path every new plan takes, in order
  var START = [
    { t: 'Create the project', d: '**New project…** names it and picks the timeline start. **Setup** (top tabs) holds the end date, sprint length and numbering, workstreams, phases, team and holidays — change any of it later.' },
    { t: 'Add the work', d: 'Edit → **Add feature**, or click the **Add feature** row under a phase and type the title. Click a row and the panel on the right shows it: description, size, priority, tags, and a **Stories** section for the pieces underneath (double-click a title to rename).' },
    { t: 'Put it on the timeline', d: 'In **Planning**, **double-click** the empty lane where the work starts — a bar of the feature’s size appears. Drag the bar to move it, drag its edges to resize, or type the weeks in the chip. Stories get their own bars the same way.' },
    { t: 'Link what depends on what', d: 'Hover a bar and drag its edge **circle** onto another bar: left circle = depends on it, right = enables it. The orange chain is the critical path; dashed amber arrows are violations. The ⚡ **Auto timeline** button on a phase band lays that phase out by dependencies and capacity; right-click a row → **Place at earliest slot** moves just one.' },
    { t: 'Save and share', d: '`Mod+S` saves a lossless **.xlsx** that also opens in Excel. File → **Convert to shared folder…** makes a **.headway** folder for OneDrive so several people edit at once. **Export…** gives PNG, PowerPoint and Jira CSV.' }
  ];

  var VIEWS = [
    { t: 'Setup', d: 'Project settings: timeline, sprints, workstreams, phases, team, sizing scale, estimate mode (single or **range**), capacity switch, holidays, which tabs are on.' },
    { t: 'Planning', d: 'The Gantt. Bars, story bars, dependency arrows, the phase lane, capacity rows, the Resources panel at the bottom; the left pane’s chip columns have headers you can resize, reorder and hide. Drag empty space to pan, `Mod+scroll` to zoom.' },
    { t: 'Scoping', d: 'A spreadsheet of the same rows: size, risk, weeks, workstream, epic, then text columns (Enables, Out of scope, External dependencies, Notes, your own). The **+** header adds columns.' },
    { t: 'Prioritizing', d: 'Kanban. Columns are the phases, or Priority / Size / Risk — drag a card to set the field. Switch to the **Story** level for a story board.' },
    { t: 'Sprinting', d: 'Sprint by sprint: every feature or story listed under the sprint it starts in. Drag a row to another sprint to move it; right-click for **Move to sprint…**.' },
    { t: 'Budgeting', d: 'Roles with hourly cost and rate, margin and total, and the week-hours grid. The **Reports** drawer rolls up effort and cost by workstream or phase.' }
  ];

  var KEYS = [
    { g: 'Files & history', k: [['Mod+S', 'Save'], ['Shift+Mod+S', 'Save as…'], ['Mod+Z', 'Undo'], ['Shift+Mod+Z', 'Redo']] },
    { g: 'Timeline', k: [['Double-click lane', 'Place a bar at that date'], ['Drag bar · drag edge', 'Move · resize'], ['Mod+drag bar', 'Move it and every dependent'], ['← →', 'Nudge the selected bar a day'], ['Shift+← →', 'Nudge five days'], ['Drag empty space', 'Pan'], ['Mod+scroll', 'Zoom around the cursor']] },
    { g: 'Selection', k: [['Click a row', 'Show it in the detail panel'], ['Right-click', 'Row, bar, band and card menus'], ['Delete', 'Delete the selected item or arrow'], ['Esc', 'Close a menu · cancel a dependency drag'], ['[ · ]', 'Collapse the left pane · the right panel']] },
    { g: 'Editing', k: [['Enter', 'Commit a field'], ['Mod+B · Mod+I', 'Bold · italic in rich text'], ['"- " or "1. "', 'Start a bullet or numbered list'], ['Tab · Shift+Tab', 'Hop resource and budget cells'], ['Shift+click ×N', 'Headcount −1 (click adds one)'], ['Mod+F', 'Filter the board or sprint list'], ['Mod+J', 'AI assistant']] }
  ];

  var FEATURES = [
    { t: 'Range estimates', d: 'Setup → Sizing → **Range estimate**: a low and a high per feature and story. The planned bar follows the basis you pick (high or low); the hatched band shows the other end. View → **Estimate ranges** hides the bands for a clean read-out. Sheets that count four days to a week set a rate of 1.25 working days per day.' },
    { t: 'Plans', d: 'The plan menu next to the title keeps alternate versions of the same roadmap — must-haves only, with the coulds, everything. Switch, compare (the other plan rides as a dashed ghost behind the bars), or add a new one.' },
    { t: 'Shared roadmap folder', d: 'A **.headway** folder in OneDrive or SharePoint is one file per feature, phase and teammate, so two people editing different rows never clobber each other. Presence chips show who is in; Version history shows who changed what.' },
    { t: 'Colour and grouping', d: 'View → **Color by** workstream, epic, priority or item type; **Group by** workstream and epic nests rows under bands. Workstream colours are edited from any workstream dropdown’s pencil.' },
    { t: 'Milestones, flags, locks', d: 'A zero-duration item is a milestone (diamond, star or circle). Right-click → **Flag…** puts an orange flag with a reason on any row. **Lock** pins a bar through Auto timeline; **Done** greys it out.' },
    { t: 'Capacity and cost', d: 'Setup → Capacity turns on the roster maths: hours per person per week in the Resources panel, capacity rows over the timeline, and an Auto timeline that never overbooks. Budgeting prices it.' },
    { t: 'Checks', d: 'The preflight chip in the top bar lists cycles, unknown dependencies, starts inside a dependency’s buffer, missing sizes and over-capacity weeks; each row shows its own alert.' },
    { t: 'Sizes from stories', d: 'Setup → Sizing → **Roll up from stories** sizes each feature from the span its sized stories cover; right-click a story → **Move to feature…** re-homes it.' },
    { t: 'Standalone HTML', d: 'Export → **Standalone HTML** saves the whole roadmap as one view-only page — every tab there to browse, nothing to install — for people who only need to look.' },
    { t: 'AI assistant', d: '`Mod+J` opens a chat that knows the open plan: ask what slips if a feature moves, or tell it to re-tag, re-phase or re-size — every edit is undoable and logged as “you · AI”.' }
  ];


  function stepsHtml() {
    return '<ol class="hg-steps">' + START.map(function (s) {
      return '<li><b>' + rich(s.t) + '</b><span>' + rich(s.d) + '</span></li>';
    }).join('') + '</ol>';
  }
  function cardsHtml(list) {
    return '<div class="hg-cards">' + list.map(function (v) {
      return '<div class="hg-card"><b>' + rich(v.t) + '</b><span>' + rich(v.d) + '</span></div>';
    }).join('') + '</div>';
  }
  function keysHtml() {
    return '<div class="hg-keys">' + KEYS.map(function (g) {
      return '<div class="hg-keygrp"><div class="hg-keyhd">' + esc(g.g) + '</div>' + g.k.map(function (k) {
        var keys = k[0].split(' · ').map(function (part) {
          // a gesture ("Double-click lane", "Drag bar") is plain text; keys are chips
          if (/ /.test(part) && !/^(Mod|Shift|Ctrl)\+/.test(part) && !/^"/.test(part)) return '<span class="hg-kt">' + esc(part.replace(/Mod/g, MOD)) + '</span>';
          return part.split('+').map(function (p) { return '<kbd class="kbd">' + esc(p.replace(/Mod/g, MOD)) + '</kbd>'; }).join('<i>+</i>');
        }).join(' <i>·</i> ');
        return '<div class="hg-key"><span class="hg-kk">' + keys + '</span><span class="hg-kd">' + rich(k[1]) + '</span></div>';
      }).join('') + '</div>';
    }).join('') + '</div>' +
    '<div class="hg-note">' + (mac ? '⌘ is Ctrl on Windows.' : 'Ctrl is ⌘ on a Mac.') + ' Shortcuts stay quiet while you are typing in a field.</div>';
  }

  var G = {};
  G.TABS = TABS;
  G.START = START; G.VIEWS = VIEWS; G.KEYS = KEYS; G.FEATURES = FEATURES;
  G.mod = MOD;
  G.bodyHtml = function (tab) {
    if (tab === 'views') return cardsHtml(VIEWS);
    if (tab === 'keys') return keysHtml();
    if (tab === 'ideas') return cardsHtml(FEATURES);
    return stepsHtml();
  };
  // the whole start-page area: header row (title + collapse), tab strip, body
  G.html = function (tab, open) {
    tab = TABS.some(function (t) { return t.id === tab; }) ? tab : 'start';
    return '<section class="hg' + (open ? ' open' : '') + '" data-hg>' +
      '<button class="hg-hd" data-hg-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<i data-lucide="book-open"></i><span>How to use Headway</span>' +
      '<span class="hg-hd-sub">' + (open ? 'tutorial, views, shortcuts, features' : 'a two-minute tour') + '</span>' +
      '<i data-lucide="' + (open ? 'chevron-up' : 'chevron-down') + '" class="hg-chev"></i></button>' +
      (open
        ? '<div class="hg-tabs" role="tablist">' + TABS.map(function (t) {
            return '<button role="tab" aria-selected="' + (t.id === tab ? 'true' : 'false') + '" class="' + (t.id === tab ? 'on' : '') + '" data-hg-tab="' + t.id + '"><i data-lucide="' + t.icon + '"></i>' + esc(t.label) + '</button>';
          }).join('') + '</div>' +
          '<div class="hg-body" data-hg-body="' + tab + '">' + G.bodyHtml(tab) + '</div>'
        : '') +
      '</section>';
  };
  return G;
}));

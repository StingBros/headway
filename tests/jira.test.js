/* Jira sync: plan + apply against a fake client. Run: node tests/jira.test.js */
'use strict';
var RM = require('../js/core.js');
var JR = require('../js/jira.js');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) passed++;
  else { failed++; console.error('  ✗ ' + name + '\n      got:  ' + JSON.stringify(a) + '\n      want: ' + JSON.stringify(b)); }
}

var state = RM.normalizeState({
  meta: { title: 'T', timelineStart: '2026-07-27', numWeeks: 20, priorityScheme: 'levels', jira: { project: 'HW', pushStories: true } },
  phases: [{ id: 'p1', name: 'Pilot Phase' }],
  epicJira: { 'Known Epic': 'HW-1' },
  items: [
    { id: 'a', num: 1, phaseId: 'p1', feature: 'Alpha', epic: 'Known Epic', workstream: 'Data', size: 'M', priority: 'H',
      startDay: 0, durDays: 5, description: '<p>First</p><p>Second line</p>',
      stories: [{ id: 's1', title: 'Story one', done: false }, { id: 's2', title: 'Story two', jiraKey: 'HW-20', done: false }] },
    { id: 'b', num: 2, phaseId: 'p1', feature: 'Beta', epic: 'New Epic', jiraKey: 'HW-10', deps: [1], deadline: '2026-09-01', done: false, stories: [] },
    { id: 'c', num: 3, phaseId: 'p1', feature: 'Gamma', jiraKey: 'HW-99', stories: [] }
  ]
});
var cfg = JR.cfgOf(state, { site: 'x.atlassian.net', email: 'e', token: 't' });

console.log('— adf');
var doc = JR.adf('First\nsecond\n\nThird');
eq(doc.content.length, 2, 'blank lines split paragraphs');
eq(doc.content[0].content.map(function (n) { return n.type; }), ['text', 'hardBreak', 'text'], 'single newlines become hard breaks');
eq(JR.adf('').content, [], 'empty text is an empty doc');

console.log('— fields');
var fa = JR.featureFields(state, RM.itemById(state, 'a'), cfg, 'HW-1');
eq(fa.project, { key: 'HW' }, 'project key from the document mapping');
eq(fa.issuetype, { name: 'Story' }, 'default feature type');
eq(fa.parent, { key: 'HW-1' }, 'parent is the epic key');
eq(fa.priority, { name: 'High' }, 'levels priority maps to Jira names');
ok(fa.labels.indexOf('ws-data') !== -1 && fa.labels.indexOf('phase-pilot-phase') !== -1 && fa.labels.indexOf('size-m') !== -1, 'labels carry workstream, phase and size');
ok(/^\d{4}-\d{2}-\d{2}$/.test(fa.duedate), 'a scheduled feature gets a due date');
ok(!fa.description.content.some(function (p) { return p.content.some(function (n) { return /Stories:/.test(n.text); }); }),
  'story checklist stays out of the description when stories sync on their own');
var fb = JR.featureFields(state, RM.itemById(state, 'b'), cfg, null);
eq(fb.duedate, '2026-09-01', 'a deadline wins as the due date');
ok(!fb.parent, 'no epic key, no parent');

console.log('— plan');
var remote = { 'HW-10': { summary: 'Beta', done: true, status: 'Done' }, 'HW-20': { summary: 'Story two', done: false, status: 'To Do' }, 'HW-99': null };
var plan = JR.plan(state, cfg, remote);
eq(plan.epics.map(function (e) { return e.name; }), ['New Epic'], 'only epics without a key are created');
eq(plan.features.map(function (f) { return f.id; }), ['a'], 'features without a key are created');
eq(plan.stories.map(function (s) { return s.id; }), ['s1'], 'stories without a key are created');
eq(plan.updates.map(function (u) { return u.key; }).sort(), ['HW-10', 'HW-20'], 'keyed items and stories are updated');
ok(!plan.updates[0].fields.project && !plan.updates[0].fields.issuetype, 'updates drop project and issue type');
eq(plan.pulls.map(function (p) { return p.key + ':' + p.done; }), ['HW-10:true'], 'a Done status in Jira pulls back as done');
eq(plan.missing.map(function (m) { return m.key; }), ['HW-99'], 'keys Jira does not know are reported, not updated');
eq(plan.links.length, 1, 'one dependency link planned');
eq(plan.counts, { create: 3, update: 2, link: 1, pull: 1, missing: 1 }, 'counts summarise the plan');
eq(JR.keysOf(state, cfg), ['HW-20', 'HW-10', 'HW-99'], 'keysOf lists every linked key');

console.log('— apply');
var calls = [];
var nextKey = 100;
var client = {
  get: function (p) { calls.push(['GET', p]); return Promise.resolve({}); },
  post: function (p, b) {
    calls.push(['POST', p, b]);
    if (p === '/rest/api/3/issue/bulk') {
      return Promise.resolve({ issues: b.issueUpdates.map(function () { return { key: 'HW-' + (nextKey++) }; }), errors: [] });
    }
    return Promise.resolve({});
  },
  put: function (p, b) { calls.push(['PUT', p, b]); return Promise.resolve(null); }
};
JR.apply(plan, client, null).then(function (result) {
  eq(result.epicKeys, { 'New Epic': 'HW-100' }, 'epic created first');
  eq(result.itemKeys, { a: 'HW-101' }, 'feature keyed');
  eq(result.storyKeys, { s1: 'HW-102' }, 'story keyed');
  var creates = calls.filter(function (c) { return c[1] === '/rest/api/3/issue/bulk'; });
  eq(creates.length, 3, 'three bulk-create rounds: epics, features, stories');
  eq(creates[2][2].issueUpdates[0].fields.parent, { key: 'HW-101' }, 'the new story parents to the freshly created feature');
  var upd = calls.filter(function (c) { return c[0] === 'PUT'; });
  eq(upd.map(function (c) { return c[1]; }).sort(), ['/rest/api/3/issue/HW-10', '/rest/api/3/issue/HW-20'], 'linked issues are updated in place');
  var updB = upd.filter(function (c) { return c[1] === '/rest/api/3/issue/HW-10'; })[0];
  eq(updB[2].fields.parent, { key: 'HW-100' }, 'an updated feature gets its newly created epic as parent');
  var links = calls.filter(function (c) { return c[1] === '/rest/api/3/issueLink'; });
  eq(links.length, 1, 'the dependency became a link');
  eq(links[0][2].outwardIssue, { key: 'HW-101' }, 'the dependency (blocker) is the outward issue');
  eq(links[0][2].inwardIssue, { key: 'HW-10' }, 'the dependent is the inward issue');
  eq(result.created, 3, 'created count');
  eq(result.updated, 2, 'updated count');
  eq(result.errors, [], 'no errors');

  var s2 = RM.clone(state);
  JR.applyToState(s2, plan, result);
  eq(RM.itemById(s2, 'a').jiraKey, 'HW-101', 'feature key lands on the item');
  eq(RM.itemById(s2, 'a').stories[0].jiraKey, 'HW-102', 'story key lands on the story');
  eq(s2.epicJira['New Epic'], 'HW-100', 'epic key lands in epicJira');
  eq(RM.itemById(s2, 'b').done, true, 'done pulled from Jira');

  // a failed element in a bulk response is reported and skipped
  var client2 = {
    post: function (p, b) {
      if (p === '/rest/api/3/issue/bulk') {
        // the epic round fails its only element; later rounds succeed
        if (b.issueUpdates[0].fields.issuetype.name === 'Epic') {
          return Promise.resolve({ issues: [], errors: [{ failedElementNumber: 0, elementErrors: { errorMessages: ['nope'], errors: {} } }] });
        }
        return Promise.resolve({ issues: b.issueUpdates.map(function (x, i) { return { key: 'X-' + i }; }), errors: [] });
      }
      return Promise.resolve({});
    },
    put: function () { return Promise.resolve(null); }, get: function () { return Promise.resolve({}); }
  };
  var plan2 = JR.plan(state, cfg, remote);
  return JR.apply(plan2, client2, null).then(function (r2) {
    ok(r2.errors.some(function (e) { return /New Epic: nope/.test(e); }), 'bulk element errors name the failed entry');
    eq(r2.epicKeys, {}, 'the failed epic gets no key');
    eq(r2.itemKeys, { a: 'X-0' }, 'later rounds still create');
  });
}).then(function () {
  console.log('— client');
  eq(JR.siteUrl('x.atlassian.net/'), 'https://x.atlassian.net', 'site url gets a scheme and loses the slash');
  var seen = [];
  JR.fetchImpl = function (url, opts) {
    seen.push([url, opts]);
    return Promise.resolve({ ok: false, status: 400, text: function () { return Promise.resolve('{"errorMessages":["bad"],"errors":{"summary":"required"}}'); } });
  };
  return JR.client({ site: 'x.atlassian.net', email: 'e', token: 't' }).post('/rest/api/3/issue', { a: 1 }).then(function () {
    ok(false, 'a 400 rejects');
  }, function (err) {
    eq(err.message, 'bad; summary: required', 'error messages come from the Jira body');
    eq(seen[0][0], 'https://x.atlassian.net/rest/api/3/issue', 'request goes to the site');
    ok(/^Basic /.test(seen[0][1].headers.Authorization), 'basic auth header');
  });
}).then(function () {
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) { console.error(e); process.exit(1); });

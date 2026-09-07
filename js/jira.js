/*
 * Headway ↔ Jira Cloud sync (REST API v3, Basic auth with an API token).
 *
 * Pure, node-testable pieces:
 *  - plan(state, cfg, remote) -> what a sync would do: epics / features /
 *    stories to create, issues to update, dependency links to add, and
 *    done-flags to pull back from Jira. `remote` maps Jira key -> issue
 *    (as fetchRemote returns it); pass {} to skip the pull.
 *  - apply(plan, client, onProgress) -> Promise<result>: runs the plan
 *    against a client ({get, post, put}); never touches Headway state —
 *    the caller commits the returned keys and done-flags.
 *  - adf(text): plain text -> Atlassian Document Format.
 *
 * Browser glue (window.HeadwayJira): a Setup tab (connection is stored on
 * this machine only; the project mapping lives in the document as
 * meta.jira) and the Sync dialog, which previews the plan before applying.
 *
 * Transport: Tauri's http plugin when running in the desktop app (Jira
 * Cloud sends no CORS headers, so a plain browser page cannot call it);
 * window.fetch otherwise.
 */
(function (root) {
  'use strict';

  var RM = root.RM || (typeof require !== 'undefined' ? require('./core.js') : null);
  var JR = {};

  JR.DEFAULTS = { epicType: 'Epic', featureType: 'Story', storyType: 'Sub-task', pushEpics: true, pushStories: false, startField: '' };
  JR.LOCAL_KEY = 'headway-jira-v1'; // site / email / token — per machine

  // ------------------------------------------------------------ helpers
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function section(title, html) {
    var t = RM.htmlToText(html);
    return t ? title + ':\n' + t : '';
  }
  function joinSections(parts) {
    return parts.filter(Boolean).join('\n\n');
  }
  function sched(x) { return x && x.startDay != null && x.durDays != null; }
  function iso(meta, day) { return RM.fmtISO(RM.dayToDate(meta, day)); }
  function cfgOf(state, creds) {
    var out = {};
    Object.keys(JR.DEFAULTS).forEach(function (k) { out[k] = JR.DEFAULTS[k]; });
    var doc = (state && state.meta && state.meta.jira) || {};
    Object.keys(doc).forEach(function (k) { if (doc[k] != null && doc[k] !== '') out[k] = doc[k]; });
    Object.keys(creds || {}).forEach(function (k) { out[k] = creds[k]; });
    return out;
  }
  JR.cfgOf = cfgOf;

  // Plain text -> ADF: blank lines split paragraphs, single newlines break lines
  JR.adf = function (text) {
    var content = [];
    String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).forEach(function (para) {
      if (!para.trim()) return;
      var nodes = [];
      para.split('\n').forEach(function (line, i) {
        if (i) nodes.push({ type: 'hardBreak' });
        if (line) nodes.push({ type: 'text', text: line });
      });
      content.push({ type: 'paragraph', content: nodes });
    });
    return { type: 'doc', version: 1, content: content };
  };

  // Headway priority letters -> Jira's default priority names
  JR.PRIORITY_NAMES = {
    levels: { C: 'Highest', H: 'High', M: 'Medium', L: 'Low' },
    moscow: { M: 'Highest', S: 'High', C: 'Medium', W: 'Low' }
  };
  function priorityField(scheme, v) {
    var map = JR.PRIORITY_NAMES[scheme];
    return map && v && map[v] ? { name: map[v] } : null;
  }

  // ------------------------------------------------------------ fields
  JR.featureFields = function (state, it, cfg, parentKey) {
    var meta = state.meta;
    var phase = null;
    state.phases.forEach(function (p) { if (p.id === it.phaseId) phase = p; });
    var checklist = cfg.pushStories ? '' : it.stories.map(function (s) {
      return (s.done ? '[x] ' : '[ ] ') + s.title;
    }).join('\n');
    var f = {
      project: { key: cfg.project },
      issuetype: { name: cfg.featureType },
      summary: it.feature || '(untitled)',
      description: JR.adf(joinSections([
        RM.htmlToText(it.description),
        checklist ? 'Stories:\n' + checklist : '',
        section('Enables', it.enables),
        section('Out of scope', it.outOfScope),
        section('External dependencies', it.extDeps),
        section('Notes', it.notes)
      ])),
      labels: [
        it.workstream ? 'ws-' + slug(it.workstream) : '',
        phase ? 'phase-' + slug(phase.name) : '',
        it.size ? 'size-' + slug(it.size) : ''
      ].filter(Boolean)
    };
    var pr = priorityField(RM.prioritySchemeOf(state), it.priority);
    if (pr) f.priority = pr;
    var due = it.deadline || (sched(it) && !it.milestone ? RM.fmtISO(RM.spanEndDate(meta, it.startDay, it.durDays)) : (sched(it) ? iso(meta, it.startDay) : null));
    if (due) f.duedate = due;
    if (cfg.startField && sched(it)) f[cfg.startField] = iso(meta, it.startDay);
    if (parentKey) f.parent = { key: parentKey };
    return f;
  };
  JR.storyFields = function (state, it, st, cfg, parentKey) {
    var meta = state.meta;
    var f = {
      project: { key: cfg.project },
      issuetype: { name: cfg.storyType },
      summary: st.title || '(untitled)',
      description: JR.adf(joinSections([
        RM.htmlToText(st.description),
        section('Acceptance criteria', st.ac)
      ])),
      labels: ['feature-' + slug(it.feature), it.workstream ? 'ws-' + slug(it.workstream) : ''].filter(Boolean)
    };
    var pr = priorityField(RM.prioritySchemeOf(state, 'story'), st.priority);
    if (pr) f.priority = pr;
    var ssched = st.startDay != null && st.durDays > 0;
    var due = st.deadline || (ssched ? RM.fmtISO(RM.spanEndDate(meta, st.startDay, st.durDays)) : null);
    if (due) f.duedate = due;
    if (cfg.startField && ssched) f[cfg.startField] = iso(meta, st.startDay);
    if (parentKey) f.parent = { key: parentKey };
    return f;
  };
  JR.epicFields = function (name, cfg) {
    return { project: { key: cfg.project }, issuetype: { name: cfg.epicType }, summary: name };
  };

  // ------------------------------------------------------------ plan
  // remote: { KEY: { summary, done: bool, status: 'In Progress' } } for the
  // keys Headway already holds (fetchRemote builds it); missing keys are
  // reported, not synced.
  JR.plan = function (state, cfg, remote) {
    remote = remote || {};
    var plan = { epics: [], features: [], stories: [], updates: [], links: [], pulls: [], missing: [], skipped: [] };
    var epicKey = {};
    Object.keys(state.epicJira || {}).forEach(function (e) { if (state.epicJira[e]) epicKey[e] = state.epicJira[e]; });
    if (cfg.pushEpics) {
      var seen = {};
      state.items.forEach(function (it) {
        if (!it.epic || epicKey[it.epic] || seen[it.epic]) return;
        seen[it.epic] = true;
        plan.epics.push({ name: it.epic, fields: JR.epicFields(it.epic, cfg) });
      });
    }
    var keyByNum = {};
    state.items.forEach(function (it) {
      var parent = it.epic ? (epicKey[it.epic] || null) : null;
      var fields = JR.featureFields(state, it, cfg, parent);
      var entry = { id: it.id, num: it.num, title: it.feature, epic: it.epic || '', fields: fields };
      if (it.jiraKey) {
        keyByNum[it.num] = it.jiraKey;
        if (remote[it.jiraKey] === null) { plan.missing.push({ kind: 'feature', id: it.id, key: it.jiraKey, title: it.feature }); return; }
        // creates carry project/type; updates must not (Jira rejects type moves here)
        var uf = {}; Object.keys(fields).forEach(function (k) { if (k !== 'project' && k !== 'issuetype') uf[k] = fields[k]; });
        entry.key = it.jiraKey; entry.fields = uf; entry.kind = 'feature';
        plan.updates.push(entry);
        var r = remote[it.jiraKey];
        if (r && r.done !== !!it.done) plan.pulls.push({ kind: 'feature', id: it.id, key: it.jiraKey, title: it.feature, done: r.done, status: r.status });
      } else {
        plan.features.push(entry);
      }
      if (cfg.pushStories) {
        it.stories.forEach(function (st) {
          var sf = JR.storyFields(state, it, st, cfg, it.jiraKey || null);
          var se = { id: st.id, itemId: it.id, title: st.title, fields: sf };
          if (st.jiraKey) {
            if (remote[st.jiraKey] === null) { plan.missing.push({ kind: 'story', id: st.id, itemId: it.id, key: st.jiraKey, title: st.title }); return; }
            var suf = {}; Object.keys(sf).forEach(function (k) { if (k !== 'project' && k !== 'issuetype') suf[k] = sf[k]; });
            se.key = st.jiraKey; se.fields = suf; se.kind = 'story';
            plan.updates.push(se);
            var sr = remote[st.jiraKey];
            if (sr && sr.done !== !!st.done) plan.pulls.push({ kind: 'story', id: st.id, itemId: it.id, key: st.jiraKey, title: st.title, done: sr.done, status: sr.status });
          } else {
            plan.stories.push(se);
          }
        });
      }
    });
    // dependency links: "X blocks Y" for every dep whose two ends will both
    // have keys once creates land (resolved in apply)
    state.items.forEach(function (it) {
      it.deps.forEach(function (n) {
        var dep = RM.itemByNum(state, n);
        if (!dep) return;
        plan.links.push({ blockerNum: n, blockerId: dep.id, blockedNum: it.num, blockedId: it.id });
      });
    });
    plan.counts = {
      create: plan.epics.length + plan.features.length + plan.stories.length,
      update: plan.updates.length, link: plan.links.length, pull: plan.pulls.length, missing: plan.missing.length
    };
    return plan;
  };
  // the keys a plan wants to look at in Jira
  JR.keysOf = function (state, cfg) {
    var keys = [];
    state.items.forEach(function (it) {
      if (it.jiraKey) keys.push(it.jiraKey);
      if (cfg.pushStories) it.stories.forEach(function (st) { if (st.jiraKey) keys.push(st.jiraKey); });
    });
    return keys;
  };

  // ------------------------------------------------------------ client
  function b64(s) {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
    return Buffer.from(s, 'utf8').toString('base64');
  }
  JR.siteUrl = function (site) {
    var s = String(site || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  };
  // pick the transport: Tauri's http plugin (no CORS) when present
  JR.fetchImpl = null;
  function fetchFn() {
    if (JR.fetchImpl) return JR.fetchImpl;
    var t = root.__TAURI__;
    if (t && t.http && t.http.fetch) return t.http.fetch;
    return root.fetch ? root.fetch.bind(root) : null;
  }
  JR.client = function (creds) {
    var base = JR.siteUrl(creds.site);
    var auth = 'Basic ' + b64((creds.email || '') + ':' + (creds.token || ''));
    function request(method, path, body) {
      var f = fetchFn();
      if (!f) return Promise.reject(new Error('No HTTP transport available'));
      if (!base) return Promise.reject(new Error('Jira site URL is not set'));
      var opts = { method: method, headers: { Authorization: auth, Accept: 'application/json' } };
      if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      return f(base + path, opts).then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var msg = [];
            if (data && data.errorMessages) msg = msg.concat(data.errorMessages);
            if (data && data.errors) Object.keys(data.errors).forEach(function (k) { msg.push(k + ': ' + data.errors[k]); });
            var err = new Error(msg.length ? msg.join('; ') : 'HTTP ' + res.status + (txt ? ' ' + txt.slice(0, 200) : ''));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    }
    return {
      get: function (p) { return request('GET', p); },
      post: function (p, b) { return request('POST', p, b); },
      put: function (p, b) { return request('PUT', p, b); }
    };
  };

  // ------------------------------------------------------------ remote
  // { KEY: { summary, done, status } | null (not found) } — one GET per key,
  // a few in flight; a bad key must not sink the whole sync
  JR.fetchRemote = function (client, keys, onProgress) {
    var out = {}, i = 0, done = 0;
    var uniq = keys.filter(function (k, idx) { return keys.indexOf(k) === idx; });
    function next() {
      if (i >= uniq.length) return Promise.resolve();
      var key = uniq[i++];
      return client.get('/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=summary,status').then(function (iss) {
        var st = iss && iss.fields && iss.fields.status;
        out[key] = { summary: iss && iss.fields ? iss.fields.summary : '',
          done: !!(st && st.statusCategory && st.statusCategory.key === 'done'), status: st ? st.name : '' };
      }, function (err) {
        if (err && err.status === 404) out[key] = null; else throw err;
      }).then(function () {
        done += 1;
        if (onProgress) onProgress('Reading ' + done + ' of ' + uniq.length + ' linked issues…');
        return next();
      });
    }
    var lanes = [];
    for (var l = 0; l < 4; l++) lanes.push(next());
    return Promise.all(lanes).then(function () { return out; });
  };
  JR.testConnection = function (creds, project) {
    var c = JR.client(creds);
    return c.get('/rest/api/3/myself').then(function (me) {
      var who = (me && me.displayName) || (me && me.emailAddress) || 'signed in';
      if (!project) return { user: who };
      return c.get('/rest/api/3/project/' + encodeURIComponent(project)).then(function (p) {
        return { user: who, project: (p && p.name) || project };
      });
    });
  };

  // ------------------------------------------------------------ apply
  function chunks(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }
  // POST /issue/bulk keeps input order: issues[] carry the keys, errors[]
  // point back at failedElementNumber
  function bulkCreate(client, entries, label, result, onProgress) {
    var made = 0;
    return chunks(entries, 50).reduce(function (p, batch) {
      return p.then(function () {
        if (onProgress) onProgress('Creating ' + label + ' (' + made + ' of ' + entries.length + ')…');
        return client.post('/rest/api/3/issue/bulk', { issueUpdates: batch.map(function (e) { return { fields: e.fields }; }) })
          .then(function (res) {
            var issues = (res && res.issues) || [];
            var errs = (res && res.errors) || [];
            var failed = {};
            errs.forEach(function (er) {
              failed[er.failedElementNumber] = true;
              var el = batch[er.failedElementNumber];
              var m = [];
              if (er.elementErrors) {
                (er.elementErrors.errorMessages || []).forEach(function (x) { m.push(x); });
                Object.keys(er.elementErrors.errors || {}).forEach(function (k) { m.push(k + ': ' + er.elementErrors.errors[k]); });
              }
              result.errors.push((el ? (el.title || el.name) : label) + ': ' + (m.join('; ') || 'not created'));
            });
            var ii = 0;
            batch.forEach(function (e, idx) {
              if (failed[idx]) return;
              var iss = issues[ii++];
              if (iss && iss.key) { e.key = iss.key; made += 1; }
              else result.errors.push((e.title || e.name) + ': no key returned');
            });
          });
      });
    }, Promise.resolve()).then(function () { return made; });
  }
  JR.apply = function (plan, client, onProgress) {
    var result = { epicKeys: {}, itemKeys: {}, storyKeys: {}, created: 0, updated: 0, linked: 0, errors: [] };
    var progress = onProgress || function () {};
    return Promise.resolve()
      // 1. epics
      .then(function () { return bulkCreate(client, plan.epics, 'epics', result, progress); })
      .then(function (n) {
        result.created += n;
        plan.epics.forEach(function (e) { if (e.key) result.epicKeys[e.name] = e.key; });
        // features under a freshly created epic get their parent now
        plan.features.forEach(function (f) {
          if (f.epic && result.epicKeys[f.epic]) f.fields.parent = { key: result.epicKeys[f.epic] };
        });
        plan.updates.forEach(function (u) {
          if (u.kind === 'feature' && u.epic && result.epicKeys[u.epic]) u.fields.parent = { key: result.epicKeys[u.epic] };
        });
        return bulkCreate(client, plan.features, 'features', result, progress);
      })
      // 2. features
      .then(function (n) {
        result.created += n;
        plan.features.forEach(function (f) { if (f.key) result.itemKeys[f.id] = f.key; });
        plan.stories.forEach(function (s) {
          if (!s.fields.parent && result.itemKeys[s.itemId]) s.fields.parent = { key: result.itemKeys[s.itemId] };
        });
        // stories whose feature has no key yet cannot be parented — skip them
        var ready = plan.stories.filter(function (s) { return !!s.fields.parent; });
        plan.stories.forEach(function (s) { if (!s.fields.parent) result.errors.push(s.title + ': feature has no Jira key yet'); });
        return bulkCreate(client, ready, 'stories', result, progress);
      })
      // 3. stories, then updates one by one
      .then(function (n) {
        result.created += n;
        plan.stories.forEach(function (s) { if (s.key) result.storyKeys[s.id] = s.key; });
        var i = 0;
        return plan.updates.reduce(function (p, u) {
          return p.then(function () {
            i += 1;
            progress('Updating ' + i + ' of ' + plan.updates.length + '…');
            return client.put('/rest/api/3/issue/' + encodeURIComponent(u.key), { fields: u.fields })
              .then(function () { result.updated += 1; }, function (err) { result.errors.push(u.key + ' ' + u.title + ': ' + err.message); });
          });
        }, Promise.resolve());
      })
      // 4. dependency links
      .then(function () {
        var keyOf = {};
        plan.features.forEach(function (f) { if (f.key) keyOf[f.id] = f.key; });
        plan.updates.forEach(function (u) { if (u.kind === 'feature') keyOf[u.id] = u.key; });
        var links = plan.links.filter(function (l) { return keyOf[l.blockerId] && keyOf[l.blockedId]; });
        var i = 0;
        return links.reduce(function (p, l) {
          return p.then(function () {
            i += 1;
            progress('Linking ' + i + ' of ' + links.length + '…');
            return client.post('/rest/api/3/issueLink', {
              type: { name: 'Blocks' },
              outwardIssue: { key: keyOf[l.blockerId] },
              inwardIssue: { key: keyOf[l.blockedId] }
            }).then(function () { result.linked += 1; }, function (err) {
              // an already-present link is fine; anything else is reported
              if (!/already|exist/i.test(err.message)) result.errors.push('Link ' + keyOf[l.blockerId] + ' → ' + keyOf[l.blockedId] + ': ' + err.message);
            });
          });
        }, Promise.resolve());
      })
      .then(function () { return result; });
  };

  // write the sync result + pulls into a Headway state (used inside commit)
  JR.applyToState = function (s, plan, result) {
    Object.keys(result.epicKeys).forEach(function (e) { s.epicJira[e] = result.epicKeys[e]; });
    s.items.forEach(function (it) {
      if (result.itemKeys[it.id]) it.jiraKey = result.itemKeys[it.id];
      it.stories.forEach(function (st) { if (result.storyKeys[st.id]) st.jiraKey = result.storyKeys[st.id]; });
    });
    plan.pulls.forEach(function (pl) {
      var it = RM.itemById(s, pl.itemId || pl.id);
      if (!it) return;
      if (pl.kind === 'feature') it.done = pl.done;
      else it.stories.forEach(function (st) { if (st.id === pl.id) st.done = pl.done; });
    });
  };

  // ------------------------------------------------------------ browser UI
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  JR.loadCreds = function () {
    try { return JSON.parse(root.localStorage.getItem(JR.LOCAL_KEY) || '{}') || {}; } catch (e) { return {}; }
  };
  JR.saveCreds = function (c) {
    try { root.localStorage.setItem(JR.LOCAL_KEY, JSON.stringify(c)); } catch (e) { /* storage blocked */ }
  };
  JR.hasCreds = function () {
    var c = JR.loadCreds();
    return !!(c.site && c.email && c.token);
  };
  function app() { return root.HeadwayApp; }
  function docCfg() { return cfgOf(app().ai.state(), null); }

  JR.settingsHtml = function () {
    var c = JR.loadCreds();
    var d = docCfg();
    var desktop = !!root.__TAURI__;
    function inp(id, val, ph, type) {
      return '<input id="' + id + '" type="' + (type || 'text') + '" style="width:100%" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off">';
    }
    return '<h2>Connection</h2>' +
      '<div class="m-sec"><label>Site</label>' + inp('jrSite', c.site, 'your-team.atlassian.net') + '</div>' +
      '<div class="p-grid2">' +
      '<div class="m-sec"><label>Email</label>' + inp('jrEmail', c.email, 'you@example.com') + '</div>' +
      '<div class="m-sec"><label>API token</label>' + inp('jrToken', c.token, '', 'password') + '</div></div>' +
      '<div class="m-hint">Stored on this machine only. Create a token at id.atlassian.com → Security → API tokens.' +
      (desktop ? '' : ' Jira Cloud blocks browser calls; syncing works from the desktop app.') + '</div>' +
      '<div class="p-row" style="margin-top:8px"><button id="jrTest">Test connection</button><span id="jrTestOut" class="m-hint" style="margin:0 0 0 10px"></span></div>' +
      '<h2 style="margin-top:22px">Project mapping</h2>' +
      '<div class="p-grid2">' +
      '<div class="m-sec"><label>Project key</label>' + inp('jrProject', d.project, 'e.g. HW') + '</div>' +
      '<div class="m-sec"><label>Epic type</label>' + inp('jrEpicType', d.epicType, JR.DEFAULTS.epicType) + '</div>' +
      '<div class="m-sec"><label>Feature type</label>' + inp('jrFeatureType', d.featureType, JR.DEFAULTS.featureType) + '</div>' +
      '<div class="m-sec"><label>Story type</label>' + inp('jrStoryType', d.storyType, JR.DEFAULTS.storyType) + '</div>' +
      '<div class="m-sec"><label>Start date field id</label>' + inp('jrStartField', d.startField, 'e.g. customfield_10015') + '</div>' +
      '</div>' +
      '<label class="p-check" style="margin-top:7px"><input type="checkbox" id="jrPushEpics"' + (d.pushEpics ? ' checked' : '') + '> Create an epic per Headway epic and parent features to it</label>' +
      '<label class="p-check" style="margin-top:7px"><input type="checkbox" id="jrPushStories"' + (d.pushStories ? ' checked' : '') + '> Sync stories as their own issues (otherwise they list inside the feature)</label>' +
      '<div class="m-hint">Shared with everyone who opens this file. Jira keys land back on features, stories and epics after a sync; the Done state of linked issues is read back from Jira.</div>' +
      '<div class="p-row" style="margin-top:10px"><button id="jrSync" class="primary">Sync with Jira…</button></div>';
  };
  JR.wireSettings = function (host) {
    function $(sel) { return host.querySelector(sel); }
    function creds() {
      return { site: $('#jrSite').value.trim(), email: $('#jrEmail').value.trim(), token: $('#jrToken').value.trim() };
    }
    ['#jrSite', '#jrEmail', '#jrToken'].forEach(function (sel) {
      $(sel).addEventListener('change', function () { JR.saveCreds(creds()); });
    });
    function mapping() {
      return {
        project: $('#jrProject').value.trim().toUpperCase(),
        epicType: $('#jrEpicType').value.trim() || JR.DEFAULTS.epicType,
        featureType: $('#jrFeatureType').value.trim() || JR.DEFAULTS.featureType,
        storyType: $('#jrStoryType').value.trim() || JR.DEFAULTS.storyType,
        startField: $('#jrStartField').value.trim(),
        pushEpics: $('#jrPushEpics').checked,
        pushStories: $('#jrPushStories').checked
      };
    }
    ['#jrProject', '#jrEpicType', '#jrFeatureType', '#jrStoryType', '#jrStartField', '#jrPushEpics', '#jrPushStories'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        var m = mapping();
        app().ai.commit('jira settings', function (s) { s.meta.jira = m; });
      });
    });
    $('#jrTest').addEventListener('click', function () {
      var out = $('#jrTestOut');
      var c = creds();
      JR.saveCreds(c);
      if (!c.site || !c.email || !c.token) { out.textContent = 'Fill in site, email and token first'; return; }
      out.textContent = 'Connecting…';
      JR.testConnection(c, $('#jrProject').value.trim().toUpperCase()).then(function (r) {
        out.textContent = 'Connected as ' + r.user + (r.project ? ' · project “' + r.project + '”' : '');
      }, function (err) { out.textContent = 'Failed: ' + err.message; });
    });
    $('#jrSync').addEventListener('click', function () { JR.syncModal(); });
  };

  // The Sync dialog: read the linked issues, show the plan, apply on confirm
  JR.syncModal = function () {
    var A = app();
    if (!A.ai.hasDoc()) { A.toast('Open a project first'); return; }
    var creds = JR.loadCreds();
    var cfg = cfgOf(A.ai.state(), creds);
    function shell(body, foot) {
      return '<div class="modal" style="width:520px">' +
        '<div class="m-head"><h2>Sync with Jira</h2><button class="p-close" data-m="x"><i data-lucide="x"></i></button></div>' +
        '<div class="m-body">' + body + '</div>' +
        '<div class="m-foot">' + foot + '</div></div>';
    }
    if (!creds.site || !creds.email || !creds.token || !cfg.project) {
      A.openModal(shell('<div class="m-hint">Set the Jira connection and a project key first.</div>',
        '<button data-m="x2">Close</button><button data-m="setup" class="primary">Open Jira settings</button>'), function (host) {
        host.querySelector('[data-m=x]').onclick = A.closeModal;
        host.querySelector('[data-m=x2]').onclick = A.closeModal;
        host.querySelector('[data-m=setup]').onclick = function () { A.closeModal(); A.openSetup('jira'); };
      });
      return;
    }
    var client = JR.client(creds);
    var state = A.ai.state();
    var plan = null;
    function line(n, what) { return n ? '<li><b>' + n + '</b> ' + what + '</li>' : ''; }
    function list(title, rows) {
      if (!rows.length) return '';
      return '<div class="m-sec"><label>' + title + '</label><div class="jr-list">' + rows.map(function (r) { return '<div>' + esc(r) + '</div>'; }).join('') + '</div></div>';
    }
    A.openModal(shell('<div id="jrBody" class="m-hint">Reading linked issues…</div>', '<button data-m="x2">Cancel</button><button data-m="go" class="primary" disabled>Apply</button>'), function (host) {
      var body = host.querySelector('#jrBody');
      var go = host.querySelector('[data-m=go]');
      var cancel = host.querySelector('[data-m=x2]');
      host.querySelector('[data-m=x]').onclick = A.closeModal;
      cancel.onclick = A.closeModal;
      JR.fetchRemote(client, JR.keysOf(state, cfg), function (msg) { body.textContent = msg; }).then(function (remote) {
        plan = JR.plan(state, cfg, remote);
        var c = plan.counts;
        if (!c.create && !c.update && !c.pull && !c.link) { body.innerHTML = '<div class="m-hint">Nothing to sync.</div>'; return; }
        body.innerHTML = '<ul class="jr-plan">' +
          line(plan.epics.length, 'epic' + (plan.epics.length === 1 ? '' : 's') + ' to create in ' + esc(cfg.project)) +
          line(plan.features.length, 'feature' + (plan.features.length === 1 ? '' : 's') + ' to create as ' + esc(cfg.featureType)) +
          line(plan.stories.length, 'stor' + (plan.stories.length === 1 ? 'y' : 'ies') + ' to create as ' + esc(cfg.storyType)) +
          line(c.update, 'linked issue' + (c.update === 1 ? '' : 's') + ' to update') +
          line(c.link, 'dependency link' + (c.link === 1 ? '' : 's') + ' to add') +
          line(c.pull, 'Done flag' + (c.pull === 1 ? '' : 's') + ' to read back from Jira') +
          '</ul>' +
          list('Done state from Jira', plan.pulls.map(function (p) { return p.key + ' ' + p.title + ' → ' + (p.done ? 'done' : 'not done') + ' (' + p.status + ')'; })) +
          list('Keys not found in Jira (left alone)', plan.missing.map(function (m) { return m.key + ' ' + m.title; }));
        go.disabled = false;
      }, function (err) {
        body.innerHTML = '<div class="m-hint">Could not reach Jira: ' + esc(err.message) + '</div>';
      });
      go.onclick = function () {
        if (!plan) return;
        go.disabled = true; cancel.disabled = true;
        body.innerHTML = '<div id="jrProg" class="m-hint">Starting…</div>';
        var prog = host.querySelector('#jrProg');
        JR.apply(plan, client, function (msg) { prog.textContent = msg; }).then(function (result) {
          A.ai.commit('jira sync', function (s) { JR.applyToState(s, plan, result); });
          body.innerHTML = '<ul class="jr-plan">' +
            line(result.created, 'issue' + (result.created === 1 ? '' : 's') + ' created') +
            line(result.updated, 'issue' + (result.updated === 1 ? '' : 's') + ' updated') +
            line(result.linked, 'link' + (result.linked === 1 ? '' : 's') + ' added') +
            line(plan.pulls.length, 'Done flag' + (plan.pulls.length === 1 ? '' : 's') + ' read back') +
            '</ul>' + list('Problems', result.errors);
          if (!result.created && !result.updated && !result.linked && !plan.pulls.length && !result.errors.length) body.innerHTML = '<div class="m-hint">Nothing changed.</div>';
          go.hidden = true;
          cancel.textContent = 'Done'; cancel.disabled = false;
          A.toast('Jira sync: ' + result.created + ' created, ' + result.updated + ' updated' + (result.errors.length ? ', ' + result.errors.length + ' problem(s)' : ''), result.errors.length ? 'warn' : '');
        }, function (err) {
          body.innerHTML = '<div class="m-hint">Sync failed: ' + esc(err.message) + '</div>';
          go.hidden = true;
          cancel.textContent = 'Close'; cancel.disabled = false;
        });
      };
    });
  };

  root.HeadwayJira = JR;
  if (typeof module !== 'undefined' && module.exports) module.exports = JR;
})(typeof window !== 'undefined' ? window : globalThis);

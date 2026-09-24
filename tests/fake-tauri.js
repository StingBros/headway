/* In-memory stand-in for the Tauri v2 JS API surface desktop.js touches
 * (fs, dialog, window). Paths are normalised to '/'; files live in a Map;
 * every mutation is logged so tests can assert on the exact write sequence.
 *   makeFakeTauri({ deny: ['rename'] })  → those fs commands reject with the
 *   plugin's plain-string permission error. */
'use strict';

const snake = (s) => s.replace(/([A-Z])/g, (m) => '_' + m.toLowerCase());
const kebab = (s) => s.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());

module.exports = function makeFakeTauri(opts) {
  opts = opts || {};
  const deny = new Set(opts.deny || []);
  const files = new Map();   // norm path → string | Uint8Array
  const dirs = new Set();    // norm path of every mkdir'ed directory
  const log = [];
  let watchCb = null, watchOpts = null, closeCb = null;

  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const parent = (p) => (p.indexOf('/') >= 0 ? p.replace(/\/[^/]*$/, '') : '');
  const hasDir = (d) => {
    if (dirs.has(d)) return true;
    for (const f of files.keys()) if (f.indexOf(d + '/') === 0) return true;
    for (const x of dirs) if (x.indexOf(d + '/') === 0) return true;
    return false;
  };
  const denied = (cmd) => Promise.reject(
    'fs.' + snake(cmd) + ' not allowed. Permissions associated with this command: fs:allow-' + kebab(cmd));
  const missing = (p) => Promise.reject(
    'failed to open file at path: ' + p + ' with error: No such file or directory (os error 2)');
  const guard = (cmd, fn) => function () {
    if (deny.has(cmd)) return denied(cmd);
    try { return Promise.resolve(fn.apply(null, arguments)); } catch (e) { return Promise.reject(e); }
  };

  const fs = {
    readTextFile: guard('readTextFile', (p) => {
      p = norm(p);
      if (typeof api.beforeRead === 'function') api.beforeRead(p);
      if (!files.has(p)) return missing(p);
      const v = files.get(p);
      return typeof v === 'string' ? v : Buffer.from(v).toString('utf8');
    }),
    readFile: guard('readFile', (p) => {
      p = norm(p);
      if (!files.has(p)) return missing(p);
      const v = files.get(p);
      return typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'utf8')) : v;
    }),
    writeTextFile: guard('writeTextFile', (p, text, o) => {
      p = norm(p);
      if (typeof api.beforeWrite === 'function') api.beforeWrite(p);
      if (!hasDir(parent(p))) return missing(p);
      const prev = (o && o.append && files.has(p)) ? files.get(p) : '';
      files.set(p, prev + String(text));
      log.push({ op: 'writeTextFile', path: p, bytes: String(text).length });
    }),
    writeFile: guard('writeFile', (p, u8) => {
      p = norm(p);
      if (!hasDir(parent(p))) return missing(p);
      files.set(p, u8);
      log.push({ op: 'writeFile', path: p, bytes: u8.length });
    }),
    readDir: guard('readDir', (p) => {
      p = norm(p);
      if (!hasDir(p)) return missing(p);
      const names = new Map();
      for (const f of files.keys()) {
        if (f.indexOf(p + '/') !== 0) continue;
        const rest = f.slice(p.length + 1);
        const cut = rest.indexOf('/');
        if (cut < 0) names.set(rest, false); else names.set(rest.slice(0, cut), true);
      }
      for (const d of dirs) {
        if (d.indexOf(p + '/') !== 0) continue;
        const rest = d.slice(p.length + 1);
        const cut = rest.indexOf('/');
        names.set(cut < 0 ? rest : rest.slice(0, cut), true);
      }
      return [...names.entries()].sort().map(([name, isDir]) => ({ name, isFile: !isDir, isDirectory: isDir }));
    }),
    exists: guard('exists', (p) => {
      p = norm(p);
      // a sync client materialising / restoring things between two checks: tests set this
      if (typeof api.onExists === 'function') api.onExists(p);
      return files.has(p) || hasDir(p);
    }),
    mkdir: guard('mkdir', (p, o) => {
      p = norm(p);
      // a sync client removing / moving things between a check and the mkdir: tests set this
      if (typeof api.onMkdir === 'function') api.onMkdir(p);
      if (typeof api.mkdirFails === 'function') {
        const why = api.mkdirFails(p);
        if (why) return Promise.reject(why);
      }
      if (files.has(p)) return Promise.reject('file exists: ' + p);
      if (!(o && o.recursive)) {
        if (dirs.has(p)) return Promise.reject('directory exists: ' + p);
        if (parent(p) && !hasDir(parent(p))) return missing(p);
      }
      dirs.add(p);
      log.push({ op: 'mkdir', path: p });
    }),
    rename: guard('rename', (a, b) => {
      a = norm(a); b = norm(b);
      // a sync client holding the path, a locked folder, …: tests set this
      if (typeof api.renameFails === 'function') {
        const why = api.renameFails(a, b);
        if (why) return Promise.reject(why);
      }
      if (!files.has(a) && hasDir(a)) {
        // a directory moves with everything below it (std::fs::rename)
        if (!hasDir(parent(b))) return missing(b);
        if (files.has(b) || (hasDir(b) && a.toLowerCase() !== b.toLowerCase())) return Promise.reject('rename: target exists: ' + b);
        const pre = a + '/';
        for (const f of [...files.keys()]) if (f.indexOf(pre) === 0) { files.set(b + f.slice(a.length), files.get(f)); files.delete(f); }
        for (const d of [...dirs]) if (d === a || d.indexOf(pre) === 0) { dirs.delete(d); dirs.add(b + d.slice(a.length)); }
        dirs.add(b);
        log.push({ op: 'rename', from: a, to: b, path: b, dir: true });
        return;
      }
      if (!files.has(a)) return missing(a);
      if (!hasDir(parent(b))) return missing(b);
      files.set(b, files.get(a));
      files.delete(a);
      log.push({ op: 'rename', from: a, to: b, path: b });
    }),
    remove: guard('remove', (p, o) => {
      p = norm(p);
      if (files.has(p)) { files.delete(p); log.push({ op: 'remove', path: p }); return; }
      if (o && o.recursive && hasDir(p)) {
        for (const f of [...files.keys()]) if (f.indexOf(p + '/') === 0) files.delete(f);
        for (const d of [...dirs]) if (d === p || d.indexOf(p + '/') === 0) dirs.delete(d);
        log.push({ op: 'remove', path: p, recursive: true });
        return;
      }
      if (dirs.has(p)) { dirs.delete(p); log.push({ op: 'remove', path: p }); return; }
      return missing(p);
    }),
    stat: guard('stat', (p) => {
      p = norm(p);
      if (files.has(p)) {
        const v = files.get(p);
        return { isFile: true, isDirectory: false, size: typeof v === 'string' ? Buffer.byteLength(v) : v.length, mtime: new Date() };
      }
      if (hasDir(p)) return { isFile: false, isDirectory: true, size: 0, mtime: new Date() };
      return missing(p);
    }),
    watch: guard('watch', (paths, cb, o) => {
      watchCb = cb; watchOpts = o || {};
      log.push({ op: 'watch', path: norm(Array.isArray(paths) ? paths[0] : paths), opts: watchOpts });
      return function unwatch() { if (watchCb === cb) watchCb = null; log.push({ op: 'unwatch' }); };
    }),
    unwatch: guard('unwatch', () => { watchCb = null; log.push({ op: 'unwatch' }); }),
  };

  const dialog = {
    open: (o) => Promise.resolve(typeof opts.dialogOpen === 'function' ? opts.dialogOpen(o) : null),
    save: (o) => Promise.resolve(typeof opts.dialogSave === 'function' ? opts.dialogSave(o) : null),
  };

  const win = {
    toggleMaximize: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
    minimize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    isFullscreen: () => Promise.resolve(false),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    onCloseRequested: (cb) => { closeCb = cb; return Promise.resolve(() => { closeCb = null; }); },
    destroy: () => { log.push({ op: 'destroy' }); return Promise.resolve(); },
    setTitle: () => Promise.resolve(),
  };

  const api = {
    fs, dialog, files, dirs, log, deny,
    renameFails: null, // (from, to) → error string to refuse that rename
    onExists: null,    // (path) → called before every fs.exists answers
    beforeWrite: null, // (path) → called before every writeTextFile lands
    mkdirFails: null,  // (path) → error string to refuse that mkdir (a read-only folder)
    onMkdir: null,     // (path) → called before every mkdir lands
    beforeRead: null,  // (path) → called before every readTextFile answers
    window: { getCurrentWindow: () => win },
    watching: () => !!watchCb,
    watchOpts: () => watchOpts,
    // move a folder as a sync client would (no watcher event of its own)
    moveDir(a, b) {
      a = norm(a); b = norm(b);
      for (const f of [...files.keys()]) if (f.indexOf(a + '/') === 0) { files.set(b + f.slice(a.length), files.get(f)); files.delete(f); }
      for (const d of [...dirs]) if (d === a || d.indexOf(a + '/') === 0) { dirs.delete(d); dirs.add(b + d.slice(a.length)); }
    },
    removeDir(a) {
      a = norm(a);
      for (const f of [...files.keys()]) if (f.indexOf(a + '/') === 0) files.delete(f);
      for (const d of [...dirs]) if (d === a || d.indexOf(a + '/') === 0) dirs.delete(d);
    },
    // plugin-shaped event: type is an object union, paths absolute
    emit(ev) {
      if (!watchCb) throw new Error('fake-tauri: no watcher registered');
      return watchCb(ev);
    },
    emitPaths(paths, kind) {
      const type = {}; type[kind || 'modify'] = { kind: 'data' };
      return this.emit({ type, paths: [].concat(paths), attrs: {} });
    },
    // simulate the user closing the window; resolves once the hook ran
    requestClose() {
      if (!closeCb) return Promise.resolve(false);
      const ev = { prevented: false, preventDefault() { this.prevented = true; } };
      closeCb(ev);
      return new Promise((res) => setTimeout(() => res(ev.prevented), 20));
    },
  };
  return api;
};

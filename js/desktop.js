/* Desktop (Tauri) integration. Loaded after app.js; a no-op in a plain
   browser. Gives real file semantics: Open/Save As via native dialogs, Save
   writes back to the current path, and the open file is watched so external
   edits (another machine via OneDrive, Excel, etc.) auto-reload. */
(function () {
  'use strict';
  if (!window.__TAURI__) return;

  var dialog = window.__TAURI__.dialog;
  var fs = window.__TAURI__.fs;

  var XLSX_FILTER = [{ name: 'Excel workbook', extensions: ['xlsx'] }];
  var currentPath = null;   // absolute path of the open document (null = unsaved)
  var unwatch = null;       // stops the active directory watcher
  var reloading = false;

  function app() { return window.HeadwayApp; }
  function basename(p) { return String(p).replace(/^.*[\\/]/, ''); }
  function dirname(p) {
    var m = String(p).match(/^(.*)[\\/][^\\/]+$/);
    return m ? m[1] : p;
  }
  function samePath(a, b) {
    // watcher events may use the other separator style on Windows
    return String(a).replace(/\\/g, '/') === String(b).replace(/\\/g, '/');
  }

  function markTitle() {
    document.title = currentPath
      ? basename(currentPath) + ' — Headway' : 'Headway — Roadmap Planner';
    var t = document.getElementById('docTitle');
    if (t) t.title = currentPath || '';
  }

  function setPath(p) {
    currentPath = p;
    markTitle();
    rewatch();
    if (p) app().noteRecent(p); // the start page's Recent list
  }

  // migrate the pre-start-page single last-path memory into the recents list
  (function () {
    try {
      var p = localStorage.getItem('headway-last-path');
      if (p) { app().noteRecent(p); localStorage.removeItem('headway-last-path'); }
    } catch (e) { /* storage optional */ }
  })();

  // Watch the parent directory, not the file: editors and sync clients
  // (OneDrive included) replace files by rename, which kills a file watch.
  function rewatch() {
    if (unwatch) { try { unwatch(); } catch (e) { /* already gone */ } unwatch = null; }
    if (!currentPath) return;
    fs.watch(dirname(currentPath), function (event) {
      var paths = (event && event.paths) || [];
      var hit = paths.some(function (p) { return samePath(p, currentPath); });
      // own writes are filtered by content (byte sig + embedded document
      // JSON, see below), never by timing
      // with auto-save off the document on screen is not what is on disk;
      // a reload would throw away the unsaved edits
      if (!hit || reloading || !app().autoSaveOn()) return;
      reloadFromDisk();
    }, { delayMs: 800 }).then(function (un) {
      unwatch = un;
    }).catch(function (err) {
      // plugin errors are plain strings, not Error objects
      app().toast('Could not watch for external changes: ' + (err && err.message || err), 'err');
    });
  }

  // fingerprint of the workbook bytes we last loaded or wrote — reloads are
  // applied (and announced) only when the content actually changed
  var lastSig = null;
  function sigOf(bytes) {
    var h = 2166136261;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h * 16777619) >>> 0;
    }
    return bytes.length + ':' + h.toString(16);
  }

  // The byte fingerprint alone cannot tell our own save from a remote edit:
  // sync clients (OneDrive/SharePoint especially) rewrite the xlsx container
  // after upload — injected sync metadata re-zips the file — so the bytes
  // change while the document does not. Track the embedded document JSON
  // (excel.js hides it in the _RoadmapTool sheet) beside the byte sig; a
  // changed file whose JSON still matches is an echo of our own write and is
  // adopted silently instead of announcing a reload.
  var lastStateJson = null;
  function noteLoadedBytes(bytes) {
    lastSig = sigOf(bytes);
    return window.RMExcel.readStateJson(bytes.buffer).then(function (json) {
      lastStateJson = json;
    }, function () {
      lastStateJson = null;
    });
  }

  // Sync clients (OneDrive especially) fire the change event before the new
  // bytes are fully on disk — an immediate read can return the old content
  // or a partial file. Retry with backoff until genuinely new bytes appear.
  var RELOAD_RETRY_MS = [1200, 3000, 8000];
  function reloadFromDisk(attempt) {
    attempt = attempt || 0;
    if (!app().autoSaveOn()) return;
    var p = currentPath;
    reloading = true;
    fs.readFile(p).then(function (bytes) {
      var validZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B; // xlsx = 'PK…'
      var sig = validZip ? sigOf(bytes) : null;
      if (!validZip || sig === lastSig) {
        reloading = false;
        if (attempt < RELOAD_RETRY_MS.length) {
          setTimeout(function () {
            if (currentPath === p && !reloading) reloadFromDisk(attempt + 1);
          }, RELOAD_RETRY_MS[attempt]);
        }
        return;
      }
      // new bytes — but is it a new DOCUMENT? A sync client's container
      // rewrite of our own save carries the same embedded JSON: adopt the
      // new bytes quietly and leave the editor alone.
      return window.RMExcel.readStateJson(bytes.buffer).catch(function () {
        return null;
      }).then(function (json) {
        if (json != null && lastStateJson != null && json === lastStateJson) {
          lastSig = sig;
          reloading = false;
          return;
        }
        return app().loadBuffer(bytes.buffer, basename(p), true /* reload in place */).then(function () {
          lastSig = sig;
          lastStateJson = json;
          app().toast('Reloaded “' + basename(p) + '” — changed on disk');
        }).finally(function () {
          reloading = false;
        });
      });
    }).catch(function (err) {
      reloading = false;
      app().toast('Auto-reload failed: ' + (err && err.message || err), 'err');
    });
  }

  window.HeadwayDesktop = {
    // native open dialog → load → remember + watch the path
    openDialog: function () {
      dialog.open({ multiple: false, filters: XLSX_FILTER }).then(function (p) {
        if (!p) return;
        fs.readFile(p).then(function (bytes) {
          return app().loadBuffer(bytes.buffer, basename(p)).then(function () {
            return noteLoadedBytes(bytes);
          });
        }).then(function () {
          setPath(p);
        }).catch(function (err) {
          app().toast('Could not open: ' + err.message, 'err');
        });
      });
    },

    // write the workbook; dialog only when there's no path yet (or Save As).
    // stateJson: the document JSON embedded in this blob (RMExcel.stateJsonOf)
    // — remembered so a sync client's rewrite of this save is not mistaken
    // for a remote change. Resolves to the saved path, or null on cancel.
    saveBlob: function (blob, suggestedName, forceDialog, stateJson) {
      var target = (currentPath && !forceDialog)
        ? Promise.resolve(currentPath)
        : dialog.save({ defaultPath: suggestedName, filters: XLSX_FILTER });
      return target.then(function (p) {
        if (!p) return null;
        if (!/\.xlsx$/i.test(p)) p += '.xlsx';
        return blob.arrayBuffer().then(function (buf) {
          var u8 = new Uint8Array(buf);
          lastSig = sigOf(u8);
          lastStateJson = stateJson != null ? stateJson : null;
          return fs.writeFile(p, u8);
        }).then(function () {
          if (!samePath(p, currentPath || '')) setPath(p);
          return p;
        });
      });
    },

    // file export (PNG, PPTX, …): ask where via the native dialog, write,
    // then OPEN the file
    saveFileAndOpen: function (blob, suggestedName, filterName, ext) {
      return dialog.save({
        defaultPath: suggestedName,
        filters: [{ name: filterName || 'File', extensions: [ext || 'png'] }]
      }).then(function (p) {
        if (!p) return null;
        if (!new RegExp('\\.' + (ext || 'png') + '$', 'i').test(p)) p += '.' + (ext || 'png');
        return blob.arrayBuffer().then(function (buf) {
          return fs.writeFile(p, new Uint8Array(buf));
        }).then(function () {
          var op = window.__TAURI__.opener;
          if (op && op.openPath) {
            // best-effort: the export succeeded even if opening doesn't
            return op.openPath(p).then(function () { return p; }, function () { return p; });
          }
          return p;
        });
      });
    },

    // a split export writes several files at once: pick a folder, write all
    saveManyToFolder: function (files) {
      return dialog.open({ directory: true, multiple: false }).then(function (dir) {
        if (!dir) return null;
        var chain = Promise.resolve();
        files.forEach(function (f) {
          chain = chain.then(function () {
            return f.blob.arrayBuffer().then(function (buf) {
              return fs.writeFile(dir + '/' + f.name, new Uint8Array(buf));
            });
          });
        });
        return chain.then(function () { return dir; });
      });
    },

    // open a known path (start page recents) — rejects if unreadable
    openPath: function (p) {
      return fs.readFile(p).then(function (bytes) {
        return app().loadBuffer(bytes.buffer, basename(p)).then(function () {
          return noteLoadedBytes(bytes);
        });
      }).then(function () {
        setPath(p);
        return p;
      });
    },

    // rename the open file in place (the title IS the filename). Resolves to
    // the new path; null with no open file; rejects if the target exists or
    // the filesystem refuses.
    renameTo: function (newBase) {
      if (!currentPath) return Promise.resolve(null);
      if (!/\.xlsx$/i.test(newBase)) newBase += '.xlsx';
      var np = dirname(currentPath) + '/' + newBase;
      if (samePath(np, currentPath)) return Promise.resolve(currentPath);
      return fs.exists(np).then(function (there) {
        if (there) throw new Error('“' + newBase + '” already exists in this folder');
        return fs.rename(currentPath, np);
      }).then(function () {
        setPath(np); // re-watches the directory and refreshes the recents list
        return np;
      });
    },

    currentPath: function () { return currentPath; },
    basename: basename,
    // Claude Code process bridge for the AI assistant's "Claude subscription"
    // provider (js/ai.js owns the stream-json protocol). One global event
    // listener fans stdout/stderr/exit lines out to the live handles by pid.
    claude: (function () {
      var invoke = window.__TAURI__.core.invoke;
      var handles = {};
      var listening = false;
      function ensureListener() {
        if (listening) return;
        listening = true;
        window.__TAURI__.event.listen('ai-proc', function (ev) {
          var p = ev.payload || {};
          var h = handles[p.id];
          if (!h) return;
          if (p.kind === 'exit') { delete handles[p.id]; h.alive = false; }
          try { h.onLine(p.kind, p.line); } catch (e) { /* handler error must not kill the pipe */ }
        });
      }
      return {
        // resolve the CLI binary (custom path wins); null when not installed
        path: function (custom) { return invoke('ai_claude_path', { custom: custom || '' }); },
        // spawn → handle { write(line), kill(), alive }
        spawn: function (bin, args, onLine) {
          ensureListener();
          return invoke('ai_spawn', { bin: bin, args: args }).then(function (id) {
            var h = { id: id, alive: true, onLine: onLine,
              write: function (line) { return invoke('ai_write', { id: id, line: line }); },
              kill: function () { h.alive = false; delete handles[id]; return invoke('ai_kill', { id: id }); } };
            handles[id] = h;
            return h;
          });
        }
      };
    })(),
    appVersion: '' // filled asynchronously below
  };

  // app version (start page footer)
  if (window.__TAURI__.app && window.__TAURI__.app.getVersion) {
    window.__TAURI__.app.getVersion().then(function (v) {
      window.HeadwayDesktop.appVersion = v || '';
      // refresh the footer if the start page is already showing
      if (document.body.classList.contains('start') && app() && app().renderStartPage) {
        app().renderStartPage();
      }
      // first launch on a new version → "What's new" (once per version)
      if (app() && app().maybeShowReleaseNotes) app().maybeShowReleaseNotes();
    }).catch(function () { /* fine without it */ });
  }

  // ------------------------------------------------------ close guard
  // Closing the window (caption ✕, Alt+F4, the red traffic light) with
  // unsaved work asks first — app.js owns the Save / Don't save / Cancel
  // dialog, and flushes silently when autosave already owns the file.
  // destroy() tears the window down without another close-requested event,
  // so an approved close cannot re-prompt.
  window.__TAURI__.window.getCurrentWindow().onCloseRequested(function (ev) {
    var a = app();
    if (!a || !a.unsavedNow || !a.unsavedNow()) return;
    ev.preventDefault();
    a.guardUnsaved(function () {
      window.__TAURI__.window.getCurrentWindow().destroy();
    });
  });

  // ------------------------------------------------------- window chrome
  // The header doubles as the titlebar. macOS: native titlebar hidden with
  // overlay traffic lights (see tauri.macos.conf.json) — the header gets
  // left padding to clear them. Windows: frameless window with Windows 11
  // style caption buttons on the right. Empty header space drags the window
  // (and double-click zooms/maximizes, per each platform's convention).
  (function chrome() {
    var isMac = navigator.platform.indexOf('Mac') === 0;
    var topbar = document.getElementById('topbar');
    if (!topbar) return;

    // dragging works from header background and passive elements (brand
    // mark, gaps around the view tabs) — never from actual controls
    Array.prototype.forEach.call(
      document.querySelectorAll('#topbar, .tb-brand, .tb-mark, .tb-mark span'),
      function (el) { el.setAttribute('data-tauri-drag-region', ''); }
    );
    document.body.classList.add(isMac ? 'chrome-mac' : 'chrome-win');

    // explicit drag handler — the built-in data-tauri-drag-region listener
    // has proven unreliable here, so start the drag ourselves. Document-level
    // so the start page's bar drags too.
    var win = window.__TAURI__.window.getCurrentWindow();
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (!t.hasAttribute || !t.hasAttribute('data-tauri-drag-region')) return;
      e.preventDefault();
      if (e.detail >= 2) win.toggleMaximize();
      else win.startDragging();
    });

    // macOS native fullscreen hides the traffic lights — body.fullscreen
    // lets the CSS reclaim their header inset
    function syncFullscreen() {
      win.isFullscreen().then(function (fs) {
        document.body.classList.toggle('fullscreen', fs);
      }).catch(function () { /* window gone */ });
    }
    win.onResized(syncFullscreen);
    syncFullscreen();
    if (isMac) return;

    // Windows caption buttons — one set in the editor header, one on the
    // start page bar (whichever surface is visible carries them)
    var GLYPH = {
      min: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5h10" stroke="currentColor" fill="none"/></svg>',
      max: '<svg viewBox="0 0 10 10" width="10" height="10"><rect x=".5" y=".5" width="9" height="9" stroke="currentColor" fill="none"/></svg>',
      restore: '<svg viewBox="0 0 10 10" width="10" height="10"><rect x=".5" y="2.5" width="7" height="7" stroke="currentColor" fill="none"/><path d="M2.5 2.5v-2h7v7h-2" stroke="currentColor" fill="none"/></svg>',
      close: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" fill="none"/></svg>'
    };
    var bars = [];
    function makeCaptionBar(host) {
      if (!host) return;
      var bar = document.createElement('div');
      bar.className = 'win-caption';
      bar.innerHTML =
        '<button class="cap-min" title="Minimize" aria-label="Minimize">' + GLYPH.min + '</button>' +
        '<button class="cap-max" title="Maximize" aria-label="Maximize">' + GLYPH.max + '</button>' +
        '<button class="cap-close" title="Close" aria-label="Close">' + GLYPH.close + '</button>';
      bar.querySelector('.cap-min').addEventListener('click', function () { win.minimize(); });
      bar.querySelector('.cap-max').addEventListener('click', function () {
        win.toggleMaximize().then(syncMaxGlyph);
      });
      bar.querySelector('.cap-close').addEventListener('click', function () { win.close(); });
      host.appendChild(bar);
      bars.push(bar);
    }
    makeCaptionBar(topbar);
    makeCaptionBar(document.getElementById('startBar'));

    function syncMaxGlyph() {
      win.isMaximized().then(function (max) {
        bars.forEach(function (bar) {
          var b = bar.querySelector('.cap-max');
          b.innerHTML = max ? GLYPH.restore : GLYPH.max;
          b.title = max ? 'Restore' : 'Maximize';
          b.setAttribute('aria-label', b.title);
        });
      });
    }
    win.onResized(syncMaxGlyph);
    syncMaxGlyph();
  })();

  // ------------------------------------------------------- macOS menu bar
  // Mirror the in-app File / Edit / View menus into the system menu bar and
  // hide the in-window menu buttons. Rebuilt (debounced, only when the spec
  // actually changes) so checkmarks and enabled states follow the app state.
  (function nativeMenu() {
    var menu = window.__TAURI__.menu;
    var isMac = navigator.platform.indexOf('Mac') === 0;
    if (!isMac || !menu) return;

    var menusNav = document.getElementById('menus');
    if (menusNav) menusNav.style.display = 'none';

    function accel(kbd) {
      if (!kbd || /scroll/.test(kbd)) return undefined;
      var mods = [];
      if (kbd.indexOf('⇧') >= 0) mods.push('Shift');
      if (kbd.indexOf('⌥') >= 0) mods.push('Alt');
      if (kbd.indexOf('⌘') >= 0) mods.push('CmdOrCtrl');
      var key = kbd.replace(/[⇧⌥⌘]/g, '');
      return key ? mods.concat(key.toUpperCase()).join('+') : undefined;
    }

    function fireItem(m) {
      // ⌘Z in a text field should stay the field's own undo, not the app's
      if (m.label === 'Undo' || m.label === 'Redo') {
        var ae = document.activeElement;
        if (ae && (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable)) {
          document.execCommand(m.label.toLowerCase());
          return;
        }
      }
      m.fn();
    }

    // NativeIcon names that AppKit exposes as *Template images (see muda's
    // macOS NativeIcon → NSImageName table); everything else is a coloured
    // pictogram (Folder, Info, MultipleDocuments, User, Trash…).
    var TEMPLATE_ICONS = {};
    ['Add', 'Remove', 'Share', 'Refresh', 'RefreshFreestanding', 'StopProgress',
      'StopProgressFreestanding', 'FollowLinkFreestanding', 'RevealFreestanding',
      'InvalidDataFreestanding', 'GoLeft', 'GoRight', 'LeftFacingTriangle',
      'RightFacingTriangle', 'Home', 'Bookmarks', 'Bluetooth', 'ColumnView',
      'FlowView', 'IconView', 'ListView', 'EnterFullScreen', 'ExitFullScreen',
      'IChatTheater', 'LockLocked', 'LockUnlocked', 'MenuMixedState',
      'MenuOnState', 'Path', 'QuickLook', 'Slideshow', 'SmartBadge'
    ].forEach(function (n) { TEMPLATE_ICONS[n] = true; });

    function toNative(items) {
      return Promise.all(items.map(function (m) {
        if (m.sep) return menu.PredefinedMenuItem.new({ item: 'Separator' });
        var opts = {
          text: m.label,
          enabled: !m.disabled,
          accelerator: accel(m.kbd),
          action: function () { fireItem(m); }
        };
        if ('checked' in m) {
          return menu.CheckMenuItem.new(Object.assign({ checked: !!m.checked }, opts));
        }
        // macOS template icons where the app names one; plain item otherwise.
        // Only template images (monochrome, tinted by the menu) are allowed —
        // the other NativeIcon names are full-colour pictograms that clash.
        if (m.nativeIcon && TEMPLATE_ICONS[m.nativeIcon] && menu.IconMenuItem && menu.NativeIcon && menu.NativeIcon[m.nativeIcon]) {
          return menu.IconMenuItem.new(Object.assign({ icon: menu.NativeIcon[m.nativeIcon] }, opts))
            .catch(function () { return menu.MenuItem.new(opts); });
        }
        return menu.MenuItem.new(opts);
      }));
    }

    function predefined(names) {
      return Promise.all(names.map(function (n) {
        return menu.PredefinedMenuItem.new({ item: n });
      }));
    }

    // app Edit menu + the system clipboard block (without it, ⌘C/⌘V would
    // stop working in the webview once the default menu is replaced)
    function buildEdit(items) {
      var cut = items.findIndex(function (m) { return m.sep; });
      return Promise.all([
        toNative(items.slice(0, cut)),
        predefined(['Separator', 'Cut', 'Copy', 'Paste', 'SelectAll']),
        toNative(items.slice(cut))
      ]).then(function (parts) {
        return menu.Submenu.new({ text: 'Edit', items: parts[0].concat(parts[1], parts[2]) });
      });
    }

    function buildMenu() {
      var M = window.HeadwayApp.menuItems;
      return Promise.all([
        // the app menu carries the file actions (New/Open/Save/Export/Help),
        // then the standard Hide/Quit block — there is no File submenu on mac
        Promise.all([
          toNative(M('macApp')),
          predefined(['Separator', 'Hide', 'HideOthers', 'ShowAll', 'Separator', 'Quit'])
        ]).then(function (parts) {
          return menu.Submenu.new({ text: 'Headway', items: parts[0].concat(parts[1]) });
        }),
        buildEdit(M('edit')),
        toNative(M('view')).then(function (items) {
          return menu.Submenu.new({ text: 'View', items: items });
        }),
        predefined(['Minimize', 'Maximize', 'Fullscreen', 'Separator', 'CloseWindow']).then(function (items) {
          return menu.Submenu.new({ text: 'Window', items: items });
        })
      ]).then(function (subs) {
        return menu.Menu.new({ items: subs });
      }).then(function (m) {
        return m.setAsAppMenu();
      });
    }

    var sig = '', building = false, dirty = false, timer = null;
    function specSig() {
      var M = window.HeadwayApp.menuItems;
      return JSON.stringify(['macApp', 'edit', 'view'].map(function (n) {
        return M(n).map(function (m) {
          return m.sep ? '-' : [m.label, !!m.disabled, !!m.checked, m.kbd || ''];
        });
      }));
    }
    function syncNow() {
      var s;
      try { s = specSig(); } catch (e) { return; }
      if (s === sig) return;
      if (building) { dirty = true; return; }
      sig = s; building = true;
      buildMenu().catch(function (err) {
        console.warn('menu build failed', err);
        sig = ''; // retry on the next sync
      }).finally(function () {
        building = false;
        if (dirty) { dirty = false; syncNow(); }
      });
    }

    window.HeadwayDesktop.syncMenu = function () {
      clearTimeout(timer);
      timer = setTimeout(syncNow, 200);
    };
    window.HeadwayDesktop.syncMenu();
  })();

  // ------------------------------------------------------- auto-update
  // One updater shared by the header's flashing Update button and the start
  // page's Check-for-updates button. Checks 4s after launch and then every
  // hour; a found update downloads in the background and the buttons flip to
  // "Update to x.y.z". Clicking installs and relaunches.
  (function autoUpdate() {
    var up = window.__TAURI__.updater;
    var proc = window.__TAURI__.process;
    if (!up || !proc) return;

    var CHECK_EVERY = 60 * 60 * 1000;
    var U = {
      state: 'idle',   // idle | checking | downloading | ready | installing
      version: '',     // the downloaded update's version (state ready/installing)
      error: '',       // last manual-check failure, for the start page
      checkedAt: 0,
      update: null,
      listeners: []
    };
    function set(patch) {
      Object.keys(patch).forEach(function (k) { U[k] = patch[k]; });
      U.listeners.forEach(function (fn) { try { fn(U); } catch (e) { /* listener */ } });
      // the start page renders the updater's state into its button
      if (document.body.classList.contains('start') && app() && app().renderStartPage) app().renderStartPage();
    }
    U.onChange = function (fn) { U.listeners.push(fn); };

    // manual: surface "up to date" / failures; automatic: silent
    U.check = function (manual) {
      if (U.state === 'ready' || U.state === 'installing') return Promise.resolve(U.update);
      if (U.state === 'checking' || U.state === 'downloading') return Promise.resolve(null);
      set({ state: 'checking', error: '' });
      return up.check().then(function (update) {
        if (!update) {
          set({ state: 'idle', checkedAt: Date.now() });
          if (manual && app()) app().toast('Headway ' + (window.HeadwayDesktop.appVersion || '') + ' is up to date');
          return null;
        }
        set({ state: 'downloading', version: update.version, checkedAt: Date.now() });
        return update.download().then(function () {
          set({ state: 'ready', update: update });
          showHeaderButton();
          return update;
        });
      }).catch(function (err) {
        // offline, dev build, or no release yet — silent unless asked for
        var msg = (err && err.message) || String(err || 'unknown error');
        set({ state: 'idle', error: manual ? msg : '' });
        if (manual && app()) app().toast('Could not check for updates — ' + msg, 'err');
        return null;
      });
    };

    U.install = function () {
      if (U.state !== 'ready' || !U.update) return Promise.resolve();
      set({ state: 'installing' });
      return U.update.install().then(function () {
        return proc.relaunch(); // NSIS on Windows exits/relaunches itself
      }).catch(function (err) {
        set({ state: 'ready' });
        if (app()) app().toast('Update failed: ' + (err && err.message || err), 'err');
      });
    };

    function showHeaderButton() {
      if (document.getElementById('btnUpdate')) return;
      var right = document.querySelector('.tb-right');
      if (!right) return;
      var b = document.createElement('button');
      b.id = 'btnUpdate';
      b.title = 'Version ' + U.version + ' downloaded';
      b.innerHTML = '<i data-lucide="refresh-cw"></i>Update';
      b.addEventListener('click', function () { U.install(); });
      U.onChange(function (u) {
        b.disabled = u.state === 'installing';
        b.innerHTML = u.state === 'installing' ? 'Updating…' : '<i data-lucide="refresh-cw"></i>Update';
        if (window.lucide) lucide.createIcons();
      });
      right.insertBefore(b, right.firstChild);
      if (window.lucide) lucide.createIcons();
    }

    window.HeadwayDesktop.updater = U;
    setTimeout(function () { U.check(false); }, 4000);
    setInterval(function () { U.check(false); }, CHECK_EVERY);
  })();
})();

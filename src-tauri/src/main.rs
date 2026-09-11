#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Re-applies the traffic-light placement from tauri.macos.conf.json
/// (trafficLightPosition) — macOS resets the buttons to their default spot
/// (or hides them) when the window loses focus, resizes, or changes theme,
/// so the same geometry is applied again on those events.
#[cfg(target_os = "macos")]
mod traffic {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect};

    // keep in sync with trafficLightPosition in tauri.macos.conf.json
    const X: f64 = 16.0;
    const Y: f64 = 24.0;

    pub fn apply(ns_window: *mut std::ffi::c_void) {
        unsafe {
            let win = ns_window as *mut AnyObject;
            let close: *mut AnyObject = msg_send![win, standardWindowButton: 0u64];
            let mini: *mut AnyObject = msg_send![win, standardWindowButton: 1u64];
            let zoom: *mut AnyObject = msg_send![win, standardWindowButton: 2u64];
            if close.is_null() || mini.is_null() || zoom.is_null() {
                return;
            }
            let titlebar: *mut AnyObject = msg_send![close, superview];
            if titlebar.is_null() {
                return;
            }
            let container: *mut AnyObject = msg_send![titlebar, superview];
            if container.is_null() {
                return;
            }
            let frame_view: *mut AnyObject = msg_send![container, superview];
            if frame_view.is_null() {
                return;
            }

            // same math as tao's inset handling: grow the titlebar container
            // downward, buttons keep their offset within it
            let close_rect: NSRect = msg_send![close, frame];
            let container_h = close_rect.size.height + Y;
            let frame_rect: NSRect = msg_send![frame_view, frame];
            let mut c_rect: NSRect = msg_send![container, frame];
            c_rect.size.height = container_h;
            c_rect.origin.y = frame_rect.size.height - container_h;
            let _: () = msg_send![container, setFrame: c_rect];

            let mini_rect: NSRect = msg_send![mini, frame];
            let spacing = mini_rect.origin.x - close_rect.origin.x;
            for (i, b) in [close, mini, zoom].into_iter().enumerate() {
                let r: NSRect = msg_send![b, frame];
                let o = NSPoint {
                    x: X + spacing * i as f64,
                    y: r.origin.y,
                };
                let _: () = msg_send![b, setFrameOrigin: o];
                let _: () = msg_send![b, setHidden: false];
            }
        }
    }
}


/// AI assistant ↔ Claude Code bridge. The "Claude subscription" provider runs
/// `claude -p` (headless Claude Code, billed to the user's Claude plan) as a
/// child process speaking stream-json on stdin/stdout; the webview owns the
/// protocol, this module only spawns, pipes lines and kills.
mod ai {
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager, State};

    #[derive(Default)]
    pub struct Procs(pub Mutex<HashMap<u32, (Child, ChildStdin)>>);

    #[derive(Clone, serde::Serialize)]
    struct Line {
        id: u32,
        kind: &'static str,
        line: String,
    }

    fn home() -> String {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default()
    }

    fn login_shell_lookup() -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            let out = Command::new("where").arg("claude").output().ok()?;
            let s = String::from_utf8_lossy(&out.stdout);
            // `where` lists every PATH hit; with nvm-for-windows the first is the
            // extensionless Unix shim, which CreateProcess cannot run (error 193).
            // Prefer a real executable, then a batch wrapper, never a bare script.
            fn rank(p: &str) -> u8 {
                let l = p.to_ascii_lowercase();
                if l.ends_with(".exe") { 0 } else if l.ends_with(".cmd") || l.ends_with(".bat") { 1 } else { 9 }
            }
            return s
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && rank(l) < 9)
                .min_by_key(|l| rank(l))
                .map(String::from);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let out = Command::new(shell)
                .args(["-lc", "command -v claude"])
                .output()
                .ok()?;
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from)
        }
    }

    /// Locate the Claude Code CLI: an explicit path first, then the usual
    /// install spots, then whatever the user's login shell resolves (GUI apps
    /// start with a bare PATH).
    #[tauri::command]
    pub fn ai_claude_path(custom: String) -> Option<String> {
        let c = custom.trim();
        if !c.is_empty() {
            #[cfg(target_os = "windows")]
            {
                // a saved path to the npm shell shim (no extension): use the
                // runnable sibling that npm installs beside it
                if std::path::Path::new(c).extension().is_none() {
                    for ext in ["exe", "cmd", "bat"] {
                        let alt = format!("{c}.{ext}");
                        if std::path::Path::new(&alt).is_file() {
                            return Some(alt);
                        }
                    }
                }
            }
            return if std::path::Path::new(c).is_file() { Some(c.to_string()) } else { None };
        }
        let h = home();
        let mut candidates = vec![
            format!("{h}/.local/bin/claude"),
            format!("{h}/.claude/local/claude"),
            "/opt/homebrew/bin/claude".to_string(),
            "/usr/local/bin/claude".to_string(),
        ];
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(format!("{appdata}\\npm\\claude.cmd"));
        }
        // nvm-for-windows links the active node (and its npm bins) here
        if let Ok(sym) = std::env::var("NVM_SYMLINK") {
            candidates.push(format!("{sym}\\claude.cmd"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!("{local}\\Programs\\claude\\claude.exe"));
        }
        for p in candidates {
            if std::path::Path::new(&p).is_file() {
                return Some(p);
            }
        }
        login_shell_lookup()
    }

    #[tauri::command]
    pub fn ai_spawn(app: AppHandle, procs: State<Procs>, bin: String, args: Vec<String>) -> Result<u32, String> {
        let mut cmd = Command::new(&bin);
        cmd.args(&args)
            .current_dir(home())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("could not start {bin}: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let id = child.id();
        procs.0.lock().map_err(|e| e.to_string())?.insert(id, (child, stdin));

        let app_out = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app_out.emit("ai-proc", Line { id, kind: "out", line });
            }
            // stdout closed: the process is done — reap it and tell the page
            if let Some(procs) = app_out.try_state::<Procs>() {
                if let Ok(mut m) = procs.0.lock() {
                    if let Some((mut child, _)) = m.remove(&id) {
                        let _ = child.wait();
                    }
                }
            }
            let _ = app_out.emit("ai-proc", Line { id, kind: "exit", line: String::new() });
        });
        let app_err = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app_err.emit("ai-proc", Line { id, kind: "err", line });
            }
        });
        Ok(id)
    }

    #[tauri::command]
    pub fn ai_write(procs: State<Procs>, id: u32, line: String) -> Result<(), String> {
        let mut m = procs.0.lock().map_err(|e| e.to_string())?;
        let (_, stdin) = m.get_mut(&id).ok_or("process is gone")?;
        stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn ai_kill(procs: State<Procs>, id: u32) -> Result<(), String> {
        let mut m = procs.0.lock().map_err(|e| e.to_string())?;
        if let Some((mut child, stdin)) = m.remove(&id) {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ai::Procs::default())
        .invoke_handler(tauri::generate_handler![ai::ai_claude_path, ai::ai_spawn, ai::ai_write, ai::ai_kill])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            {
                use tauri::WindowEvent;
                if matches!(
                    _event,
                    WindowEvent::Focused(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::ThemeChanged(_)
                ) {
                    if let Ok(ns) = _window.ns_window() {
                        traffic::apply(ns);
                    }
                    // AppKit re-lays the titlebar out again *after* this event
                    // on focus changes (which is what hid the buttons on
                    // blur), so re-apply once its pass has finished too
                    for delay_ms in [50u64, 250, 600] {
                        let w = _window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            let w2 = w.clone();
                            let _ = w.run_on_main_thread(move || {
                                if let Ok(ns) = w2.ns_window() {
                                    traffic::apply(ns);
                                }
                            });
                        });
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Headway");
}

// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Manager,
};

// ── State ──────────────────────────────────────────────────────────────────

struct BackendProcess(Mutex<Option<Child>>);
struct BackendPort(u16);

// ── Backend lifecycle ───────────────────────────────────────────────────────

/// Bind to port 0 and immediately release the socket to learn a free port.
/// There is a small TOCTOU window, but it is acceptable for a desktop app.
fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind ephemeral port")
        .local_addr()
        .expect("failed to read local addr")
        .port()
}

/// Spawn the FastAPI backend via uvicorn.
///
/// In development: set KURAL_BACKEND_DIR to the `backend/` directory.
/// In a bundled release: the backend directory is expected next to the executable.
fn start_backend(port: u16, resource_dir: Option<PathBuf>) -> std::io::Result<Child> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = std::env::var("KURAL_BACKEND_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("backend"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("backend"));
        }
    }
    candidates.push(PathBuf::from("../../backend"));
    candidates.push(PathBuf::from("../backend"));
    candidates.push(PathBuf::from("backend"));

    let backend_dir = candidates
        .into_iter()
        .find(|path| path.join("app").join("main.py").exists())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not find bundled backend/app/main.py. Set KURAL_BACKEND_DIR.",
            )
        })?;

    let python = std::env::var("KURAL_PYTHON").unwrap_or_else(|_| {
        if cfg!(windows) {
            "python".to_string()
        } else {
            "python3".to_string()
        }
    });

    Command::new(python)
        .args([
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(&backend_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn escape_js_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn kill_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

// ── Tauri command ──────────────────────────────────────────────────────────

/// Returns the backend base URL so the webview can use it via Tauri IPC.
/// The URL is also injected via initialization_script, so this is a fallback.
#[tauri::command]
fn get_backend_url(port: tauri::State<BackendPort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}

// ── Menu ───────────────────────────────────────────────────────────────────

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // File menu
    let quit = PredefinedMenuItem::quit(app, Some("Quit Kural"))?;
    let file = Submenu::with_items(app, "File", true, &[&quit])?;

    // Edit menu
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit = Submenu::with_items(app, "Edit", true, &[&cut, &copy, &paste, &sep, &select_all])?;

    // Help menu
    let about = PredefinedMenuItem::about(app, None, None)?;
    let help = Submenu::with_items(app, "Help", true, &[&about])?;

    Menu::with_items(app, &[&file, &edit, &help])
}

// ── System tray ────────────────────────────────────────────────────────────

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open Kural", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &sep, &quit_item])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                kill_backend(app);
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

// ── Entry point ────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let port = find_free_port();
            let resource_dir = app.path().resource_dir().ok();

            let (child_opt, backend_error) = match start_backend(port, resource_dir) {
                Ok(child) => (Some(child), None),
                Err(e) => {
                    eprintln!("kural: backend start failed: {e}");
                    (None, Some(e.to_string()))
                }
            };
            app.manage(BackendProcess(Mutex::new(child_opt)));
            app.manage(BackendPort(port));

            // App menu (macOS menu bar; also used on Linux/Windows)
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            // System tray
            build_tray(app.handle())?;

            // Main window — port is injected before any page JS runs
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .initialization_script(&format!(
                "window.__KURAL_API_URL__ = 'http://127.0.0.1:{port}'; window.__KURAL_BACKEND_ERROR__ = '{}';",
                backend_error
                    .as_deref()
                    .map(escape_js_string)
                    .unwrap_or_default()
            ))
            .title("Kural TTS")
            .inner_size(1100.0, 700.0)
            .resizable(true)
            .build()?;

            // Hide to tray on close instead of quitting
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = win_clone.hide();
                    api.prevent_close();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .run(tauri::generate_context!())
        .expect("error while running kural");
}

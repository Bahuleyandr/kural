// Prevents a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs,
    io::Write,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Accelerator for the dictation widget. Mirrors OmniVoice's Cmd/Ctrl+Shift+Space.
const DICTATION_SHORTCUT: &str = "CommandOrControl+Shift+Space";

// ── State ──────────────────────────────────────────────────────────────────

struct BackendProcess(Mutex<Option<Child>>);
struct BackendPort(u16);
struct BackendApiKey(String);
struct BackendStartupError(Mutex<Option<String>>);
struct RuntimePaths {
    app_data_dir: Option<PathBuf>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDiagnostics {
    backend_url: String,
    api_key_present: bool,
    backend_running: bool,
    backend_error: Option<String>,
    app_data_dir: Option<String>,
    audio_library_dir: Option<String>,
    project_vault_dir: Option<String>,
    logs_dir: Option<String>,
}

// ── API key (per-install shared secret) ─────────────────────────────────────

/// Ensure a per-install API key exists at `<app_data_dir>/api_key`. Generates
/// a fresh 32-byte hex string on first launch. The same key is injected into
/// the webview as `window.__KURAL_API_KEY__` and exported to the backend as
/// `KURAL_API_KEY` so every /api/* request from the page carries it.
///
/// Localhost binding already keeps the API off the network, but a per-install
/// key adds defense-in-depth against other local processes that find the
/// ephemeral port.
fn ensure_api_key(app_data_dir: &Path) -> std::io::Result<String> {
    fs::create_dir_all(app_data_dir)?;
    let key_path = app_data_dir.join("api_key");
    if let Ok(existing) = fs::read_to_string(&key_path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return Ok(trimmed.to_string());
        }
    }
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::Other, format!("getrandom failed: {e}"))
    })?;
    let key: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let mut file = fs::File::create(&key_path)?;
    file.write_all(key.as_bytes())?;
    Ok(key)
}

// ── First-run model provisioning ────────────────────────────────────────────

/// If the bundled Kokoro model files are missing from `model_dir`, run the
/// backend's `download_models.py` to fetch them. Returns Ok with no work done
/// when models are already present. Errors propagate to the caller, which
/// surfaces them via `__KURAL_BACKEND_ERROR__` so the frontend can show a
/// setup banner instead of a blank "backend not reachable" message.
fn ensure_kokoro_models(backend_dir: &Path, model_dir: &Path, python: &str) -> std::io::Result<()> {
    if kokoro_models_present(model_dir) {
        return Ok(());
    }

    fs::create_dir_all(model_dir)?;
    let script = backend_dir.join("scripts").join("download_models.py");
    if !script.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("download_models.py not found at {}", script.display()),
        ));
    }

    let status = Command::new(python)
        .arg(&script)
        .current_dir(backend_dir)
        .env("MODEL_CACHE_DIR", model_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;

    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("download_models.py exited with {status}"),
        ));
    }
    Ok(())
}

// ── Backend lifecycle ───────────────────────────────────────────────────────

/// Bind to port 0 and immediately release the socket to learn a free port.
/// There is a small TOCTOU window, but it is acceptable for a desktop app.
/// Returns an error instead of panicking so a bind failure can be surfaced in
/// the UI rather than crashing the process with no window.
fn find_free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn kokoro_models_present(dir: &Path) -> bool {
    dir.join("kokoro-v1.0.int8.onnx").exists() && dir.join("voices-v1.0.bin").exists()
}

/// Spawn the FastAPI backend via uvicorn.
///
/// In development: set KURAL_BACKEND_DIR to the `backend/` directory.
/// In a bundled release: the backend directory is expected next to the executable.
fn start_backend(
    port: u16,
    api_key: &str,
    resource_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
) -> std::io::Result<Child> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let resource_dir_for_python = resource_dir.clone();
    let resource_dir_for_models = resource_dir.clone();

    if let Ok(dir) = env::var("KURAL_BACKEND_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("backend"));
    }
    if let Ok(exe) = env::current_exe() {
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

    let explicit_python = env::var("KURAL_PYTHON").ok();
    let mut python_candidates: Vec<String> = Vec::new();
    if let Some(dir) = resource_dir_for_python {
        // python-build-standalone layout (relocatable; the release bundle).
        python_candidates.push(dir.join("python").join("python.exe").display().to_string());
        python_candidates.push(
            dir.join("python").join("bin").join("python3").display().to_string(),
        );
        // Legacy venv layout, kept as a fallback for older bundles.
        python_candidates.push(
            dir.join("python").join("Scripts").join("python.exe").display().to_string(),
        );
        python_candidates.push(
            dir.join("python").join("bin").join("python").display().to_string(),
        );
    }
    python_candidates.push(
        backend_dir.join(".venv").join("Scripts").join("python.exe").display().to_string(),
    );
    python_candidates.push(
        backend_dir.join(".venv").join("bin").join("python").display().to_string(),
    );
    // The bare-PATH fallback is DEV ONLY. A release build must use the bundled
    // runtime or an explicit KURAL_PYTHON — never a random interpreter on the
    // user's PATH, which could be the wrong version or missing Kural's deps.
    #[cfg(debug_assertions)]
    python_candidates.push(if cfg!(windows) {
        "python".to_string()
    } else {
        "python3".to_string()
    });

    let python = if let Some(python) = explicit_python {
        python
    } else {
        python_candidates
            .into_iter()
            .find(|candidate| {
                candidate == "python" || candidate == "python3" || PathBuf::from(candidate).exists()
            })
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not find the bundled Python runtime. Set KURAL_PYTHON or bundle desktop/runtime/python.",
                )
            })?
    };

    // Resolve Kokoro models: prefer an already-provisioned per-user copy, then
    // the read-only models bundled in the installer, and only fall back to a
    // network download when neither is present. (Previously the bundled copy
    // was ignored, so every first run re-downloaded ~88 MB.)
    let app_kokoro = app_data_dir.as_ref().map(|d| d.join("models").join("kokoro"));
    let bundled_kokoro = resource_dir_for_models
        .as_ref()
        .map(|d| d.join("models").join("kokoro"));

    let resolved_kokoro: Option<PathBuf> = if let Some(ref d) = app_kokoro {
        if kokoro_models_present(d) {
            Some(d.clone())
        } else if bundled_kokoro.as_deref().is_some_and(kokoro_models_present) {
            bundled_kokoro.clone()
        } else {
            // Nothing cached or bundled — download into the per-user dir. The
            // downloader self-limits (KURAL_DOWNLOAD_TIMEOUT_S) so a stalled
            // mirror can no longer hang startup forever.
            if let Err(err) = ensure_kokoro_models(&backend_dir, d, &python) {
                eprintln!("kural: model provisioning failed: {err}");
            }
            kokoro_models_present(d).then(|| d.clone())
        }
    } else if bundled_kokoro.as_deref().is_some_and(kokoro_models_present) {
        bundled_kokoro.clone()
    } else {
        None
    };

    let mut command = Command::new(&python);
    command
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
        .env("KURAL_API_KEY", api_key)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(ref dir) = resolved_kokoro {
        command.env("MODEL_CACHE_DIR", dir);
    }

    if let Some(dir) = resource_dir_for_models {
        let faster_whisper_dir = dir.join("models").join("asr").join("faster-whisper-tiny");
        if faster_whisper_dir.exists() {
            command.env("FASTER_WHISPER_MODEL_DIR", faster_whisper_dir);
        }

        let argos_dir = dir
            .join("models")
            .join("translation")
            .join("argos")
            .join("packages");
        if argos_dir.exists() {
            command.env("ARGOS_PACKAGES_DIR", &argos_dir);
            command.env("ARGOS_PACKAGE_DIR", argos_dir);
        }
    }

    if let Some(dir) = app_data_dir {
        let _ = std::fs::create_dir_all(&dir);
        let clones_dir = dir.join("clones");
        let hf_dir = dir.join("huggingface-cache");
        let _ = std::fs::create_dir_all(&clones_dir);
        let _ = std::fs::create_dir_all(&hf_dir);
        command.env("CLONE_CACHE_DIR", clones_dir);
        command.env("HF_HOME", hf_dir);
    }

    command.spawn()
}

fn wait_for_backend(port: u16, child: &mut Child, timeout: Duration) -> std::io::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Backend exited before startup completed: {status}"),
            ));
        }
        if Instant::now() >= deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Backend did not open its local port within 15 seconds.",
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
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

// ── Dictation widget ────────────────────────────────────────────────────────

/// Toggle the frameless dictation widget. The global shortcut and the tray
/// both route here. Hidden by default; the window itself is created once at
/// startup so toggling is just show/hide (cheap, preserves widget state).
fn toggle_dictation_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("dictation") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
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

/// Returns the per-install API key. Survives page reloads — the
/// initialization_script only runs on first load, so the frontend can call
/// this command to re-hydrate `window.__KURAL_API_KEY__` if needed.
#[tauri::command]
fn get_api_key(key: tauri::State<BackendApiKey>) -> String {
    key.0.clone()
}

#[tauri::command]
fn get_runtime_diagnostics(
    process: tauri::State<BackendProcess>,
    port: tauri::State<BackendPort>,
    key: tauri::State<BackendApiKey>,
    startup_error: tauri::State<BackendStartupError>,
    paths: tauri::State<RuntimePaths>,
) -> RuntimeDiagnostics {
    let backend_running = process
        .0
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);
    let backend_error = startup_error
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    RuntimeDiagnostics {
        backend_url: format!("http://127.0.0.1:{}", port.0),
        api_key_present: !key.0.is_empty(),
        backend_running,
        backend_error,
        app_data_dir: paths
            .app_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        audio_library_dir: default_audio_library_dir()
            .ok()
            .map(|path| path.display().to_string()),
        project_vault_dir: paths
            .app_data_dir
            .as_ref()
            .map(|path| default_project_vault_dir(path).display().to_string()),
        logs_dir: paths
            .app_data_dir
            .as_ref()
            .map(|path| default_logs_dir(path).display().to_string()),
    }
}

/// Reject privileged commands invoked from the frameless dictation widget — it
/// only needs dictation_paste / get_api_key / get_backend_url. This stops the
/// always-on-top widget (or injected script in it) from being a lever for file
/// writes, path reveals, or engine restarts.
fn deny_from_dictation(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "dictation" {
        return Err("This action is not available from the dictation widget.".to_string());
    }
    Ok(())
}

#[tauri::command]
fn restart_backend(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    process: tauri::State<BackendProcess>,
    port: tauri::State<BackendPort>,
    key: tauri::State<BackendApiKey>,
    startup_error: tauri::State<BackendStartupError>,
    paths: tauri::State<RuntimePaths>,
) -> Result<(), String> {
    deny_from_dictation(&window)?;
    kill_backend(&app);
    let resource_dir = app.path().resource_dir().ok();
    let app_data_dir = paths.app_data_dir.clone();
    let mut child = start_backend(port.0, &key.0, resource_dir, app_data_dir)
        .map_err(|err| format!("Could not restart local engine: {err}"))?;
    if let Err(err) = wait_for_backend(port.0, &mut child, Duration::from_secs(15)) {
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(mut guard) = startup_error.0.lock() {
            *guard = Some(err.to_string());
        }
        return Err(format!("Local engine restart failed: {err}"));
    }
    if let Ok(mut guard) = process.0.lock() {
        *guard = Some(child);
    }
    if let Ok(mut guard) = startup_error.0.lock() {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
fn open_logs_folder(
    window: tauri::WebviewWindow,
    paths: tauri::State<RuntimePaths>,
) -> Result<(), String> {
    deny_from_dictation(&window)?;
    let app_data_dir = paths
        .app_data_dir
        .as_ref()
        .ok_or_else(|| "App data folder is unavailable.".to_string())?;
    let logs_dir = default_logs_dir(app_data_dir);
    fs::create_dir_all(&logs_dir).map_err(|err| format!("Could not create logs folder: {err}"))?;
    open_path_in_file_manager(&logs_dir, false)
}

#[tauri::command]
fn open_project_vault(
    window: tauri::WebviewWindow,
    paths: tauri::State<RuntimePaths>,
) -> Result<(), String> {
    deny_from_dictation(&window)?;
    let app_data_dir = paths
        .app_data_dir
        .as_ref()
        .ok_or_else(|| "App data folder is unavailable.".to_string())?;
    let vault_dir = default_project_vault_dir(app_data_dir);
    fs::create_dir_all(&vault_dir)
        .map_err(|err| format!("Could not create project vault folder: {err}"))?;
    open_path_in_file_manager(&vault_dir, false)
}

#[tauri::command(rename_all = "camelCase")]
fn save_project_archive(
    window: tauri::WebviewWindow,
    paths: tauri::State<RuntimePaths>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    deny_from_dictation(&window)?;
    if bytes.is_empty() {
        return Err("Project archive is empty.".to_string());
    }
    let app_data_dir = paths
        .app_data_dir
        .as_ref()
        .ok_or_else(|| "App data folder is unavailable.".to_string())?;
    let vault_dir = default_project_vault_dir(app_data_dir);
    let snapshots_dir = vault_dir.join("snapshots");
    fs::create_dir_all(&snapshots_dir)
        .map_err(|err| format!("Could not create project snapshots folder: {err}"))?;
    let mut safe_file_name = sanitize_file_name(&file_name);
    if safe_file_name == "kural-audio.wav" {
        safe_file_name = "kural-project.kuralproj".to_string();
    }
    if !safe_file_name.to_ascii_lowercase().ends_with(".kuralproj") {
        safe_file_name.push_str(".kuralproj");
    }
    let output_path = unique_output_path(&snapshots_dir, &safe_file_name);
    if !output_path.starts_with(&snapshots_dir) {
        return Err("Refusing to save outside the project vault.".to_string());
    }
    fs::write(&output_path, bytes)
        .map_err(|err| format!("Could not save project archive: {err}"))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
fn clear_setup_state(
    window: tauri::WebviewWindow,
    paths: tauri::State<RuntimePaths>,
) -> Result<(), String> {
    deny_from_dictation(&window)?;
    let app_data_dir = paths
        .app_data_dir
        .as_ref()
        .ok_or_else(|| "App data folder is unavailable.".to_string())?;
    let setup_state = app_data_dir.join("first_run_state.json");
    if setup_state.exists() {
        fs::remove_file(&setup_state)
            .map_err(|err| format!("Could not clear setup state: {err}"))?;
    }
    Ok(())
}

fn default_logs_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

fn default_project_vault_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("project-vault")
}

fn default_audio_library_dir() -> Result<PathBuf, String> {
    let home = if cfg!(windows) {
        env::var_os("USERPROFILE")
    } else {
        env::var_os("HOME")
    };

    home.map(|path| PathBuf::from(path).join("Music").join("Kural"))
        .ok_or_else(|| "Could not resolve the user's music folder.".to_string())
}

fn sanitize_file_name(file_name: &str) -> String {
    let cleaned: String = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned
        .trim_matches(|ch| matches!(ch, '.' | '_' | ' '))
        .trim()
        .chars()
        .take(180)
        .collect::<String>();

    if trimmed.is_empty() {
        "kural-audio.wav".to_string()
    } else {
        trimmed
    }
}

fn unique_output_path(dir: &Path, file_name: &str) -> PathBuf {
    let first = dir.join(file_name);
    if !first.exists() {
        return first;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("kural-audio");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for index in 2..1000 {
        let candidate = dir.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(format!("{stem}-new{extension}"))
}

/// Save a generated clip to a predictable local folder from the desktop app.
/// The web build falls back to a browser download in the frontend.
#[tauri::command(rename_all = "camelCase")]
fn save_audio_file(
    window: tauri::WebviewWindow,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    deny_from_dictation(&window)?;
    if bytes.is_empty() {
        return Err("Audio file is empty.".to_string());
    }

    let output_dir = default_audio_library_dir()?;
    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Could not create audio library folder: {err}"))?;

    let safe_file_name = sanitize_file_name(&file_name);
    let output_path = unique_output_path(&output_dir, &safe_file_name);
    if !output_path.starts_with(&output_dir) {
        return Err("Refusing to save outside the audio library folder.".to_string());
    }

    fs::write(&output_path, bytes).map_err(|err| format!("Could not save audio file: {err}"))?;
    Ok(output_path.display().to_string())
}

/// Write the dictated transcript to the clipboard and hide the widget.
///
/// The widget calls this when the user stops dictation. Doing the
/// clipboard write + hide in one command keeps the widget's JS free of
/// plugin-permission wiring — custom commands need no capability entry,
/// whereas calling the clipboard plugin from JS would.
#[tauri::command]
fn dictation_paste(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|err| format!("Could not copy transcript to clipboard: {err}"))?;
    if let Some(win) = app.get_webview_window("dictation") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
fn reveal_path(
    window: tauri::WebviewWindow,
    paths: tauri::State<RuntimePaths>,
    path: String,
) -> Result<(), String> {
    deny_from_dictation(&window)?;
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("Saved file no longer exists.".to_string());
    }
    // Containment: a reveal target must sit under one of Kural's own folders.
    // Without this, any page JS could `explorer /select` an arbitrary path.
    let canonical = target
        .canonicalize()
        .map_err(|err| format!("Invalid path: {err}"))?;
    let mut allowed: Vec<PathBuf> = Vec::new();
    if let Ok(audio) = default_audio_library_dir() {
        allowed.push(audio);
    }
    if let Some(ref app_data) = paths.app_data_dir {
        allowed.push(app_data.clone());
        allowed.push(default_project_vault_dir(app_data));
        allowed.push(default_logs_dir(app_data));
    }
    let within = allowed.iter().any(|root| {
        root.canonicalize()
            .map(|resolved| canonical.starts_with(&resolved))
            .unwrap_or(false)
    });
    if !within {
        return Err("Refusing to reveal a path outside Kural's folders.".to_string());
    }

    open_path_in_file_manager(&target, true)
}

fn open_path_in_file_manager(target: &Path, reveal: bool) -> Result<(), String> {
    let status = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        if reveal {
            command.arg(format!("/select,{}", target.display()));
        } else {
            command.arg(target);
        }
        command.status()
    } else if cfg!(target_os = "macos") {
        if reveal {
            Command::new("open").arg("-R").arg(target).status()
        } else {
            Command::new("open").arg(target).status()
        }
    } else {
        let folder = target.parent().unwrap_or_else(|| Path::new("."));
        Command::new("xdg-open")
            .arg(if reveal { folder } else { target })
            .status()
    }
    .map_err(|err| format!("Could not open file manager: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("File manager exited with {status}"))
    }
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
    let dictation_item = MenuItem::with_id(
        app,
        "dictation",
        "Dictation Widget (Ctrl+Shift+Space)",
        true,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &dictation_item, &sep, &quit_item])?;

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
            "dictation" => toggle_dictation_window(app),
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Toggle on key-down only; the handler also fires on release.
                    if event.state == ShortcutState::Pressed {
                        toggle_dictation_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let app_data_dir = app.path().app_data_dir().ok();

            let api_key = app_data_dir
                .as_deref()
                .and_then(|dir| match ensure_api_key(dir) {
                    Ok(key) => Some(key),
                    Err(err) => {
                        eprintln!("kural: failed to provision API key: {err}");
                        None
                    }
                })
                .unwrap_or_default();

            // Allocating a port can fail on a locked-down host. Don't panic with
            // no window — degrade to a port-less state and surface the reason in
            // the same banner the frontend already renders for backend failures.
            let (port, port_error) = match find_free_port() {
                Ok(p) => (p, None),
                Err(e) => {
                    eprintln!("kural: could not allocate a local port: {e}");
                    (0, Some(format!("Could not allocate a local port: {e}")))
                }
            };

            let (child_opt, backend_error) = if let Some(err) = port_error {
                (None, Some(err))
            } else {
                match start_backend(port, &api_key, resource_dir, app_data_dir.clone()) {
                    Ok(mut child) => match wait_for_backend(port, &mut child, Duration::from_secs(15)) {
                        Ok(()) => (Some(child), None),
                        Err(e) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            eprintln!("kural: backend health check failed: {e}");
                            (None, Some(e.to_string()))
                        }
                    },
                    Err(e) => {
                        eprintln!("kural: backend start failed: {e}");
                        (None, Some(e.to_string()))
                    }
                }
            };
            app.manage(BackendProcess(Mutex::new(child_opt)));
            app.manage(BackendPort(port));
            app.manage(BackendApiKey(api_key.clone()));
            app.manage(BackendStartupError(Mutex::new(backend_error.clone())));
            app.manage(RuntimePaths { app_data_dir });

            // App menu and tray are convenience surfaces — a failure here (rare,
            // e.g. a platform quirk) must not abort launch with no window.
            match build_menu(app.handle()) {
                Ok(menu) => {
                    if let Err(err) = app.set_menu(menu) {
                        eprintln!("kural: failed to set app menu: {err}");
                    }
                }
                Err(err) => eprintln!("kural: failed to build app menu: {err}"),
            }
            if let Err(err) = build_tray(app.handle()) {
                eprintln!("kural: failed to build system tray: {err}");
            }

            // Main window — port is injected before any page JS runs
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .initialization_script(&format!(
                "window.__KURAL_API_URL__ = 'http://127.0.0.1:{port}'; window.__KURAL_API_KEY__ = '{}'; window.__KURAL_BACKEND_ERROR__ = '{}';",
                escape_js_string(&api_key),
                backend_error
                    .as_deref()
                    .map(escape_js_string)
                    .unwrap_or_default()
            ))
            .title("Kural TTS")
            .inner_size(1100.0, 700.0)
            .resizable(true)
            .build();
            let win = match win {
                Ok(win) => win,
                Err(err) => {
                    // The main window is the one genuinely unrecoverable failure
                    // (there is nothing to show). Log a clear reason rather than
                    // a bare panic, then let setup return the error.
                    eprintln!("kural: failed to create the main window: {err}");
                    return Err(err.into());
                }
            };

            // Hide to tray on close instead of quitting
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = win_clone.hide();
                    api.prevent_close();
                }
            });

            // Dictation widget — frameless, always-on-top, hidden until the
            // global shortcut or tray summons it. Created once at startup so
            // toggling is just show/hide and the widget keeps its state.
            // The Next dev server serves this route as `/dictation`; the
            // release static export emits it as `dictation.html`. Tauri
            // doesn't normalise the `.html` suffix the way it does for
            // index.html, so pick the path that matches the build profile.
            let dictation_path = if cfg!(debug_assertions) {
                "dictation"
            } else {
                "dictation.html"
            };
            let dictation = tauri::WebviewWindowBuilder::new(
                app,
                "dictation",
                tauri::WebviewUrl::App(dictation_path.into()),
            )
            .initialization_script(&format!(
                "window.__KURAL_API_URL__ = 'http://127.0.0.1:{port}'; window.__KURAL_API_KEY__ = '{}';",
                escape_js_string(&api_key)
            ))
            .title("Kural Dictation")
            .inner_size(420.0, 168.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build();

            // The dictation widget is optional — if it fails to build, the main
            // app still runs (the tray/shortcut just can't summon it).
            match dictation {
                Ok(dictation) => {
                    // Closing the widget just hides it — the shortcut re-summons it.
                    let dictation_clone = dictation.clone();
                    dictation.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let _ = dictation_clone.hide();
                            api.prevent_close();
                        }
                    });
                }
                Err(err) => eprintln!("kural: failed to create the dictation widget: {err}"),
            }

            // Global shortcut to summon the widget. A failure here — e.g. the
            // accelerator is already claimed by another app — is non-fatal:
            // the tray menu still opens the widget.
            match DICTATION_SHORTCUT.parse::<Shortcut>() {
                Ok(shortcut) => {
                    if let Err(err) = app.global_shortcut().register(shortcut) {
                        eprintln!("kural: failed to register dictation shortcut: {err}");
                    }
                }
                Err(err) => eprintln!("kural: invalid dictation shortcut: {err}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_api_key,
            get_runtime_diagnostics,
            restart_backend,
            open_logs_folder,
            open_project_vault,
            save_project_archive,
            clear_setup_state,
            save_audio_file,
            reveal_path,
            dictation_paste
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            eprintln!("kural: fatal error while running: {err}");
            std::process::exit(1);
        });
}

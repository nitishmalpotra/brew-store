use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

const BREW_PATH: &str = "/opt/homebrew/bin/brew";
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

// Defense-in-depth: only these brew subcommands may be invoked from the webview.
// Args are passed to Command without a shell, so there is no shell-injection vector;
// this simply bounds the blast radius if the frontend were ever compromised.
const ALLOWED: &[&str] = &[
    "install", "uninstall", "upgrade", "list", "outdated", "update", "--version", "--prefix",
];
fn allowed(args: &[String]) -> bool {
    args.first().map(|s| ALLOWED.contains(&s.as_str())).unwrap_or(false)
}

// ponytail: hardcode the Apple-Silicon brew path, fall back to PATH lookup.
fn brew() -> Command {
    let bin = if std::path::Path::new(BREW_PATH).exists() { BREW_PATH } else { "brew" };
    let mut c = Command::new(bin);
    c.env("HOMEBREW_NO_ENV_HINTS", "1")
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .env("HOMEBREW_NO_ANALYTICS", "1");
    c
}

#[derive(Clone, serde::Serialize)]
struct LineEvt {
    id: u64,
    stream: &'static str,
    text: String,
}

#[derive(Clone, serde::Serialize)]
struct DoneEvt {
    id: u64,
    code: i32,
    success: bool,
}

/// Run a brew subcommand, streaming each output line to the webview as it arrives.
/// Returns a job id the frontend filters events by. This is the live-install hero.
#[tauri::command]
pub fn brew_run(app: AppHandle, args: Vec<String>) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    if !allowed(&args) {
        let _ = app.emit("brew-output", LineEvt { id, stream: "stderr", text: format!("blocked: brew {}", args.join(" ")) });
        let _ = app.emit("brew-done", DoneEvt { id, code: -1, success: false });
        return id;
    }
    std::thread::spawn(move || {
        let mut child = match brew()
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("brew-output", LineEvt { id, stream: "stderr", text: format!("could not start brew: {e}") });
                let _ = app.emit("brew-done", DoneEvt { id, code: -1, success: false });
                return;
            }
        };
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");
        let app_err = app.clone();
        let err_thread = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app_err.emit("brew-output", LineEvt { id, stream: "stderr", text: line });
            }
        });
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit("brew-output", LineEvt { id, stream: "stdout", text: line });
        }
        let _ = err_thread.join();
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let _ = app.emit("brew-done", DoneEvt { id, code, success: code == 0 });
    });
    id
}

/// Run a brew subcommand and return stdout (for list / outdated / info-style reads).
#[tauri::command]
pub fn brew_query(args: Vec<String>) -> Result<String, String> {
    if !allowed(&args) {
        return Err(format!("blocked: brew {}", args.join(" ")));
    }
    let out = brew().args(&args).output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    // `brew outdated` etc. can exit non-zero yet still print useful stdout.
    if out.status.success() || !stdout.trim().is_empty() {
        Ok(stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

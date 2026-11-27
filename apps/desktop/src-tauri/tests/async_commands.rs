//! Guard test (ARCH3 / F4): every `#[tauri::command]` in `src/commands/*.rs`
//! must be `pub async fn` (offloading blocking work via `spawn_blocking`) unless
//! explicitly listed in `SYNC_ALLOWLIST` (pure in-memory reads, pure CPU, or
//! main-thread window control).

use std::fs;
use std::path::Path;

/// Commands intentionally kept synchronous (no DB, media, or filesystem IO).
const SYNC_ALLOWLIST: &[&str] = &[
    "get_startup_error",
    "app_info",
    // Reads the portable flag cached once per process by `data_dir` (no IO here).
    "is_portable",
    "ai_split_text",
    "hide_quick_add",
    "get_quick_add_config",
];

fn extract_fn_name(sig: &str) -> Option<&str> {
    let after_fn = sig.split("fn ").nth(1)?;
    let name = after_fn.split('(').next()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[test]
fn all_io_commands_are_async() {
    let commands_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    let mut entries: Vec<_> = fs::read_dir(&commands_dir)
        .expect("read src/commands dir")
        .map(|e| e.expect("dir entry").path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("rs"))
        .collect();
    entries.sort();

    let mut violations = Vec::new();

    for path in entries {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let content =
            fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let lines: Vec<&str> = content.lines().collect();

        for (idx, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if !trimmed.starts_with("#[tauri::command") {
                continue;
            }
            let attr_async = trimmed.contains("async");

            // Find the `pub ... fn <name>` line following the attribute.
            let mut sig_idx = idx + 1;
            while sig_idx < lines.len() {
                let s = lines[sig_idx].trim();
                if s.is_empty() || s.starts_with('#') || s.starts_with("//") {
                    sig_idx += 1;
                    continue;
                }
                break;
            }

            let Some(sig_line) = lines.get(sig_idx) else {
                violations.push(format!(
                    "{filename}:{}: #[tauri::command] with no following fn",
                    idx + 1
                ));
                continue;
            };
            let sig = sig_line.trim();
            let is_async =
                attr_async || sig.starts_with("pub async fn ") || sig.starts_with("async fn ");
            let name = extract_fn_name(sig).unwrap_or("<unknown>");

            if !is_async && !SYNC_ALLOWLIST.contains(&name) {
                violations.push(format!("{filename}:{}: `{name}` is sync", sig_idx + 1));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "Found synchronous #[tauri::command] functions outside SYNC_ALLOWLIST:\n{}",
        violations.join("\n")
    );
}

//! Quick-add configuration persistence and window lifecycle helpers.
//!
//! Stores settings in `data_dir/.quick-add.json` so portable copies keep
//! their own shortcut and last deck/notetype isolated from OS folders.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use bibalak_core::ipc::QuickAddConfig;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const QUICK_ADD_WINDOW_LABEL: &str = "quick-add";
pub const QUICK_ADD_CONFIG_FILENAME: &str = ".quick-add.json";

/// Managed Tauri state holding quick-add config and its portable-aware `data_dir`.
pub struct QuickAddState {
    data_dir: PathBuf,
    config: Mutex<QuickAddConfig>,
}

impl QuickAddState {
    pub fn load(data_dir: PathBuf) -> Self {
        let config = load_config(&data_dir);
        Self {
            data_dir,
            config: Mutex::new(config),
        }
    }

    pub fn get(&self) -> Result<QuickAddConfig, String> {
        self.config
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "quick-add state lock poisoned".to_string())
    }

    pub fn set_shortcut(&self, enabled: bool, shortcut: String) -> Result<QuickAddConfig, String> {
        let trimmed = shortcut.trim().to_string();
        if enabled && trimmed.is_empty() {
            return Err("shortcut cannot be empty".into());
        }
        let mut guard = self
            .config
            .lock()
            .map_err(|_| "quick-add state lock poisoned".to_string())?;
        guard.enabled = enabled;
        if !trimmed.is_empty() {
            guard.shortcut = trimmed;
        }
        save_config(&self.data_dir, &guard)?;
        Ok(guard.clone())
    }

    pub fn remember_target(
        &self,
        deck_id: Option<i64>,
        notetype_id: Option<i64>,
    ) -> Result<QuickAddConfig, String> {
        let mut guard = self
            .config
            .lock()
            .map_err(|_| "quick-add state lock poisoned".to_string())?;
        if deck_id.is_some() {
            guard.last_deck_id = deck_id;
        }
        if notetype_id.is_some() {
            guard.last_notetype_id = notetype_id;
        }
        save_config(&self.data_dir, &guard)?;
        Ok(guard.clone())
    }
}

pub fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join(QUICK_ADD_CONFIG_FILENAME)
}

pub fn load_config(data_dir: &Path) -> QuickAddConfig {
    let Ok(raw) = std::fs::read_to_string(config_path(data_dir)) else {
        return QuickAddConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save_config(data_dir: &Path, cfg: &QuickAddConfig) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("create data dir: {e}"))?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config: {e}"))?;
    std::fs::write(config_path(data_dir), json).map_err(|e| format!("write quick-add config: {e}"))
}

/// Pure predicate so tests and commands agree on when a quick-add window may exist.
pub fn should_create_window(cfg: &QuickAddConfig) -> bool {
    cfg.enabled
}

pub fn destroy_window_if_open(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(QUICK_ADD_WINDOW_LABEL) {
        let _ = win.destroy();
    }
}

pub fn hide_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(QUICK_ADD_WINDOW_LABEL) {
        let _ = win.hide();
    }
}

/// Toggle visibility or lazily create the compact always-on-top quick-add window.
/// Never creates a window when `cfg.enabled` is false.
pub fn toggle_or_open_window(app: &AppHandle, cfg: &QuickAddConfig) -> Result<bool, String> {
    if !should_create_window(cfg) {
        destroy_window_if_open(app);
        return Ok(false);
    }

    if let Some(win) = app.get_webview_window(QUICK_ADD_WINDOW_LABEL) {
        let visible = win.is_visible().unwrap_or(false);
        let focused = win.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = win.hide();
            return Ok(false);
        }
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(true);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        QUICK_ADD_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=quick-add".into()),
    )
    .title("Quick Add")
    .inner_size(480.0, 560.0)
    .min_inner_size(380.0, 420.0)
    .always_on_top(true)
    .resizable(true)
    .decorations(false)
    .shadow(true);

    if let Some(portable_dir) = crate::data_dir::portable_data_dir() {
        builder = builder.data_directory(portable_dir.join("webview"));
    }

    builder
        .build()
        .map_err(|e| format!("open quick-add window: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_path_uses_portable_data_dir_and_defaults_disabled() {
        let dir = tempfile_tempdir("default");
        let cfg = load_config(&dir);
        assert!(!cfg.enabled);
        assert_eq!(cfg.shortcut, "Ctrl+Shift+K");
        assert!(!should_create_window(&cfg));
        assert_eq!(config_path(&dir), dir.join(QUICK_ADD_CONFIG_FILENAME));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundtrips_quick_add_config_and_remembers_last_deck_and_notetype() {
        let dir = tempfile_tempdir("roundtrip");
        let state = QuickAddState::load(dir.clone());

        let updated = state
            .set_shortcut(true, "Ctrl+Alt+N".into())
            .expect("valid shortcut");
        assert!(updated.enabled);
        assert!(should_create_window(&updated));
        assert_eq!(updated.shortcut, "Ctrl+Alt+N");

        let remembered = state
            .remember_target(Some(42), Some(7))
            .expect("remember target");
        assert_eq!(remembered.last_deck_id, Some(42));
        assert_eq!(remembered.last_notetype_id, Some(7));

        let reloaded = QuickAddState::load(dir.clone()).get().unwrap();
        assert_eq!(reloaded, remembered);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_empty_shortcut_when_enabled_and_recovers_from_corrupt_json() {
        let dir = tempfile_tempdir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(&dir), "{not valid json").unwrap();

        let state = QuickAddState::load(dir.clone());
        let fallback = state.get().unwrap();
        assert_eq!(fallback, QuickAddConfig::default());
        assert!(state.set_shortcut(true, "   ".into()).is_err());

        let disabled = state.set_shortcut(false, "Ctrl+Shift+K".into()).unwrap();
        assert!(!should_create_window(&disabled));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn tempfile_tempdir(tag: &str) -> PathBuf {
        let uniq = format!(
            "keepsake_quick_add_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        std::env::temp_dir().join(uniq)
    }
}

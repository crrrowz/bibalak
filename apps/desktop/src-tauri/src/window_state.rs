//! Window state persistence and off-screen recovery.
//!
//! Persists the main window's size, position, and maximized state in
//! `data_dir::data_dir()/.window-state.json` for both installed and portable
//! copies (ADR-006, ADR-008). Saved coordinates are checked against
//! `available_monitors()` so a window from a disconnected monitor never
//! restores off-screen and falls back to the unmaximized centered default.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow,
    WindowEvent,
};

pub const STATE_FILENAME: &str = ".window-state.json";
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Lifecycle signal distilled from a Tauri `WindowEvent` for unit-testable shutdown logic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleSignal {
    CloseRequested,
    Destroyed,
    Other,
}

impl From<&WindowEvent> for LifecycleSignal {
    fn from(event: &WindowEvent) -> Self {
        match event {
            WindowEvent::CloseRequested { .. } => Self::CloseRequested,
            WindowEvent::Destroyed => Self::Destroyed,
            _ => Self::Other,
        }
    }
}

/// Action taken when a window lifecycle signal arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowCloseAction {
    SaveStateAndTeardownChildren,
    ExitApp,
    None,
}

/// Only closing/destroying the main window ends the entire desktop application;
/// secondary windows (e.g. Quick Add) must never keep a headless process alive in
/// Task Manager after the main window is closed, nor trigger app exit when closed on their own.
pub fn close_action_for(window_label: &str, signal: LifecycleSignal) -> WindowCloseAction {
    if window_label != MAIN_WINDOW_LABEL {
        return WindowCloseAction::None;
    }
    match signal {
        LifecycleSignal::CloseRequested => WindowCloseAction::SaveStateAndTeardownChildren,
        LifecycleSignal::Destroyed => WindowCloseAction::ExitApp,
        LifecycleSignal::Other => WindowCloseAction::None,
    }
}

fn destroy_non_main_windows<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if label != MAIN_WINDOW_LABEL {
            let _ = window.destroy();
        }
    }
}

/// Minimum horizontal pixels and top drag-strip height that must remain on a
/// monitor for a non-maximized window to be considered reachable by the user.
const MIN_VISIBLE_WIDTH_PX: i64 = 64;
const TITLEBAR_STRIP_HEIGHT_PX: i64 = 48;
const MIN_VISIBLE_TITLEBAR_PX: i64 = 24;

/// Axis-aligned monitor or window rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Serializable window state stored in `.window-state.json`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SavedWindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub prev_x: i32,
    #[serde(default)]
    pub prev_y: i32,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default = "default_true")]
    pub decorated: bool,
    #[serde(default)]
    pub fullscreen: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SavedWindowState {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            x: 0,
            y: 0,
            prev_x: 0,
            prev_y: 0,
            maximized: false,
            visible: true,
            decorated: true,
            fullscreen: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestoreDecision {
    Restore(SavedWindowState),
    FallbackCenteredDefault,
    NoSavedState,
}

pub struct ManagedWindowState {
    path: PathBuf,
    state: Arc<Mutex<SavedWindowState>>,
}

pub fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(STATE_FILENAME)
}

pub fn is_rect_on_screen(rect: Rect, maximized: bool, monitors: &[Rect]) -> bool {
    if monitors.is_empty() || rect.width == 0 || rect.height == 0 {
        return false;
    }

    let rx = i64::from(rect.x);
    let ry = i64::from(rect.y);
    let rw = i64::from(rect.width);
    let rh = i64::from(rect.height);

    if maximized {
        let cx = rx + rw / 2;
        let cy = ry + rh / 2;
        return monitors.iter().any(|m| {
            let mx = i64::from(m.x);
            let my = i64::from(m.y);
            let mw = i64::from(m.width);
            let mh = i64::from(m.height);
            cx >= mx && cx < mx + mw && cy >= my && cy < my + mh
        });
    }

    let min_x = rw.min(MIN_VISIBLE_WIDTH_PX);
    let strip_h = rh.min(TITLEBAR_STRIP_HEIGHT_PX);
    let min_y = rh.min(MIN_VISIBLE_TITLEBAR_PX);

    monitors.iter().any(|m| {
        let mx = i64::from(m.x);
        let my = i64::from(m.y);
        let mw = i64::from(m.width);
        let mh = i64::from(m.height);

        let overlap_x = (rx + rw).min(mx + mw) - rx.max(mx);
        let overlap_y = (ry + strip_h).min(my + mh) - ry.max(my);
        overlap_x >= min_x && overlap_y >= min_y
    })
}

pub fn decide_restore(saved: Option<&SavedWindowState>, monitors: &[Rect]) -> RestoreDecision {
    let Some(state) = saved else {
        return RestoreDecision::NoSavedState;
    };
    if *state == SavedWindowState::default() || state.width == 0 || state.height == 0 {
        return RestoreDecision::NoSavedState;
    }

    let current_rect = Rect {
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
    };
    if !is_rect_on_screen(current_rect, state.maximized, monitors) {
        return RestoreDecision::FallbackCenteredDefault;
    }

    if state.maximized && (state.prev_x != 0 || state.prev_y != 0) {
        let prev_rect = Rect {
            x: state.prev_x,
            y: state.prev_y,
            width: state.width,
            height: state.height,
        };
        if !is_rect_on_screen(prev_rect, false, monitors) {
            return RestoreDecision::FallbackCenteredDefault;
        }
    }

    RestoreDecision::Restore(state.clone())
}

pub fn load_main_state(path: &Path) -> Option<SavedWindowState> {
    let bytes = std::fs::read(path).ok()?;
    let mut map: HashMap<String, SavedWindowState> = serde_json::from_slice(&bytes).ok()?;
    map.remove(MAIN_WINDOW_LABEL)
}

pub fn save_main_state(path: &Path, state: &SavedWindowState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut map = HashMap::new();
    map.insert(MAIN_WINDOW_LABEL.to_string(), state.clone());
    let json = serde_json::to_vec_pretty(&map).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

fn monitor_rects<R: Runtime>(win: &WebviewWindow<R>) -> Vec<Rect> {
    win.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            Rect {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

fn reset_to_centered_default<R: Runtime>(
    win: &WebviewWindow<R>,
    default_width: f64,
    default_height: f64,
) {
    if win.is_maximized().unwrap_or(false) {
        let _ = win.unmaximize();
    }
    let _ = win.set_size(LogicalSize::new(default_width, default_height));
    let _ = win.center();
}

/// Restores main window state from `data_dir/.window-state.json` and tracks
/// move/resize/maximize/close events so it persists on exit.
pub fn init<R: Runtime>(
    win: &WebviewWindow<R>,
    data_dir: &Path,
    default_width: f64,
    default_height: f64,
) {
    let path = state_path(data_dir);
    let saved = load_main_state(&path);
    let monitors = monitor_rects(win);

    let initial = match decide_restore(saved.as_ref(), &monitors) {
        RestoreDecision::Restore(state) => {
            let (restore_x, restore_y) = if state.maximized {
                (state.prev_x, state.prev_y)
            } else {
                (state.x, state.y)
            };
            let _ = win.set_position(PhysicalPosition::new(restore_x, restore_y));
            let _ = win.set_size(PhysicalSize::new(state.width, state.height));
            if state.maximized {
                let _ = win.maximize();
            }
            state
        }
        RestoreDecision::FallbackCenteredDefault => {
            reset_to_centered_default(win, default_width, default_height);
            snapshot_window(win)
        }
        // First launch: open maximized; the 1200×800 default stays the
        // size it returns to when the user un-maximizes.
        RestoreDecision::NoSavedState => {
            let _ = win.maximize();
            snapshot_window(win)
        }
    };

    let state = Arc::new(Mutex::new(initial));
    win.app_handle().manage(ManagedWindowState {
        path: path.clone(),
        state: Arc::clone(&state),
    });

    let win_clone = win.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::Moved(pos) => {
            if win_clone.is_minimized().unwrap_or(false) {
                return;
            }
            if let Ok(mut guard) = state.lock() {
                if pos.x == guard.x && pos.y == guard.y {
                    return;
                }
                let maximized = win_clone.is_maximized().unwrap_or(false);
                if !maximized {
                    guard.prev_x = guard.x;
                    guard.prev_y = guard.y;
                }
                guard.x = pos.x;
                guard.y = pos.y;
            }
        }
        WindowEvent::Resized(size) => {
            if win_clone.is_minimized().unwrap_or(false)
                || win_clone.is_maximized().unwrap_or(false)
            {
                return;
            }
            if size.width > 0 && size.height > 0 {
                if let Ok(mut guard) = state.lock() {
                    guard.width = size.width;
                    guard.height = size.height;
                }
            }
        }
        _ => match close_action_for(win_clone.label(), LifecycleSignal::from(event)) {
            WindowCloseAction::SaveStateAndTeardownChildren => {
                if let Ok(mut guard) = state.lock() {
                    update_from_window(&win_clone, &mut guard);
                    let _ = save_main_state(&path, &guard);
                }
                destroy_non_main_windows(win_clone.app_handle());
            }
            WindowCloseAction::ExitApp => {
                let app = win_clone.app_handle();
                save_on_exit(app);
                destroy_non_main_windows(app);
                app.exit(0);
            }
            WindowCloseAction::None => {}
        },
    });
}

pub fn save_on_exit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(managed) = app.try_state::<ManagedWindowState>() {
        if let Ok(guard) = managed.state.lock() {
            let _ = save_main_state(&managed.path, &guard);
        }
    }
}

fn snapshot_window<R: Runtime>(win: &WebviewWindow<R>) -> SavedWindowState {
    let mut state = SavedWindowState {
        decorated: win.is_decorated().unwrap_or(false),
        visible: win.is_visible().unwrap_or(true),
        ..Default::default()
    };
    update_from_window(win, &mut state);
    state
}

fn update_from_window<R: Runtime>(win: &WebviewWindow<R>, state: &mut SavedWindowState) {
    let maximized = win.is_maximized().unwrap_or(false);
    let minimized = win.is_minimized().unwrap_or(false);
    state.maximized = maximized;
    if !maximized && !minimized {
        if let Ok(size) = win.inner_size() {
            if size.width > 0 && size.height > 0 {
                state.width = size.width;
                state.height = size.height;
            }
        }
        if let Ok(pos) = win.outer_position() {
            state.x = pos.x;
            state.y = pos.y;
            state.prev_x = pos.x;
            state.prev_y = pos.y;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn primary_1080p() -> Vec<Rect> {
        vec![Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }]
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("keepsake-winstate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn state_path_uses_data_dir() {
        let dir = Path::new("D:\\Portable\\Bibalak\\data");
        assert_eq!(state_path(dir), dir.join(STATE_FILENAME));
    }

    #[test]
    fn on_screen_window_is_kept() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: 200,
            y: 120,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::Restore(state)
        );
    }

    #[test]
    fn partially_visible_window_with_reachable_titlebar_is_kept() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: 1840,
            y: 100,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::Restore(state)
        );
    }

    #[test]
    fn off_screen_removed_monitor_falls_back_to_centered() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: 2100,
            y: 100,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::FallbackCenteredDefault
        );
    }

    #[test]
    fn off_screen_titlebar_above_monitor_falls_back_to_centered() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: 100,
            y: -780,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::FallbackCenteredDefault
        );
    }

    #[test]
    fn maximized_on_removed_monitor_falls_back_to_centered() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: 1912,
            y: -8,
            prev_x: 2050,
            prev_y: 80,
            maximized: true,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::FallbackCenteredDefault
        );
    }

    #[test]
    fn maximized_on_current_monitor_is_kept() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: -8,
            y: -8,
            prev_x: 200,
            prev_y: 120,
            maximized: true,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::Restore(state)
        );
    }

    #[test]
    fn maximized_with_offscreen_prev_position_falls_back_to_centered() {
        let state = SavedWindowState {
            width: 1200,
            height: 800,
            x: -8,
            y: -8,
            prev_x: 2200,
            prev_y: 100,
            maximized: true,
            ..Default::default()
        };
        assert_eq!(
            decide_restore(Some(&state), &primary_1080p()),
            RestoreDecision::FallbackCenteredDefault
        );
    }

    #[test]
    fn corrupt_or_missing_state_file_returns_none() {
        let dir = temp_dir("corrupt");
        let missing = dir.join("missing.json");
        assert_eq!(load_main_state(&missing), None);

        let corrupt = dir.join("corrupt.json");
        std::fs::write(&corrupt, "{not valid json").unwrap();
        assert_eq!(load_main_state(&corrupt), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn state_round_trip_writes_and_reads_under_data_dir() {
        let dir = temp_dir("roundtrip");
        let path = state_path(&dir);
        let state = SavedWindowState {
            width: 1366,
            height: 768,
            x: 120,
            y: 90,
            prev_x: 120,
            prev_y: 90,
            maximized: true,
            visible: true,
            decorated: false,
            fullscreen: false,
        };
        save_main_state(&path, &state).unwrap();
        assert!(path.is_file());
        assert_eq!(load_main_state(&path), Some(state));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn main_close_and_destroy_trigger_child_teardown_and_app_exit() {
        assert_eq!(
            close_action_for(MAIN_WINDOW_LABEL, LifecycleSignal::CloseRequested),
            WindowCloseAction::SaveStateAndTeardownChildren
        );
        assert_eq!(
            close_action_for(MAIN_WINDOW_LABEL, LifecycleSignal::Destroyed),
            WindowCloseAction::ExitApp
        );
        assert_eq!(
            close_action_for("quick-add", LifecycleSignal::CloseRequested),
            WindowCloseAction::None
        );
        assert_eq!(
            close_action_for("quick-add", LifecycleSignal::Destroyed),
            WindowCloseAction::None
        );
        assert_eq!(
            close_action_for(MAIN_WINDOW_LABEL, LifecycleSignal::Other),
            WindowCloseAction::None
        );
    }
}

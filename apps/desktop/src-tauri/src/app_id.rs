//! The app id changed from `com.keepsake.desktop` to `com.bibalak.desktop`
//!. The OS folders are named after the id, so on the first launch after
//! the change the old folders are renamed to the new name — one rename on the
//! same disk, so nothing is copied and nothing is lost. This runs before the
//! window and the webview start, because the webview keeps its settings
//! (`localStorage`) in the local folder.
//!
//! If a rename cannot happen (for example the old folder is in use), the
//! startup code falls back to the copy-based move in `legacy.rs`.

use std::io;
use std::path::{Path, PathBuf};

/// Bundle identifier of this build; must match `tauri.conf.json`.
pub const CURRENT_IDENTIFIER: &str = "com.bibalak.desktop";

/// Identifier used by Bibalak 1.0.0 and 1.1.0.
pub const PREVIOUS_IDENTIFIER: &str = "com.keepsake.desktop";

/// Rename `<base>/<previous>` to `<base>/<current>` when only the old folder
/// exists. Returns `true` when a rename happened. Never touches a folder that
/// already has the new name.
pub fn adopt_previous_dir(base: &Path, previous: &str, current: &str) -> io::Result<bool> {
    let old = base.join(previous);
    let new = base.join(current);
    if new.exists() || !old.is_dir() {
        return Ok(false);
    }
    std::fs::rename(&old, &new)?;
    Ok(true)
}

/// OS folders that Tauri names after the bundle identifier: the data folder
/// (`app_data_dir`) and, where it differs, the local folder that holds the
/// webview profile and logs (`app_local_data_dir`).
pub fn identifier_parent_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        for var in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(var) {
                dirs.push(PathBuf::from(dir));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Application Support"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            Some(dir) => dirs.push(PathBuf::from(dir)),
            None => {
                if let Some(home) = std::env::var_os("HOME") {
                    dirs.push(PathBuf::from(home).join(".local/share"));
                }
            }
        }
    }
    dirs.dedup();
    dirs
}

/// Rename every old-id folder that has no new-id twin yet. Errors are logged,
/// never fatal: the copy fallback in `legacy.rs` still finds the old data.
pub fn adopt_previous_dirs() {
    for base in identifier_parent_dirs() {
        match adopt_previous_dir(&base, PREVIOUS_IDENTIFIER, CURRENT_IDENTIFIER) {
            Ok(true) => tracing::info!(
                "renamed {} to {} in {}",
                PREVIOUS_IDENTIFIER,
                CURRENT_IDENTIFIER,
                base.display()
            ),
            Ok(false) => {}
            Err(e) => tracing::warn!(
                "could not rename {} in {}: {e}",
                PREVIOUS_IDENTIFIER,
                base.display()
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "bibalak-app-id-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn current_identifier_matches_tauri_conf() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");
        assert_eq!(conf["identifier"], CURRENT_IDENTIFIER);
        assert_ne!(CURRENT_IDENTIFIER, PREVIOUS_IDENTIFIER);
    }

    #[test]
    fn renames_old_folder_with_all_its_content() {
        let tmp = TempDir::new("rename");
        let old = tmp.0.join(PREVIOUS_IDENTIFIER);
        fs::create_dir_all(old.join("collection.media")).unwrap();
        fs::write(old.join("collection.sqlite"), b"db").unwrap();
        fs::write(old.join("collection.media/a.png"), b"img").unwrap();

        assert!(adopt_previous_dir(&tmp.0, PREVIOUS_IDENTIFIER, CURRENT_IDENTIFIER).unwrap());

        let new = tmp.0.join(CURRENT_IDENTIFIER);
        assert!(!old.exists());
        assert_eq!(fs::read(new.join("collection.sqlite")).unwrap(), b"db");
        assert_eq!(
            fs::read(new.join("collection.media/a.png")).unwrap(),
            b"img"
        );
    }

    #[test]
    fn leaves_both_alone_when_new_folder_exists() {
        let tmp = TempDir::new("both");
        let old = tmp.0.join(PREVIOUS_IDENTIFIER);
        let new = tmp.0.join(CURRENT_IDENTIFIER);
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("collection.sqlite"), b"old").unwrap();
        fs::write(new.join("collection.sqlite"), b"new").unwrap();

        assert!(!adopt_previous_dir(&tmp.0, PREVIOUS_IDENTIFIER, CURRENT_IDENTIFIER).unwrap());

        assert_eq!(fs::read(old.join("collection.sqlite")).unwrap(), b"old");
        assert_eq!(fs::read(new.join("collection.sqlite")).unwrap(), b"new");
    }

    #[test]
    fn does_nothing_without_an_old_folder() {
        let tmp = TempDir::new("none");
        assert!(!adopt_previous_dir(&tmp.0, PREVIOUS_IDENTIFIER, CURRENT_IDENTIFIER).unwrap());
        assert!(!tmp.0.join(CURRENT_IDENTIFIER).exists());
    }
}

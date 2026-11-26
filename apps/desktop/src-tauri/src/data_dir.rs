//! Where the collection, media, backups, plugins and webview profile live.
//!
//! Installed copies use the OS app-data folder. A **portable** copy is one
//! with a `portable.txt` file next to the executable: everything is then kept
//! in a `data` folder beside it, so the whole folder can move between
//! computers (for example on a USB stick). See `docs/guides/install.md`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{Manager, Runtime};

/// File whose presence next to the executable turns on portable mode.
pub const PORTABLE_MARKER: &str = "portable.txt";

/// Folder next to the executable that holds a portable copy's data.
pub const PORTABLE_DATA_DIR: &str = "data";

/// Portable data folder for an executable in `exe_dir`, if the marker is there.
pub fn portable_data_dir_for(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir
        .join(PORTABLE_MARKER)
        .is_file()
        .then(|| exe_dir.join(PORTABLE_DATA_DIR))
}

/// Portable data folder of the running executable, checked once per process.
pub fn portable_data_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let exe = std::env::current_exe().ok()?;
        portable_data_dir_for(exe.parent()?)
    })
    .as_deref()
}

/// The app's data folder: the portable one when present, else the OS one.
pub fn data_dir<R: Runtime, M: Manager<R>>(app: &M) -> tauri::Result<PathBuf> {
    match portable_data_dir() {
        Some(dir) => Ok(dir.to_path_buf()),
        None => app.path().app_data_dir(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("keepsake-portable-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn marker_file_selects_data_folder_next_to_exe() {
        let dir = temp_dir("marker");
        std::fs::write(dir.join(PORTABLE_MARKER), "").unwrap();
        assert_eq!(portable_data_dir_for(&dir), Some(dir.join("data")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_marker_means_installed_mode() {
        let dir = temp_dir("none");
        assert_eq!(portable_data_dir_for(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Every path goes through `data_dir`; a direct `app_data_dir()` call
    /// would split a portable copy's data across two folders.
    #[test]
    fn only_this_module_asks_for_the_os_data_folder() {
        fn walk(dir: &Path, hits: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, hits);
                } else if path.extension().is_some_and(|e| e == "rs")
                    && !path.ends_with("data_dir.rs")
                    && std::fs::read_to_string(&path)
                        .unwrap()
                        .contains("app_data_dir()")
                {
                    hits.push(path.display().to_string());
                }
            }
        }
        let mut hits = Vec::new();
        walk(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut hits,
        );
        assert!(
            hits.is_empty(),
            "use data_dir::data_dir instead in: {hits:?}"
        );
    }

    #[test]
    fn marker_must_be_a_file() {
        let dir = temp_dir("folder");
        std::fs::create_dir(dir.join(PORTABLE_MARKER)).unwrap();
        assert_eq!(portable_data_dir_for(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

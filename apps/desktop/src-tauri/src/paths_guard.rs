//! Filesystem path guards for Tauri IPC commands (H1 / F1, D45).
//!
//! Enforces two invariants across Windows, macOS, and Linux:
//! 1. Backup restore/delete accept only a plain `.zip` filename inside `backups/`.
//! 2. Free file/directory paths (`export_package`, `import_*`, `save_media_from_path`,
//!    `install_plugin`) must be recorded by the Rust-side file dialog (`PickedPathsState`),
//!    never point inside `data_dir`, and contain no traversal or UNC components.

use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;

use bibalak_core::ipc::{IpcError, IpcErrorKind};

const MAX_PICKED_PATHS: usize = 64;

fn invalid_err(message: impl Into<String>) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Invalid,
        message: message.into(),
    }
}

fn not_found_err(message: impl Into<String>) -> IpcError {
    IpcError {
        kind: IpcErrorKind::NotFound,
        message: message.into(),
    }
}

fn storage_err(message: impl Into<String>) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Storage,
        message: message.into(),
    }
}

/// Resolve a backup archive filename strictly inside `backup_dir`.
///
/// Rejects empty names, whitespace padding, `.` / `..`, path separators (`/` or `\`),
/// drive letters/colons (`:`), NUL bytes, non-`.zip` names, symlinks, and any path
/// whose canonical target escapes `backup_dir`.
pub fn resolve_backup_zip_path(backup_dir: &Path, name: &str) -> Result<PathBuf, IpcError> {
    if name.is_empty()
        || name != name.trim()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0', ':'])
    {
        return Err(invalid_err("invalid backup filename"));
    }

    let mut comps = Path::new(name).components();
    match (comps.next(), comps.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err(invalid_err("invalid backup filename")),
    }

    if name.len() <= 4 || !name.to_ascii_lowercase().ends_with(".zip") {
        return Err(invalid_err("backup file must have a .zip extension"));
    }

    let canon_dir = match std::fs::canonicalize(backup_dir) {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(not_found_err(format!("backup '{name}' not found")));
        }
        Err(e) => return Err(storage_err(e.to_string())),
    };

    let candidate = backup_dir.join(name);
    let meta = match std::fs::symlink_metadata(&candidate) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(not_found_err(format!("backup '{name}' not found")));
        }
        Err(e) => return Err(storage_err(e.to_string())),
    };

    if meta.file_type().is_symlink() {
        return Err(invalid_err("backup path cannot be a symlink"));
    }

    let canon_file = std::fs::canonicalize(&candidate).map_err(|e| storage_err(e.to_string()))?;
    if !canon_file.starts_with(&canon_dir) {
        return Err(invalid_err("backup path escapes backups directory"));
    }
    if !canon_file.is_file() {
        return Err(not_found_err(format!("backup '{name}' not found")));
    }

    Ok(canon_file)
}

/// Validate a raw path string supplied across IPC or returned from a dialog:
/// must be non-empty, NUL-free, absolute, free of `.`/`..` segments, and not a UNC/device path.
pub fn validate_absolute_user_path(raw: &str) -> Result<&Path, IpcError> {
    if raw.trim().is_empty() || raw.contains('\0') {
        return Err(invalid_err("path cannot be empty"));
    }
    if (raw.starts_with("\\\\") && !raw.starts_with("\\\\?\\")) || raw.starts_with("//") {
        return Err(invalid_err("network UNC paths are not allowed"));
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(invalid_err("path must be absolute"));
    }
    for comp in path.components() {
        match comp {
            Component::ParentDir | Component::CurDir => {
                return Err(invalid_err("path traversal segments are not allowed"));
            }
            Component::Prefix(prefix) => {
                if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) {
                    return Err(invalid_err("network UNC or device paths are not allowed"));
                }
            }
            Component::RootDir | Component::Normal(_) => {}
        }
    }
    Ok(path)
}

fn has_allowed_extension(path: &Path, allowed_exts: &[&str]) -> bool {
    if allowed_exts.is_empty() {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| allowed_exts.iter().any(|a| ext.eq_ignore_ascii_case(a)))
}

#[derive(Default)]
struct PickedPaths {
    open_files: VecDeque<PathBuf>,
    open_dirs: VecDeque<PathBuf>,
    save_files: VecDeque<PathBuf>,
}

/// Session-scoped registry of paths explicitly chosen by the user via the native
/// file dialog on the Rust side.
pub struct PickedPathsState {
    data_dir: PathBuf,
    inner: Mutex<PickedPaths>,
}

impl PickedPathsState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            inner: Mutex::new(PickedPaths::default()),
        }
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, PickedPaths>, IpcError> {
        self.inner.lock().map_err(|_| IpcError {
            kind: IpcErrorKind::Internal,
            message: "picked paths state lock poisoned".into(),
        })
    }

    fn data_root(&self) -> PathBuf {
        std::fs::canonicalize(&self.data_dir).unwrap_or_else(|_| self.data_dir.clone())
    }

    fn ensure_outside_data_dir(&self, path: &Path) -> Result<(), IpcError> {
        let root = self.data_root();
        if path.starts_with(&root) {
            return Err(invalid_err(
                "cannot read or write directly inside the Bibalak data folder",
            ));
        }
        Ok(())
    }

    fn push_bounded(queue: &mut VecDeque<PathBuf>, path: PathBuf) {
        queue.retain(|p| p != &path);
        if queue.len() >= MAX_PICKED_PATHS {
            queue.pop_front();
        }
        queue.push_back(path);
    }

    fn normalize_save_target(path: &Path) -> Result<PathBuf, IpcError> {
        let parent = path
            .parent()
            .ok_or_else(|| invalid_err("save path must have a parent directory"))?;
        let file_name = path
            .file_name()
            .ok_or_else(|| invalid_err("save path must include a file name"))?;
        let canon_parent = std::fs::canonicalize(parent)
            .map_err(|e| invalid_err(format!("invalid save directory: {e}")))?;
        let normalized = canon_parent.join(file_name);
        if let Ok(meta) = std::fs::symlink_metadata(&normalized) {
            if meta.file_type().is_symlink() || meta.is_dir() {
                return Err(invalid_err("save target cannot be a directory or symlink"));
            }
        }
        Ok(normalized)
    }

    /// Record a file picked via the open dialog and return its canonical path.
    pub fn record_open_file(&self, path: &Path) -> Result<PathBuf, IpcError> {
        let raw = path
            .to_str()
            .ok_or_else(|| invalid_err("picked path is not valid UTF-8"))?;
        let validated = validate_absolute_user_path(raw)?;
        let canon = std::fs::canonicalize(validated)
            .map_err(|e| not_found_err(format!("picked file not found: {e}")))?;
        if !canon.is_file() {
            return Err(invalid_err("picked path must be a regular file"));
        }
        self.ensure_outside_data_dir(&canon)?;
        let mut guard = self.lock_inner()?;
        Self::push_bounded(&mut guard.open_files, canon.clone());
        Ok(canon)
    }

    /// Record a directory picked via the open-folder dialog and return its canonical path.
    pub fn record_open_dir(&self, path: &Path) -> Result<PathBuf, IpcError> {
        let raw = path
            .to_str()
            .ok_or_else(|| invalid_err("picked path is not valid UTF-8"))?;
        let validated = validate_absolute_user_path(raw)?;
        let canon = std::fs::canonicalize(validated)
            .map_err(|e| not_found_err(format!("picked folder not found: {e}")))?;
        if !canon.is_dir() {
            return Err(invalid_err("picked path must be a folder"));
        }
        self.ensure_outside_data_dir(&canon)?;
        let mut guard = self.lock_inner()?;
        Self::push_bounded(&mut guard.open_dirs, canon.clone());
        Ok(canon)
    }

    /// Record a file destination picked via the save dialog and return its normalized path.
    pub fn record_save_file(&self, path: &Path) -> Result<PathBuf, IpcError> {
        let raw = path
            .to_str()
            .ok_or_else(|| invalid_err("picked path is not valid UTF-8"))?;
        let validated = validate_absolute_user_path(raw)?;
        let normalized = Self::normalize_save_target(validated)?;
        self.ensure_outside_data_dir(&normalized)?;
        let mut guard = self.lock_inner()?;
        Self::push_bounded(&mut guard.save_files, normalized.clone());
        Ok(normalized)
    }

    /// Verify that `raw` is a safe path previously selected via `record_open_file`.
    pub fn verify_open_file(&self, raw: &str, allowed_exts: &[&str]) -> Result<PathBuf, IpcError> {
        let validated = validate_absolute_user_path(raw)?;
        if !has_allowed_extension(validated, allowed_exts) {
            return Err(invalid_err("unsupported file extension"));
        }
        let canon = match std::fs::canonicalize(validated) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(not_found_err(format!("file not found: {raw}")));
            }
            Err(e) => return Err(storage_err(e.to_string())),
        };
        if !canon.is_file() {
            return Err(invalid_err("selected path must be a regular file"));
        }
        self.ensure_outside_data_dir(&canon)?;
        let guard = self.lock_inner()?;
        if !guard.open_files.iter().any(|p| p == &canon) {
            return Err(invalid_err(
                "file path must be chosen through the file dialog",
            ));
        }
        Ok(canon)
    }

    /// Verify that `raw` is a safe directory previously selected via `record_open_dir`.
    pub fn verify_open_dir(&self, raw: &str) -> Result<PathBuf, IpcError> {
        let validated = validate_absolute_user_path(raw)?;
        let canon = match std::fs::canonicalize(validated) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(not_found_err(format!("folder not found: {raw}")));
            }
            Err(e) => return Err(storage_err(e.to_string())),
        };
        if !canon.is_dir() {
            return Err(invalid_err("selected path must be a folder"));
        }
        self.ensure_outside_data_dir(&canon)?;
        let guard = self.lock_inner()?;
        if !guard.open_dirs.iter().any(|p| p == &canon) {
            return Err(invalid_err(
                "folder path must be chosen through the folder dialog",
            ));
        }
        Ok(canon)
    }

    /// Verify that `raw` is a safe save destination previously selected via `record_save_file`.
    pub fn verify_save_file(&self, raw: &str, allowed_exts: &[&str]) -> Result<PathBuf, IpcError> {
        let validated = validate_absolute_user_path(raw)?;
        if !has_allowed_extension(validated, allowed_exts) {
            return Err(invalid_err("unsupported export file extension"));
        }
        let normalized = Self::normalize_save_target(validated)?;
        self.ensure_outside_data_dir(&normalized)?;
        let guard = self.lock_inner()?;
        if !guard.save_files.iter().any(|p| p == &normalized) {
            return Err(invalid_err(
                "export path must be chosen through the file dialog",
            ));
        }
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let uniq = format!(
            "keepsake_paths_guard_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(uniq);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backup_name_cannot_leave_backups_folder() {
        let root = temp_dir("backup");
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let valid = backups.join("1700000000000.zip");
        std::fs::write(&valid, b"zip").unwrap();
        let outside = root.join("collection.sqlite");
        std::fs::write(&outside, b"db").unwrap();
        let outside_zip = root.join("outside.zip");
        std::fs::write(&outside_zip, b"zip").unwrap();

        let resolved = resolve_backup_zip_path(&backups, "1700000000000.zip").unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&valid).unwrap());

        for bad in [
            "",
            "   ",
            ".",
            "..",
            "../collection.sqlite",
            "..\\collection.sqlite",
            "../outside.zip",
            "..\\outside.zip",
            "sub/1700000000000.zip",
            "sub\\1700000000000.zip",
            "/etc/passwd.zip",
            "C:\\temp\\evil.zip",
            "C:evil.zip",
            "\\\\server\\share\\evil.zip",
            "//server/share/evil.zip",
            "not_a_zip.txt",
            ".zip",
            "1700000000000.zip ",
            "bad\0.zip",
            &outside_zip.to_string_lossy(),
        ] {
            let err = resolve_backup_zip_path(&backups, bad).unwrap_err();
            assert_eq!(
                err.kind,
                IpcErrorKind::Invalid,
                "expected Invalid for {bad:?}, got {err:?}"
            );
        }

        // Symlink inside backups/ pointing outside must also be rejected when OS permits symlinks.
        let link = backups.join("escape.zip");
        #[cfg(unix)]
        if std::os::unix::fs::symlink(&outside_zip, &link).is_ok() {
            let err = resolve_backup_zip_path(&backups, "escape.zip").unwrap_err();
            assert_eq!(err.kind, IpcErrorKind::Invalid);
        }
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&outside_zip, &link).is_ok() {
            let err = resolve_backup_zip_path(&backups, "escape.zip").unwrap_err();
            assert_eq!(err.kind, IpcErrorKind::Invalid);
        }

        let missing = resolve_backup_zip_path(&backups, "1700000000999.zip").unwrap_err();
        assert_eq!(missing.kind, IpcErrorKind::NotFound);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn picked_paths_enforces_dialog_selection_and_blocks_data_dir() {
        let root = temp_dir("picked");
        let data_dir = root.join("data");
        let external_dir = root.join("external");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&external_dir).unwrap();

        let internal_file = data_dir.join("collection.sqlite");
        std::fs::write(&internal_file, b"db").unwrap();
        let ext_file = external_dir.join("deck.apkg");
        std::fs::write(&ext_file, b"apkg").unwrap();

        let state = PickedPathsState::new(data_dir.clone());

        assert!(state.record_open_file(&internal_file).is_err());
        assert!(state.record_open_dir(&data_dir).is_err());
        assert!(state.record_save_file(&data_dir.join("out.apkg")).is_err());

        // Unpicked external file is rejected.
        assert!(state
            .verify_open_file(&ext_file.to_string_lossy(), &["apkg"])
            .is_err());

        // Picked external file is accepted with matching extension, rejected with wrong ext.
        let recorded = state.record_open_file(&ext_file).unwrap();
        assert_eq!(
            state
                .verify_open_file(&recorded.to_string_lossy(), &["apkg", "colpkg"])
                .unwrap(),
            recorded
        );
        assert!(state
            .verify_open_file(&recorded.to_string_lossy(), &["csv"])
            .is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_disk_path_allowed() {
        assert!(validate_absolute_user_path(r"\\?\C:\Users\demo\deck.apkg").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn globalroot_verbatim_rejected() {
        let err = validate_absolute_user_path(
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\Windows\System32\config\SAM",
        )
        .unwrap_err();
        assert_eq!(err.kind, IpcErrorKind::Invalid);
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_unc_rejected() {
        let err = validate_absolute_user_path(r"\\?\UNC\server\share\deck.apkg").unwrap_err();
        assert_eq!(err.kind, IpcErrorKind::Invalid);
    }

    #[cfg(windows)]
    #[test]
    fn device_namespace_rejected() {
        let err = validate_absolute_user_path(r"\\.\COM1").unwrap_err();
        assert_eq!(err.kind, IpcErrorKind::Invalid);
    }

    #[test]
    fn plain_unc_rejected() {
        for bad in [r"\\server\share\deck.apkg", "//server/share/deck.apkg"] {
            let err = validate_absolute_user_path(bad).unwrap_err();
            assert_eq!(err.kind, IpcErrorKind::Invalid);
        }
    }
}

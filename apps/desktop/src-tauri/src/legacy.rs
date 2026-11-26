//! One-time move of data from the pre-rename app folder.
//!
//! The bundle identifier changed from `com.synapse.app` to
//! `com.keepsake.desktop`, so the OS app-data folder changed with it. On the
//! first launch after the rename, copy the old collection, media, backups and
//! plugins into the new folder. The old folder is left untouched (a copy, not
//! a move) so nothing is lost if the copy is interrupted.

use std::io;
use std::path::{Path, PathBuf};

/// Bundle identifier used before the rename.
pub const LEGACY_IDENTIFIER: &str = "com.synapse.app";

/// Marker file created in `new_dir` while phase 2 (media/backups) is pending.
pub const LEGACY_MARKER: &str = "legacy-migration.pending";

/// Name of the collection database; its presence marks a finished phase 1.
const COLLECTION_DB: &str = "collection.sqlite";

/// Database sidecars that must stay paired with `collection.sqlite` in phase 1.
const PHASE1_FILES: &[&str] = &["collection.sqlite-wal", "collection.sqlite-shm"];

/// Directories needed before the UI/plugins initialize in phase 1.
const PHASE1_DIRS: &[&str] = &["plugins"];

/// Webview profile data: browser-owned, may be locked, not worth carrying over.
const SKIPPED: &[&str] = &["EBWebView"];

/// Suffix for temporary files written before atomic rename into `collection.media`.
const PARTIAL_SUFFIX: &str = ".keepsake-partial";

/// Returns `true` when phase 2 of legacy migration still needs to finish.
pub fn legacy_copy_pending(new_dir: &Path) -> bool {
    new_dir.join(LEGACY_MARKER).is_file()
}

/// Reject media cleanup/checks while phase 2 legacy migration still has
/// uncopied files, because checking or deleting before phase 2 finishes
/// would act on a partial media directory.
pub fn ensure_no_legacy_copy_pending(new_dir: &Path) -> Result<(), bibalak_core::ipc::IpcError> {
    if legacy_copy_pending(new_dir) {
        return Err(bibalak_core::ipc::IpcError {
            kind: bibalak_core::ipc::IpcErrorKind::Invalid,
            message: "Media from the old app folder is still being copied. Cleanup is available when it finishes.".into(),
        });
    }
    Ok(())
}

/// Phase 1 (blocking, small): copy the collection DB, WAL/SHM, and `plugins/`
/// into `new_dir`, writing [`LEGACY_MARKER`] before the DB rename.
/// Returns `true` when a phase 1 migration happened.
pub fn migrate_legacy_core(legacy_dir: &Path, new_dir: &Path) -> io::Result<bool> {
    if new_dir.join(COLLECTION_DB).exists() || !legacy_dir.join(COLLECTION_DB).is_file() {
        return Ok(false);
    }
    std::fs::create_dir_all(new_dir)?;

    for name in PHASE1_FILES {
        let src = legacy_dir.join(name);
        if src.is_file() {
            std::fs::copy(&src, new_dir.join(name))?;
        }
    }

    for dir_name in PHASE1_DIRS {
        let src = legacy_dir.join(dir_name);
        if src.is_dir() {
            copy_dir_if_missing(&src, &new_dir.join(dir_name))?;
        }
    }

    let staged = new_dir.join(format!("{COLLECTION_DB}.migrating"));
    std::fs::copy(legacy_dir.join(COLLECTION_DB), &staged)?;

    let marker = new_dir.join(LEGACY_MARKER);
    std::fs::write(&marker, b"")?;

    if let Err(e) = std::fs::rename(&staged, new_dir.join(COLLECTION_DB)) {
        let _ = std::fs::remove_file(&marker);
        return Err(e);
    }
    Ok(true)
}

/// Phase 2 (background, resumable): copy `collection.media/`, `backups/`, and
/// remaining non-skipped entries, skipping any file that already exists at the
/// destination, copying through a `.keepsake-partial` temp file before rename,
/// and removing [`LEGACY_MARKER`] when complete.
pub fn copy_legacy_rest(legacy_dir: &Path, new_dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(new_dir)?;
    cleanup_partial_files(new_dir)?;

    for entry in std::fs::read_dir(legacy_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == COLLECTION_DB
            || name == LEGACY_MARKER
            || PHASE1_FILES.iter().any(|s| name == *s)
            || PHASE1_DIRS.iter().any(|s| name == *s)
            || SKIPPED.iter().any(|s| name == *s)
        {
            continue;
        }
        let dest = new_dir.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_if_missing(&entry.path(), &dest)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&entry.path(), &dest)?;
        }
    }

    match std::fs::remove_file(new_dir.join(LEGACY_MARKER)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Resolve a `bibalak-media` filename to the file path to read, falling back
/// to `legacy_dir/collection.media/<name>` when `pending` is `true` and the
/// file is not yet in `new_dir/collection.media`.
pub fn resolve_media_path(
    name: &str,
    new_dir: &Path,
    legacy_dir: &Path,
    pending: bool,
) -> Option<PathBuf> {
    if !is_safe_media_name(name) {
        return None;
    }
    let new_path = new_dir.join("collection.media").join(name);
    if new_path.is_file() {
        return Some(new_path);
    }
    if pending {
        let legacy_path = legacy_dir.join("collection.media").join(name);
        if legacy_path.is_file() {
            return Some(legacy_path);
        }
    }
    None
}

fn is_safe_media_name(name: &str) -> bool {
    if name.trim().is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0', ':'])
    {
        return false;
    }
    let mut comps = Path::new(name).components();
    matches!(
        (comps.next(), comps.next()),
        (Some(std::path::Component::Normal(_)), None)
    )
}

fn partial_path(dst: &Path) -> PathBuf {
    let mut s = dst.as_os_str().to_os_string();
    s.push(PARTIAL_SUFFIX);
    PathBuf::from(s)
}

fn cleanup_partial_files(dir: &Path) -> io::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if !SKIPPED.iter().any(|s| name == *s) {
                cleanup_partial_files(&entry.path())?;
            }
            continue;
        }
        let is_partial = name.to_str().is_some_and(|s| s.ends_with(PARTIAL_SUFFIX));
        if is_partial && file_type.is_file() {
            match std::fs::remove_file(entry.path()) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
    }
    Ok(())
}

fn copy_file_if_missing(src: &Path, dst: &Path) -> io::Result<()> {
    if dst.try_exists()? {
        return Ok(());
    }
    let tmp = partial_path(dst);
    if let Err(e) = std::fs::copy(src, &tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, dst) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn copy_dir_if_missing(src: &Path, dst: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_if_missing(&entry.path(), &dest)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&entry.path(), &dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Unique temp dir per test, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "keepsake-legacy-{tag}-{}-{}",
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

    fn legacy_fixture(root: &Path) -> PathBuf {
        let legacy = root.join(LEGACY_IDENTIFIER);
        fs::create_dir_all(legacy.join("collection.media")).unwrap();
        fs::create_dir_all(legacy.join("backups")).unwrap();
        fs::create_dir_all(legacy.join("plugins/sample")).unwrap();
        fs::create_dir_all(legacy.join("EBWebView/Default")).unwrap();
        fs::write(legacy.join(COLLECTION_DB), b"db").unwrap();
        fs::write(legacy.join("collection.sqlite-wal"), b"wal-bytes").unwrap();
        fs::write(legacy.join("collection.sqlite-shm"), b"shm-bytes").unwrap();
        fs::write(legacy.join("plugins/sample/manifest.json"), b"{}").unwrap();
        fs::write(legacy.join("collection.media/a.png"), b"img").unwrap();
        fs::write(legacy.join("collection.media/b.mp3"), b"audio-data").unwrap();
        fs::write(legacy.join("backups/b1.colpkg"), b"bak").unwrap();
        fs::write(legacy.join("EBWebView/Default/x"), b"web").unwrap();
        legacy
    }

    #[test]
    fn phase1_copies_db_wal_shm_and_plugins_not_media_and_writes_marker() {
        let tmp = TempDir::new("phase1");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");

        assert!(migrate_legacy_core(&legacy, &new_dir).unwrap());

        assert_eq!(fs::read(new_dir.join(COLLECTION_DB)).unwrap(), b"db");
        assert_eq!(
            fs::read(new_dir.join("collection.sqlite-wal")).unwrap(),
            b"wal-bytes"
        );
        assert_eq!(
            fs::read(new_dir.join("collection.sqlite-shm")).unwrap(),
            b"shm-bytes"
        );
        assert_eq!(
            fs::read(new_dir.join("plugins/sample/manifest.json")).unwrap(),
            b"{}"
        );
        assert!(legacy_copy_pending(&new_dir));
        assert!(!new_dir.join("collection.media").exists());
        assert!(!new_dir.join("backups").exists());
        assert!(!new_dir.join("EBWebView").exists());
        assert!(!new_dir.join("collection.sqlite.migrating").exists());
        // The legacy folder is a copy source only.
        assert_eq!(fs::read(legacy.join(COLLECTION_DB)).unwrap(), b"db");
    }

    #[test]
    fn phase2_copies_media_and_backups_and_removes_marker() {
        let tmp = TempDir::new("phase2");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");

        assert!(migrate_legacy_core(&legacy, &new_dir).unwrap());
        assert!(legacy_copy_pending(&new_dir));

        copy_legacy_rest(&legacy, &new_dir).unwrap();

        assert!(!legacy_copy_pending(&new_dir));
        assert_eq!(
            fs::read(new_dir.join("collection.media/a.png")).unwrap(),
            b"img"
        );
        assert_eq!(
            fs::read(new_dir.join("collection.media/b.mp3")).unwrap(),
            b"audio-data"
        );
        assert_eq!(fs::read(new_dir.join("backups/b1.colpkg")).unwrap(), b"bak");
        assert!(
            !new_dir.join("EBWebView").exists(),
            "webview profile is not copied"
        );
    }

    #[test]
    fn phase2_never_overwrites_an_existing_file() {
        let tmp = TempDir::new("never-overwrite");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");
        migrate_legacy_core(&legacy, &new_dir).unwrap();

        fs::create_dir_all(new_dir.join("collection.media")).unwrap();
        // Same size (3 bytes) as legacy "img", different bytes -> must be skipped.
        fs::write(new_dir.join("collection.media/a.png"), b"XYZ").unwrap();
        // Different size (3 bytes vs 10 bytes "audio-data") -> must ALSO be skipped, never overwritten.
        fs::write(new_dir.join("collection.media/b.mp3"), b"old").unwrap();

        copy_legacy_rest(&legacy, &new_dir).unwrap();

        assert_eq!(
            fs::read(new_dir.join("collection.media/a.png")).unwrap(),
            b"XYZ"
        );
        assert_eq!(
            fs::read(new_dir.join("collection.media/b.mp3")).unwrap(),
            b"old"
        );
        assert!(!legacy_copy_pending(&new_dir));
    }

    #[test]
    fn phase2_removes_leftover_partial_files_and_finishes() {
        let tmp = TempDir::new("partial-cleanup");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");
        migrate_legacy_core(&legacy, &new_dir).unwrap();

        let media_dir = new_dir.join("collection.media");
        fs::create_dir_all(&media_dir).unwrap();
        fs::write(media_dir.join("a.png"), b"img").unwrap();
        fs::write(media_dir.join("b.mp3.keepsake-partial"), b"half").unwrap();
        fs::write(media_dir.join("stale.png.keepsake-partial"), b"orphan").unwrap();
        fs::write(media_dir.join("unrelated.png"), b"keep-me").unwrap();

        copy_legacy_rest(&legacy, &new_dir).unwrap();

        assert!(!media_dir.join("b.mp3.keepsake-partial").exists());
        assert!(!media_dir.join("stale.png.keepsake-partial").exists());
        assert_eq!(fs::read(media_dir.join("b.mp3")).unwrap(), b"audio-data");
        assert_eq!(
            fs::read(media_dir.join("unrelated.png")).unwrap(),
            b"keep-me"
        );
        assert!(!legacy_copy_pending(&new_dir));
    }

    #[test]
    fn phase2_removes_leftover_partial_files_in_backups_and_keeps_finished_files() {
        let tmp = TempDir::new("partial-cleanup-backups");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");
        migrate_legacy_core(&legacy, &new_dir).unwrap();

        let backups_dir = new_dir.join("backups");
        fs::create_dir_all(&backups_dir).unwrap();
        fs::write(backups_dir.join("x.keepsake-partial"), b"half").unwrap();
        fs::write(backups_dir.join("existing.colpkg"), b"keep-me").unwrap();

        copy_legacy_rest(&legacy, &new_dir).unwrap();

        assert!(!backups_dir.join("x.keepsake-partial").exists());
        assert_eq!(
            fs::read(backups_dir.join("existing.colpkg")).unwrap(),
            b"keep-me"
        );
        assert_eq!(fs::read(backups_dir.join("b1.colpkg")).unwrap(), b"bak");
        assert!(!legacy_copy_pending(&new_dir));
    }

    #[test]
    fn ensure_no_legacy_copy_pending_blocks_only_when_marker_exists() {
        let tmp = TempDir::new("pending-guard");
        assert!(ensure_no_legacy_copy_pending(&tmp.0).is_ok());

        fs::write(tmp.0.join(LEGACY_MARKER), b"").unwrap();
        let err = ensure_no_legacy_copy_pending(&tmp.0).unwrap_err();
        assert_eq!(err.kind, bibalak_core::ipc::IpcErrorKind::Invalid);
        assert!(err.message.contains("still being copied"));
    }

    #[test]
    fn interrupted_run_with_marker_and_partial_media_resumes_and_finishes() {
        let tmp = TempDir::new("resume");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");

        assert!(migrate_legacy_core(&legacy, &new_dir).unwrap());
        fs::create_dir_all(new_dir.join("collection.media")).unwrap();
        fs::write(new_dir.join("collection.media/a.png"), b"img").unwrap();
        assert!(legacy_copy_pending(&new_dir));

        // Second launch sees marker + partial media: phase 1 is a no-op, phase 2 finishes.
        assert!(!migrate_legacy_core(&legacy, &new_dir).unwrap());
        assert!(legacy_copy_pending(&new_dir));
        copy_legacy_rest(&legacy, &new_dir).unwrap();

        assert!(!legacy_copy_pending(&new_dir));
        assert_eq!(
            fs::read(new_dir.join("collection.media/b.mp3")).unwrap(),
            b"audio-data"
        );
        assert_eq!(fs::read(new_dir.join("backups/b1.colpkg")).unwrap(), b"bak");
    }

    #[test]
    fn half_migrated_folder_without_db_or_marker_runs_phase1_and_skips_copied_media() {
        let tmp = TempDir::new("owners-case");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");

        // Owner's case: old copy left media in new_dir without collection.sqlite or marker.
        fs::create_dir_all(new_dir.join("collection.media")).unwrap();
        fs::write(new_dir.join("collection.media/a.png"), b"XYZ").unwrap();

        assert!(migrate_legacy_core(&legacy, &new_dir).unwrap());
        assert!(legacy_copy_pending(&new_dir));
        assert_eq!(fs::read(new_dir.join(COLLECTION_DB)).unwrap(), b"db");

        copy_legacy_rest(&legacy, &new_dir).unwrap();
        assert!(!legacy_copy_pending(&new_dir));
        // Existing same-size file was kept (skipped), remaining files copied.
        assert_eq!(
            fs::read(new_dir.join("collection.media/a.png")).unwrap(),
            b"XYZ"
        );
        assert_eq!(
            fs::read(new_dir.join("collection.media/b.mp3")).unwrap(),
            b"audio-data"
        );
    }

    #[test]
    fn never_overwrites_an_existing_new_collection() {
        let tmp = TempDir::new("keep");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(new_dir.join(COLLECTION_DB), b"new").unwrap();

        assert!(!migrate_legacy_core(&legacy, &new_dir).unwrap());
        assert!(!legacy_copy_pending(&new_dir));
        assert_eq!(fs::read(new_dir.join(COLLECTION_DB)).unwrap(), b"new");
        assert!(!new_dir.join("collection.media").exists());
    }

    #[test]
    fn does_nothing_without_a_legacy_collection() {
        let tmp = TempDir::new("none");
        let new_dir = tmp.0.join("com.keepsake.desktop");
        let legacy = tmp.0.join(LEGACY_IDENTIFIER);

        assert!(!migrate_legacy_core(&legacy, &new_dir).unwrap());
        assert!(!legacy_copy_pending(&new_dir));
        assert!(!new_dir.exists());
    }

    #[test]
    fn resolve_media_path_falls_back_to_legacy_only_when_pending_and_missing_in_new() {
        let tmp = TempDir::new("fallback");
        let legacy = legacy_fixture(&tmp.0);
        let new_dir = tmp.0.join("com.keepsake.desktop");
        fs::create_dir_all(new_dir.join("collection.media")).unwrap();
        fs::write(new_dir.join("collection.media/a.png"), b"new-img").unwrap();

        // Present in new_dir -> always reads from new_dir.
        assert_eq!(
            resolve_media_path("a.png", &new_dir, &legacy, true),
            Some(new_dir.join("collection.media/a.png"))
        );
        // Missing in new_dir, pending=true, present in legacy -> falls back to legacy.
        assert_eq!(
            resolve_media_path("b.mp3", &new_dir, &legacy, true),
            Some(legacy.join("collection.media/b.mp3"))
        );
        // Missing in new_dir, pending=false -> None.
        assert_eq!(resolve_media_path("b.mp3", &new_dir, &legacy, false), None);
        // Missing everywhere -> None.
        assert_eq!(
            resolve_media_path("missing.mp3", &new_dir, &legacy, true),
            None
        );
        // Unsafe paths -> None.
        assert_eq!(
            resolve_media_path("../collection.sqlite", &new_dir, &legacy, true),
            None
        );
        assert_eq!(
            resolve_media_path("sub/a.png", &new_dir, &legacy, true),
            None
        );
        assert_eq!(resolve_media_path("", &new_dir, &legacy, true), None);
    }
}

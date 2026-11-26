use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use bibalak_core::ai::html_to_plain_text;
use bibalak_core::ipc::{
    IpcError, IpcErrorKind, PluginDeckDto, PluginInfo, PluginNoteDto, PluginNoteFieldDto,
};
use bibalak_core::media_refs::extract_media_refs;
use bibalak_core::Collection;
use bibalak_plugin::{is_safe_id, Capability, PluginError, PluginManager, PluginRecord};
use tauri::{AppHandle, Manager};

use super::{run_blocking, state_err};

type IpcResult<T> = Result<T, IpcError>;

const MAX_PLUGIN_ZIP_FILES: usize = 256;
const MAX_PLUGIN_ZIP_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PLUGIN_DECKS: usize = 500;
const MAX_PLUGIN_NOTES_LIMIT: i64 = 200;
const MAX_PLUGIN_QUERY_CHARS: usize = 500;
const MAX_PLUGIN_MISSING_MEDIA: usize = 1000;

fn plugin_err(e: PluginError) -> IpcError {
    let (kind, message) = match e {
        PluginError::NotFound(msg) => (IpcErrorKind::NotFound, msg),
        PluginError::InvalidManifest(msg) => (IpcErrorKind::Invalid, msg),
        PluginError::PermissionDenied(msg) => (IpcErrorKind::Invalid, msg),
        PluginError::Json(e) => (IpcErrorKind::Format, e.to_string()),
        PluginError::Io(e) => (IpcErrorKind::Internal, e.to_string()),
    };
    IpcError { kind, message }
}

/// Lock the plugin manager, turning a poisoned lock into an IPC error instead of a panic.
fn lock_manager(mgr: &Mutex<PluginManager>) -> IpcResult<MutexGuard<'_, PluginManager>> {
    mgr.lock().map_err(|_| IpcError {
        kind: IpcErrorKind::Internal,
        message: "plugin manager lock poisoned".into(),
    })
}

fn to_info(r: &PluginRecord) -> PluginInfo {
    PluginInfo {
        id: r.manifest.id.clone(),
        name: r.manifest.name.clone(),
        version: r.manifest.version.clone(),
        api_version: r.manifest.api_version.clone(),
        description: r.manifest.description.clone(),
        author: r.manifest.author.clone(),
        permissions: r.manifest.permission_strings(),
        enabled: r.enabled,
    }
}

fn validate_plugin_id(id: &str) -> IpcResult<()> {
    if !is_safe_id(id) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("invalid plugin id '{id}'"),
        });
    }
    Ok(())
}

/// Safely extract a plugin `.zip` archive into `dest`, enforcing entry-count,
/// total-uncompressed-size, symlink, and zip-slip bounds. Returns the directory
/// containing `plugin.json` (either `dest` or a single top-level directory).
pub(crate) fn extract_plugin_zip(zip_path: &Path, dest: &Path) -> IpcResult<PathBuf> {
    let file = std::fs::File::open(zip_path).map_err(|e| IpcError {
        kind: IpcErrorKind::Storage,
        message: format!("failed to open plugin zip: {e}"),
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| IpcError {
        kind: IpcErrorKind::Format,
        message: format!("invalid plugin zip archive: {e}"),
    })?;

    if archive.len() > MAX_PLUGIN_ZIP_FILES {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("plugin zip contains too many entries (max {MAX_PLUGIN_ZIP_FILES})"),
        });
    }

    std::fs::create_dir_all(dest).map_err(|e| IpcError {
        kind: IpcErrorKind::Storage,
        message: e.to_string(),
    })?;

    let mut total_bytes: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| IpcError {
            kind: IpcErrorKind::Format,
            message: format!("corrupt zip entry: {e}"),
        })?;

        if entry
            .unix_mode()
            .is_some_and(|m| (m & 0o170000) == 0o120000)
        {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: "symlinks are not allowed inside plugin archives".into(),
            });
        }

        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: "unsafe path inside plugin archive".into(),
            });
        };

        if rel_path.as_os_str().is_empty() {
            continue;
        }

        let out_path = dest.join(&rel_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| IpcError {
                kind: IpcErrorKind::Storage,
                message: e.to_string(),
            })?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| IpcError {
                kind: IpcErrorKind::Storage,
                message: e.to_string(),
            })?;
        }

        let remaining = MAX_PLUGIN_ZIP_BYTES.saturating_sub(total_bytes);
        let mut buf = Vec::new();
        entry
            .take(remaining.saturating_add(1))
            .read_to_end(&mut buf)
            .map_err(|e| IpcError {
                kind: IpcErrorKind::Format,
                message: format!("failed to read zip entry: {e}"),
            })?;

        total_bytes = total_bytes.saturating_add(buf.len() as u64);
        if total_bytes > MAX_PLUGIN_ZIP_BYTES {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: "plugin zip exceeds maximum extracted size (10 MB)".into(),
            });
        }

        std::fs::write(&out_path, &buf).map_err(|e| IpcError {
            kind: IpcErrorKind::Storage,
            message: e.to_string(),
        })?;
    }

    if dest.join("plugin.json").is_file() {
        return Ok(dest.to_path_buf());
    }

    // Support archives that wrap the plugin inside one top-level folder.
    let top_dirs: Vec<PathBuf> = std::fs::read_dir(dest)
        .map_err(|e| IpcError {
            kind: IpcErrorKind::Storage,
            message: e.to_string(),
        })?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n != "__MACOSX")
        })
        .collect();

    if top_dirs.len() == 1 && top_dirs[0].join("plugin.json").is_file() {
        return Ok(top_dirs[0].clone());
    }

    Err(IpcError {
        kind: IpcErrorKind::Invalid,
        message:
            "plugin zip must contain plugin.json at its root or inside a single top-level folder"
                .into(),
    })
}

#[tauri::command]
pub async fn list_plugins(app: AppHandle) -> IpcResult<Vec<PluginInfo>> {
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let mgr = lock_manager(&mgr)?;
        mgr.list()
            .map(|records| records.iter().map(to_info).collect())
            .map_err(plugin_err)
    })
    .await
}

#[tauri::command]
pub async fn enable_plugin(app: AppHandle, id: String) -> IpcResult<()> {
    validate_plugin_id(&id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let res = lock_manager(&mgr)?.enable(&id).map_err(plugin_err);
        res
    })
    .await
}

#[tauri::command]
pub async fn disable_plugin(app: AppHandle, id: String) -> IpcResult<()> {
    validate_plugin_id(&id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let res = lock_manager(&mgr)?.disable(&id).map_err(plugin_err);
        res
    })
    .await
}

#[tauri::command]
pub async fn remove_plugin(app: AppHandle, id: String) -> IpcResult<()> {
    validate_plugin_id(&id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let res = lock_manager(&mgr)?.remove(&id).map_err(plugin_err);
        res
    })
    .await
}

/// Install a plugin from a directory chosen by the user.
#[tauri::command]
pub async fn install_plugin(app: AppHandle, path: String) -> IpcResult<PluginInfo> {
    run_blocking(move || {
        let picked = app
            .try_state::<crate::paths_guard::PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let src = picked.verify_open_dir(&path)?;
        let record = lock_manager(&mgr)?.install(&src).map_err(plugin_err)?;
        Ok(to_info(&record))
    })
    .await
}

/// Install a plugin from a `.zip` archive chosen by the user.
#[tauri::command]
pub async fn install_plugin_zip(app: AppHandle, path: String) -> IpcResult<PluginInfo> {
    run_blocking(move || {
        let picked = app
            .try_state::<crate::paths_guard::PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let zip_path = picked.verify_open_file(&path, &["zip"])?;

        let uniq = format!(
            "keepsake_plugin_zip_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let tmp_dir = std::env::temp_dir().join(uniq);
        let res = (|| {
            let root = extract_plugin_zip(&zip_path, &tmp_dir)?;
            let record = lock_manager(&mgr)?.install(&root).map_err(plugin_err)?;
            Ok(to_info(&record))
        })();
        let _ = std::fs::remove_dir_all(&tmp_dir);
        res
    })
    .await
}

/// Install the bundled API 0.2.0 sample plugins.
#[tauri::command]
pub async fn install_sample_plugins(app: AppHandle) -> IpcResult<Vec<PluginInfo>> {
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let records = lock_manager(&mgr)?.install_samples().map_err(plugin_err)?;
        Ok(records.iter().map(to_info).collect())
    })
    .await
}

/// Return the entry-point JS source for a plugin so the frontend can create a Worker.
#[tauri::command]
pub async fn get_plugin_entry(app: AppHandle, id: String) -> IpcResult<String> {
    validate_plugin_id(&id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        let res = lock_manager(&mgr)?.read_entry(&id).map_err(plugin_err);
        res
    })
    .await
}

/// Read deck summaries on behalf of an enabled plugin holding `read:decks`.
#[tauri::command]
pub async fn plugin_read_decks(app: AppHandle, plugin_id: String) -> IpcResult<Vec<PluginDeckDto>> {
    validate_plugin_id(&plugin_id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        lock_manager(&mgr)?
            .require_enabled_capability(&plugin_id, Capability::ReadDecks)
            .map_err(plugin_err)?;

        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let decks = collection.list_decks_with_counts()?;
        Ok(decks
            .into_iter()
            .take(MAX_PLUGIN_DECKS)
            .map(
                |(d, (new_count, learning_count, review_count))| PluginDeckDto {
                    id: d.id,
                    name: d.name,
                    parent_id: d.parent_id,
                    new_count,
                    learning_count,
                    review_count,
                    due_today: new_count
                        .saturating_add(learning_count)
                        .saturating_add(review_count),
                    is_filtered: d.is_filtered,
                },
            )
            .collect())
    })
    .await
}

/// Search notes on behalf of an enabled plugin holding `read:notes`.
/// Fields are converted to plain text and media filenames are extracted safely.
#[tauri::command]
pub async fn plugin_read_notes(
    app: AppHandle,
    plugin_id: String,
    query: String,
    limit: Option<i64>,
) -> IpcResult<Vec<PluginNoteDto>> {
    validate_plugin_id(&plugin_id)?;
    if query.chars().count() > MAX_PLUGIN_QUERY_CHARS {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("plugin search query exceeds {MAX_PLUGIN_QUERY_CHARS} characters"),
        });
    }
    let capped_limit = limit.unwrap_or(50).clamp(1, MAX_PLUGIN_NOTES_LIMIT);

    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        lock_manager(&mgr)?
            .require_enabled_capability(&plugin_id, Capability::ReadNotes)
            .map_err(plugin_err)?;

        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let rows = collection.search_note_rows(query.trim(), capped_limit, 0, None, true)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let Some(detail) = collection.note_detail(row.note_id)? else {
                continue;
            };
            let mut media_refs = std::collections::BTreeSet::new();
            let fields = detail
                .fields
                .into_iter()
                .map(|f| {
                    media_refs.extend(extract_media_refs(&f.value));
                    PluginNoteFieldDto {
                        name: f.name,
                        text: html_to_plain_text(&f.value),
                    }
                })
                .collect();
            out.push(PluginNoteDto {
                note_id: row.note_id,
                deck: row.deck,
                notetype: row.notetype,
                sort_field: html_to_plain_text(&row.sort_field),
                tags: row.tags,
                fields,
                media_refs: media_refs.into_iter().collect(),
            });
        }
        Ok(out)
    })
    .await
}

/// Return missing media filenames referenced in notes for an enabled plugin holding `read:notes`.
#[tauri::command]
pub async fn plugin_check_media_missing(
    app: AppHandle,
    plugin_id: String,
) -> IpcResult<Vec<String>> {
    validate_plugin_id(&plugin_id)?;
    run_blocking(move || {
        let mgr = app
            .try_state::<Mutex<PluginManager>>()
            .ok_or_else(|| state_err("PluginManager"))?;
        lock_manager(&mgr)?
            .require_enabled_capability(&plugin_id, Capability::ReadNotes)
            .map_err(plugin_err)?;

        let col = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let media = app
            .try_state::<crate::MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        let report = media.0.check_media(col.storage()).map_err(IpcError::from)?;
        Ok(report
            .missing_files
            .into_iter()
            .take(MAX_PLUGIN_MISSING_MEDIA)
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp_dir(tag: &str) -> PathBuf {
        let uniq = format!(
            "keepsake_plugin_cmd_{tag}_{}_{}",
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
    fn poisoned_manager_lock_is_an_ipc_error_not_a_panic() {
        let mgr = Mutex::new(PluginManager::new(&std::env::temp_dir()));
        let _ = std::panic::catch_unwind(|| {
            let _guard = mgr.lock();
            panic!("poison the lock");
        });
        assert!(mgr.is_poisoned());

        let err = lock_manager(&mgr).err().map(|e| e.kind);
        assert!(matches!(err, Some(IpcErrorKind::Internal)));
    }

    #[test]
    fn extract_plugin_zip_handles_root_and_single_subfolder_and_rejects_traversal() {
        let root = temp_dir("zip");
        let zip_ok = root.join("nested.zip");
        {
            let f = std::fs::File::create(&zip_ok).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = SimpleFileOptions::default();
            zw.start_file("my-plugin/plugin.json", opts).unwrap();
            zw.write_all(
                br#"{"id":"my-plugin","name":"My Plugin","version":"1.0.0","entry":"index.js","apiVersion":"0.2.0","permissions":["ui:command"]}"#,
            )
            .unwrap();
            zw.start_file("my-plugin/index.js", opts).unwrap();
            zw.write_all(b"BibalakPlugin.definePlugin({ activate: function() {} });")
                .unwrap();
            zw.finish().unwrap();
        }

        let out_ok = root.join("out_ok");
        let extracted = extract_plugin_zip(&zip_ok, &out_ok).unwrap();
        assert!(extracted.join("plugin.json").is_file());
        assert!(extracted.join("index.js").is_file());

        let zip_evil = root.join("evil.zip");
        {
            let f = std::fs::File::create(&zip_evil).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = SimpleFileOptions::default();
            zw.start_file("../escape.txt", opts).unwrap();
            zw.write_all(b"nope").unwrap();
            zw.finish().unwrap();
        }
        let out_evil = root.join("out_evil");
        let err = extract_plugin_zip(&zip_evil, &out_evil).unwrap_err();
        assert_eq!(err.kind, IpcErrorKind::Invalid);

        let _ = std::fs::remove_dir_all(&root);
    }
}

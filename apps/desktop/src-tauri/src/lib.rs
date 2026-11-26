//! Bibalak desktop shell.
//!
//! This crate is deliberately thin: it owns the Tauri window/runtime, opens the
//! collection at startup, registers the IPC command surface, and bridges core
//! [`DomainEvent`]s to the webview. All real work lives in `bibalak-core`.

mod commands;
mod data_dir;
mod legacy;
mod paths_guard;
mod quick_add;
mod window_state;

use bibalak_db::backup as db_backup;
use bibalak_plugin::PluginManager;
use std::sync::{Arc, Mutex};
use tracing_subscriber::{fmt, EnvFilter};

use bibalak_core::{Collection, DomainEvent, MediaStore, SystemClock};
use bibalak_db::SqliteStorage;
use bibalak_media::FsMediaStore;
use bibalak_search::NoteIndex;
use percent_encoding::percent_decode_str;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use commands::app::{StartupErrorInfo, StartupErrorState};

fn mime_for(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "opus" => "audio/opus",
        "weba" => "audio/webm",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",
        _ => "application/octet-stream",
    }
}

/// Tauri managed state wrapping the search index.
pub struct SearchState(pub Mutex<NoteIndex>);

/// Tauri managed state wrapping the collection's on-disk media store.
pub struct MediaState(pub Arc<dyn MediaStore>);

/// Directories used by the `bibalak-media` protocol fallback while phase 2
/// legacy migration is still copying media in the background.
pub struct LegacyMediaDirs {
    pub new_dir: std::path::PathBuf,
    pub legacy_dir: Option<std::path::PathBuf>,
}

/// Stable event name emitted to the webview, which maps it to query-cache
/// invalidations.
fn event_name(event: &DomainEvent) -> &'static str {
    event.event_name().as_str()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Structured log subscriber: RUST_LOG env var controls filter; defaults to info.
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(true)
        .init();

    // Capture panics → log + write a crash report file next to the DB.
    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string();
        tracing::error!("PANIC: {msg}");
        // Best-effort: write to <tmp>/bibalak-crash.txt so it survives process death.
        let path = std::env::temp_dir().join("bibalak-crash.txt");
        let _ = std::fs::write(&path, format!("{msg}\n"));
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("bibalak-media", |app, request| {
            // Serve files from <app-data>/collection.media/<filename> via MediaStore.
            let uri = request.uri();
            let encoded = uri.path().trim_start_matches('/');
            let decoded = percent_decode_str(encoded).decode_utf8_lossy().into_owned();

            let handle = app.app_handle();
            let body = handle
                .try_state::<MediaState>()
                .and_then(|state| state.0.read(&decoded).ok())
                .or_else(|| {
                    let dirs = handle.try_state::<LegacyMediaDirs>()?;
                    let legacy_dir = dirs.legacy_dir.as_deref()?;
                    let path = legacy::resolve_media_path(
                        &decoded,
                        &dirs.new_dir,
                        legacy_dir,
                        legacy::legacy_copy_pending(&dirs.new_dir),
                    )?;
                    std::fs::read(path).ok()
                });

            match body {
                Some(body) => {
                    let mime = mime_for(&decoded);
                    tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(body)
                        .unwrap()
                }
                None => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(|app| {
            // The main window is built here, not from the config, so a portable
            // copy can keep the webview profile (language, layout) in its own
            // data folder instead of the OS one.
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("no window in tauri.conf.json")?;
            let mut window =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
            if let Some(dir) = data_dir::portable_data_dir() {
                window = window.data_directory(dir.join("webview"));
            }
            let win = window.build()?;

            // Open (or create) the collection under `data_dir` (OS app-data or portable).
            // Kept synchronous: cheap (single file open + migration check) and
            // every command needs `Collection` state to exist before it can run.
            let dir = data_dir::data_dir(app)?;
            app.manage(paths_guard::PickedPathsState::new(dir.clone()));
            app.manage(commands::export::ExportJobsState::default());
            app.manage(commands::import::ImportJobsState::default());
            app.manage(quick_add::QuickAddState::load(dir.clone()));
            app.manage(commands::ai::AIState::new(
                dir.clone(),
                Arc::new(bibalak_ai::KeyringSecretStore),
            ));
            window_state::init(&win, &dir, window_config.width, window_config.height);
            let portable = data_dir::portable_data_dir().is_some();
            let legacy_dir = (!portable)
                .then(|| dir.parent().map(|p| p.join(legacy::LEGACY_IDENTIFIER)))
                .flatten();
            // First launch after the Synapse → Bibalak rename: copy only the
            // DB + WAL/SHM + plugins synchronously so the window stays responsive;
            // media and backups copy on a background thread after setup.
            if let Some(ref legacy_dir) = legacy_dir {
                match legacy::migrate_legacy_core(legacy_dir, &dir) {
                    Ok(true) => tracing::info!("migrated core data from {}", legacy_dir.display()),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::warn!("could not migrate data from {}: {e}", legacy_dir.display())
                    }
                }
            }
            app.manage(LegacyMediaDirs {
                new_dir: dir.clone(),
                legacy_dir: legacy_dir.clone(),
            });
            std::fs::create_dir_all(&dir)?;
            let media_store = Arc::new(FsMediaStore::new(dir.join("collection.media")));
            app.manage(MediaState(media_store));
            let db_path = dir.join("collection.sqlite");
            let storage = match SqliteStorage::open(&db_path) {
                Ok(storage) => storage,
                Err(e) => {
                    tracing::error!("failed to open collection database: {e}");
                    app.manage(StartupErrorState(Mutex::new(Some(
                        StartupErrorInfo::from_core(&e),
                    ))));
                    return Ok(());
                }
            };
            let collection = match Collection::new(Box::new(storage), Arc::new(SystemClock)) {
                Ok(collection) => {
                    collection.with_scheduler_set(Arc::new(bibalak_scheduler::DefaultSchedulerSet))
                }
                Err(e) => {
                    tracing::error!("failed to initialize collection: {e}");
                    app.manage(StartupErrorState(Mutex::new(Some(
                        StartupErrorInfo::from_core(&e),
                    ))));
                    return Ok(());
                }
            };
            app.manage(StartupErrorState(Mutex::new(None)));

            // Manage an empty index immediately so `SearchState` exists for any
            // early command; the real index is built in the background below.
            let index = NoteIndex::new().expect("failed to create search index");
            app.manage(SearchState(Mutex::new(index)));

            // Bridge domain events → webview + rebuild search index on mutations.
            let handle = app.handle().clone();
            collection.events().subscribe(move |event| {
                if let Err(e) = handle.emit("bibalak://event", event_name(event)) {
                    tracing::warn!("failed to emit domain event: {e}");
                }

                match event {
                    DomainEvent::NoteUpdated { note_id } | DomainEvent::NoteAdded { note_id } => {
                        if let Some(state) = handle.try_state::<SearchState>() {
                            if let Some(collection) = handle.try_state::<Collection>() {
                                match collection.index_rows_for_notes(&[*note_id]) {
                                    Ok(rows) => {
                                        let idx = state.0.lock().unwrap_or_else(|p| {
                                            tracing::warn!("search mutex poisoned; recovering");
                                            p.into_inner()
                                        });
                                        if let Err(e) = idx.update_rows(&rows) {
                                            tracing::warn!(
                                                "failed to update search index for note {note_id}: {e}"
                                            );
                                        }
                                    }
                                    Err(e) => tracing::warn!(
                                        "failed to load index rows for note {note_id}: {e}"
                                    ),
                                }
                            }
                        }
                    }
                    DomainEvent::NotesUpdated { note_ids } => {
                        if let Some(state) = handle.try_state::<SearchState>() {
                            if let Some(collection) = handle.try_state::<Collection>() {
                                match collection.index_rows_for_notes(note_ids) {
                                    Ok(rows) => {
                                        let idx = state.0.lock().unwrap_or_else(|p| {
                                            tracing::warn!("search mutex poisoned; recovering");
                                            p.into_inner()
                                        });
                                        if let Err(e) = idx.update_rows(&rows) {
                                            tracing::warn!(
                                                "failed to update search index for notes: {e}"
                                            );
                                        }
                                    }
                                    Err(e) => tracing::warn!(
                                        "failed to load index rows for notes: {e}"
                                    ),
                                }
                            }
                        }
                    }
                    DomainEvent::CollectionOpened
                    | DomainEvent::SchemaChanged
                    | DomainEvent::NoteRemoved { .. } => {
                        if let Some(state) = handle.try_state::<SearchState>() {
                            if let Some(collection) = handle.try_state::<Collection>() {
                                match collection.index_rows() {
                                    Ok(rows) => {
                                        let idx = state.0.lock().unwrap_or_else(|p| {
                                            tracing::warn!("search mutex poisoned; recovering");
                                            p.into_inner()
                                        });
                                        if let Err(e) = idx.rebuild(&rows) {
                                            tracing::warn!("failed to rebuild search index: {e}");
                                        }
                                    }
                                    Err(e) => tracing::warn!(
                                        "failed to load index rows for search rebuild: {e}"
                                    ),
                                }
                            }
                        }
                    }
                    _ => {}
                }
            });

            app.manage(collection);

            if let Some(legacy_dir) = legacy_dir.filter(|_| legacy::legacy_copy_pending(&dir)) {
                let migration_handle = app.handle().clone();
                let migration_dir = dir.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name("legacy-migration".into())
                    .spawn(
                        move || match legacy::copy_legacy_rest(&legacy_dir, &migration_dir) {
                            Ok(()) => {
                                tracing::info!(
                                    "finished background legacy migration from {}",
                                    legacy_dir.display()
                                );
                                let _ = migration_handle.emit("bibalak://event", "media-changed");
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "could not finish background legacy migration from {}: {e}",
                                    legacy_dir.display()
                                );
                            }
                        },
                    )
                {
                    tracing::warn!("could not spawn legacy migration thread: {e}");
                }
            }

            // Everything below is expensive (zip backup, full-index rebuild,
            // plugin file IO) and must not block the window from becoming
            // responsive. Run it on a background thread; the frontend sees the
            // index populate via the reindex-on-mutation path / `search-ready`.
            let bg_handle = app.handle().clone();
            let bg_dir = dir.clone();
            std::thread::spawn(move || {
                let app = bg_handle;
                let dir = bg_dir;

                if let Some(collection) = app.try_state::<Collection>() {
                    // Auto-backup on startup: create a zip if no backup in the last 24 h.
                    let backup_dir = dir.join("backups");
                    let _ = std::fs::create_dir_all(&backup_dir);
                    let db_path = dir.join("collection.sqlite");
                    let should_backup = db_backup::list_zips(&backup_dir)
                        .ok()
                        .and_then(|v| v.into_iter().next().map(|(_, ms, _)| ms))
                        .map(|last_ms| {
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as i64;
                            now_ms - last_ms > 86_400_000
                        })
                        .unwrap_or(true);
                    if should_backup && db_path.is_file() {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64;
                        let tmp = backup_dir.join(format!("{now_ms}.tmp.sqlite"));
                        let zip = backup_dir.join(format!("{now_ms}.zip"));
                        if collection.backup_db(&tmp).is_ok() {
                            let media_dir = dir.join("collection.media");
                            if db_backup::create_zip(&tmp, &media_dir, &zip).is_ok() {
                                let _ = db_backup::rotate_backups(&backup_dir, 20);
                                tracing::info!("auto-backup created: {now_ms}.zip");
                            }
                            let _ = std::fs::remove_file(&tmp);
                        }
                    }

                    // Build the initial search index.
                    if let Some(state) = app.try_state::<SearchState>() {
                        match collection.index_rows() {
                            Ok(rows) => {
                                let idx = state.0.lock().unwrap_or_else(|p| {
                                    tracing::warn!("search mutex poisoned; recovering");
                                    p.into_inner()
                                });
                                if let Err(e) = idx.rebuild(&rows) {
                                    tracing::warn!("failed to build initial search index: {e}");
                                }
                            }
                            Err(e) => {
                                tracing::warn!("failed to load initial search index rows: {e}");
                            }
                        }
                    }
                }

                let _ = app.emit("bibalak://search-ready", ());

                // Plugin manager — plugins live under `<data-dir>/plugins/installed/`.
                let plugin_manager = PluginManager::new(&dir);
                app.manage(Mutex::new(plugin_manager));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_startup_error,
            commands::app::app_info,
            commands::app::pick_open_path,
            commands::app::pick_save_path,
            commands::deck::list_decks,
            commands::deck::create_deck,
            commands::deck::rename_deck,
            commands::deck::delete_deck,
            commands::deck::undo,
            commands::deck::undo_status,
            commands::deck::get_deck_config,
            commands::deck::set_deck_config,
            commands::deck::set_deck_collapsed,
            commands::deck::get_today_extra_new,
            commands::deck::increase_today_limit,
            commands::deck::deck_card_ids,
            commands::deck::get_collection_prefs,
            commands::deck::set_collection_prefs,
            commands::deck::set_local_offset,
            commands::import::import_package,
            commands::import::cancel_import,
            commands::import::preview_text_import,
            commands::import::import_text,
            commands::study::get_next_card,
            commands::study::answer_card,
            commands::browse::list_notes,
            commands::browse::get_note,
            commands::browse::save_note,
            commands::browse::search_notes,
            commands::browse::search_cards,
            commands::browse::count_cards,
            commands::browse::delete_notes,
            commands::browse::move_cards_to_deck,
            commands::browse::bulk_add_tag,
            commands::browse::bulk_remove_tag,
            commands::browse::list_notetypes,
            commands::browse::add_note,
            commands::browse::add_notes_batch,
            commands::browse::check_duplicate,
            commands::export::get_export_estimate,
            commands::export::export_package,
            commands::export::cancel_export,
            commands::stats::get_stats,
            commands::notetype::get_notetype,
            commands::notetype::create_notetype,
            commands::notetype::delete_notetype,
            commands::notetype::rename_notetype,
            commands::notetype::list_stock_notetypes,
            commands::notetype::add_stock_notetype,
            commands::notetype::save_notetype_css,
            commands::notetype::add_field,
            commands::notetype::check_field_remove,
            commands::notetype::remove_field,
            commands::notetype::rename_field,
            commands::notetype::reorder_fields,
            commands::notetype::save_field_options,
            commands::notetype::set_sort_field,
            commands::notetype::duplicate_notetype,
            commands::notetype::add_template,
            commands::notetype::check_template_remove,
            commands::notetype::remove_template,
            commands::notetype::save_template,
            commands::notetype::preview_template,
            commands::notetype::save_notetype_preset,
            commands::notetype::lint_notetype,
            commands::cards::suspend_cards,
            commands::cards::unsuspend_cards,
            commands::cards::bury_cards,
            commands::cards::unbury_cards,
            commands::cards::set_card_flag,
            commands::cards::forget_cards,
            commands::cards::set_due_date,
            commands::cards::reposition_new_cards,
            commands::study::preview_card,
            commands::browse::search_note_rows,
            commands::browse::count_note_rows,
            commands::browse::preview_find_replace,
            commands::browse::find_replace_notes,
            commands::browse::find_duplicates,
            commands::browse::change_note_type,
            commands::tags::list_tags,
            commands::tags::list_tag_counts,
            commands::tags::rename_tag,
            commands::tags::delete_tag,
            commands::tags::merge_tags,
            commands::tags::create_filtered_deck,
            commands::tags::rebuild_filtered,
            commands::tags::empty_filtered,
            commands::tags::get_filtered_config,
            commands::maintenance::create_backup,
            commands::maintenance::list_backups,
            commands::maintenance::restore_backup,
            commands::maintenance::delete_backup,
            commands::maintenance::check_integrity,
            commands::maintenance::optimize_db,
            commands::maintenance::check_media,
            commands::maintenance::delete_orphan_media,
            commands::media::save_media,
            commands::media::save_media_from_path,
            commands::media::list_media_library,
            commands::media::delete_unused_media,
            commands::media::legacy_media_pending,
            commands::optimize::optimize_fsrs,
            commands::optimize::apply_fsrs_weights,
            commands::optimize::simulate_workload,
            commands::plugins::list_plugins,
            commands::plugins::enable_plugin,
            commands::plugins::disable_plugin,
            commands::plugins::remove_plugin,
            commands::plugins::install_plugin,
            commands::plugins::install_plugin_zip,
            commands::plugins::install_sample_plugins,
            commands::plugins::get_plugin_entry,
            commands::plugins::plugin_read_decks,
            commands::plugins::plugin_read_notes,
            commands::plugins::plugin_check_media_missing,
            commands::quick_add::get_quick_add_config,
            commands::quick_add::set_quick_add_config,
            commands::quick_add::remember_quick_add_target,
            commands::quick_add::toggle_quick_add,
            commands::quick_add::hide_quick_add,
            commands::ai::ai_get_config,
            commands::ai::ai_set_config,
            commands::ai::ai_preview_action,
            commands::ai::ai_run_action,
            commands::ai::ai_split_text,
            commands::ai::load_quality_notes,
            commands::ai::apply_quality_fixes,
            commands::ai::get_coach_input,
            commands::progress::progress_summary,
            commands::progress::progress_history,
            commands::progress::study_days,
            commands::progress::progress_by_deck,
            commands::progress::yesterday_summary,
            commands::progress::dismiss_yesterday_summary,
            commands::productivity::list_task_lists,
            commands::productivity::create_task_list,
            commands::productivity::update_task_list,
            commands::productivity::delete_task_list,
            commands::productivity::get_matrix_board,
            commands::productivity::create_task,
            commands::productivity::update_task,
            commands::productivity::complete_task,
            commands::productivity::reopen_task,
            commands::productivity::delete_task,
            commands::productivity::reorder_tasks,
            commands::productivity::reschedule_overdue_tasks,
            commands::productivity::move_task_to_quadrant,
            commands::productivity::save_matrix_quadrant,
            commands::productivity::restore_matrix_defaults,
            commands::productivity::get_habit_board,
            commands::productivity::get_habit_history,
            commands::productivity::list_archived_habits,
            commands::productivity::create_habit,
            commands::productivity::update_habit,
            commands::productivity::archive_habit,
            commands::productivity::delete_habit,
            commands::productivity::log_habit,
            commands::productivity::list_calendar_occurrences,
            commands::productivity::create_calendar_event,
            commands::productivity::update_calendar_event,
            commands::productivity::delete_calendar_event,
            commands::productivity::delete_calendar_occurrence,
            commands::game::get_game_state,
            commands::game::update_avatar_profile,
            commands::game::equip_game_item,
            commands::game::unequip_game_slot,
            commands::game::buy_shop_item,
            commands::game::refund_shop_purchase,
            commands::game::list_custom_rewards,
            commands::game::create_custom_reward,
            commands::game::update_custom_reward,
            commands::game::delete_custom_reward,
            commands::game::claim_custom_reward,
            commands::game::list_spend_history,
            commands::game::get_game_depth_state,
            commands::game::choose_game_path,
            commands::game::set_active_pet,
            commands::game::acknowledge_unlocks,
            commands::game::run_unlock_backfill,
            commands::motivation::get_motivation_state,
            commands::motivation::set_daily_goal,
            commands::motivation::get_streak_calendar,
            commands::motivation::freeze_study_day,
            commands::motivation::dismiss_comeback_offer,
            commands::motivation::complete_onboarding,
            commands::motivation::mark_monthly_badge_seen,
            commands::reminders::plan_reminders,
        ])
        .build(app_context())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                window_state::save_on_exit(app);
                let _ = app.global_shortcut().unregister_all();
            }
        });
}

/// The app context, expanded in one place only: on macOS every
/// `generate_context!` embeds an `Info.plist` symbol, so a second expansion in
/// the same crate (for example in a test) fails to link.
fn app_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(test)]
mod tests {
    #[test]
    fn quick_add_window_cannot_call_admin_commands() {
        use tauri::ipc::Origin;

        let mut ctx = super::app_context();
        let auth = ctx.runtime_authority_mut();

        for denied in [
            "delete_backup",
            "restore_backup",
            "export_package",
            "get_export_estimate",
            "cancel_export",
            "import_package",
            "cancel_import",
            "install_plugin",
            "delete_notes",
            "delete_deck",
            "optimize_db",
            "ai_set_config",
            "ai_run_action",
            "pick_open_path",
            "pick_save_path",
            "save_notetype_preset",
            "lint_notetype",
        ] {
            assert!(
                auth.resolve_access(denied, "quick-add", "quick-add", &Origin::Local)
                    .is_none(),
                "quick-add window must not be allowed to invoke '{denied}'"
            );
            assert!(
                auth.resolve_access(denied, "main", "main", &Origin::Local)
                    .is_some(),
                "main window must be allowed to invoke '{denied}'"
            );
        }

        for allowed in [
            "set_local_offset",
            "get_quick_add_config",
            "remember_quick_add_target",
            "hide_quick_add",
            "list_notetypes",
            "list_decks",
            "list_tags",
            "get_notetype",
            "check_duplicate",
            "add_note",
            "save_media",
        ] {
            assert!(
                auth.resolve_access(allowed, "quick-add", "quick-add", &Origin::Local)
                    .is_some(),
                "quick-add window must be allowed to invoke '{allowed}'"
            );
        }
    }
}

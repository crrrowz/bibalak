//! # bibalak-media
//!
//! Filesystem adapter implementing [`bibalak_core::ports::MediaStore`] over a
//! collection's `collection.media/` directory: Anki-compatible original
//! filenames, SHA-1 deduplication, collision suffixes (`name-1.ext`), traversal
//! validation, unused detection, and note-reference rewriting.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::MediaReport;
pub use bibalak_core::media_refs::{
    allowed_media_mime, is_blocked_active_media_extension, normalize_import_media_filename,
    validate_media_filename,
};
use bibalak_core::ports::{MediaEntry, MediaStore, Storage};
use sha1::{Digest, Sha1};

fn storage_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn digest_to_hex(digest: &[u8]) -> String {
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    hex
}

fn sha1_hex(bytes: &[u8]) -> String {
    digest_to_hex(&Sha1::digest(bytes))
}

fn sha1_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(digest_to_hex(&hasher.finalize()))
}

fn collision_candidate(filename: &str, suffix: usize) -> String {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(filename);
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.is_empty() => format!("{stem}-{suffix}.{ext}"),
        _ => format!("{stem}-{suffix}"),
    }
}

#[derive(Clone)]
struct IndexedFile {
    size_bytes: u64,
    modified: Option<SystemTime>,
    sha1: Option<String>,
}

#[derive(Default)]
struct MediaIndex {
    initialized: bool,
    dir_modified: Option<SystemTime>,
    generation: u64,
    by_name: HashMap<String, IndexedFile>,
    by_size: HashMap<u64, BTreeSet<String>>,
}

impl MediaIndex {
    fn insert(&mut self, name: String, entry: IndexedFile) {
        if let Some(prev) = self.by_name.get(&name) {
            if prev.size_bytes != entry.size_bytes {
                if let Some(bucket) = self.by_size.get_mut(&prev.size_bytes) {
                    bucket.remove(&name);
                    if bucket.is_empty() {
                        self.by_size.remove(&prev.size_bytes);
                    }
                }
            }
        }
        self.by_size
            .entry(entry.size_bytes)
            .or_default()
            .insert(name.clone());
        self.by_name.insert(name, entry);
    }

    fn remove(&mut self, name: &str) -> Option<IndexedFile> {
        let removed = self.by_name.remove(name)?;
        if let Some(bucket) = self.by_size.get_mut(&removed.size_bytes) {
            bucket.remove(name);
            if bucket.is_empty() {
                self.by_size.remove(&removed.size_bytes);
            }
        }
        Some(removed)
    }

    fn replace_from_scan(
        &mut self,
        by_name: HashMap<String, IndexedFile>,
        by_size: HashMap<u64, BTreeSet<String>>,
        dir_modified: Option<SystemTime>,
    ) {
        self.by_name = by_name;
        self.by_size = by_size;
        self.dir_modified = dir_modified;
        self.initialized = true;
        self.generation += 1;
    }
}

type ScannedDir = (
    HashMap<String, IndexedFile>,
    HashMap<u64, BTreeSet<String>>,
    Option<SystemTime>,
);

fn dir_mtime(root: &Path) -> Option<SystemTime> {
    fs::metadata(root).ok().and_then(|m| m.modified().ok())
}

fn scan_dir_metadata(root: &Path, prev: &HashMap<String, IndexedFile>) -> CoreResult<ScannedDir> {
    if !root.is_dir() {
        return Ok((HashMap::new(), HashMap::new(), None));
    }

    let dir_mod_before = dir_mtime(root);
    let mut by_name = HashMap::new();
    let mut by_size: HashMap<u64, BTreeSet<String>> = HashMap::new();

    for dir_entry in fs::read_dir(root).map_err(storage_err)? {
        let dir_entry = dir_entry.map_err(storage_err)?;
        let file_type = dir_entry.file_type().map_err(storage_err)?;
        if !file_type.is_file() {
            continue;
        }
        let Some(name) = dir_entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let meta = dir_entry.metadata().map_err(storage_err)?;
        let size_bytes = meta.len();
        let modified = meta.modified().ok();

        // Keep cached SHA-1 only while (size, mtime) still match disk; otherwise
        // defer hashing until a duplicate candidate or `list()` actually needs it.
        let sha1 = prev.get(&name).and_then(|old| {
            (old.size_bytes == size_bytes && old.modified == modified)
                .then(|| old.sha1.clone())
                .flatten()
        });

        by_size.entry(size_bytes).or_default().insert(name.clone());
        by_name.insert(
            name,
            IndexedFile {
                size_bytes,
                modified,
                sha1,
            },
        );
    }

    Ok((by_name, by_size, dir_mod_before))
}

#[cfg(test)]
type HashHook = Mutex<Option<Box<dyn Fn() + Send + Sync>>>;

/// Disk-backed [`MediaStore`] rooted at `<data_dir>/collection.media`.
pub struct FsMediaStore {
    root: PathBuf,
    index: Mutex<MediaIndex>,
    #[cfg(test)]
    on_hash_hook: HashHook,
}

impl FsMediaStore {
    /// Construct a store pointing at `root`. The directory is scanned lazily on
    /// demand and created on the first write.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            index: Mutex::new(MediaIndex::default()),
            #[cfg(test)]
            on_hash_hook: Mutex::new(None),
        }
    }

    /// Root directory of this store (`collection.media`).
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Move a previously deleted file back out of `.trash/` into `collection.media`.
    pub fn restore_trashed(&self, filename: &str) -> CoreResult<()> {
        validate_media_filename(filename)?;
        let trashed_path = self.root.join(".trash").join(filename);
        if !trashed_path.is_file() {
            return Err(CoreError::NotFound(format!(
                "trashed media '{filename}' not found"
            )));
        }
        let dest = self.root.join(filename);
        if dest.exists() {
            return Err(CoreError::Invalid(format!(
                "media '{filename}' already exists"
            )));
        }
        if fs::rename(&trashed_path, &dest).is_err() {
            fs::copy(&trashed_path, &dest).map_err(storage_err)?;
            fs::remove_file(&trashed_path).map_err(storage_err)?;
        }
        let mut idx = self.lock_index()?;
        idx.initialized = false;
        idx.generation += 1;
        Ok(())
    }

    fn lock_index(&self) -> CoreResult<std::sync::MutexGuard<'_, MediaIndex>> {
        self.index
            .lock()
            .map_err(|_| CoreError::Storage("media store index lock poisoned".into()))
    }

    fn hash_existing_file(&self, path: &Path) -> io::Result<String> {
        #[cfg(test)]
        if let Ok(guard) = self.on_hash_hook.lock() {
            if let Some(cb) = guard.as_ref() {
                cb();
            }
        }
        sha1_file(path)
    }

    fn rescan_locked_via_snapshot(&self) -> CoreResult<()> {
        loop {
            let (gen_before, prev_snapshot) = {
                let idx = self.lock_index()?;
                let prev = if idx.by_name.is_empty() {
                    HashMap::new()
                } else {
                    idx.by_name.clone()
                };
                (idx.generation, prev)
            };

            let (by_name, by_size, dir_mod) = scan_dir_metadata(&self.root, &prev_snapshot)?;

            let mut idx = self.lock_index()?;
            if idx.generation != gen_before {
                continue;
            }
            idx.replace_from_scan(by_name, by_size, dir_mod);
            return Ok(());
        }
    }

    fn ensure_index_ready(&self) -> CoreResult<()> {
        let cur_dir_mod = dir_mtime(&self.root);
        {
            let idx = self.lock_index()?;
            if idx.initialized && idx.dir_modified == cur_dir_mod {
                return Ok(());
            }
        }
        self.rescan_locked_via_snapshot()
    }

    fn rescan_entries(&self) -> CoreResult<Vec<(String, IndexedFile)>> {
        self.rescan_locked_via_snapshot()?;
        let idx = self.lock_index()?;
        let mut entries: Vec<(String, IndexedFile)> = idx
            .by_name
            .iter()
            .map(|(name, entry)| (name.clone(), entry.clone()))
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(entries)
    }

    fn dedup_same_size(&self, new_size: u64, digest: &str) -> CoreResult<Option<String>> {
        let (cached_hits, unhashed) = {
            let idx = self.lock_index()?;
            let mut hits = Vec::new();
            let mut to_hash = Vec::new();
            if let Some(names) = idx.by_size.get(&new_size) {
                for name in names {
                    if let Some(entry) = idx.by_name.get(name) {
                        match &entry.sha1 {
                            Some(h) if h == digest => hits.push((name.clone(), entry.modified)),
                            Some(_) => {}
                            None => to_hash.push(name.clone()),
                        }
                    }
                }
            }
            (hits, to_hash)
        };

        for (name, cached_mod) in cached_hits {
            if self.verify_or_refresh_candidate(&name, new_size, Some(cached_mod), digest)? {
                return Ok(Some(name));
            }
        }

        for name in unhashed {
            if self.verify_or_refresh_candidate(&name, new_size, None, digest)? {
                return Ok(Some(name));
            }
        }

        Ok(None)
    }

    /// Inspect `name` on disk outside the index lock. Updates the cached entry if
    /// missing, resized, or modified; computes SHA-1 lazily outside the lock when
    /// `expected_size` still matches and cached metadata is missing/stale.
    fn verify_or_refresh_candidate(
        &self,
        name: &str,
        expected_size: u64,
        cached_hit_mod: Option<Option<SystemTime>>,
        digest: &str,
    ) -> CoreResult<bool> {
        let path = self.root.join(name);
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let mut idx = self.lock_index()?;
                idx.remove(name);
                return Ok(false);
            }
            Err(e) => return Err(storage_err(e)),
        };

        let disk_size = meta.len();
        let disk_mod = meta.modified().ok();
        if disk_size != expected_size {
            let mut idx = self.lock_index()?;
            idx.insert(
                name.to_string(),
                IndexedFile {
                    size_bytes: disk_size,
                    modified: disk_mod,
                    sha1: None,
                },
            );
            return Ok(false);
        }

        if let Some(prev_mod) = cached_hit_mod {
            if prev_mod == disk_mod {
                return Ok(true);
            }
        }

        let computed = self.hash_existing_file(&path).map_err(storage_err)?;
        {
            let mut idx = self.lock_index()?;
            idx.insert(
                name.to_string(),
                IndexedFile {
                    size_bytes: disk_size,
                    modified: disk_mod,
                    sha1: Some(computed.clone()),
                },
            );
        }
        Ok(computed == digest)
    }

    fn next_available_candidate(&self, filename: &str, start_suffix: usize) -> CoreResult<String> {
        let idx = self.lock_index()?;
        if start_suffix == 0 && !idx.by_name.contains_key(filename) {
            return Ok(filename.to_string());
        }
        let mut n = start_suffix.max(1);
        loop {
            let candidate = collision_candidate(filename, n);
            if !idx.by_name.contains_key(&candidate) {
                return Ok(candidate);
            }
            n += 1;
        }
    }

    fn template_field_media_counts(
        &self,
        storage: &dyn Storage,
    ) -> CoreResult<BTreeMap<String, u32>> {
        let notetypes = storage.list_notetypes()?;
        let mut media_ords_by_nt: HashMap<i64, BTreeSet<usize>> = HashMap::new();
        for nt in notetypes {
            let Some(detail) = storage.get_notetype_detail(nt.id)? else {
                continue;
            };
            let mut field_names = BTreeSet::new();
            for tpl in &detail.templates {
                field_names.extend(bibalak_core::media_refs::extract_template_media_fields(
                    &tpl.qfmt,
                ));
                field_names.extend(bibalak_core::media_refs::extract_template_media_fields(
                    &tpl.afmt,
                ));
            }
            if field_names.is_empty() {
                continue;
            }
            let mut ords = BTreeSet::new();
            for f in &detail.fields {
                if field_names
                    .iter()
                    .any(|n| n.eq_ignore_ascii_case(f.name.trim()))
                {
                    ords.insert(f.ord as usize);
                }
            }
            if !ords.is_empty() {
                media_ords_by_nt.insert(nt.id, ords);
            }
        }
        if media_ords_by_nt.is_empty() {
            return Ok(BTreeMap::new());
        }

        let model = storage.dump_collection()?;
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        for note in &model.notes {
            let Some(ords) = media_ords_by_nt.get(&note.notetype_id) else {
                continue;
            };
            let mut seen_in_note = BTreeSet::new();
            for &ord in ords {
                if let Some(val) = note.fields.get(ord) {
                    if let Some(name) = bibalak_core::media_refs::extract_field_media_value(val) {
                        seen_in_note.insert(name);
                    }
                }
            }
            for name in seen_in_note {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
        Ok(counts)
    }

    fn all_media_ref_counts(&self, storage: &dyn Storage) -> CoreResult<Vec<(String, u32)>> {
        let mut combined: BTreeMap<String, u32> = BTreeMap::new();
        for (name, count) in storage.note_media_ref_counts()? {
            *combined.entry(name).or_insert(0) += count;
        }
        for (name, count) in self.template_field_media_counts(storage)? {
            *combined.entry(name).or_insert(0) += count;
        }
        Ok(combined.into_iter().collect())
    }

    fn usage_counts_with_case(
        &self,
        storage: &dyn Storage,
        case_insensitive: bool,
    ) -> CoreResult<BTreeMap<String, u32>> {
        let mut counts = BTreeMap::new();
        let mut disk_by_key: HashMap<String, Vec<String>> = HashMap::new();
        for (name, _) in self.rescan_entries()? {
            let key = bibalak_core::media_refs::canonical_media_key(&name, case_insensitive);
            disk_by_key.entry(key).or_default().push(name.clone());
            counts.insert(name, 0);
        }
        for (ref_name, count) in self.all_media_ref_counts(storage)? {
            let key = bibalak_core::media_refs::canonical_media_key(&ref_name, case_insensitive);
            if let Some(disk_names) = disk_by_key.get(&key) {
                for disk_name in disk_names {
                    *counts.entry(disk_name.clone()).or_insert(0) += count;
                }
            } else {
                *counts.entry(ref_name).or_insert(0) += count;
            }
        }
        // Files prefixed with `_` are shared Anki template/script/font assets
        // and must always count as used.
        for (name, count) in counts.iter_mut() {
            if name.starts_with('_') && *count == 0 {
                *count = 1;
            }
        }
        Ok(counts)
    }

    fn find_unused_with_case(
        &self,
        storage: &dyn Storage,
        case_insensitive: bool,
    ) -> CoreResult<Vec<String>> {
        let used_keys: BTreeSet<String> = self
            .all_media_ref_counts(storage)?
            .into_iter()
            .map(|(r, _)| bibalak_core::media_refs::canonical_media_key(&r, case_insensitive))
            .collect();
        let unused: Vec<String> = self
            .rescan_entries()?
            .into_iter()
            .filter_map(|(name, _)| {
                if name.starts_with('_') {
                    return None;
                }
                let key = bibalak_core::media_refs::canonical_media_key(&name, case_insensitive);
                (!used_keys.contains(&key)).then_some(name)
            })
            .collect();
        Ok(unused)
    }

    fn check_media_with_case(
        &self,
        storage: &dyn Storage,
        case_insensitive: bool,
    ) -> CoreResult<MediaReport> {
        let disk_files: Vec<String> = self
            .rescan_entries()?
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        let disk_keys: BTreeSet<String> = disk_files
            .iter()
            .map(|name| bibalak_core::media_refs::canonical_media_key(name, case_insensitive))
            .collect();
        let refs: Vec<String> = self
            .all_media_ref_counts(storage)?
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        let ref_keys: BTreeSet<String> = refs
            .iter()
            .map(|name| bibalak_core::media_refs::canonical_media_key(name, case_insensitive))
            .collect();

        let orphan_files: Vec<String> = disk_files
            .into_iter()
            .filter(|name| {
                !name.starts_with('_')
                    && !ref_keys.contains(&bibalak_core::media_refs::canonical_media_key(
                        name,
                        case_insensitive,
                    ))
            })
            .collect();
        let missing_files: Vec<String> = refs
            .into_iter()
            .filter(|name| {
                !disk_keys.contains(&bibalak_core::media_refs::canonical_media_key(
                    name,
                    case_insensitive,
                ))
            })
            .collect();

        Ok(MediaReport {
            orphan_files,
            missing_files,
        })
    }
}

const HOST_CASE_INSENSITIVE: bool = cfg!(any(target_os = "windows", target_os = "macos"));

impl MediaStore for FsMediaStore {
    fn add(&self, filename: &str, bytes: &[u8]) -> CoreResult<String> {
        validate_media_filename(filename)?;
        if is_blocked_active_media_extension(filename) {
            return Err(CoreError::Invalid(format!(
                "blocked scriptable media extension: {filename:?}"
            )));
        }
        let new_size = bytes.len() as u64;
        let digest = sha1_hex(bytes);

        self.ensure_index_ready()?;
        if let Some(existing_name) = self.dedup_same_size(new_size, &digest)? {
            return Ok(existing_name);
        }

        if !self.root.is_dir() {
            fs::create_dir_all(&self.root).map_err(storage_err)?;
        }

        let mut next_suffix = 0usize;
        let target_name = loop {
            let candidate = self.next_available_candidate(filename, next_suffix)?;
            let dest = self.root.join(&candidate);
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dest)
            {
                Ok(mut file) => {
                    if let Err(e) = file.write_all(bytes) {
                        drop(file);
                        let _ = fs::remove_file(&dest);
                        return Err(storage_err(e));
                    }
                    break candidate;
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    // External creation occurred in the same mtime tick: inspect it
                    // for dedup if same size, record in index, and try next suffix.
                    if self.verify_or_refresh_candidate(&candidate, new_size, None, &digest)? {
                        return Ok(candidate);
                    }
                    next_suffix += 1;
                }
                Err(e) => return Err(storage_err(e)),
            }
        };

        let dest = self.root.join(&target_name);
        let meta = fs::metadata(&dest).map_err(storage_err)?;
        let after_dir_mod = dir_mtime(&self.root);
        let mut idx = self.lock_index()?;
        idx.insert(
            target_name.clone(),
            IndexedFile {
                size_bytes: meta.len(),
                modified: meta.modified().ok(),
                sha1: Some(digest),
            },
        );
        if idx.initialized {
            idx.dir_modified = after_dir_mod;
        }
        idx.generation += 1;
        Ok(target_name)
    }

    fn read(&self, filename: &str) -> CoreResult<Vec<u8>> {
        validate_media_filename(filename)?;
        let path = self.root.join(filename);
        match fs::read(&path) {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                Err(CoreError::NotFound(format!("media '{filename}' not found")))
            }
            Err(e) => Err(storage_err(e)),
        }
    }

    fn open_reader(&self, filename: &str) -> CoreResult<Box<dyn io::Read + Send>> {
        validate_media_filename(filename)?;
        let path = self.root.join(filename);
        match fs::File::open(&path) {
            Ok(file) => Ok(Box::new(io::BufReader::new(file))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                Err(CoreError::NotFound(format!("media '{filename}' not found")))
            }
            Err(e) => Err(storage_err(e)),
        }
    }

    fn list(&self) -> CoreResult<Vec<MediaEntry>> {
        let scanned = self.rescan_entries()?;
        let mut entries = Vec::with_capacity(scanned.len());
        let mut newly_hashed = Vec::new();

        for (name, entry) in scanned {
            let sha1 = match entry.sha1 {
                Some(h) => h,
                None => {
                    let h = self
                        .hash_existing_file(&self.root.join(&name))
                        .map_err(storage_err)?;
                    newly_hashed.push((name.clone(), entry.size_bytes, entry.modified, h.clone()));
                    h
                }
            };
            entries.push(MediaEntry {
                filename: name,
                size_bytes: entry.size_bytes,
                sha1,
            });
        }

        if !newly_hashed.is_empty() {
            let mut idx = self.lock_index()?;
            for (name, size_bytes, modified, sha1) in newly_hashed {
                if let Some(cur) = idx.by_name.get_mut(&name) {
                    if cur.size_bytes == size_bytes && cur.modified == modified {
                        cur.sha1 = Some(sha1);
                    }
                }
            }
        }

        Ok(entries)
    }

    fn list_sizes(&self) -> CoreResult<Vec<(String, u64)>> {
        Ok(self
            .rescan_entries()?
            .into_iter()
            .map(|(name, entry)| (name, entry.size_bytes))
            .collect())
    }

    fn usage_counts(&self, storage: &dyn Storage) -> CoreResult<BTreeMap<String, u32>> {
        self.usage_counts_with_case(storage, HOST_CASE_INSENSITIVE)
    }

    fn find_unused(&self, storage: &dyn Storage) -> CoreResult<Vec<String>> {
        self.find_unused_with_case(storage, HOST_CASE_INSENSITIVE)
    }

    fn check_media(&self, storage: &dyn Storage) -> CoreResult<MediaReport> {
        self.check_media_with_case(storage, HOST_CASE_INSENSITIVE)
    }

    fn delete(&self, filenames: &[String]) -> CoreResult<u32> {
        for name in filenames {
            validate_media_filename(name)?;
        }

        let before_dir_mod = dir_mtime(&self.root);
        let trash_dir = self.root.join(".trash");
        let mut removed_names = Vec::new();
        for name in filenames {
            let path = self.root.join(name);
            if path.is_file() {
                if !trash_dir.is_dir() {
                    fs::create_dir_all(&trash_dir).map_err(storage_err)?;
                }
                let mut dest = trash_dir.join(name);
                if dest.exists() {
                    let mut suffix = 1usize;
                    loop {
                        let candidate = collision_candidate(name, suffix);
                        let candidate_path = trash_dir.join(&candidate);
                        if !candidate_path.exists() {
                            dest = candidate_path;
                            break;
                        }
                        suffix += 1;
                    }
                }
                if fs::rename(&path, &dest).is_err() {
                    fs::copy(&path, &dest).map_err(storage_err)?;
                    fs::remove_file(&path).map_err(storage_err)?;
                }
                removed_names.push(name.clone());
            }
        }

        if !removed_names.is_empty() {
            let after_dir_mod = dir_mtime(&self.root);
            let mut idx = self.lock_index()?;
            let dir_was_fresh = idx.initialized && idx.dir_modified == before_dir_mod;
            for name in &removed_names {
                idx.remove(name);
            }
            if dir_was_fresh {
                idx.dir_modified = after_dir_mod;
            } else {
                idx.initialized = false;
            }
            idx.generation += 1;
        }
        Ok(removed_names.len() as u32)
    }

    fn rename(
        &self,
        storage: &dyn Storage,
        old_name: &str,
        new_name: &str,
        now_ms: i64,
    ) -> CoreResult<u32> {
        validate_media_filename(old_name)?;
        validate_media_filename(new_name)?;

        let old_path = self.root.join(old_name);
        if !old_path.is_file() {
            return Err(CoreError::NotFound(format!("media '{old_name}' not found")));
        }
        if old_name == new_name {
            return Ok(0);
        }

        let new_path = self.root.join(new_name);
        if new_path.exists() {
            return Err(CoreError::Invalid(format!(
                "media '{new_name}' already exists"
            )));
        }

        let before_dir_mod = dir_mtime(&self.root);
        fs::rename(&old_path, &new_path).map_err(storage_err)?;
        let rewritten = match storage.rewrite_media_ref(old_name, new_name, now_ms) {
            Ok(n) => n,
            Err(e) => {
                let _ = fs::rename(&new_path, &old_path);
                return Err(e);
            }
        };

        let meta = fs::metadata(&new_path).map_err(storage_err)?;
        let after_dir_mod = dir_mtime(&self.root);
        let mut idx = self.lock_index()?;
        let dir_was_fresh = idx.initialized && idx.dir_modified == before_dir_mod;
        let prev_sha1 = idx.remove(old_name).and_then(|e| e.sha1);
        idx.insert(
            new_name.to_string(),
            IndexedFile {
                size_bytes: meta.len(),
                modified: meta.modified().ok(),
                sha1: prev_sha1,
            },
        );
        if dir_was_fresh {
            idx.dir_modified = after_dir_mod;
        } else {
            idx.initialized = false;
        }
        idx.generation += 1;
        Ok(rewritten)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bibalak_core::error::CoreError;
    use bibalak_core::ports::*;
    use bibalak_db::SqliteStorage;

    fn temp_store() -> (tempfile::TempDir, FsMediaStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = FsMediaStore::new(dir.path().join("collection.media"));
        (dir, store)
    }

    fn db_with_notes(fields_list: &[&[&str]]) -> SqliteStorage {
        let s = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_700_000_000_000;
        s.ensure_collection(now_ms).unwrap();
        let nt_id = s
            .list_notetypes()
            .unwrap()
            .into_iter()
            .next()
            .map(|n| n.id)
            .unwrap_or_else(|| s.add_stock_notetype(0, now_ms).unwrap());
        for fields in fields_list {
            let owned: Vec<String> = fields.iter().map(|v| (*v).to_string()).collect();
            s.add_note_with_cards(nt_id, 1, &owned, &[], now_ms)
                .unwrap();
        }
        s
    }

    #[test]
    fn add_keeps_original_filename_and_deduplicates_by_sha1() {
        let (_dir, store) = temp_store();
        let a = store.add("photo.png", b"same-bytes").unwrap();
        let b = store.add("photo.png", b"same-bytes").unwrap();
        let c = store.add("copy-of-photo.png", b"same-bytes").unwrap();

        assert_eq!(a, "photo.png");
        assert_eq!(b, "photo.png");
        assert_eq!(c, "photo.png");

        let entries = store.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].filename, "photo.png");
        assert_eq!(entries[0].size_bytes, 10);
        // SHA-1("same-bytes")
        assert_eq!(entries[0].sha1.len(), 40);
    }

    #[test]
    fn add_appends_numbered_suffix_on_name_collision_with_different_content() {
        let (_dir, store) = temp_store();
        assert_eq!(store.add("photo.png", b"v1").unwrap(), "photo.png");
        assert_eq!(store.add("photo.png", b"v2").unwrap(), "photo-1.png");
        assert_eq!(store.add("photo.png", b"v3").unwrap(), "photo-2.png");
        assert_eq!(store.add("clip", b"a1").unwrap(), "clip");
        assert_eq!(store.add("clip", b"a2").unwrap(), "clip-1");

        assert_eq!(store.read("photo.png").unwrap(), b"v1");
        assert_eq!(store.read("photo-1.png").unwrap(), b"v2");
        assert_eq!(store.read("photo-2.png").unwrap(), b"v3");
        assert_eq!(store.read("clip-1").unwrap(), b"a2");
    }

    #[test]
    fn rejects_path_traversal_and_absolute_paths() {
        let (_dir, store) = temp_store();
        let db = db_with_notes(&[]);
        let bad_names = [
            "../x.png",
            r"..\x.png",
            "sub/x.png",
            r"sub\x.png",
            "/etc/passwd",
            r"C:\secret.png",
            "C:drive-relative.png",
            ".",
            "..",
            "",
            "bad\0name.png",
        ];

        for bad in bad_names {
            assert!(
                matches!(store.add(bad, b"x"), Err(CoreError::Invalid(_))),
                "add accepted unsafe name: {bad:?}"
            );
            assert!(
                matches!(store.read(bad), Err(CoreError::Invalid(_))),
                "read accepted unsafe name: {bad:?}"
            );
            assert!(
                matches!(store.delete(&[bad.to_string()]), Err(CoreError::Invalid(_))),
                "delete accepted unsafe name: {bad:?}"
            );
            assert!(
                matches!(
                    store.rename(&db, bad, "ok.png", 1),
                    Err(CoreError::Invalid(_))
                ),
                "rename old accepted unsafe name: {bad:?}"
            );
            assert!(
                matches!(
                    store.rename(&db, "ok.png", bad, 1),
                    Err(CoreError::Invalid(_))
                ),
                "rename new accepted unsafe name: {bad:?}"
            );
        }
    }

    #[test]
    fn unused_detection_usage_counts_and_check_media() {
        let (_dir, store) = temp_store();
        store.add("used.png", b"u").unwrap();
        store.add("orphan.jpg", b"o").unwrap();
        store.add("audio.mp3", b"a").unwrap();

        let db = db_with_notes(&[
            &[r#"front <img src="used.png">"#, "[sound:audio.mp3]"],
            &[
                r#"second <img src="used.png"> <img src="missing.png">"#,
                "back",
            ],
        ]);

        let counts = store.usage_counts(&db).unwrap();
        assert_eq!(counts.get("used.png"), Some(&2));
        assert_eq!(counts.get("audio.mp3"), Some(&1));
        assert_eq!(counts.get("orphan.jpg"), Some(&0));
        assert_eq!(counts.get("missing.png"), Some(&1));

        assert_eq!(store.find_unused(&db).unwrap(), vec!["orphan.jpg"]);

        let report = store.check_media(&db).unwrap();
        assert_eq!(report.orphan_files, vec!["orphan.jpg"]);
        assert_eq!(report.missing_files, vec!["missing.png"]);

        assert_eq!(store.delete(&["orphan.jpg".into()]).unwrap(), 1);
        assert!(store.find_unused(&db).unwrap().is_empty());
    }

    #[test]
    fn rename_moves_file_and_rewrites_note_fields() {
        let (_dir, store) = temp_store();
        store.add("old.png", b"img-bytes").unwrap();
        store.add("other.png", b"other-bytes").unwrap();

        let db = db_with_notes(&[
            &[r#"card1 <img src="old.png">"#, "[sound:old.png]"],
            &[r#"card2 <img src="other.png">"#, "plain"],
        ]);

        // Rejects overwriting an existing file on disk.
        assert!(matches!(
            store.rename(&db, "old.png", "other.png", 100),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(store.read("old.png").unwrap(), b"img-bytes");

        let updated = store.rename(&db, "old.png", "new.png", 200).unwrap();
        assert_eq!(updated, 1);

        assert!(matches!(store.read("old.png"), Err(CoreError::NotFound(_))));
        assert_eq!(store.read("new.png").unwrap(), b"img-bytes");
        assert!(store.find_unused(&db).unwrap().is_empty());

        let counts = store.usage_counts(&db).unwrap();
        assert_eq!(counts.get("old.png"), None);
        assert_eq!(counts.get("new.png"), Some(&1));
    }

    #[test]
    fn lazy_index_only_hashes_same_size_and_unlocks_while_hashing() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        let dir = tempfile::tempdir().unwrap();
        let media_dir = dir.path().join("collection.media");
        fs::create_dir_all(&media_dir).unwrap();
        fs::write(media_dir.join("unrelated-big.bin"), vec![b'x'; 16 * 1024]).unwrap();
        fs::write(media_dir.join("same-size.bin"), b"alpha").unwrap();

        let store = Arc::new(FsMediaStore::new(media_dir));
        let hash_calls = Arc::new(AtomicUsize::new(0));
        let lock_free_during_hash = Arc::new(AtomicUsize::new(0));
        {
            let store_ref = Arc::clone(&store);
            let hash_calls_ref = Arc::clone(&hash_calls);
            let lock_free_ref = Arc::clone(&lock_free_during_hash);
            *store.on_hash_hook.lock().unwrap() = Some(Box::new(move || {
                hash_calls_ref.fetch_add(1, Ordering::SeqCst);
                if store_ref.index.try_lock().is_ok() {
                    lock_free_ref.fetch_add(1, Ordering::SeqCst);
                }
            }));
        }

        let deduped = store.add("duplicate.bin", b"alpha").unwrap();
        assert_eq!(deduped, "same-size.bin");
        assert_eq!(hash_calls.load(Ordering::SeqCst), 1);
        assert_eq!(lock_free_during_hash.load(Ordering::SeqCst), 1);

        // Second identical add reuses cached SHA-1 without re-hashing.
        assert_eq!(store.add("third.bin", b"alpha").unwrap(), "same-size.bin");
        assert_eq!(hash_calls.load(Ordering::SeqCst), 1);

        let idx = store.index.lock().unwrap();
        assert!(idx.by_name["unrelated-big.bin"].sha1.is_none());
        assert!(idx.by_name["same-size.bin"].sha1.is_some());
    }

    #[test]
    fn cache_stays_correct_after_delete_rename_and_disk_modification() {
        use std::time::{Duration, SystemTime};

        let (_dir, store) = temp_store();
        let db = db_with_notes(&[]);

        // 1. Add and delete -> stale name is never returned by dedup.
        assert_eq!(store.add("a.png", b"alpha-content").unwrap(), "a.png");
        assert_eq!(store.add("a-dup.png", b"alpha-content").unwrap(), "a.png");
        assert_eq!(store.delete(&["a.png".into()]).unwrap(), 1);
        assert_eq!(store.add("b.png", b"alpha-content").unwrap(), "b.png");

        // 2. Rename -> dedup follows new name and old name becomes available again.
        assert_eq!(store.rename(&db, "b.png", "moved.png", 100).unwrap(), 0);
        assert_eq!(store.add("c.png", b"alpha-content").unwrap(), "moved.png");
        assert_eq!(store.add("b.png", b"brand-new").unwrap(), "b.png");

        // 3. Same-size overwrite on disk with updated mtime -> no false dedup & list updates hash.
        let moved_path = store.root().join("moved.png");
        fs::write(&moved_path, b"omega-content").unwrap();
        let future = SystemTime::now() + Duration::from_secs(5);
        fs::OpenOptions::new()
            .write(true)
            .open(&moved_path)
            .unwrap()
            .set_modified(future)
            .unwrap();

        assert_eq!(
            store.add("want-alpha.png", b"alpha-content").unwrap(),
            "want-alpha.png"
        );

        // Different-size overwrite on disk -> `list()` invalidates stale size/hash.
        fs::write(&moved_path, b"much-longer-disk-content").unwrap();
        let future2 = SystemTime::now() + Duration::from_secs(10);
        fs::OpenOptions::new()
            .write(true)
            .open(&moved_path)
            .unwrap()
            .set_modified(future2)
            .unwrap();

        let entries = store.list().unwrap();
        let moved_entry = entries.iter().find(|e| e.filename == "moved.png").unwrap();
        assert_eq!(
            moved_entry.size_bytes,
            b"much-longer-disk-content".len() as u64
        );
        assert_eq!(moved_entry.sha1, sha1_hex(b"much-longer-disk-content"));

        // 4. External file dropped directly into folder -> next add rescans when dir mtime changes.
        std::thread::sleep(Duration::from_millis(25));
        fs::write(store.root().join("external.png"), b"dropped-from-outside").unwrap();
        assert_eq!(
            store.add("copy-ext.png", b"dropped-from-outside").unwrap(),
            "external.png"
        );
    }

    #[test]
    fn add_2000_files_into_5000_existing_folder_stays_fast() {
        use std::time::{Duration, Instant};

        let dir = tempfile::tempdir().unwrap();
        let media_dir = dir.path().join("collection.media");
        fs::create_dir_all(&media_dir).unwrap();

        for i in 0..5_000usize {
            let name = format!("existing-{i:04}.bin");
            let content = format!("existing-payload-{i:04}-data");
            fs::write(media_dir.join(name), content.as_bytes()).unwrap();
        }
        fs::write(media_dir.join("shared.png"), b"shared-payload-bytes").unwrap();

        let store = FsMediaStore::new(media_dir);
        let started = Instant::now();
        for i in 0..2_000usize {
            let name = format!("import-{i:04}.bin");
            let content = format!("new-import-payload-{i:04}");
            let stored = store.add(&name, content.as_bytes()).unwrap();
            assert_eq!(stored, name);
        }
        assert_eq!(
            store.add("dup.png", b"shared-payload-bytes").unwrap(),
            "shared.png"
        );
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(10),
            "adding 2,000 files into 5,000 existing took too long: {elapsed:?}"
        );
    }

    #[test]
    fn media_library_lists_usage_counts_searches_pages_and_deletes_unused() {
        use bibalak_core::ipc::{MediaKind, MediaLibraryFilter};
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;

        let (_dir, store) = temp_store();
        store.add("alpha.png", b"alpha-img-bytes").unwrap();
        store.add("beta.mp3", b"beta-aud").unwrap();
        store.add("gamma.mp4", b"gamma-video-data").unwrap();
        store.add("zeta-unused.jpg", b"orphan-1").unwrap();
        store.add("z-doc.bin", b"other").unwrap();

        let db = db_with_notes(&[
            &[
                r#"card1 <img src="alpha.png"> <img src='alpha.png'>"#,
                "[sound:beta.mp3]",
            ],
            &[r#"card2 <img src="alpha.png">"#, "second note"],
            &[r#"card3 <img src="gamma.mp4">"#, "[sound:missing.wav]"],
        ]);
        let col = Collection::new(Box::new(db), Arc::new(SystemClock)).unwrap();
        let default_filter = MediaLibraryFilter::default();

        // Full page check (size_bytes, kind, distinct-note usage counts, totals).
        let page1 = col
            .list_media_library(&store, "", &default_filter, 2, 0)
            .unwrap();
        assert_eq!(page1.total_count, 5);
        assert_eq!(page1.library_count, 5);
        assert_eq!(page1.unused_count, 2);
        assert_eq!(page1.total_bytes, 15 + 8 + 16 + 8 + 5);
        assert_eq!(page1.items.len(), 2);
        assert_eq!(page1.items[0].filename, "alpha.png");
        assert_eq!(page1.items[0].kind, MediaKind::Image);
        assert_eq!(page1.items[0].usage_count, 2);
        assert_eq!(page1.items[0].size_bytes, 15);
        assert_eq!(page1.items[1].filename, "beta.mp3");
        assert_eq!(page1.items[1].kind, MediaKind::Audio);
        assert_eq!(page1.items[1].usage_count, 1);

        let page2 = col
            .list_media_library(&store, "", &default_filter, 2, 2)
            .unwrap();
        assert_eq!(page2.items.len(), 2);
        assert_eq!(page2.items[0].filename, "gamma.mp4");
        assert_eq!(page2.items[0].kind, MediaKind::Video);
        assert_eq!(page2.items[1].filename, "z-doc.bin");
        assert_eq!(page2.items[1].kind, MediaKind::Other);
        assert_eq!(page2.items[1].usage_count, 0);

        // Search filter narrows scoped library_count & unused_count (A2-20).
        let filtered = col
            .list_media_library(&store, "BETA", &default_filter, 10, 0)
            .unwrap();
        assert_eq!(filtered.total_count, 1);
        assert_eq!(filtered.library_count, 1);
        assert_eq!(filtered.unused_count, 0);
        assert_eq!(filtered.items[0].filename, "beta.mp3");

        // Delete unused removes only the 2 unreferenced stored files.
        let deleted = col.delete_unused_media(&store).unwrap();
        assert_eq!(deleted, 2);

        let after = col
            .list_media_library(&store, "", &default_filter, 10, 0)
            .unwrap();
        assert_eq!(after.library_count, 3);
        assert_eq!(after.unused_count, 0);
        assert_eq!(
            after
                .items
                .iter()
                .map(|i| i.filename.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha.png", "beta.mp3", "gamma.mp4"]
        );
    }

    #[test]
    fn media_library_filters_by_deck_tag_kind_usage_and_sort_with_real_collection() {
        use bibalak_core::ipc::{MediaKind, MediaLibraryFilter, MediaSort, MediaUsageFilter};
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;

        let (_dir, store) = temp_store();
        store.add("shared.png", b"123456").unwrap(); // 6 bytes
        store.add("hola.mp3", b"123456789012").unwrap(); // 12 bytes
        store.add("heart.mp4", b"123456789012345678").unwrap(); // 18 bytes
        store.add("orphan.png", b"123").unwrap(); // 3 bytes

        let db = SqliteStorage::open_in_memory().unwrap();
        let col = Collection::new(Box::new(db), Arc::new(SystemClock)).unwrap();
        let spanish = col.create_deck("Spanish").unwrap();
        let cardio = col.create_deck("Medicine::Cardiology").unwrap();
        let nt = col.add_stock_notetype(0).unwrap();

        col.add_note(
            nt.id,
            spanish.id,
            &[
                r#"hola <img src="shared.png">"#.into(),
                "[sound:hola.mp3]".into(),
            ],
            &["verbs".into()],
        )
        .unwrap();
        col.add_note(
            nt.id,
            cardio.id,
            &[
                r#"heart <img src="shared.png"> <img src="heart.mp4">"#.into(),
                "back".into(),
            ],
            &["anatomy".into()],
        )
        .unwrap();

        // Deck filter: Spanish has shared.png (usage 1) + hola.mp3 (usage 1)
        let spanish_page = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: r#"deck:"Spanish""#.into(),
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(spanish_page.library_count, 2);
        assert_eq!(spanish_page.unused_count, 0);
        assert_eq!(spanish_page.total_count, 2);
        assert_eq!(
            spanish_page
                .items
                .iter()
                .map(|i| (i.filename.as_str(), i.usage_count))
                .collect::<Vec<_>>(),
            vec![("hola.mp3", 1), ("shared.png", 1)]
        );

        // Tag + kind filter
        let tag_audio = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: "tag:verbs".into(),
                    kind: Some(MediaKind::Audio),
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(tag_audio.total_count, 1);
        assert_eq!(tag_audio.items[0].filename, "hola.mp3");

        // Usage = Unused without query
        let unused = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    usage: MediaUsageFilter::Unused,
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(unused.total_count, 1);
        assert_eq!(unused.items[0].filename, "orphan.png");

        // Usage = Used + Sort = UsageDesc
        let used_by_usage = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    usage: MediaUsageFilter::Used,
                    sort: MediaSort::UsageDesc,
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(used_by_usage.total_count, 3);
        assert_eq!(used_by_usage.items[0].filename, "shared.png");
        assert_eq!(used_by_usage.items[0].usage_count, 2);

        // Sort = SizeDesc
        let by_size = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    sort: MediaSort::SizeDesc,
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(
            by_size
                .items
                .iter()
                .map(|i| i.filename.as_str())
                .collect::<Vec<_>>(),
            vec!["heart.mp4", "hola.mp3", "shared.png", "orphan.png"]
        );
    }

    #[test]
    #[ignore = "100k-note perf benchmark (run with --release -- --ignored --nocapture)"]
    fn perf_100k_list_media_library() {
        use bibalak_core::ipc::MediaLibraryFilter;
        use bibalak_core::model::{
            CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Template,
        };
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let store = FsMediaStore::new(dir.path().join("collection.media"));
        for i in 0..200 {
            let name = format!("asset-{i:03}.png");
            store.add(&name, name.as_bytes()).unwrap();
        }
        for i in 0..20 {
            let name = format!("unused-{i:02}.png");
            store.add(&name, name.as_bytes()).unwrap();
        }

        let mut decks = vec![Deck {
            id: 1,
            name: "Default".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        }];
        for top in 0..4_i64 {
            decks.push(Deck {
                id: 100 + top,
                name: format!("Subject {top}"),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            });
        }

        let notes_total = 100_000_usize;
        let mut notes = Vec::with_capacity(notes_total);
        let mut cards = Vec::with_capacity(notes_total);
        for i in 0..notes_total as i64 {
            let note_id = 1_000_000 + i;
            let deck_id = 100 + (i % 4);
            let media_idx = (i as usize) % 200;
            notes.push(Note {
                id: note_id,
                guid: format!("g-{i}"),
                notetype_id: 10,
                mod_ms: 0,
                usn: -1,
                tags: vec![format!("t{}", i % 12)],
                fields: vec![
                    format!(r#"Front {i} <img src="asset-{media_idx:03}.png">"#),
                    "Back".into(),
                ],
                sort_field: Some(format!("Front {i}")),
                checksum: None,
            });
            cards.push(Card {
                id: 2_000_000 + i,
                note_id,
                deck_id,
                ord: 0,
                mod_ms: 0,
                usn: -1,
                ctype: 2,
                queue: 2,
                due: 10,
                interval: 10,
                ease_factor: 2500,
                reps: 1,
                lapses: 0,
                remaining: 0,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            });
        }

        let model = CanonicalModel {
            created_ms: Some(1_700_000_000_000),
            deck_configs: vec![DeckConfig {
                id: 1,
                name: "Default".into(),
                mod_ms: 0,
                usn: 0,
                config_json: "{}".into(),
            }],
            decks,
            notetypes: vec![Notetype {
                id: 10,
                name: "Basic".into(),
                kind: 0,
                mod_ms: 0,
                usn: -1,
                config_json: "{}".into(),
            }],
            fields: vec![
                Field {
                    notetype_id: 10,
                    ord: 0,
                    name: "Front".into(),
                    config_json: "{}".into(),
                },
                Field {
                    notetype_id: 10,
                    ord: 1,
                    name: "Back".into(),
                    config_json: "{}".into(),
                },
            ],
            templates: vec![Template {
                notetype_id: 10,
                ord: 0,
                name: "Card 1".into(),
                qfmt: "{{Front}}".into(),
                afmt: "{{Back}}".into(),
                config_json: "{}".into(),
            }],
            notes,
            cards,
            revlog: vec![],
        };

        let db = SqliteStorage::open_in_memory().unwrap();
        let col = Collection::new(Box::new(db), Arc::new(SystemClock)).unwrap();
        col.import(&model).unwrap();

        let unfiltered = MediaLibraryFilter::default();
        let deck_filter = MediaLibraryFilter {
            query: r#"deck:"Subject 0""#.into(),
            ..Default::default()
        };

        // Warm-up
        let p0 = col
            .list_media_library(&store, "", &unfiltered, 48, 0)
            .unwrap();
        let p1 = col
            .list_media_library(&store, "", &deck_filter, 48, 0)
            .unwrap();
        assert_eq!(p0.library_count, 220);
        assert_eq!(p1.library_count, 220);

        let median_ms = |mut f: Box<dyn FnMut()>| -> f64 {
            let mut times = Vec::with_capacity(5);
            for _ in 0..5 {
                let t0 = Instant::now();
                f();
                times.push(t0.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.total_cmp(b));
            times[2]
        };

        let unfiltered_ms = median_ms(Box::new(|| {
            let _ = col
                .list_media_library(&store, "", &unfiltered, 48, 0)
                .unwrap();
        }));
        let deck_ms = median_ms(Box::new(|| {
            let _ = col
                .list_media_library(&store, "", &deck_filter, 48, 0)
                .unwrap();
        }));
        println!("perf_100k_list_media_library: unfiltered={unfiltered_ms:.1} ms, deck_query={deck_ms:.1} ms");
    }

    #[test]
    fn used_media_not_marked_unused_case_insensitive() {
        let (_dir, store) = temp_store();
        store.add("Foo.JPG", b"img").unwrap();
        let db = db_with_notes(&[&["front", r#"<img src="foo.jpg">"#]]);

        let counts = store.usage_counts_with_case(&db, true).unwrap();
        assert_eq!(counts.get("Foo.JPG"), Some(&1));
        assert!(store.find_unused_with_case(&db, true).unwrap().is_empty());

        let report = store.check_media_with_case(&db, true).unwrap();
        assert!(report.orphan_files.is_empty());
        assert!(report.missing_files.is_empty());

        // Unicode NFC vs NFD (macOS decomposes filenames to NFD while HTML holds NFC).
        let (_dir2, store2) = temp_store();
        let nfd_name = "cafe\u{0301}.png";
        store2.add(nfd_name, b"cafebytes").unwrap();
        let db2 = db_with_notes(&[&["front", r#"<img src="café.png">"#]]);
        assert!(store2
            .find_unused_with_case(&db2, false)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn template_and_underscore_files_count_as_used() {
        let (_dir, store) = temp_store();
        store.add("_shared_style.css", b"body{}").unwrap();
        store.add("tpl_banner.png", b"banner").unwrap();
        store.add("orphan.png", b"orphan").unwrap();

        let db = SqliteStorage::open_in_memory().unwrap();
        db.ensure_collection(1_700_000_000_000).unwrap();
        let nt_id = db.create_notetype("WithMedia", 0, 1_000).unwrap();
        db.save_template(
            nt_id,
            0,
            "Card 1",
            r#"<img src="tpl_banner.png">{{Front}}"#,
            "{{Back}}",
            1_000,
        )
        .unwrap();

        let counts = store.usage_counts(&db).unwrap();
        assert!(counts.get("_shared_style.css").copied().unwrap_or(0) >= 1);
        assert_eq!(counts.get("tpl_banner.png"), Some(&1));
        assert_eq!(counts.get("orphan.png"), Some(&0));
        assert_eq!(store.find_unused(&db).unwrap(), vec!["orphan.png"]);
    }

    #[test]
    fn delete_unused_never_deletes_a_used_file() {
        let (_dir, store) = temp_store();
        store.add("used_unquoted.png", b"1").unwrap();
        store.add("used%encoded.png", b"2").unwrap();
        store.add("_helper.css", b"3").unwrap();
        store.add("really_unused.png", b"4").unwrap();

        let db = db_with_notes(&[&[
            "front",
            r#"<img src=used_unquoted.png> <img src="used%25encoded.png">"#,
        ]]);
        let col = bibalak_core::Collection::new(
            Box::new(db),
            std::sync::Arc::new(bibalak_core::ports::FixedClock(1_000)),
        )
        .unwrap();

        let deleted = col.delete_unused_media(&store).unwrap();
        assert_eq!(deleted, 1);
        assert!(store.read("used_unquoted.png").is_ok());
        assert!(store.read("used%encoded.png").is_ok());
        assert!(store.read("_helper.css").is_ok());
        assert!(matches!(
            store.read("really_unused.png"),
            Err(CoreError::NotFound(_))
        ));
        assert!(store
            .root()
            .join(".trash")
            .join("really_unused.png")
            .is_file());
    }

    #[test]
    fn list_sizes_and_open_reader_never_hash_existing_files() {
        use std::io::Read;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("collection.media");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("cold_a.bin"), b"payload-a").unwrap();
        std::fs::write(root.join("cold_b.bin"), b"payload-b").unwrap();

        let store = FsMediaStore::new(root);
        let hashes = Arc::new(AtomicUsize::new(0));
        let hashes_cb = hashes.clone();
        *store.on_hash_hook.lock().unwrap() = Some(Box::new(move || {
            hashes_cb.fetch_add(1, Ordering::Relaxed);
        }));

        let sizes = store.list_sizes().unwrap();
        assert_eq!(
            sizes,
            vec![("cold_a.bin".into(), 9), ("cold_b.bin".into(), 9)]
        );
        let mut buf = Vec::new();
        store
            .open_reader("cold_a.bin")
            .unwrap()
            .read_to_end(&mut buf)
            .unwrap();
        assert_eq!(buf, b"payload-a");
        assert_eq!(hashes.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn a2_04_template_wrapped_media_counts_as_used() {
        let (_dir, store) = temp_store();
        store.add("diagram.png", b"img-bytes").unwrap();
        store.add("voice.mp3", b"mp3-bytes").unwrap();

        let s = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_700_000_000_000;
        s.ensure_collection(now_ms).unwrap();
        let nt_id = s.create_notetype("PicWrap", 0, now_ms).unwrap();
        s.save_template(
            nt_id,
            0,
            "Card 1",
            r#"<img src="{{Front}}">[sound:{{Back}}]"#,
            "{{Back}}",
            now_ms,
        )
        .unwrap();
        s.add_note_with_cards(
            nt_id,
            1,
            &["diagram.png".into(), "voice.mp3".into()],
            &[],
            now_ms,
        )
        .unwrap();

        let unused = store.find_unused(&s).unwrap();
        assert!(
            !unused.contains(&"diagram.png".to_string())
                && !unused.contains(&"voice.mp3".to_string()),
            "template-wrapped media must not be treated as unused: {unused:?}"
        );
        let counts = store.usage_counts(&s).unwrap();
        assert_eq!(counts.get("diagram.png"), Some(&1));
        assert_eq!(counts.get("voice.mp3"), Some(&1));
    }

    #[test]
    fn a4_04_and_a2_19_validate_media_filename_rejects_windows_reserved_trailing_and_ctrl() {
        for bad in [
            "CON",
            "con.png",
            "nul.mp3",
            "PRN.jpg",
            "AUX",
            "COM1.wav",
            "lpt9.ogg",
            "photo.png ",
            "photo.png.",
            "bad\nname.png",
            "bad\x07name.png",
            "12:30.mp3",
        ] {
            assert!(
                validate_media_filename(bad).is_err(),
                "expected invalid filename: {bad:?}"
            );
        }
        assert_eq!(
            normalize_import_media_filename("12:30.mp3").as_deref(),
            Some("12_30.mp3")
        );
        assert_eq!(
            normalize_import_media_filename("CON.png").as_deref(),
            Some("_CON.png")
        );
        assert_eq!(normalize_import_media_filename(".."), None);
    }

    #[test]
    fn a4_08_media_store_rejects_html_and_js_and_allows_sandboxed_svg() {
        let (_dir, store) = temp_store();
        assert!(matches!(
            store.add("page.html", b"<script>alert(1)</script>"),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            store.add("_helper.js", b"alert(1)"),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            store.add("mod.mjs", b"export {}"),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(
            store
                .add(
                    "diagram.svg",
                    br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#
                )
                .unwrap(),
            "diagram.svg"
        );
        assert_eq!(allowed_media_mime("diagram.svg"), Some("image/svg+xml"));
        assert_eq!(allowed_media_mime("page.html"), None);
        assert_eq!(allowed_media_mime("_helper.js"), None);
    }

    #[test]
    fn a2_31_restore_trashed_moves_file_back_and_rejects_conflict() {
        let (_dir, store) = temp_store();
        store.add("unused.png", b"dead").unwrap();
        let removed = store.delete(&["unused.png".into()]).unwrap();
        assert_eq!(removed, 1);
        assert!(!store.root().join("unused.png").exists());
        assert!(store.root().join(".trash/unused.png").is_file());

        store.restore_trashed("unused.png").unwrap();
        assert_eq!(store.read("unused.png").unwrap(), b"dead");
        assert!(!store.root().join(".trash/unused.png").exists());
        assert!(matches!(
            store.restore_trashed("missing.png"),
            Err(CoreError::NotFound(_))
        ));

        // Conflict with an existing file in collection.media must fail without overwriting.
        std::fs::write(store.root().join(".trash/unused.png"), b"old").unwrap();
        assert!(matches!(
            store.restore_trashed("unused.png"),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(store.read("unused.png").unwrap(), b"dead");
    }

    #[test]
    fn a2_20_media_library_deck_filter_unused_returns_empty_and_ignores_templates() {
        use bibalak_core::ipc::{MediaLibraryFilter, MediaUsageFilter};
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let (_dir, store) = temp_store();
        store.add("bg.png", b"bg").unwrap();
        store.add("orphan.png", b"orphan").unwrap();

        let s = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_700_000_000_000;
        s.ensure_collection(now_ms).unwrap();
        let nt_id = s.add_stock_notetype(0, now_ms).unwrap();
        s.save_notetype_css(nt_id, ".card { background: url(\"bg.png\"); }", now_ms)
            .unwrap();
        s.add_note_with_cards(nt_id, 1, &["Q".into(), "A".into()], &[], now_ms)
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(now_ms))).unwrap();
        // Template/CSS media should be counted as used even when a deck query is applied.
        let deck_used = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: "deck:\"Default\"".into(),
                    usage: MediaUsageFilter::All,
                    ..Default::default()
                },
                50,
                0,
            )
            .unwrap();
        assert!(
            deck_used.items.iter().any(|i| i.filename == "bg.png"),
            "template/CSS media must show under deck usage"
        );
        // Combining Unused + deck filter must not silently drop all unused files.
        let deck_unused = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: "deck:\"Default\"".into(),
                    usage: MediaUsageFilter::Unused,
                    ..Default::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(deck_unused.total_count, 1);
    }
}

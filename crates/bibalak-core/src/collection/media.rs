use std::collections::HashMap;

use crate::error::CoreResult;
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{
    MediaLibraryFilter, MediaLibraryItem, MediaLibraryPage, MediaSort, MediaUsageFilter,
};
use crate::media_refs::classify_media_kind;
use crate::ports::MediaStore;
use crate::Collection;

const MAX_MEDIA_PAGE_SIZE: u32 = 500;

impl Collection {
    /// Return a paged, filtered, and sorted view of stored files in `media`
    /// with distinct-note usage counts, plus whole-library totals
    /// (`library_count`, `unused_count`, `total_bytes`).
    pub fn list_media_library(
        &self,
        media: &dyn MediaStore,
        search: &str,
        filter: &MediaLibraryFilter,
        limit: u32,
        offset: u32,
    ) -> CoreResult<MediaLibraryPage> {
        let sizes = media.list_sizes()?;
        let all_counts = media.usage_counts(self.storage.as_ref())?;
        let query = filter.query.trim();
        let matched_counts: Option<HashMap<String, u32>> = if query.is_empty() {
            None
        } else {
            Some(
                self.storage
                    .note_media_ref_counts_matching(query, self.today(), self.clock.now_ms())?
                    .into_iter()
                    .collect(),
            )
        };

        let needle = search.trim().to_lowercase();

        let mut scope_count = 0u32;
        let mut unused_count = 0u32;
        let mut total_bytes: u64 = 0;
        let mut filtered: Vec<MediaLibraryItem> = Vec::new();
        for (filename, size_bytes) in sizes {
            if !needle.is_empty() && !filename.to_lowercase().contains(&needle) {
                continue;
            }

            let kind = classify_media_kind(&filename);
            if let Some(expected_kind) = filter.kind {
                if kind != expected_kind {
                    continue;
                }
            }

            let whole_usage = all_counts.get(&filename).copied().unwrap_or(0);
            let is_library_unused = whole_usage == 0;

            let (in_scope, usage_count) = match &matched_counts {
                Some(matched) => {
                    let count = matched.get(&filename).copied().unwrap_or(0);
                    if count > 0 {
                        (true, count)
                    } else if filter.usage == MediaUsageFilter::Unused && is_library_unused {
                        // A2-20: "Unused" files belong to no deck/tag; when combined with a
                        // deck/tag query, still surface library-unused items cleanly.
                        (true, 0)
                    } else {
                        (false, 0)
                    }
                }
                None => (true, whole_usage),
            };

            if !in_scope {
                continue;
            }

            scope_count = scope_count.saturating_add(1);
            if is_library_unused {
                unused_count = unused_count.saturating_add(1);
            }

            let matches_usage = match filter.usage {
                MediaUsageFilter::All => true,
                MediaUsageFilter::Used => usage_count > 0,
                MediaUsageFilter::Unused => is_library_unused,
            };
            if !matches_usage {
                continue;
            }

            total_bytes = total_bytes.saturating_add(size_bytes);
            filtered.push(MediaLibraryItem {
                filename,
                size_bytes,
                kind,
                usage_count,
            });
        }

        match filter.sort {
            MediaSort::Name => {}
            MediaSort::SizeDesc => {
                filtered.sort_by(|a, b| {
                    b.size_bytes
                        .cmp(&a.size_bytes)
                        .then_with(|| a.filename.cmp(&b.filename))
                });
            }
            MediaSort::UsageDesc => {
                filtered.sort_by(|a, b| {
                    b.usage_count
                        .cmp(&a.usage_count)
                        .then_with(|| a.filename.cmp(&b.filename))
                });
            }
        }

        let total_count = u32::try_from(filtered.len()).unwrap_or(u32::MAX);
        let page_limit = limit.clamp(1, MAX_MEDIA_PAGE_SIZE) as usize;
        let start = (offset as usize).min(filtered.len());
        let end = start.saturating_add(page_limit).min(filtered.len());

        Ok(MediaLibraryPage {
            items: filtered[start..end].to_vec(),
            total_count,
            library_count: scope_count,
            unused_count,
            total_bytes,
        })
    }

    /// Delete every stored file in `media` with zero references across all
    /// notes. Returns the number of deleted files and emits
    /// [`DomainEvent::MediaChanged`] when any file is removed.
    pub fn delete_unused_media(&self, media: &dyn MediaStore) -> CoreResult<u32> {
        let unused = media.find_unused(self.storage.as_ref())?;
        if unused.is_empty() {
            return Ok(0);
        }
        let deleted = media.delete(&unused)?;
        if deleted > 0 {
            self.events.emit(DomainEvent::MediaChanged);
        }
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use crate::collection::fake_storage::FakeStorage;
    use crate::ipc::{MediaKind, MediaLibraryFilter, MediaReport, MediaSort, MediaUsageFilter};
    use crate::ports::{FixedClock, MediaStore, Storage};
    use crate::{Collection, MediaEntry};

    struct FakeMediaStore {
        sizes: Vec<(String, u64)>,
    }

    impl MediaStore for FakeMediaStore {
        fn add(&self, filename: &str, _bytes: &[u8]) -> crate::error::CoreResult<String> {
            Ok(filename.to_string())
        }
        fn read(&self, _filename: &str) -> crate::error::CoreResult<Vec<u8>> {
            Ok(vec![])
        }
        fn list(&self) -> crate::error::CoreResult<Vec<MediaEntry>> {
            Ok(vec![])
        }
        fn list_sizes(&self) -> crate::error::CoreResult<Vec<(String, u64)>> {
            Ok(self.sizes.clone())
        }
        fn usage_counts(
            &self,
            storage: &dyn Storage,
        ) -> crate::error::CoreResult<BTreeMap<String, u32>> {
            let mut counts: BTreeMap<String, u32> =
                self.sizes.iter().map(|(n, _)| (n.clone(), 0)).collect();
            for (name, c) in storage.note_media_ref_counts()? {
                counts.insert(name, c);
            }
            Ok(counts)
        }
        fn find_unused(&self, _storage: &dyn Storage) -> crate::error::CoreResult<Vec<String>> {
            Ok(vec![])
        }
        fn check_media(&self, _storage: &dyn Storage) -> crate::error::CoreResult<MediaReport> {
            Ok(MediaReport {
                orphan_files: vec![],
                missing_files: vec![],
            })
        }
        fn delete(&self, _filenames: &[String]) -> crate::error::CoreResult<u32> {
            Ok(0)
        }
        fn rename(
            &self,
            _storage: &dyn Storage,
            _old_name: &str,
            _new_name: &str,
            _now_ms: i64,
        ) -> crate::error::CoreResult<u32> {
            Ok(0)
        }
    }

    #[test]
    fn list_media_library_filters_by_query_kind_usage_and_sorts_on_fake_storage() {
        let storage = FakeStorage::default();
        *storage.media_ref_counts.lock().unwrap() = vec![
            ("alpha.png".into(), 1),
            ("beta.mp3".into(), 4),
            ("clip.mp4".into(), 2),
        ];
        storage.media_ref_counts_by_query.lock().unwrap().insert(
            "deck:\"Spanish\"".into(),
            vec![("alpha.png".into(), 1), ("beta.mp3".into(), 2)],
        );
        let col = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
        let store = FakeMediaStore {
            sizes: vec![
                ("alpha.png".into(), 500),
                ("beta.mp3".into(), 100),
                ("clip.mp4".into(), 900),
                ("unused.png".into(), 300),
            ],
        };

        // 1. Query filter narrows visible items + usage_count and scoped totals (A2-20).
        let by_deck = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: "deck:\"Spanish\"".into(),
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(by_deck.library_count, 2);
        assert_eq!(by_deck.unused_count, 0);
        assert_eq!(by_deck.total_bytes, 600);
        assert_eq!(by_deck.total_count, 2);

        // 1b. Query filter + Unused still returns library-unused items cleanly.
        let by_deck_unused = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    query: "deck:\"Spanish\"".into(),
                    usage: MediaUsageFilter::Unused,
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(by_deck_unused.total_count, 1);
        assert_eq!(by_deck_unused.unused_count, 1);
        assert_eq!(by_deck_unused.total_bytes, 300);
        assert_eq!(by_deck_unused.items[0].filename, "unused.png");
        let names: Vec<_> = by_deck
            .items
            .iter()
            .map(|i| (i.filename.as_str(), i.usage_count))
            .collect();
        assert_eq!(names, vec![("alpha.png", 1), ("beta.mp3", 2)]);

        // 2. Kind filter.
        let audio_only = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    kind: Some(MediaKind::Audio),
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        assert_eq!(audio_only.total_count, 1);
        assert_eq!(audio_only.items[0].filename, "beta.mp3");

        // 3. Usage filter (Unused).
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
        assert_eq!(unused.items[0].filename, "unused.png");

        // 4. Sort by SizeDesc and UsageDesc with paging.
        let by_size = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    sort: MediaSort::SizeDesc,
                    ..Default::default()
                },
                2,
                0,
            )
            .unwrap();
        let size_names: Vec<_> = by_size.items.iter().map(|i| i.filename.as_str()).collect();
        assert_eq!(size_names, vec!["clip.mp4", "alpha.png"]);

        let by_usage = col
            .list_media_library(
                &store,
                "",
                &MediaLibraryFilter {
                    sort: MediaSort::UsageDesc,
                    ..Default::default()
                },
                48,
                0,
            )
            .unwrap();
        let usage_names: Vec<_> = by_usage.items.iter().map(|i| i.filename.as_str()).collect();
        assert_eq!(
            usage_names,
            vec!["beta.mp3", "clip.mp4", "alpha.png", "unused.png"]
        );
    }
}

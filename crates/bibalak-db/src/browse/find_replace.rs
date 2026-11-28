use std::borrow::Cow;
use std::collections::HashMap;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::FindReplacePreview;
use bibalak_core::model::NoteSnapshot;
use regex::RegexBuilder;
use rusqlite::Connection;

use super::notes::update_note;
use super::read::fields_for_notetype;
use super::{err, split_tags, FIELD_SEP};

fn compile_find_regex(
    find: &str,
    use_regex: bool,
    case_sensitive: bool,
) -> CoreResult<regex::Regex> {
    if find.is_empty() {
        return Err(CoreError::Invalid("search pattern cannot be empty".into()));
    }
    let pattern = if use_regex {
        Cow::Borrowed(find)
    } else {
        Cow::Owned(regex::escape(find))
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| CoreError::Invalid(format!("invalid search pattern: {e}")))
}

struct NoteEditRow {
    note_id: i64,
    notetype_id: i64,
    fields: Vec<String>,
    tags: Vec<String>,
}

fn load_notes_for_edit(conn: &Connection, note_ids: &[i64]) -> CoreResult<Vec<NoteEditRow>> {
    if note_ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(note_ids).map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, notetype_id, fields, tags FROM notes \
             WHERE id IN (SELECT value FROM json_each(?1)) ORDER BY id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([json], |r| {
            let fields_blob: String = r.get(2)?;
            let tags_blob: String = r.get(3)?;
            Ok(NoteEditRow {
                note_id: r.get(0)?,
                notetype_id: r.get(1)?,
                fields: fields_blob.split(FIELD_SEP).map(str::to_string).collect(),
                tags: split_tags(&tags_blob),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn target_field_indices(
    conn: &Connection,
    cache: &mut HashMap<i64, Vec<String>>,
    notetype_id: i64,
    field_len: usize,
    field_name: Option<&str>,
) -> CoreResult<Vec<usize>> {
    let Some(name) = field_name else {
        return Ok((0..field_len).collect());
    };
    let names = match cache.entry(notetype_id) {
        std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
        std::collections::hash_map::Entry::Vacant(entry) => {
            let f_names: Vec<String> = fields_for_notetype(conn, notetype_id)?
                .into_iter()
                .map(|f| f.name)
                .collect();
            entry.insert(f_names)
        }
    };
    Ok(names
        .iter()
        .enumerate()
        .filter_map(|(idx, n)| (idx < field_len && n == name).then_some(idx))
        .collect())
}

fn split_html_text_segments(input: &str) -> Vec<(bool, &str)> {
    let mut segments = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut text_start = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            let mut j = i + 1;
            let mut quote: Option<u8> = None;
            let mut closed = false;
            while j < bytes.len() {
                let b = bytes[j];
                match quote {
                    Some(q) if b == q => quote = None,
                    None if b == b'\'' || b == b'"' => quote = Some(b),
                    None if b == b'>' => {
                        closed = true;
                        j += 1;
                        break;
                    }
                    _ => {}
                }
                j += 1;
            }
            if closed {
                if i > text_start {
                    segments.push((true, &input[text_start..i]));
                }
                segments.push((false, &input[i..j]));
                i = j;
                text_start = j;
                continue;
            }
        }
        i += 1;
    }

    if text_start < input.len() {
        segments.push((true, &input[text_start..]));
    }
    segments
}

fn count_matches_in_field(re: &regex::Regex, value: &str, include_html: bool) -> u32 {
    if include_html {
        return re.find_iter(value).count() as u32;
    }
    split_html_text_segments(value)
        .into_iter()
        .filter(|(is_text, _)| *is_text)
        .map(|(_, seg)| re.find_iter(seg).count() as u32)
        .sum()
}

fn replace_in_field(
    re: &regex::Regex,
    value: &str,
    replace: &str,
    use_regex: bool,
    include_html: bool,
) -> Option<String> {
    if include_html {
        let replaced = if use_regex {
            re.replace_all(value, replace)
        } else {
            re.replace_all(value, regex::NoExpand(replace))
        };
        return match replaced {
            Cow::Owned(next) if next != value => Some(next),
            _ => None,
        };
    }

    let mut out = String::with_capacity(value.len());
    let mut changed = false;
    for (is_text, seg) in split_html_text_segments(value) {
        if !is_text {
            out.push_str(seg);
            continue;
        }
        let replaced = if use_regex {
            re.replace_all(seg, replace)
        } else {
            re.replace_all(seg, regex::NoExpand(replace))
        };
        if let Cow::Owned(next_seg) = replaced {
            if next_seg != seg {
                changed = true;
            }
            out.push_str(&next_seg);
        } else {
            out.push_str(seg);
        }
    }
    changed.then_some(out)
}

fn sample_snippet(s: &str) -> String {
    const MAX_CHARS: usize = 160;
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if idx >= MAX_CHARS {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

#[allow(clippy::too_many_arguments)]
pub fn preview_find_replace(
    conn: &Connection,
    note_ids: &[i64],
    field_name: Option<&str>,
    find: &str,
    replace: &str,
    use_regex: bool,
    case_sensitive: bool,
    include_html: bool,
) -> CoreResult<FindReplacePreview> {
    let re = compile_find_regex(find, use_regex, case_sensitive)?;
    let notes = load_notes_for_edit(conn, note_ids)?;
    let mut field_cache = HashMap::new();
    let mut notes_matched = 0u32;
    let mut occurrences = 0u32;
    let mut sample_before = None;
    let mut sample_after = None;

    for note in &notes {
        let indices = target_field_indices(
            conn,
            &mut field_cache,
            note.notetype_id,
            note.fields.len(),
            field_name,
        )?;
        let mut note_hits = 0u32;
        for idx in indices {
            let hits = count_matches_in_field(&re, &note.fields[idx], include_html);
            if hits > 0 {
                note_hits += hits;
                if sample_before.is_none() {
                    let after_val =
                        replace_in_field(&re, &note.fields[idx], replace, use_regex, include_html)
                            .unwrap_or_else(|| note.fields[idx].clone());
                    sample_before = Some(sample_snippet(&note.fields[idx]));
                    sample_after = Some(sample_snippet(&after_val));
                }
            }
        }
        if note_hits > 0 {
            notes_matched += 1;
            occurrences += note_hits;
        }
    }

    Ok(FindReplacePreview {
        notes_matched,
        occurrences,
        sample_before,
        sample_after,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn find_replace_notes(
    conn: &mut Connection,
    note_ids: &[i64],
    field_name: Option<&str>,
    find: &str,
    replace: &str,
    use_regex: bool,
    case_sensitive: bool,
    include_html: bool,
    now_ms: i64,
) -> CoreResult<Vec<NoteSnapshot>> {
    let re = compile_find_regex(find, use_regex, case_sensitive)?;
    if note_ids.is_empty() {
        return Ok(vec![]);
    }

    let tx = conn.transaction().map_err(err)?;
    let notes = load_notes_for_edit(&tx, note_ids)?;
    let mut field_cache = HashMap::new();
    let mut snapshots = Vec::new();

    for note in notes {
        let indices = target_field_indices(
            &tx,
            &mut field_cache,
            note.notetype_id,
            note.fields.len(),
            field_name,
        )?;
        let mut updated_fields = note.fields.clone();
        let mut changed = false;
        for idx in indices {
            if let Some(next_val) =
                replace_in_field(&re, &updated_fields[idx], replace, use_regex, include_html)
            {
                updated_fields[idx] = next_val;
                changed = true;
            }
        }
        if changed {
            snapshots.push(NoteSnapshot {
                note_id: note.note_id,
                fields: note.fields,
                tags: note.tags.clone(),
            });
            // Route through the canonical note update path so sort_field, checksum,
            // and fields_norm stay consistent with single-note edits.
            update_note(&tx, note.note_id, &updated_fields, &note.tags, now_ms)?;
        }
    }

    tx.commit().map_err(err)?;
    Ok(snapshots)
}

#[cfg(test)]
mod tests {
    use super::super::model;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn find_replace_all_or_one_field_plain_regex_case_updates_checksum_norm_index_and_undoes() {
        use bibalak_core::events::DomainEvent;
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use bibalak_search::NoteIndex;
        use std::sync::{Arc, Mutex};

        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_700_000_000_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let col = Collection::new(Box::new(s), Arc::new(FixedClock(1_700_000_000_000))).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        col.events().subscribe(move |e| {
            if matches!(e, DomainEvent::NotesUpdated { .. }) {
                captured.lock().unwrap().push(e.clone());
            }
        });

        let r1 = col
            .add_note(nt_id, 1, &["Beta alpha".into(), "Back alpha".into()], &[])
            .unwrap();
        let r2 = col
            .add_note(nt_id, 1, &["Alpha one".into(), "Back two".into()], &[])
            .unwrap();

        let prev_idx = col.index_rows().unwrap();
        let idx = NoteIndex::new().unwrap();
        idx.rebuild(&prev_idx).unwrap();
        assert_eq!(idx.search("alpha", 10).unwrap().len(), 2);

        // Preview across selected notes, all fields, case-insensitive plain
        let preview = col
            .preview_find_replace(
                &[r1.note_id, r2.note_id],
                None,
                "alpha",
                "gamma",
                false,
                false,
                false,
            )
            .unwrap();
        assert_eq!(preview.notes_matched, 2);
        assert_eq!(preview.occurrences, 3);
        assert_eq!(preview.sample_before.as_deref(), Some("Beta alpha"));
        assert_eq!(preview.sample_after.as_deref(), Some("Beta gamma"));

        // Replace only Back field case-insensitively
        let changed_back = col
            .find_replace_notes(
                &[r1.note_id, r2.note_id],
                Some("Back"),
                "alpha",
                "gamma",
                false,
                false,
                false,
            )
            .unwrap();
        assert_eq!(changed_back, 1);
        assert_eq!(
            col.note_detail(r1.note_id).unwrap().unwrap().fields[1].value,
            "Back gamma"
        );
        assert_eq!(
            col.note_detail(r1.note_id).unwrap().unwrap().fields[0].value,
            "Beta alpha"
        );

        // Verify exactly one NotesUpdated event was emitted and Tantivy index sees new text
        assert_eq!(events.lock().unwrap().len(), 1);
        let updated_rows = col.index_rows_for_notes(&[r1.note_id]).unwrap();
        idx.update_rows(&updated_rows).unwrap();
        assert_eq!(idx.search("gamma", 10).unwrap(), vec![r1.note_id]);

        // Regex capture on Front changes checksum & sort_field
        let csum_before = super::super::field_checksum("Alpha one");
        let changed_front = col
            .find_replace_notes(
                &[r2.note_id],
                Some("Front"),
                r"^(\w+)\s+one$",
                "$1 omega",
                true,
                true,
                false,
            )
            .unwrap();
        assert_eq!(changed_front, 1);
        let d2 = col.note_detail(r2.note_id).unwrap().unwrap();
        assert_eq!(d2.fields[0].value, "Alpha omega");
        assert_ne!(
            super::super::field_checksum(&d2.fields[0].value),
            csum_before
        );
        assert!(col.list_notes(Some("omega")).unwrap().len() == 1);

        // Undo restores r2 back to "Alpha one"
        col.undo().unwrap();
        assert_eq!(
            col.note_detail(r2.note_id).unwrap().unwrap().fields[0].value,
            "Alpha one"
        );

        // Replacing field 0 with empty string fails atomically
        assert!(col
            .find_replace_notes(
                &[r2.note_id],
                Some("Front"),
                "Alpha one",
                "   ",
                false,
                true,
                false
            )
            .is_err());
        assert_eq!(
            col.note_detail(r2.note_id).unwrap().unwrap().fields[0].value,
            "Alpha one"
        );
    }

    #[test]
    fn a2_14_skips_html_tags_by_default_and_replaces_tags_only_when_include_html() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_700_000_000_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let col = Collection::new(Box::new(s), Arc::new(FixedClock(1_700_000_000_000))).unwrap();

        let note = col
            .add_note(
                nt_id,
                1,
                &[
                    r#"<span class="cls">cls text</span>"#.into(),
                    "Plain".into(),
                ],
                &[],
            )
            .unwrap();

        let prev_safe = col
            .preview_find_replace(
                &[note.note_id],
                Some("Front"),
                "cls",
                "new",
                false,
                false,
                false,
            )
            .unwrap();
        assert_eq!(prev_safe.occurrences, 1);
        assert_eq!(
            prev_safe.sample_after.as_deref(),
            Some(r#"<span class="cls">new text</span>"#)
        );

        col.find_replace_notes(
            &[note.note_id],
            Some("Front"),
            "cls",
            "new",
            false,
            false,
            false,
        )
        .unwrap();
        assert_eq!(
            col.note_detail(note.note_id).unwrap().unwrap().fields[0].value,
            r#"<span class="cls">new text</span>"#
        );

        col.find_replace_notes(
            &[note.note_id],
            Some("Front"),
            "cls",
            "updated",
            false,
            false,
            true,
        )
        .unwrap();
        assert_eq!(
            col.note_detail(note.note_id).unwrap().unwrap().fields[0].value,
            r#"<span class="updated">new text</span>"#
        );
    }
}

//! Helpers for extracting and rewriting local media references in note fields,
//! templates, and CSS.
//!
//! Matches `<img|audio|video|source|script ... src=...>`, CSS `url(...)`, and `[sound:name]`.

use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;

/// Returns `true` when `src` refers to a local media entry rather than an empty,
/// rooted-path, external-URL, or `data:` URI reference.
pub fn is_local_media_ref(src: &str) -> bool {
    let trimmed = src.trim();
    !trimmed.is_empty()
        && !trimmed.starts_with(['/', ':'])
        && !trimmed.contains("://")
        && !trimmed
            .get(..5)
            .is_some_and(|p| p.eq_ignore_ascii_case("data:"))
}

/// Normalize a media filename for comparison: Unicode NFC, plus ASCII/Unicode
/// lowercasing when `case_insensitive` is true (Windows / macOS filesystems).
pub fn canonical_media_key(name: &str, case_insensitive: bool) -> String {
    let nfc: String = name.nfc().collect();
    if case_insensitive {
        nfc.to_lowercase()
    } else {
        nfc
    }
}

fn decode_html_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(semi_rel) = bytes[i + 1..].iter().take(16).position(|&b| b == b';') {
                let entity = &input[i + 1..i + 1 + semi_rel];
                let decoded = if let Some(hex) = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                {
                    u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse::<u32>().ok().and_then(char::from_u32)
                } else {
                    match entity {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        "nbsp" => Some(' '),
                        _ => None,
                    }
                };
                if let Some(ch) = decoded {
                    out.push(ch);
                    i += 1 + semi_rel + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_utf8(input: &str) -> String {
    if !input.contains('%') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut raw = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                raw.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        raw.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&raw).into_owned()
}

/// Decode HTML entities and percent-encoding in an HTML `src` attribute value.
pub fn decode_media_ref(raw: &str) -> String {
    let entity_decoded = decode_html_entities(raw.trim());
    percent_decode_utf8(&entity_decoded)
}

fn match_media_tag_len(bytes: &[u8], start: usize) -> Option<usize> {
    let prefixes: &[&[u8]] = &[b"<img", b"<audio", b"<video", b"<source", b"<script"];
    for &prefix in prefixes {
        let len = prefix.len();
        if bytes
            .get(start..start + len)
            .is_some_and(|sl| sl.eq_ignore_ascii_case(prefix))
        {
            let next = *bytes.get(start + len)?;
            if next.is_ascii_whitespace() || next == b'/' || next == b'>' {
                return Some(len);
            }
        }
    }
    None
}

fn find_tag_src_span(s: &str, tag_start: usize, tag_len: usize) -> Option<(usize, usize, usize)> {
    let bytes = s.as_bytes();
    let mut p = tag_start + tag_len;
    let mut gt = None;
    let mut active_quote: Option<u8> = None;
    let mut found_src: Option<(usize, usize)> = None;

    while p < bytes.len() {
        let b = bytes[p];
        if b == 0x1f {
            return None;
        }
        if let Some(q) = active_quote {
            if b == q {
                active_quote = None;
            }
            p += 1;
            continue;
        }
        if b == b'>' {
            gt = Some(p);
            break;
        }
        if b.is_ascii_whitespace()
            && found_src.is_none()
            && bytes
                .get(p + 1..p + 4)
                .is_some_and(|sl| sl.eq_ignore_ascii_case(b"src"))
        {
            let mut q_pos = p + 4;
            while q_pos < bytes.len() && bytes[q_pos].is_ascii_whitespace() {
                q_pos += 1;
            }
            if bytes.get(q_pos) == Some(&b'=') {
                q_pos += 1;
                while q_pos < bytes.len() && bytes[q_pos].is_ascii_whitespace() {
                    q_pos += 1;
                }
                if let Some(&q) = bytes.get(q_pos).filter(|&&c| c == b'"' || c == b'\'') {
                    let val_start = q_pos + 1;
                    if let Some(rel_end) = bytes[val_start..]
                        .iter()
                        .take_while(|&&c| c != b'>' && c != 0x1f)
                        .position(|&c| c == q)
                    {
                        let val_end = val_start + rel_end;
                        found_src = Some((val_start, val_end));
                        p = val_end + 1;
                        continue;
                    }
                } else if q_pos < bytes.len() && !matches!(bytes[q_pos], b'>' | 0x1f) {
                    let val_start = q_pos;
                    let mut val_end = val_start;
                    while val_end < bytes.len()
                        && !bytes[val_end].is_ascii_whitespace()
                        && bytes[val_end] != b'>'
                        && bytes[val_end] != 0x1f
                    {
                        val_end += 1;
                    }
                    // Exclude trailing `/` on self-closing `<img src=foo.png/>`.
                    if val_end > val_start
                        && bytes.get(val_end) == Some(&b'>')
                        && bytes[val_end - 1] == b'/'
                    {
                        val_end -= 1;
                    }
                    if val_end > val_start {
                        found_src = Some((val_start, val_end));
                        p = val_end;
                        continue;
                    }
                }
            }
        }
        if b == b'"' || b == b'\'' {
            active_quote = Some(b);
        }
        p += 1;
    }

    let gt = gt?;
    let (val_start, val_end) = found_src?;
    Some((val_start, val_end, gt + 1))
}

fn find_sound_ref_span(s: &str, start: usize) -> Option<(usize, usize, usize)> {
    let bytes = s.as_bytes();
    let val_start = start + "[sound:".len();
    let rel_end = bytes[val_start..]
        .iter()
        .take_while(|&&c| c != 0x1f)
        .position(|&c| c == b']')?;
    let val_end = val_start + rel_end;
    if val_end == val_start {
        return None;
    }
    Some((val_start, val_end, val_end + 1))
}

fn find_css_url_span(s: &str, start: usize) -> Option<(usize, usize, usize)> {
    let bytes = s.as_bytes();
    if !bytes
        .get(start..start + 4)
        .is_some_and(|sl| sl.eq_ignore_ascii_case(b"url("))
    {
        return None;
    }
    let mut p = start + 4;
    while p < bytes.len() && bytes[p].is_ascii_whitespace() {
        p += 1;
    }
    if p >= bytes.len() {
        return None;
    }
    if bytes[p] == b'"' || bytes[p] == b'\'' {
        let q = bytes[p];
        let val_start = p + 1;
        let rel_end = bytes[val_start..]
            .iter()
            .take_while(|&&c| c != 0x1f && c != b'\n' && c != b'\r')
            .position(|&c| c == q)?;
        let val_end = val_start + rel_end;
        let mut close = val_end + 1;
        while close < bytes.len() && bytes[close].is_ascii_whitespace() {
            close += 1;
        }
        if bytes.get(close) == Some(&b')') {
            return Some((val_start, val_end, close + 1));
        }
        return None;
    }
    let val_start = p;
    let rel_end = bytes[val_start..]
        .iter()
        .take_while(|&&c| c != 0x1f && c != b'\n' && c != b'\r')
        .position(|&c| c == b')')?;
    let mut val_end = val_start + rel_end;
    let close = val_end;
    while val_end > val_start && bytes[val_end - 1].is_ascii_whitespace() {
        val_end -= 1;
    }
    if val_end == val_start {
        return None;
    }
    Some((val_start, val_end, close + 1))
}

/// Collect unique local media filenames referenced across `text`
/// (`<img|audio|video|source ... src=...>`, CSS `url(...)`, and `[sound:...]`).
pub fn extract_media_refs(text: &str) -> BTreeSet<String> {
    let bytes = text.as_bytes();
    let mut set = BTreeSet::new();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            if let Some(tag_len) = match_media_tag_len(bytes, i) {
                if let Some((vs, ve, next)) = find_tag_src_span(text, i, tag_len) {
                    let decoded = decode_media_ref(&text[vs..ve]);
                    if is_local_media_ref(&decoded) {
                        set.insert(decoded);
                    }
                    i = next;
                    continue;
                }
            }
        } else if bytes[i] == b'[' && text[i..].starts_with("[sound:") {
            if let Some((vs, ve, next)) = find_sound_ref_span(text, i) {
                let name = text[vs..ve].trim();
                if !name.is_empty() {
                    set.insert(name.to_string());
                }
                i = next;
                continue;
            }
        } else if (bytes[i] == b'u' || bytes[i] == b'U')
            && bytes
                .get(i..i + 4)
                .is_some_and(|sl| sl.eq_ignore_ascii_case(b"url("))
        {
            if let Some((vs, ve, next)) = find_css_url_span(text, i) {
                let decoded = decode_media_ref(&text[vs..ve]);
                if is_local_media_ref(&decoded) {
                    set.insert(decoded);
                }
                i = next;
                continue;
            }
        }
        let ch_len = text[i..].chars().next().map_or(1, char::len_utf8);
        i += ch_len;
    }

    set
}

/// Rewrite `<img|audio|video|source ... src=...>`, CSS `url(...)`, and `[sound:...]`
/// in `text` using `lookup` in a single pass.
pub fn rewrite_media_refs_with<'a>(
    text: &str,
    mut lookup: impl FnMut(&str) -> Option<&'a str>,
) -> String {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut copied_until = 0;
    let mut i = 0;

    while i < bytes.len() {
        let (matched, is_src) = if bytes[i] == b'<' {
            match match_media_tag_len(bytes, i) {
                Some(tag_len) => (
                    find_tag_src_span(text, i, tag_len).filter(|&(vs, ve, _)| {
                        is_local_media_ref(&decode_media_ref(&text[vs..ve]))
                    }),
                    true,
                ),
                None => (None, false),
            }
        } else if bytes[i] == b'[' && text[i..].starts_with("[sound:") {
            (find_sound_ref_span(text, i), false)
        } else if (bytes[i] == b'u' || bytes[i] == b'U')
            && bytes
                .get(i..i + 4)
                .is_some_and(|sl| sl.eq_ignore_ascii_case(b"url("))
        {
            (
                find_css_url_span(text, i)
                    .filter(|&(vs, ve, _)| is_local_media_ref(&decode_media_ref(&text[vs..ve]))),
                true,
            )
        } else {
            (None, false)
        };

        if let Some((vs, ve, next)) = matched {
            let raw = &text[vs..ve];
            let replacement = lookup(raw).or_else(|| {
                if is_src {
                    let decoded = decode_media_ref(raw);
                    if decoded != raw {
                        lookup(&decoded)
                    } else {
                        None
                    }
                } else {
                    None
                }
            });
            if let Some(new_name) = replacement {
                let buf = out.get_or_insert_with(|| String::with_capacity(text.len()));
                buf.push_str(&text[copied_until..vs]);
                buf.push_str(new_name);
                copied_until = ve;
            }
            i = next;
        } else {
            let ch_len = text[i..].chars().next().map_or(1, char::len_utf8);
            i += ch_len;
        }
    }

    match out {
        Some(mut buf) => {
            buf.push_str(&text[copied_until..]);
            buf
        }
        None => text.to_string(),
    }
}

/// Rewrite exact local references from `old_name` to `new_name` in `text`.
pub fn rewrite_media_refs(text: &str, old_name: &str, new_name: &str) -> String {
    if old_name == new_name {
        return text.to_string();
    }
    rewrite_media_refs_with(text, |name| (name == old_name).then_some(new_name))
}

/// Classify a media filename into a broad display kind by file extension.
pub fn classify_media_kind(filename: &str) -> crate::ipc::MediaKind {
    use crate::ipc::MediaKind;
    let ext = filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico" | "tiff"
        | "tif" => MediaKind::Image,
        "mp3" | "ogg" | "wav" | "flac" | "aac" | "m4a" | "opus" | "oga" | "weba" => {
            MediaKind::Audio
        }
        "mp4" | "webm" | "mkv" | "mov" | "avi" | "ogv" | "m4v" => MediaKind::Video,
        _ => MediaKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_local_img_and_sound_refs_and_skips_remote_or_data() {
        let text = concat!(
            r#"<img src="a.png"> <IMG class="pic" SRC='b.jpg'> "#,
            r#"<img src="https://example.com/x.png"> <img src="data:image/png;base64,AA"> "#,
            r#"<img src="/abs.png"> [sound:c.mp3]"#,
        );
        assert_eq!(
            extract_media_refs(text),
            BTreeSet::from(["a.png".into(), "b.jpg".into(), "c.mp3".into()])
        );
    }

    #[test]
    fn rewrites_exact_refs_without_touching_substrings_or_chaining() {
        let input = r#"<img src="a.png"> <img class="x" src='a.png'> [sound:a.png] <img src="extra-a.png"> <img src="a-1.png">"#;
        assert_eq!(
            rewrite_media_refs(input, "a.png", "renamed.png"),
            r#"<img src="renamed.png"> <img class="x" src='renamed.png'> [sound:renamed.png] <img src="extra-a.png"> <img src="a-1.png">"#
        );

        let chained = rewrite_media_refs_with(input, |name| match name {
            "a.png" => Some("a-1.png"),
            "a-1.png" => Some("a-1-1.png"),
            _ => None,
        });
        assert_eq!(
            chained,
            r#"<img src="a-1.png"> <img class="x" src='a-1.png'> [sound:a-1.png] <img src="extra-a.png"> <img src="a-1-1.png">"#
        );
    }

    #[test]
    fn used_media_not_marked_unused_percent_and_entity_encoded() {
        let text = concat!(
            r#"<img src="a%20b.jpg"> "#,
            r#"<img src="a&amp;b.jpg"> "#,
            r#"<img src="caf%C3%A9%20&#39;1&#39;.png"> "#,
            r#"<audio src="track%201.mp3">"#,
        );
        assert_eq!(
            extract_media_refs(text),
            BTreeSet::from([
                "a b.jpg".into(),
                "a&b.jpg".into(),
                "café '1'.png".into(),
                "track 1.mp3".into(),
            ])
        );
    }

    #[test]
    fn unquoted_src_counts_as_use() {
        let text = concat!(
            r#"<img src=bare.png> "#,
            r#"<img src = spaced_unquoted.jpg alt=x> "#,
            r#"<img src = "spaced_quoted.png"> "#,
            r#"<img src=selfclose.webp/> "#,
            r#"background: url(bg.jpg) url("font.woff2");"#,
        );
        assert_eq!(
            extract_media_refs(text),
            BTreeSet::from([
                "bare.png".into(),
                "spaced_unquoted.jpg".into(),
                "spaced_quoted.png".into(),
                "selfclose.webp".into(),
                "bg.jpg".into(),
                "font.woff2".into(),
            ])
        );
    }

    #[test]
    fn extracts_script_src_local_media_refs() {
        let text = concat!(
            r#"<script src="_helper.js"></script> "#,
            r#"<SCRIPT SRC='https://cdn.example.com/lib.js'></SCRIPT> "#,
            r#"<script type="module" src=_mod.mjs></script>"#,
        );
        assert_eq!(
            extract_media_refs(text),
            BTreeSet::from(["_helper.js".into(), "_mod.mjs".into()])
        );
    }
}

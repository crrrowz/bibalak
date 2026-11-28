use sha1::{Digest, Sha1};

/// Remove HTML tags for the plaintext sort field.
pub(super) fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

pub(crate) fn clean_sort_value(raw: &str) -> String {
    let plain = decode_entities(&strip_tags(raw)).replace('\u{a0}', " ");
    let trimmed = plain.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    // A1-07/A2-10: image, audio, and video tags with a filename still count as content.
    let with_media = decode_entities(&strip_tags(&keep_media_names(raw))).replace('\u{a0}', " ");
    let media_trimmed = with_media.trim();
    if media_trimmed.is_empty() {
        String::new()
    } else {
        media_trimmed.to_string()
    }
}

/// Compute `sort_field` (from `sort_ord`, falling back to field 0) and Anki
/// duplicate `checksum` (ALWAYS from field 0).
pub(crate) fn compute_sort_and_checksum(fields: &[String], sort_ord: usize) -> (String, i64) {
    let first_raw = fields.first().map(String::as_str).unwrap_or_default();
    let checksum = field_checksum(first_raw);
    let sort_raw = fields
        .get(sort_ord)
        .map(String::as_str)
        .unwrap_or(first_raw);
    (clean_sort_value(sort_raw), checksum)
}

/// Anki's note checksum (`csum`, ADR-007): the first 4 bytes of SHA-1 over
/// the first field with media file names kept as " name ", other HTML
/// stripped and entities decoded. Must stay identical to Anki's so imported
/// and new notes compare, and exported decks carry valid values.
pub fn field_checksum(first_field: &str) -> i64 {
    let text = decode_entities(&strip_tags(&keep_media_names(first_field)));
    let digest = Sha1::digest(text.as_bytes());
    i64::from(u32::from_be_bytes([
        digest[0], digest[1], digest[2], digest[3],
    ]))
}

/// Replace `<img src="x">` (and audio/video/source tags) with " x ", as
/// Anki's `strip_html_preserving_media_filenames` does.
fn keep_media_names(html: &str) -> std::borrow::Cow<'_, str> {
    static MEDIA: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = MEDIA.get_or_init(|| {
        regex::Regex::new(
            r#"(?is)<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>"#,
        )
        .expect("static media-tag regex")
    });
    re.replace_all(html, " ${1}${2}${3} ")
}

/// Decode the HTML entities editors produce (basic named ones and numeric).
pub(super) fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.replace('\u{a0}', " ");
    }
    static ENTITY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = ENTITY.get_or_init(|| {
        regex::Regex::new(r"&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").expect("static entity regex")
    });
    re.replace_all(text, |c: &regex::Captures<'_>| {
        let name = &c[1];
        let ch = if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else if let Some(dec) = name.strip_prefix('#') {
            dec.parse().ok().and_then(char::from_u32)
        } else {
            match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => None,
            }
        };
        ch.map_or_else(|| c[0].to_string(), String::from)
    })
    .replace('\u{a0}', " ")
}

#[cfg(test)]
mod tests {
    /// A5: the first-field checksum must equal Anki's (`csum`): the first 4
    /// bytes of SHA-1 over the field with HTML stripped, media file names kept
    /// as " name " and entities decoded. Imported Anki notes carry this value,
    /// so duplicate detection only works across both if ours matches.
    #[test]
    fn field_checksum_matches_anki_csum() {
        use super::field_checksum;
        // int(sha1(text).hexdigest()[:8], 16), as Anki computes it.
        assert_eq!(field_checksum("hello"), 2_868_168_221);
        assert_eq!(field_checksum("<b>hello</b>"), 2_868_168_221);
        assert_eq!(field_checksum("<img src=\"a.jpg\">"), 1_196_959_972);
        assert_eq!(field_checksum("Tom &amp; Jerry"), 495_331_847);
    }
}

//! Search-time text normalization for Arabic variants, diacritics, and Latin accents.

use unicode_normalization::char::decompose_compatible;

/// Normalizes text for accent-, diacritic-, and Arabic-variant-insensitive search.
///
/// Applied symmetrically when indexing notes and when parsing plain-text query
/// terms, while keeping structured filters (`tag:`, `deck:`, `note:`) exact.
pub fn normalize_search_text(input: &str) -> String {
    if input.is_ascii() {
        return input.to_ascii_lowercase();
    }

    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii() {
            out.push(ch.to_ascii_lowercase());
            continue;
        }
        if is_ignored_mark(ch) {
            continue;
        }
        if let Some(mapped) = map_arabic_variant(ch) {
            out.push(mapped);
            continue;
        }
        if ('\u{0600}'..='\u{06FF}').contains(&ch) {
            out.push(ch);
            continue;
        }

        // Decompose only when NFKD actually yields a strippable diacritic so
        // precomposed non-Latin characters (e.g. Japanese kana like `が`) stay intact.
        let mut stripped_any = false;
        let mut buf = [0 as char; 8];
        let mut len = 0usize;
        decompose_compatible(ch, |d| {
            if is_combining_diacritic(d) {
                stripped_any = true;
            } else if len < buf.len() {
                buf[len] = d;
                len += 1;
            }
        });

        if stripped_any {
            for &base in &buf[..len] {
                push_lowercase(&mut out, base);
            }
        } else {
            push_lowercase(&mut out, ch);
        }
    }
    out
}

fn is_ignored_mark(ch: char) -> bool {
    matches!(ch, '\u{0640}' | '\u{064B}'..='\u{065F}' | '\u{0670}') || is_combining_diacritic(ch)
}

fn is_combining_diacritic(ch: char) -> bool {
    matches!(
        ch,
        '\u{0300}'..='\u{036F}'
            | '\u{1AB0}'..='\u{1AFF}'
            | '\u{1DC0}'..='\u{1DFF}'
            | '\u{FE20}'..='\u{FE2F}'
    )
}

fn map_arabic_variant(ch: char) -> Option<char> {
    match ch {
        'أ' | 'إ' | 'آ' | 'ٱ' => Some('ا'),
        'ة' => Some('ه'),
        'ى' => Some('ي'),
        'ؤ' => Some('و'),
        'ئ' => Some('ي'),
        _ => None,
    }
}

fn push_lowercase(out: &mut String, ch: char) {
    if ch.is_ascii() {
        out.push(ch.to_ascii_lowercase());
    } else {
        for lower in ch.to_lowercase() {
            out.push(lower);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_search_text;

    #[test]
    fn normalizes_arabic_diacritics_tatweel_and_letter_variants() {
        assert_eq!(normalize_search_text("الإسلام"), "الاسلام");
        assert_eq!(normalize_search_text("الْإِسْلَامُ"), "الاسلام");
        assert_eq!(normalize_search_text("مَدْرَسَة"), "مدرسه");
        assert_eq!(normalize_search_text("مـدرسة"), "مدرسه");
        assert_eq!(normalize_search_text("أإآٱ"), "اااا");
        assert_eq!(normalize_search_text("ةىؤئ"), "هيوي");
        assert_eq!(normalize_search_text("موسىٰ"), "موسي");
    }

    #[test]
    fn normalizes_latin_accents_and_case() {
        assert_eq!(normalize_search_text("café"), "cafe");
        assert_eq!(normalize_search_text("cafe\u{0301}"), "cafe");
        assert_eq!(normalize_search_text("CAFÉ"), "cafe");
        assert_eq!(normalize_search_text("ÉCOLE"), "ecole");
        assert_eq!(normalize_search_text("naïve façade"), "naive facade");
        assert_eq!(normalize_search_text("Plain ASCII 123"), "plain ascii 123");
    }

    #[test]
    fn preserves_non_latin_non_arabic_composed_characters() {
        assert_eq!(normalize_search_text("が"), "が");
    }
}

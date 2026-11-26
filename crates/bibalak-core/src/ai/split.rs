//! Pure text splitting helpers for multi-part AI card generation.

use crate::error::{CoreError, CoreResult};

/// Maximum pasted source length accepted by card generation.
pub const MAX_GENERATE_SOURCE_CHARS: usize = 50_000;
/// Default target chunk size in characters (~6,000 per request).
pub const DEFAULT_CHUNK_MAX_CHARS: usize = 6_000;
/// Minimum/maximum total cards per generation run.
pub const MIN_GENERATE_CARDS: u32 = 5;
pub const MAX_GENERATE_CARDS: u32 = 50;

fn push_packed_segments(out: &mut Vec<String>, segments: Vec<String>, sep: &str, max_chars: usize) {
    let sep_len = sep.chars().count();
    let mut current = String::new();
    let mut current_len = 0usize;

    for seg in segments {
        let seg_len = seg.chars().count();
        if seg_len > max_chars {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
                current_len = 0;
            }
            out.push(seg);
            continue;
        }
        if current.is_empty() {
            current = seg;
            current_len = seg_len;
        } else if current_len + sep_len + seg_len <= max_chars {
            current.push_str(sep);
            current.push_str(&seg);
            current_len += sep_len + seg_len;
        } else {
            out.push(std::mem::take(&mut current));
            current = seg;
            current_len = seg_len;
        }
    }

    if !current.is_empty() {
        out.push(current);
    }
}

fn split_paragraphs(text: &str) -> Vec<String> {
    let mut paras = Vec::new();
    let mut cur = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !cur.is_empty() {
                paras.push(cur.join("\n"));
                cur.clear();
            }
        } else {
            cur.push(trimmed);
        }
    }
    if !cur.is_empty() {
        paras.push(cur.join("\n"));
    }
    paras
}

fn split_sentences(paragraph: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut chars = paragraph.char_indices().peekable();
    while let Some((idx, ch)) = chars.next() {
        let is_sentence_end = matches!(ch, '.' | '!' | '?' | '؟' | '۔');
        let next_is_boundary = chars
            .peek()
            .map(|(_, next)| next.is_whitespace())
            .unwrap_or(true);
        if (is_sentence_end && next_is_boundary) || ch == '\n' {
            let end = idx + ch.len_utf8();
            let piece = paragraph[start..end].trim();
            if !piece.is_empty() {
                out.push(piece.to_string());
            }
            start = end;
        }
    }
    let tail = paragraph[start..].trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

fn split_by_words(sentence: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for word in sentence.split_whitespace() {
        let word_len = word.chars().count();
        if word_len > max_chars {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
                current_len = 0;
            }
            // Fallback only for single giant unbroken tokens > max_chars.
            let mut chunk = String::new();
            let mut chunk_len = 0usize;
            for ch in word.chars() {
                if chunk_len == max_chars {
                    out.push(std::mem::take(&mut chunk));
                    chunk_len = 0;
                }
                chunk.push(ch);
                chunk_len += 1;
            }
            if !chunk.is_empty() {
                out.push(chunk);
            }
            continue;
        }
        if current.is_empty() {
            current.push_str(word);
            current_len = word_len;
        } else if current_len + 1 + word_len <= max_chars {
            current.push(' ');
            current.push_str(word);
            current_len += 1 + word_len;
        } else {
            out.push(std::mem::take(&mut current));
            current.push_str(word);
            current_len = word_len;
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Split `text` into parts of at most `max_chars` characters, preferring paragraph
/// boundaries first, then sentence boundaries, and never splitting mid-word.
/// Rejects empty inputs and inputs exceeding [`MAX_GENERATE_SOURCE_CHARS`].
pub fn split_text_for_generation(text: &str, max_chars: usize) -> CoreResult<Vec<String>> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Invalid(
            "enter or paste study text first before generating cards".into(),
        ));
    }
    if trimmed.chars().count() > MAX_GENERATE_SOURCE_CHARS {
        return Err(CoreError::Invalid(format!(
            "source text exceeds the {MAX_GENERATE_SOURCE_CHARS}-character limit"
        )));
    }
    if max_chars == 0 {
        return Err(CoreError::Invalid(
            "chunk size must be greater than zero".into(),
        ));
    }

    let paragraphs = split_paragraphs(trimmed);
    let mut para_packed = Vec::new();
    push_packed_segments(&mut para_packed, paragraphs, "\n\n", max_chars);

    let mut final_parts = Vec::new();
    for part in para_packed {
        if part.chars().count() <= max_chars {
            final_parts.push(part);
            continue;
        }
        let sentences = split_sentences(&part);
        let mut sentence_packed = Vec::new();
        push_packed_segments(&mut sentence_packed, sentences, " ", max_chars);
        for sub in sentence_packed {
            if sub.chars().count() <= max_chars {
                final_parts.push(sub);
            } else {
                final_parts.extend(split_by_words(&sub, max_chars));
            }
        }
    }

    Ok(final_parts)
}

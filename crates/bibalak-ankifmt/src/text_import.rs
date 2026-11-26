//! CSV/TSV and Markdown parser for text import (`E4`, `ADR-011`).

use std::collections::BTreeSet;
use std::path::Path;

use bibalak_core::ipc::{
    TextColumnTarget, TextImportDelimiter, TextImportError, TextImportFormat, TextImportMapping,
    TextImportOptions, TextImportPreview,
};
use bibalak_core::ports::ParsedTextNote;
use bibalak_core::{CoreError, CoreResult};
use pulldown_cmark::{html, Event, Options, Parser};

const PREVIEW_ROW_LIMIT: usize = 20;

#[derive(Debug)]
struct TabularRecord {
    line: u32,
    cells: Vec<String>,
}

#[derive(Debug)]
struct ParsedDocument {
    format: TextImportFormat,
    delimiter: Option<char>,
    has_header: bool,
    columns: Vec<String>,
    records: Vec<TabularRecord>,
    errors: Vec<TextImportError>,
}

/// Preview the columns and first 20 rows of a CSV/TSV or Markdown file.
pub fn preview_text_import(
    path: &Path,
    options: &TextImportOptions,
) -> CoreResult<TextImportPreview> {
    let raw = read_utf8_file(path)?;
    let hint = path.file_name().and_then(|s| s.to_str());
    preview_text_str(&raw, hint, options)
}

/// Pure string version of [`preview_text_import`] for tests.
pub fn preview_text_str(
    input: &str,
    filename_hint: Option<&str>,
    options: &TextImportOptions,
) -> CoreResult<TextImportPreview> {
    let doc = parse_document(input, filename_hint, options)?;
    let total_rows = doc.records.len() as u32;
    let col_count = doc.columns.len();
    let rows = doc
        .records
        .into_iter()
        .take(PREVIEW_ROW_LIMIT)
        .map(|mut rec| {
            if rec.cells.len() < col_count {
                rec.cells.resize(col_count, String::new());
            }
            rec.cells
        })
        .collect();

    Ok(TextImportPreview {
        detected_format: doc.format,
        detected_delimiter: doc.delimiter.map(|d| d.to_string()),
        has_header: doc.has_header,
        columns: doc.columns,
        rows,
        total_rows,
        errors: doc.errors,
    })
}

/// Parse a CSV/TSV or Markdown file and apply column mapping into note rows.
pub fn parse_text_import(
    path: &Path,
    notetype_field_count: usize,
    mapping: &TextImportMapping,
) -> CoreResult<(Vec<ParsedTextNote>, Vec<TextImportError>)> {
    let raw = read_utf8_file(path)?;
    let hint = path.file_name().and_then(|s| s.to_str());
    parse_text_str(&raw, hint, notetype_field_count, mapping)
}

/// Pure string version of [`parse_text_import`] for tests and benchmarks.
pub fn parse_text_str(
    input: &str,
    filename_hint: Option<&str>,
    notetype_field_count: usize,
    mapping: &TextImportMapping,
) -> CoreResult<(Vec<ParsedTextNote>, Vec<TextImportError>)> {
    let doc = parse_document(input, filename_hint, &mapping.options)?;
    let mut notes = Vec::with_capacity(doc.records.len());

    for record in doc.records {
        let mut fields = vec![String::new(); notetype_field_count];
        let mut seen_tags: BTreeSet<String> = mapping
            .default_tags
            .iter()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .map(ToString::to_string)
            .collect();

        for (col_idx, target) in mapping.columns.iter().enumerate() {
            let Some(value) = record.cells.get(col_idx) else {
                continue;
            };
            match target {
                TextColumnTarget::Ignore => {}
                TextColumnTarget::Field { ord } => {
                    if *ord < notetype_field_count {
                        if fields[*ord].is_empty() {
                            fields[*ord] = value.clone();
                        } else if !value.is_empty() {
                            fields[*ord].push_str("<br>");
                            fields[*ord].push_str(value);
                        }
                    }
                }
                TextColumnTarget::Tags => {
                    for tag in value
                        .split(|c: char| c.is_whitespace() || c == ',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        seen_tags.insert(tag.to_string());
                    }
                }
            }
        }

        notes.push(ParsedTextNote {
            line: record.line,
            fields,
            tags: seen_tags.into_iter().collect(),
        });
    }

    Ok((notes, doc.errors))
}

fn read_utf8_file(path: &Path) -> CoreResult<String> {
    let bytes = std::fs::read(path)
        .map_err(|e| CoreError::Format(format!("read {}: {e}", path.display())))?;
    String::from_utf8(bytes)
        .map_err(|_| CoreError::Invalid(format!("file '{}' is not valid UTF-8", path.display())))
}

fn strip_bom(input: &str) -> &str {
    input.strip_prefix('\u{FEFF}').unwrap_or(input)
}

fn parse_document(
    input: &str,
    filename_hint: Option<&str>,
    options: &TextImportOptions,
) -> CoreResult<ParsedDocument> {
    let clean = strip_bom(input);
    let format = resolve_format(clean, filename_hint, options.format);
    match format {
        TextImportFormat::Csv => Ok(parse_csv_document(clean, filename_hint, options)),
        TextImportFormat::Markdown => Ok(parse_markdown_document(clean, options.allow_html)),
        TextImportFormat::Auto => unreachable!("resolve_format never returns Auto"),
    }
}

fn resolve_format(
    clean: &str,
    filename_hint: Option<&str>,
    requested: TextImportFormat,
) -> TextImportFormat {
    match requested {
        TextImportFormat::Csv => TextImportFormat::Csv,
        TextImportFormat::Markdown => TextImportFormat::Markdown,
        TextImportFormat::Auto => {
            if let Some(name) = filename_hint {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".md")
                    || lower.ends_with(".markdown")
                    || lower.ends_with(".mdown")
                {
                    return TextImportFormat::Markdown;
                }
                if lower.ends_with(".csv") || lower.ends_with(".tsv") || lower.ends_with(".tab") {
                    return TextImportFormat::Csv;
                }
            }
            if looks_like_markdown(clean) {
                TextImportFormat::Markdown
            } else {
                TextImportFormat::Csv
            }
        }
    }
}

fn looks_like_markdown(clean: &str) -> bool {
    let mut in_fence = false;
    for line in clean.lines().take(64) {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if trimmed.starts_with("## ") || trimmed.starts_with("Q:") || trimmed.contains("==") {
            return true;
        }
    }
    false
}

fn resolve_delimiter(
    clean: &str,
    filename_hint: Option<&str>,
    requested: TextImportDelimiter,
) -> char {
    match requested {
        TextImportDelimiter::Comma => ',',
        TextImportDelimiter::Tab => '\t',
        TextImportDelimiter::Semicolon => ';',
        TextImportDelimiter::Auto => {
            let prefer_tab = filename_hint
                .map(|n| {
                    let l = n.to_ascii_lowercase();
                    l.ends_with(".tsv") || l.ends_with(".tab")
                })
                .unwrap_or(false);

            let candidates: [u8; 3] = if prefer_tab { *b"\t,;" } else { *b",\t;" };

            let sample: String = clean.chars().take(16_384).collect();
            let mut best_delim = candidates[0] as char;
            let mut best_score: i64 = -1;

            for delim in candidates {
                let mut reader = csv::ReaderBuilder::new()
                    .delimiter(delim)
                    .has_headers(false)
                    .flexible(true)
                    .from_reader(sample.as_bytes());
                let mut counts: Vec<usize> = Vec::new();
                for rec in reader.records().take(15).flatten() {
                    if !rec.is_empty() && !(rec.len() == 1 && rec[0].trim().is_empty()) {
                        counts.push(rec.len());
                    }
                }
                if counts.is_empty() {
                    continue;
                }
                let max_c = *counts.iter().max().unwrap_or(&1);
                let min_c = *counts.iter().min().unwrap_or(&1);
                if max_c <= 1 {
                    continue;
                }
                // Strong bonus for uniform multi-column structure across rows.
                let consistent = if min_c == max_c { 10_000 } else { 0 };
                let score = consistent + (counts.len() as i64 * 100) + (min_c as i64 * 10);
                if score > best_score {
                    best_score = score;
                    best_delim = delim as char;
                }
            }

            if best_score >= 0 {
                best_delim
            } else if prefer_tab {
                '\t'
            } else {
                ','
            }
        }
    }
}

fn parse_csv_document(
    clean: &str,
    filename_hint: Option<&str>,
    options: &TextImportOptions,
) -> ParsedDocument {
    let delim = resolve_delimiter(clean, filename_hint, options.delimiter);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delim as u8)
        .has_headers(false)
        .flexible(true)
        .from_reader(clean.as_bytes());

    let mut raw_records = Vec::new();
    let mut errors = Vec::new();
    let mut max_cols = 0usize;

    for result in reader.records() {
        match result {
            Ok(rec) => {
                if rec.is_empty() || (rec.len() == 1 && rec[0].trim().is_empty()) {
                    continue;
                }
                let line = rec.position().map(|p| p.line() as u32).unwrap_or(1);
                max_cols = max_cols.max(rec.len());
                let cells: Vec<String> = rec
                    .iter()
                    .map(|cell| {
                        let s = cell.trim();
                        if options.allow_html {
                            s.to_string()
                        } else {
                            escape_html(s)
                        }
                    })
                    .collect();
                raw_records.push(TabularRecord { line, cells });
            }
            Err(err) => {
                let line = err.position().map(|p| p.line() as u32).unwrap_or(1);
                errors.push(TextImportError {
                    line,
                    message: err.to_string(),
                });
            }
        }
    }

    let (columns, records) = if options.has_header && !raw_records.is_empty() {
        let header = raw_records.remove(0);
        let col_len = max_cols.max(header.cells.len());
        let cols: Vec<String> = (0..col_len)
            .map(|i| {
                let name = header.cells.get(i).map(|s| s.trim()).unwrap_or("");
                if name.is_empty() {
                    format!("Column {}", i + 1)
                } else {
                    name.to_string()
                }
            })
            .collect();
        (cols, raw_records)
    } else {
        let col_len = max_cols.max(1);
        let cols: Vec<String> = (0..col_len).map(|i| format!("Column {}", i + 1)).collect();
        (cols, raw_records)
    };

    ParsedDocument {
        format: TextImportFormat::Csv,
        delimiter: Some(delim),
        has_header: options.has_header,
        columns,
        records,
        errors,
    }
}

fn parse_markdown_document(clean: &str, allow_html: bool) -> ParsedDocument {
    let normalized = clean.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut records = Vec::new();
    let errors = Vec::new();

    let mut idx = 0usize;
    let mut in_fence = false;
    while idx < lines.len() {
        let line = lines[idx];
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            idx += 1;
            continue;
        }
        if in_fence {
            idx += 1;
            continue;
        }

        // 1. Level-2 heading section: `## Front` + body until next `## ` (respecting fences).
        if let Some(heading_raw) = trimmed.strip_prefix("## ") {
            let note_line = (idx + 1) as u32;
            idx += 1;
            let body_start = idx;
            let mut body_fence = false;
            while idx < lines.len() {
                let btrimmed = lines[idx].trim_start();
                if btrimmed.starts_with("```") || btrimmed.starts_with("~~~") {
                    body_fence = !body_fence;
                } else if !body_fence
                    && (btrimmed.starts_with("## ")
                        || btrimmed.trim() == "---"
                        || strip_prefix_qa(btrimmed, "Q:").is_some())
                {
                    break;
                }
                idx += 1;
            }
            let body_raw = lines[body_start..idx].join("\n");
            let mut cloze_idx = 0u32;
            let front_src = convert_cloze_highlights(heading_raw.trim(), &mut cloze_idx);
            let back_src = convert_cloze_highlights(body_raw.trim(), &mut cloze_idx);
            let front_html = render_markdown_html(&front_src, allow_html);
            let back_html = render_markdown_html(&back_src, allow_html);
            records.push(TabularRecord {
                line: note_line,
                cells: vec![front_html, back_html],
            });
            continue;
        }

        // Ignore level-1 document headings `# Title` and thematic breaks `---` between blocks.
        if (trimmed.starts_with("# ") || trimmed == "---" || trimmed.is_empty())
            && !trimmed.contains("==")
        {
            idx += 1;
            continue;
        }

        // 2. `Q:` / `A:` pair outside headings.
        if let Some(q_first) = strip_prefix_qa(trimmed, "Q:") {
            let note_line = (idx + 1) as u32;
            let mut q_lines = vec![q_first];
            idx += 1;
            while idx < lines.len() {
                let t = lines[idx].trim_start();
                if t.starts_with("## ") || strip_prefix_qa(t, "A:").is_some() || t.is_empty() {
                    break;
                }
                q_lines.push(lines[idx]);
                idx += 1;
            }
            // Skip optional single blank line between Q and A.
            if idx < lines.len()
                && lines[idx].trim().is_empty()
                && idx + 1 < lines.len()
                && strip_prefix_qa(lines[idx + 1].trim_start(), "A:").is_some()
            {
                idx += 1;
            }
            let mut a_lines = Vec::new();
            if idx < lines.len() {
                if let Some(a_first) = strip_prefix_qa(lines[idx].trim_start(), "A:") {
                    a_lines.push(a_first);
                    idx += 1;
                    while idx < lines.len() {
                        let t = lines[idx].trim_start();
                        if t.is_empty()
                            || t == "---"
                            || t.starts_with("## ")
                            || strip_prefix_qa(t, "Q:").is_some()
                        {
                            break;
                        }
                        a_lines.push(lines[idx]);
                        idx += 1;
                    }
                }
            }
            let mut cloze_idx = 0u32;
            let front_src = convert_cloze_highlights(q_lines.join("\n").trim(), &mut cloze_idx);
            let back_src = convert_cloze_highlights(a_lines.join("\n").trim(), &mut cloze_idx);
            records.push(TabularRecord {
                line: note_line,
                cells: vec![
                    render_markdown_html(&front_src, allow_html),
                    render_markdown_html(&back_src, allow_html),
                ],
            });
            continue;
        }

        // 3. Standalone block containing `==cloze==` markers -> Cloze note per blank-separated block.
        let block_start_line = (idx + 1) as u32;
        let block_start = idx;
        while idx < lines.len() {
            let t = lines[idx].trim_start();
            if t.is_empty()
                || t == "---"
                || t.starts_with("## ")
                || strip_prefix_qa(t, "Q:").is_some()
            {
                break;
            }
            idx += 1;
        }
        let block_raw = lines[block_start..idx].join("\n");
        let mut cloze_idx = 0u32;
        let converted = convert_cloze_highlights(block_raw.trim(), &mut cloze_idx);
        if cloze_idx > 0 {
            records.push(TabularRecord {
                line: block_start_line,
                cells: vec![render_markdown_html(&converted, allow_html), String::new()],
            });
        }
    }

    ParsedDocument {
        format: TextImportFormat::Markdown,
        delimiter: None,
        has_header: false,
        columns: vec!["Front".into(), "Back".into()],
        records,
        errors,
    }
}

fn strip_prefix_qa<'a>(trimmed: &'a str, marker: &str) -> Option<&'a str> {
    trimmed.strip_prefix(marker).map(str::trim_start)
}

/// Convert `==highlight==` outside inline code spans into sequential `{{cN::...}}`.
fn convert_cloze_highlights(input: &str, counter: &mut u32) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    let mut in_code = false;

    while !rest.is_empty() {
        if rest.starts_with('`') {
            in_code = !in_code;
            out.push('`');
            rest = &rest[1..];
            continue;
        }
        if !in_code && rest.starts_with("\\==") {
            out.push_str("==");
            rest = &rest[3..];
            continue;
        }
        if !in_code && rest.starts_with("==") {
            if let Some(end) = rest[2..].find("==") {
                let inner = &rest[2..2 + end];
                if !inner.trim().is_empty() && !inner.contains('\n') {
                    *counter += 1;
                    out.push_str(&format!("{{{{c{}::{inner}}}}}", *counter));
                    rest = &rest[2 + end + 2..];
                    continue;
                }
            }
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

fn render_markdown_html(md: &str, allow_html: bool) -> String {
    let trimmed = md.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let parser = Parser::new_ext(
        trimmed,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH,
    );
    let mut out = String::new();
    if allow_html {
        html::push_html(&mut out, parser);
    } else {
        let escaped = parser.map(|ev| match ev {
            Event::Html(raw) => Event::Text(raw),
            Event::InlineHtml(raw) => Event::Text(raw),
            other => other,
        });
        html::push_html(&mut out, escaped);
    }
    let out_trimmed = out.trim();
    // Unwrap single-paragraph `<p>...</p>` so plain headings/answers don't carry extra margins.
    if let Some(inner) = out_trimmed
        .strip_prefix("<p>")
        .and_then(|s| s.strip_suffix("</p>"))
    {
        if !inner.contains("<p>") {
            return inner.to_string();
        }
    }
    out_trimmed.to_string()
}

fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bibalak_core::ipc::{
        DuplicatePolicy, TextColumnTarget, TextImportDelimiter, TextImportFormat,
    };

    fn basic_mapping(has_header: bool, allow_html: bool) -> TextImportMapping {
        TextImportMapping {
            deck_id: 1,
            notetype_id: 1,
            duplicate_policy: DuplicatePolicy::Skip,
            columns: vec![
                TextColumnTarget::Field { ord: 0 },
                TextColumnTarget::Field { ord: 1 },
                TextColumnTarget::Tags,
            ],
            default_tags: vec!["imported".into()],
            options: TextImportOptions {
                format: TextImportFormat::Auto,
                delimiter: TextImportDelimiter::Auto,
                has_header,
                allow_html,
            },
        }
    }

    #[test]
    fn csv_auto_detects_delimiters_bom_arabic_quotes_and_html() {
        // Semicolon with UTF-8 BOM, Arabic, quoted newline, HTML preserved
        let csv_input =
            "\u{FEFF}Front;Back;Tags\n\"مرحبا\nالعالم\";\"<b>Hello</b> world\";arabic greeting\n";
        let preview =
            preview_text_str(csv_input, Some("cards.csv"), &TextImportOptions::default()).unwrap();
        assert_eq!(preview.detected_format, TextImportFormat::Csv);
        assert_eq!(preview.detected_delimiter.as_deref(), Some(";"));
        assert_eq!(preview.columns, vec!["Front", "Back", "Tags"]);
        assert_eq!(preview.total_rows, 1);
        assert_eq!(preview.rows[0][0], "مرحبا\nالعالم");
        assert_eq!(preview.rows[0][1], "<b>Hello</b> world");

        // Tab-delimited file whose fields also contain commas must detect tab
        let tsv_input = "a, first\tb, second\ttag1\nc, third\td, fourth\ttag2\n";
        let tsv_opts = TextImportOptions {
            has_header: false,
            ..Default::default()
        };
        let tsv_preview = preview_text_str(tsv_input, Some("cards.tsv"), &tsv_opts).unwrap();
        assert_eq!(tsv_preview.detected_delimiter.as_deref(), Some("\t"));
        assert_eq!(
            tsv_preview.columns,
            vec!["Column 1", "Column 2", "Column 3"]
        );
        assert_eq!(tsv_preview.total_rows, 2);
        assert_eq!(tsv_preview.rows[0][0], "a, first");

        // Escapes HTML when allow_html == false
        let (notes, errors) =
            parse_text_str(csv_input, Some("cards.csv"), 2, &basic_mapping(true, false)).unwrap();
        assert!(errors.is_empty());
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].line, 2);
        assert_eq!(notes[0].fields[1], "&lt;b&gt;Hello&lt;/b&gt; world");
        assert!(notes[0].tags.contains(&"imported".to_string()));
        assert!(notes[0].tags.contains(&"arabic".to_string()));
        assert!(notes[0].tags.contains(&"greeting".to_string()));
    }

    #[test]
    fn markdown_parses_headings_qa_pairs_and_cloze_highlights() {
        let md = "\u{FEFF}# Deck Title\n\n## What is ==ATP==?\nEnergy currency with ==adenosine==.\n\nQ: Capital of **Iraq**?\nA: Baghdad\n\nThe mitochondria is the ==powerhouse== of the ==cell==.\n";
        let preview =
            preview_text_str(md, Some("notes.md"), &TextImportOptions::default()).unwrap();
        assert_eq!(preview.detected_format, TextImportFormat::Markdown);
        assert_eq!(preview.detected_delimiter, None);
        assert_eq!(preview.columns, vec!["Front", "Back"]);
        assert_eq!(preview.total_rows, 3);
        assert!(preview.rows[0][0].contains("{{c1::ATP}}"));
        assert!(preview.rows[0][1].contains("{{c2::adenosine}}"));
        assert!(preview.rows[1][0].contains("<strong>Iraq</strong>"));
        assert_eq!(preview.rows[1][1], "Baghdad");
        assert!(preview.rows[2][0].contains("{{c1::powerhouse}}"));
        assert!(preview.rows[2][0].contains("{{c2::cell}}"));
    }

    #[test]
    fn csv_ten_thousand_rows_parse_timings() {
        let mut big = String::with_capacity(600_000);
        big.push_str("Front,Back,Tags\n");
        for i in 0..10_000 {
            big.push_str(&format!("Question {i},Answer {i},batch\n"));
        }
        let start = std::time::Instant::now();
        let (notes, errors) =
            parse_text_str(&big, Some("big.csv"), 2, &basic_mapping(true, true)).unwrap();
        let elapsed = start.elapsed();
        assert!(errors.is_empty());
        assert_eq!(notes.len(), 10_000);
        eprintln!("E4 10,000-row CSV parse time: {elapsed:?}");
    }
}

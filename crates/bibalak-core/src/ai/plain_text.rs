//! Plain-text conversion and single-origin URL/CSP validation helpers for AI payloads.

use crate::error::{CoreError, CoreResult};

fn is_loopback_authority(authority: &str) -> bool {
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    if host.eq_ignore_ascii_case("localhost") || host == "::1" {
        return true;
    }
    let mut octets = host.split('.');
    matches!(
        (
            octets.next().and_then(|s| s.parse::<u8>().ok()),
            octets.next().and_then(|s| s.parse::<u8>().ok()),
            octets.next().and_then(|s| s.parse::<u8>().ok()),
            octets.next().and_then(|s| s.parse::<u8>().ok()),
            octets.next(),
        ),
        (Some(127), Some(_), Some(_), Some(_), None)
    )
}

/// Validate an AI provider base URL and return its canonical origin (`scheme://host[:port]`).
///
/// Rejects non-HTTP(S) schemes, plaintext `http://` for non-loopback hosts,
/// embedded credentials (`user:pass@`), whitespace/control characters, and missing
/// hosts so outbound traffic can be pinned to one origin.
pub fn normalize_provider_origin(raw_url: &str) -> CoreResult<String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Invalid("AI provider URL cannot be empty".into()));
    }
    if trimmed.chars().any(char::is_control) || trimmed.chars().any(char::is_whitespace) {
        return Err(CoreError::Invalid(
            "AI provider URL must not contain spaces or control characters".into(),
        ));
    }
    let (scheme, rest) = trimmed.split_once("://").ok_or_else(|| {
        CoreError::Invalid("AI provider URL must start with http:// or https://".into())
    })?;
    let scheme_lower = scheme.to_ascii_lowercase();
    if scheme_lower != "http" && scheme_lower != "https" {
        return Err(CoreError::Invalid(format!(
            "unsupported AI provider URL scheme '{scheme}'; only http:// and https:// are allowed"
        )));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err(CoreError::Invalid(
            "AI provider URL is missing a host".into(),
        ));
    }
    if authority.contains('@') {
        return Err(CoreError::Invalid(
            "AI provider URL must not contain embedded credentials".into(),
        ));
    }
    if scheme_lower == "http" && !is_loopback_authority(authority) {
        return Err(CoreError::Invalid(
            "remote AI provider URLs must use https:// (http:// is only allowed for loopback hosts)"
                .into(),
        ));
    }
    Ok(format!("{scheme_lower}://{authority}"))
}

/// Append ONLY the configured AI provider origin to `connect-src` in a CSP policy string.
pub fn csp_with_ai_origin(base_csp: &str, provider_url: Option<&str>) -> CoreResult<String> {
    let origin = match provider_url {
        Some(url) if !url.trim().is_empty() => Some(normalize_provider_origin(url)?),
        _ => None,
    };

    let mut directives: Vec<String> = Vec::new();
    let mut updated_connect = false;

    for raw_dir in base_csp.split(';') {
        let dir = raw_dir.trim();
        if dir.is_empty() {
            continue;
        }
        let mut tokens = dir.split_whitespace();
        let Some(name) = tokens.next() else {
            continue;
        };
        if name.eq_ignore_ascii_case("connect-src") {
            let mut srcs: Vec<String> = tokens.map(str::to_string).collect();
            if let Some(ref o) = origin {
                if !srcs.iter().any(|s| s == o) {
                    srcs.push(o.clone());
                }
            }
            directives.push(format!("connect-src {}", srcs.join(" ")));
            updated_connect = true;
        } else {
            let rest: Vec<&str> = tokens.collect();
            if rest.is_empty() {
                directives.push(name.to_string());
            } else {
                directives.push(format!("{name} {}", rest.join(" ")));
            }
        }
    }

    if !updated_connect {
        if let Some(o) = origin {
            directives.push(format!("connect-src 'self' {o}"));
        }
    }

    Ok(directives.join("; "))
}

/// Convert card or field HTML into readable plain text with scripts/styles stripped and
/// HTML entities decoded, ensuring raw card HTML is never sent to external AI prompts.
pub fn html_to_plain_text(html: &str) -> String {
    let without_hidden = strip_tag_blocks(html, &["script", "style"]);
    let with_breaks = insert_block_breaks(&without_hidden);

    // Strip all remaining tags without regex dependencies in bibalak-core.
    let mut stripped = String::with_capacity(with_breaks.len());
    let mut in_tag = false;
    for ch in with_breaks.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => stripped.push(ch),
            _ => {}
        }
    }

    let decoded = decode_html_entities(&stripped);
    collapse_whitespace(&decoded)
}

fn strip_tag_blocks(input: &str, tags: &[&str]) -> String {
    let mut out = input.to_string();
    for tag in tags {
        let open_pat = format!("<{tag}");
        let close_pat = format!("</{tag}>");
        let mut cursor = 0usize;
        loop {
            let lower = out.to_ascii_lowercase();
            let Some(rel_start) = lower[cursor..].find(&open_pat) else {
                break;
            };
            let start = cursor + rel_start;
            let after_open = &lower[start + open_pat.len()..];
            // Ensure tag boundary (space, '>', or '/') so <stylex> is not confused with <style>.
            if !after_open
                .chars()
                .next()
                .is_some_and(|c| c.is_whitespace() || c == '>' || c == '/')
            {
                cursor = start + open_pat.len();
                continue;
            }
            if let Some(rel_end) = lower[start..].find(&close_pat) {
                let end = start + rel_end + close_pat.len();
                out.replace_range(start..end, " ");
                cursor = start + 1;
            } else {
                out.truncate(start);
                break;
            }
        }
    }
    out
}

fn insert_block_breaks(input: &str) -> String {
    let mut out = input.to_string();
    for needle in [
        "<br>", "<br/>", "<br />", "<BR>", "<BR/>", "<BR />", "</p>", "</P>", "</div>", "</DIV>",
        "</li>", "</LI>", "</tr>", "</TR>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>",
        "<hr>", "<hr/>", "<hr />",
    ] {
        out = out.replace(needle, &format!("\n{needle}"));
    }
    out
}

fn decode_html_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp..];
        if let Some(semi) = after[..after.len().min(12)].find(';') {
            let entity = &after[1..semi];
            if let Some(ch) = decode_single_entity(entity) {
                out.push(ch);
                rest = &after[semi + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &after[1..];
    }
    out.push_str(rest);
    out
}

fn decode_single_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" | "#39" => Some('\''),
        "nbsp" => Some(' '),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn collapse_whitespace(input: &str) -> String {
    input
        .lines()
        .map(|raw_line| raw_line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

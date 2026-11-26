//! High-level AI preview & execution service decoupled from Tauri types.

use std::path::Path;

use bibalak_core::ai::{
    build_action_prompt_with_locale, execute_built_ai_action, normalize_provider_origin,
    AIActionRequest, AIActionResult, AIPreviewPayload,
};
use bibalak_core::{CoreError, CoreResult};

use crate::config::load_persisted;
use crate::provider::HttpAIProvider;
use crate::secrets::SecretStore;

/// Build the exact plain-text prompt + destination metadata without making any HTTP call.
pub fn preview_ai_action(
    data_dir: &Path,
    action: &AIActionRequest,
    app_locale: Option<&str>,
) -> CoreResult<AIPreviewPayload> {
    let persisted = load_persisted(data_dir);
    let endpoint_origin = normalize_provider_origin(&persisted.base_url)?;
    if persisted.model.trim().is_empty() {
        return Err(CoreError::Invalid("AI model name cannot be empty".into()));
    }
    let built = build_action_prompt_with_locale(action, app_locale)?;
    Ok(AIPreviewPayload {
        provider: persisted.provider,
        endpoint_origin,
        model: persisted.model,
        system: built.request.system.unwrap_or_default(),
        prompt: built.request.prompt,
    })
}

/// Execute an explicit AI request using stored config + keyring secret, building the prompt once.
pub fn run_ai_action(
    data_dir: &Path,
    secrets: &dyn SecretStore,
    action: &AIActionRequest,
    app_locale: Option<&str>,
) -> CoreResult<AIActionResult> {
    let persisted = load_persisted(data_dir);
    let is_test = matches!(action, AIActionRequest::TestConnection);
    if !persisted.enabled && !is_test {
        return Err(CoreError::Invalid(
            "AI assistant is disabled in Settings".into(),
        ));
    }

    let built = build_action_prompt_with_locale(action, app_locale)?;
    let api_key = secrets.get_api_key().map_err(CoreError::Storage)?;
    let provider = HttpAIProvider::new(
        persisted.provider,
        persisted.base_url,
        persisted.model,
        api_key,
    )?;
    execute_built_ai_action(&provider, action, &built)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::save_ai_config;
    use crate::secrets::MemorySecretStore;
    use bibalak_core::ai::{AIFieldInput, AIProviderKind, AISaveConfigInput};

    #[test]
    fn preview_strips_html_and_rejects_disabled_execution() {
        let dir = std::env::temp_dir().join(format!(
            "bibalak-ai-svc-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = MemorySecretStore::default();
        save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: false,
                provider: AIProviderKind::Ollama,
                base_url: "http://127.0.0.1:11434".into(),
                model: "llama3.2".into(),
                api_key: None,
            },
        )
        .unwrap();

        let action = AIActionRequest::RewriteLeech {
            fields: vec![
                AIFieldInput {
                    name: "Front".into(),
                    value_html: "<b>Mitochondria</b> &amp; ATP?".into(),
                },
                AIFieldInput {
                    name: "Back".into(),
                    value_html: "<i>Powerhouse</i>".into(),
                },
            ],
            lapses: Some(6),
        };

        let preview = preview_ai_action(&dir, &action, None).unwrap();
        assert_eq!(preview.endpoint_origin, "http://127.0.0.1:11434");
        assert!(!preview.prompt.contains("<b>"));
        assert!(preview.prompt.contains("Mitochondria & ATP?"));

        // Must refuse executing non-test action while AI is disabled.
        let err = run_ai_action(&dir, &secrets, &action, None).unwrap_err();
        assert!(err.to_string().contains("disabled"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_ai_action_returns_clear_error_on_invalid_rewrite_json() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = r#"{"choices":[{"message":{"content":"Sure! Here is a rewrite without JSON."}}],"usage":{"prompt_tokens":10,"completion_tokens":8}}"#;
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 1024];
            let header_end = loop {
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break None;
                }
                raw.extend_from_slice(&buf[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    break Some(pos + 4);
                }
            };
            if let Some(hdr_end) = header_end {
                let hdrs = String::from_utf8_lossy(&raw[..hdr_end]).to_ascii_lowercase();
                let content_len = hdrs
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                while raw.len() < hdr_end + content_len {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..n]);
                }
            }
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            let _ = stream.flush();
        });

        let dir = std::env::temp_dir().join(format!(
            "bibalak-ai-invalid-json-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = MemorySecretStore::default();
        save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::OpenAiCompatible,
                base_url: format!("http://{addr}/v1"),
                model: "gpt-4o-mini".into(),
                api_key: Some("sk-test".into()),
            },
        )
        .unwrap();

        let action = AIActionRequest::RewriteLeech {
            fields: vec![
                AIFieldInput {
                    name: "Front".into(),
                    value_html: "Q".into(),
                },
                AIFieldInput {
                    name: "Back".into(),
                    value_html: "A".into(),
                },
            ],
            lapses: Some(5),
        };

        let err = run_ai_action(&dir, &secrets, &action, None)
            .expect_err("invalid RewriteLeech JSON must return an error, not raw text");
        assert!(
            matches!(err, CoreError::Format(_)),
            "expected CoreError::Format, got: {err:?}"
        );

        let _ = server.join();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preview_and_run_pass_app_locale_and_match_prompt() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = r#"{"choices":[{"message":{"content":"الإجابة"}}],"usage":{"prompt_tokens":8,"completion_tokens":3}}"#;
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 1024];
            let header_end = loop {
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break None;
                }
                raw.extend_from_slice(&buf[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    break Some(pos + 4);
                }
            };
            if let Some(hdr_end) = header_end {
                let hdrs = String::from_utf8_lossy(&raw[..hdr_end]).to_ascii_lowercase();
                let content_len = hdrs
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                while raw.len() < hdr_end + content_len {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..n]);
                }
            }
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            let _ = stream.flush();
            String::from_utf8_lossy(&raw).into_owned()
        });

        let dir = std::env::temp_dir().join(format!(
            "bibalak-ai-locale-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = MemorySecretStore::default();
        save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::OpenAiCompatible,
                base_url: format!("http://{addr}/v1"),
                model: "gpt-4o-mini".into(),
                api_key: Some("sk-test".into()),
            },
        )
        .unwrap();

        // Number/symbol-only card: unclear language, so Arabic app locale drives Arabic output.
        let action = AIActionRequest::ExplainCard {
            front_html: "123 + 456".into(),
            back_html: "579".into(),
            deck_name: None,
        };

        let preview = preview_ai_action(&dir, &action, Some("ar")).unwrap();
        assert!(preview.system.contains("Arabic"));

        let res = run_ai_action(&dir, &secrets, &action, Some("ar")).unwrap();
        assert_eq!(res.prompt_id, "explain_card@1");

        let sent_http = server.join().unwrap();
        assert!(sent_http.contains(&preview.system));
        assert!(sent_http.contains("123 + 456"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

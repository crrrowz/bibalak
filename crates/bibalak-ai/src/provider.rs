//! `ureq` 3 HTTP provider supporting OpenAI-compatible and native Ollama endpoints.

use std::fmt;
use std::time::Duration;

use bibalak_core::ai::{
    normalize_provider_origin, AIProvider, AIProviderKind, AITextRequest, AITextResponse,
};
use bibalak_core::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use ureq::Agent;

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug)]
struct AIProviderError(String);

impl fmt::Display for AIProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AIProviderError {}

/// HTTP AI provider backed by `ureq` 3. Never follows redirects off the configured origin.
pub struct HttpAIProvider {
    pub kind: AIProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    timeout: Duration,
    agent: Agent,
}

impl HttpAIProvider {
    pub fn new(
        kind: AIProviderKind,
        base_url: String,
        model: String,
        api_key: Option<String>,
    ) -> CoreResult<Self> {
        Self::with_timeout(kind, base_url, model, api_key, DEFAULT_TIMEOUT)
    }

    pub fn with_timeout(
        kind: AIProviderKind,
        base_url: String,
        model: String,
        api_key: Option<String>,
        timeout: Duration,
    ) -> CoreResult<Self> {
        let _ = normalize_provider_origin(&base_url)?;
        if model.trim().is_empty() {
            return Err(CoreError::Invalid("AI model name cannot be empty".into()));
        }
        let config = ureq::config::Config::builder()
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_connect(Some(DEFAULT_CONNECT_TIMEOUT.min(timeout)))
            .timeout_global(Some(timeout))
            .build();
        Ok(Self {
            kind,
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            model: model.trim().to_string(),
            api_key: api_key.filter(|k| !k.trim().is_empty()),
            timeout,
            agent: Agent::new_with_config(config),
        })
    }

    /// Resolve the full POST URL and whether native Ollama JSON format should be used.
    pub fn resolve_endpoint(&self) -> (String, bool) {
        let trimmed = self.base_url.trim_end_matches('/');
        match self.kind {
            AIProviderKind::OpenAiCompatible => {
                if trimmed.ends_with("/chat/completions") {
                    (trimmed.to_string(), false)
                } else if has_empty_path(trimmed) {
                    (format!("{trimmed}/v1/chat/completions"), false)
                } else {
                    (format!("{trimmed}/chat/completions"), false)
                }
            }
            AIProviderKind::Ollama => {
                if trimmed.ends_with("/api/chat") {
                    (trimmed.to_string(), true)
                } else if trimmed.ends_with("/chat/completions") {
                    (trimmed.to_string(), false)
                } else if trimmed.ends_with("/v1") {
                    (format!("{trimmed}/chat/completions"), false)
                } else {
                    (format!("{trimmed}/api/chat"), true)
                }
            }
        }
    }

    fn redact(&self, text: &str) -> String {
        match &self.api_key {
            Some(key) if !key.is_empty() => text.replace(key, "[REDACTED]"),
            _ => text.to_string(),
        }
    }
}

fn has_empty_path(url: &str) -> bool {
    url.split_once("://")
        .map(|(_, rest)| !rest.contains('/'))
        .unwrap_or(true)
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
}

#[derive(Serialize)]
struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: Option<OpenAiMessage>,
    prompt_eval_count: Option<u32>,
    eval_count: Option<u32>,
}

impl AIProvider for HttpAIProvider {
    fn complete(&self, request: &AITextRequest) -> CoreResult<AITextResponse> {
        let origin = normalize_provider_origin(&self.base_url)?;
        let (endpoint, native_ollama) = self.resolve_endpoint();

        tracing::debug!(
            provider = ?self.kind,
            origin = %origin,
            model = %self.model,
            "sending AI completion request"
        );

        let mut messages = Vec::with_capacity(2);
        if let Some(sys) = request.system.as_deref().filter(|s| !s.trim().is_empty()) {
            messages.push(ChatMessage {
                role: "system",
                content: sys,
            });
        }
        messages.push(ChatMessage {
            role: "user",
            content: &request.prompt,
        });

        let body_bytes = if native_ollama {
            serde_json::to_vec(&OllamaRequest {
                model: &self.model,
                messages,
                stream: false,
                options: OllamaOptions {
                    num_predict: request.max_tokens,
                    temperature: request.temperature,
                },
            })
        } else {
            serde_json::to_vec(&OpenAiRequest {
                model: &self.model,
                messages,
                max_tokens: request.max_tokens,
                temperature: request.temperature,
            })
        }
        .map_err(|e| CoreError::Other(Box::new(e)))?;

        let mut req = self
            .agent
            .post(&endpoint)
            .header("Content-Type", "application/json");
        if let Some(ref key) = self.api_key {
            req = req.header("Authorization", &format!("Bearer {key}"));
        }

        let mut resp = req.send(&body_bytes).map_err(|e| {
            let msg = match e {
                ureq::Error::Timeout(_) => format!(
                    "AI request timed out after {}s waiting for provider response",
                    self.timeout.as_secs().max(1)
                ),
                other => self.redact(&format!("AI request failed: {other}")),
            };
            CoreError::Other(Box::new(AIProviderError(msg)))
        })?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let body = resp.body_mut().read_to_string().unwrap_or_default();
            let snippet: String = body.chars().take(240).collect();
            return Err(CoreError::Other(Box::new(AIProviderError(self.redact(
                &format!("AI provider returned HTTP {status}: {snippet}"),
            )))));
        }

        if native_ollama {
            let parsed: OllamaResponse = resp.body_mut().read_json().map_err(|e| {
                CoreError::Format(self.redact(&format!("invalid Ollama JSON response: {e}")))
            })?;
            let text = parsed
                .message
                .and_then(|m| m.content)
                .unwrap_or_default()
                .trim()
                .to_string();
            Ok(AITextResponse {
                text,
                input_tokens: parsed.prompt_eval_count,
                output_tokens: parsed.eval_count,
            })
        } else {
            let parsed: OpenAiResponse = resp.body_mut().read_json().map_err(|e| {
                CoreError::Format(self.redact(&format!("invalid OpenAI JSON response: {e}")))
            })?;
            let text = parsed
                .choices
                .into_iter()
                .next()
                .and_then(|c| c.message.content)
                .unwrap_or_default()
                .trim()
                .to_string();
            Ok(AITextResponse {
                text,
                input_tokens: parsed.usage.as_ref().and_then(|u| u.prompt_tokens),
                output_tokens: parsed.usage.as_ref().and_then(|u| u.completion_tokens),
            })
        }
    }

    fn name(&self) -> &str {
        match self.kind {
            AIProviderKind::OpenAiCompatible => "OpenAI-compatible",
            AIProviderKind::Ollama => "Ollama",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_mock_http(
        status_line: &'static str,
        response_body: String,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
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
            let req = String::from_utf8_lossy(&raw).into_owned();
            let reply = format!(
                "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            let _ = stream.flush();
            req
        });
        (format!("http://{addr}"), handle)
    }

    #[test]
    fn openai_compatible_sends_bearer_token_and_parses_response() {
        let (base_url, server) = spawn_mock_http(
            "200 OK",
            r#"{"choices":[{"message":{"content":"Concise explanation"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}"#.into(),
        );

        let provider = HttpAIProvider::new(
            AIProviderKind::OpenAiCompatible,
            format!("{base_url}/v1"),
            "gpt-4o-mini".into(),
            Some("sk-test-123".into()),
        )
        .unwrap();

        let resp = provider
            .complete(&AITextRequest {
                system: Some("You are helpful".into()),
                prompt: "Explain ATP".into(),
                max_tokens: Some(128),
                temperature: Some(0.2),
            })
            .unwrap();

        let raw_req = server.join().unwrap();
        assert!(raw_req.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(raw_req
            .to_ascii_lowercase()
            .contains("authorization: bearer sk-test-123"));
        assert!(raw_req.contains("Explain ATP"));
        assert_eq!(resp.text, "Concise explanation");
        assert_eq!(resp.input_tokens, Some(12));
        assert_eq!(resp.output_tokens, Some(4));
    }

    #[test]
    fn ollama_posts_to_api_chat_and_redacts_secret_on_http_error() {
        let (base_url, server) = spawn_mock_http(
            "401 Unauthorized",
            r#"{"error":"bad token sk-secret-key"}"#.into(),
        );

        let provider = HttpAIProvider::new(
            AIProviderKind::Ollama,
            base_url,
            "llama3.2".into(),
            Some("sk-secret-key".into()),
        )
        .unwrap();

        let err = provider
            .complete(&AITextRequest {
                system: None,
                prompt: "Hello".into(),
                max_tokens: None,
                temperature: None,
            })
            .unwrap_err()
            .to_string();

        let raw_req = server.join().unwrap();
        assert!(raw_req.starts_with("POST /api/chat HTTP/1.1"));
        assert!(raw_req.contains("\"stream\":false"));
        assert!(!err.contains("sk-secret-key"));
        assert!(err.contains("HTTP 401"));
    }

    #[test]
    fn rejects_invalid_urls_or_cross_origin_redirects() {
        assert!(HttpAIProvider::new(
            AIProviderKind::OpenAiCompatible,
            "javascript:alert(1)".into(),
            "model".into(),
            None,
        )
        .is_err());

        let (base_url, server) = spawn_mock_http(
            "302 Found\r\nLocation: https://evil.example/",
            String::new(),
        );
        let provider = HttpAIProvider::new(
            AIProviderKind::OpenAiCompatible,
            base_url,
            "gpt-4o-mini".into(),
            None,
        )
        .unwrap();

        let resp = provider.complete(&AITextRequest {
            system: None,
            prompt: "ping".into(),
            max_tokens: None,
            temperature: None,
        });
        let _ = server.join();
        // With max_redirects(0), ureq treats 302 with empty JSON body as non-200 or JSON parse failure; never follows Location.
        assert!(resp.is_err());
    }

    #[test]
    fn timeout_returns_actionable_error_without_invalid_input_prefix() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(200));
            drop(stream);
        });

        let provider = HttpAIProvider::with_timeout(
            AIProviderKind::OpenAiCompatible,
            format!("http://{addr}/v1"),
            "gemini-3.8-flash-high".into(),
            None,
            Duration::from_millis(40),
        )
        .unwrap();

        let err = provider
            .complete(&AITextRequest {
                system: None,
                prompt: "ping".into(),
                max_tokens: None,
                temperature: None,
            })
            .unwrap_err()
            .to_string();

        let _ = server.join();
        assert!(err.contains("timed out"), "unexpected error: {err}");
        assert!(
            !err.starts_with("invalid input:"),
            "unexpected prefix: {err}"
        );
    }
}

//! Deterministic fake AI provider for pure unit and integration tests.

use std::collections::VecDeque;
use std::sync::Mutex;

use crate::error::{CoreError, CoreResult};

use super::types::{AIProvider, AITextRequest, AITextResponse};

/// Scriptable, zero-network [`AIProvider`] that records every [`AITextRequest`] it receives.
#[derive(Debug)]
pub struct FakeAIProvider {
    name: String,
    replies: Mutex<VecDeque<CoreResult<AITextResponse>>>,
    fallback: CoreResult<AITextResponse>,
    recorded: Mutex<Vec<AITextRequest>>,
}

impl Default for FakeAIProvider {
    fn default() -> Self {
        Self::with_text("OK")
    }
}

impl FakeAIProvider {
    /// Always respond with plain `text` unless overridden via [`Self::scripted`].
    pub fn with_text(text: impl Into<String>) -> Self {
        Self {
            name: "FakeAI".into(),
            replies: Mutex::new(VecDeque::new()),
            fallback: Ok(AITextResponse {
                text: text.into(),
                input_tokens: Some(12),
                output_tokens: Some(6),
            }),
            recorded: Mutex::new(Vec::new()),
        }
    }

    /// Replay responses in FIFO order for consecutive calls.
    pub fn scripted(replies: impl IntoIterator<Item = CoreResult<AITextResponse>>) -> Self {
        Self {
            name: "FakeAI".into(),
            replies: Mutex::new(replies.into_iter().collect()),
            fallback: Err(CoreError::Invalid(
                "FakeAIProvider reply queue exhausted".into(),
            )),
            recorded: Mutex::new(Vec::new()),
        }
    }

    /// Inspect a snapshot of all requests passed to [`AIProvider::complete`].
    pub fn recorded_requests(&self) -> Vec<AITextRequest> {
        self.recorded
            .lock()
            .expect("FakeAIProvider recorded mutex poisoned")
            .clone()
    }
}

impl AIProvider for FakeAIProvider {
    fn complete(&self, request: &AITextRequest) -> CoreResult<AITextResponse> {
        self.recorded
            .lock()
            .expect("FakeAIProvider recorded mutex poisoned")
            .push(request.clone());
        let queued = self
            .replies
            .lock()
            .expect("FakeAIProvider replies mutex poisoned")
            .pop_front();
        if let Some(reply) = queued {
            return reply;
        }
        match &self.fallback {
            Ok(resp) => Ok(resp.clone()),
            Err(err) => Err(CoreError::Invalid(err.to_string())),
        }
    }

    fn name(&self) -> &str {
        &self.name
    }
}

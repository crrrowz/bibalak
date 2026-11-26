import { useCallback, useEffect, useRef, useState } from "react";
import type { AIActionRequest, AIActionResult, AIPreviewPayload } from "@bibalak/ipc-types";
import { mapAiErrorMessage, type MappedAiError } from "@/lib/aiErrors";
import { ipc } from "@/lib/ipc";
import { useAiSession } from "@/stores/aiSession";

export type AiActionPhase =
  | "idle"
  | "not-configured"
  | "loading-preview"
  | "preview"
  | "sending"
  | "result"
  | "error";

/**
 * Shared consent-preview -> send -> result/error state machine for AI actions (AI0/AI2).
 * Monotonic request sequencing drops late IPC replies on cancel, replacement, or unmount.
 */
export function useAiActionRunner(configured: boolean) {
  const [phase, setPhase] = useState<AiActionPhase>("idle");
  const [activeAction, setActiveAction] = useState<AIActionRequest | null>(null);
  const [preview, setPreview] = useState<AIPreviewPayload | null>(null);
  const [result, setResult] = useState<AIActionResult | null>(null);
  const [error, setError] = useState<MappedAiError | null>(null);
  const [skipSession, setSkipSession] = useState(false);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    const seqRef = requestSeqRef;
    return () => {
      seqRef.current += 1;
    };
  }, []);

  const execute = useCallback(async (req: AIActionRequest, seq: number) => {
    setPhase("sending");
    setError(null);
    setResult(null);
    try {
      const res = await ipc.aiRunAction(req);
      if (requestSeqRef.current !== seq) return;
      setResult(res);
      setPhase("result");
    } catch (err) {
      if (requestSeqRef.current !== seq) return;
      setError(mapAiErrorMessage(err));
      setPhase("error");
    }
  }, []);

  const loadPreview = useCallback(async (req: AIActionRequest, seq: number) => {
    setPhase("loading-preview");
    setPreview(null);
    setError(null);
    setResult(null);
    try {
      const payload = await ipc.aiPreviewAction(req);
      if (requestSeqRef.current !== seq) return;
      setPreview(payload);
      setPhase("preview");
    } catch (err) {
      if (requestSeqRef.current !== seq) return;
      setError(mapAiErrorMessage(err));
      setPhase("error");
    }
  }, []);

  const trigger = useCallback(
    (req: AIActionRequest) => {
      const seq = ++requestSeqRef.current;
      setActiveAction(req);
      setError(null);
      if (!configured) {
        setPreview(null);
        setPhase("not-configured");
        return;
      }

      const shouldSkip = useAiSession.getState().shouldSkipPreview(req.kind);
      setSkipSession(shouldSkip);
      if (shouldSkip) {
        void execute(req, seq);
      } else {
        void loadPreview(req, seq);
      }
    },
    [configured, execute, loadPreview],
  );

  const confirmSend = useCallback(() => {
    if (!activeAction) return;
    if (skipSession) {
      useAiSession.getState().setSkipPreview(activeAction.kind, true);
    }
    const seq = ++requestSeqRef.current;
    void execute(activeAction, seq);
  }, [activeAction, execute, skipSession]);

  const retry = useCallback(() => {
    if (!activeAction) return;
    const seq = ++requestSeqRef.current;
    if (useAiSession.getState().shouldSkipPreview(activeAction.kind) || preview) {
      void execute(activeAction, seq);
    } else {
      void loadPreview(activeAction, seq);
    }
  }, [activeAction, execute, loadPreview, preview]);

  const cancel = useCallback(() => {
    requestSeqRef.current += 1;
    setPreview(null);
    setError(null);
    setPhase(result ? "result" : "idle");
  }, [result]);

  const reset = useCallback(() => {
    requestSeqRef.current += 1;
    setActiveAction(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setSkipSession(false);
    setPhase("idle");
  }, []);

  return {
    phase,
    activeAction,
    preview,
    result,
    error,
    skipSession,
    setSkipSession,
    trigger,
    confirmSend,
    retry,
    cancel,
    reset,
  };
}

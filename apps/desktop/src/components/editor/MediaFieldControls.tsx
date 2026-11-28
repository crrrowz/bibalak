import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Mic, Paperclip, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage, ipc } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import {
  appendMediaTagToHtml,
  MEDIA_PICKER_EXTENSIONS,
  saveImageFile,
  saveSoundMediaFile,
} from "@/lib/editorMedia";
import {
  formatStoredMediaReference,
  normalizePastedMediaPath,
  type MediaFieldKind,
} from "@/lib/noteFieldGroups";
import { platform } from "@/lib/platform";
import { toast } from "@/stores/toast";

/**
 * Dedicated media controls (`Attach`, `Record`, `Paste` + media-folder hint) shown on
 * media-aware fields (`Audio`, `Video`, `Snapshot`, etc.) in Add / Quick Add (`F11`).
 */
export function MediaFieldControls({
  kind,
  fieldLabel,
  value,
  onChange,
  tauri,
  compact = false,
}: {
  kind: MediaFieldKind;
  fieldLabel: string;
  value: string;
  onChange: (nextHtml: string) => void;
  tauri: boolean;
  compact?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const reportError = (err: unknown) => {
    const msg = errorMessage(err);
    setError(msg);
    toast.error(msg);
  };

  const applyStoredMedia = (stored: string) => {
    setError(null);
    onChange(appendMediaTagToHtml(value, formatStoredMediaReference(kind, stored)));
  };

  const handleAttach = async () => {
    if (!tauri) return;
    setError(null);
    try {
      const picked = await platform.pickPath({
        title: t("add.media.attachTitle", { field: fieldLabel }),
        filters: [{ name: fieldLabel, extensions: MEDIA_PICKER_EXTENSIONS[kind] }],
      });
      if (!picked) return;
      const stored = await ipc.saveMediaFromPath(picked);
      applyStoredMedia(stored);
    } catch (err) {
      reportError(err);
    }
  };

  const handlePaste = async () => {
    if (!tauri) return;
    setError(null);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.read === "function") {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const mediaMime = item.types.find(
            (mime) =>
              (kind === "image" && mime.startsWith("image/") && !mime.includes("svg")) ||
              (kind !== "image" && (mime.startsWith("audio/") || mime.startsWith("video/"))),
          );
          if (mediaMime) {
            const blob = await item.getType(mediaMime);
            const ext = mediaMime.split("/")[1]?.split(";")[0] ?? "bin";
            const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: mediaMime });
            if (kind === "image") {
              const img = await saveImageFile(file, tauri);
              applyStoredMedia(img.alt);
            } else {
              const stored = await saveSoundMediaFile(file, tauri);
              applyStoredMedia(stored);
            }
            return;
          }
        }
      }
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const txt = await navigator.clipboard.readText();
        const path = normalizePastedMediaPath(txt);
        if (path) {
          const stored = await ipc.saveMediaFromPath(path);
          applyStoredMedia(stored);
          return;
        }
      }
      reportError(t("add.media.pasteEmpty"));
    } catch (err) {
      reportError(err);
    }
  };

  const handleToggleRecord = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      reportError(t("editor.recordingUnsupported"));
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void (async () => {
          try {
            const mime = recorder.mimeType || "audio/webm";
            const blob = new Blob(chunksRef.current, { type: mime });
            if (blob.size === 0) return;
            const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
            const file = new File([blob], `rec-${Date.now()}.${ext}`, { type: mime });
            const stored = await saveSoundMediaFile(file, tauri);
            applyStoredMedia(stored);
          } catch (err) {
            reportError(err);
          }
        })();
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      setRecording(false);
      reportError(err);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void handleAttach()}
        >
          <Paperclip className="size-3.5" aria-hidden="true" />
          <span>{t("add.media.attach")}</span>
        </Button>
        {kind !== "image" && (
          <Button
            type="button"
            variant={recording ? "destructive" : "outline"}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void handleToggleRecord()}
          >
            {recording ? (
              <Square className="size-3.5" aria-hidden="true" />
            ) : (
              <Mic className="size-3.5" aria-hidden="true" />
            )}
            <span>{recording ? t("add.media.stopRecord") : t("add.media.record")}</span>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void handlePaste()}
        >
          <ClipboardPaste className="size-3.5" aria-hidden="true" />
          <span>{t("add.media.paste")}</span>
        </Button>
      </div>
      {!compact && <p className="text-[11px] text-muted-foreground">{t("add.mediaFolderHint")}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

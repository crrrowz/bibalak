import { Check, X } from "lucide-react";
import type { QualityScanNote } from "@bibalak/ipc-types";
import { CardFace } from "@/components/CardFace";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import {
  buildClozeSplitPreviewHtml,
  buildNoteHtmlPreview,
  buildPlainRewritePreview,
  isActionableFindingKind,
  parseTagList,
  QUALITY_PREVIEW_CSS,
  type QualityReviewItem,
} from "./qualityHelpers";

export interface QualityFindingCardProps {
  item: QualityReviewItem;
  note: QualityScanNote | undefined;
  otherNote: QualityScanNote | undefined;
  tauri: boolean;
  night: boolean;
  onToggleAccept: (id: string, accepted: boolean) => void;
  onDismiss: (id: string) => void;
  onUpdateFields: (id: string, fields: string[]) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onUpdateClozes: (id: string, clozes: string[]) => void;
  onToggleSuspendOriginal: (id: string, next: boolean) => void;
}

export function QualityFindingCard({
  item,
  note,
  otherNote,
  tauri,
  night,
  onToggleAccept,
  onDismiss,
  onUpdateFields,
  onUpdateTags,
  onUpdateClozes,
  onToggleSuspendOriginal,
}: QualityFindingCardProps) {
  const { finding, accepted } = item;
  const actionable = isActionableFindingKind(finding.kind);
  const effectiveFields = finding.kind === "rewrite" ? (item.editedFields ?? finding.fields) : null;
  const effectiveTags =
    finding.kind === "suggested-tags" ? (item.editedTags ?? finding.tags) : null;
  const effectiveClozes =
    finding.kind === "cloze-split" ? (item.editedClozes ?? finding.clozes) : null;

  return (
    <article
      className={`rounded-[14px] border p-4 transition-colors ${
        accepted ? "border-primary/50 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono font-medium text-foreground">
            {t("ai.quality.noteIdBadge", { id: finding.note_id })}
          </span>
          {finding.kind === "duplicate-meaning" && (
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-foreground">
              {t("ai.quality.duplicatePair", { id: finding.other_note_id })}
            </span>
          )}
          {accepted && (
            <span className="rounded-md bg-primary/15 px-2 py-0.5 font-medium text-primary">
              {t("ai.quality.accepted")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {actionable && (
            <Button
              type="button"
              size="sm"
              variant={accepted ? "default" : "outline"}
              onClick={() => onToggleAccept(item.id, !accepted)}
              aria-pressed={accepted}
            >
              <Check className="size-3.5" aria-hidden />
              {accepted ? t("ai.quality.accepted") : t("ai.quality.accept")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(item.id)}
            aria-label={t("ai.quality.dismiss")}
          >
            <X className="size-3.5" aria-hidden />
            {t("ai.quality.dismiss")}
          </Button>
        </div>
      </div>

      <p dir="auto" className="mt-2.5 text-sm leading-relaxed text-foreground">
        {finding.reason}
      </p>

      {note && finding.kind !== "rewrite" && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {t("ai.quality.currentNote")}
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <CardFace
              html={buildNoteHtmlPreview(note)}
              css={note.notetype_css || QUALITY_PREVIEW_CSS}
              tauri={tauri}
              night={night}
              className="min-h-[56px] w-full"
            />
          </div>
        </div>
      )}

      {finding.kind === "duplicate-meaning" && otherNote && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {t("ai.quality.duplicatePair", { id: otherNote.note_id })}
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <CardFace
              html={buildNoteHtmlPreview(otherNote)}
              css={otherNote.notetype_css || QUALITY_PREVIEW_CSS}
              tauri={tauri}
              night={night}
              className="min-h-[56px] w-full"
            />
          </div>
        </div>
      )}

      {finding.kind === "suggested-tags" && effectiveTags && (
        <div className="mt-3 space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t("ai.quality.editTagsLabel")}
            <input
              type="text"
              dir="auto"
              value={effectiveTags.join(" ")}
              onChange={(e) => onUpdateTags(item.id, parseTagList(e.target.value))}
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
      )}

      {finding.kind === "rewrite" && effectiveFields && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {note && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t("ai.quality.currentNote")}
                </div>
                <div className="overflow-hidden rounded-lg border border-border bg-background">
                  <CardFace
                    html={buildNoteHtmlPreview(note)}
                    css={note.notetype_css || QUALITY_PREVIEW_CSS}
                    tauri={tauri}
                    night={night}
                    className="min-h-[72px] w-full"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">
                {t("ai.quality.previewApply")}
              </div>
              <div className="overflow-hidden rounded-lg border border-primary/40 bg-background">
                <CardFace
                  html={buildPlainRewritePreview(effectiveFields)}
                  css={QUALITY_PREVIEW_CSS}
                  tauri={tauri}
                  night={night}
                  className="min-h-[72px] w-full"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {effectiveFields.map((val, idx) => {
              const fieldName = note?.fields[idx]?.name ?? String(idx + 1);
              return (
                <label key={idx} className="block text-xs font-medium text-muted-foreground">
                  {t("ai.quality.editFieldLabel", { name: fieldName })}
                  <textarea
                    rows={2}
                    dir="auto"
                    value={val}
                    onChange={(e) => {
                      const next = [...effectiveFields];
                      next[idx] = e.target.value;
                      onUpdateFields(item.id, next);
                    }}
                    className="mt-1 w-full rounded-md border border-input bg-background p-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {finding.kind === "cloze-split" && effectiveClozes && (
        <div className="mt-3 space-y-2.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {t("ai.quality.clozeNewCards")}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {effectiveClozes.map((text, idx) => (
              <div
                key={idx}
                className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5"
              >
                <textarea
                  rows={2}
                  dir="auto"
                  aria-label={`${t("ai.quality.group.cloze-split")} ${idx + 1}`}
                  value={text}
                  onChange={(e) => {
                    const next = [...effectiveClozes];
                    next[idx] = e.target.value;
                    onUpdateClozes(item.id, next);
                  }}
                  className="w-full rounded-md border border-input bg-background p-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="overflow-hidden rounded-md border border-border bg-background">
                  <CardFace
                    html={buildClozeSplitPreviewHtml(text)}
                    css={QUALITY_PREVIEW_CSS}
                    tauri={tauri}
                    night={night}
                    className="min-h-[48px] w-full"
                  />
                </div>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(item.suspendOriginal)}
              onChange={(e) => onToggleSuspendOriginal(item.id, e.target.checked)}
              className="size-3.5 accent-primary"
            />
            <span>{t("ai.quality.clozeSuspendOriginal")}</span>
          </label>
        </div>
      )}
    </article>
  );
}

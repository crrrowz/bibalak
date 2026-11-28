import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { CardFace } from "@/components/CardFace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { EditableDraft } from "@/features/ai/generateHelpers";
import { buildClozePreviewHtml, plainTextToFieldHtml } from "@/lib/aiFormat";
import { t, tn } from "@/lib/i18n";

const CLOZE_PREVIEW_CSS =
  "html, body { background: transparent; margin: 0; } .card { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; text-align: start; padding: 4px; background: transparent; } .cloze { font-weight: 700; color: #b45309; } .nightMode .cloze { color: #fbbf24; }";

interface GenerateDraftReviewSectionProps {
  drafts: EditableDraft[];
  acceptedCount: number;
  duplicates: Record<string, number | null>;
  tauri: boolean;
  night: boolean;
  selectedDeckName: string | null;
  canAddSelected: boolean;
  addingBatch: boolean;
  onSetAllAccepted: (accepted: boolean) => void;
  onUpdateDraft: (id: string, patch: Partial<EditableDraft>) => void;
  onAddSelected: () => void;
}

export function GenerateDraftReviewSection({
  drafts,
  acceptedCount,
  duplicates,
  tauri,
  night,
  selectedDeckName,
  canAddSelected,
  addingBatch,
  onSetAllAccepted,
  onUpdateDraft,
  onAddSelected,
}: GenerateDraftReviewSectionProps) {
  return (
    <section aria-labelledby="gen-review-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="gen-review-heading" className="text-sm font-semibold text-foreground">
            {t("ai.generate.reviewTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("ai.generate.acceptedCount", {
              accepted: acceptedCount,
              total: drafts.length,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onSetAllAccepted(true)}>
            {t("ai.generate.acceptAll")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSetAllAccepted(false)}>
            {t("ai.generate.discardAll")}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {drafts.map((draft, idx) => {
          const dupId = duplicates[draft.id];
          const escapedCloze = draft.kind === "cloze" ? plainTextToFieldHtml(draft.text) : "";
          return (
            <article
              key={draft.id}
              className={`space-y-3 rounded-[14px] border p-4 transition-opacity ${
                draft.accepted ? "border-border bg-card" : "border-border/60 bg-muted/40 opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-muted-foreground">#{idx + 1}</span>
                  <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                    {draft.kind === "cloze"
                      ? t("ai.generate.kindCloze")
                      : t("ai.generate.kindBasic")}
                  </span>
                  {dupId != null && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="size-3" aria-hidden />
                      {t("ai.generate.duplicateBadge")}
                    </span>
                  )}
                  {!draft.accepted && (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                      {t("ai.generate.rejected")}
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant={draft.accepted ? "outline" : "default"}
                  aria-pressed={draft.accepted}
                  onClick={() => onUpdateDraft(draft.id, { accepted: !draft.accepted })}
                >
                  {draft.accepted ? (
                    <>
                      <Trash2 className="me-1.5 size-3.5" aria-hidden />
                      {t("ai.generate.discard")}
                    </>
                  ) : (
                    <>
                      <Check className="me-1.5 size-3.5" aria-hidden />
                      {t("ai.generate.accept")}
                    </>
                  )}
                </Button>
              </div>

              {draft.kind === "basic" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label
                      htmlFor={`draft-${draft.id}-front`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("ai.generate.frontLabel")}
                    </label>
                    <textarea
                      id={`draft-${draft.id}-front`}
                      dir="auto"
                      rows={3}
                      value={draft.front}
                      onChange={(e) => onUpdateDraft(draft.id, { front: e.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`draft-${draft.id}-back`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("ai.generate.backLabel")}
                    </label>
                    <textarea
                      id={`draft-${draft.id}-back`}
                      dir="auto"
                      rows={3}
                      value={draft.back}
                      onChange={(e) => onUpdateDraft(draft.id, { back: e.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label
                      htmlFor={`draft-${draft.id}-text`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("ai.generate.textLabel")}
                    </label>
                    <textarea
                      id={`draft-${draft.id}-text`}
                      dir="auto"
                      rows={3}
                      value={draft.text}
                      onChange={(e) => onUpdateDraft(draft.id, { text: e.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        {t("ai.generate.previewFront")}
                      </div>
                      <div className="overflow-hidden rounded-lg border border-border bg-background p-2">
                        <CardFace
                          html={buildClozePreviewHtml(escapedCloze, "front")}
                          css={CLOZE_PREVIEW_CSS}
                          tauri={tauri}
                          night={night}
                          className="h-24 w-full border-0"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        {t("ai.generate.previewBack")}
                      </div>
                      <div className="overflow-hidden rounded-lg border border-border bg-background p-2">
                        <CardFace
                          html={buildClozePreviewHtml(escapedCloze, "back")}
                          css={CLOZE_PREVIEW_CSS}
                          tauri={tauri}
                          night={night}
                          className="h-24 w-full border-0"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4">
        <span className="text-xs text-muted-foreground">
          {t("ai.generate.acceptedCount", {
            accepted: acceptedCount,
            total: drafts.length,
          })}
        </span>
        <Button type="button" disabled={!canAddSelected} onClick={onAddSelected}>
          {addingBatch ? <Spinner size="md" className="me-1.5" /> : null}
          {tn("ai.generate.addSelected", acceptedCount, {
            deck: selectedDeckName ?? "",
          })}
        </Button>
      </div>
    </section>
  );
}

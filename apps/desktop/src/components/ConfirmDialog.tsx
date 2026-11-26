import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "destructive",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      ariaLabel={title}
      closeOnEscape={!isPending}
      closeOnBackdrop={!isPending}
      className="max-w-sm p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">{description}</p>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={isPending}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button variant={variant} onClick={onConfirm} disabled={isPending}>
          {confirmLabel ?? (variant === "destructive" ? t("common.delete") : t("common.rename"))}
        </Button>
      </div>
    </Dialog>
  );
}

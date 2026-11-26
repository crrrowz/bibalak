import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";

export function DialogFrame({
  open,
  title,
  onClose,
  maxWidth = "max-w-md",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  maxWidth?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} ariaLabel={title} className={`${maxWidth} p-6`}>
      {children}
    </Dialog>
  );
}

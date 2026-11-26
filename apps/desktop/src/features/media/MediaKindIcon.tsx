import { File, Film, Image as ImageIcon, Volume2 } from "lucide-react";
import type { MediaKind } from "@bibalak/ipc-types";
import { cn } from "@/lib/utils";

/** Icon badge matching a stored media category. */
export function MediaKindIcon({ kind, className }: { kind: MediaKind; className?: string }) {
  if (kind === "audio") {
    return <Volume2 className={cn("size-8 text-primary/80", className)} aria-hidden="true" />;
  }
  if (kind === "video") {
    return <Film className={cn("size-8 text-primary/80", className)} aria-hidden="true" />;
  }
  if (kind === "image") {
    return (
      <ImageIcon className={cn("size-8 text-muted-foreground", className)} aria-hidden="true" />
    );
  }
  return <File className={cn("size-8 text-muted-foreground", className)} aria-hidden="true" />;
}

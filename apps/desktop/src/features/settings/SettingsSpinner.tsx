import { Loader2 } from "lucide-react";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={"animate-spin " + (className ?? "size-3.5")} aria-hidden />;
}

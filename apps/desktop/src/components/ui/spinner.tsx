import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * Single shared loading indicator for buttons, status banners, and dialogs.
 */
export function Spinner({ size = "sm", className }: SpinnerProps) {
  return <Loader2 className={cn("animate-spin", SIZES[size], className)} aria-hidden="true" />;
}

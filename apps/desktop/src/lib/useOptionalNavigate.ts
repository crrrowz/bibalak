import { useNavigate } from "@tanstack/react-router";

export type OptionalRouteTarget =
  | "/"
  | "/assistant"
  | "/assistant/generate"
  | "/assistant/quality"
  | "/character"
  | "/shop"
  | "/plan/habits"
  | "/settings"
  | "/browse"
  | "/stats"
  | "/transcript"
  | "/streak"
  | "/quests";

/**
 * Returns a typed route navigator when inside TanStack Router, or `null` when
 * components render standalone in unit tests without `<RouterProvider>`.
 */
export function useOptionalNavigate():
  | ((to: OptionalRouteTarget, search?: Record<string, unknown>) => void)
  | null {
  try {
    const navigate = useNavigate();
    return (to, search) => {
      if (search) {
        void navigate({ to, search: search as never });
      } else {
        void navigate({ to });
      }
    };
  } catch {
    return null;
  }
}

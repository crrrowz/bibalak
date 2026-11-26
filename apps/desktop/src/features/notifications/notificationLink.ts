export function navigateToNotificationLink(
  link: string,
  navigate: ((to: never, search?: Record<string, unknown>) => void) | null,
): void {
  if (!navigate) return;
  const [rawPath, rawSearch] = link.split("?");
  const path = rawPath || "/";
  if (!rawSearch) {
    navigate(path as never);
    return;
  }
  const search: Record<string, unknown> = {};
  const params = new URLSearchParams(rawSearch);
  for (const [k, v] of params.entries()) {
    search[k] = v;
  }
  navigate(path as never, search);
}

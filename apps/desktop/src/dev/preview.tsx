// Dev-only entry: the real app on a fake backend. Open /preview.html with
// `pnpm dev:web`. Not part of the production build (vite builds index.html only).
//
// Query options (handy for screenshots):
//   style=default|scholar|game   presentation style
//   lang=en|ar                   interface language
//   theme=light|dark             colour theme
//   route=/browse                screen to open (default: the deck list)
//   clean=1                      hide first-run tips
// The mocks are imported after the options are stored, because importing them
// loads modules (language, theme) that read their saved value once at start.

const params = new URLSearchParams(location.search);

function remember(key: string, value: string | null, allowed: readonly string[]) {
  if (value === null || !allowed.includes(value)) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

remember("keepsake-style", params.get("style"), ["default", "scholar", "game"]);
remember("keepsake-locale", params.get("lang"), ["en", "ar"]);
remember("keepsake-theme", params.get("theme"), ["light", "dark"]);
// clean=1: hide first-run tips so screenshots show only the screen itself.
remember("keepsake-tip-cmdk", params.get("clean") === "1" ? "1" : null, ["1"]);

const routeParam = params.get("route");
const route = routeParam && /^\/[a-z0-9/_-]*$/i.test(routeParam) ? routeParam : "/";

const { installPreviewMocks } = await import("./previewMocks");
installPreviewMocks();
// Start on the chosen screen instead of the router's "not found" for
// /preview.html. (A full page reload then lands on the real app without
// mocks: reopen /preview.html instead.)
history.replaceState(null, "", route + location.search);
await import("../main");

export {};

import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts-base.css";
// Arabic glyphs only (Latin stays Figtree); weights used by the UI.
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "./styles/globals.css";
import { ensureLocaleLoaded, getLocale } from "./lib/i18n";

async function boot() {
  await ensureLocaleLoaded(getLocale());
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();

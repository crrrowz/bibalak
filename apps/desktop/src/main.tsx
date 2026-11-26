import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/figtree";
// Arabic glyphs only (Latin stays Figtree); weights used by the UI.
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
// Scholar heading serif fonts (Literata for Latin, Amiri for Arabic).
import "@fontsource-variable/literata";
import "@fontsource/amiri/arabic-400.css";
import "@fontsource/amiri/arabic-700.css";
// Game heading pixel-modular font (Latin + Arabic glyphs).
import "@fontsource-variable/handjet";
import "./styles/globals.css";
import "katex/dist/katex.min.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

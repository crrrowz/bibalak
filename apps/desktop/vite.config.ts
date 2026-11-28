import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const desktopPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

const host = process.env.TAURI_DEV_HOST;

function resolveBuildStamp(): { sha: string; date: string } {
  if (process.env.VITEST) {
    return { sha: "test", date: "2026-01-01T00:00:00.000Z" };
  }
  let sha = "dev";
  try {
    const out = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) sha = out;
  } catch {
    // Git unavailable or outside a repo; keep "dev".
  }
  return { sha, date: new Date().toISOString() };
}

const buildStamp = resolveBuildStamp();

// https://vite.dev/config/ + https://vitest.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(desktopPkg.version),
    __BUILD_SHA__: JSON.stringify(buildStamp.sha),
    __BUILD_DATE__: JSON.stringify(buildStamp.date),
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("katex")) return "katex";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) {
            return "charts";
          }
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "editor";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\")) {
            return "react-vendor";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tauri owns the Rust side; don't let Vite watch it.
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Node 25+ enables --experimental-webstorage by default, exposing an
    // incomplete global localStorage that shadows jsdom's Storage. Disable it
    // on worker processes when the current Node runtime supports the flag.
    execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
      ? ["--no-experimental-webstorage"]
      : [],
  },
}));

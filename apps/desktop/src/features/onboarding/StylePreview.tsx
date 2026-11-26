import { useTheme } from "@/stores/theme";
import type { Style } from "@/stores/style";

interface PreviewPalette {
  shellBg: string;
  cardBg: string;
  border: string;
  primary: string;
  ink: string;
  muted: string;
  accent: string;
  barBg: string;
  barFill: string;
  radius: string;
}

function getPreviewPalette(style: Style, dark: boolean): PreviewPalette {
  if (style === "scholar") {
    return dark
      ? {
          shellBg: "#141820",
          cardBg: "#1C2230",
          border: "#2E3647",
          primary: "#8FB0DD",
          ink: "#E8E2D6",
          muted: "#9AA2B2",
          accent: "#D89AA5",
          barBg: "#283042",
          barFill: "#8FB0DD",
          radius: "6px",
        }
      : {
          shellBg: "#F6F1E6",
          cardBg: "#FBF8F1",
          border: "#DDD3C2",
          primary: "#22406B",
          ink: "#1F2A3A",
          muted: "#5A6577",
          accent: "#7A2E3A",
          barBg: "#E6DEC9",
          barFill: "#22406B",
          radius: "6px",
        };
  }
  if (style === "game") {
    return dark
      ? {
          shellBg: "#13121E",
          cardBg: "#1C1B2C",
          border: "#32304A",
          primary: "#A77DF4",
          ink: "#EAEAF4",
          muted: "#A1A0BC",
          accent: "#F3BA34",
          barBg: "#27253C",
          barFill: "#42D6A4",
          radius: "8px",
        }
      : {
          shellBg: "#F2F1FA",
          cardBg: "#FCFCFF",
          border: "#CFCDE3",
          primary: "#6A29C7",
          ink: "#1D1B31",
          muted: "#585671",
          accent: "#915B07",
          barBg: "#E2E0F2",
          barFill: "#1B7D59",
          radius: "8px",
        };
  }
  return dark
    ? {
        shellBg: "#171412",
        cardBg: "#221E1B",
        border: "#352E29",
        primary: "#E5885D",
        ink: "#EBE7E0",
        muted: "#A3998F",
        accent: "#E5885D",
        barBg: "#2F2925",
        barFill: "#E5885D",
        radius: "8px",
      }
    : {
        shellBg: "#FAF8F5",
        cardBg: "#FFFEFC",
        border: "#E5DFD7",
        primary: "#BA542C",
        ink: "#26201C",
        muted: "#6F655D",
        accent: "#BA542C",
        barBg: "#EDE7DF",
        barFill: "#BA542C",
        radius: "8px",
      };
}

/**
 * Miniature visual preview of a Bibalak presentation style using explicit
 * theme-matched colors so all three cards stay accurate regardless of which
 * `data-style` is currently active on `<html>`.
 */
export function StylePreview({ style }: { style: Style }) {
  const dark = useTheme((s) => s.resolved === "dark");
  const p = getPreviewPalette(style, dark);

  return (
    <div
      data-testid={`onboarding-style-preview-${style}`}
      aria-hidden="true"
      className="w-full overflow-hidden border p-2"
      style={{
        backgroundColor: p.shellBg,
        borderColor: p.border,
        borderRadius: p.radius,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <div
          className="h-2 w-10 rounded-sm"
          style={{
            backgroundColor: p.ink,
            opacity: 0.85,
          }}
        />
        <div
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: p.accent,
          }}
        />
      </div>

      {style === "scholar" && (
        <div className="mb-1.5 h-px w-full" style={{ backgroundColor: p.accent, opacity: 0.7 }} />
      )}

      <div
        className="border p-2"
        style={{
          backgroundColor: p.cardBg,
          borderColor: p.border,
          borderRadius: p.radius,
        }}
      >
        <div className="mb-1.5 h-1.5 w-3/4 rounded-sm" style={{ backgroundColor: p.ink }} />
        <div
          className="mb-2 h-1.5 w-1/2 rounded-sm"
          style={{ backgroundColor: p.muted, opacity: 0.65 }}
        />
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: p.barBg }}
        >
          <div className="h-full w-2/3 rounded-full" style={{ backgroundColor: p.barFill }} />
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-end gap-1">
        <div className="h-2.5 w-8 rounded-sm" style={{ backgroundColor: p.primary }} />
      </div>
    </div>
  );
}

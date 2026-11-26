import { X } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { modShortcut } from "@/lib/shortcuts";

/** Built at render time so it follows the active language. */
function sections(): { heading: string; rows: [string, string][] }[] {
  return [
    {
      heading: t("shortcuts.section.global"),
      rows: [
        [t("shortcuts.openPalette"), modShortcut("K")],
        [t("shortcuts.title"), "?"],
      ],
    },
    {
      heading: t("shortcuts.section.study"),
      rows: [
        [t("shortcuts.showAnswer"), "Space / Enter"],
        [t("shortcuts.rateAgain"), "1"],
        [t("shortcuts.rateHard"), "2"],
        [t("shortcuts.rateGood"), "3"],
        [t("shortcuts.rateEasy"), "4"],
        [t("shortcuts.replayAudio"), "R"],
        [t("shortcuts.suspend"), "S"],
        [t("shortcuts.bury"), "B"],
        [t("shortcuts.focusMode"), "F"],
        [t("shortcuts.exitFocus"), "Esc"],
      ],
    },
    {
      heading: t("shortcuts.section.browse"),
      rows: [
        [t("shortcuts.search"), t("shortcuts.typeInSearch")],
        [t("shortcuts.selectAll"), modShortcut("A")],
        [t("shortcuts.deleteSelected"), "⌫"],
      ],
    },
    {
      heading: t("shortcuts.section.navigation"),
      rows: [
        [t("shortcuts.goDecks"), t("shortcuts.gThen", { key: "D" })],
        [t("nav.browse"), t("shortcuts.gThen", { key: "B" })],
        [t("nav.settings"), t("shortcuts.gThen", { key: "," })],
      ],
    },
    {
      heading: t("shortcuts.section.plan"),
      rows: [
        [t("shortcuts.plan.quickAdd"), "Q"],
        [t("shortcuts.plan.today"), "T"],
        [t("shortcuts.plan.nextPrev"), "J / K"],
        [t("shortcuts.plan.moveColumn"), "← / →"],
        [t("shortcuts.plan.undo"), "Z"],
        [t("shortcuts.plan.escape"), "Esc"],
        [t("shortcuts.plan.calendarViews"), "1–5 / D, W, M, A"],
        [t("shortcuts.plan.calendarUnscheduled"), "U"],
        [t("shortcuts.plan.matrixToggleView"), "V"],
        [t("shortcuts.plan.openOrToggle"), "Enter / Space"],
        [t("shortcuts.plan.matrixPriorityQuadrant"), "1–4 / Shift+1..4"],
        [t("shortcuts.plan.matrixEditDelete"), "F2 / ⌫"],
        [t("shortcuts.plan.matrixReorder"), "Alt+↑ / Alt+↓"],
        [t("shortcuts.plan.habitsSkipArchive"), "S / A"],
      ],
    },
  ];
}

interface Props {
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ onClose }: Props) {
  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabelledBy="shortcuts-dialog-title"
      className="glass-panel flex max-h-[80vh] max-w-md flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 id="shortcuts-dialog-title" className="text-sm font-semibold">
          {t("shortcuts.title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("shortcuts.closeDialog")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
        {sections().map((section) => (
          <section key={section.heading}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.heading}
            </h3>
            <table className="w-full text-sm" role="presentation">
              <tbody>
                {section.rows.map(([action, key]) => (
                  <tr key={action} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-foreground">{action}</td>
                    <td className="py-1.5 text-end">
                      <Kbd>{key}</Kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

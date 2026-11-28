import type { NotetypeSummary } from "@bibalak/ipc-types";
import { Select } from "@/components/ui/select";
import { t } from "@/lib/i18n";

interface NotetypeSidebarProps {
  notetypes: NotetypeSummary[];
  stockNames: string[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreateBlank: () => void;
  onAddStock: (index: number) => void;
}

/** Left navigation list of note types with quick Blank / Stock creation menu. */
export function NotetypeSidebar({
  notetypes,
  stockNames,
  selectedId,
  onSelect,
  onCreateBlank,
  onAddStock,
}: NotetypeSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-e border-border">
      <div className="space-y-1.5 border-b border-border px-3 py-2">
        <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("notetypes.title")}
        </span>
        <Select
          selectSize="xs"
          value=""
          title={t("notetypes.add")}
          aria-label={t("notetypes.add")}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "blank") {
              onCreateBlank();
            } else if (value) {
              onAddStock(Number(value));
            }
          }}
        >
          <option value="" disabled>
            {t("notetypes.addMenu")}
          </option>
          <option value="blank">{t("notetypes.blank")}</option>
          {stockNames.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        {notetypes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={selectedId === item.id ? "true" : undefined}
            onClick={() => onSelect(item.id)}
            className={[
              "flex w-full items-center justify-between px-3 py-2 text-start text-sm transition-colors",
              selectedId === item.id
                ? "bg-sidebar-accent font-medium text-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60",
            ].join(" ")}
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{item.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {Number(item.kind) === 1 ? t("notetypes.kind.cloze") : t("notetypes.kind.standard")}
              </span>
            </div>
            <span className="ms-2 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
              {item.note_count}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

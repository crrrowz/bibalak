import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { t, tn } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { DialogFrame } from "./DialogFrame";

export function FindDuplicatesDialog({
  open,
  onClose,
  onOpenGroup,
  onTagged,
}: {
  open: boolean;
  onClose: () => void;
  onOpenGroup: (noteIds: number[]) => void;
  onTagged: () => void;
}) {
  const tauri = isTauri();
  const [notetypeId, setNotetypeId] = useState<number | null>(null);
  const [fieldOrd, setFieldOrd] = useState(0);
  const [dupTag, setDupTag] = useState(() => t("browse.findDuplicates.defaultTag"));

  const notetypesQuery = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: ipc.listNotetypes,
    enabled: open && tauri,
  });

  const notetypes = notetypesQuery.data ?? [];
  const activeNt = notetypes.find((n) => n.id === notetypeId) ?? notetypes[0] ?? null;

  const scanMut = useMutation({
    mutationFn: () => {
      if (!activeNt) return Promise.resolve([]);
      return ipc.findDuplicates(activeNt.id, fieldOrd);
    },
  });

  const tagMut = useMutation({
    mutationFn: async () => {
      const groups = scanMut.data ?? [];
      const dupIds = [...new Set(groups.flatMap((g) => g.note_ids.slice(1)))];
      const cleanTag = dupTag.trim();
      if (dupIds.length === 0 || !cleanTag) return 0;
      await ipc.bulkAddTag(dupIds, cleanTag);
      return dupIds.length;
    },
    onSuccess: (count) => {
      if (count > 0) onTagged();
    },
  });

  useEffect(() => {
    if (open) {
      setFieldOrd(0);
      setDupTag(t("browse.findDuplicates.defaultTag"));
      scanMut.reset();
      tagMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = scanMut.data ?? [];

  return (
    <DialogFrame
      open={open}
      title={t("browse.findDuplicates.title")}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <h2 className="mb-2 text-base font-semibold">{t("browse.findDuplicates.title")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("browse.findDuplicates.description")}</p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="dup-notetype" className="mb-1 block text-xs font-medium">
            {t("browse.findDuplicates.notetypeLabel")}
          </label>
          <Select
            id="dup-notetype"
            value={activeNt?.id ?? ""}
            onChange={(e) => {
              setNotetypeId(Number(e.target.value));
              setFieldOrd(0);
              scanMut.reset();
              tagMut.reset();
            }}
          >
            {notetypes.map((nt) => (
              <option key={nt.id} value={nt.id}>
                {nt.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="dup-field" className="mb-1 block text-xs font-medium">
            {t("browse.findDuplicates.fieldLabel")}
          </label>
          <Select
            id="dup-field"
            value={fieldOrd}
            onChange={(e) => {
              setFieldOrd(Number(e.target.value));
              scanMut.reset();
              tagMut.reset();
            }}
          >
            {(activeNt?.field_names ?? []).map((name, idx) => (
              <option key={name} value={idx}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        <Button
          type="button"
          disabled={!activeNt || scanMut.isPending}
          onClick={() => {
            tagMut.reset();
            scanMut.mutate();
          }}
        >
          {t("browse.findDuplicates.scan")}
        </Button>
      </div>

      {scanMut.isError && (
        <p className="mb-3 text-xs text-destructive">{String((scanMut.error as Error).message)}</p>
      )}

      {scanMut.isSuccess && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            {groups.length === 0
              ? t("browse.findDuplicates.none")
              : tn("browse.findDuplicates.groupCount", groups.length)}
          </div>

          {groups.length > 0 && (
            <>
              <div className="max-h-56 divide-y divide-border overflow-auto rounded-lg border border-border">
                {groups.map((g) => (
                  <div
                    key={g.normalized}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {g.sample_value || t("browse.empty")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tn("browse.findDuplicates.noteCount", g.note_ids.length)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenGroup(g.note_ids)}
                    >
                      {t("browse.findDuplicates.openInBrowse")}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor="dup-tag" className="mb-1 block text-xs font-medium">
                    {t("browse.findDuplicates.tagLabel")}
                  </label>
                  <input
                    id="dup-tag"
                    value={dupTag}
                    onChange={(e) => setDupTag(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dupTag.trim() || tagMut.isPending}
                  onClick={() => tagMut.mutate()}
                >
                  <Tags className="size-3.5" />
                  {t("browse.findDuplicates.tagBtn")}
                </Button>
              </div>
              {tagMut.isSuccess && (
                <p className="text-xs text-muted-foreground">
                  {tn("browse.findDuplicates.tagged", tagMut.data, { tag: dupTag.trim() })}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </DialogFrame>
  );
}

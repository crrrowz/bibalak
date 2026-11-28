import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { t, tn } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { DialogFrame } from "./DialogFrame";

export function ChangeNotetypeDialog({
  open,
  noteIds,
  sourceNotetypeNames,
  onClose,
  onDone,
}: {
  open: boolean;
  noteIds: number[];
  sourceNotetypeNames: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tauri = isTauri();
  const notetypesQuery = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: ipc.listNotetypes,
    enabled: open && tauri,
  });

  const uniqueSources = [...new Set(sourceNotetypeNames)];
  const isMixed = uniqueSources.length > 1;
  const notetypes = notetypesQuery.data ?? [];
  const srcNt =
    !isMixed && uniqueSources.length === 1
      ? (notetypes.find((n) => n.name === uniqueSources[0]) ?? null)
      : null;
  const targets = srcNt ? notetypes.filter((n) => n.id !== srcNt.id) : [];

  const [targetId, setTargetId] = useState<number | null>(null);
  const effectiveTargetId =
    targetId !== null && targets.some((n) => n.id === targetId)
      ? targetId
      : (targets[0]?.id ?? null);

  const srcDetailQuery = useQuery({
    queryKey: queryKeys.notetypesDetail(srcNt?.id ?? null),
    queryFn: () => ipc.getNotetype(srcNt!.id),
    enabled: open && tauri && srcNt !== null,
  });

  const dstDetailQuery = useQuery({
    queryKey: queryKeys.notetypesDetail(effectiveTargetId),
    queryFn: () => ipc.getNotetype(effectiveTargetId!),
    enabled: open && tauri && effectiveTargetId !== null,
  });

  const srcDetail = srcDetailQuery.data;
  const dstDetail = dstDetailQuery.data;
  const pairKey = srcDetail && dstDetail ? `${srcDetail.id}:${dstDetail.id}` : "";

  const [fieldMapState, setFieldMapState] = useState<{
    key: string;
    map: Array<number | null>;
  } | null>(null);
  const [templateMapState, setTemplateMapState] = useState<{
    key: string;
    map: Array<[number, number | null]>;
  } | null>(null);
  const [dropConfirmedState, setDropConfirmedState] = useState<{
    key: string;
    confirmed: boolean;
  }>({ key: "", confirmed: false });

  const defaultFieldMap: Array<number | null> =
    srcDetail && dstDetail
      ? dstDetail.fields.map((_, idx) => (idx < srcDetail.fields.length ? idx : null))
      : [];
  const defaultTemplateMap: Array<[number, number | null]> =
    srcDetail && dstDetail
      ? srcDetail.templates.map((tmpl, idx) => [
          Number(tmpl.ord),
          idx < dstDetail.templates.length ? Number(dstDetail.templates[idx].ord) : null,
        ])
      : [];

  const fieldMap = fieldMapState?.key === pairKey ? fieldMapState.map : defaultFieldMap;
  const templateMap = templateMapState?.key === pairKey ? templateMapState.map : defaultTemplateMap;
  const dropConfirmed = dropConfirmedState.key === pairKey ? dropConfirmedState.confirmed : false;

  const setFieldMap = (updater: (prev: (number | null)[]) => (number | null)[]) =>
    setFieldMapState({ key: pairKey, map: updater(fieldMap) });
  const setTemplateMap = (
    updater: (prev: [number, number | null][]) => [number, number | null][],
  ) => {
    setTemplateMapState({ key: pairKey, map: updater(templateMap) });
  };
  const setDropConfirmed = (confirmed: boolean) =>
    setDropConfirmedState({ key: pairKey, confirmed });

  const applyMut = useMutation({
    mutationFn: () => {
      if (effectiveTargetId === null) {
        return Promise.reject(new Error(t("browse.changeNotetype.noOtherTypes")));
      }
      return ipc.changeNoteType(noteIds, effectiveTargetId, fieldMap, templateMap);
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      setTargetId(null);
      setFieldMapState(null);
      setTemplateMapState(null);
      setDropConfirmedState({ key: "", confirmed: false });
      applyMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDstCloze = dstDetail ? Number(dstDetail.kind) === 1 : false;
  const droppedTemplates =
    srcDetail && dstDetail
      ? srcDetail.templates.filter((st) =>
          isDstCloze
            ? Number(st.ord) > 0
            : (templateMap.find(([ord]) => ord === Number(st.ord))?.[1] ?? null) === null,
        )
      : [];
  const lostCardCount = droppedTemplates.length * noteIds.length;

  return (
    <DialogFrame open={open} title={t("browse.changeNotetype.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.changeNotetype.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {tn("browse.changeNotetype.description", noteIds.length)}
      </p>

      {isMixed ? (
        <p className="mb-4 text-sm text-destructive">{t("browse.changeNotetype.mixedError")}</p>
      ) : srcNt && targets.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {t("browse.changeNotetype.noOtherTypes")}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyMut.mutate();
          }}
        >
          {srcNt && (
            <p className="text-xs font-medium text-muted-foreground">
              {t("browse.changeNotetype.sourceLabel", { name: srcNt.name })}
            </p>
          )}
          <div>
            <label htmlFor="change-nt-target" className="mb-1 block text-xs font-medium">
              {t("browse.changeNotetype.targetLabel")}
            </label>
            <Select
              id="change-nt-target"
              value={effectiveTargetId ?? ""}
              onChange={(e) => setTargetId(Number(e.target.value))}
            >
              {targets.map((nt) => (
                <option key={nt.id} value={nt.id}>
                  {nt.name}
                </option>
              ))}
            </Select>
          </div>

          {(() => {
            const srcDetail = srcDetailQuery.data;
            const dstDetail = dstDetailQuery.data;
            if (!srcDetail || !dstDetail) return null;
            return (
              <>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("browse.changeNotetype.fieldsHeading")}
                  </h3>
                  {dstDetail.fields.map((dstField, dstIdx) => (
                    <div key={String(dstField.ord)} className="flex items-center gap-2">
                      <label
                        htmlFor={`change-nt-field-${dstIdx}`}
                        className="w-28 truncate text-xs font-medium"
                      >
                        {dstField.name}
                      </label>
                      <Select
                        id={`change-nt-field-${dstIdx}`}
                        selectSize="sm"
                        containerClassName="flex-1"
                        value={fieldMap[dstIdx] ?? ""}
                        onChange={(e) => {
                          const val = e.target.value === "" ? null : Number(e.target.value);
                          setFieldMap((prev) => prev.map((v, i) => (i === dstIdx ? val : v)));
                        }}
                      >
                        <option value="">{t("browse.changeNotetype.emptyField")}</option>
                        {srcDetail.fields.map((sf, sIdx) => (
                          <option key={String(sf.ord)} value={sIdx}>
                            {sf.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("browse.changeNotetype.templatesHeading")}
                  </h3>
                  {Number(dstDetail.kind) === 0 ? (
                    srcDetail.templates.map((srcTmpl, tIdx) => {
                      const currentMapped =
                        templateMap.find(([ord]) => ord === Number(srcTmpl.ord))?.[1] ?? null;
                      return (
                        <div key={String(srcTmpl.ord)} className="flex items-center gap-2">
                          <label
                            htmlFor={`change-nt-tmpl-${tIdx}`}
                            className="w-28 truncate text-xs font-medium"
                          >
                            {srcTmpl.name}
                          </label>
                          <Select
                            id={`change-nt-tmpl-${tIdx}`}
                            selectSize="sm"
                            containerClassName="flex-1"
                            value={currentMapped === null ? "" : String(currentMapped)}
                            onChange={(e) => {
                              const val = e.target.value === "" ? null : Number(e.target.value);
                              setDropConfirmed(false);
                              setTemplateMap((prev) =>
                                prev.map(([o, m]) =>
                                  o === Number(srcTmpl.ord) ? [o, val] : [o, m],
                                ),
                              );
                            }}
                          >
                            <option value="">{t("browse.changeNotetype.drop")}</option>
                            {dstDetail.templates.map((dt) => (
                              <option key={String(dt.ord)} value={String(dt.ord)}>
                                {dt.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("browse.changeNotetype.clozeNotice")}
                    </p>
                  )}

                  {droppedTemplates.length > 0 && (
                    <div
                      role="alert"
                      className="space-y-2 rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
                    >
                      <p>
                        {tn("browse.changeNotetype.dropWarning", lostCardCount, {
                          count: lostCardCount,
                          templates: droppedTemplates.map((d) => d.name).join(", "),
                        })}
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
                        <input
                          type="checkbox"
                          checked={dropConfirmed}
                          onChange={(e) => setDropConfirmed(e.target.checked)}
                        />
                        <span>{t("browse.changeNotetype.confirmDrop")}</span>
                      </label>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {applyMut.isError && (
            <p className="text-xs text-destructive">{String((applyMut.error as Error).message)}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={applyMut.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                applyMut.isPending ||
                noteIds.length === 0 ||
                effectiveTargetId === null ||
                !srcDetailQuery.data ||
                !dstDetailQuery.data ||
                fieldMap.length !== dstDetailQuery.data.fields.length ||
                templateMap.length !== srcDetailQuery.data.templates.length ||
                (droppedTemplates.length > 0 && !dropConfirmed)
              }
            >
              {t("browse.changeNotetype.apply")}
            </Button>
          </div>
        </form>
      )}

      {(isMixed || (srcNt && targets.length === 0)) && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      )}
    </DialogFrame>
  );
}

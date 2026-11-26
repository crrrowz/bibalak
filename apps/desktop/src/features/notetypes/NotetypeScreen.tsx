import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BookType, Copy, Trash2 } from "lucide-react";
import type { FieldOptions, NotetypeDetail, TemplateSummary } from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { FieldsTab } from "@/features/notetypes/FieldsTab";
import { NotetypeSidebar } from "@/features/notetypes/NotetypeSidebar";
import { StylingTab } from "@/features/notetypes/StylingTab";
import { TemplatesTab } from "@/features/notetypes/TemplatesTab";
import { t } from "@/lib/i18n";
import { handleTabListKeyDown } from "@/lib/a11y";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useTheme } from "@/stores/theme";
import { toast } from "@/stores/toast";

type Tab = "fields" | "templates" | "styling";

/** Note Types editor orchestrator managing sidebar selection, tabs, dirty template guards, and IPC mutations. */
export function NotetypeScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const night = useTheme((s) => s.resolved === "dark");

  const notetypes = useQuery({
    queryKey: queryKeys.notetypes,
    queryFn: () => ipc.listNotetypes(),
    enabled: tauri,
  });

  const stockNames = useQuery({
    queryKey: queryKeys.notetypesStock,
    queryFn: () => ipc.listStockNotetypes(),
    enabled: tauri,
    staleTime: Infinity,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("fields");
  const [selectedTemplateOrd, setSelectedTemplateOrd] = useState<number>(0);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [confirmDialogState, setConfirmDialogState] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });

  // Auto-select first notetype when list loads.
  useEffect(() => {
    if (selectedId === null && notetypes.data && notetypes.data.length > 0) {
      setSelectedId(notetypes.data[0].id);
    }
  }, [notetypes.data, selectedId]);

  const detail = useQuery({
    queryKey: queryKeys.notetype(selectedId!),
    queryFn: () => ipc.getNotetype(selectedId!),
    enabled: tauri && selectedId !== null,
    staleTime: 30_000,
  });

  const nt: NotetypeDetail | null = detail.data ?? null;

  const [tmplName, setTmplName] = useState("");
  const [tmplQfmt, setTmplQfmt] = useState("");
  const [tmplAfmt, setTmplAfmt] = useState("");

  const template: TemplateSummary | undefined = nt?.templates.find(
    (tmpl) => Number(tmpl.ord) === selectedTemplateOrd,
  );

  // Sync local template state only when switching templates (prevents refetch overwriting drafts).
  const lastTemplateKeyRef = useRef<string>("");
  const currentTemplateKey = `${selectedId}:${selectedTemplateOrd}`;
  useEffect(() => {
    if (template && lastTemplateKeyRef.current !== currentTemplateKey) {
      lastTemplateKeyRef.current = currentTemplateKey;
      setTmplName(template.name);
      setTmplQfmt(template.qfmt);
      setTmplAfmt(template.afmt);
    }
  }, [currentTemplateKey, template]);

  const isTemplateDirty =
    template &&
    (tmplName !== template.name || tmplQfmt !== template.qfmt || tmplAfmt !== template.afmt);

  const confirmSwitch = (action: () => void) => {
    if (isTemplateDirty) {
      setConfirmDialogState({
        open: true,
        title: t("notetypes.title"),
        description: t("notetypes.unsavedChanges"),
        onConfirm: () => {
          setConfirmDialogState((s) => ({ ...s, open: false }));
          lastTemplateKeyRef.current = "";
          action();
        },
      });
      return;
    }
    action();
  };

  const sampleFields = nt?.fields.map((f) => `(${f.name})`) ?? [];
  const [cssDraft, setCssDraft] = useState("");
  useEffect(() => {
    setCssDraft(nt?.css ?? "");
  }, [nt?.id, nt?.css]);

  const preview = useQuery({
    queryKey: queryKeys.notetypesPreview(
      selectedId,
      selectedTemplateOrd,
      tmplQfmt,
      tmplAfmt,
      cssDraft,
    ),
    queryFn: () =>
      ipc.previewTemplate(selectedId!, selectedTemplateOrd, sampleFields, tmplQfmt, tmplAfmt),
    enabled: tauri && selectedId !== null && !!template,
    staleTime: 0,
  });

  function invalidate() {
    setMutationError(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.notetypes });
    if (selectedId !== null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notetype(selectedId),
      });
    }
  }

  const reportError = (message: string) => {
    setMutationError(message);
    toast.error(message);
  };

  const handleMutationError = (err: unknown) => {
    reportError(err instanceof Error ? err.message : String(err));
  };

  const createNotetype = useMutation({
    mutationFn: (name: string) => ipc.createNotetype(name, 0),
    onSuccess: (d) => {
      invalidate();
      setSelectedId(d.id);
    },
    onError: handleMutationError,
  });

  const addStockNotetype = useMutation({
    mutationFn: (index: number) => ipc.addStockNotetype(index),
    onSuccess: (d) => {
      invalidate();
      setSelectedId(d.id);
    },
    onError: handleMutationError,
  });

  const deleteNotetype = useMutation({
    mutationFn: (id: number) => ipc.deleteNotetype(id),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
    onError: handleMutationError,
  });

  const duplicateNotetype = useMutation({
    mutationFn: ({ id, copyNameBase }: { id: number; copyNameBase: string }) =>
      ipc.duplicateNotetype(id, copyNameBase),
    onSuccess: (d) => {
      invalidate();
      setSelectedId(d.id);
      setSelectedTemplateOrd(0);
    },
    onError: handleMutationError,
  });

  const renameNotetype = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => ipc.renameNotetype(id, name),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const saveCss = useMutation({
    mutationFn: ({ id, css }: { id: number; css: string }) => ipc.saveNotetypeCss(id, css),
    onSuccess: () => {
      invalidate();
      toast.success(t("browse.saved"));
    },
    onError: handleMutationError,
  });

  const addField = useMutation({
    mutationFn: () => ipc.addField(selectedId!, "New Field"),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const removeField = useMutation({
    mutationFn: (ord: number) => ipc.removeField(selectedId!, ord),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const renameField = useMutation({
    mutationFn: ({ ord, name }: { ord: number; name: string }) =>
      ipc.renameField(selectedId!, ord, name),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const moveField = useMutation({
    mutationFn: ({ ord, direction }: { ord: number; direction: -1 | 1 }) => {
      if (!nt) throw new Error("no notetype");
      const n = nt.fields.length;
      const newOrder = Array.from({ length: n }, (_, i) => i);
      const targetOrd = ord + direction;
      if (targetOrd < 0 || targetOrd >= n) throw new Error("out of range");
      newOrder[ord] = targetOrd;
      newOrder[targetOrd] = ord;
      return ipc.reorderFields(selectedId!, newOrder);
    },
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const saveFieldOptions = useMutation({
    mutationFn: ({ ord, options }: { ord: number; options: FieldOptions }) =>
      ipc.saveFieldOptions(selectedId!, ord, options),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const setSortField = useMutation({
    mutationFn: (ord: number) => ipc.setSortField(selectedId!, ord),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    },
    onError: handleMutationError,
  });

  const addTemplate = useMutation({
    mutationFn: () => {
      const f1 = nt?.fields[0]?.name ?? "Front";
      const f2 = nt?.fields[1]?.name ?? f1;
      return ipc.addTemplate(
        selectedId!,
        `Card ${(nt?.templates.length ?? 0) + 1}`,
        `{{${f1}}}`,
        `{{FrontSide}}\n\n<hr id=answer>\n\n{{${f2}}}`,
      );
    },
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const removeTemplate = useMutation({
    mutationFn: (ord: number) => ipc.removeTemplate(selectedId!, ord),
    onSuccess: () => {
      setSelectedTemplateOrd(0);
      lastTemplateKeyRef.current = "";
      invalidate();
    },
    onError: handleMutationError,
  });

  const saveTemplate = useMutation({
    mutationFn: ({
      ord,
      name,
      qfmt,
      afmt,
    }: {
      ord: number;
      name: string;
      qfmt: string;
      afmt: string;
    }) => ipc.saveTemplate(selectedId!, ord, name, qfmt, afmt),
    onSuccess: () => {
      lastTemplateKeyRef.current = "";
      invalidate();
      toast.success(t("browse.saved"));
    },
    onError: handleMutationError,
  });

  const [ntNameDraft, setNtNameDraft] = useState("");
  useEffect(() => {
    setNtNameDraft(nt?.name ?? "");
  }, [nt?.id, nt?.name]);

  if (!tauri) {
    return (
      <EmptyState
        icon={BookType}
        title={t("decks.noTauri.title")}
        description={t("notetypes.noTauri.description")}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("notetypes.title")} description={t("notetypes.description")} />

      <ConfirmDialog
        open={confirmDialogState.open}
        title={confirmDialogState.title}
        description={confirmDialogState.description}
        onConfirm={confirmDialogState.onConfirm}
        onCancel={() => setConfirmDialogState((s) => ({ ...s, open: false }))}
      />

      {mutationError && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-xs text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{mutationError}</span>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setMutationError(null)}
            className="font-bold hover:opacity-75"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <NotetypeSidebar
          notetypes={notetypes.data ?? []}
          stockNames={stockNames.data ?? []}
          selectedId={selectedId}
          onSelect={(id) =>
            confirmSwitch(() => {
              setSelectedId(id);
              setSelectedTemplateOrd(0);
              setActiveTab("fields");
            })
          }
          onCreateBlank={() => createNotetype.mutate(t("notetypes.defaultName"))}
          onAddStock={(index) => addStockNotetype.mutate(index)}
        />

        {nt ? (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Header: name + duplicate + delete */}
            <div className="flex items-center gap-3 border-b border-border px-5 py-3">
              <input
                className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-base font-semibold outline-none hover:border-input focus:border-ring focus:ring-1 focus:ring-ring"
                value={ntNameDraft}
                onChange={(e) => setNtNameDraft(e.target.value)}
                onBlur={() => {
                  const clean = ntNameDraft.trim();
                  if (clean && clean !== nt.name) {
                    renameNotetype.mutate({ id: nt.id, name: clean });
                  } else {
                    setNtNameDraft(nt.name);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setNtNameDraft(nt.name);
                    e.currentTarget.blur();
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  duplicateNotetype.mutate({
                    id: nt.id,
                    copyNameBase: t("notetypes.copyName", { name: nt.name }),
                  })
                }
              >
                <Copy className="me-1.5 size-3.5" />
                {t("notetypes.duplicate")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                aria-label={t("notetypes.delete")}
                title={t("notetypes.delete")}
                onClick={() => {
                  setConfirmDialogState({
                    open: true,
                    title: t("notetypes.delete"),
                    description: t("notetypes.deleteConfirm", { name: nt.name }),
                    onConfirm: () => {
                      deleteNotetype.mutate(nt.id);
                      setConfirmDialogState((s) => ({ ...s, open: false }));
                    },
                  });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            {/* Tabs */}
            <div role="tablist" className="flex border-b border-border">
              {(["fields", "templates", "styling"] as const).map((tab) => (
                <button
                  key={tab}
                  id={`notetype-tab-${tab}`}
                  role="tab"
                  type="button"
                  tabIndex={activeTab === tab ? 0 : -1}
                  aria-selected={activeTab === tab}
                  aria-controls={`notetype-panel-${tab}`}
                  onClick={() => confirmSwitch(() => setActiveTab(tab))}
                  onKeyDown={(e) =>
                    handleTabListKeyDown(
                      e,
                      ["fields", "templates", "styling"] as const,
                      activeTab,
                      (next) => confirmSwitch(() => setActiveTab(next)),
                    )
                  }
                  className={[
                    "px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeTab === tab
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {t(`notetypes.tab.${tab}` as const)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {activeTab === "fields" && (
                <FieldsTab
                  nt={nt}
                  onSetSortField={(ord) => setSortField.mutate(ord)}
                  onMoveField={(ord, direction) => moveField.mutate({ ord, direction })}
                  onRenameField={(ord, name) => renameField.mutate({ ord, name })}
                  onRemoveField={(ord) => removeField.mutate(ord)}
                  onSaveFieldOptions={(ord, options) => saveFieldOptions.mutate({ ord, options })}
                  onAddField={() => addField.mutate()}
                  onValidationError={reportError}
                  onRequestConfirm={({ title, description, onConfirm }) =>
                    setConfirmDialogState({
                      open: true,
                      title,
                      description,
                      onConfirm: () => {
                        onConfirm();
                        setConfirmDialogState((s) => ({ ...s, open: false }));
                      },
                    })
                  }
                />
              )}

              {activeTab === "templates" && (
                <TemplatesTab
                  nt={nt}
                  template={template}
                  selectedTemplateOrd={selectedTemplateOrd}
                  tmplName={tmplName}
                  tmplQfmt={tmplQfmt}
                  tmplAfmt={tmplAfmt}
                  cssDraft={cssDraft}
                  previewQuestion={preview.data?.question ?? ""}
                  previewAnswer={preview.data?.answer ?? ""}
                  tauri={tauri}
                  night={night}
                  isSaving={saveTemplate.isPending}
                  onSelectTemplate={(ord) => confirmSwitch(() => setSelectedTemplateOrd(ord))}
                  onAddTemplate={() => addTemplate.mutate()}
                  onRemoveTemplate={(ord) => removeTemplate.mutate(ord)}
                  onChangeName={setTmplName}
                  onChangeQfmt={setTmplQfmt}
                  onChangeAfmt={setTmplAfmt}
                  onSaveTemplate={(ord) =>
                    saveTemplate.mutate({
                      ord,
                      name: tmplName,
                      qfmt: tmplQfmt,
                      afmt: tmplAfmt,
                    })
                  }
                  onRequestConfirm={({ title, description, onConfirm }) =>
                    setConfirmDialogState({
                      open: true,
                      title,
                      description,
                      onConfirm: () => {
                        onConfirm();
                        setConfirmDialogState((s) => ({ ...s, open: false }));
                      },
                    })
                  }
                />
              )}

              {activeTab === "styling" && (
                <StylingTab
                  cssDraft={cssDraft}
                  previewQuestion={preview.data?.question ?? ""}
                  previewAnswer={preview.data?.answer ?? ""}
                  tauri={tauri}
                  night={night}
                  isSaving={saveCss.isPending}
                  onChangeCss={setCssDraft}
                  onSaveCss={() => saveCss.mutate({ id: nt.id, css: cssDraft })}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {notetypes.isLoading ? t("common.loading") : t("notetypes.select")}
          </div>
        )}
      </div>
    </div>
  );
}

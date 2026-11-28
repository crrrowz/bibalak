import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { htmlToText } from "@/lib/htmlText";

function stripHtml(html: string): string {
  return htmlToText(html);
}

export interface UseNoteComposerOptions {
  enabled: boolean;
  preferredDeckId: number | null;
  preferredNotetypeId: number | null;
  onSelectDeck?: (deckId: number) => void;
  onSelectNotetype?: (notetypeId: number) => void;
}

export function useNoteComposer({
  enabled,
  preferredDeckId,
  preferredNotetypeId,
  onSelectDeck,
  onSelectNotetype,
}: UseNoteComposerOptions) {
  const queryClient = useQueryClient();

  const notetypes = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: () => ipc.listNotetypes(),
    enabled,
  });

  const decks = useQuery({
    queryKey: queryKeys.decks,
    queryFn: () => ipc.listDecks(),
    enabled,
    select: (list) => list.filter((d) => !d.is_filtered),
  });

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => ipc.listTags(),
    enabled,
  });

  const [notetypeId, setNotetypeId] = useState<number | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [duplicateNoteId, setDuplicateNoteId] = useState<number | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const availableNotetypes = notetypes.data ?? [];
  const selectedNotetype =
    availableNotetypes.find((nt) => nt.id === notetypeId) ??
    availableNotetypes.find((nt) => nt.id === preferredNotetypeId) ??
    availableNotetypes[0] ??
    null;

  const activeNotetypeId = selectedNotetype?.id ?? notetypeId;
  const notetypeDetail = useQuery({
    queryKey: queryKeys.notetypesDetail(activeNotetypeId),
    queryFn: () => ipc.getNotetype(activeNotetypeId!),
    enabled: enabled && activeNotetypeId !== null && typeof ipc.getNotetype === "function",
  });

  useEffect(() => {
    if (!selectedNotetype) return;
    if (notetypeId !== selectedNotetype.id) {
      setNotetypeId(selectedNotetype.id);
      setFields(selectedNotetype.field_names.map(() => ""));
    } else if (fields.length !== selectedNotetype.field_names.length) {
      setFields((cur) => selectedNotetype.field_names.map((_, i) => cur[i] ?? ""));
    }
  }, [selectedNotetype, notetypeId, fields.length]);

  useEffect(() => {
    if (!decks.data || decks.data.length === 0) return;
    if (deckId !== null && decks.data.some((d) => d.id === deckId)) return;
    const targetDeckId =
      preferredDeckId !== null && decks.data.some((d) => d.id === preferredDeckId)
        ? preferredDeckId
        : decks.data[0].id;
    setDeckId(targetDeckId);
  }, [decks.data, preferredDeckId, deckId]);

  const firstField = fields[0] ?? "";
  useEffect(() => {
    if (!selectedNotetype || !enabled) {
      setDuplicateNoteId(null);
      return;
    }
    if (!stripHtml(firstField)) {
      setDuplicateNoteId(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void ipc.checkDuplicate(selectedNotetype.id, firstField).then((dupId) => {
        if (!cancelled) setDuplicateNoteId(dupId);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [firstField, selectedNotetype, enabled]);

  const duplicateNoteQuery = useQuery({
    queryKey: queryKeys.notesDetail(duplicateNoteId ?? -1),
    queryFn: () => ipc.getNote(duplicateNoteId!),
    enabled: enabled && duplicateNoteId !== null && typeof ipc.getNote === "function",
    staleTime: 30_000,
  });
  const duplicateNoteTitle = duplicateNoteQuery.data?.fields[0]?.value
    ? stripHtml(duplicateNoteQuery.data.fields[0].value)
    : null;

  const handleNotetypeChange = (id: number) => {
    const nt = notetypes.data?.find((n) => n.id === id);
    setNotetypeId(id);
    onSelectNotetype?.(id);
    setFields(nt ? nt.field_names.map(() => "") : []);
    setLastResult(null);
  };

  const handleDeckChange = (id: number) => {
    setDeckId(id);
    onSelectDeck?.(id);
  };

  const setField = (index: number, html: string) =>
    setFields((current) => {
      const next = [...current];
      next[index] = html;
      return next;
    });

  const isImageOcclusion =
    Number(selectedNotetype?.kind) === 1 && Boolean(selectedNotetype?.is_image_occlusion);
  const imageFieldIdx = selectedNotetype?.field_names.indexOf("Image") ?? -1;
  const occlusionFieldIdx = selectedNotetype?.field_names.indexOf("Occlusion") ?? -1;

  const add = useMutation({
    mutationFn: () => {
      if (notetypeId === null || deckId === null) throw new Error(t("add.selectFirst"));
      // Strip empty rich-text tags so Rust validates empty first field uniformly.
      const cleanFields = fields.map((f, i) => (i === 0 && !stripHtml(f) ? "" : f));
      return ipc.addNote(notetypeId, deckId, cleanFields, tags.split(/\s+/).filter(Boolean));
    },
    onSuccess: (result) => {
      setLastResult(tn("add.cardsCreated", result.cards_added));
      if (selectedNotetype) {
        setFields(selectedNotetype.field_names.map(() => ""));
      }
      setDuplicateNoteId(null);
      setFormVersion((v) => v + 1);
      setTags("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckCardIdsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!add.isPending) {
          add.mutate();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [add]);

  return {
    notetypes,
    decks,
    tagsQuery,
    notetypeDetail,
    selectedNotetype,
    notetypeId,
    deckId,
    fields,
    tags,
    setTags,
    lastResult,
    duplicateWarning: duplicateNoteId !== null,
    duplicateNoteId,
    duplicateNoteTitle,
    formVersion,
    handleNotetypeChange,
    handleDeckChange,
    setField,
    isImageOcclusion,
    imageFieldIdx,
    occlusionFieldIdx,
    add,
  };
}

import type { MediaLibraryFilter, MediaLibraryItem, MediaLibraryPage } from "@bibalak/ipc-types";

interface MockMediaEntry {
  item: MediaLibraryItem;
  decks: string[];
  tags: string[];
}

const initialMediaItems: MockMediaEntry[] = [
  {
    item: { filename: "cardiac-cycle.png", size_bytes: 184_320, kind: "image", usage_count: 3 },
    decks: ["Medicine", "Medicine::Cardiology"],
    tags: ["cardiology::ecg"],
  },
  {
    item: { filename: "pronunciation-hola.mp3", size_bytes: 42_180, kind: "audio", usage_count: 2 },
    decks: ["Spanish"],
    tags: ["verbs"],
  },
  {
    item: { filename: "nephron-loop.jpg", size_bytes: 95_400, kind: "image", usage_count: 1 },
    decks: ["Medicine"],
    tags: ["تشريح"],
  },
  {
    item: {
      filename: "echocardiogram-clip.mp4",
      size_bytes: 1_420_000,
      kind: "video",
      usage_count: 1,
    },
    decks: ["Medicine::Cardiology"],
    tags: ["cardiology::ecg"],
  },
  {
    item: { filename: "unused-diagram.png", size_bytes: 63_200, kind: "image", usage_count: 0 },
    decks: [],
    tags: [],
  },
  {
    item: { filename: "old-recording.ogg", size_bytes: 28_900, kind: "audio", usage_count: 0 },
    decks: [],
    tags: [],
  },
  {
    item: { filename: "grammar-chart.svg", size_bytes: 12_450, kind: "image", usage_count: 4 },
    decks: ["Spanish", "Japanese Kanji"],
    tags: ["arabic::grammar", "kanji-n3"],
  },
  {
    item: { filename: "archive-notes.pdf", size_bytes: 512_000, kind: "other", usage_count: 0 },
    decks: [],
    tags: [],
  },
];

let previewMediaItems: MockMediaEntry[] = [...initialMediaItems];
let previewAudioUrl: string | null = null;
let audioObserverInstalled = false;

function getPreviewAudioBlobUrl(durationSec = 25): string {
  if (previewAudioUrl) return previewAudioUrl;
  const sampleRate = 8000;
  const numSamples = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 0.15);
    const sample = 128 + Math.round(24 * envelope * Math.sin(2 * Math.PI * 440 * t));
    view.setUint8(44 + i, sample);
  }
  previewAudioUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return previewAudioUrl;
}

function ensurePreviewAudioObserver() {
  if (audioObserverInstalled || typeof document === "undefined") return;
  audioObserverInstalled = true;
  const patchAudioElements = () => {
    document.querySelectorAll("audio").forEach((el) => {
      if (el.src && el.src.includes("bibalak-media")) {
        el.src = getPreviewAudioBlobUrl(25);
      }
    });
  };
  const observer = new MutationObserver(patchAudioElements);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  patchAudioElements();
}

function matchesQuery(entry: MockMediaEntry, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const deckMatch = /deck:"([^"]+)"|deck:([^\s]+)/.exec(q);
  if (deckMatch) {
    const deck = deckMatch[1] ?? deckMatch[2];
    if (!entry.decks.includes(deck)) return false;
  }
  const tagMatch = /tag:"([^"]+)"|tag:([^\s]+)/.exec(q);
  if (tagMatch) {
    const tag = tagMatch[1] ?? tagMatch[2];
    if (!entry.tags.some((t) => t === tag || t.startsWith(`${tag}::`))) return false;
  }
  return entry.item.usage_count > 0;
}

export const mediaMocks: Record<string, (args: unknown) => unknown> = {
  list_media_library: (args: unknown) => {
    ensurePreviewAudioObserver();
    const {
      search = "",
      filter,
      limit = 48,
      offset = 0,
    } = (args ?? {}) as {
      search?: string;
      filter?: Partial<MediaLibraryFilter> | null;
      limit?: number;
      offset?: number;
    };

    const needle = search.trim().toLowerCase();
    const query = filter?.query ?? "";
    const kind = filter?.kind ?? null;
    const usage = filter?.usage ?? "all";
    const sort = filter?.sort ?? "name";

    let filtered = previewMediaItems
      .filter((entry) => matchesQuery(entry, query))
      .map((entry) => entry.item)
      .filter((item) => (!needle ? true : item.filename.toLowerCase().includes(needle)))
      .filter((item) => (kind ? item.kind === kind : true))
      .filter((item) => {
        if (usage === "used") return item.usage_count > 0;
        if (usage === "unused") return item.usage_count === 0;
        return true;
      });

    filtered = [...filtered].sort((a, b) => {
      if (sort === "size-desc") {
        return b.size_bytes - a.size_bytes || a.filename.localeCompare(b.filename);
      }
      if (sort === "usage-desc") {
        return b.usage_count - a.usage_count || a.filename.localeCompare(b.filename);
      }
      return a.filename.localeCompare(b.filename);
    });

    const page: MediaLibraryPage = {
      items: filtered.slice(offset, offset + limit),
      total_count: filtered.length,
      library_count: previewMediaItems.length,
      unused_count: previewMediaItems.filter((e) => e.item.usage_count === 0).length,
      total_bytes: previewMediaItems.reduce((sum, e) => sum + e.item.size_bytes, 0),
    };
    return page;
  },
  delete_unused_media: () => {
    const before = previewMediaItems.length;
    previewMediaItems = previewMediaItems.filter((e) => e.item.usage_count > 0);
    return before - previewMediaItems.length;
  },
};

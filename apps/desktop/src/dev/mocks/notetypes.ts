import type { FieldOptions, NotetypeDetail, NotetypeSummary } from "@bibalak/ipc-types";

const DEFAULT_OPTS: FieldOptions = {
  direction: "auto",
  font: "",
  size: 0,
  description: "",
};

export const mockNotetypeSummaries: NotetypeSummary[] = [
  {
    id: 1,
    name: "Basic",
    kind: 0n,
    field_names: ["Front", "Back"],
    note_count: 20,
  },
  {
    id: 2,
    name: "Basic (and reversed card)",
    kind: 0n,
    field_names: ["Front", "Back"],
    note_count: 5,
  },
  {
    id: 3,
    name: "Cloze",
    kind: 1n,
    field_names: ["Text", "Back Extra"],
    note_count: 10,
  },
  {
    id: 4,
    name: "Image Occlusion",
    kind: 1n,
    is_image_occlusion: true,
    field_names: ["Image", "Occlusion", "Header", "Remarks"],
    note_count: 2,
  },
  {
    id: 5,
    name: "Vocabulary (Imported)",
    kind: 0n,
    field_names: ["Word", "IPA", "Kata", "Sound", "Meaning", "Notes"],
    note_count: 140,
  },
];

export const mockNotetypeDetails: Record<number, NotetypeDetail> = {
  1: {
    id: 1,
    name: "Basic",
    kind: 0n,
    sort_field: 0n,
    fields: [
      { ord: 0n, name: "Front", options: DEFAULT_OPTS },
      { ord: 1n, name: "Back", options: DEFAULT_OPTS },
    ],
    templates: [
      {
        ord: 0n,
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
      },
    ],
    css: ".card { font-family: sans-serif; text-align: center; }",
    preset: null,
  },
  2: {
    id: 2,
    name: "Basic (and reversed card)",
    kind: 0n,
    sort_field: 0n,
    fields: [
      { ord: 0n, name: "Front", options: DEFAULT_OPTS },
      { ord: 1n, name: "Back", options: DEFAULT_OPTS },
    ],
    templates: [
      {
        ord: 0n,
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
      },
      {
        ord: 1n,
        name: "Card 2",
        qfmt: "{{Back}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}",
      },
    ],
    css: ".card { font-family: sans-serif; text-align: center; }",
    preset: null,
  },
  3: {
    id: 3,
    name: "Cloze",
    kind: 1n,
    sort_field: 0n,
    fields: [
      { ord: 0n, name: "Text", options: DEFAULT_OPTS },
      { ord: 1n, name: "Back Extra", options: DEFAULT_OPTS },
    ],
    templates: [
      {
        ord: 0n,
        name: "Cloze",
        qfmt: "{{cloze:Text}}",
        afmt: "{{cloze:Text}}\n\n<hr id=answer>\n\n{{Back Extra}}",
      },
    ],
    css: ".card { font-family: sans-serif; text-align: center; } .cloze { font-weight: bold; color: blue; }",
    preset: null,
  },
  4: {
    id: 4,
    name: "Image Occlusion",
    kind: 1n,
    is_image_occlusion: true,
    sort_field: 0n,
    fields: [
      { ord: 0n, name: "Image", options: DEFAULT_OPTS },
      { ord: 1n, name: "Occlusion", options: DEFAULT_OPTS },
      { ord: 2n, name: "Header", options: DEFAULT_OPTS },
      { ord: 3n, name: "Remarks", options: DEFAULT_OPTS },
    ],
    templates: [
      {
        ord: 0n,
        name: "Image Occlusion",
        qfmt: "{{Header}}<br>{{Image}}",
        afmt: "{{Header}}<br>{{Image}}<br>{{Remarks}}",
      },
    ],
    css: ".card { font-family: sans-serif; text-align: center; }",
    preset: null,
  },
  5: {
    id: 5,
    name: "Vocabulary (Imported)",
    kind: 0n,
    sort_field: 0n,
    fields: [
      {
        ord: 0n,
        name: "Word",
        options: { ...DEFAULT_OPTS, description: "Target vocabulary word" },
      },
      { ord: 1n, name: "IPA", options: { ...DEFAULT_OPTS, description: "Pronunciation guide" } },
      { ord: 2n, name: "Kata", options: DEFAULT_OPTS },
      {
        ord: 3n,
        name: "Sound",
        options: { ...DEFAULT_OPTS, description: "Audio clip [sound:file.mp3]" },
      },
      {
        ord: 4n,
        name: "Meaning",
        options: { ...DEFAULT_OPTS, description: "Primary translation" },
      },
      {
        ord: 5n,
        name: "Notes",
        options: { ...DEFAULT_OPTS, description: "Usage examples or context" },
      },
    ],
    templates: [
      {
        ord: 0n,
        name: "Recognition",
        qfmt: "{{Word}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Meaning}}",
      },
    ],
    css: ".card { font-family: sans-serif; text-align: center; }",
    preset: null,
  },
};

function renderTemplateHtml(tmpl: string, fieldNames: string[], values: string[]): string {
  let out = tmpl;
  fieldNames.forEach((name, idx) => {
    const val = values[idx] ?? `(${name})`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\{\\{(?:cloze:|type:|text:)?${escaped}\\}\\}`, "g"), val);
  });
  return out;
}

export const notetypeMocks = {
  list_notetypes: mockNotetypeSummaries,
  get_notetype: (args?: { notetypeId?: number }) =>
    args?.notetypeId ? (mockNotetypeDetails[args.notetypeId] ?? null) : null,
  preview_template: (args?: {
    notetypeId?: number;
    templateOrd?: number;
    sampleFields?: string[];
    qfmt?: string | null;
    afmt?: string | null;
  }) => {
    const nt = args?.notetypeId ? mockNotetypeDetails[args.notetypeId] : mockNotetypeDetails[1];
    const ord = BigInt(args?.templateOrd ?? 0);
    const tmpl = nt?.templates.find((t) => t.ord === ord) ?? nt?.templates[0];
    const fieldNames = nt?.fields.map((f) => f.name) ?? ["Front", "Back"];
    const values = args?.sampleFields ?? fieldNames.map((n) => `(${n})`);
    const q = renderTemplateHtml(args?.qfmt ?? tmpl?.qfmt ?? "{{Front}}", fieldNames, values);
    const rawA = args?.afmt ?? tmpl?.afmt ?? "{{FrontSide}}<hr id=answer>{{Back}}";
    const a = renderTemplateHtml(rawA.replace(/\{\{FrontSide\}\}/g, q), fieldNames, values);
    return { question: q, answer: a };
  },
  lint_notetype: () => [],
};

import type { NoteDetail, NoteOverview } from "@bibalak/ipc-types";
import { htmlToText } from "@/lib/htmlText";

const RAW_NOTES: Array<{
  id: number;
  sort_field: string;
  tags: string[];
  notetype_name: string;
  fields: Array<{ name: string; value: string }>;
}> = [
  {
    id: 1,
    sort_field: "What is the primary pacemaker of the heart?",
    tags: ["cardiology", "anatomy"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "What is the primary pacemaker of the heart?" },
      { name: "Back", value: "Sinoatrial (SA) node" },
    ],
  },
  {
    id: 2,
    sort_field: "First-line drug for anaphylaxis",
    tags: ["pharmacology", "emergency"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "First-line drug for anaphylaxis" },
      { name: "Back", value: "Intramuscular Epinephrine (1:1,000)" },
    ],
  },
  {
    id: 3,
    sort_field: "The {{c1::mitral}} valve separates the left atrium from left ventricle.",
    tags: ["cardiology", "cloze"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "The {{c1::mitral}} valve separates the left atrium from left ventricle.",
      },
      { name: "Back Extra", value: "Also called the bicuspid valve." },
    ],
  },
  {
    id: 4,
    sort_field: "ما هو العصب المسؤول عن حركة عضلات الوجه التعبيرية؟",
    tags: ["عصبي", "تشريح", "arabic"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "ما هو العصب المسؤول عن حركة عضلات الوجه التعبيرية؟" },
      { name: "Back", value: "العصب القحفي السابع (العصب الوجهي - Facial nerve)" },
    ],
  },
  {
    id: 5,
    sort_field: "العضو الأساسي المسؤول عن استقلاب الأدوية في جسم الإنسان هو {{c1::الكبد}}.",
    tags: ["أدوية", "فيزيولوجيا", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "العضو الأساسي المسؤول عن استقلاب الأدوية في جسم الإنسان هو {{c1::الكبد}}.",
      },
      { name: "Back Extra", value: "بواسطة إنزيمات السيتوكروم P450" },
    ],
  },
  {
    id: 6,
    sort_field: "Normal resting heart rate in adults",
    tags: ["cardiology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Normal resting heart rate in adults" },
      { name: "Back", value: "60–100 beats per minute" },
    ],
  },
  {
    id: 7,
    sort_field: "Mechanism of action of Aspirin",
    tags: ["pharmacology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Mechanism of action of Aspirin" },
      { name: "Back", value: "Irreversible inhibition of COX-1 and COX-2 enzymes" },
    ],
  },
  {
    id: 8,
    sort_field: "Cranial nerve I is the {{c1::Olfactory}} nerve.",
    tags: ["neurology"],
    notetype_name: "Cloze",
    fields: [
      { name: "Text", value: "Cranial nerve I is the {{c1::Olfactory}} nerve." },
      { name: "Back Extra", value: "Responsible for olfaction (sense of smell)." },
    ],
  },
  {
    id: 9,
    sort_field: "ما هي الجرعة القياسية للباراسيتامول للبالغين؟",
    tags: ["أدوية", "arabic"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "ما هي الجرعة القياسية للباراسيتامول للبالغين؟" },
      { name: "Back", value: "500–1000 ملغ كل 4-6 ساعات (بحد أقصى 4 غرام يومياً)" },
    ],
  },
  {
    id: 10,
    sort_field: "Most common organism causing community-acquired pneumonia",
    tags: ["infectious-disease"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Most common organism causing community-acquired pneumonia" },
      { name: "Back", value: "Streptococcus pneumoniae" },
    ],
  },
  {
    id: 11,
    sort_field: "Classic triad of aortic stenosis",
    tags: ["cardiology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Classic triad of aortic stenosis" },
      { name: "Back", value: "Dyspnea, Angina, Syncope (SAD)" },
    ],
  },
  {
    id: 12,
    sort_field: "تفرز خلايا بيتا في جزر لانغرهانس هرمون {{c1::الإنسولين}}.",
    tags: ["غدد", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "تفرز خلايا بيتا في جزر لانغرهانس هرمون {{c1::الإنسولين}}.",
      },
      { name: "Back Extra", value: "بينما تفرز خلايا ألفا الغلوكاغون" },
    ],
  },
  {
    id: 13,
    sort_field: "Antidote for Heparin overdose",
    tags: ["hematology", "antidotes"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Antidote for Heparin overdose" },
      { name: "Back", value: "Protamine sulfate" },
    ],
  },
  {
    id: 14,
    sort_field: "Antidote for Warfarin overdose",
    tags: ["hematology", "antidotes"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Antidote for Warfarin overdose" },
      { name: "Back", value: "Vitamin K (Phytonadione) and Kcentra (PCC)" },
    ],
  },
  {
    id: 15,
    sort_field: "Pathognomonic sign of rabies",
    tags: ["neurology", "infectious-disease"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Pathognomonic sign of rabies (histology)" },
      { name: "Back", value: "Negri bodies (eosinophilic cytoplasmic inclusions in neurons)" },
    ],
  },
  {
    id: 16,
    sort_field: "ما هو الهرمون المسؤول عن إنتاج الحليب؟",
    tags: ["غدد", "arabic"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "ما هو الهرمون المسؤول عن إنتاج الحليب؟" },
      { name: "Back", value: "البرولاكتين (Prolactin)" },
    ],
  },
  {
    id: 17,
    sort_field: "The functional unit of the kidney is the {{c1::nephron}}.",
    tags: ["nephrology"],
    notetype_name: "Cloze",
    fields: [
      { name: "Text", value: "The functional unit of the kidney is the {{c1::nephron}}." },
      { name: "Back Extra", value: "Approximately 1 million nephrons per kidney." },
    ],
  },
  {
    id: 18,
    sort_field: "Which vitamin deficiency causes Scurvy?",
    tags: ["nutrition", "biochemistry"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Which vitamin deficiency causes Scurvy?" },
      { name: "Back", value: "Vitamin C (Ascorbic acid)" },
    ],
  },
  {
    id: 19,
    sort_field: "Which vitamin deficiency causes Rickets in children?",
    tags: ["pediatrics", "nutrition"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Which vitamin deficiency causes Rickets in children?" },
      { name: "Back", value: "Vitamin D" },
    ],
  },
  {
    id: 20,
    sort_field: "يحدث فقر الدم الوبيل بسبب نقص فيتامين {{c1::B12}}.",
    tags: ["دم", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "يحدث فقر الدم الوبيل بسبب نقص فيتامين {{c1::B12}}.",
      },
      { name: "Back Extra", value: "نتيجة غياب العامل الداخلي (Intrinsic factor)" },
    ],
  },
  {
    id: 21,
    sort_field: "Gene mutated in Cystic Fibrosis",
    tags: ["genetics", "pulmonology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Gene mutated in Cystic Fibrosis" },
      { name: "Back", value: "CFTR (chromosome 7, most common is ΔF508)" },
    ],
  },
  {
    id: 22,
    sort_field: "Koplik spots are characteristic of",
    tags: ["pediatrics", "infectious-disease"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Koplik spots are characteristic of" },
      { name: "Back", value: "Measles (Rubeola)" },
    ],
  },
  {
    id: 23,
    sort_field:
      "الأوعية التي تحمل الدم غير المؤكسج من القلب إلى الرئتين هي {{c1::الشرايين الرئوية}}.",
    tags: ["قلبية", "تشريح", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value:
          "الأوعية التي تحمل الدم غير المؤكسج من القلب إلى الرئتين هي {{c1::الشرايين الرئوية}}.",
      },
      { name: "Back Extra", value: "الشرايين الوحيدة في الجسم التي تحمل دماً غير مؤكسج" },
    ],
  },
  {
    id: 24,
    sort_field: "Diagnostic marker for acute pancreatitis",
    tags: ["gastroenterology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Diagnostic marker for acute pancreatitis (most specific)" },
      {
        name: "Back",
        value: "Serum Lipase (more specific and remains elevated longer than amylase)",
      },
    ],
  },
  {
    id: 25,
    sort_field: "ECG finding in hyperkalemia",
    tags: ["cardiology", "ecg"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Earliest ECG finding in hyperkalemia" },
      { name: "Back", value: "Peaked T waves (tall, narrow, tented)" },
    ],
  },
  {
    id: 26,
    sort_field: "العظمة الأطول والأقوى في جسم الإنسان هي عظمة {{c1::الفخذ}}.",
    tags: ["تشريح", "عظام", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "العظمة الأطول والأقوى في جسم الإنسان هي عظمة {{c1::الفخذ}}.",
      },
      { name: "Back Extra", value: "عظمة الفخذ (Femur)" },
    ],
  },
  {
    id: 27,
    sort_field: "First-line treatment for Lyme disease in non-pregnant adults",
    tags: ["infectious-disease", "pharmacology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "First-line treatment for Lyme disease in non-pregnant adults" },
      { name: "Back", value: "Doxycycline" },
    ],
  },
  {
    id: 28,
    sort_field: "Most sensitive test for diagnosing Multiple Sclerosis",
    tags: ["neurology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Most sensitive test for diagnosing Multiple Sclerosis" },
      { name: "Back", value: "MRI of the brain and spinal cord with gadolinium" },
    ],
  },
  {
    id: 29,
    sort_field: "الغدة النخامية تقع داخل تجويف عظمي يُسمى {{c1::السرج التركي}}.",
    tags: ["تشريح", "غدد", "arabic"],
    notetype_name: "Cloze",
    fields: [
      {
        name: "Text",
        value: "الغدة النخامية تقع داخل تجويف عظمي يُسمى {{c1::السرج التركي}}.",
      },
      { name: "Back Extra", value: "Sella turcica في العظم الوتدي" },
    ],
  },
  {
    id: 30,
    sort_field: "Primary neurotransmitter of the parasympathetic nervous system",
    tags: ["neuroscience", "pharmacology"],
    notetype_name: "Basic",
    fields: [
      { name: "Front", value: "Primary neurotransmitter of the parasympathetic nervous system" },
      { name: "Back", value: "Acetylcholine (ACh)" },
    ],
  },
];

export const mockNoteOverviews: NoteOverview[] = RAW_NOTES.map((n) => ({
  note_id: n.id,
  sort_field: n.sort_field,
  tags: n.tags,
}));

export const mockNoteDetails: Record<number, NoteDetail> = Object.fromEntries(
  RAW_NOTES.map((n) => [
    n.id,
    {
      note_id: n.id,
      notetype_name: n.notetype_name,
      fields: n.fields.map((f) => ({
        ...f,
        options: { direction: "auto" as const, font: "", size: 0, description: "" },
      })),
      tags: n.tags,
    },
  ]),
);

export const noteMocks = {
  list_notes: (args?: { query?: string | null }) => {
    const q = args?.query?.toLowerCase() ?? "";
    if (!q) return mockNoteOverviews;
    return mockNoteOverviews.filter(
      (n) =>
        n.sort_field.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  },
  search_notes: (args?: { query: string }) => {
    const q = args?.query?.toLowerCase() ?? "";
    if (!q) return mockNoteOverviews;
    return mockNoteOverviews.filter(
      (n) =>
        n.sort_field.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  },
  get_note: (args?: { noteId: number }) =>
    args?.noteId ? (mockNoteDetails[args.noteId] ?? null) : null,
  save_note: (args?: { noteId: number; fields: string[]; tags: string[] }) => {
    if (!args?.noteId) return null;
    const existing = mockNoteDetails[args.noteId];
    if (!existing) return null;
    mockNoteDetails[args.noteId] = {
      ...existing,
      fields: existing.fields.map((f, i) => ({
        ...f,
        value: args.fields[i] ?? f.value,
      })),
      tags: args.tags ?? existing.tags,
    };
    return null;
  },
  check_duplicate: (args?: { notetypeId: number; firstField: string }) => {
    const plain = htmlToText(args?.firstField ?? "", " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const match = RAW_NOTES.find((n) => n.sort_field.trim().toLowerCase() === plain);
    return match ? match.id : null;
  },
};

import type { CardRow } from "@bibalak/ipc-types";

const DECKS = [
  "Medicine",
  "Medicine::Cardiology",
  "Medicine::Pharmacology",
  "Spanish",
  "Japanese Kanji",
];

const NOTETYPES = ["Basic", "Basic (and reversed card)", "Cloze"];

const SAMPLE_TERMS = [
  { front: "Amiodarone mechanism of action", tags: ["pharm", "cardiology"] },
  { front: "Beta-1 receptor location & function", tags: ["pharm", "cardiology"] },
  { front: "Digoxin toxicity signs and ECG changes", tags: ["pharm", "cardiology"] },
  { front: "Lisinopril adverse effect: dry cough mechanism", tags: ["pharm"] },
  { front: "Metoprolol succinate vs tartrate dosing", tags: ["pharm", "cardiology"] },
  { front: "Nitroglycerin sublingual onset and storage", tags: ["pharm", "angina"] },
  { front: "Warfarin INR target for atrial fibrillation", tags: ["pharm", "hematology"] },
  { front: "Atorvastatin CYP3A4 interactions", tags: ["pharm", "lipids"] },
  { front: "Furosemide site of action in loop of Henle", tags: ["pharm", "renal"] },
  { front: "Spironolactone hyperkalemia risk factors", tags: ["pharm", "renal"] },
  { front: "Hablar (to speak) - Present subjunctive conjugation", tags: ["spanish", "verbs"] },
  { front: "Tener que + infinitive construction", tags: ["spanish", "grammar"] },
  { front: "Por vs Para decision rules", tags: ["spanish", "grammar"] },
  { front: "Ser vs Estar with adjectives changing meaning", tags: ["spanish", "grammar"] },
  { front: "Subjunctive with doubt and emotion: dudar que", tags: ["spanish", "subjunctive"] },
  { front: "日 (Sun, Day) - Onyomi: ニチ, ジツ / Kunyomi: ひ, -び, -か", tags: ["kanji", "n5"] },
  { front: "月 (Moon, Month) - Onyomi: ゲツ, ガツ / Kunyomi: つき", tags: ["kanji", "n5"] },
  { front: "火 (Fire) - Onyomi: カ / Kunyomi: ひ, -び, ほ-", tags: ["kanji", "n5"] },
  { front: "水 (Water) - Onyomi: スイ / Kunyomi: みず", tags: ["kanji", "n5"] },
  { front: "木 (Tree, Wood) - Onyomi: ボク, モク / Kunyomi: き, こ-", tags: ["kanji", "n5"] },
  { front: "كان وأخواتها: الأفعال الناسخة وحكم اسمها وخبرها", tags: ["arabic", "grammar"] },
  { front: "إنّ وأخواتها: الحروف المشبهة بالفعل وحالات إعرابها", tags: ["arabic", "grammar"] },
  {
    front: "المفعول المطلق: أنواعه (مؤكد للفعل، مبين للنوع، مبين للعدد)",
    tags: ["arabic", "grammar"],
  },
  { front: "جمع التكسير وأوزانه القياسية والسماعية", tags: ["arabic", "morphology"] },
  { front: "الاستثناء بـ (إلا، غير، سوى): أحكام المستثنى وإعرابه", tags: ["arabic", "grammar"] },
];

export const mockCards: CardRow[] = Array.from({ length: 200 }, (_, i) => {
  const cardId = 1000 + i;
  const noteId = 500 + Math.floor(i / 2);
  const sample = SAMPLE_TERMS[i % SAMPLE_TERMS.length];
  const deck = DECKS[i % DECKS.length];
  const notetype = NOTETYPES[i % NOTETYPES.length];

  // Distribute across states:
  // 0-49: review (queue 2, card_type 2)
  // 50-89: new (queue 0, card_type 0)
  // 90-119: learn (queue 1, card_type 1)
  // 120-139: relearn (queue 1, card_type 3)
  // 140-159: suspended (queue -1, various card_types)
  // 160-179: buried (queue -2, various card_types)
  // 180-199: sibling-buried (queue -3, various card_types)
  let queue = 2;
  let cardType = 2;
  let due = 10 + (i % 60);
  let interval = 5 + (i % 90);
  let lapses = i % 4 === 0 ? Math.floor(i / 10) : 0;
  let reps = 5 + (i % 30);

  if (i >= 50 && i < 90) {
    queue = 0;
    cardType = 0;
    due = i - 49; // new card position
    interval = 0;
    lapses = 0;
    reps = 0;
  } else if (i >= 90 && i < 120) {
    queue = 1;
    cardType = 1;
    due = Date.now() + ((i % 10) - 5) * 60_000;
    interval = 1;
  } else if (i >= 120 && i < 140) {
    queue = 1;
    cardType = 3; // relearning
    due = Date.now() + ((i % 10) - 2) * 60_000;
    interval = 1;
    lapses = 2 + (i % 5);
  } else if (i >= 140 && i < 160) {
    queue = -1; // suspended
    cardType = i % 4;
    due = cardType === 1 || cardType === 3 ? Date.now() + 300_000 : 25 + (i % 30);
    interval = cardType === 0 ? 0 : 15;
  } else if (i >= 160 && i < 180) {
    queue = -2; // user-buried
    cardType = i % 4;
    due = cardType === 1 || cardType === 3 ? Date.now() + 300_000 : 30;
    interval = cardType === 0 ? 0 : 20;
  } else if (i >= 180 && i < 200) {
    queue = -3; // sibling-buried
    cardType = i % 4;
    due = 35;
    interval = cardType === 0 ? 0 : 25;
  }

  // Flags 0 to 7 distributed
  const flags = i % 8;

  return {
    card_id: cardId,
    note_id: noteId,
    sort_field: `${sample.front} [${cardId}]`,
    deck,
    notetype,
    tags: sample.tags,
    queue,
    card_type: cardType,
    due,
    interval,
    lapses,
    reps,
    flags,
  };
});
